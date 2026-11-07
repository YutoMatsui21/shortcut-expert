using static NativeMethods;

internal static partial class Program
{
    private static void CheckMouseReposition(List<object> placementSamples)
    {
        var start = normal with
        {
            Monitor = new(0, 0, 1920, 1080),
            Work = new(0, 0, 1920, 1040),
            Dpi = 96,
            DisplayLayout = "stable",
            Frame = new(960, 0, 960, 1040),
            Arranged = true,
        };
        foreach (string operation in new[] { "max", "half", "quarter" })
        foreach (
            string mode in new[]
            {
                "valid",
                "same",
                "unknown",
                "unknown-arranged",
                "resize",
                "custom-resize",
                "cancel",
                "late-end-after-cancel",
                "layout",
                "process",
                "release",
                "expired",
                "foreground",
                "no-start",
                "no-press",
                "injected",
                "release-work",
                "work-change",
                "dpi-change",
                "mixed-dpi",
                "duplicate",
            }
        )
            Check(
                $"production reposition {operation}/{mode}",
                () =>
                {
                    var before =
                        operation == "max"
                            ? start with
                            {
                                Show = SW_SHOWMAXIMIZED,
                                Arranged = false,
                            }
                        : operation == "quarter" ? start with { Frame = new(0, 0, 960, 520) }
                        : start;
                    var after = operation switch
                    {
                        "max" => before with
                        {
                            Monitor = new(1920, 0, 1920, 1080),
                            Work = new(1920, 0, 1920, 1040),
                        },
                        "half" => start with { Frame = new(0, 0, 960, 1040) },
                        _ => start with { Frame = new(960, 0, 960, 520) },
                    };
                    if (mode == "same")
                        after = before;
                    if (mode == "unknown")
                        before = before with { Arranged = true, Frame = null };
                    if (mode == "unknown-arranged")
                        before = before with { Arranged = null };
                    if (mode == "layout")
                        after = after with { DisplayLayout = "changed" };
                    if (mode == "process")
                        after = after with { Process = 99 };
                    if (mode == "work-change")
                        after = after with { Work = after.Work! with { height = 1000 } };
                    if (mode is "dpi-change" or "mixed-dpi")
                        after = after with { Dpi = 144 };
                    // An unknown-hit ordinary resize changes size, not monitor/show/arranged placement.
                    if (mode == "custom-resize")
                        after = before with { Frame = new(100, 100, 700, 600), Arranged = false };
                    var tracker = Tracker();
                    if (mode != "no-press")
                        tracker.Mouse(
                            11,
                            before,
                            mode == "resize" ? 10
                                : mode == "custom-resize" ? 1
                                : HTCAPTION,
                            default,
                            0,
                            500,
                            mode == "injected" ? 1u : 0u,
                            false,
                            true
                        );
                    if (mode != "no-start")
                        tracker.MoveStart(11, mode == "expired" ? 1001 : 100);
                    if (mode == "cancel")
                        tracker.Key(11, null, 0x1b, false, false, 200, 0);
                    if (mode != "release")
                        tracker.MouseReleased(
                            new Point
                            {
                                X =
                                    operation == "max" ? 2800
                                    : operation == "half" ? 0
                                    : 1919,
                                Y = 0,
                            },
                            after.Monitor,
                            mode == "release-work"
                                ? before.Work! with
                                {
                                    height = 900,
                                }
                                : after.Work,
                            0
                        );
                    if (mode == "late-end-after-cancel")
                        tracker.ClearInput();
                    var result = tracker.FinishMove(
                        11,
                        after,
                        500,
                        mode == "foreground" ? 12 : 11,
                        "2026-10-28"
                    );
                    bool accepted =
                        mode is "valid" or "duplicate"
                        || operation == "max"
                            && mode
                                is "unknown"
                                    or "unknown-arranged"
                                    or "mixed-dpi"
                                    or "dpi-change"
                                    or "work-change";
                    Equal(
                        accepted
                            ? operation == "max"
                                ? "W02"
                                : operation == "half"
                                    ? "W06"
                                    : "W07"
                            : "",
                        string.Join(',', MouseDetectionShadow.CurrentOperations(result))
                    );
                    if (mode == "duplicate")
                        Equal<object?>(null, tracker.FinishMove(11, after, 600, 11, "2026-11-07"));
                    if (result is PlacementResult placement)
                    {
                        int id = 1000 + placementSamples.Count;
                        placementSamples.Add(
                            new
                            {
                                candidate = new CandidateEnvelope(
                                    "candidate",
                                    2,
                                    1,
                                    id,
                                    id,
                                    "2026-10-28",
                                    "mouse",
                                    "caption-edge-drag",
                                    false,
                                    false,
                                    placement.Evidence
                                ),
                                expected = operation == "half" ? "W06" : "W07",
                            }
                        );
                    }
                    if (result is WindowCandidate c)
                    {
                        int id = 2000 + monitorMoveSamples.Count;
                        monitorMoveSamples.Add(
                            new { candidate = CandidateProtocol.V2(c, id, id), expected = "W02" }
                        );
                    }
                }
            );
    }
}
