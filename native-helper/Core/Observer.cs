using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using ShortcutExpert.Detection;
using static NativeMethods;
using Point = NativeMethods.Point;

internal sealed class Observer : IDisposable
{
    private readonly CaptionHitTest captionHit;
    private readonly CandidateSink protocol;
    private readonly bool fixture;
    private readonly Action<WindowDiagnosticReason>? windowDiagnostic;
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private readonly Dictionary<nint, WindowState> states = new();
    private readonly DetectionSession session = new();
    private readonly DisplayTopology displayTopology = new(DisplayTopology.Read);
    private readonly CandidateTracker tracker;
    private readonly CaptionClickResultAdapter independentCaption;
    private readonly DetectionRouter router = new();
    private readonly InactiveCaptionPolicy captionClick = new();

    private void CancelCaption()
    {
        captionClick.Cancel();
        independentCaption.Cancel();
    }

    private static bool CaptionModifiers() =>
        GetAsyncKeyState(VK_SHIFT) < 0
        || GetAsyncKeyState(VK_CONTROL) < 0
        || GetAsyncKeyState(VK_MENU) < 0
        || WinPressed();

    private readonly System.Windows.Forms.Timer maximizeTimer = new() { Interval = 50 };
    private readonly TaskbarInputObserver taskbar;
    private readonly WindowSwitchObserver switching;
    private readonly WindowCloseObserver closing;
    private readonly GestureManager closeGestures = new();

    // Native側がcallbackを呼ぶ間、解除までdelegateをGCから保護する。
    private readonly InputHook mouseCallback,
        keyCallback;
    private readonly EventHook eventCallback;
    private readonly List<nint> eventHooks = new();
    private static readonly (uint Min, uint Max)[] winEventRanges =
    [
        (EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE),
        // One out-of-context subscription preserves the order of equal-tick system events.
        (EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MINIMIZEEND),
        (EVENT_OBJECT_CREATE, EVENT_OBJECT_HIDE),
    ];
    private nint mouseHook,
        keyHook;
    private int epoch;
    private int? mouseDockThresholdPx;
    private static readonly Arranged? isArranged = LoadArranged();

    internal Observer(
        Action<object> emit,
        bool fixture = false,
        Action<CloseReason>? closeDiagnostic = null,
        Action<WindowDiagnosticReason>? windowDiagnostic = null
    )
    {
        protocol = new CandidateSink(emit);
        tracker = new(session);
        independentCaption = new WindowResultPipeline(session, protocol).Register(
            router,
            tracker,
            (target, value) => states[target] = value
        );
        this.fixture = fixture;
        this.windowDiagnostic = windowDiagnostic;
        captionHit = new(windowDiagnostic);
        tracker.Diagnostic = windowDiagnostic;
        captionClick.Diagnostic = windowDiagnostic;
        taskbar = new(
            TaskbarDetector.Register(
                router,
                session,
                protocol,
                () => clock.ElapsedMilliseconds,
                displayTopology.Capture
            ),
            () => clock.ElapsedMilliseconds
        );
        switching = new(
            new WindowSwitchDetector(
                session,
                protocol,
                router,
                NextTransaction,
                new(Diagnostic: windowDiagnostic)
            ),
            () => clock.ElapsedMilliseconds,
            windowDiagnostic,
            () => closeGestures.IsCloseInput(clock.ElapsedMilliseconds)
        );
        closing = new(
            new WindowCloseDetector(
                session,
                closeGestures,
                protocol,
                () => clock.ElapsedMilliseconds,
                diagnostic: closeDiagnostic
            ),
            () => clock.ElapsedMilliseconds,
            closeDiagnostic
        );
        new DedicatedInputAdapter(taskbar, switching).Register(router);
        closing.Register(router);
        mouseCallback = OnMouse;
        keyCallback = OnKey;
        eventCallback = (_, kind, window, obj, child, thread, time) =>
            OnEvent(new(kind, window, obj, child, thread, time));
        maximizeTimer.Tick += (_, _) => PollMaximize();
    }

    private int NextTransaction() => session.Allocator(epoch)();

    internal bool Active =>
        mouseHook != 0 && keyHook != 0 && eventHooks.Count == winEventRanges.Length;

    internal void NoteDisplayChange() => displayTopology.Changed();

    internal void InvalidateDisplay()
    {
        CancelCaption();
        tracker.ClearInput();
        maximizeTimer.Stop();
        closing.Cancel();
        router.Dispatch(
            new ObservedEvent(ObservedKind.DisplayInvalidated, epoch, 0, clock.ElapsedMilliseconds)
        );
        mouseDockThresholdPx = null;
    }

    internal void RefreshDockThreshold()
    {
        InvalidateDisplay();
        mouseDockThresholdPx =
            !fixture && Active ? WindowDockSettings.ReadMouseDockThreshold() : null;
    }

    internal static bool ArrangedAvailable => isArranged is not null;
    internal static string ForegroundToken => GetForegroundWindow().ToString();

    private static Arranged? LoadArranged()
    {
        nint user = GetModuleHandleW("user32.dll");
        return user != 0 && NativeLibrary.TryGetExport(user, "IsWindowArranged", out nint address)
            ? Marshal.GetDelegateForFunctionPointer<Arranged>(address)
            : null;
    }

    internal void Start(int newGeneration, int protocolVersion = 2)
    {
        Stop();
        session.Start(newGeneration);
        tracker.Reset(newGeneration);
        epoch = newGeneration;
        independentCaption.Start(newGeneration);
        router.Reset(newGeneration);
        protocol.Start(newGeneration, protocolVersion);
        if (!fixture && GetSystemMetrics(SM_REMOTESESSION) != 0)
            throw new InvalidOperationException("remote-session-unsupported");
        mouseDockThresholdPx = fixture ? null : WindowDockSettings.ReadMouseDockThreshold();
        if (!fixture)
            EnumWindows(
                (window, _) =>
                {
                    Remember(window);
                    return true;
                },
                0
            );
        InstallHooks();
        if (!Active)
        {
            Stop();
            throw new InvalidOperationException("hook-init-failed");
        }
        if (!fixture)
        {
            taskbar.Start(newGeneration);
            switching.Start(newGeneration);
            closing.Start(newGeneration);
        }
    }

    private void InstallHooks()
    {
        nint module = GetModuleHandleW(null);
        mouseHook = SetWindowsHookExW(WH_MOUSE_LL, mouseCallback, module, 0);
        keyHook = SetWindowsHookExW(WH_KEYBOARD_LL, keyCallback, module, 0);
        foreach (var (min, max) in winEventRanges)
        {
            nint hook = SetWinEventHook(min, max, 0, eventCallback, 0, 0, 0);
            if (hook != 0)
                eventHooks.Add(hook);
        }
    }

    internal void Stop()
    {
        router.Stop();
        CancelCaption();
        maximizeTimer.Stop();
        session.Stop();
        epoch = 0;
        protocol.Stop();
        taskbar.Stop();
        switching.Stop();
        closing.Stop();
        bool released = true;
        if (mouseHook != 0)
            released &= UnhookWindowsHookEx(mouseHook);
        if (keyHook != 0)
            released &= UnhookWindowsHookEx(keyHook);
        foreach (nint hook in eventHooks)
            released &= UnhookWinEvent(hook);
        mouseHook = keyHook = 0;
        eventHooks.Clear();
        states.Clear();
        tracker.Reset(0);
        mouseDockThresholdPx = null;
        if (!released)
            throw new InvalidOperationException("hook-release-failed");
    }

    private WindowState? ReadStateChange(nint window) =>
        Read(window, tracker.MaximizeProcess(window, clock.ElapsedMilliseconds));

    private static long? ReadResultStyle(nint window, int index)
    {
        nint value = GetWindowStyleChecked(window, index);
        return value == 0 && Marshal.GetLastPInvokeError() != 0 ? null : value.ToInt64();
    }

    private WindowState? Read(nint window, uint? maximizeProcess = null)
    {
        if (ReadWindowProcess(window) is not { } pid)
            return null;
        string? windowClass = ReadWindowClass(window);
        bool? cloaked = ReadCloaked(window);
        long? style = ReadResultStyle(window, GWL_STYLE),
            extended = ReadResultStyle(window, -20);
        bool allowed = maximizeProcess is { } expectedProcess
            ? WindowTargetPolicy.AllowsMaximizeResult(
                pid,
                expectedProcess,
                (uint)Environment.ProcessId,
                style,
                extended,
                GetWindow(window, 4) != 0,
                cloaked,
                windowClass,
                OrdinaryProcess(pid)
            )
            : style is { } knownStyle
                && extended is { } knownExtended
                && WindowTargetPolicy.Allows(
                    pid,
                    (uint)Environment.ProcessId,
                    knownStyle,
                    knownExtended,
                    GetWindow(window, 4) != 0,
                    cloaked,
                    windowClass,
                    OrdinaryProcess(pid)
                );
        if (!allowed)
            return null;
        return ReadPlacement(window, pid, style!.Value);
    }

    private static uint? ReadWindowProcess(nint window)
    {
        if (window == 0 || GetAncestor(window, GA_ROOT) != window)
            return null;
        if (!IsWindowVisible(window))
            return null;
        if (window == GetDesktopWindow() || window == GetShellWindow())
            return null;
        return GetWindowThreadProcessId(window, out uint pid) == 0 ? null : pid;
    }

    private static string? ReadWindowClass(nint window)
    {
        var name = new StringBuilder(256);
        return GetClassNameW(window, name, name.Capacity) > 0 ? name.ToString() : null;
    }

    private static bool? ReadCloaked(nint window) =>
        DwmGetWindowAttribute(window, DWMWA_CLOAKED, out int cloak, sizeof(int)) == 0
            ? cloak != 0
            : null;

    private WindowState? ReadPlacement(nint window, uint pid, long style)
    {
        var placement = new Placement { Length = (uint)Marshal.SizeOf<Placement>() };
        if (!GetWindowPlacement(window, ref placement))
            return null;
        var info = new MonitorInfo { Size = (uint)Marshal.SizeOf<MonitorInfo>() };
        bool workKnown = GetMonitorInfoW(
            MonitorFromWindow(window, MONITOR_DEFAULTTONULL),
            ref info
        );
        bool frameKnown =
            DwmGetWindowAttribute(
                window,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                out Rect frame,
                (uint)Marshal.SizeOf<Rect>()
            ) == 0;
        static MonitorBounds Bounds(Rect r) =>
            new(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
        return new WindowState(
            pid,
            WindowTargetPolicy.ApplicationCategory,
            placement.Show,
            isArranged is null ? null : isArranged(window) != 0,
            DisplayContext.Monitor(window),
            DisplayContext.HorizontalPair(),
            DisplayContext.Layout(),
            frameKnown ? Bounds(frame) : null,
            workKnown ? Bounds(info.Work) : null,
            GetDpiForWindow(window),
            DisplayContext.TwoDisplayPair(),
            mouseDockThresholdPx
        )
        {
            HasCaption = (style & WS_CAPTION) == WS_CAPTION,
        };
    }

    internal static bool OrdinaryProcess(uint pid)
    {
        nint process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid),
            token = 0;
        if (process == 0)
            return false;
        try
        {
            return OpenProcessToken(process, TOKEN_QUERY, out token)
                && GetTokenInformation(
                    token,
                    TokenElevation,
                    out int elevated,
                    sizeof(int),
                    out uint size
                )
                && size == sizeof(int)
                && elevated == 0;
        }
        finally
        {
            if (token != 0)
                CloseHandle(token);
            CloseHandle(process);
        }
    }

    private void Remember(nint window)
    {
        WindowState? state = Read(window);
        if (state is not null)
            states[window] = state;
    }

    private void ObserveMouseRelease(MouseData mouse, bool probeRelease, Point? physicalBefore)
    {
        windowDiagnostic?.Invoke(WindowDiagnosticReason.MouseUp);
        var info = new MonitorInfo { Size = (uint)Marshal.SizeOf<MonitorInfo>() };
        bool known = GetMonitorInfoW(
            MonitorFromPoint(mouse.Point, MONITOR_DEFAULTTONULL),
            ref info
        );
        static MonitorBounds Bounds(Rect r) =>
            new(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
        Point? physicalAfter =
            probeRelease && GetPhysicalCursorPos(out Point current) ? current : null;
        router.Dispatch(
            new MouseReleaseEvent(
                epoch,
                clock.ElapsedMilliseconds,
                mouse.Point,
                known ? Bounds(info.Monitor) : null,
                known ? Bounds(info.Work) : null,
                mouse.Flags,
                physicalBefore,
                physicalAfter
            )
        );
        RefreshClickResult();
    }

    private void RefreshClickResult()
    {
        var clicked = tracker.MouseStateTarget ?? tracker.ClickResultTarget;
        if (clicked is not { } target || captionClick.Target == target)
            return;
        states.TryGetValue(target, out WindowState? previous);
        var after = ReadStateChange(target);
        if (after is null)
        {
            tracker.Forget(target);
            return;
        }
        states[target] = after;
        router.Dispatch(
            new StateObservedEvent(
                epoch,
                target,
                clock.ElapsedMilliseconds,
                previous,
                after,
                GetForegroundWindow(),
                DateTime.Now.ToString("yyyy-MM-dd"),
                after.Monitor
            )
        );
    }

    private void BeginCaptionResults()
    {
        if (captionClick.PressFacts is { } pressFacts)
            router.Dispatch(
                new CaptionPressEvent(epoch, pressFacts, DateTime.Now.ToString("yyyy-MM-dd"))
            );
    }

    private static bool ReadsKeyResult(uint key) =>
        key is VK_LWIN or VK_RWIN or VK_LEFT or VK_RIGHT || key is VK_UP or VK_DOWN;

    private bool ObservingLiveWindows => !fixture && Active;

    private bool AcceptsInputHook(int code) => code >= 0 && ObservingLiveWindows;

    private void CancelInput()
    {
        CancelCaption();
        tracker.ClearInput();
        switching.Cancel();
        closing.Cancel();
    }

    private nint OnMouse(int code, nint message, nint data)
    {
        try
        {
            if (!AcceptsInputHook(code) || !ObserveMouse(message, data))
                return CallNextHookEx(0, code, message, data);
        }
        catch
        {
            CancelInput();
        }
        return CallNextHookEx(0, code, message, data);
    }

    private bool ObserveMouse(nint message, nint data)
    {
        var mouse = Marshal.PtrToStructure<MouseData>(data);
        nint pressForeground = GetForegroundWindow();
        if (!ContinueMouseAfterCaption(message, mouse))
            return false;
        router.Dispatch(new MouseMessageEvent(epoch, clock.ElapsedMilliseconds, message));
        bool probeRelease = ShouldProbeMouseRelease(message);
        Point? physicalBefore =
            probeRelease && GetPhysicalCursorPos(out Point entry) ? entry : null;
        DispatchRawMouse(message, mouse);
        if (message == WM_LBUTTONDOWN)
            return ObserveMousePress(Marshal.PtrToStructure<MouseData>(data), pressForeground);
        CompleteMouseMessage(message, mouse, probeRelease, physicalBefore);
        return false;
    }

    private bool ContinueMouseAfterCaption(nint message, MouseData mouse)
    {
        if (!captionClick.Pending)
            return true;
        if (message == WM_LBUTTONDOWN)
        {
            CancelCaption();
            return true;
        }
        bool fallback = captionClick.Fallback;
        nint root = GetAncestor(WindowFromPhysicalPoint(mouse.Point), GA_ROOT);
        GetWindowThreadProcessId(root, out uint process);
        captionClick.Mouse(
            message,
            mouse.Point,
            mouse.Flags,
            CaptionModifiers(),
            root,
            process,
            clock.ElapsedMilliseconds
        );
        CancelExpiredMouseFallback(fallback);
        return fallback;
    }

    private void CancelExpiredMouseFallback(bool fallback)
    {
        if (fallback && !captionClick.Pending)
            tracker.CancelMouseState();
    }

    private bool ShouldProbeMouseRelease(nint message) =>
        windowDiagnostic is not null && message == WM_LBUTTONUP && tracker.HasDrag;

    private void DispatchRawMouse(nint message, MouseData mouse)
    {
        router.Dispatch(
            new RawMouseEvent(
                epoch,
                clock.ElapsedMilliseconds,
                message,
                mouse.Point,
                mouse.Flags,
                mouse.Time
            )
        );
        if (message == 0x200)
            router.Dispatch(
                new MouseMoveEvent(epoch, clock.ElapsedMilliseconds, mouse.Point, mouse.Flags)
            );
    }

    private void CompleteMouseMessage(
        nint message,
        MouseData mouse,
        bool probeRelease,
        Point? physicalBefore
    )
    {
        if (message == WM_LBUTTONUP)
            ObserveMouseRelease(mouse, probeRelease, physicalBefore);
        if (message is WM_RBUTTONDOWN or WM_MBUTTONDOWN or WM_MOUSEWHEEL)
            tracker.ClearInput();
    }

    private bool ObserveMousePress(MouseData mouse, nint pressForeground)
    {
        windowDiagnostic?.Invoke(WindowDiagnosticReason.MouseDown);
        nint target = GetAncestor(WindowFromPoint(mouse.Point), GA_ROOT);
        if (ReadMousePressTarget(target) is not { } before)
            return false;
        int hit = captionHit.Read(target, before.Process, mouse.Point);
        windowDiagnostic?.Invoke(
            GetForegroundWindow() == target
                ? WindowDiagnosticReason.ForegroundMatched
                : WindowDiagnosticReason.ForegroundOther
        );
        if (
            pressForeground != target
            && ConsumeInactiveCaptionPress(target, before, hit, mouse, pressForeground)
        )
            return false;
        DispatchMousePress(target, before, hit, mouse);
        return true;
    }

    private WindowState? ReadMousePressTarget(nint target)
    {
        if (!states.ContainsKey(target))
        {
            windowDiagnostic?.Invoke(WindowDiagnosticReason.TargetMissing);
            tracker.ClearInput();
            return null;
        }
        WindowState? before = Read(target);
        if (before is null)
        {
            windowDiagnostic?.Invoke(WindowDiagnosticReason.TargetRejected);
            tracker.ClearInput();
            return null;
        }
        states[target] = before;
        return before;
    }

    private bool ConsumeInactiveCaptionPress(
        nint target,
        WindowState before,
        int hit,
        MouseData mouse,
        nint pressForeground
    )
    {
        ReportInactiveCaptionPress(before, hit);
        if (hit is not (HTMINBUTTON or HTMAXBUTTON or 1 or 0 or -1))
            return false;
        if (!TryStartCaptionPress(target, before, hit, mouse, pressForeground))
            return false;
        BeginCaptionResults();
        windowDiagnostic?.Invoke(WindowDiagnosticReason.CaptionStartAccepted);
        // Preserve the existing drag press for unidentified client/caption surfaces.
        // MOVESIZESTART cancels this click policy and leaves drag ownership unchanged.
        if (!captionClick.Fallback)
            tracker.ClearInput();
        switching.Cancel();
        closing.Cancel();
        SyncMaximizeTimer();
        return !captionClick.Fallback;
    }

    private void ReportInactiveCaptionPress(WindowState before, int hit)
    {
        // Diagnostic categories do not alter admission or retain window/input data.
        windowDiagnostic?.Invoke(WindowDiagnosticReason.CaptionInactivePress);
        if (!switching.MousePending)
            windowDiagnostic?.Invoke(WindowDiagnosticReason.CaptionSwitchMissing);
        if (!before.HasCaption)
            windowDiagnostic?.Invoke(WindowDiagnosticReason.CaptionStyleMissing);
        if (hit is not (HTMINBUTTON or HTMAXBUTTON))
            windowDiagnostic?.Invoke(WindowDiagnosticReason.CaptionButtonUnknown);
    }

    private bool TryStartCaptionPress(
        nint target,
        WindowState before,
        int hit,
        MouseData mouse,
        nint pressForeground
    ) =>
        captionClick.Start(
            target,
            before,
            hit,
            mouse.Point,
            clock.ElapsedMilliseconds,
            mouse.Time,
            NextTransaction(),
            InactiveCaptionPolicy.EligiblePress(
                switching.CaptionPressReady,
                WindowSwitchObserver.Read(pressForeground, requireCaption: false),
                WindowSwitchObserver.Read(target, requireCaption: false),
                before.Process
            ),
            (mouse.Flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED)) == 0,
            CaptionModifiers()
        );

    private void DispatchMousePress(nint target, WindowState before, int hit, MouseData mouse) =>
        router.Dispatch(
            new MousePressEvent(
                epoch,
                target,
                clock.ElapsedMilliseconds,
                before,
                hit,
                mouse.Point,
                GetDoubleClickTime(),
                mouse.Flags,
                CaptionModifiers(),
                GetForegroundWindow() == target
            )
        );

    private nint OnKey(int code, nint message, nint data)
    {
        try
        {
            // Forward filtered, release, and modifier events before synchronizing the timer.
            if (!AcceptsInputHook(code) || !ObserveKey(message, data))
                return CallNextHookEx(0, code, message, data);
        }
        catch
        {
            CancelInput();
        }
        finally
        {
            SyncMaximizeTimer();
        }
        return CallNextHookEx(0, code, message, data);
    }

    private bool ObserveKey(nint message, nint data)
    {
        var key = Marshal.PtrToStructure<KeyData>(data);
        CancelCaption();
        tracker.CancelMouseState();
        bool down = message is WM_KEYDOWN or WM_SYSKEYDOWN;
        router.Dispatch(
            new RawKeyEvent(epoch, clock.ElapsedMilliseconds, key.Key, down, key.Flags, key.Time)
        );
        // Win+digit belongs to W12, including unknown mappings. Never reuse it as window input.
        if (key.Key is >= 0x30 and <= 0x39 && WinPressed())
        {
            tracker.ClearInput();
            return false;
        }
        if (!down)
        {
            ObserveKeyRelease(key);
            return false;
        }
        return ObserveKeyPress(key);
    }

    private static bool WinPressed() =>
        GetAsyncKeyState(VK_LWIN) < 0 || GetAsyncKeyState(VK_RWIN) < 0;

    private void ObserveKeyRelease(KeyData key)
    {
        bool injected = (key.Flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0;
        if (injected)
            tracker.ClearInput();
        router.Dispatch(new KeyReleaseEvent(epoch, clock.ElapsedMilliseconds, key.Key));
        if (!ReadsKeyResult(key.Key))
            return;
        nint target = GetForegroundWindow();
        var after = ReadStateChange(target);
        router.Dispatch(
            new KeyResultEvent(
                epoch,
                target,
                clock.ElapsedMilliseconds,
                after,
                injected,
                DateTime.Now.ToString("yyyy-MM-dd")
            )
        );
    }

    private bool ObserveKeyPress(KeyData key)
    {
        nint target = GetForegroundWindow();
        if (CandidateTracker.IsModifier(key.Key))
        {
            router.Dispatch(
                new KeyPressEvent(
                    epoch,
                    target,
                    clock.ElapsedMilliseconds,
                    null,
                    key.Key,
                    false,
                    false,
                    key.Flags
                )
            );
            return false;
        }
        bool win = WinPressed();
        bool shift = GetAsyncKeyState(VK_SHIFT) < 0,
            alt = GetAsyncKeyState(VK_MENU) < 0;
        bool modifiers = GetAsyncKeyState(VK_CONTROL) < 0;
        string? route = CandidateTracker.KeyRoute(key.Key, win, shift, alt, modifiers);
        WindowState? before = ReadKeyPressTarget(target, route);
        router.Dispatch(
            new KeyPressEvent(
                epoch,
                target,
                clock.ElapsedMilliseconds,
                before,
                key.Key,
                win,
                modifiers,
                key.Flags,
                shift,
                alt,
                key.Time
            )
        );
        return true;
    }

    private WindowState? ReadKeyPressTarget(nint target, string? route)
    {
        if (route is null)
            return null;
        if (route != "win-up" && !states.ContainsKey(target))
            return null;
        var before = Read(target);
        if (before is not null)
            states[target] = before;
        return before;
    }

    private void SyncMaximizeTimer()
    {
        bool pending =
            !fixture
            && Active
            && (
                captionClick.Pending
                || tracker.ResultTarget(clock.ElapsedMilliseconds, captionClick.Target) is not null
            );
        if (pending && !maximizeTimer.Enabled)
            maximizeTimer.Start();
        if (!pending)
            maximizeTimer.Stop();
    }

    private void PollMaximize()
    {
        try
        {
            PollCaptionResult();
            PollTrackerResult();
        }
        catch
        {
            CancelCaption();
            tracker.ClearInput();
        }
        finally
        {
            SyncMaximizeTimer();
        }
    }

    private void PollCaptionResult()
    {
        if (!ObservingLiveWindows || !captionClick.Pending)
            return;
        bool fallback = captionClick.Fallback;
        var after = Read(captionClick.Target, maximizeProcess: captionClick.Process);
        if (captionClick.PollFacts(after, clock.ElapsedMilliseconds) is { } completedFacts)
            router.Dispatch(new CaptionResultEvent(epoch, completedFacts));
        CancelExpiredMouseFallback(fallback);
    }

    private void PollTrackerResult()
    {
        if (!ObservingLiveWindows)
            return;
        if (tracker.ResultTarget(clock.ElapsedMilliseconds, captionClick.Target) is not { } target)
            return;
        WindowState? after = ReadStateChange(target);
        router.Dispatch(
            new TickEvent(
                epoch,
                target,
                clock.ElapsedMilliseconds,
                after,
                GetForegroundWindow(),
                DateTime.Now.ToString("yyyy-MM-dd")
            )
        );
    }

    private readonly record struct WindowEvent(
        uint Kind,
        nint Window,
        int ObjectId,
        int ChildId,
        uint Thread,
        uint Time
    )
    {
        internal bool IsWindow => ObjectId == OBJID_WINDOW && ChildId == CHILDID_SELF;
    }

    private void OnEvent(WindowEvent notification)
    {
        if (!CanObserveWindowEvent(notification))
            return;
        try
        {
            var (kind, window, obj, child, thread, time) = notification;
            var foreground = ObserveForeground(kind, window, time);
            UpdateCaptionFromEvent(notification);
            closing.Event(kind, window, obj, child, thread, time);
            if (foreground is not null)
            {
                router.Dispatch(foreground);
                switching.Foreground(window, time);
            }
            ObserveWindowEvent(notification);
        }
        catch
        {
            CancelInput();
        }
    }

    private bool CanObserveWindowEvent(WindowEvent notification) =>
        ObservingLiveWindows && notification.Window != 0 && !IgnoreSystemEvent(notification.Kind);

    private void UpdateCaptionFromEvent(WindowEvent notification)
    {
        if (!captionClick.Pending)
            return;
        bool fallback = captionClick.Fallback;
        if (CancelsCaption(notification))
            CancelCaption();
        else
        {
            captionClick.State(
                Read(captionClick.Target, maximizeProcess: captionClick.Process),
                clock.ElapsedMilliseconds
            );
            if (notification.Kind == EVENT_SYSTEM_FOREGROUND)
                captionClick.Foreground(
                    notification.Window,
                    GetForegroundWindow(),
                    notification.Time
                );
        }
        CancelExpiredMouseFallback(fallback);
    }

    private bool CancelsCaption(WindowEvent notification) =>
        notification.Kind == EVENT_SYSTEM_MOVESIZESTART
        || (
            notification.Kind == EVENT_OBJECT_DESTROY
            && notification.Window == captionClick.Target
            && notification.ObjectId == OBJID_WINDOW
        );

    private void ObserveWindowEvent(WindowEvent notification)
    {
        switch (notification.Kind)
        {
            case EVENT_OBJECT_DESTROY when notification.IsWindow:
                router.Dispatch(
                    new ObservedEvent(
                        ObservedKind.Destroy,
                        epoch,
                        notification.Window,
                        clock.ElapsedMilliseconds
                    )
                );
                states.Remove(notification.Window);
                break;
            case EVENT_SYSTEM_MOVESIZESTART:
                ObserveMoveStart(notification.Window);
                break;
            case EVENT_SYSTEM_MOVESIZEEND:
                ObserveMoveEnd(notification.Window);
                break;
            default:
                ObserveWindowState(notification);
                break;
        }
    }

    private void ObserveMoveStart(nint window)
    {
        windowDiagnostic?.Invoke(WindowDiagnosticReason.MoveStart);
        switching.Cancel();
        router.Dispatch(
            new ObservedEvent(ObservedKind.MoveStart, epoch, window, clock.ElapsedMilliseconds)
        );
    }

    private void ObserveMoveEnd(nint window)
    {
        windowDiagnostic?.Invoke(WindowDiagnosticReason.MoveEnd);
        WindowState? end = Read(window);
        router.Dispatch(
            new MoveEndEvent(
                epoch,
                window,
                clock.ElapsedMilliseconds,
                end,
                GetForegroundWindow(),
                DateTime.Now.ToString("yyyy-MM-dd")
            )
        );
    }

    private void ObserveWindowState(WindowEvent notification)
    {
        var (kind, window, _, _, _, time) = notification;
        if (!notification.IsWindow && !CarriesWindowState(kind))
            return;
        states.TryGetValue(window, out WindowState? previous);
        WindowState? after = ReadStateChange(window);
        if (after is null)
        {
            tracker.Forget(window);
            return;
        }
        states[window] = after;
        if (captionClick.Target == window)
            return;
        DispatchMinimizeStart(kind, window, after.Process, time);
        router.Dispatch(
            new StateObservedEvent(
                epoch,
                window,
                clock.ElapsedMilliseconds,
                previous,
                after,
                GetForegroundWindow(),
                DateTime.Now.ToString("yyyy-MM-dd"),
                DisplayContext.Bounds(window)
            )
        );
    }

    private static bool CarriesWindowState(uint kind) =>
        kind is EVENT_SYSTEM_FOREGROUND or EVENT_SYSTEM_MINIMIZESTART or EVENT_SYSTEM_MINIMIZEEND;

    private static bool IgnoreSystemEvent(uint kind) =>
        kind is >= EVENT_SYSTEM_FOREGROUND and <= EVENT_SYSTEM_MINIMIZEEND
        && kind
            is not (
                EVENT_SYSTEM_FOREGROUND
                or EVENT_SYSTEM_MOVESIZESTART
                or EVENT_SYSTEM_MOVESIZEEND
                or EVENT_SYSTEM_MINIMIZESTART
                or EVENT_SYSTEM_MINIMIZEEND
            );

    private ForegroundObservedEvent? ObserveForeground(uint kind, nint window, uint time) =>
        kind == EVENT_SYSTEM_FOREGROUND
            ? new(
                epoch,
                window,
                clock.ElapsedMilliseconds,
                time,
                ReadDisplacedMinimizedWindow(window)
            )
            : null;

    private (nint Window, uint Process)? ReadDisplacedMinimizedWindow(nint foreground)
    {
        if (tracker.MinimizeDepartureTarget(foreground) is not { } target)
            return null;
        if (GetForegroundWindow() != foreground || !IsIconic(target.Window))
            return null;
        return
            GetWindowThreadProcessId(target.Window, out uint process) != 0
            && process == target.Process
            ? target
            : null;
    }

    private void DispatchMinimizeStart(uint kind, nint window, uint process, uint time)
    {
        if (kind == EVENT_SYSTEM_MINIMIZESTART)
            router.Dispatch(
                new MinimizeStartedEvent(epoch, window, clock.ElapsedMilliseconds, process, time)
            );
    }

    public void Dispose()
    {
        Stop();
        maximizeTimer.Dispose();
        taskbar.Dispose();
        switching.Dispose();
        closing.Dispose();
        GC.KeepAlive(mouseCallback);
        GC.KeepAlive(keyCallback);
        GC.KeepAlive(eventCallback);
    }
}
