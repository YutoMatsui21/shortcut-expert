using static NativeMethods;

internal static partial class Program
{
    private static List<object> CheckWindowStates()
    {
        var samples = new List<object>();
        var screen = new MonitorBounds(0, 0, 1920, 1080);
        var start = normal with { Monitor = screen, DisplayLayout = "stable" };
        var max = start with { Show = SW_SHOWMAXIMIZED };
        var min = start with { Show = SW_SHOWMINIMIZED };
        void Sample(WindowCandidate candidate, string? expected) => samples.Add(new {
            candidate = CandidateProtocol.V2(candidate, samples.Count + 1, samples.Count + 1), expected });

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
            Equal(-1, WindowCaption.Hit(info, window, new Point { X = 15, Y = 10 }, HTMINBUTTON));
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
