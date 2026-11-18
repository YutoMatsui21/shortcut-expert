// Legacy wire writers for compatibility fixtures, sharing the production sink gate.
internal sealed partial class CandidateSink
{
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
}
