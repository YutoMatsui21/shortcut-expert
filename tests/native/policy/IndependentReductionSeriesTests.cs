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
        foreach (var scenario in reductionDepartures)
            Check(
                "WinDown minimize with " + scenario.Name,
                () => CheckReductionDeparture(scenario)
            );
        Check(
            "WinDown waits for verified foreground after terminal state",
            () => CheckTerminalBeforeForeground(true)
        );
        Check(
            "WinDown poll preserves standalone minimize when foreground is missing",
            () => CheckTerminalBeforeForeground(false)
        );
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

    private sealed record DepartureScenario(string Name)
    {
        internal uint? StartTick { get; init; } = 103;
        internal uint DepartureTick { get; init; } = 103;
        internal bool Iconic { get; init; } = true;
        internal bool DeliverStartLast { get; init; }
        internal bool ExtraDeparture { get; init; }
        internal nint FinalForeground { get; init; } = 12;
        internal int Count { get; init; } = 2;
    }

    private static readonly DepartureScenario[] reductionDepartures =
    [
        new("terminal") { Count = 1 },
        new("unrelated") { Iconic = false },
        new("without-start") { StartTick = null },
        new("delayed-departure") { DepartureTick = 102 },
        new("pre-press-start") { StartTick = 99 },
        new("start-tied-to-press") { StartTick = 100 },
        new("departure-delivered-first") { DeliverStartLast = true },
        new("later-departure") { DepartureTick = 104 },
        new("second-departure") { ExtraDeparture = true, FinalForeground = 13 },
        new("foreground-mismatch") { FinalForeground = 13 },
    ];

    private static GestureManager.Gesture PressReductionAgain(
        IndependentRouterFixture f,
        WindowState before
    )
    {
        f.Router.Dispatch(
            new KeyPressEvent(1, 11, 100, before, VK_DOWN, true, false, 0, NativeTick: 100)
        );
        return f.Tracker.Gestures.Current!;
    }

    private static void DispatchReductionDeparture(
        IndependentRouterFixture f,
        WindowState before,
        DepartureScenario scenario
    )
    {
        MinimizeStartedEvent? start = scenario.StartTick is { } tick
            ? new(1, 11, 103, before.Process, tick)
            : null;
        if (start is not null && !scenario.DeliverStartLast)
            f.Router.Dispatch(start);
        (nint Window, uint Process)? iconic = scenario.Iconic ? (11, before.Process) : null;
        f.Router.Dispatch(new ForegroundObservedEvent(1, 12, 105, scenario.DepartureTick, iconic));
        if (start is not null && scenario.DeliverStartLast)
            f.Router.Dispatch(start);
        if (scenario.ExtraDeparture)
            f.Router.Dispatch(
                new ForegroundObservedEvent(1, 13, 106, scenario.DepartureTick, iconic)
            );
    }

    private static void CheckReductionDeparture(DepartureScenario scenario)
    {
        var f = RestoredReductionFixture();
        var before = IndependentNormal();
        var minimized = before with { Show = SW_SHOWMINIMIZED };
        var gesture = PressReductionAgain(f, before);
        DispatchReductionDeparture(f, before, scenario);
        f.State(minimized, 107, foreground: scenario.FinalForeground);
        Equal(GestureManager.Phase.Observing, gesture.State);
        Equal(1, f.Output.Count);
        f.Release(VK_DOWN, 110);
        f.State(minimized, 120, foreground: scenario.FinalForeground);
        Equal(GestureManager.Phase.Completed, gesture.State);
        Equal(scenario.Count, f.Output.Count);
    }

    private static void CheckTerminalBeforeForeground(bool matchingForegroundArrives)
    {
        var f = RestoredReductionFixture();
        var before = IndependentNormal();
        var minimized = before with { Show = SW_SHOWMINIMIZED };
        var gesture = PressReductionAgain(f, before);
        f.Release(VK_DOWN, 105);
        f.Router.Dispatch(new MinimizeStartedEvent(1, 11, 108, before.Process, 103));
        f.State(minimized, 109, foreground: 12);
        Equal(GestureManager.Phase.AwaitingResult, gesture.State);
        Equal(1, f.Output.Count);
        if (matchingForegroundArrives)
            f.Router.Dispatch(new ForegroundObservedEvent(1, 12, 110, 103, (11, before.Process)));
        f.Router.Dispatch(new TickEvent(1, 11, 150, minimized, 12, "2026-11-15"));
        Equal(GestureManager.Phase.Completed, gesture.State);
        Equal(matchingForegroundArrives ? 1 : 2, f.Output.Count);
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
