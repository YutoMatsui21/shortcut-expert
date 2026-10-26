using System.Diagnostics;
using System.Runtime.InteropServices;
using static NativeMethods;
using Point = NativeMethods.Point;

internal sealed class Observer : IDisposable
{
    private const uint HitTestTimeoutMs = 10;
    private readonly CandidateProtocol protocol;
    private readonly bool fixture;
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private readonly Dictionary<nint, WindowState> states = new();
    private readonly CandidateTracker tracker = new();
    private readonly SnapInvocationObserver snap;
    private readonly TaskbarInputObserver taskbar;
    private readonly WindowSwitchObserver switching;
    // Native側がcallbackを呼ぶ間、解除までdelegateをGCから保護する。
    private readonly InputHook mouseCallback, keyCallback;
    private readonly EventHook eventCallback;
    private readonly List<nint> eventHooks = new();
    private nint mouseHook, keyHook;
    private static readonly Arranged? isArranged = LoadArranged();

    internal Observer(Action<object> emit, bool fixture = false)
    {
        protocol = new CandidateProtocol(emit); this.fixture = fixture;
        snap = new(protocol, tracker.NextTransaction, () => clock.ElapsedMilliseconds);
        taskbar = new(protocol, tracker.NextTransaction, () => clock.ElapsedMilliseconds);
        switching = new(protocol, tracker.NextTransaction, () => clock.ElapsedMilliseconds);
        mouseCallback = OnMouse; keyCallback = OnKey; eventCallback = OnEvent;
    }
    internal bool Active => mouseHook != 0 && keyHook != 0 && eventHooks.Count == 5;
    internal static bool ArrangedAvailable => isArranged is not null;
    internal static string ForegroundToken => GetForegroundWindow().ToString();
    private static Arranged? LoadArranged()
    {
        nint user = GetModuleHandleW("user32.dll");
        return user != 0 && NativeLibrary.TryGetExport(user, "IsWindowArranged", out nint address)
            ? Marshal.GetDelegateForFunctionPointer<Arranged>(address) : null;
    }
    internal void Start(int newGeneration, int protocolVersion = 1)
    {
        Stop(); tracker.Reset(newGeneration);
        protocol.Start(newGeneration, protocolVersion);
        if (!fixture && GetSystemMetrics(SM_REMOTESESSION) != 0) throw new InvalidOperationException("remote-session-unsupported");
        if (!fixture) EnumWindows((window, _) => { Remember(window); return true; }, 0);
        nint module = GetModuleHandleW(null);
        mouseHook = SetWindowsHookExW(WH_MOUSE_LL, mouseCallback, module, 0);
        keyHook = SetWindowsHookExW(WH_KEYBOARD_LL, keyCallback, module, 0);
        foreach ((uint min, uint max) in new[] {
            (EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE),
            (EVENT_SYSTEM_MOVESIZESTART, EVENT_SYSTEM_MOVESIZEEND),
            (EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND),
            (EVENT_OBJECT_DESTROY, EVENT_OBJECT_DESTROY),
            (EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND) })
        {
            nint hook = SetWinEventHook(min, max, 0, eventCallback, 0, 0, 0);
            if (hook != 0) eventHooks.Add(hook);
        }
        if (!Active) { Stop(); throw new InvalidOperationException("hook-init-failed"); }
        if (!fixture && protocolVersion == 2) { snap.Start(newGeneration); taskbar.Start(newGeneration); switching.Start(newGeneration); }
    }
    internal void Stop()
    {
        protocol.Stop();
        snap.Stop();
        taskbar.Stop();
        switching.Stop();
        bool released = true;
        if (mouseHook != 0) released &= UnhookWindowsHookEx(mouseHook);
        if (keyHook != 0) released &= UnhookWindowsHookEx(keyHook);
        foreach (nint hook in eventHooks) released &= UnhookWinEvent(hook);
        mouseHook = keyHook = 0; eventHooks.Clear(); states.Clear(); tracker.Reset(0);
        if (!released) throw new InvalidOperationException("hook-release-failed");
    }
    private WindowState? Read(nint window, WindowState? cached = null)
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
        return new WindowState(pid, app, placement.Show, isArranged is null ? null : isArranged(window) != 0,
            DisplayContext.Monitor(window), DisplayContext.HorizontalPair(), DisplayContext.Layout());
    }
    internal static bool OrdinaryProcess(uint pid)
    {
        nint process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid), token = 0;
        if (process == 0) return false;
        try { return OpenProcessToken(process, TOKEN_QUERY, out token) &&
            GetTokenInformation(token, TokenElevation, out int elevated, sizeof(int), out uint size) && size == sizeof(int) && elevated == 0; }
        finally { if (token != 0) CloseHandle(token); CloseHandle(process); }
    }
    private void Remember(nint window)
    {
        states.TryGetValue(window, out WindowState? cached);
        WindowState? state = Read(window, cached);
        if (state is not null) states[window] = state;
    }
    private nint OnMouse(int code, nint message, nint data)
    {
        try
        {
            if (code < 0 || fixture || !Active) return CallNextHookEx(0, code, message, data);
            snap.Mouse(message, Marshal.PtrToStructure<MouseData>(data).Flags);
            var taskbarMouse = Marshal.PtrToStructure<MouseData>(data);
            taskbar.Mouse(message, taskbarMouse.Point, taskbarMouse.Flags);
            switching.Mouse(message, taskbarMouse.Point, taskbarMouse.Flags);
            if (message != WM_LBUTTONDOWN)
            {
                if (message is WM_RBUTTONDOWN or WM_MBUTTONDOWN or WM_MOUSEWHEEL) tracker.ClearInput();
                return CallNextHookEx(0, code, message, data);
            }
            var mouse = Marshal.PtrToStructure<MouseData>(data);
            nint target = GetAncestor(WindowFromPoint(mouse.Point), GA_ROOT);
            if (!states.TryGetValue(target, out WindowState? cached)) { tracker.ClearInput(); return CallNextHookEx(0, code, message, data); }
            WindowState? before = Read(target, cached);
            if (before is null) { tracker.ClearInput(); return CallNextHookEx(0, code, message, data); }
            states[target] = before;
            long packed = (uint)((mouse.Point.Y & 0xffff) << 16) | (uint)(mouse.Point.X & 0xffff);
            int hit = -1;
            if (SendMessageTimeoutW(target, WM_NCHITTEST, 0, (nint)packed, SMTO_ABORTIFHUNG, HitTestTimeoutMs, out nuint result) != 0) hit = unchecked((int)result);
            tracker.Mouse(target, before, hit, mouse.Point, clock.ElapsedMilliseconds, GetDoubleClickTime(), mouse.Flags,
                GetAsyncKeyState(VK_SHIFT) < 0 || GetAsyncKeyState(VK_CONTROL) < 0 ||
                GetAsyncKeyState(VK_MENU) < 0 || GetAsyncKeyState(VK_LWIN) < 0 || GetAsyncKeyState(VK_RWIN) < 0,
                GetForegroundWindow() == target);
        }
        catch { tracker.ClearInput(); switching.Cancel(); }
        return CallNextHookEx(0, code, message, data);
    }
    private nint OnKey(int code, nint message, nint data)
    {
        try
        {
            if (code < 0 || fixture || !Active) return CallNextHookEx(0, code, message, data);
            var key = Marshal.PtrToStructure<KeyData>(data);
            bool down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
            snap.Key(key.Key, down, key.Flags);
            taskbar.Key(key.Key, down, key.Flags);
            switching.Key(key.Key, down, key.Flags);
            // Win+digit belongs to W12, including unknown mappings. Never reuse it as window input.
            if (key.Key is >= 0x30 and <= 0x39 && (GetAsyncKeyState(VK_LWIN) < 0 || GetAsyncKeyState(VK_RWIN) < 0))
            { tracker.ClearInput(); return CallNextHookEx(0, code, message, data); }
            if (!down) return CallNextHookEx(0, code, message, data);
            nint target = GetForegroundWindow();
            if (CandidateTracker.IsModifier(key.Key))
            {
                tracker.Key(target, null, key.Key, false, false, clock.ElapsedMilliseconds, key.Flags);
                return CallNextHookEx(0, code, message, data);
            }
            bool win = GetAsyncKeyState(VK_LWIN) < 0 || GetAsyncKeyState(VK_RWIN) < 0;
            bool shift = GetAsyncKeyState(VK_SHIFT) < 0, alt = GetAsyncKeyState(VK_MENU) < 0;
            bool modifiers = GetAsyncKeyState(VK_CONTROL) < 0;
            WindowState? before = null;
            if (CandidateTracker.KeyRoute(key.Key, win, shift, alt, modifiers) is not null && states.TryGetValue(target, out WindowState? cached))
            {
                before = Read(target, cached);
                if (before is not null) states[target] = before;
            }
            tracker.Key(target, before, key.Key, win, modifiers, clock.ElapsedMilliseconds, key.Flags, shift, alt);
        }
        catch { tracker.ClearInput(); switching.Cancel(); }
        return CallNextHookEx(0, code, message, data);
    }
    private void OnEvent(nint hook, uint kind, nint window, int obj, int child, uint thread, uint time)
    {
        if (fixture || !Active || window == 0) return;
        try
        {
            if (kind == EVENT_SYSTEM_FOREGROUND) switching.Foreground(window, time);
            if (kind == EVENT_OBJECT_DESTROY && obj == OBJID_WINDOW && child == CHILDID_SELF)
            {
                states.TryGetValue(window, out WindowState? closed);
                object? result = tracker.Close(window, closed, clock.ElapsedMilliseconds, DateTime.Now.ToString("yyyy-MM-dd"));
                states.Remove(window);
                if (result is WindowCandidate evidence) protocol.Complete(evidence);
                return;
            }
            if (kind == EVENT_SYSTEM_MOVESIZESTART) { switching.Cancel(); tracker.MoveStart(window, clock.ElapsedMilliseconds); return; }
            if (kind == EVENT_SYSTEM_MOVESIZEEND)
            {
                states.TryGetValue(window, out WindowState? cached);
                WindowState? end = Read(window, cached);
                object? result = tracker.FinishMove(window, end, clock.ElapsedMilliseconds, GetForegroundWindow(), DateTime.Now.ToString("yyyy-MM-dd"));
                if (end is not null) states[window] = end;
                if (result is WindowCandidate evidence) protocol.Complete(evidence);
                return;
            }
            if (kind is not (EVENT_SYSTEM_FOREGROUND or EVENT_SYSTEM_MINIMIZESTART or EVENT_SYSTEM_MINIMIZEEND) &&
                (obj != OBJID_WINDOW || child != CHILDID_SELF)) return;
            states.TryGetValue(window, out WindowState? previous);
            WindowState? after = Read(window, previous);
            if (after is null) { tracker.Forget(window); return; }
            states[window] = after;
            object? candidate = tracker.Complete(window, previous, after, clock.ElapsedMilliseconds,
                GetForegroundWindow(), DateTime.Now.ToString("yyyy-MM-dd"), DisplayContext.Bounds(window));
            if (candidate is WindowCandidate evidenceResult) protocol.Complete(evidenceResult);
        }
        catch { tracker.ClearInput(); switching.Cancel(); }
    }
    public void Dispose() { Stop(); snap.Dispose(); taskbar.Dispose(); switching.Dispose(); GC.KeepAlive(mouseCallback); GC.KeepAlive(keyCallback); GC.KeepAlive(eventCallback); }
}
