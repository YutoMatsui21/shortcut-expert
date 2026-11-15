using static NativeMethods;

internal static partial class Program
{
    private static List<object> IndependentDragBoundaryTests()
    {
        var samples = new List<object>();
        foreach (
            string mode in new[]
            {
                "normal",
                "same-max",
                "same-quarter",
                "placed-cross-quarter",
                "placed-same-quarter",
                "unchanged-quarter",
                "captionless",
                "dock-change",
                "layout-change",
                "process-change",
                "release-work",
                "no-move-start",
            }
        )
            Check(
                "independent drag boundary " + mode,
                () =>
                {
                    var before = IndependentNormal();
                    if (mode.StartsWith("placed"))
                        before = before with { Arranged = true, Frame = new(0, 0, 960, 1040) };
                    if (mode == "unchanged-quarter")
                        before = before with { Arranged = true, Frame = new(0, 0, 960, 520) };
                    if (mode == "captionless")
                        before = before with { HasCaption = false };
                    bool same =
                        mode.StartsWith("same")
                        || mode is "placed-same-quarter" or "unchanged-quarter";
                    var after = same
                        ? before
                        : before with
                        {
                            Monitor = new(1920, 0, 1920, 1080),
                            Work = new(1920, 0, 1920, 1040),
                        };
                    if (mode != "normal")
                        after = mode.Contains("quarter")
                            ? after with
                            {
                                Arranged = true,
                                Frame = new(after.Work!.x, 0, 960, 520),
                            }
                            : after with
                            {
                                Show = SW_SHOWMAXIMIZED,
                                Arranged = false,
                            };
                    if (mode == "dock-change")
                        after = after with { MouseDockThresholdPx = 32 };
                    if (mode == "layout-change")
                        after = after with { DisplayLayout = "changed" };
                    if (mode == "process-change")
                        after = after with { Process = 8 };
                    var f = new IndependentRouterFixture();
                    f.Router.Dispatch(
                        new MousePressEvent(
                            1,
                            11,
                            0,
                            before,
                            mode == "captionless" ? 1 : HTCAPTION,
                            default,
                            500,
                            0,
                            false,
                            true
                        )
                    );
                    if (mode != "no-move-start")
                        f.Router.Dispatch(new ObservedEvent(ObservedKind.MoveStart, 1, 11, 100));
                    f.Router.Dispatch(
                        new MouseReleaseEvent(
                            1,
                            200,
                            new() { X = after.Work!.x },
                            after.Monitor,
                            mode == "release-work" ? before.Work : after.Work,
                            0,
                            null,
                            null
                        )
                    );
                    f.Router.Dispatch(new MoveEndEvent(1, 11, 5000, after, 11, "2026-11-15"));
                    f.Router.Dispatch(new MoveEndEvent(1, 11, 5001, after, 11, "2026-11-15"));
                    string? expected = mode switch
                    {
                        "normal" => "W02",
                        "same-max" => "W03",
                        "same-quarter" or "placed-same-quarter" => "W07",
                        "placed-cross-quarter" => "W02,W07",
                        "captionless" => "W02,W03",
                        _ => null,
                    };
                    if (expected is null)
                    {
                        Equal(0, f.Output.Count);
                        return;
                    }
                    AddIndependentSample(samples, f, expected, "mouse");
                }
            );
        return samples;
    }
}
