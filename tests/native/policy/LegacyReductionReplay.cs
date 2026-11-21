using static NativeMethods;

internal sealed partial class CandidateTracker
{
    private GestureManager.Input? completedWinDown;

    partial void BaselineForeground(nint window)
    {
        if (completedWinDown is not null && completedWinDown.Window != window)
            ClearBaselineReduction();
    }

    partial void BaselineForget(nint window)
    {
        if (completedWinDown?.Window == window)
            ClearBaselineReduction();
    }

    partial void BaselineModifier(uint key, bool injected)
    {
        if (key is not (VK_LWIN or VK_RWIN) || injected)
            ClearBaselineReduction();
    }

    partial void BaselineKey(nint window, string? route)
    {
        if (route != "win-down" || completedWinDown?.Window != window)
            ClearBaselineReduction();
    }

    partial void ClearBaselineReduction() => completedWinDown = null;

    private bool UpdateReduction(
        WindowCandidate candidate,
        GestureManager.Input? input,
        WindowState before,
        long now
    )
    {
        if (!EligibleReduction(candidate, input, before))
        {
            completedWinDown = null;
            return false;
        }
        bool continuation = IsReductionContinuation(candidate, input!, before, now);
        completedWinDown =
            candidate.operation == "restore" && candidate.afterArranged == false ? input : null;
        return continuation;
    }

    private static bool EligibleReduction(
        WindowCandidate candidate,
        GestureManager.Input? input,
        WindowState before
    ) =>
        candidate
            is {
                origin: "key",
                route: "win-down",
                injected: false,
                conflicted: false,
                targetMatched: true,
                moving: false,
                operation: "restore" or "minimize"
            }
        && RecentInput(input, candidate.inputAgeMs)
        && before.Arranged == false;

    private bool IsReductionContinuation(
        WindowCandidate candidate,
        GestureManager.Input input,
        WindowState before,
        long now
    ) =>
        candidate.operation == "minimize"
        && State(before.Show) == "normal"
        && completedWinDown is { Before.Show: SW_SHOWMAXIMIZED } first
        && MatchesEarlierReduction(first, input, before, now);

    private static bool MatchesEarlierReduction(
        GestureManager.Input first,
        GestureManager.Input input,
        WindowState before,
        long now
    ) =>
        first.Window == input.Window
        && first.Before.Process == before.Process
        && now >= first.At
        && input.At - first.At is >= 0 and <= InputMatchWindowMs;
}
