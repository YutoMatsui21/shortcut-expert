using static NativeMethods;

internal static partial class Program
{
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
                router.Dispatch(
                    new MousePressEvent(
                        1,
                        11,
                        0,
                        g.Before,
                        g.Hit,
                        default,
                        500,
                        g.Physical ? 0u : LLMHF_INJECTED,
                        false,
                        true
                    )
                );
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

    private static void RouterTests()
    {
        Check(
            "router subscriptions preserve event and registration order",
            () =>
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
        );
        Check(
            "router completion is single use and checks target source gesture and reset",
            () =>
            {
                var router = new DetectionRouter();
                var gestures = new GestureManager();
                router.Reset(1);
                gestures.Reset(1);
                var gesture = gestures.Start(11, normal, "key", 0);
                DetectionRouter.Delivery? pending = null;
                int completed = 0;
                router.Subscribe(
                    new[] { ObservedKind.KeyPress },
                    (e, delivery) =>
                    {
                        pending = delivery;
                        delivery.Await(
                            gesture,
                            () =>
                                ReferenceEquals(gestures.Current, gesture)
                                && gesture.State
                                    is GestureManager.Phase.Observing
                                        or GestureManager.Phase.AwaitingResult,
                            () => completed++
                        );
                    }
                );
                var input = new ObservedEvent(ObservedKind.KeyPress, 1, 11, 10);
                router.Dispatch(input);
                Equal(DetectionRouter.State.AwaitingResult, pending!.Status);
                Equal(false, pending.Complete(1, 12, normal.Process, "key", gesture));
                Equal(false, pending.Complete(1, 11, 999, "key", gesture));
                var other = new GestureManager();
                other.Reset(1);
                Equal(
                    false,
                    pending.Complete(
                        1,
                        11,
                        normal.Process,
                        "key",
                        other.Start(11, normal, "key", 0)
                    )
                );
                Equal(false, pending.Complete(1, 11, normal.Process, "caption", gesture));
                Equal(false, pending.Complete(2, 11, normal.Process, "key", gesture));
                Equal(true, pending.Complete(1, 11, normal.Process, "key", gesture));
                Equal(false, pending.Complete(1, 11, normal.Process, "key", gesture));
                Equal(1, completed);
                router.Dispatch(input);
                pending!.Cancel();
                Equal(false, pending.Complete(1, 11, normal.Process, "key", gesture));
                router.Dispatch(input);
                gestures.Cancel(gesture);
                Equal(false, pending!.Complete(1, 11, normal.Process, "key", gesture));
                gesture = gestures.Start(11, normal, "key", 20);
                router.Dispatch(input);
                var old = pending!;
                router.Reset(1);
                Equal(DetectionRouter.State.Cancelled, old.Status);
                Equal(false, old.Complete(1, 11, normal.Process, "key", gesture));
                router.Dispatch(input);
                old = pending!;
                router.Stop();
                router.Dispatch(input);
                Equal(false, old.Complete(1, 11, normal.Process, "key", gesture));
                Equal(1, completed);
            }
        );
        Check(
            "router rejects worker completion and stops dispatch after reset",
            () =>
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
                            pending!.Complete(1, 11, normal.Process, "key", gesture);
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
        );
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
                () =>
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
                    new TrackerEventAdapter(routed, sink, (_, value) => cached = value).Register(
                        router
                    );
                    uint key = (uint)(mode == "placement" ? VK_LEFT : VK_UP);
                    uint flags = mode == "injected" ? LLKHF_INJECTED : 0;
                    direct.Key(11, before, key, true, false, 0, flags);
                    router.Dispatch(new KeyPressEvent(1, 11, 0, before, key, true, false, flags));
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
                    object? result;
                    if (mode == "tick")
                    {
                        result = direct.ConfirmMaximize(11, after, 100, 11, "2026-10-11");
                        router.Dispatch(new TickEvent(1, 11, 100, after, 11, "2026-10-11"));
                    }
                    else
                    {
                        direct.KeyReleased(key, 100);
                        router.Dispatch(new KeyReleaseEvent(1, 100, key));
                        result = direct.FinishKey(11, after, 100, false, "2026-10-11");
                        router.Dispatch(new KeyResultEvent(1, 11, 100, after, false, "2026-10-11"));
                    }
                    if (result is WindowCandidate window)
                        directSink.Complete(window);
                    if (result is PlacementResult placement)
                        directSink.Placement(1, "2026-10-11", placement);
                    Equal(
                        System.Text.Json.JsonSerializer.Serialize(expected),
                        System.Text.Json.JsonSerializer.Serialize(actual)
                    );
                    Equal(mode is "destroy" or "foreground" or "injected" ? 0 : 1, actual.Count);
                }
            );
        Check(
            "tracker adapter shares gesture and emits once through sink",
            () =>
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
                    (WindowCandidate)
                        direct.Complete(11, normal, maximized, 135, 11, "2026-10-11", null)!
                );
                Equal(
                    System.Text.Json.JsonSerializer.Serialize(directOutput),
                    System.Text.Json.JsonSerializer.Serialize(output)
                );
            }
        );
    }
}
