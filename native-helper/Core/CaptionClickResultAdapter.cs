// Compatibility output for W01/W04 until their own migration. W03 is judged
// independently; the shared Composer still owns one completion and one sink call.
// Retaining caption-click also preserves unknown-arranged inactive clicks, which
// the independent-results wire contract intentionally cannot represent for mouse.
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
        var bridge = new CandidateSink(value =>
        {
            var envelope = (CandidateEnvelope)value;
            var proofs = ((IndependentResultsEvidence)envelope.evidence).results;
            string? terminal = proofs
                .OfType<IndependentStateProof>()
                .FirstOrDefault()
                ?.action switch
            {
                IndependentStateAction.Maximize => "maximized",
                IndependentStateAction.Minimize => "minimized",
                _ => null,
            };
            sink.CaptionClick(
                envelope.generation,
                envelope.transaction,
                envelope.date,
                new(
                    terminal,
                    proofs.OfType<IndependentSwitchProof>().Any(),
                    true,
                    true,
                    500,
                    facts.Before.Monitor
                )
            );
        });
        bridge.Start(generation, 2);
        var composer = new ResultComposer(session, gestures, bridge, () => now);
        long deadline = facts.At + 750;
        now = facts.At;
        pending = composer.Begin(
            new(input, date, deadline, () => true),
            new[] { "maximize", "retained-switch", "retained-minimize" }.Select(
                s => new ResultComposer.Subscription(s, deadline)
            )
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
        Finish(
            "retained-switch",
            facts.Activated
                ? new IndependentSwitchProof(
                    IndependentSwitchRoute.DirectClick,
                    true,
                    true,
                    true,
                    500,
                    500,
                    input.Before.Monitor
                )
                : null
        );
        Finish(
            "retained-minimize",
            facts.MatchedTerminal == "minimized"
                ? new IndependentStateProof(
                    IndependentStateRoute.MinButton,
                    IndependentStateAction.Minimize,
                    input.Before.Show == NativeMethods.SW_SHOWNORMAL
                        ? IndependentBeforeState.Normal
                        : IndependentBeforeState.Maximized,
                    IndependentAfterState.Minimized,
                    input.Before.Arranged,
                    facts.After.Arranged,
                    500,
                    input.Before.Monitor
                )
                : null
        );
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
