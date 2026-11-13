// Owned by the router's message-loop thread. Workers post completions back to
// that thread; hooks and workers never wait for the completion barrier.
internal sealed class ResultComposer(
    DetectionSession session,
    GestureManager gestures,
    CandidateSink sink,
    Func<long> clock
)
{
    internal sealed record Subscription(string Detector, long Deadline);

    // Shared input facts and lifetime, distinct from individual detector deadlines.
    internal sealed record GestureContext(
        GestureManager.Input Input,
        string Date,
        long Deadline,
        Func<bool> TargetValid
    );

    private readonly CandidateSink output = sink;
    private readonly Func<long> now = clock;
    private readonly int owner = Environment.CurrentManagedThreadId;

    private void VerifyThread()
    {
        if (Environment.CurrentManagedThreadId != owner)
            throw new InvalidOperationException("ResultComposer requires its message-loop thread");
    }

    // Fix subscriptions at input routing time. Existing detectors retain their
    // legacy outlets until their individual migration to this entry point.
    internal Pending Begin(GestureContext context, IEnumerable<Subscription> subscriptions)
    {
        VerifyThread();
        var results = new DetectorResults(subscriptions);
        var gesture = new ComposerGesture(
            context,
            gestures,
            session.Lease(context.Input.Gesture.Generation)
        );
        return new(this, gesture, results);
    }

    internal sealed class Pending
    {
        private readonly ResultComposer composer;
        private readonly ComposerGesture gesture;
        private readonly DetectorResults results;
        private bool closed,
            sealedInput;

        internal Pending(ResultComposer composer, ComposerGesture gesture, DetectorResults results)
        {
            this.composer = composer;
            this.gesture = gesture;
            this.results = results;
            closed = gesture.AlreadyClaimed;
        }

        private bool Valid()
        {
            composer.VerifyThread();
            if (closed)
                return false;
            if (gesture.IsValid(composer.now()))
                return true;
            Cancel();
            return false;
        }

        internal bool Confirm(
            string detector,
            DetectionRouter.CompletionIdentity completed,
            GestureManager.Gesture expected,
            IndependentProof proof
        ) => Finish(detector, completed, expected, proof);

        internal bool Reject(
            string detector,
            DetectionRouter.CompletionIdentity completed,
            GestureManager.Gesture expected
        ) => Finish(detector, completed, expected, null);

        private bool Finish(
            string detector,
            DetectionRouter.CompletionIdentity completed,
            GestureManager.Gesture expected,
            IndependentProof? proof
        )
        {
            if (!Valid() || !gesture.Matches(completed, expected))
                return false;
            if (!results.Finish(detector, proof, composer.now()))
                return false;
            Publish();
            return true;
        }

        // Only release plus a shared terminal snapshot may seal the input.
        // Early calls cannot promote intermediate window state into proof.
        internal void Seal()
        {
            if (!Valid() || !gesture.HasTerminalRelease())
                return;
            sealedInput = true;
            Publish();
        }

        internal void Tick()
        {
            if (!Valid())
                return;
            results.Expire(composer.now());
            Publish();
        }

        internal void Cancel()
        {
            composer.VerifyThread();
            closed = true;
            results.Discard();
        }

        private void Publish()
        {
            if (!Valid() || !sealedInput || !results.AllFinished)
                return;
            var accepted = IndependentProofSet.Select(results.Confirmed);
            // Close before crossing the sink boundary, even for an empty result.
            Cancel();
            if (accepted.Length > 0)
                composer.output.Submit(gesture.Draft(accepted));
        }
    }
}
