using static NativeMethods;

internal static partial class Program
{
    private static void RetainedWindowOperationTests()
    {
        foreach (
            string mode in new[]
            {
                "min-button",
                "max-min-button",
                "fallback-min",
                "restore-button",
                "restore-double-click",
                "key-min",
                "key-restore",
                "key-grouped-down",
                "half",
            }
        )
            Check(
                "retained window parity " + mode,
                () =>
                {
                    var legacy = RetainedWindowCase(mode, false);
                    var migrated = RetainedWindowCase(mode, true);
                    Equal(1, legacy.Length);
                    Equal(true, legacy.SequenceEqual(migrated));
                }
            );
    }

    private sealed record WindowTransition(WindowState Before, WindowState After);

    private static CandidateEnvelope[] RetainedWindowCase(string mode, bool independent)
    {
        var f = new IndependentRouterFixture(independent);
        var transition = RetainedTransition(mode);
        if (mode == "half")
            ReplayRetainedHalf(f, transition.Before);
        else if (mode.StartsWith("key-"))
            ReplayRetainedKey(f, transition, mode);
        else
            ReplayRetainedMouse(f, transition, mode);
        return f.Output.Cast<CandidateEnvelope>().ToArray();
    }

    private static WindowTransition RetainedTransition(string mode)
    {
        var before = IndependentNormal();
        if (
            mode.StartsWith("restore")
            || mode is "max-min-button" or "key-restore" or "key-grouped-down"
        )
            before = before with { Show = SW_SHOWMAXIMIZED };
        var after = before with
        {
            Show =
                mode.Contains("restore") || mode == "key-grouped-down"
                    ? SW_SHOWNORMAL
                    : SW_SHOWMINIMIZED,
        };
        return new(before, after);
    }

    private static void ReplayRetainedHalf(IndependentRouterFixture f, WindowState before)
    {
        f.Press(null, VK_LWIN, 0);
        f.Press(before, VK_LEFT, 10);
        f.Release(VK_LEFT, 20);
        f.Release(VK_LWIN, 30);
        f.Result(before with { Arranged = true, Frame = new(0, 0, 960, 1040) }, 40);
    }

    private static void ReplayRetainedKey(
        IndependentRouterFixture f,
        WindowTransition t,
        string mode
    )
    {
        f.Press(t.Before, VK_DOWN, 10);
        f.State(t.After, 20, foreground: t.After.Show == SW_SHOWMINIMIZED ? 12 : 11);
        f.Release(VK_DOWN, 30);
        if (mode != "key-grouped-down")
            return;
        f.Press(t.After, VK_DOWN, 40);
        f.State(t.After with { Show = SW_SHOWMINIMIZED }, 50, foreground: 12);
        f.Release(VK_DOWN, 60);
    }

    private static void ReplayRetainedMouse(
        IndependentRouterFixture f,
        WindowTransition t,
        string mode
    )
    {
        int hit = mode switch
        {
            "restore-button" => HTMAXBUTTON,
            "restore-double-click" => HTCAPTION,
            "fallback-min" => 1,
            _ => HTMINBUTTON,
        };
        if (mode.EndsWith("double-click"))
            f.Router.Dispatch(
                new MousePressEvent(1, 11, 0, t.Before, hit, default, 500, 0, false, true)
            );
        f.Router.Dispatch(
            new MousePressEvent(1, 11, 10, t.Before, hit, default, 500, 0, false, true)
        );
        f.Router.Dispatch(
            new MouseReleaseEvent(1, 30, default, t.Before.Monitor, t.Before.Work, 0, null, null)
        );
        f.State(t.After, 40, foreground: t.After.Show == SW_SHOWMINIMIZED ? 12 : 11);
    }
}
