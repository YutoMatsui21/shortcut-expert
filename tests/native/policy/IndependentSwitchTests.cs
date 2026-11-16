using System.Text.Json;
using static NativeMethods;

internal static partial class Program
{
    private static void IndependentSwitchTests()
    {
        foreach (bool key in new[] { false, true })
        foreach (
            string mode in new[]
            {
                "valid",
                "cancel",
                "stop",
                "reset",
                "foreign",
                "old-event",
                "expired",
                "injected",
                "same",
                "no-release",
                "unattributed",
                "unknown-source",
                "target-process",
            }
        )
            Check($"independent switch {key}/{mode}", () => ReplayIndependentSwitch(key, mode));
    }

    private static void ReplayIndependentSwitch(bool key, string mode)
    {
        var replay = new SwitchReplayFixture(key, mode);
        replay.Press();
        replay.Foreground();
        replay.Release();
        replay.Interrupt();
        replay.Poll();
        replay.AssertOutput();
    }

    private sealed class SwitchReplayFixture
    {
        private readonly bool key;
        private readonly string mode;
        private readonly SwitchWindow source = new(11, 7);
        private readonly SwitchWindow target;
        private readonly List<object> output = new();
        private readonly DetectionSession session = new();
        private readonly WindowSwitchDetector detector;

        internal SwitchReplayFixture(bool key, string mode)
        {
            this.key = key;
            this.mode = mode;
            target = mode == "same" ? source : new(12, 8);
            session.Start(1);
            var sink = new CandidateSink(output.Add);
            sink.Start(1, 2);
            var router = new DetectionRouter();
            router.Reset(1);
            detector = new(
                session,
                sink,
                router,
                session.Allocator(1),
                new(Date: () => "2026-11-15")
            );
            detector.Start(1);
            detector.Dispatch(new SwitchNeutralEvent(1, 0, true));
        }

        internal void Press()
        {
            if (mode == "unattributed")
                return;
            if (mode == "unknown-source")
            {
                detector.Dispatch(
                    new SwitchMouseEvent(1, 0, WM_LBUTTONDOWN, null, source, false, false)
                );
                return;
            }
            if (key)
                PressAltTab();
            else
                detector.Dispatch(
                    new SwitchMouseEvent(
                        1,
                        0,
                        WM_LBUTTONDOWN,
                        target,
                        source,
                        mode == "injected",
                        false
                    )
                );
        }

        private void PressAltTab()
        {
            detector.Dispatch(new SwitchKeyEvent(1, 0, 0xa4, true, mode == "injected", source));
            detector.Dispatch(new SwitchKeyEvent(1, 10, 9, true, false, null));
            detector.Dispatch(new SwitchKeyEvent(1, 20, 9, false, false, null));
        }

        internal void Foreground() =>
            detector.Dispatch(
                new SwitchForegroundEvent(
                    1,
                    30,
                    target.Handle,
                    target.Handle,
                    target,
                    10,
                    mode == "old-event" ? 9u : 30u
                )
            );

        internal void Release()
        {
            if (mode == "no-release")
                return;
            if (key)
                detector.Dispatch(new SwitchKeyEvent(1, 40, 0xa4, false, false, target));
            else
                detector.Dispatch(
                    new SwitchMouseEvent(1, 40, WM_LBUTTONUP, target, null, false, false)
                );
        }

        internal void Interrupt()
        {
            switch (mode)
            {
                case "foreign":
                    detector.Dispatch(new SwitchForegroundEvent(1, 45, 13, 13, new(13, 9), 10, 45));
                    break;
                case "cancel":
                    detector.Cancel();
                    break;
                case "stop":
                    session.Stop();
                    break;
                case "reset":
                    session.Start(1); // Same generation invalidates the physical input lease.
                    break;
            }
        }

        internal void Poll()
        {
            var current = mode == "target-process" ? target with { Process = 9 } : target;
            long at = mode == "expired" ? 16000 : 400;
            detector.Dispatch(new SwitchPollEvent(1, at, current, new(0, 0, 1920, 1080)));
            detector.Dispatch(new SwitchPollEvent(1, at + 1, current, null));
        }

        internal void AssertOutput()
        {
            bool valid = mode == "valid";
            Equal(valid ? 1 : 0, output.Count);
            if (!valid)
                return;
            var envelope = (CandidateEnvelope)output.Single();
            Equal(key ? "key" : "mouse", envelope.origin);
            Equal(1, envelope.transaction);
            var proof = ((IndependentResultsEvidence)envelope.evidence).results.Single();
            Equal(true, proof is IndependentSwitchProof);
            independentMouseSamples.Add(
                new
                {
                    line = JsonSerializer.Serialize(envelope),
                    expected = new[] { "W01" },
                    origin = key ? "key" : "mouse",
                }
            );
        }
    }
}
