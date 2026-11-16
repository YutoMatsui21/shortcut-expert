// Independent caption subscriptions share physical click facts and one completion barrier.
internal sealed class CaptionClickResultAdapter
{
    private readonly GestureManager gestures = new();
    private readonly DetectionSession session;
    private readonly CandidateSink sink;
    private ResultComposer.Pending? pending;
    private GestureManager.Input? input;
    private long now;
    private int generation;

    internal CaptionClickResultAdapter(DetectionSession session, CandidateSink sink)
    {
        this.session = session;
        this.sink = sink;
    }

    internal void Register(DetectionRouter router) =>
        router.Subscribe(
            new[] { ObservedKind.CaptionPress, ObservedKind.CaptionResult },
            (observed, _) =>
            {
                if (observed is CaptionPressEvent press)
                    Begin(press.Facts, press.Date);
                if (observed is CaptionResultEvent completed)
                    Complete(completed.Facts);
            }
        );

    internal void Start(int epoch)
    {
        pending?.Cancel();
        generation = epoch;
        gestures.Reset(epoch);
    }

    internal void Cancel()
    {
        pending?.Cancel();
        gestures.Clear();
    }

    internal void Begin(CaptionPressFacts facts, string date)
    {
        Cancel();
        input = gestures.Begin(
            facts.Target,
            facts.Before,
            "mouse",
            "inactive-caption-click",
            facts.At,
            false,
            false,
            true,
            facts.Transaction
        );
        var composer = new ResultComposer(session, gestures, sink, () => now);
        long deadline = facts.At + 750;
        now = facts.At;
        pending = composer.Begin(
            new(input, date, deadline, () => true),
            new[] { "maximize", "switch", "reduction" }.Select(s => new ResultComposer.Subscription(
                s,
                deadline
            ))
        );
    }

    internal void Complete(CaptionCompletionFacts facts)
    {
        if (
            input is null
            || pending is null
            || input.Transaction != facts.Press.Transaction
            || input.Window != facts.Press.Target
            || facts.After.Process != input.Before.Process
        )
            return;
        now = facts.At;
        gestures.AwaitResult(input.Gesture, facts.ReleasedAt);
        if (!gestures.Complete(input.Gesture, input.Window, facts.After, now))
        {
            pending.Cancel();
            return;
        }
        var identity = new DetectionRouter.CompletionIdentity(
            generation,
            input.Window,
            input.Before.Process,
            "caption"
        );
        Finish("maximize", MaximizeDetector.InactiveClick(facts));
        Finish("switch", CaptionSwitchDetector.Detect(facts));
        Finish("reduction", RestoreMinimizeDetector.InactiveClick(facts));
        pending.Seal();
        void Finish(string name, IndependentProof? proof)
        {
            if (proof is null)
                pending.Reject(name, identity, input.Gesture);
            else
                pending.Confirm(name, identity, input.Gesture, proof);
        }
    }
}
