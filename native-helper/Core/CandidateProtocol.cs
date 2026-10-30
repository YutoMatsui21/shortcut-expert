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
internal abstract record Evidence(string profile);
internal sealed record CompoundDragEvidence(string terminal, bool targetMatched, bool released, bool layoutStable,
    long inputAgeMs, MonitorBounds fromMonitor, MonitorBounds toMonitor, string? moveDirection,
    bool terminalEquivalent, bool twoDisplayLayoutConfirmed = false) : Evidence("compound-drag-v1");
internal sealed record WindowCloseEvidence(bool targetMatched, bool destroyed, long inputAgeMs,
    MonitorBounds? monitor) : Evidence("window-close-v1");
internal sealed record PlacementEvidence(string shape, bool targetMatched, long inputAgeMs,
    bool monitorChanged, MonitorBounds? monitor) : Evidence("placement-v1");
internal sealed record WindowSwitchEvidence(bool windowsDifferent, bool eligible, bool inputTargetMatched,
    bool foregroundMatched, long inputAgeMs, long settleMs, MonitorBounds? monitor) : Evidence("window-switch-v1");
internal sealed record TaskbarInputEvidence(int? slot, bool mappingConfirmed, long snapshotAgeMs,
    long confirmationAgeMs, MonitorBounds? monitor) : Evidence("taskbar-input-v1");
internal sealed record SnapInvocationEvidence(bool targetMatched, bool eligible, bool? settingsEnabled,
    string? buttonSource, long dwellMs, long inputAgeMs, MonitorBounds? monitor) : Evidence("snap-invocation-v1");
internal sealed record WindowResult(string app, string operation, CandidateState before, CandidateState after,
    bool? afterArranged, bool moving, bool elevated, bool targetMatched, long inputAgeMs, MonitorBounds? monitor,
    MonitorBounds? fromMonitor, MonitorBounds? toMonitor, string? moveDirection, bool moveConfirmed = false, bool twoDisplayLayoutConfirmed = false);
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
    MonitorBounds? toMonitor, string? moveDirection, bool moveConfirmed = false, bool twoDisplayLayoutConfirmed = false)
{
    [JsonIgnore] internal int Transaction { get; init; }
}

// One gate owns final emission order, including future asynchronous completions.
internal sealed class CandidateProtocol(Action<object> emit)
{
    private readonly object gate = new();
    private int generation, sequence;
    internal void Start(int nextGeneration, int protocolVersion)
    {
        if (nextGeneration <= 0 || protocolVersion != 2) throw new ArgumentException("protocol");
        lock (gate) { generation = nextGeneration; sequence = 0; }
    }
    internal void Stop() { lock (gate) generation = 0; }
    internal void Compound(int epoch, string date, CompoundMoveResult result)
    {
        lock (gate)
        {
            if (generation == 0 || epoch != generation) return;
            emit(new CandidateEnvelope("candidate", 2, generation, checked(++sequence), result.Transaction, date,
                "mouse", "compound-caption-drag", false, false, new CompoundDragEvidence(result.Terminal, true, true, true,
                    result.InputAgeMs, result.FromMonitor, result.ToMonitor, result.MoveDirection, true, result.TwoDisplayLayoutConfirmed)));
        }
    }
    internal void Close(int epoch, int transaction, string date, string origin, WindowCloseEvidence evidence)
    {
        lock (gate)
        {
            if (generation == 0 || epoch != generation) return;
            emit(new CandidateEnvelope("candidate", 2, generation, checked(++sequence), transaction, date,
                origin, origin == "mouse" ? "close-button" : "alt-f4", false, false, evidence));
        }
    }
    internal void Placement(int epoch, string date, PlacementResult result)
    {
        lock (gate)
        {
            if (generation == 0 || epoch != generation) return;
            // Compound results await #113's atomic multi-operation transport/writer.
            if (result.Evidence.monitorChanged) return;
            emit(new CandidateEnvelope("candidate", 2, generation, checked(++sequence), result.Transaction, date,
                result.Origin, result.Origin == "mouse" ? "caption-edge-drag" : "win-held-arrows", false, false, result.Evidence));
        }
    }
    internal void Switch(int epoch, int transaction, string date, string origin, WindowSwitchEvidence evidence)
    {
        lock (gate)
        {
            if (generation == 0 || epoch != generation) return;
            emit(new CandidateEnvelope("candidate", 2, generation, checked(++sequence), transaction, date,
                origin, origin == "mouse" ? "direct-click" : "alt-tab", false, false, evidence));
        }
    }
    internal void Taskbar(int epoch, int transaction, string date, string origin, TaskbarInputEvidence evidence)
    {
        lock (gate)
        {
            if (generation == 0 || epoch != generation) return;
            emit(new CandidateEnvelope("candidate", 2, generation, checked(++sequence), transaction, date,
                origin, origin == "mouse" ? "taskbar-click" : "win-digit", false, false, evidence));
        }
    }
    internal void Invocation(int epoch, int transaction, string origin, SnapInvocationEvidence evidence)
    {
        lock (gate)
        {
            if (generation == 0 || epoch != generation) return;
            emit(new CandidateEnvelope("candidate", 2, generation, checked(++sequence), transaction,
                DateTime.Now.ToString("yyyy-MM-dd"), origin, origin == "key" ? "win-z" : "max-button-hover",
                false, false, evidence));
        }
    }
    internal void Complete(WindowCandidate candidate)
    {
        lock (gate)
        {
            if (generation == 0 || candidate.generation != generation) return;
            int finalSequence = checked(++sequence);
            emit(V2(candidate, finalSequence, candidate.Transaction));
        }
    }
    internal static CandidateEnvelope V2(WindowCandidate c, int sequence, int transaction) => new(
        "candidate", 2, c.generation, sequence, transaction, c.date, c.origin, c.route, c.injected, c.conflicted,
        new WindowEvidence(new(c.app, c.operation, c.before, c.after, c.afterArranged, c.moving, c.elevated,
            c.targetMatched, c.inputAgeMs, c.monitor, c.fromMonitor, c.toMonitor, c.moveDirection, c.moveConfirmed, c.twoDisplayLayoutConfirmed)));
}
