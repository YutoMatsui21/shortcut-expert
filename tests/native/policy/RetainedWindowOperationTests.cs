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

    private static CandidateEnvelope[] RetainedWindowCase(string mode, bool independent)
    {
        var f = new IndependentRouterFixture(independent);
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
        if (mode == "half")
        {
            f.Press(null, VK_LWIN, 0);
            f.Press(before, VK_LEFT, 10);
            f.Release(VK_LEFT, 20);
            f.Release(VK_LWIN, 30);
            after = before with { Arranged = true, Frame = new(0, 0, 960, 1040) };
            f.Result(after, 40);
        }
        else if (mode.StartsWith("key-"))
        {
            f.Press(before, VK_DOWN, 10);
            f.State(after, 20, foreground: after.Show == SW_SHOWMINIMIZED ? 12 : 11);
            f.Release(VK_DOWN, 30);
            if (mode == "key-grouped-down")
            {
                f.Press(after, VK_DOWN, 40);
                f.State(after with { Show = SW_SHOWMINIMIZED }, 50, foreground: 12);
                f.Release(VK_DOWN, 60);
            }
        }
        else
        {
            int hit = mode.StartsWith("restore")
                ? mode.EndsWith("double-click")
                    ? HTCAPTION
                    : HTMAXBUTTON
                : mode == "fallback-min"
                    ? 1
                    : HTMINBUTTON;
            if (mode.EndsWith("double-click"))
                f.Router.Dispatch(
                    new MousePressEvent(1, 11, 0, before, hit, default, 500, 0, false, true)
                );
            f.Router.Dispatch(
                new MousePressEvent(1, 11, 10, before, hit, default, 500, 0, false, true)
            );
            f.Router.Dispatch(
                new MouseReleaseEvent(1, 30, default, before.Monitor, before.Work, 0, null, null)
            );
            f.State(after, 40, foreground: after.Show == SW_SHOWMINIMIZED ? 12 : 11);
        }
        return f.Output.Cast<CandidateEnvelope>().ToArray();
    }
}
