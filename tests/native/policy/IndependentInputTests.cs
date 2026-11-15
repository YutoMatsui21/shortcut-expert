using static NativeMethods;

internal static partial class Program
{
    private static readonly List<object> independentMouseSamples = new();

    private static void IndependentInputTests()
    {
        IndependentCaptionTests();
        Equal(true, DetectionMigration.Enabled(null));
        Equal(true, DetectionMigration.Enabled("independent"));
        Equal(false, DetectionMigration.Enabled("legacy"));
        foreach (
            string mode in new[]
            {
                "key-move",
                "key-max",
                "key-quarter",
                "key-half",
                "click",
                "double-click",
                "fallback",
                "no-release",
                "injected",
                "foreign",
                "cancel",
                "expired",
            }
        )
            Check("independent input " + mode, () => IndependentInputCase(mode));
    }

    private static void IndependentInputCase(string mode)
    {
        var before = normal with
        {
            Monitor = new(0, 0, 1920, 1080),
            Work = new(0, 0, 1920, 1040),
            Dpi = 96,
            DisplayLayout = "pair",
            HasCaption = true,
        };
        var after = before with { Show = SW_SHOWMAXIMIZED };
        var session = new DetectionSession();
        session.Start(1);
        var tracker = new CandidateTracker(session);
        tracker.Reset(1);
        var output = new List<object>();
        var sink = new CandidateSink(output.Add);
        sink.Start(1, 2);
        var router = new DetectionRouter();
        router.Reset(1);
        new TrackerEventAdapter(
            tracker,
            sink,
            independent: new(tracker, session, sink, () => "2026-11-15")
        ).Register(router);
        if (mode.StartsWith("key-"))
        {
            router.Dispatch(new KeyPressEvent(1, 11, 0, null, VK_LWIN, false, false, 0));
            uint key = mode == "key-max" ? (uint)VK_UP : VK_LEFT;
            bool shift = mode == "key-move";
            router.Dispatch(new KeyPressEvent(1, 11, 10, before, key, true, false, 0, shift));
            if (shift)
                after = before with
                {
                    Monitor = new(1920, 0, 1920, 1080),
                    Work = new(1920, 0, 1920, 1040),
                };
            if (mode is "key-quarter" or "key-half")
                after = before with { Arranged = true, Frame = new(0, 0, 960, 1040) };
            router.Dispatch(new KeyReleaseEvent(1, 20, key));
            if (mode == "key-quarter")
            {
                router.Dispatch(new KeyPressEvent(1, 11, 30, after, VK_UP, true, false, 0));
                after = after with { Frame = new(0, 0, 960, 520) };
                router.Dispatch(new KeyReleaseEvent(1, 40, VK_UP));
            }
            router.Dispatch(
                new StateObservedEvent(1, 11, 50, before, after, 11, "2026-11-15", after.Monitor)
            );
            Equal(mode == "key-move" ? 1 : 0, output.Count);
            router.Dispatch(new KeyReleaseEvent(1, 60, VK_LWIN));
            router.Dispatch(new KeyResultEvent(1, 11, 70, after, false, "2026-11-15"));
        }
        else
        {
            int hit =
                mode == "fallback" ? 1
                : mode == "double-click" ? HTCAPTION
                : HTMAXBUTTON;
            if (mode == "double-click")
                router.Dispatch(
                    new MousePressEvent(1, 11, 0, before, hit, default, 500, 0, false, true)
                );
            router.Dispatch(
                new MousePressEvent(
                    1,
                    11,
                    10,
                    before,
                    hit,
                    default,
                    500,
                    mode == "injected" ? LLMHF_INJECTED : 0,
                    false,
                    true
                )
            );
            router.Dispatch(
                new StateObservedEvent(1, 11, 20, before, after, 11, "2026-11-15", after.Monitor)
            );
            Equal(0, output.Count);
            if (mode == "cancel")
                tracker.ClearInput();
            if (mode != "no-release")
                router.Dispatch(
                    new MouseReleaseEvent(
                        1,
                        30,
                        default,
                        before.Monitor,
                        before.Work,
                        0,
                        null,
                        null
                    )
                );
            router.Dispatch(
                new StateObservedEvent(
                    1,
                    11,
                    mode == "expired" ? 1011 : 40,
                    after,
                    after,
                    mode == "foreign" ? 12 : 11,
                    "2026-11-15",
                    after.Monitor
                )
            );
        }
        bool valid = mode is not ("no-release" or "injected" or "foreign" or "cancel" or "expired");
        Equal(valid ? 1 : 0, output.Count);
        if (!valid)
            return;
        var envelope = (CandidateEnvelope)output.Single();
        if (mode == "key-half")
        {
            Equal(true, envelope.evidence is PlacementEvidence);
            return;
        }
        independentMouseSamples.Add(
            new
            {
                line = System.Text.Json.JsonSerializer.Serialize(envelope),
                expected = new[]
                {
                    mode == "key-move" ? "W02"
                    : mode == "key-quarter" ? "W07"
                    : "W03",
                },
                origin = mode.StartsWith("key-") ? "key" : "mouse",
            }
        );
        var proofs = ((IndependentResultsEvidence)envelope.evidence).results;
        Equal(1, proofs.Count);
        Equal(
            true,
            mode == "key-move" ? proofs[0] is IndependentMonitorMoveProof
                : mode == "key-quarter" ? proofs[0] is IndependentPlacementProof
                : proofs[0] is IndependentStateProof
        );
    }
}
