using static NativeMethods;

internal static partial class Program
{
    private static void IndependentReductionTests()
    {
        foreach (string route in new[] { "restore", "minimize", "fallback", "key" })
        foreach (
            string mode in new[]
            {
                "valid",
                "no-release",
                "cancel",
                "process",
                "drag",
                "expired",
                "foreign",
                "stop",
            }
        )
            Check($"independent reduction {route}/{mode}", () => ReplayReduction(route, mode));
    }

    private static void ReplayReduction(string route, string mode)
    {
        var f = new IndependentRouterFixture();
        var before = IndependentNormal() with { Show = SW_SHOWMAXIMIZED };
        var after = before with { Show = route == "minimize" ? SW_SHOWMINIMIZED : SW_SHOWNORMAL };
        PressReduction(f, before, route);
        f.State(after, 20);
        Equal(0, f.Output.Count);
        ReleaseReduction(f, before, route, mode);
        if (mode == "process")
            after = after with { Process = 8 };
        f.State(after, mode == "expired" ? 1011 : 40, foreground: mode == "foreign" ? 12 : 11);
        bool valid = ValidReductionResult(route, mode);
        Equal(valid ? 1 : 0, f.Output.Count);
        if (valid)
            AssertReduction(f, route, after);
    }

    private static bool ValidReductionResult(string route, string mode) =>
        mode == "valid" || mode == "foreign" && route == "minimize";

    private static void PressReduction(IndependentRouterFixture f, WindowState before, string route)
    {
        if (route == "key")
            f.Press(before, VK_DOWN, 10);
        else
            f.Router.Dispatch(
                new MousePressEvent(
                    1,
                    11,
                    10,
                    before,
                    route == "minimize" ? HTMINBUTTON
                        : route == "fallback" ? 1
                        : HTMAXBUTTON,
                    default,
                    500,
                    0,
                    false,
                    true
                )
            );
    }

    private static void ReleaseReduction(
        IndependentRouterFixture f,
        WindowState before,
        string route,
        string mode
    )
    {
        if (mode == "cancel")
            f.Tracker.ClearInput();
        if (mode == "drag")
            f.Router.Dispatch(new ObservedEvent(ObservedKind.MoveStart, 1, 11, 25));
        if (mode != "no-release")
        {
            if (route == "key")
                f.Release(VK_DOWN, 30);
            else
                f.Router.Dispatch(
                    new MouseReleaseEvent(
                        1,
                        30,
                        default,
                        before.Monitor,
                        before.Work,
                        0,
                        null,
                        null
                    )
                );
        }
        if (mode == "stop")
            f.Session.Stop();
    }

    private static void AssertReduction(IndependentRouterFixture f, string route, WindowState after)
    {
        var envelope = (CandidateEnvelope)f.Output.Single();
        Equal(true, envelope.evidence is IndependentResultsEvidence);
        Equal(1, ((IndependentResultsEvidence)envelope.evidence).results.Count);
        independentMouseSamples.Add(
            new
            {
                line = System.Text.Json.JsonSerializer.Serialize(envelope),
                expected = new[] { "W04" },
                origin = route == "key" ? "key" : "mouse",
            }
        );
        f.State(after, 50);
        Equal(1, f.Output.Count);
    }
}
