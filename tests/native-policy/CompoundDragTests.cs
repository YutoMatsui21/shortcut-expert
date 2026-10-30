using static NativeMethods;

internal static partial class Program
{
    private static readonly List<object> compoundSamples = new();
    private static void CheckCompoundDrags()
    {
        var start = normal with { Monitor = new(-1920, 0, 1920, 1080), Work = new(-1920, 0, 1920, 1040),
            Dpi = 96, DisplayLayout = "pair", HorizontalPair = true };
        Check("compound quarter shares the side tolerance without emitting a partial monitor move", () => {
            var monitor = new MonitorBounds(0, 0, 1920, 1080); var work = new MonitorBounds(0, 0, 1920, 1040);
            var after = start with { Monitor = monitor, Work = work, Arranged = true, Frame = new(0, 0, 960, 520) };
            foreach (int distance in new[] { 8, 9 }) {
                var tracker = Tracker(); tracker.Mouse(11, start, HTCAPTION, default, 0, 500, 0, false, true); tracker.MoveStart(11, 100);
                tracker.MouseReleased(new Point { X = distance, Y = 0 }, monitor, work, 0);
                var result = tracker.FinishMove(11, after, 5000, 11, "2026-10-28");
                Equal(distance == 8, result is CompoundMoveResult);
                if (distance == 9) Equal<object?>(null, result);
            }
        });
        foreach (string terminal in new[] { "maximized", "left-top", "right-bottom" })
        foreach (string mode in new[] { "valid", "direction-unknown", "no-release", "injected", "release-injected", "conflict", "cancel", "process", "layout",
            "window", "foreground", "return", "interior", "program", "stop", "destroy" })
            Check($"compound {terminal}/{mode}", () => {
                var tracker = Tracker();
                var monitor = new MonitorBounds(0, 0, 1920, 1080); var work = new MonitorBounds(0, 0, 1920, 1040);
                var after = start with { Monitor = monitor, Work = work, Show = terminal == "maximized" ? SW_SHOWMAXIMIZED : SW_SHOWNORMAL,
                    Arranged = terminal != "maximized", Frame = terminal == "left-top" ? new(0, 0, 960, 520) : new(960, 520, 960, 520) };
                if (mode == "direction-unknown") after = after with { HorizontalPair = false };
                if (mode == "process") after = after with { Process = 8 };
                if (mode == "layout") after = after with { DisplayLayout = "changed" };
                if (mode == "return") after = after with { Monitor = start.Monitor, Work = start.Work };
                if (mode != "program") tracker.Mouse(11, start, HTCAPTION, default, 0, 500, mode == "injected" ? LLMHF_INJECTED : 0, false, true);
                tracker.MoveStart(11, 100);
                // Both restoration and an intermediate half belong to the pending drag.
                if (mode != "program") Equal<object?>(null, tracker.Complete(11, start with { Show = SW_SHOWMAXIMIZED }, start, 200, 11, "2026-10-28", start.Monitor));
                if (mode != "program") Equal<object?>(null, tracker.Complete(11, start, after with { Arranged = true, Frame = new(0, 0, 960, 1040) }, 250, 11, "2026-10-28", monitor));
                if (mode != "no-release") tracker.MouseReleased(new Point { X = mode == "interior" ? 500 : terminal == "right-bottom" ? 1919 : 0,
                    Y = mode == "interior" ? 180 : terminal == "right-bottom" ? 1039 : 0 }, after.Monitor, after.Work, mode == "release-injected" ? LLMHF_INJECTED : 0);
                if (mode is "cancel" or "conflict") tracker.Key(11, null, mode == "cancel" ? 0x1bu : VK_SHIFT, false, false, 300, 0);
                if (mode == "foreground") tracker.ForegroundChanged(12);
                if (mode == "stop") tracker.Reset(2);
                if (mode == "destroy") tracker.Forget(11);
                var result = tracker.FinishMove(mode == "window" ? 12 : 11, after, 5000, mode == "foreground" ? 12 : 11, "2026-10-28");
                bool accepted = mode is "valid" or "direction-unknown";
                Equal(accepted, result is CompoundMoveResult);
                if (result is CompoundMoveResult compound) {
                    var emitted = new List<object>(); var protocol = new CandidateProtocol(emitted.Add); protocol.Start(1, 2);
                    protocol.Compound(1, "2026-10-28", compound); Equal(1, emitted.Count);
                    compoundSamples.Add(emitted[0]);
                    protocol.Stop(); protocol.Compound(1, "2026-10-28", compound); Equal(1, emitted.Count);
                }
                Equal<object?>(null, tracker.FinishMove(11, after, 5001, 11, "2026-10-28"));
            });
    }
}
