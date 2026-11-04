using static NativeMethods;

internal static partial class Program
{
    private static readonly List<object> compoundSamples = new();

    private static void CheckCompoundDrags()
    {
        var start = normal with
        {
            Monitor = new(-1920, 0, 1920, 1080),
            Work = new(-1920, 0, 1920, 1040),
            Dpi = 96,
            DisplayLayout = "pair",
            HorizontalPair = true,
        };
        foreach (int gap in new[] { 3, 8, 33, 64, 65, 500 })
            Check(
                $"cross-monitor top preview is atomic within OS threshold {gap}",
                () =>
                {
                    var before = start with { MouseDockThresholdPx = 64 };
                    var destination = new MonitorBounds(0, 0, 1920, 1080);
                    var work = destination with { height = 1040 };
                    var after = before with
                    {
                        Monitor = destination,
                        Work = work,
                        Show = SW_SHOWMAXIMIZED,
                    };
                    var tracker = Tracker();
                    tracker.Mouse(11, before, HTCAPTION, default, 0, 500, 0, false, true);
                    tracker.MoveStart(11, 100);
                    tracker.MouseReleased(new Point { X = 900, Y = gap }, destination, work, 0);
                    var result = tracker.FinishMove(11, after, 5000, 11, "2026-10-31");
                    Equal(gap <= 64, result is CompoundMoveResult);
                    if (gap > 64)
                        Equal<object?>(null, result); // no partial W02 fallback
                }
            );
        Check(
            "release diagnostic distinguishes event, physical cursor and prior corner contact",
            () =>
            {
                var probe = new WindowDragReleaseProbe();
                var reasons = new List<WindowDiagnosticReason>();
                var monitor = new MonitorBounds(0, -1440, 2560, 1440);
                var work = monitor with { height = 1392 };
                var corner = new Point { X = 0, Y = -1440 };
                var inside = new Point { X = 80, Y = -1300 };
                probe.Sample(new Point { X = 300, Y = 100 }, 0);
                probe.Sample(corner, 0);
                probe.Record(inside, monitor, work, corner, inside, reasons.Add);
                foreach (
                    var reason in new[]
                    {
                        WindowDiagnosticReason.ReleaseWorkLeftSame,
                        WindowDiagnosticReason.ReleaseWorkLeft65To128,
                        WindowDiagnosticReason.ReleaseBeforeFar,
                        WindowDiagnosticReason.ReleaseAfterEqual,
                        WindowDiagnosticReason.ReleaseObserverCursorShift,
                        WindowDiagnosticReason.DragExtremaAtMonitorTopLeft,
                        WindowDiagnosticReason.DragExtremaAtWorkTopLeft,
                        WindowDiagnosticReason.DragLastAtMonitorLeft,
                        WindowDiagnosticReason.ReleaseLastMotionFar,
                    }
                )
                    Equal(true, reasons.Contains(reason));
                Equal(false, reasons.Contains(WindowDiagnosticReason.ReleaseEventAtMonitorLeft));
                reasons.Clear();
                probe = new();
                probe.Sample(corner, LLMHF_INJECTED);
                probe.Record(corner, monitor, work with { x = 80 }, null, null, reasons.Add);
                foreach (
                    var reason in new[]
                    {
                        WindowDiagnosticReason.ReleaseWorkLeftDifferent,
                        WindowDiagnosticReason.ReleaseEventAtMonitorLeft,
                        WindowDiagnosticReason.ReleaseBeforeUnavailable,
                        WindowDiagnosticReason.ReleaseAfterUnavailable,
                        WindowDiagnosticReason.DragInjectedMotionObserved,
                        WindowDiagnosticReason.DragLastMotionInjected,
                    }
                )
                    Equal(true, reasons.Contains(reason));
                Equal(false, reasons.Contains(WindowDiagnosticReason.DragExtremaAtMonitorTopLeft));
            }
        );
        Check(
            "release diagnostic cannot change edge admission and retires with the drag",
            () =>
            {
                var monitor = new MonitorBounds(0, 0, 1920, 1080);
                var work = new MonitorBounds(0, 0, 1920, 1040);
                var after = start with
                {
                    Monitor = monitor,
                    Work = work,
                    Arranged = true,
                    Frame = new(0, 0, 960, 520),
                };
                foreach (int distance in new[] { 0, 80 })
                {
                    object? Run(bool diagnostics)
                    {
                        var tracker = Tracker();
                        var reasons = new List<WindowDiagnosticReason>();
                        if (diagnostics)
                            tracker.Diagnostic = reasons.Add;
                        tracker.Mouse(11, start, HTCAPTION, default, 0, 500, 0, false, true);
                        tracker.MoveStart(11, 100);
                        tracker.MouseMoved(default, 0);
                        tracker.MouseReleased(
                            new Point { X = distance, Y = 0 },
                            monitor,
                            work,
                            0,
                            default(Point),
                            default(Point)
                        );
                        Equal(diagnostics, reasons.Contains(WindowDiagnosticReason.ReleaseSampled));
                        var result = tracker.FinishMove(11, after, 5000, 11, "2026-10-28");
                        Equal(false, tracker.HasDrag);
                        int count = reasons.Count;
                        tracker.MouseMoved(default, 0);
                        tracker.MouseReleased(default, monitor, work, 0);
                        Equal(count, reasons.Count);
                        return result;
                    }
                    var expected = Run(false);
                    Equal(expected, Run(true));
                    Equal(distance == 0, expected is CompoundMoveResult);
                }
            }
        );
        Check(
            "vertical compound carries stable two-display proof without a spatial left/right direction",
            () =>
            {
                var upper = new MonitorBounds(-1920, -1440, 2560, 1440);
                foreach (bool proven in new[] { false, true })
                {
                    var before = start with { TwoDisplayPair = proven };
                    var after = before with
                    {
                        Monitor = upper,
                        Work = upper with { height = 1400 },
                        Show = SW_SHOWMAXIMIZED,
                        HorizontalPair = false,
                        TwoDisplayPair = true,
                    };
                    var tracker = Tracker();
                    tracker.Mouse(11, before, HTCAPTION, default, 0, 500, 0, false, true);
                    tracker.MoveStart(11, 100);
                    tracker.MouseReleased(
                        new Point { X = upper.x + 500, Y = upper.y },
                        upper,
                        after.Work,
                        0
                    );
                    var result =
                        tracker.FinishMove(11, after, 500, 11, "2026-10-28") as CompoundMoveResult;
                    Equal(true, result is not null);
                    Equal(proven, result!.TwoDisplayLayoutConfirmed);
                    Equal<string?>(null, result.MoveDirection);
                    var emitted = new List<object>();
                    var protocol = new CandidateProtocol(emitted.Add);
                    protocol.Start(1, 2);
                    protocol.Compound(1, "2026-10-28", result);
                    Equal(
                        proven,
                        (
                            (CompoundDragEvidence)((CandidateEnvelope)emitted[0]).evidence
                        ).twoDisplayLayoutConfirmed
                    );
                }
            }
        );
        Check(
            "OS docking preview remains one compound result or rejects both operations",
            () =>
            {
                var monitor = new MonitorBounds(0, 0, 1920, 1080);
                var work = new MonitorBounds(0, 0, 1920, 1040);
                var before = start with { MouseDockThresholdPx = 64 };
                var after = before with
                {
                    Monitor = monitor,
                    Work = work,
                    Arranged = true,
                    Frame = new(0, 0, 960, 520),
                };
                foreach (int distance in new[] { 33, 64, 65, 500 })
                {
                    var tracker = Tracker();
                    tracker.Mouse(11, before, HTCAPTION, default, 0, 500, 0, false, true);
                    tracker.MoveStart(11, 100);
                    tracker.MouseReleased(new Point { X = distance, Y = 0 }, monitor, work, 0);
                    var result = tracker.FinishMove(11, after, 5000, 11, "2026-10-28");
                    Equal(distance <= 64, result is CompoundMoveResult);
                    if (distance > 64)
                        Equal<object?>(null, result);
                }
            }
        );
        Check(
            "compound quarter shares the side tolerance without emitting a partial monitor move",
            () =>
            {
                var monitor = new MonitorBounds(0, 0, 1920, 1080);
                var work = new MonitorBounds(0, 0, 1920, 1040);
                var after = start with
                {
                    Monitor = monitor,
                    Work = work,
                    Arranged = true,
                    Frame = new(0, 0, 960, 520),
                };
                foreach (int distance in new[] { 8, 9 })
                {
                    var tracker = Tracker();
                    tracker.Mouse(11, start, HTCAPTION, default, 0, 500, 0, false, true);
                    tracker.MoveStart(11, 100);
                    tracker.MouseReleased(new Point { X = distance, Y = 0 }, monitor, work, 0);
                    var result = tracker.FinishMove(11, after, 5000, 11, "2026-10-28");
                    Equal(distance == 8, result is CompoundMoveResult);
                    if (distance == 9)
                        Equal<object?>(null, result);
                }
            }
        );
        foreach (string terminal in new[] { "maximized", "left-top", "right-bottom" })
        foreach (
            string mode in new[]
            {
                "valid",
                "direction-unknown",
                "no-release",
                "injected",
                "release-injected",
                "conflict",
                "cancel",
                "process",
                "layout",
                "window",
                "foreground",
                "return",
                "interior",
                "program",
                "stop",
                "destroy",
            }
        )
            Check(
                $"compound {terminal}/{mode}",
                () =>
                {
                    var tracker = Tracker();
                    var monitor = new MonitorBounds(0, 0, 1920, 1080);
                    var work = new MonitorBounds(0, 0, 1920, 1040);
                    var after = start with
                    {
                        Monitor = monitor,
                        Work = work,
                        Show = terminal == "maximized" ? SW_SHOWMAXIMIZED : SW_SHOWNORMAL,
                        Arranged = terminal != "maximized",
                        Frame =
                            terminal == "left-top" ? new(0, 0, 960, 520) : new(960, 520, 960, 520),
                    };
                    if (mode == "direction-unknown")
                        after = after with { HorizontalPair = false };
                    if (mode == "process")
                        after = after with { Process = 8 };
                    if (mode == "layout")
                        after = after with { DisplayLayout = "changed" };
                    if (mode == "return")
                        after = after with { Monitor = start.Monitor, Work = start.Work };
                    if (mode != "program")
                        tracker.Mouse(
                            11,
                            start,
                            HTCAPTION,
                            default,
                            0,
                            500,
                            mode == "injected" ? LLMHF_INJECTED : 0,
                            false,
                            true
                        );
                    tracker.MoveStart(11, 100);
                    // Both restoration and an intermediate half belong to the pending drag.
                    if (mode != "program")
                        Equal<object?>(
                            null,
                            tracker.Complete(
                                11,
                                start with
                                {
                                    Show = SW_SHOWMAXIMIZED,
                                },
                                start,
                                200,
                                11,
                                "2026-10-28",
                                start.Monitor
                            )
                        );
                    if (mode != "program")
                        Equal<object?>(
                            null,
                            tracker.Complete(
                                11,
                                start,
                                after with
                                {
                                    Arranged = true,
                                    Frame = new(0, 0, 960, 1040),
                                },
                                250,
                                11,
                                "2026-10-28",
                                monitor
                            )
                        );
                    if (mode != "no-release")
                        tracker.MouseReleased(
                            new Point
                            {
                                X =
                                    mode == "interior" ? 500
                                    : terminal == "right-bottom" ? 1919
                                    : 0,
                                Y =
                                    mode == "interior" ? 180
                                    : terminal == "right-bottom" ? 1039
                                    : 0,
                            },
                            after.Monitor,
                            after.Work,
                            mode == "release-injected" ? LLMHF_INJECTED : 0
                        );
                    if (mode is "cancel" or "conflict")
                        tracker.Key(
                            11,
                            null,
                            mode == "cancel" ? 0x1bu : VK_SHIFT,
                            false,
                            false,
                            300,
                            0
                        );
                    if (mode == "foreground")
                        tracker.ForegroundChanged(12);
                    if (mode == "stop")
                        tracker.Reset(2);
                    if (mode == "destroy")
                        tracker.Forget(11);
                    var result = tracker.FinishMove(
                        mode == "window" ? 12 : 11,
                        after,
                        5000,
                        mode == "foreground" ? 12 : 11,
                        "2026-10-28"
                    );
                    bool accepted = mode is "valid" or "direction-unknown";
                    Equal(accepted, result is CompoundMoveResult);
                    if (result is CompoundMoveResult compound)
                    {
                        var emitted = new List<object>();
                        var protocol = new CandidateProtocol(emitted.Add);
                        protocol.Start(1, 2);
                        protocol.Compound(1, "2026-10-28", compound);
                        Equal(1, emitted.Count);
                        compoundSamples.Add(emitted[0]);
                        protocol.Stop();
                        protocol.Compound(1, "2026-10-28", compound);
                        Equal(1, emitted.Count);
                    }
                    Equal<object?>(null, tracker.FinishMove(11, after, 5001, 11, "2026-10-28"));
                }
            );
    }
}
