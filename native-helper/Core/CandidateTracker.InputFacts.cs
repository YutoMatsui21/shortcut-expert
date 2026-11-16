using static NativeMethods;

// Neutral input lifetime queries shared by Observer and the migration adapters.
internal sealed partial class CandidateTracker
{
    internal nint? MaximizeTarget(long now)
    {
        if (gestures.Maximize is { } pending && now - pending.At is < 0 or > InputMatchWindowMs)
        {
            // The one-second maximize window does not expire a retained key series.
            ExpireMaximizeGesture(pending, now);
            gestures.Maximize = null;
        }
        return gestures.Maximize?.Window;
    }

    private void ExpireMaximizeGesture(GestureManager.Input pending, long now)
    {
        if (Placement.Owns(pending.Window))
            return;
        if (now < pending.At)
        {
            gestures.Cancel(pending.Gesture);
            return;
        }
        gestures.Expire(pending.Gesture, now, pending.At + InputMatchWindowMs);
    }

    internal nint? ClickResultTarget =>
        IndependentResults
        && gestures.Pending
            is { Route: "max-button" or "min-button" or "caption-double-click" } click
            ? click.Window
            : null;

    internal nint? ResultTarget(long now, nint excluded = 0)
    {
        if (MaximizeTarget(now) is { } key)
            return key != excluded ? key : null;
        if (IndependentResults && Placement.PendingResultTarget(now) is { } series)
            return series != excluded ? series : null;
        if (
            !IndependentResults
            || gestures.Drags.Count != 0
            || gestures.Pending is not { } click
            || click.Route
                is not (
                    "max-button"
                    or "min-button"
                    or "caption-double-click"
                    or "unknown"
                    or "win-down"
                )
        )
            return null;
        if (now - click.At is < 0 or > 1000)
        {
            ClearInput();
            return null;
        }
        return click.Window != excluded ? click.Window : null;
    }

    internal uint? MaximizeProcess(nint window, long now) =>
        MaximizeTarget(now) == window ? gestures.Maximize!.Before.Process : null;

    private bool RetainsOperation(
        [System.Diagnostics.CodeAnalysis.NotNullWhen(true)] string? operation
    ) =>
        operation is not null
        && (
            !IndependentResults
            || operation is not ("maximize" or "monitor-move" or "restore" or "minimize")
        );

    private bool ReleasedMonitorKey(uint key) =>
        (gestures.Pending?.Route, key)
            is
                ("win-shift-left", VK_LEFT)
                or
                ("win-shift-right", VK_RIGHT);

    private void ReleaseMonitorKey(uint key, long? now)
    {
        if (!moveKeyReleased && !ReleasedMonitorKey(key))
            return;
        moveKeyReleased = true;
        if (
            IndependentResults
            && gestures.Pending is { Route: "win-shift-left" or "win-shift-right" } move
        )
            gestures.AwaitResult(move.Gesture, now);
    }

    private bool MouseInputConflict(long now) =>
        gestures.Pending is { Origin: "mouse" } pending && now - pending.At <= InputMatchWindowMs;

    private void ObserveKeyEpoch(uint key, bool injected, string? route)
    {
        if (!KeepsReductionSeries(key, injected, route))
            InputEpoch++;
    }

    private static bool KeepsReductionSeries(uint key, bool injected, string? route) =>
        !injected && (key is VK_LWIN or VK_RWIN || route == "win-down");

    private void ReleaseReductionKey(uint key, long? now)
    {
        if (!IndependentResults || key != VK_DOWN)
            return;
        if (gestures.Pending is { Route: "win-down" } down)
            gestures.AwaitResult(down.Gesture, now);
    }
}
