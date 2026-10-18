using System.Text.Json.Serialization;

[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(WindowEvidence), "window")]
[JsonDerivedType(typeof(ShellDisplayEvidence), "shell-display")]
[JsonDerivedType(typeof(ActivationEvidence), "activation")]
[JsonDerivedType(typeof(GlobalEvidence), "global")]
internal abstract record Evidence(string profile);
internal sealed record WindowResult(string app, string operation, CandidateState before, CandidateState after,
    bool? afterArranged, bool moving, bool elevated, bool targetMatched, long inputAgeMs, MonitorBounds? monitor,
    MonitorBounds? fromMonitor, MonitorBounds? toMonitor, string? moveDirection);
internal sealed record WindowEvidence(WindowResult result) : Evidence("legacy-window-v1");
internal sealed record ShellDisplayEvidence(string feature, bool? wasVisible, bool? visible, bool? targetMatched) : Evidence("unverified");
internal sealed record ActivationEvidence(int? slot, bool? appMatched, bool? targetMatched, bool? individualEquivalent, string result) : Evidence("unverified");
internal sealed record GlobalEvidence(string feature, bool? targetsKnown, bool? resultConfirmed) : Evidence("unverified");
internal sealed record CandidateEnvelope(string type, int protocolVersion, int generation, int sequence, int transaction,
    string date, string origin, string route, bool injected, bool conflicted, Evidence evidence);

internal sealed record CandidateState(string state, bool? arranged = null);
internal sealed record WindowCandidate(string type, int protocolVersion, int generation, int sequence,
    string app, string operation, string date, CandidateState before, CandidateState after, bool? afterArranged,
    string origin, string route, bool injected, bool conflicted, bool moving, bool elevated,
    bool targetMatched, long inputAgeMs, MonitorBounds? monitor, MonitorBounds? fromMonitor,
    MonitorBounds? toMonitor, string? moveDirection)
{
    [JsonIgnore] internal int Transaction { get; init; }
}

// One gate owns final emission order, including future asynchronous completions.
internal sealed class CandidateProtocol(Action<object> emit)
{
    private readonly object gate = new();
    private int generation, sequence, version = 1;
    internal void Start(int nextGeneration, int protocolVersion)
    {
        if (nextGeneration <= 0 || protocolVersion is not (1 or 2)) throw new ArgumentException("protocol");
        lock (gate) { generation = nextGeneration; sequence = 0; version = protocolVersion; }
    }
    internal void Stop() { lock (gate) generation = 0; }
    internal void Complete(WindowCandidate candidate)
    {
        lock (gate)
        {
            if (generation == 0 || candidate.generation != generation) return;
            int finalSequence = checked(++sequence);
            emit(version == 1 ? candidate with { sequence = finalSequence } : V2(candidate, finalSequence, candidate.Transaction));
        }
    }
    internal static CandidateEnvelope V2(WindowCandidate c, int sequence, int transaction) => new(
        "candidate", 2, c.generation, sequence, transaction, c.date, c.origin, c.route, c.injected, c.conflicted,
        new WindowEvidence(new(c.app, c.operation, c.before, c.after, c.afterArranged, c.moving, c.elevated,
            c.targetMatched, c.inputAgeMs, c.monitor, c.fromMonitor, c.toMonitor, c.moveDirection)));
}
