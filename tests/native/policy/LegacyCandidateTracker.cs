using static NativeMethods;
using Point = NativeMethods.Point;

// Input and key-result replay for the fixed #172 v2 baseline.
internal sealed partial class CandidateTracker
{
    internal void Mouse(
        nint window,
        WindowState before,
        int hit,
        Point point,
        long now,
        uint doubleClickTime,
        uint flags,
        bool modifiers,
        bool foreground
    ) =>
        Mouse(
            new(0, window, now, before, hit, point, doubleClickTime, flags, modifiers, foreground)
        );

    internal void Key(
        nint window,
        WindowState? before,
        uint key,
        bool winDown,
        bool modifiers,
        long now,
        uint flags,
        bool shiftDown = false,
        bool altDown = false
    ) => Key(new(0, window, now, before, key, winDown, modifiers, flags, shiftDown, altDown));

    internal WindowCandidate? ConfirmMaximize(
        nint window,
        WindowState? after,
        long now,
        nint foreground,
        string date
    )
    {
        if (IndependentResults)
            return null;
        if (MaximizeTarget(now) is not { } target || target != window)
            return null;
        var pending = gestures.Maximize!;
        if (foreground != window || after is null || after.Process != pending.Before.Process)
        {
            gestures.Maximize = null;
            gestures.RetireUnreferenced(Placement.Owns(window));
            return null;
        }
        if (after.Show != SW_SHOWMAXIMIZED)
            return null;
        gestures.Complete(pending.Gesture, window, after, now);
        gestures.Maximize = null;
        gestures.Pending = null;
        Placement.Cancel();
        return (WindowCandidate)Build(
            "maximize",
            pending.Before,
            after,
            pending,
            now - pending.At,
            true,
            false,
            date,
            after.Monitor
        );
    }

    internal object? FinishKey(
        nint window,
        WindowState? after,
        long now,
        bool injected,
        string date
    )
    {
        if (injected)
        {
            gestures.Maximize = null;
            gestures.RetireUnreferenced(Placement.Owns(window));
        }
        var confirmed = ConfirmMaximize(window, after, now, window, date);
        if (confirmed is not null)
            return confirmed;
        if (
            gestures.Pending is { Route: "win-shift-left" or "win-shift-right" } move
            && move.Window == window
            && moveKeyReleased
        )
        {
            if (injected || after is null)
            {
                ClearInput();
                return null;
            }
            return Complete(window, move.Before, after, now, window, date, after.Monitor);
        }
        if (Placement.WinHeld)
            return null;
        var placed = Placement.Finish(window, after, now, injected);
        return placed;
    }
}
