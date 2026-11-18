using System.Text.Json.Serialization;

internal sealed record WindowCandidate(
    string type,
    int protocolVersion,
    int generation,
    int sequence,
    string app,
    string operation,
    string date,
    CandidateState before,
    CandidateState after,
    bool? afterArranged,
    string origin,
    string route,
    bool injected,
    bool conflicted,
    bool moving,
    bool elevated,
    bool targetMatched,
    long inputAgeMs,
    MonitorBounds? monitor,
    MonitorBounds? fromMonitor,
    MonitorBounds? toMonitor,
    string? moveDirection,
    bool moveConfirmed = false,
    bool twoDisplayLayoutConfirmed = false
)
{
    [JsonIgnore]
    internal int Transaction { get; init; }
}

// Converts the frozen legacy candidate shape for v2 compatibility fixtures.
internal static class CandidateProtocol
{
    internal static CandidateEnvelope V2(WindowCandidate c, int sequence, int transaction) =>
        new(
            "candidate",
            2,
            c.generation,
            sequence,
            transaction,
            c.date,
            c.origin,
            c.route,
            c.injected,
            c.conflicted,
            new WindowEvidence(
                new(
                    c.app,
                    c.operation,
                    c.before,
                    c.after,
                    c.afterArranged,
                    c.moving,
                    c.elevated,
                    c.targetMatched,
                    c.inputAgeMs,
                    c.monitor,
                    c.fromMonitor,
                    c.toMonitor,
                    c.moveDirection,
                    c.moveConfirmed,
                    c.twoDisplayLayoutConfirmed
                )
            )
        );
}
