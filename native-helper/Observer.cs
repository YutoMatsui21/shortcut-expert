using System.Diagnostics;
using System.Runtime.InteropServices;
using static NativeMethods;
using Point = NativeMethods.Point;

internal sealed class Observer : IDisposable
{
    private sealed record State(uint Process, string App, uint Show, bool? Arranged);
    private sealed record Input(nint Window, State Before, string Origin, string Route, long At, bool Injected, bool Conflicted, bool Matched);
    private readonly Action<object> emit;
    private readonly bool fixture;
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private readonly Dictionary<nint, State> states = new();
    private readonly HashSet<nint> moving = new();
    private readonly InputHook mouseCallback, keyCallback;
    private readonly EventHook eventCallback;
    private readonly List<nint> eventHooks = new();
    private nint mouseHook, keyHook;
    private Input? input;
    private nint lastCaption;
    private long lastCaptionAt = -10000;
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
        if (!fixture && GetSystemMetrics(0x1000) != 0) throw new InvalidOperationException("remote-session-unsupported");
        if (!fixture) EnumWindows((window, _) => { Remember(window); return true; }, 0);
        nint module = GetModuleHandleW(null);
        mouseHook = SetWindowsHookExW(14, mouseCallback, module, 0);
        keyHook = SetWindowsHookExW(13, keyCallback, module, 0);
        foreach ((uint min, uint max) in new[] { (0x800Bu, 0x800Bu), (0x000Au, 0x000Bu), (0x0003u, 0x0003u), (0x8001u, 0x8001u) })
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
        lastCaption = 0; lastCaptionAt = -10000;
        if (!released) throw new InvalidOperationException("hook-release-failed");
    }
    private State? Read(nint window, State? cached = null)
    {
        if (window == 0 || GetAncestor(window, 2) != window || !IsWindowVisible(window)) return null;
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
        nint process = OpenProcess(0x1000, false, pid), token = 0;
        if (process == 0) return false;
        try { return OpenProcessToken(process, 0x8, out token) &&
            GetTokenInformation(token, 20, out int elevated, 4, out uint size) && size == 4 && elevated == 0; }
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
            if (message != 0x201) { if (message is 0x204 or 0x207 or 0x20A) input = null; return CallNextHookEx(0, code, message, data); }
            var mouse = Marshal.PtrToStructure<MouseData>(data);
            nint target = GetAncestor(WindowFromPoint(mouse.Point), 2);
            if (!states.TryGetValue(target, out State? cached)) { input = null; return CallNextHookEx(0, code, message, data); }
            State? before = Read(target, cached);
            if (before is null) { input = null; return CallNextHookEx(0, code, message, data); }
            states[target] = before;
            long packed = (uint)((mouse.Point.Y & 0xffff) << 16) | (uint)(mouse.Point.X & 0xffff);
            int hit = -1;
            if (SendMessageTimeoutW(target, 0x84, 0, (nint)packed, 2, 10, out nuint result) != 0) hit = unchecked((int)result);
            long now = clock.ElapsedMilliseconds;
            string route = hit == 9 ? "max-button" : "unknown";
            if (hit == 2 && lastCaption == target && now - lastCaptionAt <= GetDoubleClickTime() &&
                Math.Abs(mouse.Point.X - lastCaptionPoint.X) <= 4 && Math.Abs(mouse.Point.Y - lastCaptionPoint.Y) <= 4)
                route = "caption-double-click";
            lastCaption = hit == 2 ? target : 0; lastCaptionAt = now; lastCaptionPoint = mouse.Point;
            input = new Input(target, before, route == "unknown" ? "unknown" : "mouse", route, now,
                (mouse.Flags & 3) != 0, GetAsyncKeyState(0x10) < 0 || GetAsyncKeyState(0x11) < 0 ||
                GetAsyncKeyState(0x12) < 0 || GetAsyncKeyState(0x5B) < 0 || GetAsyncKeyState(0x5C) < 0,
                GetForegroundWindow() == target);
        }
        catch { input = null; }
        return CallNextHookEx(0, code, message, data);
    }
    private nint OnKey(int code, nint message, nint data)
    {
        try
        {
            if (code < 0 || fixture || !Active || (message != 0x100 && message != 0x104)) return CallNextHookEx(0, code, message, data);
            var key = Marshal.PtrToStructure<KeyData>(data);
            bool modifier = key.Key is 0x5B or 0x5C or 0x10 or 0x11 or 0x12 or 0xA0 or 0xA1 or 0xA2 or 0xA3 or 0xA4 or 0xA5;
            nint target = GetForegroundWindow();
            bool conflict = input is not null && input.Origin == "mouse" && clock.ElapsedMilliseconds - input.At <= 1000;
            if (modifier) { if (input is not null) input = input with { Conflicted = true }; return CallNextHookEx(0, code, message, data); }
            if (key.Key != 0x26 || (GetAsyncKeyState(0x5B) >= 0 && GetAsyncKeyState(0x5C) >= 0) ||
                GetAsyncKeyState(0x10) < 0 || GetAsyncKeyState(0x11) < 0 || GetAsyncKeyState(0x12) < 0 ||
                !states.TryGetValue(target, out State? cached)) { input = null; return CallNextHookEx(0, code, message, data); }
            State? before = Read(target, cached);
            if (before is null) { input = null; return CallNextHookEx(0, code, message, data); }
            states[target] = before;
            input = new Input(target, before, "key", "win-up", clock.ElapsedMilliseconds, (key.Flags & 0x12) != 0, conflict, true);
        }
        catch { input = null; }
        return CallNextHookEx(0, code, message, data);
    }
    private void OnEvent(nint hook, uint kind, nint window, int obj, int child, uint thread, uint time)
    {
        if (fixture || !Active || window == 0) return;
        try
        {
            if (kind == 0x8001 && obj == 0 && child == 0) { states.Remove(window); moving.Remove(window); if (input?.Window == window) input = null; return; }
            if (kind == 0xA) { moving.Add(window); if (input?.Window == window) input = input with { Conflicted = true }; return; }
            if (kind == 0xB) { moving.Remove(window); Remember(window); if (input?.Window == window) input = null; return; }
            if (kind != 3 && (obj != 0 || child != 0)) return;
            states.TryGetValue(window, out State? previous);
            State? after = Read(window, previous);
            if (after is null) return;
            states[window] = after;
            if (previous is null || previous.Show != 1 || after.Show != 3) return;
            Input? candidate = input?.Window == window ? input : null;
            long age = candidate is null ? -1 : clock.ElapsedMilliseconds - candidate.At;
            bool recent = age >= 0 && age <= 1000;
            State before = recent && candidate is not null ? candidate.Before : previous;
            emit(new { type = "candidate", protocolVersion = 1, generation, sequence = ++sequence,
                app = after.App, operation = "maximize", date = DateTime.Now.ToString("yyyy-MM-dd"),
                before = new { state = before.Show == 1 ? "normal" : "other", arranged = before.Arranged },
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
