using System.Text.Json;
using static NativeMethods;

internal static partial class Program
{
    private static void CheckProtocol()
    {
        AddLegacyProtocolSamples();
        CheckSinkGenerations();
        CheckSinkEmissionOrder();
        CheckTerminalDragEvidence();
        AddUnknownProtocolSamples();
    }

    private static void AddLegacyProtocolSamples()
    {
        foreach (var sample in samples)
        {
            var legacy = JsonSerializer.Deserialize<WindowCandidate>(
                JsonSerializer.Serialize(sample)
            )!;
            v2Samples.Add(CandidateProtocol.V2(legacy, legacy.sequence, legacy.sequence));
        }
    }

    private static void CheckSinkGenerations()
    {
        Check(
            "shared sink preserves mixed evidence, order and stopped generations",
            () =>
            {
                var delivered = new List<CandidateEnvelope>();
                var sink = new CandidateSink(value => delivered.Add((CandidateEnvelope)value));
                var evidence = new WindowCloseEvidence(true, true, 25, null);
                var draft = new CandidateDraft(
                    1,
                    7,
                    "2026-10-11",
                    "key",
                    "alt-f4",
                    false,
                    false,
                    evidence
                );
                sink.Start(1, 2);
                sink.Submit(draft with { Generation = 2 });
                sink.Submit(draft);
                sink.Switch(
                    1,
                    3,
                    "2026-10-11",
                    "mouse",
                    new WindowSwitchEvidence(true, true, true, true, 20, 50, null)
                );
                sink.Close(1, 8, "2026-10-11", "key", evidence);
                Equal(3, delivered.Count);
                Equal(1, delivered[0].sequence);
                Equal(7, delivered[0].transaction);
                Equal<Evidence>(evidence, delivered[0].evidence);
                Equal("direct-click", delivered[1].route);
                Equal(2, delivered[1].sequence);
                Equal(3, delivered[2].sequence);
                sink.Stop();
                sink.Submit(draft);
                sink.Close(1, 9, "2026-10-11", "key", evidence);
                sink.Start(2, 2);
                sink.Submit(draft);
                Equal(3, delivered.Count);
                sink.Submit(draft with { Generation = 2 });
                Equal(1, delivered[3].sequence);
                Equal(2, delivered[3].generation);
            }
        );
    }

    private static void CheckSinkEmissionOrder()
    {
        Check(
            "final emission order is independent from input transaction order",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker);
                var first = (WindowCandidate)
                    tracker.Complete(11, normal, maximized, 100, 11, "2026-10-11", null)!;
                Mouse(tracker, at: 200);
                var second = (WindowCandidate)
                    tracker.Complete(11, normal, maximized, 300, 11, "2026-10-11", null)!;
                var delivered = new List<CandidateEnvelope>();
                var emitter = new CandidateSink(value => delivered.Add((CandidateEnvelope)value));
                emitter.Start(1, 2);
                emitter.Complete(second);
                emitter.Complete(first);
                Equal(1, delivered[0].sequence);
                Equal(2, delivered[0].transaction);
                Equal(2, delivered[1].sequence);
                Equal(1, delivered[1].transaction);
                emitter.Stop();
                emitter.Complete(first);
                Equal(2, delivered.Count);
                emitter.Start(2, 2);
                emitter.Complete(first);
                Equal(2, delivered.Count);
                emitter.Complete(first with { generation = 2 });
                Equal(1, delivered[2].sequence);
            }
        );
    }

    private static void CheckTerminalDragEvidence()
    {
        Check(
            "v2 drag emits only its terminal evidence",
            () =>
            {
                var left = normal with
                {
                    Monitor = new(-1920, 0, 1920, 1080),
                    Work = new(-1920, 0, 1920, 1040),
                    Dpi = 96,
                    DisplayLayout = "stable",
                };
                var right = left with { Monitor = new(0, 0, 1920, 1080) };
                var tracker = Tracker();
                tracker.Mouse(11, left, HTCAPTION, default, 0, 500, 0, false, true);
                tracker.MoveStart(11, 100);
                Equal<object?>(
                    null,
                    tracker.Complete(11, left, maximized, 200, 11, "2026-10-11", null)
                );
                tracker.MouseReleased(new Point { X = 500, Y = 400 }, right.Monitor, right.Work, 0);
                var end = (WindowCandidate)tracker.FinishMove(11, right, 5000, 11, "2026-10-11")!;
                Equal(1, end.Transaction);
                Equal("monitor-move", end.operation);
            }
        );
    }

    private static void AddUnknownProtocolSamples()
    {
        foreach (
            Evidence evidence in new Evidence[]
            {
                new ShellDisplayEvidence("task-view", null, null, null),
                new ActivationEvidence(null, null, null, null, "unknown"),
                new GlobalEvidence("desktop", null, null),
            }
        )
            v2Samples.Add(
                new CandidateEnvelope(
                    "candidate",
                    2,
                    1,
                    1,
                    1,
                    "2026-10-11",
                    "unknown",
                    "unknown",
                    false,
                    false,
                    evidence
                )
            );
    }
}
