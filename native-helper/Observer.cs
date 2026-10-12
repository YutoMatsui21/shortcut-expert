using System.Diagnostics;
using System.Runtime.InteropServices;
using static NativeMethods;
using Point = NativeMethods.Point;

internal sealed class Observer : IDisposable
{
    private const long InputMatchWindowMs = 1000;
    private const int CaptionDoubleClickDistancePx = 4;
    private const uint HitTestTimeoutMs = 10;
    private const long NoCaptionClickAt = -10000;
    private sealed record State(uint Process, string App, uint Show, bool? Arranged);
    private sealed record Input(nint Window, State Before, string Origin, string Route, long At, bool Injected, bool Conflicted, bool Matched);
    private readonly Action<object> emit;
    private readonly bool fixture;
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private readonly Dictionary<nint, State> states = new();
    private readonly HashSet<nint> moving = new();
    // Native側がcallbackを呼ぶ間、解除までdelegateをGCから保護する。
    private readonly InputHook mouseCallback, keyCallback;
    private readonly EventHook eventCallback;
    private readonly List<nint> eventHooks = new();
    private nint mouseHook, keyHook;
    private Input? input;
    private nint lastCaption;
    private long lastCaptionAt = NoCaptionClickAt;
    private Point lastCaptionPoint;
    private int generation, sequence;
    private static readonly Arranged? isArranged = LoadArranged();

    internal Observer(Action<object> emit, bool fixture = false)
    {
        this.emit = emit; this.fixture = fixture;
        mouseCallback = OnMouse; keyCallback = OnKey; eventCallback = OnEvent;
    }
    internal bool Active => mouseHook != 0 && keyHook != 0 && eventHooks.Count == 4;
    internal static bool ArrangedAvailable => isArranged is not null;
    internal static string ForegroundToken => GetForegroundWindow().ToString();
    private static Arranged? LoadArranged()
    {
        nint user = GetModuleHandleW("user32.dll");
        return user != 0 && NativeLibrary.TryGetExport(user, "IsWindowArranged", out nint address)
            ? Marshal.GetDelegateForFunctionPointer<Arranged>(address) : null;
    }
    internal void Start(int newGeneration)
    {
        Stop(); generation = newGeneration; sequence = 0;
        if (!fixture && GetSystemMetrics(SM_REMOTESESSION) != 0) throw new InvalidOperationException("remote-session-unsupported");
        if (!fixture) EnumWindows((window, _) => { Remember(window); return true; }, 0);
        nint module = GetModuleHandleW(null);
        mouseHook = SetWindowsHookExW(WH_MOUSE_LL, mouseCallback, module, 0);
        keyHook = SetWindowsHookExW(WH_KEYBOARD_LL, keyCallback, module, 0);
        foreach ((uint min, uint max) in new[] {
            (EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE),
            (EVENT_SYSTEM_MOVESIZESTART, EVENT_SYSTEM_MOVESIZEEND),
            (EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND),
            (EVENT_OBJECT_DESTROY, EVENT_OBJECT_DESTROY) })
        {
            nint hook = SetWinEventHook(min, max, 0, eventCallback, 0, 0, 0);
            if (hook != 0) eventHooks.Add(hook);
        }
        if (!Active) { Stop(); throw new InvalidOperationException("hook-init-failed"); }
    }
    internal void Stop()
    {
        bool released = true;
        if (mouseHook != 0) released &= UnhookWindowsHookEx(mouseHook);
        if (keyHook != 0) released &= UnhookWindowsHookEx(keyHook);
        foreach (nint hook in eventHooks) released &= UnhookWinEvent(hook);
        mouseHook = keyHook = 0; eventHooks.Clear(); states.Clear(); moving.Clear(); input = null;
        lastCaption = 0; lastCaptionAt = NoCaptionClickAt;
        if (!released) throw new InvalidOperationException("hook-release-failed");
    }
    private State? Read(nint window, State? cached = null)
    {
        if (window == 0 || GetAncestor(window, GA_ROOT) != window || !IsWindowVisible(window)) return null;
        GetWindowThreadProcessId(window, out uint pid);
        string app;
        if (cached is not null && cached.Process == pid) app = cached.App;
        else
        {
            try { using var process = Process.GetProcessById((int)pid); app = process.ProcessName.ToLowerInvariant(); }
            catch { return null; }
            if (app is not ("chrome" or "obsidian" or "code" or "chatgpt")) return null;
            if (!OrdinaryProcess(pid)) return null;
        }
        var placement = new Placement { Length = (uint)Marshal.SizeOf<Placement>() };
        if (!GetWindowPlacement(window, ref placement)) return null;
        return new State(pid, app, placement.Show, isArranged is null ? null : isArranged(window) != 0);
    }
    private static bool OrdinaryProcess(uint pid)
    {
        nint process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid), token = 0;
        if (process == 0) return false;
        try { return OpenProcessToken(process, TOKEN_QUERY, out token) &&
            GetTokenInformation(token, TokenElevation, out int elevated, sizeof(int), out uint size) && size == sizeof(int) && elevated == 0; }
        finally { if (token != 0) CloseHandle(token); CloseHandle(process); }
    }
    private void Remember(nint window)
    {
        states.TryGetValue(window, out State? cached);
        State? state = Read(window, cached);
        if (state is not null) states[window] = state;
    }
    private nint OnMouse(int code, nint message, nint data)
    {
        try
        {
            if (code < 0 || fixture || !Active) return CallNextHookEx(0, code, message, data);
            if (message != WM_LBUTTONDOWN)
            {
                if (message is WM_RBUTTONDOWN or WM_MBUTTONDOWN or WM_MOUSEWHEEL) input = null;
                return CallNextHookEx(0, code, message, data);
            }
            var mouse = Marshal.PtrToStructure<MouseData>(data);
            nint target = GetAncestor(WindowFromPoint(mouse.Point), GA_ROOT);
            if (!states.TryGetValue(target, out State? cached)) { input = null; return CallNextHookEx(0, code, message, data); }
            State? before = Read(target, cached);
            if (before is null) { input = null; return CallNextHookEx(0, code, message, data); }
            states[target] = before;
            long packed = (uint)((mouse.Point.Y & 0xffff) << 16) | (uint)(mouse.Point.X & 0xffff);
            int hit = -1;
            if (SendMessageTimeoutW(target, WM_NCHITTEST, 0, (nint)packed, SMTO_ABORTIFHUNG, HitTestTimeoutMs, out nuint result) != 0) hit = unchecked((int)result);
            long now = clock.ElapsedMilliseconds;
            string route = hit == HTMAXBUTTON ? "max-button" : "unknown";
            if (hit == HTCAPTION && lastCaption == target && now - lastCaptionAt <= GetDoubleClickTime() &&
                Math.Abs(mouse.Point.X - lastCaptionPoint.X) <= CaptionDoubleClickDistancePx &&
                Math.Abs(mouse.Point.Y - lastCaptionPoint.Y) <= CaptionDoubleClickDistancePx)
                route = "caption-double-click";
            lastCaption = hit == HTCAPTION ? target : 0; lastCaptionAt = now; lastCaptionPoint = mouse.Point;
            input = new Input(target, before, route == "unknown" ? "unknown" : "mouse", route, now,
                (mouse.Flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED)) != 0,
                GetAsyncKeyState(VK_SHIFT) < 0 || GetAsyncKeyState(VK_CONTROL) < 0 ||
                GetAsyncKeyState(VK_MENU) < 0 || GetAsyncKeyState(VK_LWIN) < 0 || GetAsyncKeyState(VK_RWIN) < 0,
                GetForegroundWindow() == target);
        }
        catch { input = null; }
        return CallNextHookEx(0, code, message, data);
    }
    private nint OnKey(int code, nint message, nint data)
    {
        try
        {
            if (code < 0 || fixture || !Active || (message != WM_KEYDOWN && message != WM_SYSKEYDOWN)) return CallNextHookEx(0, code, message, data);
            var key = Marshal.PtrToStructure<KeyData>(data);
            bool modifier = key.Key is VK_LWIN or VK_RWIN or VK_SHIFT or VK_CONTROL or VK_MENU or
                VK_LSHIFT or VK_RSHIFT or VK_LCONTROL or VK_RCONTROL or VK_LMENU or VK_RMENU;
            nint target = GetForegroundWindow();
            bool conflict = input is not null && input.Origin == "mouse" && clock.ElapsedMilliseconds - input.At <= InputMatchWindowMs;
            if (modifier) { if (input is not null) input = input with { Conflicted = true }; return CallNextHookEx(0, code, message, data); }
            if (key.Key != VK_UP || (GetAsyncKeyState(VK_LWIN) >= 0 && GetAsyncKeyState(VK_RWIN) >= 0) ||
                GetAsyncKeyState(VK_SHIFT) < 0 || GetAsyncKeyState(VK_CONTROL) < 0 || GetAsyncKeyState(VK_MENU) < 0 ||
                !states.TryGetValue(target, out State? cached)) { input = null; return CallNextHookEx(0, code, message, data); }
            State? before = Read(target, cached);
            if (before is null) { input = null; return CallNextHookEx(0, code, message, data); }
            states[target] = before;
            input = new Input(target, before, "key", "win-up", clock.ElapsedMilliseconds,
                (key.Flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0, conflict, true);
        }
        catch { input = null; }
        return CallNextHookEx(0, code, message, data);
    }
    private void OnEvent(nint hook, uint kind, nint window, int obj, int child, uint thread, uint time)
    {
        if (fixture || !Active || window == 0) return;
        try
        {
            if (kind == EVENT_OBJECT_DESTROY && obj == OBJID_WINDOW && child == CHILDID_SELF) { states.Remove(window); moving.Remove(window); if (input?.Window == window) input = null; return; }
            if (kind == EVENT_SYSTEM_MOVESIZESTART) { moving.Add(window); if (input?.Window == window) input = input with { Conflicted = true }; return; }
            if (kind == EVENT_SYSTEM_MOVESIZEEND) { moving.Remove(window); Remember(window); if (input?.Window == window) input = null; return; }
            if (kind != EVENT_SYSTEM_FOREGROUND && (obj != OBJID_WINDOW || child != CHILDID_SELF)) return;
            states.TryGetValue(window, out State? previous);
            State? after = Read(window, previous);
            if (after is null) return;
            states[window] = after;
            if (previous is null || previous.Show != SW_SHOWNORMAL || after.Show != SW_SHOWMAXIMIZED) return;
            Input? candidate = input?.Window == window ? input : null;
            long age = candidate is null ? -1 : clock.ElapsedMilliseconds - candidate.At;
            bool recent = age >= 0 && age <= InputMatchWindowMs;
            State before = recent && candidate is not null ? candidate.Before : previous;
            emit(new { type = "candidate", protocolVersion = 1, generation, sequence = ++sequence,
                app = after.App, operation = "maximize", date = DateTime.Now.ToString("yyyy-MM-dd"),
                before = new { state = before.Show == SW_SHOWNORMAL ? "normal" : "other", arranged = before.Arranged },
                after = new { state = "maximized" }, origin = recent ? candidate!.Origin : "unknown",
                route = recent ? candidate!.Route : "unknown", injected = candidate?.Injected ?? false,
                conflicted = candidate?.Conflicted ?? false, moving = moving.Contains(window), elevated = false,
                targetMatched = recent && candidate!.Matched && GetForegroundWindow() == window,
                inputAgeMs = age, monitor = DisplayContext.Bounds(window) });
            if (input?.Window == window) input = null;
        }
        catch { input = null; }
    }
    public void Dispose() { Stop(); GC.KeepAlive(mouseCallback); GC.KeepAlive(keyCallback); GC.KeepAlive(eventCallback); }
}
