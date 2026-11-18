using static NativeMethods;

// Neutral input lifetime queries shared by Observer and the detection adapters.
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
        !UsesLegacyBaseline
        && gestures.Pending
            is { Route: "max-button" or "min-button" or "caption-double-click" } click
            ? click.Window
            : null;

    internal nint? ResultTarget(long now, nint excluded = 0)
    {
        if (MaximizeTarget(now) is { } key)
            return key != excluded ? key : null;
        if (!UsesLegacyBaseline && Placement.PendingResultTarget(now) is { } series)
            return series != excluded ? series : null;
        if (
            UsesLegacyBaseline
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
            !UsesLegacyBaseline
            && gestures.Pending is { Route: "win-shift-left" or "win-shift-right" } move
        )
            gestures.AwaitResult(move.Gesture, now);
    }
}

// Normalized physical key facts used by shared sequence lifetime tracking.
internal readonly record struct KeySequenceInput(uint Key, bool Injected, string? Route);

internal readonly record struct KeySequenceRelease(uint Key, long? At);

internal sealed record OperationObservation(
    nint Target,
    WindowState? After,
    long At,
    nint Foreground,
    bool Injected = false
);
