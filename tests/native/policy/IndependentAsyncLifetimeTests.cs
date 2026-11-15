using static NativeMethods;

internal static partial class Program
{
    private static void IndependentAsyncLifetimeTests()
    {
        foreach (string terminal in new[] { "quarter", "max", "half" })
        foreach (bool tick in new[] { false, true })
            Check(
                $"asynchronous series retirement {terminal}/{tick}",
                () =>
                {
                    var f = new IndependentRouterFixture();
                    var before = IndependentNormal();
                    var half = before with { Arranged = true, Frame = new(0, 0, 960, 1040) };
                    f.Press(null, VK_LWIN, 0);
                    f.Press(before, VK_LEFT, 10);
                    f.Release(VK_LEFT, 20);
                    WindowState final = half;
                    if (terminal != "half")
                    {
                        f.Press(half, VK_UP, 30);
                        f.Release(VK_UP, 40);
                        final =
                            terminal == "max"
                                ? before with
                                {
                                    Show = SW_SHOWMAXIMIZED,
                                }
                                : half with
                                {
                                    Frame = new(0, 0, 960, 520),
                                };
                    }
                    f.Release(VK_LWIN, 60);
                    f.Result(terminal == "half" ? before : half, 70);
                    Equal(0, f.Output.Count);
                    if (tick)
                        f.Router.Dispatch(new TickEvent(1, 11, 120, final, 11, "2026-11-15"));
                    else
                        f.State(final, 120);
                    Equal(1, f.Output.Count);
                    StartNextIndependentQuarter(f, final);
                    Equal(2, f.Output.Count);
                    var first = (CandidateEnvelope)f.Output[0];
                    var second = (CandidateEnvelope)f.Output[1];
                    Equal(true, first.transaction != second.transaction);
                }
            );
    }

    private static void StartNextIndependentQuarter(IndependentRouterFixture f, WindowState before)
    {
        var half = before with
        {
            Show = SW_SHOWNORMAL,
            Arranged = true,
            Frame = new(960, 0, 960, 1040),
        };
        var quarter = half with { Frame = new(960, 520, 960, 520) };
        f.Press(null, VK_LWIN, 200);
        f.Press(before, VK_RIGHT, 210);
        f.Release(VK_RIGHT, 220);
        f.Press(half, VK_DOWN, 230);
        f.Release(VK_DOWN, 240);
        f.Release(VK_LWIN, 250);
        f.Result(quarter, 260);
    }
}
