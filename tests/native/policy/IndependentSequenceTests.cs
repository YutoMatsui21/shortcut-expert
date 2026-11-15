using System.Text.Json;
using static NativeMethods;

internal static partial class Program
{
    private sealed class IndependentRouterFixture
    {
        internal readonly DetectionSession Session = new();
        internal readonly CandidateTracker Tracker;
        internal readonly DetectionRouter Router = new();
        internal readonly List<object> Output = new();
        internal readonly CandidateSink Sink;

        internal IndependentRouterFixture(bool independent = true)
        {
            Session.Start(1);
            Tracker = new(Session);
            Tracker.Reset(1);
            Sink = new(Output.Add);
            Sink.Start(1, 2);
            Router.Reset(1);
            new TrackerEventAdapter(
                Tracker,
                Sink,
                independent: independent ? new(Tracker, Session, Sink, () => "2026-11-15") : null
            ).Register(Router);
        }

        internal void Press(
            WindowState? before,
            uint key,
            long at,
            bool shift = false,
            uint flags = 0,
            nint target = 11
        ) =>
            Router.Dispatch(
                new KeyPressEvent(1, target, at, before, key, true, false, flags, shift)
            );

        internal void Release(uint key, long at) =>
            Router.Dispatch(new KeyReleaseEvent(1, at, key));

        internal void State(WindowState after, long at, nint target = 11, nint foreground = 11) =>
            Router.Dispatch(
                new StateObservedEvent(
                    1,
                    target,
                    at,
                    Tracker.Gestures.Current?.Start.State,
                    after,
                    foreground,
                    "2026-11-15",
                    after.Monitor
                )
            );

        internal void Result(WindowState after, long at, bool injected = false) =>
            Router.Dispatch(new KeyResultEvent(1, 11, at, after, injected, "2026-11-15"));
    }

    private static WindowState IndependentNormal() =>
        normal with
        {
            Monitor = new(0, 0, 1920, 1080),
            Work = new(0, 0, 1920, 1040),
            Dpi = 96,
            DisplayLayout = "pair",
            HorizontalPair = true,
            TwoDisplayPair = true,
        };

    private static List<object> IndependentSequenceTests()
    {
        RetainedWindowOperationTests();
        var samples = new List<object>();
        foreach (
            string mode in new[]
            {
                "valid",
                "unknown-arranged",
                "captionless-result",
                "captionless-start",
                "unreleased",
                "win-held",
                "cancel",
                "injected",
                "injected-release",
                "foreign",
                "process",
                "layout",
                "expired",
                "boundary",
                "duplicate",
                "reset",
                "stop",
            }
        )
            Check("independent WinUp lifecycle " + mode, () => CheckIndependentMax(mode, samples));
        foreach (
            string mode in new[]
            {
                "valid",
                "repeat",
                "unreleased",
                "return",
                "unknown",
                "layout",
                "process",
                "captionless",
                "expired",
                "duplicate",
            }
        )
            Check("independent monitor chord " + mode, () => CheckIndependentMove(mode, samples));
        foreach (
            string mode in new[]
            {
                "quarter",
                "max",
                "delayed-max",
                "delayed-max-stale-press",
                "delayed-bottom",
                "delayed-placement-after-max",
                "delayed-quarter",
                "transient-max",
                "dual-win",
                "unreleased",
                "cancel",
                "injected",
                "process",
                "layout",
                "work",
                "dpi",
                "expired",
                "last-expired",
                "duplicate",
            }
        )
            Check("independent held series " + mode, () => CheckIndependentSeries(mode, samples));
        return samples;
    }

    private static void AddIndependentSample(
        List<object> samples,
        IndependentRouterFixture f,
        string expected,
        string origin = "key"
    )
    {
        Equal(1, f.Output.Count);
        samples.Add(
            new
            {
                line = JsonSerializer.Serialize((CandidateEnvelope)f.Output.Single()),
                expected = expected.Split(','),
                origin,
            }
        );
    }

    private static void CheckIndependentMax(string mode, List<object> samples)
    {
        var f = new IndependentRouterFixture();
        var before = MaxInputSnapshot(mode);
        var after = before with
        {
            Show = SW_SHOWMAXIMIZED,
            HasCaption = mode != "captionless-result",
        };
        f.Press(null, VK_LWIN, 0);
        f.Press(before, VK_UP, 10, flags: mode == "injected" ? LLKHF_INJECTED : 0);
        f.State(after, 20);
        Equal(0, f.Output.Count);
        CancelIndependentMax(f, mode);
        ReleaseIndependentMax(f, mode);
        after = MutateSeriesResult(after, mode);
        long at =
            mode == "expired" ? 1011
            : mode == "boundary" ? 1010
            : 50;
        f.Result(after, at, mode == "injected-release");
        f.State(after, at + 1);
        bool valid =
            mode
            is "valid"
                or "unknown-arranged"
                or "captionless-result"
                or "captionless-start"
                or "boundary"
                or "duplicate";
        if (valid)
            AddIndependentSample(samples, f, "W03");
        else
            Equal(0, f.Output.Count);
    }

    private static WindowState MaxInputSnapshot(string mode) =>
        mode switch
        {
            "unknown-arranged" => IndependentNormal() with { Arranged = null },
            "captionless-start" => IndependentNormal() with { HasCaption = false },
            _ => IndependentNormal(),
        };

    private static void CancelIndependentMax(IndependentRouterFixture f, string mode)
    {
        switch (mode)
        {
            case "cancel":
                f.Tracker.ClearInput();
                break;
            case "reset":
                f.Tracker.Reset(1);
                f.Router.Reset(1);
                break;
            case "stop":
                f.Session.Stop();
                f.Router.Stop();
                break;
            case "foreign":
                f.Router.Dispatch(new ObservedEvent(ObservedKind.Foreground, 1, 12, 25));
                break;
        }
    }

    private static void ReleaseIndependentMax(IndependentRouterFixture f, string mode)
    {
        if (mode == "unreleased")
            return;
        f.Release(VK_UP, 30);
        if (mode != "win-held")
            f.Release(VK_LWIN, 40);
    }

    private static void CheckIndependentMove(string mode, List<object> samples)
    {
        var f = new IndependentRouterFixture();
        var before = IndependentNormal();
        var after = before with
        {
            Monitor = new(1920, 0, 1920, 1080),
            Work = new(1920, 0, 1920, 1040),
        };
        f.Press(null, VK_LWIN, 0);
        f.Press(before, VK_RIGHT, 10, true);
        f.State(after, 20);
        Equal(0, f.Output.Count);
        if (mode == "repeat")
            f.Press(after, VK_RIGHT, 30, true);
        if (mode != "unreleased")
            f.Release(VK_RIGHT, 40);
        after = mode switch
        {
            "return" => before,
            "unknown" => after with { Monitor = null },
            "captionless" => after with { HasCaption = false },
            _ => MutateSeriesResult(after, mode),
        };
        long at = mode == "expired" ? 1011 : 50;
        f.Result(after, at);
        f.Result(after, at + 1);
        bool valid = mode is "valid" or "repeat" or "duplicate";
        if (valid)
            AddIndependentSample(samples, f, "W02");
        else
            Equal(0, f.Output.Count);
    }

    private sealed record SeriesSnapshots(
        WindowState Before,
        WindowState Half,
        WindowState Quarter
    );

    private static void CheckIndependentSeries(string mode, List<object> samples)
    {
        var f = new IndependentRouterFixture();
        var states = BeginIndependentSeries(f, mode);
        var after = ApplyFinalSeriesInput(f, states, mode);
        if (mode == "cancel")
            f.Tracker.ClearInput();
        after = MutateSeriesResult(after, mode);
        ReleaseIndependentSeries(f, after, mode);
        long at =
            mode == "expired" ? 15011
            : mode == "last-expired" ? 1031
            : 90;
        if (EarlySeriesSnapshot(states, mode) is { } early)
        {
            f.Result(early, at);
            Equal(0, f.Output.Count);
            f.State(after, at + 20);
        }
        else
            f.Result(after, at);
        f.Result(after, at + 21);
        string? expected = ExpectedSeriesOperation(mode);
        if (expected is null)
            Equal(0, f.Output.Count);
        else
            AddIndependentSample(samples, f, expected);
    }

    private static SeriesSnapshots BeginIndependentSeries(IndependentRouterFixture f, string mode)
    {
        var before = IndependentNormal();
        var half = before with { Arranged = true, Frame = new(0, 0, 960, 1040) };
        var quarter = half with { Frame = new(0, 0, 960, 520) };
        f.Press(null, VK_LWIN, 0);
        if (mode == "dual-win")
            f.Press(null, VK_RWIN, 1);
        f.Press(before, VK_LEFT, 10);
        f.Release(VK_LEFT, 20);
        f.State(half, 25);
        Equal(0, f.Output.Count);
        f.Press(half, VK_UP, 30, flags: mode == "injected" ? LLKHF_INJECTED : 0);
        f.Release(VK_UP, 40);
        f.State(mode == "delayed-max-stale-press" ? half : quarter, 45);
        Equal(0, f.Output.Count);
        return new(before, half, quarter);
    }

    private static bool IsSeriesMax(string mode) =>
        mode is "max" or "delayed-max" or "transient-max" or "delayed-max-stale-press";

    private static WindowState ApplyFinalSeriesInput(
        IndependentRouterFixture f,
        SeriesSnapshots states,
        string mode
    )
    {
        if (IsSeriesMax(mode))
        {
            f.Press(mode == "delayed-max-stale-press" ? states.Half : states.Quarter, VK_UP, 50);
            f.Release(VK_UP, 60);
            return states.Before with { Show = SW_SHOWMAXIMIZED };
        }
        if (mode == "delayed-bottom")
        {
            f.Press(states.Half, VK_DOWN, 50);
            f.Release(VK_DOWN, 60);
            return states.Quarter with { Frame = new(0, 520, 960, 520) };
        }
        if (mode == "delayed-placement-after-max")
        {
            f.Press(states.Quarter, VK_RIGHT, 50);
            f.Release(VK_RIGHT, 60);
            return states.Quarter with { Frame = new(960, 0, 960, 520) };
        }
        return states.Quarter;
    }

    private static WindowState MutateSeriesResult(WindowState after, string mode) =>
        mode switch
        {
            "process" => after with { Process = 8 },
            "layout" => after with { DisplayLayout = "changed" },
            "work" => after with { Work = new(0, 0, 1920, 1000) },
            "dpi" => after with { Dpi = 144 },
            _ => after,
        };

    private static void ReleaseIndependentSeries(
        IndependentRouterFixture f,
        WindowState after,
        string mode
    )
    {
        if (mode != "unreleased")
            f.Release(VK_LWIN, 70);
        if (mode != "dual-win")
            return;
        f.Result(after, 75);
        Equal(0, f.Output.Count);
        f.Release(VK_RWIN, 80);
    }

    private static WindowState? EarlySeriesSnapshot(SeriesSnapshots states, string mode) =>
        mode switch
        {
            "delayed-quarter" => states.Half,
            "transient-max" => states.Before,
            "delayed-max" or "delayed-max-stale-press" or "delayed-bottom" => states.Quarter,
            "delayed-placement-after-max" => states.Before with { Show = SW_SHOWMAXIMIZED },
            _ => null,
        };

    private static string? ExpectedSeriesOperation(string mode) =>
        IsSeriesMax(mode)
            ? "W03"
            : mode switch
            {
                "quarter"
                or "delayed-quarter"
                or "delayed-bottom"
                or "delayed-placement-after-max"
                or "dual-win"
                or "duplicate" => "W07",
                _ => null,
            };
}
