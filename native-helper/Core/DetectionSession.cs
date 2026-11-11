// Input IDs belong to the observation session, never to a detector or delivery order.
internal sealed class DetectionSession
{
    private readonly object gate = new();
    private int generation;
    private int transaction;
    private long revision;

    internal void Start(int nextGeneration)
    {
        if (nextGeneration <= 0)
            throw new ArgumentOutOfRangeException(nameof(nextGeneration));
        lock (gate)
        {
            generation = nextGeneration;
            transaction = 0;
            revision++;
        }
    }

    internal void Stop()
    {
        lock (gate)
        {
            generation = 0;
            revision++;
        }
    }

    // Capture a lifecycle lease: even reusing a generation cannot revive an old worker.
    // Zero means inactive; it is never a valid protocol transaction.
    internal Func<int> Allocator(int epoch)
    {
        lock (gate)
        {
            long lease = revision;
            return () =>
            {
                lock (gate)
                    return generation != 0 && generation == epoch && revision == lease
                        ? checked(++transaction)
                        : 0;
            };
        }
    }
}
