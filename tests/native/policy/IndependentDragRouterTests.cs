using System.Text.Json;
using static NativeMethods;

internal static partial class Program
{
    private static List<string> IndependentDragRouterTests()
    {
        var lines = new List<string>();
        var before = normal with
        {
            Monitor = new(-1920, 0, 1920, 1080),
            Work = new(-1920, 0, 1920, 1040),
            Dpi = 96,
            DisplayLayout = "pair",
            HorizontalPair = true,
            TwoDisplayPair = true,
        };
        var destination = before with
        {
            Monitor = new(0, 0, 1920, 1080),
            Work = new(0, 0, 1920, 1040),
        };
        foreach (
            string mode in new[]
            {
                "max",
                "quarter",
                "bad-max",
                "bad-quarter",
                "cross-half",
                "no-release",
                "injected",
                "cancel",
                "process",
                "layout",
                "foreground",
                "unknown-monitor",
                "release-monitor",
                "max-max",
                "same-half",
            }
        )
            Check(
                "independent drag router " + mode,
                () =>
                {
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
                        independentDrag: new(tracker.Gestures, session, sink)
                    ).Register(router);
                    var start =
                        mode == "max-max" ? before with { Show = SW_SHOWMAXIMIZED } : before;
                    var after =
                        mode.Contains("quarter") || mode is "cross-half" or "same-half"
                            ? destination with
                            {
                                Arranged = true,
                                Frame = new(0, 0, 960, mode.EndsWith("half") ? 1040 : 520),
                            }
                            : destination with
                            {
                                Show = SW_SHOWMAXIMIZED,
                            };
                    if (mode == "same-half")
                        after = before with { Arranged = true, Frame = new(-1920, 0, 960, 1040) };
                    if (mode == "process")
                        after = after with { Process = 8 };
                    if (mode == "layout")
                        after = after with { DisplayLayout = "changed" };
                    if (mode == "unknown-monitor")
                        after = after with { Monitor = null };
                    router.Dispatch(
                        new MousePressEvent(
                            1,
                            11,
                            0,
                            start,
                            HTCAPTION,
                            default,
                            500,
                            mode == "injected" ? LLMHF_INJECTED : 0,
                            false,
                            true
                        )
                    );
                    router.Dispatch(new ObservedEvent(ObservedKind.MoveStart, 1, 11, 100));
                    router.Dispatch(
                        new StateObservedEvent(
                            1,
                            11,
                            150,
                            start,
                            before,
                            11,
                            "2026-11-15",
                            before.Monitor
                        )
                    );
                    Equal(0, output.Count);
                    Point point =
                        mode == "bad-max" ? new() { X = 900, Y = 80 }
                        : mode == "bad-quarter" ? new() { X = 80 }
                        : new() { X = mode == "same-half" ? -1920 : 0 };
                    if (mode != "no-release")
                        router.Dispatch(
                            new MouseReleaseEvent(
                                1,
                                200,
                                point,
                                mode == "release-monitor" ? before.Monitor : after.Monitor,
                                after.Work,
                                0,
                                null,
                                null
                            )
                        );
                    if (mode == "cancel")
                        tracker.ClearInput();
                    router.Dispatch(
                        new MoveEndEvent(
                            1,
                            11,
                            5000,
                            after,
                            mode == "foreground" ? 12 : 11,
                            "2026-11-15"
                        )
                    );
                    router.Dispatch(new MoveEndEvent(1, 11, 5001, after, 11, "2026-11-15"));
                    bool valid =
                        mode
                        is "max"
                            or "quarter"
                            or "bad-max"
                            or "bad-quarter"
                            or "cross-half"
                            or "max-max"
                            or "same-half";
                    Equal(valid ? 1 : 0, output.Count);
                    if (!valid)
                        return;
                    var envelope = (CandidateEnvelope)output.Single();
                    if (mode == "same-half")
                    {
                        Equal(true, envelope.evidence is PlacementEvidence);
                        return;
                    }
                    var proofs = ((IndependentResultsEvidence)envelope.evidence).results;
                    Equal(mode is "max" or "quarter" ? 2 : 1, proofs.Count);
                    Equal(true, proofs[0] is IndependentMonitorMoveProof);
                    lines.Add(JsonSerializer.Serialize(envelope));
                }
            );
        return lines;
    }
}
