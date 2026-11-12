// All entry points run on the owning message-loop thread. Workers must post completion back
// to that thread; they cannot mutate deliveries or call policies directly.
internal sealed class DetectionRouter
{
    internal enum State
    {
        Processing,
        Processed,
        AwaitingResult,
        Completed,
        Cancelled,
    }

    private sealed record Subscription(
        HashSet<ObservedKind> Kinds,
        Action<ObservedEvent, Delivery> Handle
    );

    private readonly List<Subscription> subscriptions = new();
    private readonly HashSet<Delivery> pending = new();
    private readonly int owner = Environment.CurrentManagedThreadId;
    private int generation;
    private long revision;

    private void VerifyThread()
    {
        if (Environment.CurrentManagedThreadId != owner)
            throw new InvalidOperationException("DetectionRouter requires its message-loop thread");
    }

    internal void Subscribe(IEnumerable<ObservedKind> kinds, Action<ObservedEvent, Delivery> handle)
    {
        VerifyThread();
        subscriptions.Add(new(new(kinds), handle));
    }

    internal void Reset(int nextGeneration)
    {
        Stop();
        generation = nextGeneration;
    }

    internal void Stop()
    {
        VerifyThread();
        generation = 0;
        revision++;
        foreach (var delivery in pending.ToArray())
            delivery.Cancel();
    }

    internal void Dispatch(ObservedEvent observed)
    {
        VerifyThread();
        if (generation <= 0 || observed.Generation != generation)
            return;
        long currentRevision = revision;
        foreach (var subscription in subscriptions)
        {
            if (revision != currentRevision)
                break;
            if (!subscription.Kinds.Contains(observed.Kind))
                continue;
            var delivery = new Delivery(this, observed, revision);
            try
            {
                subscription.Handle(observed, delivery);
                if (delivery.Status == State.Processing)
                    delivery.Processed();
            }
            catch
            {
                delivery.Cancel();
                throw;
            }
        }
    }

    internal sealed class Delivery(DetectionRouter router, ObservedEvent observed, long revision)
    {
        internal State Status { get; private set; } = State.Processing;
        private GestureManager.Gesture? gesture;
        private Func<bool>? valid;
        private Action? completed;

        internal void Processed()
        {
            router.VerifyThread();
            if (Status == State.Processing)
                Status = State.Processed;
        }

        internal void Await(GestureManager.Gesture expected, Func<bool> isValid, Action onCompleted)
        {
            router.VerifyThread();
            if (
                Status != State.Processing
                || router.revision != revision
                || router.generation <= 0
                || router.generation != observed.Generation
                || expected.Generation != observed.Generation
                || expected.Window != observed.Target
                || !isValid()
            )
                throw new InvalidOperationException("Invalid pending delivery");
            gesture = expected;
            valid = isValid;
            completed = onCompleted;
            Status = State.AwaitingResult;
            router.pending.Add(this);
        }

        internal bool Complete(
            int generation,
            nint target,
            uint process,
            string source,
            GestureManager.Gesture expected
        )
        {
            router.VerifyThread();
            if (Status != State.AwaitingResult)
                return false;
            if (
                router.revision != revision
                || router.generation != observed.Generation
                || valid!() != true
                || gesture!.State
                    is not (GestureManager.Phase.Observing or GestureManager.Phase.AwaitingResult)
            )
            {
                Cancel();
                return false;
            }
            if (
                generation != observed.Generation
                || target != observed.Target
                || process != gesture!.Start.State.Process
                || !ReferenceEquals(gesture, expected)
                || source != gesture.Source
            )
                return false;
            var callback = completed!;
            Status = State.Completed;
            Release();
            callback();
            return true;
        }

        internal void Cancel()
        {
            router.VerifyThread();
            if (Status is State.Completed or State.Cancelled or State.Processed)
                return;
            Status = State.Cancelled;
            Release();
        }

        private void Release()
        {
            router.pending.Remove(this);
            gesture = null;
            valid = null;
            completed = null;
        }
    }
}
