using System.Text.Json;

internal static partial class Program
{
    private sealed class ComposerFixture
    {
        internal readonly DetectionSession Session = new();
        internal readonly GestureManager Gestures = new();
        internal readonly List<object> Output = new();
        internal readonly CandidateSink Sink;
        internal readonly ResultComposer Composer;
        internal readonly GestureManager.Input Input;
        internal long Now;
        internal bool TargetValid = true;

        internal ComposerFixture(bool injected = false, bool conflicted = false)
        {
            Session.Start(1);
            Gestures.Reset(1);
            Sink = new(Output.Add);
            Sink.Start(1, 2);
            Composer = new(Session, Gestures, Sink, () => Now);
            Input = Gestures.Begin(
                11,
                normal,
                "mouse",
                "caption-drag",
                0,
                injected,
                conflicted,
                true,
                Session.Allocator(1)()
            );
        }

        internal DetectionRouter.CompletionIdentity Identity =>
            new(1, 11, normal.Process, "caption");

        internal ResultComposer.Pending Begin(params string[] subscribers) =>
            Composer.Begin(
                Input,
                "2026-11-13",
                subscribers.Select(name => new ResultComposer.Subscription(name, 900)),
                1000,
                () => TargetValid
            );

        internal void Terminal()
        {
            Equal(true, Gestures.AwaitResult(Input.Gesture, 100));
            Equal(true, Gestures.Complete(Input.Gesture, 11, normal, 200));
        }

        internal CandidateEnvelope Envelope => Output.Cast<CandidateEnvelope>().Single();
        internal IndependentProof[] Results =>
            ((IndependentResultsEvidence)Envelope.evidence).results.ToArray();
    }

    private static readonly MonitorBounds composerMonitor = new(0, 0, 1920, 1080);
    private static readonly IndependentMonitorMoveProof composerMove = new(
        IndependentMonitorMoveRoute.CaptionDrag,
        true,
        true,
        200,
        composerMonitor,
        new(1920, 0, 1920, 1080),
        IndependentMoveDirection.Right,
        true
    );
    private static readonly IndependentPlacementProof composerHalf = new(
        IndependentPlacementRoute.CaptionEdgeDrag,
        IndependentPlacementShape.LeftHalf,
        true,
        true,
        200,
        new(1920, 0, 1920, 1080)
    );
    private static readonly IndependentStateProof composerMaximize = new(
        IndependentStateRoute.CaptionTopDrag,
        IndependentStateAction.Maximize,
        IndependentBeforeState.Normal,
        IndependentAfterState.Maximized,
        false,
        null,
        200,
        composerMonitor
    );

    private static List<string> ResultComposerTests()
    {
        var wire = new List<string>();
        Check(
            "composer waits for pending subscribers and common terminal before partial adoption",
            () =>
            {
                var f = new ComposerFixture();
                var pending = f.Begin("move", "state");
                Equal(true, pending.Confirm("move", f.Identity, f.Input.Gesture, composerMove));
                Equal(0, f.Output.Count);
                f.Terminal();
                pending.Seal();
                Equal(0, f.Output.Count);
                Equal(true, pending.Reject("state", f.Identity, f.Input.Gesture));
                Equal(1, f.Results.Length);
                Equal(composerMove, f.Results[0]);
                Equal(1, f.Envelope.transaction);
                Equal(1, f.Envelope.sequence);
                wire.Add(JsonSerializer.Serialize(f.Envelope));
                pending.Confirm("state", f.Identity, f.Input.Gesture, composerMaximize);
                pending.Seal();
                f.Begin("late").Confirm("late", f.Identity, f.Input.Gesture, composerHalf);
                Equal(1, f.Output.Count);
            }
        );
        foreach (int count in new[] { 2, 3 })
            Check(
                $"composer emits all {count} results through production sink in canonical order",
                () =>
                {
                    var f = new ComposerFixture();
                    var pending = f.Begin(
                        count == 2
                            ? new[] { "placement", "move" }
                            : new[] { "placement", "state", "move" }
                    );
                    pending.Confirm("placement", f.Identity, f.Input.Gesture, composerHalf);
                    if (count == 3)
                        pending.Confirm("state", f.Identity, f.Input.Gesture, composerMaximize);
                    pending.Confirm("move", f.Identity, f.Input.Gesture, composerMove);
                    pending.Seal(); // No common terminal yet: intermediate state is never emitted.
                    Equal(0, f.Output.Count);
                    f.Terminal();
                    pending.Seal();
                    Equal(count, f.Results.Length);
                    Equal(composerMove, f.Results[0]);
                    Equal(composerHalf, f.Results[^1]);
                    wire.Add(JsonSerializer.Serialize(f.Envelope));
                }
            );
        Check(
            "composer all rejected emits nothing and per-detector timeout permits partial result",
            () =>
            {
                foreach (bool confirmed in new[] { false, true })
                {
                    var f = new ComposerFixture();
                    var pending = f.Begin("move", "pending");
                    if (confirmed)
                        pending.Confirm("move", f.Identity, f.Input.Gesture, composerMove);
                    else
                        pending.Reject("move", f.Identity, f.Input.Gesture);
                    f.Terminal();
                    pending.Seal();
                    f.Now = 901;
                    pending.Tick();
                    Equal(confirmed ? 1 : 0, f.Output.Count);
                }
            }
        );
        Check(
            "composer deduplicates identical proof and rejects conflicting semantic category only",
            () =>
            {
                foreach (bool conflict in new[] { false, true })
                {
                    var f = new ComposerFixture();
                    var pending = f.Begin("move", "half-a", "half-b");
                    pending.Confirm("half-a", f.Identity, f.Input.Gesture, composerHalf);
                    pending.Confirm(
                        "half-b",
                        f.Identity,
                        f.Input.Gesture,
                        conflict
                            ? composerHalf with
                            {
                                shape = IndependentPlacementShape.RightHalf,
                            }
                            : composerHalf
                    );
                    pending.Confirm("move", f.Identity, f.Input.Gesture, composerMove);
                    f.Terminal();
                    pending.Seal();
                    Equal(conflict ? 1 : 2, f.Results.Length);
                    Equal(composerMove, f.Results[0]);
                }
            }
        );
        foreach (
            string invalid in new[]
            {
                "cancel",
                "expired",
                "target",
                "process",
                "generation",
                "lease",
                "stop",
                "replacement",
                "unreleased",
                "injected",
                "conflicted",
            }
        )
            Check(
                "composer discards invalid common gesture: " + invalid,
                () =>
                {
                    var f = new ComposerFixture(
                        injected: invalid == "injected",
                        conflicted: invalid == "conflicted"
                    );
                    var pending = f.Begin("move", "state");
                    pending.Confirm("move", f.Identity, f.Input.Gesture, composerMove);
                    if (invalid != "unreleased")
                        f.Terminal();
                    switch (invalid)
                    {
                        case "cancel":
                            f.Input.Gesture.State = GestureManager.Phase.Cancelled;
                            break;
                        case "expired":
                            f.Now = 1001;
                            break;
                        case "target":
                            f.TargetValid = false;
                            break;
                        case "process":
                            f.Input.Gesture.End = new(200, normal with { Process = 999 });
                            break;
                        case "generation":
                            f.Session.Start(2);
                            break;
                        case "lease":
                            f.Session.Start(1);
                            break;
                        case "stop":
                            f.Session.Stop();
                            f.Sink.Stop();
                            break;
                        case "replacement":
                            f.Gestures.Start(12, normal, "caption", 300);
                            break;
                    }
                    pending.Reject("state", f.Identity, f.Input.Gesture);
                    pending.Seal();
                    pending.Tick();
                    Equal(0, f.Output.Count);
                }
            );
        Check(
            "composer rejects unknown subscriber and cross-gesture completion without mixing",
            () =>
            {
                var f = new ComposerFixture();
                var pending = f.Begin("move");
                Equal(false, pending.Confirm("unknown", f.Identity, f.Input.Gesture, composerMove));
                Equal(
                    false,
                    pending.Confirm(
                        "move",
                        f.Identity with
                        {
                            Target = 12,
                        },
                        f.Input.Gesture,
                        composerMove
                    )
                );
                var other = new GestureManager.Gesture(
                    999,
                    0,
                    1,
                    11,
                    "caption",
                    new(0, normal),
                    false,
                    false,
                    true
                );
                Equal(false, pending.Confirm("move", f.Identity, other, composerMove));
                Equal(true, pending.Confirm("move", f.Identity, f.Input.Gesture, composerMove));
                f.Terminal();
                pending.Seal();
                Equal(1, f.Output.Count);
            }
        );
        Check(
            "composer subscriptions are fixed and router completion closes common terminal",
            () =>
            {
                var f = new ComposerFixture();
                var router = new DetectionRouter();
                router.Reset(1);
                ResultComposer.Pending? pending = null;
                DetectionRouter.Delivery? waiting = null;
                var subscribers = new List<ResultComposer.Subscription>
                {
                    new("move", 800),
                    new("state", 900),
                };
                router.Subscribe(
                    new[] { ObservedKind.MoveStart },
                    (observed, delivery) =>
                    {
                        pending = f.Composer.Begin(
                            f.Input,
                            "2026-11-13",
                            subscribers,
                            1000,
                            () => f.TargetValid
                        );
                        waiting = delivery;
                        delivery.Await(
                            f.Input.Gesture,
                            () => f.TargetValid,
                            () =>
                            {
                                f.Terminal();
                                pending.Confirm(
                                    "state",
                                    f.Identity,
                                    f.Input.Gesture,
                                    composerMaximize
                                );
                                pending.Seal();
                            }
                        );
                    }
                );
                router.Dispatch(new(ObservedKind.MoveStart, 1, 11, 0));
                subscribers.Add(new("late", 900));
                Equal(false, pending!.Confirm("late", f.Identity, f.Input.Gesture, composerHalf));
                pending.Confirm("move", f.Identity, f.Input.Gesture, composerMove);
                Equal(0, f.Output.Count);
                Equal(true, waiting!.Complete(f.Identity, f.Input.Gesture));
                Equal(2, f.Results.Length);
                Equal(false, waiting.Complete(f.Identity, f.Input.Gesture));
                Equal(1, f.Output.Count);
            }
        );
        return wire;
    }
}
