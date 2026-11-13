// Like DetectionRouter, this component is owned by the message-loop thread. Workers
// post detector completions back to the router; neither hook nor worker waits here.
// Existing detectors retain their legacy outlets until their individual migration.
internal sealed class ResultComposer(
    DetectionSession session,
    GestureManager gestures,
    CandidateSink sink,
    Func<long> clock
)
{
    internal sealed record Subscription(string Detector, long Deadline);

    private readonly GestureManager manager = gestures;
    private readonly CandidateSink output = sink;
    private readonly Func<long> now = clock;

    private readonly int owner = Environment.CurrentManagedThreadId;

    private void VerifyThread()
    {
        if (Environment.CurrentManagedThreadId != owner)
            throw new InvalidOperationException("ResultComposer requires its message-loop thread");
    }

    // The caller fixes subscriptions when routing the input and supplies a live target
    // identity/reuse check. All deadlines use the same monotonic clock as the router.
    internal Pending Begin(
        GestureManager.Input input,
        string date,
        IEnumerable<Subscription> subscriptions,
        long deadline,
        Func<bool> targetValid
    )
    {
        VerifyThread();
        var subscribers = subscriptions.ToArray();
        if (
            subscribers.Any(s => string.IsNullOrWhiteSpace(s.Detector))
            || subscribers.Select(s => s.Detector).Distinct().Count() != subscribers.Length
        )
            throw new ArgumentException(
                "Detector subscriptions must be unique",
                nameof(subscriptions)
            );
        bool claimed = input.Gesture.ResultsClaimed;
        input.Gesture.ResultsClaimed = true;
        return new(
            this,
            input,
            date,
            subscribers,
            deadline,
            targetValid,
            session.Lease(input.Gesture.Generation),
            claimed
        );
    }

    internal sealed class Pending
    {
        private sealed class Result(long deadline)
        {
            internal long Deadline { get; } = deadline;
            internal bool Finished;
            internal IndependentProof? Proof;
        }

        private readonly ResultComposer composer;
        private readonly GestureManager.Input input;
        private readonly string date;
        private readonly long deadline;
        private readonly Func<bool> targetValid,
            leaseValid;
        private readonly Dictionary<string, Result> results;
        private readonly DetectionRouter.CompletionIdentity identity;
        private bool closed,
            sealedInput;

        internal Pending(
            ResultComposer composer,
            GestureManager.Input input,
            string date,
            Subscription[] subscriptions,
            long deadline,
            Func<bool> targetValid,
            Func<bool> leaseValid,
            bool closed
        )
        {
            this.composer = composer;
            this.input = input;
            this.date = date;
            this.deadline = deadline;
            this.targetValid = targetValid;
            this.leaseValid = leaseValid;
            this.closed = closed;
            results = subscriptions.ToDictionary(s => s.Detector, s => new Result(s.Deadline));
            identity = new(
                input.Gesture.Generation,
                input.Window,
                input.Before.Process,
                input.Gesture.Source
            );
        }

        private bool Valid()
        {
            composer.VerifyThread();
            if (closed)
                return false;
            if (!CurrentLease() || !PhysicalInput() || !TargetIdentity() || !TerminalValid())
            {
                Cancel();
                return false;
            }
            return true;
        }

        private bool CurrentLease() =>
            leaseValid() && composer.manager.IsCurrent(input.Gesture) && composer.now() <= deadline;

        private bool PhysicalInput() =>
            input.Transaction > 0
            && input.Origin is "mouse" or "key"
            && (input.Origin == "key") == (input.Gesture.Source == "key")
            && !input.Injected
            && !input.Conflicted
            && input.Matched;

        private bool TargetIdentity() =>
            targetValid()
            && input.Gesture.Start.State.Process == input.Before.Process
            && input.Gesture.Matched
            && !input.Gesture.Injected
            && !input.Gesture.Modified;

        private bool TerminalValid()
        {
            var g = input.Gesture;
            if (g.State is GestureManager.Phase.Cancelled or GestureManager.Phase.Expired)
                return false;
            return g.End is not { } end
                || (end.State.Process == input.Before.Process && end.At >= g.Start.At);
        }

        internal bool Confirm(
            string detector,
            DetectionRouter.CompletionIdentity completed,
            GestureManager.Gesture gesture,
            IndependentProof proof
        ) => Finish(detector, completed, gesture, proof);

        internal bool Reject(
            string detector,
            DetectionRouter.CompletionIdentity completed,
            GestureManager.Gesture gesture
        ) => Finish(detector, completed, gesture, null);

        private bool Finish(
            string detector,
            DetectionRouter.CompletionIdentity completed,
            GestureManager.Gesture gesture,
            IndependentProof? proof
        )
        {
            if (
                !Valid()
                || completed != identity
                || !ReferenceEquals(input.Gesture, gesture)
                || !results.TryGetValue(detector, out var result)
            )
                return false;
            if (result.Finished)
                return false;
            result.Finished = true;
            result.Proof = composer.now() <= result.Deadline ? proof : null;
            Publish();
            return true;
        }

        // The shared input lifecycle must already contain release and terminal facts.
        // Calling early is harmless and cannot turn intermediate window state into proof.
        internal void Seal()
        {
            if (!Valid())
                return;
            var g = input.Gesture;
            if (
                g.State != GestureManager.Phase.Completed
                || g.End is null
                || g.ReleasedAt is not { } released
                || released < g.Start.At
                || released > g.End.At
            )
                return;
            sealedInput = true;
            Publish();
        }

        // Each detector has its own deadline; expiry rejects only that detector.
        // A shared deadline expiry is handled by Valid and discards the whole input.
        internal void Tick()
        {
            if (!Valid())
                return;
            foreach (var result in results.Values)
                if (!result.Finished && composer.now() > result.Deadline)
                    result.Finished = true;
            Publish();
        }

        internal void Cancel()
        {
            composer.VerifyThread();
            closed = true;
            results.Clear();
        }

        private void Publish()
        {
            if (!Valid() || !sealedInput || results.Values.Any(r => !r.Finished))
                return;
            var accepted = results
                .Values.Where(r => r.Proof is not null)
                .Select(r => r.Proof!)
                .GroupBy(Category)
                .OrderBy(g => g.Key)
                .Select(g => g.Distinct().ToArray())
                .Where(g => g.Length == 1)
                .Select(g => g[0])
                .ToArray();
            // Close before crossing the sink boundary, including the empty-result case.
            Cancel();
            if (accepted.Length == 0)
                return;
            composer.output.Submit(
                new(
                    input.Gesture.Generation,
                    input.Transaction,
                    date,
                    input.Origin,
                    "independent-results",
                    false,
                    false,
                    new IndependentResultsEvidence(true, true, true, accepted)
                )
            );
        }

        // Semantic categories, not product operation IDs or a combination allowlist.
        private static int Category(IndependentProof proof) =>
            proof switch
            {
                IndependentSwitchProof => 0,
                IndependentMonitorMoveProof => 1,
                IndependentStateProof state => StateCategory(state),
                IndependentPlacementProof placement => PlacementCategory(placement),
                IndependentCloseProof => 6,
                IndependentTaskbarProof => 7,
                _ => throw new ArgumentException("Unsupported proof", nameof(proof)),
            };

        private static int StateCategory(IndependentStateProof proof) =>
            proof.action == IndependentStateAction.Maximize ? 2 : 3;

        private static int PlacementCategory(IndependentPlacementProof proof) =>
            proof.shape is IndependentPlacementShape.LeftHalf or IndependentPlacementShape.RightHalf
                ? 4
                : 5;
    }
}
