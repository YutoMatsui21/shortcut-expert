using static NativeMethods;

// State transitions and Win+Down grouping from the fixed v2 baseline.
internal sealed partial class CandidateTracker
{
    private const long MouseStateMatchWindowMs = 500;

    internal object? Close(nint window, WindowState? previous, long now, string date)
    {
        GestureManager.Input? candidate =
            gestures.Pending?.Window == window ? gestures.Pending : null;
        Forget(window);
        if (
            previous is null
            || candidate is null
            || !candidate.Before.HasCaption
            || !previous.HasCaption
            || candidate.Before.Process != previous.Process
            || candidate.Route is not ("close-button" or "alt-f4")
        )
            return null;
        return Build(
            "close",
            candidate.Before,
            previous with
            {
                Show = 0,
            },
            candidate,
            now - candidate.At,
            true,
            false,
            date,
            candidate.Before.Monitor
        );
    }

    internal object? Complete(
        nint window,
        WindowState? previous,
        WindowState after,
        long now,
        nint foreground,
        string date,
        MonitorBounds? monitor
    ) => ReplayState(new(0, window, now, previous, after, foreground, date, monitor));

    private object? ReplayState(StateObservedEvent result)
    {
        var maximized = ConfirmMaximize(
            result.Target,
            result.After,
            result.At,
            result.Foreground,
            result.Date
        );
        if (maximized is not null)
            return maximized;
        if (result.Before is not { } previous)
            return null;
        if (previous.Process != result.After.Process)
        {
            Forget(result.Target);
            return null;
        }
        if (OtherInputOwns(result.Target))
            return null;
        bool fallback =
            gestures.Pending is { Route: "unknown" } mouse && mouse.Window == result.Target;
        if (fallback && clickReleased)
            previous = gestures.Pending!.Before;
        var candidate = MatchStateInput(result);
        string? operation = ResolveStateOperation(previous, result.After, candidate);
        if (!RetainsOperation(operation))
            return null;
        if (fallback && !clickReleased)
            return null;
        return FinishState(result, new(previous, operation, candidate, fallback));
    }

    private bool OtherInputOwns(nint target) =>
        Placement.Owns(target) || gestures.Drags.ContainsKey(target);

    private GestureManager.Input? MatchStateInput(StateObservedEvent result)
    {
        if (gestures.Pending is not { } pending || pending.Window != result.Target)
            return null;
        if (pending.Before.Process == result.After.Process)
            return pending;
        ClearInput();
        return null;
    }

    private string? ResolveStateOperation(
        WindowState previous,
        WindowState after,
        GestureManager.Input? candidate
    ) =>
        candidate is { Route: "win-shift-left" or "win-shift-right" }
            ? MonitorKeyOperation(candidate, after)
            : StateTransition(previous, after);

    private string? MonitorKeyOperation(GestureManager.Input candidate, WindowState after)
    {
        if (!moveKeyReleased)
            return null;
        if (!StableMove(candidate.Before, after))
        {
            ClearInput();
            return null;
        }
        return candidate.Before.Monitor != after.Monitor ? "monitor-move" : null;
    }

    private static string? StateTransition(WindowState previous, WindowState after) =>
        (State(previous.Show), State(after.Show)) switch
        {
            ("normal", "maximized") => "maximize",
            ("normal" or "maximized", "minimized") => "minimize",
            ("maximized", "normal") => "restore",
            _ => null,
        };

    private sealed record StateTransitionInput(
        WindowState Before,
        string Operation,
        GestureManager.Input? Candidate,
        bool Fallback
    );

    private object? FinishState(StateObservedEvent result, StateTransitionInput input)
    {
        var candidate = input.Candidate;
        long age = candidate is null ? -1 : result.At - candidate.At;
        bool matched = input.Operation == "minimize" || result.Foreground == result.Target;
        bool moving = gestures.Moving.Contains(result.Target);
        if (input.Fallback)
            candidate = MouseFallbackOrigin(candidate, age, matched, moving);
        var before = RecentInput(candidate, age) ? candidate!.Before : input.Before;
        if (candidate is not null)
            gestures.Complete(candidate.Gesture, result.Target, result.After, result.At);
        var outcome = Build(
            input.Operation,
            before,
            result.After,
            candidate,
            age,
            matched,
            moving,
            result.Date,
            result.Monitor
        );
        if (gestures.Pending?.Window == result.Target)
            gestures.Pending = null;
        return UpdateReduction(outcome, candidate, before, result.At) ? null : outcome;
    }

    private static GestureManager.Input? MouseFallbackOrigin(
        GestureManager.Input? input,
        long age,
        bool matched,
        bool moving
    ) =>
        age is >= 0 and <= MouseStateMatchWindowMs
        && input is { Injected: false, Conflicted: false, Matched: true }
        && !moving
        && matched
            ? input with
            {
                Origin = "mouse",
                Route = "mouse-state-fallback",
            }
            : input;

    private bool RetainsOperation(
        [System.Diagnostics.CodeAnalysis.NotNullWhen(true)] string? operation
    ) =>
        operation is not null
        && (
            !IndependentResults
            || operation is not ("maximize" or "monitor-move" or "restore" or "minimize")
        );
}
