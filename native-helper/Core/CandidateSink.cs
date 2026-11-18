// Only transport-safe evidence crosses this boundary; input identity stays in policies.
internal sealed record CandidateDraft(
    int Generation,
    int Transaction,
    string Date,
    string Origin,
    string Route,
    bool Injected,
    bool Conflicted,
    Evidence Evidence
);

// One gate owns final emission order, including future asynchronous completions.
internal sealed partial class CandidateSink(Action<object> emit)
{
    private readonly object gate = new();
    private int generation,
        sequence;

    internal void Start(int nextGeneration, int protocolVersion)
    {
        if (nextGeneration <= 0 || protocolVersion != 2)
            throw new ArgumentException("protocol");
        lock (gate)
        {
            generation = nextGeneration;
            sequence = 0;
        }
    }

    internal void Stop()
    {
        lock (gate)
            generation = 0;
    }

    internal void Invocation(
        int epoch,
        int transaction,
        string origin,
        SnapInvocationEvidence evidence
    )
    {
        lock (gate)
        {
            if (generation == 0 || epoch != generation)
                return;
            Submit(
                new CandidateDraft(
                    generation,
                    transaction,
                    DateTime.Now.ToString("yyyy-MM-dd"),
                    origin,
                    origin == "key" ? "win-z" : "max-button-hover",
                    false,
                    false,
                    evidence
                )
            );
        }
    }

    // Keep generation validation, numbering and delivery in the same critical section.
    internal void Submit(CandidateDraft draft)
    {
        lock (gate)
        {
            if (generation == 0 || draft.Generation != generation)
                return;
            emit(
                new CandidateEnvelope(
                    "candidate",
                    2,
                    generation,
                    checked(++sequence),
                    draft.Transaction,
                    draft.Date,
                    draft.Origin,
                    draft.Route,
                    draft.Injected,
                    draft.Conflicted,
                    draft.Evidence
                )
            );
        }
    }
}
