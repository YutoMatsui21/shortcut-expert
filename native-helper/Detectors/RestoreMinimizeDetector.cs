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
        ReductionFacts facts,
        IndependentStateProof? proof,
        long epoch,
        bool accepted
    )
    {
        restored = accepted && CanContinue(facts, proof) ? facts.Input : null;
        restoreEpoch = epoch;
    }

    private bool Continues(GestureManager.Input input, IndependentStateProof proof, long epoch) =>
        IsContinuationInput(input, proof)
        && SameRestoreTarget(input, epoch)
        && input.At - restored!.At is >= 0 and <= 1000;

    private static bool IsContinuationInput(
        GestureManager.Input input,
        IndependentStateProof proof
    ) =>
        input.Route == "win-down"
        && input.Before.Show == SW_SHOWNORMAL
        && proof.action == IndependentStateAction.Minimize;

    private bool SameRestoreTarget(GestureManager.Input input, long epoch) =>
        restored is not null
        && restoreEpoch == epoch
        && restored.Window == input.Window
        && restored.Before.Process == input.Before.Process;

    private static bool CanContinue(ReductionFacts facts, IndependentStateProof? proof) =>
        facts.Input.Route == "win-down"
        && proof?.action == IndependentStateAction.Restore
        && facts.Input.Before.Arranged == false
        && facts.After.Arranged == false;

    internal static IndependentStateProof? Detect(ReductionFacts facts)
    {
        if (!Eligible(facts))
            return null;
        var action = Action(facts);
        var route = Route(facts.Input, action);
        return action is { } confirmed && route is { } observed
            ? Proof(facts, observed, confirmed)
            : null;
    }

    private static bool Eligible(ReductionFacts facts) =>
        InputDetectionFacts.Valid(
            facts.Input,
            facts.After,
            facts.At,
            facts.Input.Route == "unknown" ? 500 : 1000
        )
        && !facts.Moving
        && facts.Input.Gesture.ReleasedAt is not null;

    private static IndependentStateAction? Action(ReductionFacts facts)
    {
        if (Restored(facts))
            return IndependentStateAction.Restore;
        return Minimized(facts) ? IndependentStateAction.Minimize : null;
    }

    private static bool Restored(ReductionFacts facts) =>
        facts.Input.Before.Show == SW_SHOWMAXIMIZED
        && facts.After.Show == SW_SHOWNORMAL
        && facts.After.Arranged == false
        && facts.Foreground;

    private static bool Minimized(ReductionFacts facts) =>
        facts.Input.Before.Show is SW_SHOWNORMAL or SW_SHOWMAXIMIZED
        && CandidateTracker.State(facts.After.Show) == "minimized";

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
        ReductionFacts facts,
        IndependentStateRoute route,
        IndependentStateAction action
    ) =>
        new(
            route,
            action,
            BeforeState(facts.Input.Before),
            action == IndependentStateAction.Restore
                ? IndependentAfterState.Normal
                : IndependentAfterState.Minimized,
            facts.Input.Before.Arranged,
            facts.After.Arranged,
            facts.At - facts.Input.At,
            facts.After.Monitor
        );

    private static IndependentBeforeState BeforeState(WindowState before) =>
        before.Show == SW_SHOWMAXIMIZED
            ? IndependentBeforeState.Maximized
            : IndependentBeforeState.Normal;

    internal static IndependentStateProof? InactiveClick(CaptionCompletionFacts facts) =>
        facts.MatchedTerminal == "minimized" && (facts.Hit == HTMINBUTTON || facts.Fallback)
            ? new(
                facts.Fallback
                    ? IndependentStateRoute.InactiveStateFallback
                    : IndependentStateRoute.InactiveMinButton,
                IndependentStateAction.Minimize,
                BeforeState(facts.Press.Before),
                IndependentAfterState.Minimized,
                facts.Press.Before.Arranged,
                facts.After.Arranged,
                500,
                facts.Press.Before.Monitor
            )
            : null;
}

internal sealed record ReductionFacts(
    GestureManager.Input Input,
    WindowState After,
    long At,
    bool Foreground,
    bool Moving
);
