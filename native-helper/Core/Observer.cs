using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using static NativeMethods;
using Point = NativeMethods.Point;

internal sealed class Observer : IDisposable
{
    private const uint HitTestTimeoutMs = 10;
    private readonly CandidateProtocol protocol;
    private readonly bool fixture;
    private readonly Action<WindowDiagnosticReason>? windowDiagnostic;
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private readonly Dictionary<nint, WindowState> states = new();
    private readonly CandidateTracker tracker = new();
    private readonly TaskbarInputObserver taskbar;
    private readonly WindowSwitchObserver switching;
    private readonly WindowCloseObserver closing;
    // Native側がcallbackを呼ぶ間、解除までdelegateをGCから保護する。
    private readonly InputHook mouseCallback, keyCallback;
    private readonly EventHook eventCallback;
    private readonly List<nint> eventHooks = new();
    private nint mouseHook, keyHook;
    private int epoch;
    private static readonly Arranged? isArranged = LoadArranged();

    internal Observer(Action<object> emit, bool fixture = false, Action<CloseReason>? closeDiagnostic = null,
        Action<WindowDiagnosticReason>? windowDiagnostic = null)
    {
        protocol = new CandidateProtocol(emit); this.fixture = fixture; this.windowDiagnostic = windowDiagnostic;
        taskbar = new(protocol, tracker.NextTransaction, () => clock.ElapsedMilliseconds);
        switching = new(protocol, tracker.NextTransaction, () => clock.ElapsedMilliseconds);
        closing = new(protocol, tracker.NextTransaction, () => clock.ElapsedMilliseconds, closeDiagnostic);
        mouseCallback = OnMouse; keyCallback = OnKey; eventCallback = OnEvent;
    }
    internal bool Active => mouseHook != 0 && keyHook != 0 && eventHooks.Count == 5;
    internal void InvalidateDisplay() { tracker.ClearInput(); closing.Cancel(); }
    internal static bool ArrangedAvailable => isArranged is not null;
    internal static string ForegroundToken => GetForegroundWindow().ToString();
    private static Arranged? LoadArranged()
    {
        nint user = GetModuleHandleW("user32.dll");
        return user != 0 && NativeLibrary.TryGetExport(user, "IsWindowArranged", out nint address)
            ? Marshal.GetDelegateForFunctionPointer<Arranged>(address) : null;
    }
    internal void Start(int newGeneration, int protocolVersion = 2)
    {
        Stop(); tracker.Reset(newGeneration);
        epoch = newGeneration;
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
            (EVENT_OBJECT_CREATE, EVENT_OBJECT_HIDE),
            (EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND) })
        {
            nint hook = SetWinEventHook(min, max, 0, eventCallback, 0, 0, 0);
            if (hook != 0) eventHooks.Add(hook);
        }
        if (!Active) { Stop(); throw new InvalidOperationException("hook-init-failed"); }
        if (!fixture) { taskbar.Start(newGeneration); switching.Start(newGeneration); closing.Start(newGeneration); }
    }
    internal void Stop()
    {
        protocol.Stop();
        taskbar.Stop();
        switching.Stop();
        closing.Stop();
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
        if (window == GetDesktopWindow() || window == GetShellWindow()) return null;
        if (GetWindowThreadProcessId(window, out uint pid) == 0) return null;
        var cls = new StringBuilder(256);
        string? windowClass = GetClassNameW(window, cls, cls.Capacity) > 0 ? cls.ToString() : null;
        bool? cloaked = DwmGetWindowAttribute(window, DWMWA_CLOAKED, out int cloak, sizeof(int)) == 0 ? cloak != 0 : null;
        if (!WindowTargetPolicy.Allows(pid, (uint)Environment.ProcessId, GetWindowStyle(window, GWL_STYLE).ToInt64(),
            GetWindowStyle(window, -20).ToInt64(), GetWindow(window, 4) != 0, cloaked, windowClass, OrdinaryProcess(pid))) return null;
        var placement = new Placement { Length = (uint)Marshal.SizeOf<Placement>() };
        if (!GetWindowPlacement(window, ref placement)) return null;
        var info = new MonitorInfo { Size = (uint)Marshal.SizeOf<MonitorInfo>() };
        bool workKnown = GetMonitorInfoW(MonitorFromWindow(window, MONITOR_DEFAULTTONULL), ref info);
        bool frameKnown = DwmGetWindowAttribute(window, DWMWA_EXTENDED_FRAME_BOUNDS, out Rect frame,
            (uint)Marshal.SizeOf<Rect>()) == 0;
        static MonitorBounds Bounds(Rect r) => new(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
        return new WindowState(pid, WindowTargetPolicy.ApplicationCategory, placement.Show, isArranged is null ? null : isArranged(window) != 0,
            DisplayContext.Monitor(window), DisplayContext.HorizontalPair(), DisplayContext.Layout(),
            frameKnown ? Bounds(frame) : null, workKnown ? Bounds(info.Work) : null, GetDpiForWindow(window));
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
            var taskbarMouse = Marshal.PtrToStructure<MouseData>(data);
            taskbar.Mouse(message, taskbarMouse.Point, taskbarMouse.Flags);
            switching.Mouse(message, taskbarMouse.Point, taskbarMouse.Flags, taskbarMouse.Time);
            closing.Mouse(message, taskbarMouse.Point, taskbarMouse.Flags, taskbarMouse.Time);
            if (message != WM_LBUTTONDOWN)
            {
                if (message == WM_LBUTTONUP)
                {
                    windowDiagnostic?.Invoke(WindowDiagnosticReason.MouseUp);
                    var info = new MonitorInfo { Size = (uint)Marshal.SizeOf<MonitorInfo>() };
                    bool known = GetMonitorInfoW(MonitorFromPoint(taskbarMouse.Point, MONITOR_DEFAULTTONULL), ref info);
                    static MonitorBounds Bounds(Rect r) => new(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
                    tracker.MouseReleased(taskbarMouse.Point, known ? Bounds(info.Monitor) : null,
                        known ? Bounds(info.Work) : null, taskbarMouse.Flags);
                }
                if (message is WM_RBUTTONDOWN or WM_MBUTTONDOWN or WM_MOUSEWHEEL) tracker.ClearInput();
                return CallNextHookEx(0, code, message, data);
            }
            var mouse = Marshal.PtrToStructure<MouseData>(data);
            windowDiagnostic?.Invoke(WindowDiagnosticReason.MouseDown);
            nint target = GetAncestor(WindowFromPoint(mouse.Point), GA_ROOT);
            if (!states.TryGetValue(target, out WindowState? cached)) { windowDiagnostic?.Invoke(WindowDiagnosticReason.TargetMissing); tracker.ClearInput(); return CallNextHookEx(0, code, message, data); }
            WindowState? before = Read(target, cached);
            if (before is null) { windowDiagnostic?.Invoke(WindowDiagnosticReason.TargetRejected); tracker.ClearInput(); return CallNextHookEx(0, code, message, data); }
            states[target] = before;
            long packed = (uint)((mouse.Point.Y & 0xffff) << 16) | (uint)(mouse.Point.X & 0xffff);
            int hit = -1;
            if (SendMessageTimeoutW(target, WM_NCHITTEST, 0, (nint)packed, SMTO_ABORTIFHUNG, HitTestTimeoutMs, out nuint result) != 0) hit = unchecked((int)result);
            windowDiagnostic?.Invoke(hit == HTCAPTION ? WindowDiagnosticReason.RawCaption : hit == 1 ? WindowDiagnosticReason.RawClient :
                hit is HTMINBUTTON or HTMAXBUTTON or HTCLOSE ? WindowDiagnosticReason.RawButton : WindowDiagnosticReason.RawOther);
            bool rootCaptionRead = false;
            if (GetWindowRect(target, out Rect rect) && WindowCaption.Read(target, out TitleInfo title))
            {
                rootCaptionRead = true;
                windowDiagnostic?.Invoke(WindowDiagnosticReason.TitleReadOk);
                windowDiagnostic?.Invoke(SnapGeometry.Contains(title.Bar, mouse.Point) ? WindowDiagnosticReason.TitleContainsPoint : WindowDiagnosticReason.TitleOutsidePoint);
                hit = WindowCaption.Hit(title, rect, mouse.Point, hit);
            }
            else windowDiagnostic?.Invoke(WindowDiagnosticReason.TitleReadFail);
            if (hit == 1 && rootCaptionRead || windowDiagnostic is not null)
            {
                nint hitWindow = WindowFromPhysicalPoint(mouse.Point);
                if (hitWindow == target) windowDiagnostic?.Invoke(WindowDiagnosticReason.HitRoot);
                else if (hitWindow == 0 || GetAncestor(hitWindow, GA_ROOT) != target ||
                    GetWindowThreadProcessId(hitWindow, out uint childProcess) == 0 || childProcess != before.Process)
                    windowDiagnostic?.Invoke(WindowDiagnosticReason.HitChildUnmatched);
                else
                {
                    int childHit = -1;
                    bool known = SendMessageTimeoutW(hitWindow, WM_NCHITTEST, 0, (nint)packed, SMTO_ABORTIFHUNG, HitTestTimeoutMs, out nuint value) != 0;
                    if (known) childHit = unchecked((int)value);
                    // Revalidate after the bounded cross-window query; never use another process or a reparented child.
                    bool sameRoot = GetAncestor(hitWindow, GA_ROOT) == target;
                    bool sameProcess = GetWindowThreadProcessId(hitWindow, out uint checkedProcess) != 0 && checkedProcess == before.Process;
                    if (sameRoot && sameProcess)
                    {
                        windowDiagnostic?.Invoke(WindowDiagnosticReason.HitChildSameProcess);
                        if (known) windowDiagnostic?.Invoke(childHit == HTCAPTION ? WindowDiagnosticReason.ChildCaption : childHit == 1 ? WindowDiagnosticReason.ChildClient : WindowDiagnosticReason.ChildOther);
                        else windowDiagnostic?.Invoke(WindowDiagnosticReason.ChildHitFailed);
                        if (windowDiagnostic is not null)
                        {
                            if (WindowCaption.Read(hitWindow, out TitleInfo childTitle))
                                windowDiagnostic(SnapGeometry.Contains(childTitle.Bar, mouse.Point) ? WindowDiagnosticReason.ChildTitleContainsPoint : WindowDiagnosticReason.ChildTitleOutsidePoint);
                            else windowDiagnostic(WindowDiagnosticReason.ChildTitleReadFail);
                        }
                    }
                    else windowDiagnostic?.Invoke(WindowDiagnosticReason.HitChildUnmatched);
                    if (rootCaptionRead) hit = WindowCaption.ResolveChildCaption(hit, childHit, sameRoot, sameProcess);
                }
            }
            windowDiagnostic?.Invoke(hit == HTCAPTION ? WindowDiagnosticReason.FinalCaption : hit is HTMINBUTTON or HTMAXBUTTON or HTCLOSE ? WindowDiagnosticReason.FinalButton : WindowDiagnosticReason.FinalOther);
            windowDiagnostic?.Invoke(GetForegroundWindow() == target ? WindowDiagnosticReason.ForegroundMatched : WindowDiagnosticReason.ForegroundOther);
            tracker.Mouse(target, before, hit, mouse.Point, clock.ElapsedMilliseconds, GetDoubleClickTime(), mouse.Flags,
                GetAsyncKeyState(VK_SHIFT) < 0 || GetAsyncKeyState(VK_CONTROL) < 0 ||
                GetAsyncKeyState(VK_MENU) < 0 || GetAsyncKeyState(VK_LWIN) < 0 || GetAsyncKeyState(VK_RWIN) < 0,
                GetForegroundWindow() == target);
        }
        catch { tracker.ClearInput(); switching.Cancel(); closing.Cancel(); }
        return CallNextHookEx(0, code, message, data);
    }
    private nint OnKey(int code, nint message, nint data)
    {
        try
        {
            if (code < 0 || fixture || !Active) return CallNextHookEx(0, code, message, data);
            var key = Marshal.PtrToStructure<KeyData>(data);
            bool down = message == WM_KEYDOWN || message == WM_SYSKEYDOWN;
            taskbar.Key(key.Key, down, key.Flags);
            switching.Key(key.Key, down, key.Flags, key.Time);
            closing.Key(key.Key, down, key.Flags, key.Time);
            // Win+digit belongs to W12, including unknown mappings. Never reuse it as window input.
            if (key.Key is >= 0x30 and <= 0x39 && (GetAsyncKeyState(VK_LWIN) < 0 || GetAsyncKeyState(VK_RWIN) < 0))
            { tracker.ClearInput(); return CallNextHookEx(0, code, message, data); }
            if (!down) {
                if ((key.Flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0) tracker.ClearInput();
                tracker.KeyReleased(key.Key);
                if (key.Key is VK_LWIN or VK_RWIN or VK_LEFT or VK_RIGHT) {
                    nint releasedTarget = GetForegroundWindow();
                    states.TryGetValue(releasedTarget, out WindowState? releasedCached);
                    var result = tracker.FinishKey(releasedTarget, Read(releasedTarget, releasedCached), clock.ElapsedMilliseconds,
                        (key.Flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0, DateTime.Now.ToString("yyyy-MM-dd"));
                    if (result is PlacementResult placed) protocol.Placement(epoch, DateTime.Now.ToString("yyyy-MM-dd"), placed);
                    if (result is WindowCandidate maximized) protocol.Complete(maximized);
                }
                return CallNextHookEx(0, code, message, data);
            }
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
        catch { tracker.ClearInput(); switching.Cancel(); closing.Cancel(); }
        return CallNextHookEx(0, code, message, data);
    }
    private void OnEvent(nint hook, uint kind, nint window, int obj, int child, uint thread, uint time)
    {
        if (fixture || !Active || window == 0) return;
        try
        {
            closing.Event(kind, window, obj, child, thread, time);
            if (kind == EVENT_SYSTEM_FOREGROUND) { tracker.ForegroundChanged(window); switching.Foreground(window, time); }
            if (kind == EVENT_OBJECT_DESTROY && obj == OBJID_WINDOW && child == CHILDID_SELF)
            {
                tracker.Forget(window);
                states.Remove(window);
                return;
            }
            if (kind == EVENT_SYSTEM_MOVESIZESTART) { windowDiagnostic?.Invoke(WindowDiagnosticReason.MoveStart); switching.Cancel(); tracker.MoveStart(window, clock.ElapsedMilliseconds); return; }
            if (kind == EVENT_SYSTEM_MOVESIZEEND)
            {
                windowDiagnostic?.Invoke(WindowDiagnosticReason.MoveEnd);
                states.TryGetValue(window, out WindowState? cached);
                WindowState? end = Read(window, cached);
                object? result = tracker.FinishMove(window, end, clock.ElapsedMilliseconds, GetForegroundWindow(), DateTime.Now.ToString("yyyy-MM-dd"));
                if (end is not null) states[window] = end;
                if (result is WindowCandidate evidence) protocol.Complete(evidence);
                if (result is PlacementResult placement) protocol.Placement(epoch, DateTime.Now.ToString("yyyy-MM-dd"), placement);
                if (result is CompoundMoveResult compound) protocol.Compound(epoch, DateTime.Now.ToString("yyyy-MM-dd"), compound);
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
        catch { tracker.ClearInput(); switching.Cancel(); closing.Cancel(); }
    }
    public void Dispose() { Stop(); taskbar.Dispose(); switching.Dispose(); closing.Dispose(); GC.KeepAlive(mouseCallback); GC.KeepAlive(keyCallback); GC.KeepAlive(eventCallback); }
}
