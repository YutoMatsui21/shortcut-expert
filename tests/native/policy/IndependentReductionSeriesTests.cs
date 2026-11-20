using ShortcutExpert.Detection;
using static NativeMethods;

internal static partial class Program
{
    private static void IndependentReductionSeriesTests()
    {
        foreach (nint destroyed in new nint[] { 11, 12 })
            Check(
                $"independent reduction destroy {destroyed}",
                () =>
                {
                    var f = RestoredReductionFixture();
                    f.Router.Dispatch(new ObservedEvent(ObservedKind.Destroy, 1, destroyed, 50));
                    var before = IndependentNormal();
                    CompleteReductionKey(
                        f,
                        new(before, before with { Show = SW_SHOWMINIMIZED }),
                        100
                    );
                    Equal(destroyed == 11 ? 2 : 1, f.Output.Count);
                }
            );
        Check(
            "independent reduction starting maximized is a separate operation",
            () =>
            {
                var f = RestoredReductionFixture();
                var before = IndependentNormal() with { Show = SW_SHOWMAXIMIZED };
                CompleteReductionKey(f, new(before, before with { Show = SW_SHOWMINIMIZED }), 100);
                Equal(2, f.Output.Count);
            }
        );
        foreach (long gap in new[] { 1000L, 1001L })
            Check($"independent WinDown grouping at {gap}ms", () => CheckReductionGap(gap));
        foreach (
            var mode in new[]
            {
                "terminal",
                "unrelated",
                "without-start",
                "delayed-departure",
                "pre-press-start",
                "start-tied-to-press",
                "departure-delivered-first",
                "later-departure",
                "second-departure",
                "foreground-mismatch",
            }
        )
            Check("WinDown minimize with " + mode, () => CheckReductionDeparture(mode));
        foreach (string interrupt in new[] { "key", "target", "foreground", "reset", "restart" })
            Check(
                "independent WinDown interrupted by " + interrupt,
                () => CheckReductionInterruption(interrupt)
            );
        foreach (long age in new[] { 1000L, 1001L })
            Check(
                $"independent WinDown repeat retains original {age}ms deadline",
                () => CheckReductionRepeat(age)
            );
        foreach (string mode in new[] { "boundary", "expired", "motion", "injected" })
            Check("independent reduction fallback " + mode, () => CheckReductionFallback(mode));
    }

    private static void CompleteReductionKey(
        IndependentRouterFixture f,
        WindowTransition transition,
        long at,
        nint target = 11
    )
    {
        f.Press(transition.Before, VK_DOWN, at, target: target);
        f.Release(VK_DOWN, at + 10);
        f.State(transition.After, at + 20, target, target);
        f.State(transition.After, at + 30, target, target);
    }

    private static IndependentRouterFixture RestoredReductionFixture()
    {
        var f = new IndependentRouterFixture();
        var before = IndependentNormal() with { Show = SW_SHOWMAXIMIZED };
        CompleteReductionKey(f, new(before, IndependentNormal()), 10);
        Equal(1, f.Output.Count);
        return f;
    }

    private static void CheckReductionGap(long gap)
    {
        var f = RestoredReductionFixture();
        var before = IndependentNormal();
        CompleteReductionKey(f, new(before, before with { Show = SW_SHOWMINIMIZED }), 10 + gap);
        Equal(gap == 1000 ? 1 : 2, f.Output.Count);
    }

    private static void CheckReductionDeparture(string mode)
    {
        var f = RestoredReductionFixture();
        var before = IndependentNormal();
        var minimized = before with { Show = SW_SHOWMINIMIZED };
        f.Router.Dispatch(
            new KeyPressEvent(1, 11, 100, before, VK_DOWN, true, false, 0, NativeTick: 100)
        );
        var gesture = f.Tracker.Gestures.Current!;
        uint startTick = mode switch
        {
            "pre-press-start" => 99,
            "start-tied-to-press" => 100,
            _ => 103,
        };
        var start = new MinimizeStartedEvent(1, 11, 103, before.Process, startTick);
        if (mode is not ("without-start" or "departure-delivered-first"))
            f.Router.Dispatch(start);
        uint departureTick = mode switch
        {
            "delayed-departure" => 102,
            "later-departure" => 104,
            _ => 103,
        };
        f.Router.Dispatch(
            new ForegroundObservedEvent(
                1,
                12,
                105,
                departureTick,
                mode == "unrelated" ? null : (11, before.Process)
            )
        );
        if (mode == "departure-delivered-first")
            f.Router.Dispatch(start);
        if (mode == "second-departure")
            f.Router.Dispatch(
                new ForegroundObservedEvent(1, 13, 106, departureTick, (11, before.Process))
            );
        nint foreground = mode is "second-departure" or "foreground-mismatch" ? 13 : 12;
        f.State(minimized, 107, foreground: foreground);
        Equal(GestureManager.Phase.Observing, gesture.State);
        Equal(1, f.Output.Count);
        f.Release(VK_DOWN, 110);
        f.State(minimized, 120, foreground: foreground);
        Equal(GestureManager.Phase.Completed, gesture.State);
        Equal(mode == "terminal" ? 1 : 2, f.Output.Count);
    }

    private static void CheckReductionInterruption(string interrupt)
    {
        var f = RestoredReductionFixture();
        BreakReductionSeries(f, interrupt);
        var before = IndependentNormal();
        CompleteReductionKey(
            f,
            new(before, before with { Show = SW_SHOWMINIMIZED }),
            100,
            interrupt == "target" ? 12 : 11
        );
        Equal(2, f.Output.Count);
    }

    private static void BreakReductionSeries(IndependentRouterFixture f, string interrupt)
    {
        switch (interrupt)
        {
            case "key":
                f.Router.Dispatch(
                    new KeyPressEvent(1, 11, 50, IndependentNormal(), 0x41, false, false, 0)
                );
                f.Release(0x41, 60);
                break;
            case "foreground":
                f.Router.Dispatch(new ObservedEvent(ObservedKind.Foreground, 1, 12, 50));
                f.Router.Dispatch(new ObservedEvent(ObservedKind.Foreground, 1, 11, 60));
                break;
            case "reset":
                f.Tracker.Reset(1);
                break;
            case "restart":
                f.Session.Stop();
                f.Session.Start(1);
                f.Tracker.Reset(1);
                f.Router.Reset(1);
                f.Sink.Start(1, 2);
                break;
        }
    }

    private static void CheckReductionRepeat(long age)
    {
        var f = new IndependentRouterFixture();
        var before = IndependentNormal() with { Show = SW_SHOWMAXIMIZED };
        f.Press(before, VK_DOWN, 10);
        f.Press(before, VK_DOWN, 900);
        f.Release(VK_DOWN, 950);
        f.State(IndependentNormal(), 10 + age);
        Equal(age == 1000 ? 1 : 0, f.Output.Count);
    }

    private static void CheckReductionFallback(string mode)
    {
        var f = new IndependentRouterFixture();
        var before = IndependentNormal() with { Show = SW_SHOWMAXIMIZED };
        f.Router.Dispatch(
            new MousePressEvent(
                1,
                11,
                10,
                before,
                1,
                default,
                500,
                mode == "injected" ? LLMHF_INJECTED : 0,
                false,
                true
            )
        );
        if (mode == "motion")
            f.Router.Dispatch(new MouseMoveEvent(1, 15, new() { X = 5 }, 0));
        f.Router.Dispatch(
            new MouseReleaseEvent(1, 20, default, before.Monitor, before.Work, 0, null, null)
        );
        f.State(IndependentNormal(), mode == "expired" ? 511 : 510);
        Equal(mode == "boundary" ? 1 : 0, f.Output.Count);
    }
}
