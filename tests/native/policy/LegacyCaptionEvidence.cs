// Legacy inactive caption evidence for the v2 compatibility fixtures.
internal sealed partial record CaptionCompletionFacts
{
    internal CaptionClickEvidence? LegacyEvidence() =>
        Activated || MatchedTerminal is not null
            ? new(MatchedTerminal, Activated, true, true, 500, Press.Before.Monitor)
            : null;
}

internal sealed partial class InactiveCaptionPolicy
{
    internal (int Transaction, CaptionClickEvidence Evidence)? Poll(WindowState? after, long at)
    {
        var facts = PollFacts(after, at);
        if (facts is null)
            return null;
        var evidence = facts.LegacyEvidence();
        return evidence is null ? null : (facts.Press.Transaction, evidence);
    }
}
