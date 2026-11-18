using System.Text.Json;

internal static partial class Program
{
    private static void IndependentDetectorRegistration()
    {
        var baseline = new IndependentRouterFixture();
        var extended = new IndependentRouterFixture();
        var detector = new FixtureDetector(extended.Session, extended.Sink);
        detector.Register(extended.Router);
        var before = IndependentNormal();

        ReplayIndependentKey(baseline, before, "key-half");
        ReplayIndependentKey(extended, before, "key-half");
        Equal(JsonSerializer.Serialize(baseline.Output), JsonSerializer.Serialize(extended.Output));

        extended.Router.Dispatch(new TickEvent(1, 42, 200, before, 42, "2026-11-15"));
        var added = (CandidateEnvelope)extended.Output[1];
        Equal(2, added.sequence);
        Equal(2, added.transaction);
        Equal<IndependentProof>(
            composerHalf,
            ((IndependentResultsEvidence)added.evidence).results.Single()
        );

        extended.Router.Stop();
        extended.Router.Dispatch(new TickEvent(1, 42, 210, before, 42, "2026-11-15"));
        Equal(2, extended.Output.Count);
        Equal(1, detector.Deliveries);
    }

    private sealed class FixtureDetector(DetectionSession session, CandidateSink sink)
    {
        internal int Deliveries { get; private set; }

        internal void Register(DetectionRouter router) =>
            router.Subscribe(
                new[] { ObservedKind.Tick },
                (observed, _) =>
                {
                    if (observed is TickEvent { Target: 42, After: not null } terminal)
                        Complete(terminal);
                }
            );

        private void Complete(TickEvent terminal)
        {
            Deliveries++;
            var gestures = new GestureManager();
            gestures.Reset(terminal.Generation);
            var input = gestures.Begin(
                terminal.Target,
                terminal.After!,
                "mouse",
                "caption-drag",
                terminal.At - 200,
                false,
                false,
                true,
                session.Allocator(terminal.Generation)()
            );
            var composer = new ResultComposer(session, gestures, sink, () => terminal.At);
            var result = composer.Begin(
                new(input, terminal.Date, terminal.At, () => true),
                new[] { new ResultComposer.Subscription("fixture-detector", terminal.At) }
            );
            Equal(true, gestures.AwaitResult(input.Gesture, terminal.At - 100));
            Equal(
                true,
                gestures.Complete(input.Gesture, terminal.Target, terminal.After!, terminal.At)
            );
            Equal(
                true,
                result.Confirm(
                    "fixture-detector",
                    new(
                        terminal.Generation,
                        terminal.Target,
                        terminal.After!.Process,
                        input.Gesture.Source
                    ),
                    input.Gesture,
                    composerHalf
                )
            );
            Equal(true, result.Seal());
        }
    }
}
