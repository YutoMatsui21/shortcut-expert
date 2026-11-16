using static NativeMethods;

internal static partial class Program
{
    private static void IndependentHalfTests()
    {
        foreach (
            string mode in new[]
            {
                "normal",
                "right-left",
                "same",
                "unknown",
                "dpi",
                "quarter",
                "cancel",
                "separate",
            }
        )
            Check(
                "independent half terminal " + mode,
                () =>
                {
                    var f = new IndependentRouterFixture();
                    var before = IndependentNormal();
                    var half = before with { Arranged = true, Frame = new(0, 0, 960, 1040) };
                    if (mode == "right-left")
                        before = half with { Frame = new(960, 0, 960, 1040) };
                    if (mode == "same")
                        before = half;
                    if (mode == "unknown")
                        before = half with { Frame = new(0, 0, 700, 1040) };
                    if (mode == "dpi")
                    {
                        before = before with { Dpi = 144 };
                        half = half with { Dpi = 144 };
                    }
                    f.Press(null, VK_LWIN, 0);
                    f.Press(before, VK_LEFT, 10);
                    f.Release(VK_LEFT, 20);
                    f.State(half, 25);
                    Equal(0, f.Output.Count);
                    var final = half;
                    if (mode == "quarter")
                    {
                        f.Press(half, VK_UP, 30);
                        f.Release(VK_UP, 40);
                        final = half with { Frame = new(0, 0, 960, 520) };
                    }
                    if (mode == "cancel")
                        f.Tracker.ClearInput();
                    f.Release(VK_LWIN, 50);
                    f.Result(final, 60);
                    f.Result(final, 61);
                    bool rejected = mode is "same" or "unknown" or "cancel";
                    Equal(rejected ? 0 : 1, f.Output.Count);
                    if (rejected)
                        return;
                    var proof = (IndependentPlacementProof)
                        (
                            (IndependentResultsEvidence)((CandidateEnvelope)f.Output[0]).evidence
                        ).results.Single();
                    Equal(
                        mode == "quarter"
                            ? IndependentPlacementShape.LeftTop
                            : IndependentPlacementShape.LeftHalf,
                        proof.shape
                    );
                    if (mode != "separate")
                        return;
                    f.Press(null, VK_LWIN, 100);
                    f.Press(half, VK_UP, 110);
                    f.Release(VK_UP, 120);
                    f.Release(VK_LWIN, 130);
                    f.Result(half with { Frame = new(0, 0, 960, 520) }, 140);
                    Equal(2, f.Output.Count);
                }
            );
        foreach (bool same in new[] { false, true })
        {
            var after = IndependentNormal() with { Arranged = true, Frame = new(0, 0, 960, 1040) };
            var before = same ? after : after with { Frame = new(960, 0, 960, 1040) };
            var facts = new DragDetectionFacts(
                before,
                after,
                default,
                after.Monitor!,
                after.Work!,
                100,
                true,
                true
            );
            Equal(!same, HalfPlacementDetector.Drag(facts) is not null);
            Equal<IndependentProof?>(null, QuarterPlacementDetector.Drag(facts));
            Equal<IndependentProof?>(
                null,
                HalfPlacementDetector.Drag(facts with { CaptionPress = false })
            );
        }
    }
}
