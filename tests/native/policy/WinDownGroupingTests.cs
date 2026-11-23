using static NativeMethods;

internal static partial class Program
{
    private static void CheckWinDownGrouping()
    {
        foreach (
            string boundary in new[]
            {
                "continuous",
                "expired",
                "other-key",
                "other-window",
                "mouse",
                "reset",
                "foreground-return",
                "other-target-no-result",
            }
        )
            Check(
                $"Win+Down grouping: {boundary}",
                () =>
                {
                    var tracker = Tracker();
                    tracker.Key(11, maximized, VK_DOWN, true, false, 0, 0);
                    var first = tracker.Complete(
                        11,
                        maximized,
                        normal,
                        100,
                        11,
                        "2026-10-27",
                        null
                    );
                    Equal(true, first is WindowCandidate);
                    tracker.KeyReleased(VK_DOWN);
                    long at = boundary == "expired" ? 1101 : 200;
                    nint target = boundary == "other-window" ? 12 : 11;
                    InterruptReduction(tracker, boundary);
                    tracker.Key(target, normal, VK_DOWN, true, false, at, 0);
                    var second = tracker.Complete(
                        target,
                        normal,
                        normal with
                        {
                            Show = SW_SHOWMINIMIZED,
                        },
                        at + 100,
                        12,
                        "2026-10-27",
                        null
                    );
                    Equal(boundary != "continuous", second is WindowCandidate);
                }
            );
    }

    private static void CheckWinDownRepeat()
    {
        Check(
            "Win+Down repeat cannot renew input",
            () =>
            {
                var tracker = Tracker();
                tracker.Key(11, normal, VK_DOWN, true, false, 0, 0);
                tracker.Key(11, normal, VK_DOWN, true, false, 900, 0);
                var result = (WindowCandidate)
                    tracker.Complete(
                        11,
                        normal,
                        normal with
                        {
                            Show = SW_SHOWMINIMIZED,
                        },
                        1100,
                        12,
                        "2026-10-27",
                        null
                    )!;
                Equal("unknown", result.origin);
            }
        );
    }

    private static void InterruptReduction(CandidateTracker tracker, string boundary)
    {
        if (boundary == "other-key")
            tracker.Key(11, normal, 0x41, false, false, 150, 0);
        if (boundary == "mouse")
            tracker.Mouse(11, normal, HTCAPTION, default, 150, 500, 0, false, true);
        if (boundary == "reset")
            tracker.Reset(2);
        if (boundary == "foreground-return")
        {
            tracker.ForegroundChanged(12);
            tracker.ForegroundChanged(11);
        }
        if (boundary == "other-target-no-result")
        {
            tracker.Key(12, normal, VK_DOWN, true, false, 150, 0);
            tracker.KeyReleased(VK_DOWN);
        }
    }
}
