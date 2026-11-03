using static NativeMethods;

internal static partial class Program
{
    private static readonly List<object> monitorMoveSamples = new();
    private static void CheckMonitorMoves()
    {
        var source = normal with { Monitor = new(-1920, 0, 1920, 1080), Work = new(-1920, 0, 1920, 1040),
            Dpi = 96, DisplayLayout = "stable-pair", HorizontalPair = true };
        var to = source with { Monitor = new(0, 0, 1920, 1080), Work = new(0, 0, 1920, 1040) };
        foreach (bool inputCaption in new[] { false, true })
            Check($"monitor move retains caption requirement on input/result: {inputCaption}", () => {
                var before = source with { HasCaption = inputCaption };
                var after = to with { HasCaption = !inputCaption };
                var tracker = Tracker();
                tracker.Key(11, before, VK_RIGHT, true, false, 0, 0, true);
                tracker.KeyReleased(VK_RIGHT);
                Equal<object?>(null, tracker.Complete(11, before, after, 200, 11, "2026-10-28", after.Monitor));
                tracker = Tracker();
                tracker.Mouse(11, before, HTCAPTION, default, 0, 500, 0, false, true);
                tracker.MoveStart(11, 100);
                tracker.MouseReleased(default, after.Monitor, after.Work, 0);
                Equal<object?>(null, tracker.FinishMove(11, after, 200, 11, "2026-10-28"));
            });
        foreach (string mode in new[] { "accepted", "same-monitor", "no-release", "release-monitor", "release-work",
            "end-state", "unstable", "injected", "unmatched", "foreground" })
            Check($"normal monitor drag diagnostics preserve decision: {mode}", () => {
                var after = mode switch { "same-monitor" => source, "end-state" => to with { Arranged = null },
                    "unstable" => to with { Dpi = 0 }, _ => to };
                object? Run(Action<WindowDiagnosticReason>? diagnostic) {
                    var tracker = Tracker(); tracker.Diagnostic = diagnostic;
                    tracker.Mouse(11, source, HTCAPTION, default, 0, 500,
                        mode == "injected" ? LLMHF_INJECTED : 0, false, mode != "unmatched");
                    tracker.MoveStart(11, 100);
                    if (mode != "no-release") tracker.MouseReleased(default,
                        mode == "release-monitor" ? source.Monitor : after.Monitor,
                        mode == "release-work" ? source.Work : after.Work, 0);
                    return tracker.FinishMove(11, after, 500, mode == "foreground" ? 12 : 11, "2026-10-28");
                }
                var reasons = new List<string>(); var expected = Run(null); var actual = Run(r => reasons.Add(r.ToString()));
                Equal(expected, actual);
                Equal(mode == "accepted", actual is WindowCandidate);
                string reason = mode switch { "accepted" => "MoveAccepted", "same-monitor" => "MoveSameMonitor",
                    "no-release" => "DragReleaseUnknown", "release-monitor" => "MoveReleaseMonitorMismatch",
                    "release-work" => "MoveReleaseWorkMismatch", "end-state" => "MoveEndStateInvalid",
                    "unstable" => "MoveUnstable", "foreground" => "MoveForegroundMismatch", _ => "MoveInputInvalid" };
                Equal(true, reasons.Contains(reason));
            });
        Check("two-display proof excludes incomplete, overlapping and three-display layouts", () => {
            var upper = new MonitorBounds(-1920, -1440, 2560, 1440);
            Equal(true, MonitorMovePolicy.TwoDisplays(new[] { source.Monitor!, upper }));
            Equal(true, MonitorMovePolicy.TwoDisplays(new[] { source.Monitor!, to.Monitor! with { y = -300 } }));
            Equal(false, MonitorMovePolicy.TwoDisplays(new[] { source.Monitor! }));
            Equal(false, MonitorMovePolicy.TwoDisplays(new[] { source.Monitor!, upper, to.Monitor! }));
            Equal(false, MonitorMovePolicy.TwoDisplays(new[] { source.Monitor!, source.Monitor! }));
            Equal(false, MonitorMovePolicy.TwoDisplays(new[] { source.Monitor!, source.Monitor! with { y = -100 } }));
            Equal(false, MonitorMovePolicy.TwoDisplays(new[] { source.Monitor!, upper with { width = 0 } }));
            foreach (bool proven in new[] { false, true }) {
                var tracker = Tracker();
                var before = source with { TwoDisplayPair = proven };
                var after = to with { Monitor = upper, Work = upper with { height = 1400 },
                    HorizontalPair = false, TwoDisplayPair = true };
                tracker.Mouse(11, before, HTCAPTION, default, 0, 500, 0, false, true);
                tracker.MoveStart(11, 100);
                tracker.MouseReleased(new Point { X = upper.x + 500, Y = upper.y + 400 }, upper, after.Work, 0);
                var result = tracker.FinishMove(11, after, 500, 11, "2026-10-28") as WindowCandidate;
                Equal(true, result is not null);
                Equal(proven, result!.twoDisplayLayoutConfirmed);
                Equal<string?>(null, result.moveDirection);
                var wire = CandidateProtocol.V2(result, 1, 1).evidence as WindowEvidence;
                Equal(proven, wire!.result.twoDisplayLayoutConfirmed);
            }
        });
        foreach (string mode in new[] { "normal", "maximized-start", "vertical", "unaligned", "mixed-dpi", "no-release",
            "cancel", "injected", "conflict", "other-target", "process", "layout", "unknown-layout", "dpi-change",
            "return", "half", "maximized-end", "unknown-arranged", "program", "stop" })
            Check($"W02 terminal drag {mode}", () => {
                var tracker = Tracker();
                var before = mode == "maximized-start" ? source with { Show = SW_SHOWMAXIMIZED } : source;
                var after = mode switch {
                    "vertical" => to with { Monitor = new(-1920, -1080, 1920, 1080), HorizontalPair = false },
                    "unaligned" => to with { Monitor = new(0, -300, 1920, 1080), HorizontalPair = false },
                    "mixed-dpi" => to with { Dpi = 144, HorizontalPair = false },
                    "process" => to with { Process = 8 }, "layout" => to with { DisplayLayout = "changed" },
                    "unknown-layout" => to with { DisplayLayout = null },
                    "dpi-change" => source with { Dpi = 144 }, "return" => source,
                    "half" => to with { Arranged = true }, "maximized-end" => to with { Show = SW_SHOWMAXIMIZED },
                    "unknown-arranged" => to with { Arranged = null }, _ => to };
                if (mode != "program") tracker.Mouse(11, before, HTCAPTION, default, 0, 500,
                    mode == "injected" ? LLMHF_INJECTED : 0, false, true);
                tracker.MoveStart(11, 100);
                Equal<object?>(null, tracker.Complete(11, before, to, 200, 11, "2026-10-28", to.Monitor));
                if (mode is "cancel" or "conflict") tracker.Key(11, null, mode == "cancel" ? 0x1Bu : VK_SHIFT, false, false, 300, 0);
                if (mode != "no-release") tracker.MouseReleased(new Point { X = after.Monitor!.x + 500, Y = after.Monitor.y + 400 },
                    after.Monitor, after.Work, 0);
                if (mode == "stop") tracker.Reset(2);
                var result = tracker.FinishMove(mode == "other-target" ? 12 : 11, after, 5000, 11, "2026-10-28");
                bool accepted = mode is "normal" or "maximized-start" or "vertical" or "unaligned" or "mixed-dpi";
                Equal(accepted, result is WindowCandidate);
                if (result is WindowCandidate c) {
                    Equal("monitor-move", c.operation);
                    Equal<string?>(mode is "vertical" or "unaligned" or "mixed-dpi" ? null : "right", c.moveDirection);
                    int id = 2000 + monitorMoveSamples.Count;
                    monitorMoveSamples.Add(new { candidate = CandidateProtocol.V2(c, id, id), expected = "W02" });
                }
                Equal<object?>(null, tracker.FinishMove(11, after, 5001, 11, "2026-10-28"));
            });
        foreach (string mode in new[] { "right", "left", "vertical", "unaligned", "mixed-dpi", "return", "single",
            "layout", "unknown-layout", "unknown-dpi", "injected", "modifier", "foreground", "process", "program", "stop", "expired" })
            Check($"W02 key {mode}", () => {
                var tracker = Tracker(); var before = source;
                var after = mode switch {
                    "left" => source, "vertical" => to with { Monitor = new(-1920, -1080, 1920, 1080), HorizontalPair = false },
                    "unaligned" => to with { Monitor = new(0, -300, 1920, 1080), HorizontalPair = false },
                    "mixed-dpi" => to with { Dpi = 144, HorizontalPair = false },
                    "return" or "single" => source, "layout" => to with { DisplayLayout = "changed" },
                    "unknown-layout" => to with { DisplayLayout = null }, "unknown-dpi" => to with { Dpi = 0 },
                    "process" => to with { Process = 8 }, _ => to };
                if (mode == "left") before = to;
                uint key = (uint)(mode == "left" ? VK_LEFT : VK_RIGHT);
                if (mode != "program") tracker.Key(11, before, key, true, false, 0,
                    mode == "injected" ? LLKHF_INJECTED : 0, shiftDown: true);
                Equal<object?>(null, tracker.Complete(11, before, after, 20, 11, "2026-10-28", after.Monitor));
                tracker.KeyReleased(key);
                if (mode == "modifier") tracker.Key(11, null, VK_CONTROL, false, false, 10, 0);
                if (mode == "foreground") tracker.ForegroundChanged(12);
                if (mode == "stop") tracker.Reset(2);
                var result = tracker.Complete(11, before, after, mode == "expired" ? 1001 : 100, 11, "2026-10-28", after.Monitor) as WindowCandidate;
                bool accepted = mode is "right" or "left" or "vertical" or "unaligned" or "mixed-dpi";
                if (accepted) Equal(true, result is not null);
                if (result is not null) {
                    int id = 2000 + monitorMoveSamples.Count;
                    monitorMoveSamples.Add(new { candidate = CandidateProtocol.V2(result, id, id), expected = accepted ? "W02" : null });
                }
                else Equal(false, accepted);
                Equal<object?>(null, tracker.Complete(11, after, after, 101, 11, "2026-10-28", after.Monitor));
            });
        Check("W02 held repeat compares the original monitor with the release result", () => {
            var tracker = Tracker(); tracker.Key(11, source, VK_RIGHT, true, false, 0, 0, shiftDown: true);
            Equal<object?>(null, tracker.Complete(11, source, to, 20, 11, "2026-10-28", to.Monitor));
            tracker.Key(11, to, VK_RIGHT, true, false, 50, 0, shiftDown: true);
            tracker.KeyReleased(VK_RIGHT);
            Equal<object?>(null, tracker.FinishKey(11, source, 100, false, "2026-10-28"));
        });
        Check("W02 cross-monitor top terminal is retained locally without a partial candidate", () => {
            var tracker = Tracker(); tracker.Mouse(11, source, HTCAPTION, default, 0, 500, 0, false, true);
            tracker.MoveStart(11, 100); tracker.MouseReleased(new Point { X = 500, Y = 0 }, to.Monitor, to.Work, 0);
            var terminal = tracker.FinishMove(11, to with { Show = SW_SHOWMAXIMIZED }, 5000, 11, "2026-10-28") as CompoundMoveResult;
            Equal(true, terminal is not null); Equal(source.Monitor, terminal!.FromMonitor); Equal(to.Monitor, terminal.ToMonitor);
            Equal("maximized", terminal.Terminal); Equal(1, terminal.Transaction);
        });
    }
}
