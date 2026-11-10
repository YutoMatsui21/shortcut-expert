using System.Text.Json.Serialization;

[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(WindowEvidence), "window")]
[JsonDerivedType(typeof(ShellDisplayEvidence), "shell-display")]
[JsonDerivedType(typeof(ActivationEvidence), "activation")]
[JsonDerivedType(typeof(GlobalEvidence), "global")]
[JsonDerivedType(typeof(SnapInvocationEvidence), "snap-invocation")]
[JsonDerivedType(typeof(TaskbarInputEvidence), "taskbar-input")]
[JsonDerivedType(typeof(WindowSwitchEvidence), "window-switch")]
[JsonDerivedType(typeof(PlacementEvidence), "placement")]
[JsonDerivedType(typeof(WindowCloseEvidence), "window-close")]
[JsonDerivedType(typeof(CompoundDragEvidence), "compound-drag")]
[JsonDerivedType(typeof(CaptionClickEvidence), "caption-click")]
internal abstract record Evidence(string profile);

internal sealed record CaptionClickEvidence(
    string? terminal,
    bool switched,
    bool targetMatched,
    bool released,
    long inputAgeMs,
    MonitorBounds? monitor
) : Evidence("caption-click-v1");

internal sealed record CompoundDragEvidence(
    string terminal,
    bool targetMatched,
    bool released,
    bool layoutStable,
    long inputAgeMs,
    MonitorBounds fromMonitor,
    MonitorBounds toMonitor,
    string? moveDirection,
    bool terminalEquivalent,
    bool twoDisplayLayoutConfirmed = false
) : Evidence("compound-drag-v1");

internal sealed record WindowCloseEvidence(
    bool targetMatched,
    bool destroyed,
    long inputAgeMs,
    MonitorBounds? monitor
) : Evidence("window-close-v1");

internal sealed record PlacementEvidence(
    string shape,
    bool targetMatched,
    long inputAgeMs,
    bool monitorChanged,
    MonitorBounds? monitor
) : Evidence("placement-v1");

internal sealed record WindowSwitchEvidence(
    bool windowsDifferent,
    bool eligible,
    bool inputTargetMatched,
    bool foregroundMatched,
    long inputAgeMs,
    long settleMs,
    MonitorBounds? monitor
) : Evidence("window-switch-v1");

internal sealed record TaskbarInputEvidence(
    int? slot,
    bool mappingConfirmed,
    long snapshotAgeMs,
    long confirmationAgeMs,
    MonitorBounds? monitor
) : Evidence("taskbar-input-v1");

internal sealed record SnapInvocationEvidence(
    bool targetMatched,
    bool eligible,
    bool? settingsEnabled,
    string? buttonSource,
    long dwellMs,
    long inputAgeMs,
    MonitorBounds? monitor
) : Evidence("snap-invocation-v1");

internal sealed record WindowResult(
    string app,
    string operation,
    CandidateState before,
    CandidateState after,
    bool? afterArranged,
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
);

internal sealed record WindowEvidence(WindowResult result) : Evidence("legacy-window-v1");

internal sealed record ShellDisplayEvidence(
    string feature,
    bool? wasVisible,
    bool? visible,
    bool? targetMatched
) : Evidence("unverified");

internal sealed record ActivationEvidence(
    int? slot,
    bool? appMatched,
    bool? targetMatched,
    bool? individualEquivalent,
    string result
) : Evidence("unverified");

internal sealed record GlobalEvidence(string feature, bool? targetsKnown, bool? resultConfirmed)
    : Evidence("unverified");

internal sealed record CandidateEnvelope(
    string type,
    int protocolVersion,
    int generation,
    int sequence,
    int transaction,
    string date,
    string origin,
    string route,
    bool injected,
    bool conflicted,
    Evidence evidence
);

internal sealed record CandidateState(string state, bool? arranged = null);

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

// Pure legacy evidence conversion, also used by isolated policy fixtures.
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
