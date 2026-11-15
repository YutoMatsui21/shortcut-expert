using static NativeMethods;

internal static partial class Program
{
    private static readonly List<object> independentMouseSamples = new();

    private static void IndependentInputTests()
    {
        IndependentCaptionTests();
        Equal(true, DetectionMigration.Enabled(null));
        Equal(true, DetectionMigration.Enabled("independent"));
        Equal(false, DetectionMigration.Enabled("legacy"));
        foreach (
            string mode in new[]
            {
                "key-move",
                "key-max",
                "key-quarter",
                "key-half",
                "click",
                "double-click",
                "fallback",
                "no-release",
                "injected",
                "foreign",
                "cancel",
                "expired",
            }
        )
            Check("independent input " + mode, () => IndependentInputCase(mode));
    }

    private static void IndependentInputCase(string mode)
    {
        var before = IndependentNormal() with { HorizontalPair = false, TwoDisplayPair = false };
        var f = new IndependentRouterFixture();
        if (mode.StartsWith("key-"))
            ReplayIndependentKey(f, before, mode);
        else
            ReplayIndependentMouse(f, before, mode);
        AssertIndependentInput(f, mode);
    }

    private static void ReplayIndependentKey(
        IndependentRouterFixture f,
        WindowState before,
        string mode
    )
    {
        f.Press(null, VK_LWIN, 0);
        uint key = mode == "key-max" ? (uint)VK_UP : VK_LEFT;
        f.Press(before, key, 10, mode == "key-move");
        var after = IndependentKeyResult(before, mode);
        f.Release(key, 20);
        if (mode == "key-quarter")
        {
            f.Press(after, VK_UP, 30);
            after = after with { Frame = new(0, 0, 960, 520) };
            f.Release(VK_UP, 40);
        }
        f.State(after, 50);
        Equal(mode == "key-move" ? 1 : 0, f.Output.Count);
        f.Release(VK_LWIN, 60);
        f.Result(after, 70);
    }

    private static WindowState IndependentKeyResult(WindowState before, string mode) =>
        mode switch
        {
            "key-move" => before with
            {
                Monitor = new(1920, 0, 1920, 1080),
                Work = new(1920, 0, 1920, 1040),
            },
            "key-quarter" or "key-half" => before with
            {
                Arranged = true,
                Frame = new(0, 0, 960, 1040),
            },
            _ => before with { Show = SW_SHOWMAXIMIZED },
        };

    private static void ReplayIndependentMouse(
        IndependentRouterFixture f,
        WindowState before,
        string mode
    )
    {
        var after = before with { Show = SW_SHOWMAXIMIZED };
        int hit = mode switch
        {
            "fallback" => 1,
            "double-click" => HTCAPTION,
            _ => HTMAXBUTTON,
        };
        if (mode == "double-click")
            f.Router.Dispatch(
                new MousePressEvent(1, 11, 0, before, hit, default, 500, 0, false, true)
            );
        f.Router.Dispatch(
            new MousePressEvent(
                1,
                11,
                10,
                before,
                hit,
                default,
                500,
                mode == "injected" ? LLMHF_INJECTED : 0,
                false,
                true
            )
        );
        f.State(after, 20);
        Equal(0, f.Output.Count);
        if (mode == "cancel")
            f.Tracker.ClearInput();
        if (mode != "no-release")
            f.Router.Dispatch(
                new MouseReleaseEvent(1, 30, default, before.Monitor, before.Work, 0, null, null)
            );
        f.State(after, mode == "expired" ? 1011 : 40, foreground: mode == "foreign" ? 12 : 11);
    }

    private static void AssertIndependentInput(IndependentRouterFixture f, string mode)
    {
        bool valid = mode is not ("no-release" or "injected" or "foreign" or "cancel" or "expired");
        Equal(valid ? 1 : 0, f.Output.Count);
        if (!valid)
            return;
        var envelope = (CandidateEnvelope)f.Output.Single();
        if (mode == "key-half")
        {
            Equal(true, envelope.evidence is PlacementEvidence);
            return;
        }
        string operation = mode switch
        {
            "key-move" => "W02",
            "key-quarter" => "W07",
            _ => "W03",
        };
        independentMouseSamples.Add(
            new
            {
                line = System.Text.Json.JsonSerializer.Serialize(envelope),
                expected = new[] { operation },
                origin = mode.StartsWith("key-") ? "key" : "mouse",
            }
        );
        var proofs = ((IndependentResultsEvidence)envelope.evidence).results;
        Equal(1, proofs.Count);
        Equal(true, ProofMatchesOperation(proofs[0], operation));
    }

    private static bool ProofMatchesOperation(IndependentProof proof, string operation) =>
        operation switch
        {
            "W02" => proof is IndependentMonitorMoveProof,
            "W07" => proof is IndependentPlacementProof,
            _ => proof is IndependentStateProof,
        };
}
