using static NativeMethods;

// Neutral input lifetime queries shared by Observer and the migration adapters.
internal sealed partial class CandidateTracker
{
    internal nint? MaximizeTarget(long now)
    {
        if (gestures.Maximize is { } pending && now - pending.At is < 0 or > InputMatchWindowMs)
        {
            // The maximize adapter's one-second window is not the lifetime of a
            // shared Win-held placement series (which owns its own deadline).
            if (!Placement.Owns(pending.Window))
            {
                if (now < pending.At)
                    gestures.Cancel(pending.Gesture);
                else
                    gestures.Expire(pending.Gesture, now, pending.At + InputMatchWindowMs);
            }
            gestures.Maximize = null;
        }
        return gestures.Maximize?.Window;
    }

    internal nint? ClickResultTarget =>
        IndependentResults
        && gestures.Pending
            is { Before.Show: SW_SHOWNORMAL, Route: "max-button" or "caption-double-click" } click
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
            || click.Origin == "key"
            || click.Before.Show != SW_SHOWNORMAL
            || click.Route is not ("max-button" or "caption-double-click" or "unknown")
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
        && (!IndependentResults || operation is not ("maximize" or "monitor-move"));

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
}
