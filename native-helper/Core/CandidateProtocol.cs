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
[JsonDerivedType(typeof(IndependentResultsEvidence), "independent-results")]
internal abstract record Evidence(string profile);

internal sealed record IndependentResultsEvidence(
    bool targetMatched,
    bool released,
    bool final,
    IReadOnlyList<IndependentProof> results
) : Evidence("independent-results-v1");

[JsonPolymorphic(TypeDiscriminatorPropertyName = "kind")]
[JsonDerivedType(typeof(IndependentSwitchProof), "switch")]
[JsonDerivedType(typeof(IndependentMonitorMoveProof), "monitor-move")]
[JsonDerivedType(typeof(IndependentStateProof), "state")]
[JsonDerivedType(typeof(IndependentPlacementProof), "placement")]
[JsonDerivedType(typeof(IndependentCloseProof), "close")]
[JsonDerivedType(typeof(IndependentTaskbarProof), "taskbar")]
internal abstract record IndependentProof;

internal sealed record IndependentSwitchProof(
    IndependentSwitchRoute route,
    bool windowsDifferent,
    bool eligible,
    bool foregroundMatched,
    long inputAgeMs,
    long settleMs,
    MonitorBounds? monitor
) : IndependentProof;

internal sealed record IndependentMonitorMoveProof(
    IndependentMonitorMoveRoute route,
    bool moveConfirmed,
    bool layoutStable,
    long inputAgeMs,
    MonitorBounds fromMonitor,
    MonitorBounds toMonitor,
    IndependentMoveDirection? moveDirection,
    bool twoDisplayLayoutConfirmed
) : IndependentProof;

internal sealed record IndependentStateProof(
    IndependentStateRoute route,
    IndependentStateAction action,
    IndependentBeforeState before,
    IndependentAfterState after,
    bool? beforeArranged,
    bool? afterArranged,
    long inputAgeMs,
    MonitorBounds? monitor
) : IndependentProof;

internal sealed record IndependentPlacementProof(
    IndependentPlacementRoute route,
    IndependentPlacementShape shape,
    bool placementConfirmed,
    bool layoutStable,
    long inputAgeMs,
    MonitorBounds monitor
) : IndependentProof;

internal sealed record IndependentCloseProof(
    IndependentCloseRoute route,
    bool destroyed,
    long inputAgeMs,
    MonitorBounds? monitor
) : IndependentProof;

internal sealed record IndependentTaskbarProof(
    IndependentTaskbarRoute route,
    int slot,
    bool mappingConfirmed,
    long snapshotAgeMs,
    long confirmationAgeMs,
    MonitorBounds? monitor
) : IndependentProof;

[JsonConverter(typeof(JsonStringEnumConverter<IndependentSwitchRoute>))]
internal enum IndependentSwitchRoute
{
    [JsonStringEnumMemberName("direct-click")]
    DirectClick,

    [JsonStringEnumMemberName("alt-tab")]
    AltTab,
}

[JsonConverter(typeof(JsonStringEnumConverter<IndependentMonitorMoveRoute>))]
internal enum IndependentMonitorMoveRoute
{
    [JsonStringEnumMemberName("caption-drag")]
    CaptionDrag,

    [JsonStringEnumMemberName("win-shift-left")]
    WinShiftLeft,

    [JsonStringEnumMemberName("win-shift-right")]
    WinShiftRight,
}

[JsonConverter(typeof(JsonStringEnumConverter<IndependentMoveDirection>))]
internal enum IndependentMoveDirection
{
    [JsonStringEnumMemberName("left")]
    Left,

    [JsonStringEnumMemberName("right")]
    Right,
}

[JsonConverter(typeof(JsonStringEnumConverter<IndependentStateRoute>))]
internal enum IndependentStateRoute
{
    [JsonStringEnumMemberName("max-button")]
    MaxButton,

    [JsonStringEnumMemberName("min-button")]
    MinButton,

    [JsonStringEnumMemberName("caption-double-click")]
    CaptionDoubleClick,

    [JsonStringEnumMemberName("caption-top-drag")]
    CaptionTopDrag,

    [JsonStringEnumMemberName("mouse-state-fallback")]
    MouseStateFallback,

    [JsonStringEnumMemberName("win-up")]
    WinUp,

    [JsonStringEnumMemberName("win-down")]
    WinDown,
}

[JsonConverter(typeof(JsonStringEnumConverter<IndependentStateAction>))]
internal enum IndependentStateAction
{
    [JsonStringEnumMemberName("maximize")]
    Maximize,

    [JsonStringEnumMemberName("restore")]
    Restore,

    [JsonStringEnumMemberName("minimize")]
    Minimize,
}

[JsonConverter(typeof(JsonStringEnumConverter<IndependentBeforeState>))]
internal enum IndependentBeforeState
{
    [JsonStringEnumMemberName("normal")]
    Normal,

    [JsonStringEnumMemberName("maximized")]
    Maximized,
}

[JsonConverter(typeof(JsonStringEnumConverter<IndependentAfterState>))]
internal enum IndependentAfterState
{
    [JsonStringEnumMemberName("normal")]
    Normal,

    [JsonStringEnumMemberName("maximized")]
    Maximized,

    [JsonStringEnumMemberName("minimized")]
    Minimized,
}

[JsonConverter(typeof(JsonStringEnumConverter<IndependentPlacementRoute>))]
internal enum IndependentPlacementRoute
{
    [JsonStringEnumMemberName("caption-edge-drag")]
    CaptionEdgeDrag,

    [JsonStringEnumMemberName("win-held-arrows")]
    WinHeldArrows,
}

[JsonConverter(typeof(JsonStringEnumConverter<IndependentPlacementShape>))]
internal enum IndependentPlacementShape
{
    [JsonStringEnumMemberName("left-half")]
    LeftHalf,

    [JsonStringEnumMemberName("right-half")]
    RightHalf,

    [JsonStringEnumMemberName("left-top")]
    LeftTop,

    [JsonStringEnumMemberName("right-top")]
    RightTop,

    [JsonStringEnumMemberName("left-bottom")]
    LeftBottom,

    [JsonStringEnumMemberName("right-bottom")]
    RightBottom,
}

[JsonConverter(typeof(JsonStringEnumConverter<IndependentCloseRoute>))]
internal enum IndependentCloseRoute
{
    [JsonStringEnumMemberName("close-button")]
    CloseButton,

    [JsonStringEnumMemberName("alt-f4")]
    AltF4,
}

[JsonConverter(typeof(JsonStringEnumConverter<IndependentTaskbarRoute>))]
internal enum IndependentTaskbarRoute
{
    [JsonStringEnumMemberName("taskbar-click")]
    TaskbarClick,

    [JsonStringEnumMemberName("win-digit")]
    WinDigit,
}

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
