using static NativeMethods;

internal static partial class Program
{
    private static void IndependentCaptionTests()
    {
        foreach (int hit in new[] { HTMAXBUTTON, HTMINBUTTON, 1 })
        foreach (bool unknownArranged in new[] { false, true })
        foreach (
            string mode in new[]
            {
                "valid",
                "no-activation",
                "state-before-release",
                "no-release",
                "injected",
                "foreign",
                "wrong-process",
                "expired",
                "cancel",
                "no-state",
            }
        )
            Check(
                $"independent caption compatibility {hit}/{unknownArranged}/{mode}",
                () =>
                {
                    var legacy = ReplayCaption(hit, unknownArranged, mode, false);
                    var migrated = ReplayCaption(hit, unknownArranged, mode, true);
                    Equal(legacy, migrated);
                    if (hit == HTMAXBUTTON && mode == "valid" && migrated is not null)
                        independentMouseSamples.Add(
                            new
                            {
                                line = System.Text.Json.JsonSerializer.Serialize(migrated),
                                expected = new[] { "W01", "W03" },
                                origin = "mouse",
                            }
                        );
                }
            );
    }

    private static CandidateEnvelope? ReplayCaption(
        int hit,
        bool unknownArranged,
        string mode,
        bool migrate
    )
    {
        var before = normal with
        {
            Arranged = unknownArranged ? null : false,
            Monitor = new(0, 0, 1920, 1080),
        };
        var after = before with { Show = hit == HTMINBUTTON ? SW_SHOWMINIMIZED : SW_SHOWMAXIMIZED };
        var output = new List<object>();
        var sink = new CandidateSink(output.Add);
        sink.Start(1, 2);
        var session = new DetectionSession();
        session.Start(1);
        var adapter = new CaptionClickResultAdapter(session, sink);
        adapter.Start(1);
        var router = new DetectionRouter();
        router.Reset(1);
        adapter.Register(router);
        var policy = new InactiveCaptionPolicy();
        Equal(true, policy.Start(11, before, hit, default, 0, 100, 1, true, true, false));
        if (migrate)
            router.Dispatch(new CaptionPressEvent(1, policy.PressFacts!, "2026-11-15"));
        if (mode != "no-activation")
            policy.Foreground(11, 11, 110);
        if (mode == "state-before-release")
            policy.State(after, 90);
        if (mode != "no-release")
            policy.Mouse(WM_LBUTTONUP, default, mode == "injected" ? 1u : 0u, false, 11, 7, 100);
        if (mode != "no-state")
            policy.State(after, 150);
        if (mode == "foreign")
            policy.Foreground(12, 12, 160);
        if (mode == "wrong-process")
            after = after with { Process = 8 };
        if (mode == "cancel")
        {
            policy.Cancel();
            adapter.Cancel();
        }
        if (mode == "no-state")
            after = before;
        long at = mode == "expired" ? 751 : 510;
        if (migrate)
        {
            var facts = policy.PollFacts(after, at);
            if (facts is not null)
            {
                router.Dispatch(new CaptionResultEvent(1, facts));
                router.Dispatch(new CaptionResultEvent(1, facts));
            }
        }
        else if (policy.Poll(after, at) is { } result)
            sink.CaptionClick(1, result.Transaction, "2026-11-15", result.Evidence);
        Equal(true, output.Count <= 1);
        return output.Cast<CandidateEnvelope>().SingleOrDefault();
    }
}
