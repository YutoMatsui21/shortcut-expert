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
internal sealed class CandidateSink(Action<object> emit)
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

    internal void Compound(int epoch, string date, CompoundMoveResult result)
    {
        lock (gate)
        {
            if (generation == 0 || epoch != generation)
                return;
            Submit(
                new CandidateDraft(
                    generation,
                    result.Transaction,
                    date,
                    "mouse",
                    "compound-caption-drag",
                    false,
                    false,
                    new CompoundDragEvidence(
                        result.Terminal,
                        true,
                        true,
                        true,
                        result.InputAgeMs,
                        result.FromMonitor,
                        result.ToMonitor,
                        result.MoveDirection,
                        true,
                        result.TwoDisplayLayoutConfirmed
                    )
                )
            );
        }
    }

    internal void CaptionClick(
        int epoch,
        int transaction,
        string date,
        CaptionClickEvidence evidence
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
                    date,
                    "mouse",
                    "inactive-caption-click",
                    false,
                    false,
                    evidence
                )
            );
        }
    }

    internal void Close(
        int epoch,
        int transaction,
        string date,
        string origin,
        WindowCloseEvidence evidence
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
                    date,
                    origin,
                    origin == "mouse" ? "close-button" : "alt-f4",
                    false,
                    false,
                    evidence
                )
            );
        }
    }

    internal void Placement(int epoch, string date, PlacementResult result)
    {
        lock (gate)
        {
            if (generation == 0 || epoch != generation)
                return;
            // Compound results await #113's atomic multi-operation transport/writer.
            if (result.Evidence.monitorChanged)
                return;
            Submit(
                new CandidateDraft(
                    generation,
                    result.Transaction,
                    date,
                    result.Origin,
                    result.Origin == "mouse" ? "caption-edge-drag" : "win-held-arrows",
                    false,
                    false,
                    result.Evidence
                )
            );
        }
    }

    internal void Switch(
        int epoch,
        int transaction,
        string date,
        string origin,
        WindowSwitchEvidence evidence
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
                    date,
                    origin,
                    origin == "mouse" ? "direct-click" : "alt-tab",
                    false,
                    false,
                    evidence
                )
            );
        }
    }

    internal void Taskbar(
        int epoch,
        int transaction,
        string date,
        string origin,
        TaskbarInputEvidence evidence
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
                    date,
                    origin,
                    origin == "mouse" ? "taskbar-click" : "win-digit",
                    false,
                    false,
                    evidence
                )
            );
        }
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

    internal void Complete(WindowCandidate candidate)
    {
        lock (gate)
        {
            if (generation == 0 || candidate.generation != generation)
                return;
            var envelope = CandidateProtocol.V2(candidate, 0, candidate.Transaction);
            Submit(
                new CandidateDraft(
                    envelope.generation,
                    envelope.transaction,
                    envelope.date,
                    envelope.origin,
                    envelope.route,
                    envelope.injected,
                    envelope.conflicted,
                    envelope.evidence
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
