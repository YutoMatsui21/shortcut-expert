// A fixed subscriber set with independent deadlines. Finishing one subscriber
// never closes another, and a rejected result cannot discard another's proof.
internal sealed class DetectorResults
{
    private sealed class Result(long deadline)
    {
        internal long Deadline { get; } = deadline;
        internal bool Finished;
        internal IndependentProof? Proof;
    }

    private readonly Dictionary<string, Result> results;

    internal DetectorResults(IEnumerable<ResultComposer.Subscription> subscriptions)
    {
        var fixedSubscriptions = subscriptions.ToArray();
        if (
            fixedSubscriptions.Any(s => string.IsNullOrWhiteSpace(s.Detector))
            || fixedSubscriptions.Select(s => s.Detector).Distinct().Count()
                != fixedSubscriptions.Length
        )
            throw new ArgumentException(
                "Detector subscriptions must be unique",
                nameof(subscriptions)
            );
        results = fixedSubscriptions.ToDictionary(s => s.Detector, s => new Result(s.Deadline));
    }

    internal bool AllFinished => results.Values.All(result => result.Finished);
    internal IEnumerable<IndependentProof> Confirmed =>
        results.Values.Where(result => result.Proof is not null).Select(result => result.Proof!);

    internal bool Finish(string detector, IndependentProof? proof, long now)
    {
        if (!results.TryGetValue(detector, out var result) || result.Finished)
            return false;
        result.Finished = true;
        result.Proof = now <= result.Deadline ? proof : null;
        return true;
    }

    internal void Expire(long now)
    {
        foreach (var result in results.Values)
            if (!result.Finished && now > result.Deadline)
                result.Finished = true;
    }

    internal void Discard() => results.Clear();
}
