using static NativeMethods;

internal static partial class Program
{
    private static List<object> CheckWindowStates()
    {
        var samples = new List<object>();
        var screen = new MonitorBounds(0, 0, 1920, 1080);
        var start = normal with { App = WindowTargetPolicy.ApplicationCategory, Monitor = screen, Work = screen, DisplayLayout = "stable" };
        var max = start with { Show = SW_SHOWMAXIMIZED };
        var min = start with { Show = SW_SHOWMINIMIZED };
        foreach (string route in new[] { "win-up", "win-down-restore", "win-down-minimize", "max-button", "restore-button", "min-button", "double-max", "double-restore", "top-drag" })
            Check($"captionless target records state operation: {route}", () => {
                var tracker = Tracker();
                WindowState? Read(WindowState state) => WindowTargetPolicy.Allows(state.Process, 99, 0, 0, false, false, "fixture-root", true) ? state with { HasCaption = false } : null;
                bool restore = route is "win-down-restore" or "restore-button" or "double-restore";
                var before = Read(restore ? max : start);
                var after = Read(restore ? start : route is "win-down-minimize" or "min-button" ? min : max);
                Equal(true, before is not null && after is not null);
                if (route.StartsWith("win-")) tracker.Key(11, before, route == "win-up" ? (uint)VK_UP : (uint)VK_DOWN, true, false, 0, 0);
                else {
                    int hit = route.StartsWith("double-") || route == "top-drag" ? HTCAPTION : route == "min-button" ? HTMINBUTTON : HTMAXBUTTON;
                    tracker.Mouse(11, before!, hit, default, 0, 500, 0, false, true);
                    if (route.StartsWith("double-")) tracker.Mouse(11, before!, hit, default, 100, 500, 0, false, true);
                    if (route == "top-drag") {
                        tracker.MoveStart(11, 100);
                        tracker.MouseReleased(new Point { X = 900, Y = 0 }, screen, screen, 0);
                    }
                }
                var result = (route == "top-drag" ? tracker.FinishMove(11, after, 200, 11, "2026-10-28") :
                    tracker.Complete(11, before, after!, 200, 11, "2026-10-28", screen)) as WindowCandidate;
                Equal(true, result is not null);
                Equal(restore ? "restore" : route is "win-down-minimize" or "min-button" ? "minimize" : "maximize", result!.operation);
                Equal(route.StartsWith("win-") ? "key" : "mouse", result.origin);
                Sample(result, restore || result.operation == "minimize" ? "W04" : "W03");
            });
        foreach (string mode in new[] { "self", "child", "owned", "tool", "no-activate", "cloaked", "unknown-cloak", "unknown-class", "shell", "elevated" })
            Check($"captionless input still rejects unsafe target: {mode}", () => {
                Equal(false, WindowTargetPolicy.Allows(7, mode == "self" ? 7u : 99u,
                    mode == "child" ? 0x40000000 : 0,
                    mode == "tool" ? 0x80 : mode == "no-activate" ? 0x08000000 : 0,
                    mode == "owned", mode == "unknown-cloak" ? null : mode == "cloaked",
                    mode == "unknown-class" ? null : mode == "shell" ? "Shell_TrayWnd" : "fixture-root", mode != "elevated"));
            });
        foreach (string route in new[] { "event", "timer", "release" })
            Check($"Win+Up retains eligible target when result loses caption via {route}", () => {
                var tracker = Tracker();
                bool BeforeAllowed(long style) => WindowTargetPolicy.Allows(start.Process, 99, style, 0, false, false, "fixture-root", true);
                Equal(true, BeforeAllowed(WS_CAPTION)); Equal(true, BeforeAllowed(0));
                tracker.Key(11, start, VK_UP, true, false, 0, 0);
                uint? expected = tracker.MaximizeProcess(11, 50);
                Equal<uint?>(start.Process, expected);
                bool resultAllowed = WindowTargetPolicy.AllowsMaximizeResult(start.Process, expected!.Value, 99, 0, 0, false, false, "fixture-root", true);
                Equal(true, resultAllowed);
                // A location event can arrive after caption disappears but before showCmd updates.
                Equal<object?>(null, tracker.Complete(11, start, start, 20, 11, "2026-10-28", screen));
                Equal<uint?>(start.Process, tracker.MaximizeProcess(11, 30));
                var after = resultAllowed ? max : null;
                object? result = route == "release" ? tracker.FinishKey(11, after, 50, false, "2026-10-28") :
                    route == "timer" ? tracker.ConfirmMaximize(11, after, 50, 11, "2026-10-28") :
                    tracker.Complete(11, start, after!, 50, 11, "2026-10-28", screen);
                Equal(true, result is WindowCandidate { operation: "maximize", route: "win-up" });
                Sample((WindowCandidate)result!, "W03");
                Equal<uint?>(null, tracker.MaximizeProcess(11, 60));
                Equal<WindowCandidate?>(null, tracker.ConfirmMaximize(11, max, 60, 11, "2026-10-28"));
                Equal(true, BeforeAllowed(0)); // W03/W04 also accept captionless input targets.
            });
        foreach (string mode in new[] { "no-input", "input-captionless", "other-window", "expired", "cancel", "destroy", "stop" })
            Check($"captionless result access requires a live eligible Win+Up candidate: {mode}", () => {
                var tracker = Tracker();
                if (mode != "no-input") tracker.Key(11, mode == "input-captionless" ? null : start, VK_UP, true, false, 0, 0);
                if (mode == "cancel") tracker.ClearInput();
                if (mode == "destroy") tracker.Forget(11);
                if (mode == "stop") tracker.Reset(2);
                Equal<uint?>(null, tracker.MaximizeProcess(mode == "other-window" ? 22 : 11, mode == "expired" ? 1001 : 50));
            });
        foreach (string mode in new[] { "process", "self", "child", "owned", "tool", "no-activate", "cloaked", "unknown-cloak", "unknown-class", "shell", "elevated", "style-error", "extended-style-error" })
            Check($"W03 result without caption still rejects unsafe target: {mode}", () => {
                Equal(false, WindowTargetPolicy.AllowsMaximizeResult(mode == "process" ? 8u : 7u, 7, mode == "self" ? 7u : 99u,
                    mode == "style-error" ? null : mode == "child" ? 0x40000000 : 0,
                    mode == "extended-style-error" ? null : mode == "tool" ? 0x80 : mode == "no-activate" ? 0x08000000 : 0,
                    mode == "owned", mode == "unknown-cloak" ? null : mode == "cloaked",
                    mode == "unknown-class" ? null : mode == "shell" ? "Shell_TrayWnd" : "fixture-root", mode != "elevated"));
            });
        foreach (bool? arranged in new bool?[] { false, true, null })
            Check($"Win+Up confirms live start without cached event state: {arranged}", () => {
                var tracker = Tracker(); var before = start with { Arranged = arranged };
                tracker.Key(11, before, VK_UP, true, false, 0, 0);
                var result = tracker.Complete(11, null, max, 250, 11, "2026-10-28", screen) as WindowCandidate;
                Equal(true, result is not null); Equal("win-up", result!.route);
                Equal(arranged, result.before.arranged);
                Sample(result, "W03");
                Equal<object?>(null, tracker.Complete(11, max, max, 300, 11, "2026-10-28", screen));
            });
        foreach (int delay in new[] { 50, 450, 1000, 1001 })
            Check($"Win+Up requery without any state event at {delay}", () => {
                var tracker = Tracker(); tracker.Key(11, start, VK_UP, true, false, 0, 0);
                tracker.KeyReleased(VK_UP); tracker.KeyReleased(VK_LWIN);
                for (int at = 50; at < delay; at += 50)
                    Equal<WindowCandidate?>(null, tracker.ConfirmMaximize(11, start, at, 11, "2026-10-28"));
                var result = tracker.ConfirmMaximize(11, max, delay, 11, "2026-10-28");
                Equal(delay <= 1000, result is not null);
                Equal<nint?>(null, tracker.MaximizeTarget(1001));
                Equal<WindowCandidate?>(null, tracker.ConfirmMaximize(11, max, delay + 1, 11, "2026-10-28"));
            });
        foreach (string mode in new[] { "already-max", "no-change", "other-window", "process", "foreground", "injected", "lower-injected", "injected-win", "conflict", "mouse", "stop", "destroy", "display" })
            Check($"Win+Up requery rejects {mode}", () => {
                var tracker = Tracker();
                if (mode == "injected-win") tracker.Key(11, null, VK_LWIN, false, false, 0, LLKHF_INJECTED);
                tracker.Key(11, mode == "already-max" ? max : start, VK_UP, true, false, 0,
                    mode == "injected" ? LLKHF_INJECTED : mode == "lower-injected" ? LLKHF_LOWER_IL_INJECTED : 0);
                if (mode == "conflict") tracker.Key(11, start, 0x41, true, false, 10, 0);
                if (mode == "mouse") tracker.Mouse(11, start, HTMAXBUTTON, default, 10, 500, 0, false, true);
                if (mode == "stop") tracker.Reset(2);
                if (mode == "destroy") tracker.Forget(11);
                if (mode == "display") tracker.ClearInput();
                var result = tracker.ConfirmMaximize(mode == "other-window" ? 22 : 11,
                    mode == "no-change" ? start : mode == "process" ? max with { Process = 99 } : max,
                    100, mode == "foreground" ? 22 : 11, "2026-10-28");
                Equal<WindowCandidate?>(null, result);
            });
        Check("Win+Up held after success cannot create another operation", () => {
            var tracker = Tracker(); tracker.Key(11, start, VK_UP, true, false, 0, 0);
            Equal(true, tracker.ConfirmMaximize(11, max, 50, 11, "2026-10-28") is not null);
            tracker.Key(11, start, VK_UP, true, false, 100, 0);
            Equal<WindowCandidate?>(null, tracker.ConfirmMaximize(11, max, 150, 11, "2026-10-28"));
            tracker.KeyReleased(VK_UP); tracker.Key(11, start, VK_UP, true, false, 200, 0);
            Equal(true, tracker.ConfirmMaximize(11, max, 250, 11, "2026-10-28") is not null);
        });
        Check("Win+Up repeat does not renew the original deadline", () => {
            var tracker = Tracker(); tracker.Key(11, start, VK_UP, true, false, 0, 0);
            tracker.Key(11, start, VK_UP, true, false, 900, 0);
            var result = tracker.Complete(11, start, max, 1100, 11, "2026-10-28", screen) as WindowCandidate;
            Equal(false, result is { origin: "key", targetMatched: true, inputAgeMs: <= 1000 });
        });
        Check("Win+Up foreground departure and return cancels the operation", () => {
            var tracker = Tracker(); tracker.Key(11, start, VK_UP, true, false, 0, 0);
            tracker.ForegroundChanged(22); tracker.ForegroundChanged(11);
            var result = tracker.Complete(11, start, max, 100, 11, "2026-10-28", screen) as WindowCandidate;
            Equal(false, result is { origin: "key", targetMatched: true });
        });
        foreach (int gap in new[] { -1, 2, 3, 8, 33, 64, 65, 500 })
            Check($"OS docking threshold governs top preview release {gap}", () => {
                var tracker = Tracker(); var before = start with { MouseDockThresholdPx = 64 };
                var after = max with { MouseDockThresholdPx = 64 };
                tracker.Mouse(11, before, HTCAPTION, default, 0, 500, 0, false, true); tracker.MoveStart(11, 100);
                tracker.MouseReleased(new Point { X = 900, Y = gap }, screen, screen, 0);
                var result = tracker.FinishMove(11, after, 5000, 11, "2026-10-31");
                Equal(gap >= 0 && gap <= 64, result is WindowCandidate);
                if (result is WindowCandidate value) { Equal("caption-top-drag", value.route); Equal("maximize", value.operation); }
            });
        foreach (int? threshold in new int?[] { null, 0, -1, 257, int.MaxValue })
            foreach (int gap in new[] { 2, 3 })
                Check($"top fallback threshold {threshold}/{gap}", () => {
                    var tracker = Tracker(); var before = start with { MouseDockThresholdPx = threshold };
                    tracker.Mouse(11, before, HTCAPTION, default, 0, 500, 0, false, true); tracker.MoveStart(11, 100);
                    tracker.MouseReleased(new Point { X = 900, Y = gap }, screen, screen, 0);
                    Equal(gap == 2, tracker.FinishMove(11, max with { MouseDockThresholdPx = threshold }, 5000, 11, "2026-10-31") is WindowCandidate);
                });
        Check("top gesture rejects changed docking setting even at edge", () => {
            var tracker = Tracker(); tracker.Mouse(11, start with { MouseDockThresholdPx = 64 }, HTCAPTION, default, 0, 500, 0, false, true);
            tracker.MoveStart(11, 100); tracker.MouseReleased(new Point { X = 900, Y = 0 }, screen, screen, 0);
            Equal<object?>(null, tracker.FinishMove(11, max with { MouseDockThresholdPx = 8 }, 5000, 11, "2026-10-31"));
        });
        foreach (int gap in new[] { -1, 0, 2, 3, 8, 9, 32, 33, 64, 65 })
            Check($"top release diagnostic is observational at {gap}", () => {
                object? Run(bool diagnostics, List<WindowDiagnosticReason> reasons) {
                    var tracker = Tracker(); if (diagnostics) tracker.Diagnostic = reasons.Add;
                    tracker.Mouse(11, start, HTCAPTION, default, 0, 500, 0, false, true);
                    tracker.MoveStart(11, 100); tracker.MouseReleased(new Point { X = 900, Y = gap }, screen, screen, 0);
                    return tracker.FinishMove(11, max, 5000, 11, "2026-10-31");
                }
                var reasons = new List<WindowDiagnosticReason>();
                Equal(gap >= 0 && gap <= 2, Run(false, reasons) is WindowCandidate);
                Equal(gap >= 0 && gap <= 2, Run(true, reasons) is WindowCandidate);
                var bucket = gap < 0 ? WindowDiagnosticReason.MaxReleaseYBeforeTop : gap <= 2 ? WindowDiagnosticReason.MaxReleaseTopWithin2 :
                    gap <= 8 ? WindowDiagnosticReason.MaxReleaseTop3To8 : gap <= 32 ? WindowDiagnosticReason.MaxReleaseTop9To32 :
                    gap <= 64 ? WindowDiagnosticReason.MaxReleaseTop33To64 : WindowDiagnosticReason.MaxReleaseTopAbove64;
                Equal(true, reasons.Contains(bucket));
            });
        Check("child caption requires explicit HTCAPTION and same root/process; buttons retain priority", () => {
            Equal(HTCAPTION, WindowCaption.ResolveChildCaption(1, HTCAPTION, true, true));
            Equal(1, WindowCaption.ResolveChildCaption(1, HTCAPTION, false, true));
            Equal(1, WindowCaption.ResolveChildCaption(1, HTCAPTION, true, false));
            foreach (int child in new[] { 1, -1, 0, HTMAXBUTTON, HTMINBUTTON, HTCLOSE }) Equal(1, WindowCaption.ResolveChildCaption(1, child, true, true));
            foreach (int root in new[] { HTCAPTION, HTMAXBUTTON, HTMINBUTTON, HTCLOSE, -1, 0 }) Equal(root, WindowCaption.ResolveChildCaption(root, HTCAPTION, true, true));
        });
        Check("caption diagnostics distinguish geometry without changing hit decisions", () => {
            var window = new Rect { Left = 0, Top = 0, Right = 100, Bottom = 100 };
            foreach (string mode in new[] { "fallback", "invalid", "valid", "disabled", "mismatch" }) {
                var title = new TitleInfo { State = new uint[6], Bounds = new Rect[6] };
                if (mode != "fallback") {
                    title.Bounds[2] = new Rect { Left = 10, Top = 0, Right = 20, Bottom = 20 };
                    title.Bounds[3] = new Rect { Left = 20, Top = 0, Right = 30, Bottom = 20 };
                    title.Bounds[5] = new Rect { Left = 30, Top = 0, Right = 40, Bottom = 20 };
                }
                if (mode == "invalid") title.Bounds[3] = title.Bounds[2];
                if (mode == "disabled") title.State[3] = 1;
                var point = new Point { X = mode == "mismatch" ? 50 : 25, Y = 10 };
                var reasons = new List<string>();
                Equal(WindowCaption.Hit(title, window, point, HTMAXBUTTON),
                    WindowCaption.Hit(title, window, point, HTMAXBUTTON, r => reasons.Add(r.ToString())));
                string expected = mode switch { "fallback" => "TitleGeometryFallback", "invalid" => "TitleGeometryInvalid",
                    "disabled" => "TitleButtonDisabled", "mismatch" => "TitleButtonMismatch", _ => "TitleGeometryValid" };
                Equal(true, reasons.Contains(expected));
                var closeReasons = new List<CloseReason>();
                Equal(WindowCaption.CloseButton(title, window, point), WindowCaption.CloseButton(title, window, point, closeReasons.Add));
                Equal(true, closeReasons.Contains(mode == "fallback" ? CloseReason.GeometryFallback :
                    mode == "invalid" ? CloseReason.GeometryInvalid : CloseReason.GeometryValid));
                if (mode == "valid") Equal(true, closeReasons.Contains(CloseReason.GeometryOutside));
                title.State[5] = 1; closeReasons.Clear();
                if (mode == "valid") {
                    Equal(false, WindowCaption.CloseButton(title, window, new Point { X = 35, Y = 10 }, closeReasons.Add));
                    Equal(true, closeReasons.Contains(CloseReason.GeometryDisabled));
                }
            }
        });
        Check("all close reasons map into bounded generation-scoped window diagnostics", () => {
            var counters = new WindowDiagnosticAccumulator(); counters.Start(7);
            foreach (var reason in Enum.GetValues<CloseReason>()) counters.RecordClose(reason);
            var result = counters.Take()!;
            foreach (var reason in Enum.GetValues<CloseReason>()) Equal(1, result.Counts["W11" + reason]);
            counters.RecordClose(CloseReason.Completed); Equal(true, counters.Take() is null);
            counters.Start(8);
            for (int i = 0; i < 1005; i++) counters.RecordClose(CloseReason.Completed);
            Equal(1000, counters.Take()!.Counts["W11Completed"]);
        });
        Check("diagnostic stop summary is consumed once and cannot leak into a stopped trial", () => {
            var counters = new WindowDiagnosticAccumulator();
            counters.Record(WindowDiagnosticReason.RawClient); Equal(true, counters.Take() is null);
            counters.Start(7); counters.Record(WindowDiagnosticReason.RawClient); counters.Record(WindowDiagnosticReason.RawClient);
            var first = counters.Take()!; Equal(7, first.Generation); Equal(2, first.Counts["RawClient"]);
            counters.Record(WindowDiagnosticReason.RawClient); Equal(true, counters.Take() is null);
            counters.Start(8); var second = counters.Take()!; Equal(8, second.Generation); Equal(0, second.Counts["RawClient"]);
            Equal(2, first.Counts["RawClient"]);
            counters.Start(9); for (int i = 0; i < 1005; i++) counters.Record(WindowDiagnosticReason.MouseDown);
            Equal(1000, counters.Take()!.Counts["MouseDown"]); Equal(true, counters.Take() is null);
        });
        Check("general target eligibility is independent of process names and excludes nonordinary windows", () => {
            bool Allowed(uint process = 42, long style = WS_CAPTION, long extended = 0, bool owned = false,
                bool? cloaked = false, string? windowClass = "CabinetWClass", bool ordinary = true) =>
                WindowTargetPolicy.Allows(process, 7, style, extended, owned, cloaked, windowClass, ordinary);
            foreach (string cls in new[] { "CabinetWClass", "Notepad", "Chrome_WidgetWin_1", "custom-standard-caption" }) Equal(true, Allowed(windowClass: cls));
            Equal(false, Allowed(process: 0)); Equal(false, Allowed(process: 7)); Equal(false, Allowed(ordinary: false));
            Equal(true, Allowed(style: 0)); Equal(false, Allowed(style: WS_CAPTION | 0x40000000));
            Equal(false, Allowed(extended: 0x80)); Equal(false, Allowed(extended: 0x08000000));
            Equal(false, Allowed(owned: true)); Equal(false, Allowed(cloaked: true)); Equal(false, Allowed(cloaked: null));
            Equal(false, Allowed(windowClass: null)); Equal(false, Allowed(windowClass: ""));
            foreach (string cls in new[] { "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Progman", "WorkerW", "XamlExplorerHostIslandWindow", "MultitaskingViewFrame" })
                Equal(false, Allowed(windowClass: cls));
        });
        void Sample(WindowCandidate candidate, string? expected) => samples.Add(new {
            candidate = CandidateProtocol.V2(candidate, samples.Count + 1, samples.Count + 1), expected });

        foreach (bool restore in new[] { false, true })
            foreach (string source in new[] { "caption", "client", "unknown", "other-root", "other-process" })
                Check($"child titlebar double-click: restore={restore}, {source}", () => {
                    var tracker = Tracker(); var before = restore ? max : start; var after = restore ? start : max;
                    int child = source == "client" ? 1 : source == "unknown" ? -1 : HTCAPTION;
                    int hit = WindowCaption.ResolveChildCaption(1, child, source != "other-root", source != "other-process");
                    tracker.Mouse(11, before, hit, default, 0, 500, 0, false, true);
                    tracker.Mouse(11, before, hit, default, 100, 500, 0, false, true);
                    var evidence = (WindowCandidate)tracker.Complete(11, before, after, 150, 11, "2026-10-28", screen)!;
                    Equal(source == "caption" ? "mouse" : "unknown", evidence.origin);
                    Sample(evidence, source == "caption" ? restore ? "W04" : "W03" : null);
                });
        Check("child caption starts the same bounded top-drag transaction", () => {
            var tracker = Tracker(); int hit = WindowCaption.ResolveChildCaption(1, HTCAPTION, true, true);
            tracker.Mouse(11, start, hit, default, 0, 500, 0, false, true); tracker.MoveStart(11, 100);
            Equal<object?>(null, tracker.Complete(11, start, max, 200, 11, "2026-10-28", screen));
            tracker.MouseReleased(new Point { X = 900, Y = 0 }, screen, screen, 0);
            var evidence = (WindowCandidate)tracker.FinishMove(11, max, 5000, 11, "2026-10-28")!;
            Equal("caption-top-drag", evidence.route); Equal(100L, evidence.inputAgeMs); Sample(evidence, "W03");
        });

        Check("invalid custom title geometry retains explicit root caption and restore hits", () => {
            var title = new TitleInfo { State = new uint[6], Bounds = new Rect[6] };
            var window = new Rect { Right = 100, Bottom = 100 };
            title.Bounds[3] = new Rect { Left = 20, Right = 40, Bottom = 20 };
            foreach (int hit in new[] { HTCAPTION, HTMINBUTTON, HTMAXBUTTON, HTCLOSE })
                Equal(hit, WindowCaption.Hit(title, window, new Point { X = 25, Y = 10 }, hit));
            foreach (int hit in new[] { 1, 0, -1, 10, 12 })
                Equal(-1, WindowCaption.Hit(title, window, new Point { X = 25, Y = 10 }, hit));
            foreach (bool doubleClick in new[] { false, true }) {
                var tracker = Tracker();
                int hit = WindowCaption.Hit(title, window, default, doubleClick ? HTCAPTION : HTMAXBUTTON);
                tracker.Mouse(11, max, hit, default, 0, 500, 0, false, true);
                if (doubleClick) tracker.Mouse(11, max, hit, default, 100, 500, 0, false, true);
                var candidate = (WindowCandidate)tracker.Complete(11, max, start, 150, 11, "2026-10-28", screen)!;
                Equal("mouse", candidate.origin); Equal(doubleClick ? "caption-double-click" : "max-button", candidate.route);
                Sample(candidate, "W04");
            }
        });
        Check("caption rectangles identify standard buttons even when hit test returns caption", () => {
            var info = new TitleInfo { State = new uint[6], Bounds = new Rect[6] };
            var window = new Rect { Left = 0, Top = 0, Right = 100, Bottom = 100 };
            info.Bounds[2] = new Rect { Left = 10, Top = 0, Right = 20, Bottom = 20 };
            info.Bounds[3] = new Rect { Left = 20, Top = 0, Right = 30, Bottom = 20 };
            info.Bounds[5] = new Rect { Left = 30, Top = 0, Right = 40, Bottom = 20 };
            Equal(HTMINBUTTON, WindowCaption.Hit(info, window, new Point { X = 15, Y = 10 }, HTCAPTION));
            Equal(HTMAXBUTTON, WindowCaption.Hit(info, window, new Point { X = 25, Y = 10 }, HTCAPTION));
            foreach (uint flag in new uint[] { 1, 0x8000, 0x10000 }) {
                info.State[2] = flag;
                Equal(-1, WindowCaption.Hit(info, window, new Point { X = 15, Y = 10 }, HTMINBUTTON));
            }
            info.Bounds[3] = info.Bounds[2];
            Equal(-1, WindowCaption.Hit(info, window, new Point { X = 15, Y = 10 }, -1));
            Equal(HTMINBUTTON, WindowCaption.Hit(info, window, new Point { X = 15, Y = 10 }, HTMINBUTTON));
        });

        // State callbacks during the drag are not independent W04/W03 operations.
        foreach (string mode in new[] { "direct", "no-release", "interior", "cancel", "injected", "other-window",
            "process", "layout", "cross-monitor", "no-maximize", "duplicate", "stop" })
            Check($"direct top maximize: {mode}", () => {
                var tracker = Tracker();
                tracker.Mouse(11, start, HTCAPTION, default, 0, 500, 0, false, true);
                tracker.MoveStart(11, 100);
                Equal<object?>(null, tracker.Complete(11, start, max, 200, 11, "2026-10-28", screen));
                if (mode != "no-release") tracker.MouseReleased(new Point { X = 900, Y = mode == "interior" ? 180 : 0 },
                    screen, screen, mode == "injected" ? LLMHF_INJECTED : 0);
                if (mode == "cancel") tracker.Key(11, start, 0x1b, false, false, 300, 0);
                if (mode == "stop") tracker.Reset(2);
                var after = mode switch {
                    "process" => max with { Process = 8 }, "layout" => max with { DisplayLayout = "changed" },
                    "cross-monitor" => max with { Monitor = new(1920, 0, 1920, 1080) },
                    "no-maximize" => start, _ => max };
                var result = tracker.FinishMove(11, after, 5000, mode == "other-window" ? 12 : 11, "2026-10-28");
                bool valid = mode is "direct" or "duplicate";
                Equal(valid, result is WindowCandidate);
                if (valid) {
                    var evidence = (WindowCandidate)result!;
                    Equal("maximize", evidence.operation); Equal("caption-top-drag", evidence.route);
                    Equal(100L, evidence.inputAgeMs); Sample(evidence, "W03");
                }
                Equal<object?>(null, tracker.FinishMove(11, max, 5001, 11, "2026-10-28"));
            });

        foreach (string route in new[] { "max-button", "caption-double-click", "win-down", "min-normal", "min-max" })
            Check($"W04 confirmed route: {route}", () => {
                var tracker = Tracker();
                var before = route == "min-normal" ? start : max;
                var after = route.StartsWith("min-") ? min : start;
                if (route == "win-down") tracker.Key(11, before, VK_DOWN, true, false, 0, 0);
                else {
                    int hit = route.StartsWith("min-") ? HTMINBUTTON : route == "max-button" ? HTMAXBUTTON : HTCAPTION;
                    tracker.Mouse(11, before, hit, default, 0, 500, 0, false, true);
                    if (route == "caption-double-click") tracker.Mouse(11, before, hit, default, 100, 500, 0, false, true);
                }
                Sample((WindowCandidate)tracker.Complete(11, before, after, 200, route.StartsWith("min-") ? 12 : 11,
                    "2026-10-28", screen)!, "W04");
                Equal<object?>(null, tracker.Complete(11, after, after, 201, 11, "2026-10-28", screen));
            });

        foreach (long at in new long[] { 1000, 1001 })
            Check($"W04 physical second press at {at}", () => {
                var tracker = Tracker(); tracker.Key(11, max, VK_DOWN, true, false, 0, 0);
                Sample((WindowCandidate)tracker.Complete(11, max, start, 50, 11, "2026-10-28", screen)!, "W04");
                tracker.KeyReleased(VK_DOWN); tracker.Key(11, start, VK_DOWN, true, false, at, 0);
                var second = tracker.Complete(11, start, min, at + 50, 12, "2026-10-28", screen);
                Equal(at > 1000, second is WindowCandidate);
                if (second is WindowCandidate c) Sample(c, "W04");
            });
        foreach (uint flag in new uint[] { 0, 1, LLKHF_INJECTED, LLKHF_LOWER_IL_INJECTED })
            Check($"W04 full Win release/repress sequence, modifier flags {flag}", () => {
                var tracker = Tracker();
                tracker.Key(11, null, VK_LWIN, false, false, 0, 1);
                tracker.Key(11, max, VK_DOWN, true, false, 10, 0);
                tracker.Complete(11, max, start, 50, 11, "2026-10-28", screen);
                tracker.KeyReleased(VK_DOWN); tracker.KeyReleased(VK_LWIN);
                tracker.Key(11, null, VK_LWIN, false, false, 200, flag);
                tracker.Key(11, start, VK_DOWN, true, false, 210, 0);
                var second = tracker.Complete(11, start, min, 250, 12, "2026-10-28", screen);
                bool injected = (flag & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0;
                Equal(injected, second is WindowCandidate);
            });
        Check("W04 independent maximize then reduction is not swallowed by grouping", () => {
            var tracker = Tracker(); tracker.Key(11, max, VK_DOWN, true, false, 0, 0);
            tracker.Complete(11, max, start, 50, 11, "2026-10-28", screen);
            tracker.KeyReleased(VK_DOWN);
            // A later press starts at maximized again; it is not normal -> minimized continuation.
            tracker.Key(11, max, VK_DOWN, true, false, 200, 0);
            var result = tracker.Complete(11, max, start, 250, 11, "2026-10-28", screen);
            Equal(true, result is WindowCandidate); Sample((WindowCandidate)result!, "W04");
        });
        foreach (string reason in new[] { "program", "win-m", "win-d", "arranged", "injected", "wrong-target", "unknown", "drag-restore" })
            Check($"W04 rejection: {reason}", () => {
                var tracker = Tracker(); var before = reason == "arranged" ? start with { Arranged = true } : max;
                if (reason == "drag-restore") {
                    tracker.Mouse(11, max, HTCAPTION, default, 0, 500, 0, false, true); tracker.MoveStart(11, 10);
                    Equal<object?>(null, tracker.Complete(11, max, start, 20, 11, "2026-10-28", screen)); return;
                }
                if (reason != "program") tracker.Key(reason == "wrong-target" ? 12 : 11,
                    reason == "unknown" ? null : before, reason == "win-m" ? 0x4du : reason == "win-d" ? 0x44u : VK_DOWN,
                    true, false, 0, reason == "injected" ? LLKHF_INJECTED : 0);
                Sample((WindowCandidate)tracker.Complete(11, before, min, 50, 12, "2026-10-28", screen)!, null);
            });
        return samples;
    }
}
