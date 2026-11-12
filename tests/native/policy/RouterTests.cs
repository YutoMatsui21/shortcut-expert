using static NativeMethods;

internal static partial class Program
{
    private static MousePressEvent RouterDragPress(IndependentDetection.Drag g) =>
        new(1, 11, 0, g.Before, g.Hit, default, 500, g.Physical ? 0u : LLMHF_INJECTED, false, true);

    // Replay the unchanged #172 drag fixtures through the production router/adapter and
    // compare complete envelopes with the existing direct-policy baseline.
    private static void VerifyRouterDrag(
        string name,
        IndependentDetection.Drag g,
        CandidateEnvelope? baseline
    )
    {
        Check(
            "router fixed drag baseline: " + name,
            () =>
            {
                const string date = "2026-11-07";
                var tracker = Tracker();
                var output = new List<object>();
                var sink = new CandidateSink(output.Add);
                sink.Start(1, 2);
                var router = new DetectionRouter();
                router.Reset(1);
                new TrackerEventAdapter(tracker, sink).Register(router);
                router.Dispatch(RouterDragPress(g));
                router.Dispatch(new ObservedEvent(ObservedKind.MoveStart, 1, 11, g.StartAge));
                router.Dispatch(
                    new StateObservedEvent(
                        1,
                        11,
                        150,
                        g.Before,
                        g.Before with
                        {
                            Show = SW_SHOWNORMAL,
                        },
                        11,
                        date,
                        g.Before.Monitor
                    )
                );
                Equal(0, output.Count);
                if (g.Released)
                    router.Dispatch(
                        new MouseReleaseEvent(
                            1,
                            200,
                            g.Release,
                            g.ReleaseMonitor,
                            g.ReleaseWork,
                            0,
                            null,
                            null
                        )
                    );
                if (g.Cancelled)
                {
                    router.Reset(1);
                    tracker.Reset(1);
                }
                router.Dispatch(new MoveEndEvent(1, 11, 5000, g.After, g.Foreground, date));
                router.Dispatch(new MoveEndEvent(1, 11, 5001, g.After, 11, date));
                Equal(baseline, output.Cast<CandidateEnvelope>().SingleOrDefault());
            }
        );
    }

    private static void InputInfrastructureTests()
    {
        GestureTests();
        Check("router subscriptions preserve event and registration order", RouterOrder);
        Check("router completion checks identity and is single use", RouterIdentity);
        Check("router cancellation reset and stop reject late completion", RouterLifetime);
        Check("router rejects worker completion and stops dispatch after reset", RouterThread);
        foreach (
            string mode in new[]
            {
                "tick",
                "release",
                "placement",
                "destroy",
                "foreground",
                "injected",
            }
        )
            Check(
                "router keyboard parity and terminal cache ordering: " + mode,
                () => RouterKeyboard(mode)
            );
        Check("tracker adapter shares gesture and emits once through sink", RouterAdapter);
    }

    private static void RouterOrder()
    {
        var router = new DetectionRouter();
        router.Reset(1);
        var seen = new List<string>();
        router.Subscribe(
            new[] { ObservedKind.MousePress, ObservedKind.KeyPress },
            (e, delivery) => seen.Add("input:" + e.Kind)
        );
        router.Subscribe(
            Enum.GetValues<ObservedKind>(),
            (e, delivery) => seen.Add("all:" + e.Kind)
        );
        foreach (
            var kind in new[]
            {
                ObservedKind.MousePress,
                ObservedKind.KeyPress,
                ObservedKind.Foreground,
                ObservedKind.MoveStart,
                ObservedKind.MoveEnd,
                ObservedKind.Destroy,
                ObservedKind.Tick,
            }
        )
            router.Dispatch(new ObservedEvent(kind, 1, 11, 10));
        Equal(
            "input:MousePress,all:MousePress,input:KeyPress,all:KeyPress,all:Foreground,all:MoveStart,all:MoveEnd,all:Destroy,all:Tick",
            string.Join(",", seen)
        );
    }

    private sealed class PendingRouter
    {
        internal DetectionRouter Router { get; } = new();
        internal GestureManager Gestures { get; } = new();
        internal DetectionRouter.Delivery Pending { get; private set; } = null!;
        internal int Completions { get; private set; }
        internal GestureManager.Gesture Gesture => Gestures.Current!;

        internal PendingRouter()
        {
            Router.Reset(1);
            Gestures.Reset(1);
            Gestures.Start(11, normal, "key", 0);
            Router.Subscribe(
                new[] { ObservedKind.KeyPress },
                (_, d) =>
                {
                    var gesture = Gesture;
                    Pending = d;
                    d.Await(
                        gesture,
                        () => ReferenceEquals(gesture, Gestures.Current),
                        () => Completions++
                    );
                }
            );
        }

        internal void Send() =>
            Router.Dispatch(new ObservedEvent(ObservedKind.KeyPress, 1, 11, 10));

        internal bool Complete() => Pending.Complete(new(1, 11, normal.Process, "key"), Gesture);
    }

    private static void RouterIdentity()
    {
        var f = new PendingRouter();
        f.Send();
        Equal(DetectionRouter.State.AwaitingResult, f.Pending.Status);
        Equal(false, f.Pending.Complete(new(1, 12, normal.Process, "key"), f.Gesture));
        Equal(false, f.Pending.Complete(new(1, 11, 999, "key"), f.Gesture));
        var other = new GestureManager();
        other.Reset(1);
        Equal(
            false,
            f.Pending.Complete(new(1, 11, normal.Process, "key"), other.Start(11, normal, "key", 0))
        );
        Equal(false, f.Pending.Complete(new(1, 11, normal.Process, "caption"), f.Gesture));
        Equal(false, f.Pending.Complete(new(2, 11, normal.Process, "key"), f.Gesture));
        Equal(true, f.Complete());
        Equal(false, f.Complete());
        Equal(1, f.Completions);
    }

    private static void RouterLifetime()
    {
        var f = new PendingRouter();
        f.Send();
        f.Pending.Cancel();
        Equal(false, f.Complete());
        f.Send();
        f.Gestures.Cancel(f.Gesture);
        Equal(false, f.Complete());
        f.Gestures.Start(11, normal, "key", 20);
        f.Send();
        var old = f.Pending;
        f.Router.Reset(1);
        Equal(DetectionRouter.State.Cancelled, old.Status);
        Equal(false, old.Complete(new(1, 11, normal.Process, "key"), f.Gesture));
        f.Send();
        old = f.Pending;
        f.Router.Stop();
        f.Send();
        Equal(false, old.Complete(new(1, 11, normal.Process, "key"), f.Gesture));
        Equal(0, f.Completions);
    }

    private static void RouterThread()
    {
        var router = new DetectionRouter();
        router.Reset(1);
        var gestures = new GestureManager();
        gestures.Reset(1);
        var gesture = gestures.Start(11, normal, "key", 0);
        DetectionRouter.Delivery? pending = null;
        router.Subscribe(
            new[] { ObservedKind.KeyPress },
            (e, d) =>
            {
                pending = d;
                d.Await(gesture, () => true, () => { });
            }
        );
        router.Dispatch(new ObservedEvent(ObservedKind.KeyPress, 1, 11, 1));
        bool rejected = Task.Run(() =>
            {
                try
                {
                    pending!.Complete(new(1, 11, normal.Process, "key"), gesture);
                    return false;
                }
                catch (InvalidOperationException)
                {
                    return true;
                }
            })
            .GetAwaiter()
            .GetResult();
        Equal(true, rejected);
        Equal(DetectionRouter.State.AwaitingResult, pending!.Status);
        router.Stop();
        int received = 0;
        router.Subscribe(
            new[] { ObservedKind.Foreground },
            (e, d) =>
            {
                received++;
                router.Reset(1);
            }
        );
        router.Subscribe(new[] { ObservedKind.Foreground }, (e, d) => received++);
        router.Reset(1);
        router.Dispatch(new ObservedEvent(ObservedKind.Foreground, 2, 11, 1));
        router.Dispatch(new ObservedEvent(ObservedKind.Foreground, 1, 11, 1));
        Equal(1, received);
    }

    private static object? FinishRouterKeyboard(
        CandidateTracker direct,
        DetectionRouter router,
        ObservedEvent terminal,
        uint key
    )
    {
        object? result;
        if (terminal is TickEvent e)
            result = direct.ConfirmMaximize(e.Target, e.After, e.At, e.Foreground, e.Date);
        else
        {
            var released = (KeyResultEvent)terminal;
            direct.KeyReleased(key, released.At);
            router.Dispatch(new KeyReleaseEvent(1, released.At, key));
            result = direct.FinishKey(
                released.Target,
                released.After,
                released.At,
                released.Injected,
                released.Date
            );
        }
        router.Dispatch(terminal);
        return result;
    }

    private static void CancelRouterKeyboard(
        string mode,
        CandidateTracker direct,
        DetectionRouter router
    )
    {
        if (mode == "destroy")
        {
            direct.Forget(11);
            router.Dispatch(new ObservedEvent(ObservedKind.Destroy, 1, 11, 10));
        }
        if (mode == "foreground")
        {
            direct.ForegroundChanged(12);
            router.Dispatch(new ObservedEvent(ObservedKind.Foreground, 1, 12, 10));
        }
    }

    private static void EmitRouterKeyboard(CandidateSink directSink, object? result)
    {
        if (result is WindowCandidate window)
            directSink.Complete(window);
        if (result is PlacementResult placement)
            directSink.Placement(1, "2026-10-11", placement);
    }

    private static void RouterKeyboard(string mode)
    {
        var before = normal with
        {
            Monitor = new(0, 0, 1000, 800),
            Work = new(0, 0, 1000, 800),
            Frame = new(100, 100, 400, 400),
            Dpi = 96,
            DisplayLayout = "one",
        };
        var after =
            mode == "placement"
                ? before with
                {
                    Arranged = true,
                    Frame = new(0, 0, 500, 800),
                }
                : before with
                {
                    Show = SW_SHOWMAXIMIZED,
                };
        var direct = Tracker();
        var routed = Tracker();
        var expected = new List<object>();
        var actual = new List<object>();
        var directSink = new CandidateSink(expected.Add);
        directSink.Start(1, 2);
        WindowState? cached = null;
        var sink = new CandidateSink(value =>
        {
            if (mode == "tick")
                Equal(after, cached);
            actual.Add(value);
        });
        sink.Start(1, 2);
        var router = new DetectionRouter();
        router.Reset(1);
        new TrackerEventAdapter(routed, sink, (_, value) => cached = value).Register(router);
        uint key = (uint)(mode == "placement" ? VK_LEFT : VK_UP);
        uint flags = mode == "injected" ? LLKHF_INJECTED : 0;
        direct.Key(11, before, key, true, false, 0, flags);
        router.Dispatch(new KeyPressEvent(1, 11, 0, before, key, true, false, flags));
        CancelRouterKeyboard(mode, direct, router);
        ObservedEvent terminal =
            mode == "tick"
                ? new TickEvent(1, 11, 100, after, 11, "2026-10-11")
                : new KeyResultEvent(1, 11, 100, after, false, "2026-10-11");
        object? result = FinishRouterKeyboard(direct, router, terminal, key);
        EmitRouterKeyboard(directSink, result);
        Equal(
            System.Text.Json.JsonSerializer.Serialize(expected),
            System.Text.Json.JsonSerializer.Serialize(actual)
        );
        Equal(mode is "destroy" or "foreground" or "injected" ? 0 : 1, actual.Count);
    }

    private static void RouterAdapter()
    {
        var tracker = Tracker();
        var output = new List<object>();
        var sink = new CandidateSink(output.Add);
        sink.Start(1, 2);
        var router = new DetectionRouter();
        router.Reset(1);
        new TrackerEventAdapter(tracker, sink).Register(router);
        DetectionRouter.Delivery? delivery = null;
        router.Subscribe(new[] { ObservedKind.MousePress }, (e, d) => delivery = d);
        router.Dispatch(
            new MousePressEvent(1, 11, 0, normal, HTMAXBUTTON, default, 500, 0, false, true)
        );
        Equal("caption", tracker.Gestures.Current!.Source);
        Equal(DetectionRouter.State.Processed, delivery!.Status);
        router.Dispatch(
            new StateObservedEvent(1, 11, 135, normal, maximized, 11, "2026-10-11", null)
        );
        router.Dispatch(
            new StateObservedEvent(1, 11, 150, maximized, maximized, 11, "2026-10-11", null)
        );
        Equal(1, output.Count);
        var direct = Tracker();
        direct.Mouse(11, normal, HTMAXBUTTON, default, 0, 500, 0, false, true);
        var directOutput = new List<object>();
        var directSink = new CandidateSink(directOutput.Add);
        directSink.Start(1, 2);
        directSink.Complete(
            (WindowCandidate)direct.Complete(11, normal, maximized, 135, 11, "2026-10-11", null)!
        );
        Equal(
            System.Text.Json.JsonSerializer.Serialize(directOutput),
            System.Text.Json.JsonSerializer.Serialize(output)
        );
    }
}
