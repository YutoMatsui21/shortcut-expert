using static NativeMethods;

internal sealed class RestoreMinimizeDetector
{
    private GestureManager.Input? restored;
    private long restoreEpoch;

    internal IndependentStateProof? Select(
        GestureManager.Input input,
        IndependentStateProof? proof,
        long epoch
    ) => proof is not null && Continues(input, proof, epoch) ? null : proof;

    internal void Completed(
        GestureManager.Input input,
        WindowState after,
        IndependentStateProof? proof,
        long epoch,
        bool accepted
    )
    {
        restored = accepted && CanContinue(input, after, proof) ? input : null;
        restoreEpoch = epoch;
    }

    private bool Continues(GestureManager.Input input, IndependentStateProof proof, long epoch) =>
        input.Route == "win-down"
        && input.Before.Show == SW_SHOWNORMAL
        && proof.action == IndependentStateAction.Minimize
        && restored is not null
        && restoreEpoch == epoch
        && restored.Window == input.Window
        && restored.Before.Process == input.Before.Process
        && input.At - restored.At is >= 0 and <= 1000;

    private static bool CanContinue(
        GestureManager.Input input,
        WindowState after,
        IndependentStateProof? proof
    ) =>
        input.Route == "win-down"
        && proof?.action == IndependentStateAction.Restore
        && input.Before.Arranged == false
        && after.Arranged == false;

    internal static IndependentStateProof? Detect(
        GestureManager.Input input,
        WindowState after,
        long at,
        bool foreground,
        bool moving
    )
    {
        if (
            !InputDetectionFacts.Valid(input, after, at, input.Route == "unknown" ? 500 : 1000)
            || moving
            || input.Gesture.ReleasedAt is null
        )
            return null;
        var action = Action(input.Before, after, foreground);
        var route = Route(input, action);
        return action is { } confirmed && route is { } observed
            ? Proof(input.Before, after, observed, confirmed, at - input.At, after.Monitor)
            : null;
    }

    private static IndependentStateAction? Action(
        WindowState before,
        WindowState after,
        bool foreground
    )
    {
        if (
            before.Show == SW_SHOWMAXIMIZED
            && after.Show == SW_SHOWNORMAL
            && after.Arranged == false
            && foreground
        )
            return IndependentStateAction.Restore;
        return
            before.Show is SW_SHOWNORMAL or SW_SHOWMAXIMIZED
            && CandidateTracker.State(after.Show) == "minimized"
            ? IndependentStateAction.Minimize
            : null;
    }

    private static IndependentStateRoute? Route(
        GestureManager.Input input,
        IndependentStateAction? action
    ) =>
        input.Route switch
        {
            "win-down"
                when action == IndependentStateAction.Restore || input.Before.Arranged == false =>
                IndependentStateRoute.WinDown,
            "max-button" when action == IndependentStateAction.Restore =>
                IndependentStateRoute.MaxButton,
            "caption-double-click" when action == IndependentStateAction.Restore =>
                IndependentStateRoute.CaptionDoubleClick,
            "min-button" when action == IndependentStateAction.Minimize =>
                IndependentStateRoute.MinButton,
            "unknown" => IndependentStateRoute.MouseStateFallback,
            _ => null,
        };

    private static IndependentStateProof Proof(
        WindowState before,
        WindowState after,
        IndependentStateRoute route,
        IndependentStateAction action,
        long age,
        MonitorBounds? monitor
    ) =>
        new(
            route,
            action,
            before.Show == SW_SHOWMAXIMIZED
                ? IndependentBeforeState.Maximized
                : IndependentBeforeState.Normal,
            action == IndependentStateAction.Restore
                ? IndependentAfterState.Normal
                : IndependentAfterState.Minimized,
            before.Arranged,
            after.Arranged,
            age,
            monitor
        );

    internal static IndependentStateProof? InactiveClick(CaptionCompletionFacts facts) =>
        facts.MatchedTerminal == "minimized" && (facts.Hit == HTMINBUTTON || facts.Fallback)
            ? Proof(
                facts.Press.Before,
                facts.After,
                facts.Fallback
                    ? IndependentStateRoute.InactiveStateFallback
                    : IndependentStateRoute.InactiveMinButton,
                IndependentStateAction.Minimize,
                500,
                facts.Press.Before.Monitor
            )
            : null;
}
