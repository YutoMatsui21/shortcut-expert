internal sealed class OperationResultSession(
    GestureManager gestures,
    DetectionSession session,
    CandidateSink sink,
    Func<string> date
)
{
    private static readonly string[] subscribers = ["monitor-move", "maximize", "quarter"];
    private ResultComposer.Pending? pending;
    private GestureManager.Input? input;
    private long now;

    internal void Begin(GestureManager.Input value, long at)
    {
        if (ReferenceEquals(input?.Gesture, value.Gesture))
            return;
        pending?.Cancel();
        input = value with { Origin = value.Gesture.Source == "key" ? "key" : "mouse" };
        now = at;
        // Mouse drags are bounded by MOVESIZEEND, keys by the series deadline.
        long deadline =
            value.Gesture.Source == "key" ? value.Gesture.Start.At + 15000 : long.MaxValue;
        var timed = new ResultComposer(session, gestures, sink, () => now);
        pending = timed.Begin(
            new(input, "", deadline, () => true, date),
            subscribers.Select(s => new ResultComposer.Subscription(s, deadline))
        );
    }

    internal void Finish(WindowState after, long at, params IndependentProof?[] proofs)
    {
        if (pending is null || input is null)
            return;
        now = at;
        if (!gestures.Complete(input.Gesture, input.Window, after, at))
        {
            pending.Cancel();
            return;
        }
        var identity = new DetectionRouter.CompletionIdentity(
            input.Gesture.Generation,
            input.Window,
            input.Before.Process,
            input.Gesture.Source
        );
        for (int i = 0; i < subscribers.Length; i++)
        {
            if (proofs[i] is { } proof)
                pending.Confirm(subscribers[i], identity, input.Gesture, proof);
            else
                pending.Reject(subscribers[i], identity, input.Gesture);
        }
        pending.Seal();
    }
}
