using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;
using static NativeMethods;
using Point = NativeMethods.Point;

internal sealed class ShadowPanel : Form
{
    readonly ComboBox scenario = new()
    {
        Dock = DockStyle.Top,
        DropDownStyle = ComboBoxStyle.DropDownList,
    };
    readonly ComboBox app = new()
    {
        Dock = DockStyle.Top,
        DropDownStyle = ComboBoxStyle.DropDownList,
    };
    readonly Button arm = new() { Text = "ARM (5 second delay)", Dock = DockStyle.Top };
    readonly Button stop = new() { Text = "FINISH / STOP", Dock = DockStyle.Top };
    readonly Label status = new() { Dock = DockStyle.Fill };
    readonly System.Windows.Forms.Timer timer = new() { Interval = 50 };
    readonly Stopwatch clock = Stopwatch.StartNew();
    readonly InputHook mouseCallback,
        keyCallback;
    readonly EventHook eventCallback;
    readonly List<nint> hooks = new();
    readonly List<MouseShadowClicks.Press> clicks = new();
    readonly CandidateTracker current = new();
    readonly List<string> currentReasons = new();
    readonly string output;
    nint mouse,
        key,
        target;
    WindowState? before,
        endState;
    object? actualDrag;
    WindowCandidate? actualClick;
    MouseShadowClicks.Comparison? capturedClick;
    nint endForeground;
    Point press,
        release;
    MonitorBounds? releaseMonitor,
        releaseWork;
    long armAt,
        downAt,
        upAt,
        moveAge,
        endAt,
        resultAt;
    bool dragForegroundLost;
    bool waiting,
        active,
        released,
        moving,
        ended,
        conflict,
        injected,
        resize,
        apiFailed;
    string caseId = "",
        appId = "";
    int hit,
        trial;

    [DllImport("user32.dll")]
    static extern bool IsWindowArranged(nint w);

    internal ShadowPanel(string output)
    {
        this.output = output;
        Text = "Mouse Shadow — isolated physical-input research";
        Width = 650;
        Height = 310;
        TopMost = true;
        scenario.Items.AddRange(
            new object[]
            {
                "max-max",
                "normal-max",
                "half-max",
                "quarter-max",
                "half-half",
                "quarter-quarter",
                "same-placement",
                "resize",
                "cancel",
                "standard-double-max",
                "standard-double-restore",
                "custom-double-max",
                "custom-double-restore",
                "custom-single-minimize",
                "body-single",
                "body-double",
            }
        );
        app.Items.AddRange(new object[] { "chrome", "dia", "obsidian" });
        scenario.SelectedIndex = 0;
        app.SelectedIndex = 0;
        Controls.Add(status);
        Controls.Add(stop);
        Controls.Add(arm);
        Controls.Add(scenario);
        Controls.Add(app);
        mouseCallback = Mouse;
        keyCallback = Key;
        eventCallback = Event;
        arm.Click += (_, _) =>
        {
            caseId = scenario.Text;
            appId = app.Text;
            armAt = clock.ElapsedMilliseconds;
            waiting = true;
            arm.Enabled = false;
            status.Text = "Focus starting app. Hooks start in 5 seconds.";
        };
        stop.Click += (_, _) => Finish("manual-stop");
        FormClosing += (_, _) => Finish("closed");
        timer.Tick += (_, _) => Tick();
        timer.Start();
    }

    static MonitorBounds ToBounds(Rect r) => new(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);

    static (MonitorBounds?, MonitorBounds?) Monitor(nint h)
    {
        var info = new MonitorInfo { Size = (uint)Marshal.SizeOf<MonitorInfo>() };
        return GetMonitorInfoW(h, ref info)
            ? (ToBounds(info.Monitor), ToBounds(info.Work))
            : (null, null);
    }

    WindowState? Read(nint w)
    {
        var p = new Placement { Length = (uint)Marshal.SizeOf<Placement>() };
        if (!IsWindow(w) || !GetWindowPlacement(w, ref p))
        {
            apiFailed = true;
            return null;
        }
        GetWindowThreadProcessId(w, out uint process);
        var cls = new StringBuilder(256);
        GetClassNameW(w, cls, cls.Capacity);
        long style = GetWindowStyleChecked(w, -16).ToInt64();
        bool styleOk = Marshal.GetLastPInvokeError() == 0;
        long extended = GetWindowStyleChecked(w, -20).ToInt64();
        bool extendedOk = Marshal.GetLastPInvokeError() == 0;
        bool? cloaked =
            DwmGetWindowAttribute(w, DWMWA_CLOAKED, out int cloak, 4) == 0 ? cloak != 0 : null;
        if (
            !styleOk
            || !extendedOk
            || !WindowTargetPolicy.Allows(
                process,
                (uint)Environment.ProcessId,
                style,
                extended,
                GetWindow(w, 4) != 0,
                cloaked,
                cls.ToString(),
                GetAncestor(w, GA_ROOT) == w
            )
        )
        {
            apiFailed = true;
            return null;
        }
        var (m, work) = Monitor(MonitorFromWindow(w, 0));
        if (m is null || work is null || process == 0)
        {
            apiFailed = true;
            return null;
        }
        MonitorBounds? frame =
            DwmGetWindowAttribute(
                w,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                out Rect r,
                (uint)Marshal.SizeOf<Rect>()
            ) == 0
                ? ToBounds(r)
                : null;
        return new(
            process,
            "ordinary-window",
            p.Show,
            IsWindowArranged(w),
            m,
            DisplayContext.HorizontalPair(),
            DisplayContext.Layout(),
            frame,
            work,
            GetDpiForWindow(w),
            DisplayContext.TwoDisplayPair(),
            WindowDockSettings.ReadMouseDockThreshold()
        )
        {
            HasCaption = (style & WS_CAPTION) == WS_CAPTION,
        };
    }

    void Start()
    {
        waiting = false;
        dragForegroundLost = false;
        before = endState = null;
        actualDrag = null;
        actualClick = null;
        capturedClick = null;
        endForeground = 0;
        target = 0;
        clicks.Clear();
        currentReasons.Clear();
        current.Reset(1);
        current.Diagnostic = r =>
        {
            if (currentReasons.Count < 16 && !currentReasons.Contains(r.ToString()))
                currentReasons.Add(r.ToString());
        };
        conflict = injected = resize = apiFailed = released = moving = ended = false;
        endAt = upAt = resultAt = 0;
        mouse = SetWindowsHookExW(WH_MOUSE_LL, mouseCallback, GetModuleHandleW(null), 0);
        key = SetWindowsHookExW(WH_KEYBOARD_LL, keyCallback, GetModuleHandleW(null), 0);
        foreach (
            uint kind in new uint[]
            {
                EVENT_SYSTEM_MOVESIZESTART,
                EVENT_SYSTEM_MOVESIZEEND,
                EVENT_OBJECT_DESTROY,
                EVENT_SYSTEM_FOREGROUND,
            }
        )
            hooks.Add(SetWinEventHook(kind, kind, 0, eventCallback, 0, 0, 0));
        active = true;
        if (mouse == 0 || key == 0 || hooks.Any(h => h == 0))
        {
            Finish("hook-failed");
            return;
        }
        armAt = clock.ElapsedMilliseconds;
        status.Text = "ARMED: perform one case. Automatic FINISH within 20 seconds.";
    }

    nint Mouse(int code, nint msg, nint data)
    {
        if (code >= 0 && active)
        {
            var d = Marshal.PtrToStructure<MouseData>(data);
            if ((d.Flags & 3) != 0)
                injected = true;
            if (msg == WM_LBUTTONDOWN)
            {
                nint w = GetAncestor(WindowFromPhysicalPoint(d.Point), GA_ROOT);
                conflict |= new[] { VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN }.Any(k =>
                    (GetAsyncKeyState(k) & 0x8000) != 0
                );
                if (w == Handle)
                    return CallNextHookEx(mouse, code, msg, data);
                if (target != 0 && target != w)
                    conflict = true;
                if (target == 0)
                    target = w;
                var state = Read(w);
                if (state is null)
                {
                    Finish("snapshot-failed");
                    return CallNextHookEx(mouse, code, msg, data);
                }
                if (clicks.Count >= 2)
                {
                    conflict = true;
                    Finish("extra-click");
                    return CallNextHookEx(mouse, code, msg, data);
                }
                before ??= state;
                press = d.Point;
                downAt = clock.ElapsedMilliseconds;
                released = false;
                resultAt = 0;
                capturedClick = null;
                hit = WindowCaption.QueryRootHit(w, d.Point);
                if (hit == 1)
                {
                    nint child = WindowFromPhysicalPoint(d.Point);
                    GetWindowThreadProcessId(child, out uint childProcess);
                    hit = WindowCaption.ResolveChildCaption(
                        hit,
                        child == w ? 1 : WindowCaption.QueryRootHit(child, d.Point),
                        GetAncestor(child, GA_ROOT) == w,
                        childProcess == state.Process
                    );
                }
                if (WindowCaption.Read(w, out var title) && GetWindowRect(w, out var rect))
                    hit = WindowCaption.Hit(title, rect, d.Point, hit);
                resize = hit is >= 10 and <= 18;
                clicks.Add(
                    new(
                        state,
                        hit,
                        d.Point,
                        downAt,
                        -1,
                        w == target,
                        (d.Flags & 3) != 0,
                        conflict,
                        false,
                        ForegroundAtPress: GetForegroundWindow() == w
                    )
                );
                current.Mouse(
                    w,
                    state,
                    hit,
                    d.Point,
                    downAt,
                    GetDoubleClickTime(),
                    d.Flags,
                    conflict,
                    GetForegroundWindow() == w
                );
            }
            else if (msg == WM_LBUTTONUP && target != 0)
            {
                release = d.Point;
                upAt = clock.ElapsedMilliseconds;
                released = true;
                (releaseMonitor, releaseWork) = Monitor(MonitorFromPoint(d.Point, 0));
                if (clicks.Count > 0)
                    clicks[^1] = clicks[^1] with
                    {
                        Up = upAt,
                        Dragged = moving,
                        Conflict = conflict,
                        Injected = injected,
                    };
                current.MouseReleased(d.Point, releaseMonitor, releaseWork, d.Flags);
                if (
                    clicks.Count > 0
                    && !moving
                    && (
                        Math.Abs((long)d.Point.X - press.X) > 4
                        || Math.Abs((long)d.Point.Y - press.Y) > 4
                    )
                )
                    clicks[^1] = clicks[^1] with { FurthestPoint = d.Point };
            }
            else if (msg == 0x200)
            {
                current.MouseMoved(d.Point, d.Flags);
                if (clicks.Count > 0 && !released)
                {
                    var p = clicks[^1];
                    var f = p.FurthestPoint ?? p.Point;
                    long Distance(Point v) =>
                        Math.Max(Math.Abs((long)v.X - p.Point.X), Math.Abs((long)v.Y - p.Point.Y));
                    if (Distance(d.Point) > Distance(f))
                        clicks[^1] = p with { FurthestPoint = d.Point };
                }
            }
            else if (msg != 0x200)
            {
                conflict = true;
                current.ClearInput();
            }
        }
        return CallNextHookEx(mouse, code, msg, data);
    }

    nint Key(int code, nint msg, nint data)
    {
        if (code >= 0 && active && (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN))
        {
            conflict = true;
            current.ClearInput();
        }
        return CallNextHookEx(key, code, msg, data);
    }

    void Event(nint h, uint kind, nint w, int obj, int child, uint thread, uint time)
    {
        if (active && kind == EVENT_SYSTEM_FOREGROUND)
        {
            current.ForegroundChanged(w);
            if (target != 0 && !ended && w != target)
                dragForegroundLost = true;
        }
        if (!active || w != target || target == 0 || obj != 0 || child != 0)
            return;
        if (kind == EVENT_OBJECT_DESTROY)
        {
            conflict = true;
            Finish("target-destroyed");
        }
        else if (kind == EVENT_SYSTEM_MOVESIZESTART)
        {
            moving = true;
            moveAge = clock.ElapsedMilliseconds - downAt;
            current.MoveStart(w, clock.ElapsedMilliseconds);
        }
        else if (kind == EVENT_SYSTEM_MOVESIZEEND)
        {
            ended = true;
            endAt = clock.ElapsedMilliseconds;
            endState = Read(target);
            endForeground = GetForegroundWindow();
            actualDrag = current.FinishMove(target, endState, endAt, endForeground, "2026-11-07");
        }
    }

    void Tick()
    {
        if (clock.ElapsedMilliseconds > 1200000)
        {
            Finish("session-timeout");
            Close();
            return;
        }
        if (waiting && clock.ElapsedMilliseconds - armAt >= 5000)
            Start();
        if (!active)
            return;
        if (!moving && released && target != 0 && clicks.Count > 0 && resultAt == 0)
        {
            var sampled = Read(target);
            if (sampled != null && sampled.Show != clicks[^1].Before.Show)
            {
                resultAt = clock.ElapsedMilliseconds;
                actualClick =
                    current.Complete(
                        target,
                        clicks[^1].Before,
                        sampled,
                        resultAt,
                        GetForegroundWindow(),
                        "2026-11-07",
                        sampled.Monitor
                    ) as WindowCandidate;
                capturedClick = MouseShadowClicks.Compare(
                    clicks
                        .Select(p =>
                            p with
                            {
                                Conflict = p.Conflict || conflict,
                                Injected = p.Injected || injected,
                            }
                        )
                        .ToArray(),
                    sampled,
                    resultAt,
                    GetDoubleClickTime(),
                    GetSystemMetrics(36),
                    GetSystemMetrics(37),
                    GetForegroundWindow() == target
                );
            }
        }
        if (clock.ElapsedMilliseconds - armAt > 20000)
        {
            Finish("timeout");
            return;
        }
        if (moving && ended && released && clock.ElapsedMilliseconds - Math.Max(endAt, upAt) >= 150)
            Finish("terminal");
        else if (
            !moving
            && released
            && clock.ElapsedMilliseconds - upAt > GetDoubleClickTime() + 150
        )
            Finish("click-terminal");
    }

    protected override void WndProc(ref Message m)
    {
        if (active && (m.Msg == 0x007E || m.Msg == 0x001A))
        {
            conflict = true;
            current.ClearInput();
        }
        base.WndProc(ref m);
    }

    void Finish(string stopReason)
    {
        if (!active)
        {
            waiting = false;
            dragForegroundLost = false;
            arm.Enabled = true;
            return;
        }
        var after = Read(target);
        object? actual = null;
        MouseDetectionShadow.Result shadow = new([], "unavailable");
        MouseShadowClicks.Comparison? comparison = null;
        if (before is not null && after is not null)
        {
            if (moving)
            {
                actual = actualDrag;
                bool terminalStable =
                    endState is not null
                    && endState.Process == after.Process
                    && endState.Show == after.Show
                    && endState.Monitor == after.Monitor;
                after = endState ?? after;
                var d = new MouseDetectionShadow.Drag(
                    before,
                    after,
                    release,
                    Physical: clicks.Count == 1,
                    Target: endForeground == target,
                    Stable: terminalStable && before.DisplayLayout == after.DisplayLayout,
                    Cancelled: conflict || dragForegroundLost,
                    Resize: resize,
                    Injected: injected,
                    Conflict: conflict,
                    Released: released && upAt <= endAt,
                    Terminal: ended,
                    StartAge: moveAge,
                    ReleaseMonitor: releaseMonitor,
                    ReleaseWork: releaseWork,
                    CurrentMaximizeConfirmed: actualDrag
                        is WindowCandidate { operation: "maximize" }
                            or CompoundMoveResult { Terminal: "maximized" }
                );
                shadow = MouseDetectionShadow.Evaluate(d);
            }
            else
                comparison =
                    capturedClick
                    ?? MouseShadowClicks.Compare(
                        clicks
                            .Select(p =>
                                p with
                                {
                                    Conflict = p.Conflict || conflict,
                                    Injected = p.Injected || injected,
                                }
                            )
                            .ToArray(),
                        after,
                        clock.ElapsedMilliseconds,
                        GetDoubleClickTime(),
                        GetSystemMetrics(36),
                        GetSystemMetrics(37),
                        GetForegroundWindow() == target
                    );
        }
        if (comparison is not null)
        {
            string[] op = actualClick
                is {
                    origin: "mouse",
                    targetMatched: true,
                    injected: false,
                    conflicted: false,
                    moving: false
                } c
                ? c.operation switch
                {
                    "maximize" => ["W03"],
                    "restore" or "minimize" => ["W04"],
                    _ => [],
                }
                : [];
            comparison = comparison with
            {
                Standard = actualClick?.route != "mouse-state-fallback" ? op : [],
                Fallback = actualClick?.route == "mouse-state-fallback" ? op : [],
            };
        }
        bool removed = true;
        active = false;
        if (mouse != 0)
            removed &= UnhookWindowsHookEx(mouse);
        if (key != 0)
            removed &= UnhookWindowsHookEx(key);
        foreach (var h in hooks)
            if (h != 0)
                removed &= UnhookWinEvent(h);
        hooks.Clear();
        mouse = key = 0;
        var row = new
        {
            kind = "trial",
            index = ++trial,
            app = appId,
            scenario = caseId,
            stop = stopReason,
            current = MouseDetectionShadow.CurrentOperations(actual),
            shadow = shadow.Operations,
            shadowReason = shadow.Reason,
            clicks = comparison,
            monitorChanged = before?.Monitor is not null
                && after?.Monitor is not null
                && before.Monitor != after.Monitor,
            beforeShape = before is null ? null : PlacementGeometry.Shape(before),
            afterShape = after is null ? null : PlacementGeometry.Shape(after),
            apiAvailable = !apiFailed && before != null && after != null,
            finalForegroundTarget = GetForegroundWindow() == target,
            endForegroundTarget = endForeground == target,
            sameProcess = before is not null
                && after is not null
                && before.Process == after.Process,
            physicalRelease = released,
            moveStart = moving,
            moveEnd = ended,
            beforeState = before is null ? "unknown" : CandidateTracker.State(before.Show),
            afterState = after is null ? "unknown" : CandidateTracker.State(after.Show),
            currentReasons = currentReasons.ToArray(),
            hooksRemoved = removed,
            productChanged = false,
        };
        File.AppendAllText(output, JsonSerializer.Serialize(row) + Environment.NewLine);
        target = 0;
        before = endState = null;
        actualDrag = null;
        actualClick = null;
        capturedClick = null;
        endForeground = 0;
        clicks.Clear();
        status.Text = "FINISH — hooks removed: " + removed + ". Result saved. Select next case.";
        arm.Enabled = true;
    }

    [STAThread]
    static void Main(string[] args)
    {
        if (args.Length != 2 || args[0] != "--observe-consented")
            throw new ArgumentException(
                "Use --observe-consented output.jsonl after explicit consent"
            );
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.Run(new ShadowPanel(Path.GetFullPath(args[1])));
    }
}
