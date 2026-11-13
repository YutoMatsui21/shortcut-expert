// Validates only common input ownership and lifecycle. Proof-specific success
// and per-detector deadlines belong to detectors and their result barrier.
internal sealed class ComposerGesture
{
    private readonly ResultComposer.GestureContext context;
    private readonly GestureManager manager;
    private readonly Func<bool> leaseValid;
    private readonly DetectionRouter.CompletionIdentity identity;
    private GestureManager.Input Input => context.Input;
    private GestureManager.Gesture Gesture => Input.Gesture;

    internal bool AlreadyClaimed { get; }

    internal ComposerGesture(
        ResultComposer.GestureContext context,
        GestureManager manager,
        Func<bool> leaseValid
    )
    {
        this.context = context;
        this.manager = manager;
        this.leaseValid = leaseValid;
        AlreadyClaimed = Gesture.ResultsClaimed;
        Gesture.ResultsClaimed = true;
        identity = new(Gesture.Generation, Input.Window, Input.Before.Process, Gesture.Source);
    }

    internal bool IsValid(long now) =>
        CurrentLease(now) && PhysicalInput() && TargetIdentity() && TerminalValid();

    private bool CurrentLease(long now) =>
        leaseValid() && manager.IsCurrent(Gesture) && now <= context.Deadline;

    private bool PhysicalInput() =>
        Input.Transaction > 0
        && Input.Origin is "mouse" or "key"
        && (Input.Origin == "key") == (Gesture.Source == "key")
        && !Input.Injected
        && !Input.Conflicted
        && Input.Matched;

    private bool TargetIdentity() =>
        context.TargetValid()
        && Gesture.Start.State.Process == Input.Before.Process
        && Gesture.Matched
        && !Gesture.Injected
        && !Gesture.Modified;

    private bool TerminalValid()
    {
        if (Gesture.State is GestureManager.Phase.Cancelled or GestureManager.Phase.Expired)
            return false;
        return Gesture.End is not { } end
            || (end.State.Process == Input.Before.Process && end.At >= Gesture.Start.At);
    }

    internal bool Matches(
        DetectionRouter.CompletionIdentity completed,
        GestureManager.Gesture expected
    ) => completed == identity && ReferenceEquals(Gesture, expected);

    internal bool HasTerminalRelease() =>
        Gesture.State == GestureManager.Phase.Completed
        && Gesture.End is { } end
        && Gesture.ReleasedAt is { } released
        && released >= Gesture.Start.At
        && released <= end.At;

    internal CandidateDraft Draft(IndependentProof[] proofs) =>
        new(
            Gesture.Generation,
            Input.Transaction,
            context.Date,
            Input.Origin,
            "independent-results",
            false,
            false,
            new IndependentResultsEvidence(true, true, true, proofs)
        );
}
