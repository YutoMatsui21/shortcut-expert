using static NativeMethods;

internal sealed record CaptionPressFacts(nint Target, WindowState Before, long At, int Transaction);

// Completed physical click observations, not another detector's success/failure.
internal sealed record CaptionCompletionFacts(
    CaptionPressFacts Press,
    WindowState After,
    int Hit,
    bool Activated,
    string? ObservedTerminal,
    long ReleasedAt,
    long At
)
{
    internal bool Fallback => Hit is 1 or 0 or -1;
    internal string? MatchedTerminal =>
        (
            ObservedTerminal == "maximized" && After.Show == SW_SHOWMAXIMIZED
            || ObservedTerminal == "minimized" && After.Show == SW_SHOWMINIMIZED
        ) && (!Fallback || Activated)
            ? ObservedTerminal
            : null;

    internal CaptionClickEvidence? LegacyEvidence() =>
        Activated || MatchedTerminal is not null
            ? new(MatchedTerminal, Activated, true, true, 500, Press.Before.Monitor)
            : null;
}

internal static partial class MaximizeDetector
{
    internal static IndependentStateProof? InactiveClick(CaptionCompletionFacts facts) =>
        facts.Press.Before.Show == SW_SHOWNORMAL
        && facts.After.Show == SW_SHOWMAXIMIZED
        && facts.ObservedTerminal == "maximized"
        && (facts.Hit == HTMAXBUTTON || facts.Fallback && facts.Activated)
            ? new(
                facts.Fallback
                    ? IndependentStateRoute.MouseStateFallback
                    : IndependentStateRoute.MaxButton,
                IndependentStateAction.Maximize,
                IndependentBeforeState.Normal,
                IndependentAfterState.Maximized,
                facts.Press.Before.Arranged,
                facts.After.Arranged,
                500,
                facts.Press.Before.Monitor
            )
            : null;
}
