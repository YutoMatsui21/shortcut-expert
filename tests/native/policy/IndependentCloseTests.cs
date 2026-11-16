using static NativeMethods;

internal static partial class Program
{
    private static void IndependentCloseTests()
    {
        foreach (bool mouse in new[] { false, true })
        foreach (
            string mode in new[]
            {
                "valid",
                "deferred",
                "hide",
                "foreign",
                "modal",
                "reuse",
                "cancel",
                "stop",
                "reset",
                "lease",
                "injected",
                "timeout",
                "unreleased",
                "deferred-reuse",
                "deferred-stop",
                "deferred-timeout",
            }
        )
            Check(
                $"independent close {mouse}/{mode}",
                () =>
                {
                    var replay = new CloseReplayFixture(mouse, mode);
                    replay.Press();
                    replay.Interrupt();
                    replay.Destroy();
                    replay.Confirm();
                    replay.AssertOutput();
                }
            );
    }

    private sealed class CloseReplayFixture
    {
        private readonly bool mouse;
        private readonly string mode;
        private readonly DetectionSession session = new();
        private readonly GestureManager gestures = new();
        private readonly List<object> messages = new();
        private readonly CloseWindow target = new(11, 7, 8, new(0, 0, 1920, 1080));
        private readonly WindowCloseDetector detector;
        private long at = 100;
        private bool Accepted => mode is "valid" or "deferred" || !mouse && mode == "unreleased";

        internal CloseReplayFixture(bool mouse, string mode)
        {
            this.mouse = mouse;
            this.mode = mode;
            session.Start(1);
            var sink = new CandidateSink(messages.Add);
            sink.Start(1, 2);
            detector = new(session, gestures, sink, () => at, () => "2026-11-15");
            detector.Start(1);
            detector.Neutral(true);
        }

        internal void Press()
        {
            if (mouse)
            {
                detector.Mouse(WM_LBUTTONDOWN, target, true, true, false, false, 100, at);
                at = 150;
                if (mode != "unreleased")
                    detector.Mouse(WM_LBUTTONUP, target, true, true, false, false, 150, at);
            }
            else
            {
                detector.Key(VK_LMENU, true, false, target, 99, 99);
                detector.Key(VK_F4, true, false, target, 100, at);
            }
            Equal(true, gestures.IsCloseInput(160));
            Equal(false, gestures.IsCloseInput(1101));
            Equal(false, gestures.IsCloseInput(99));
            if (!mouse || mode != "unreleased")
                Equal(mouse ? 150L : 100L, gestures.Current!.ReleasedAt!.Value);
        }

        internal void Interrupt()
        {
            switch (mode)
            {
                case "cancel":
                    detector.Cancel();
                    break;
                case "stop":
                    detector.Stop();
                    break;
                case "reset":
                    detector.Start(1);
                    break;
                case "lease":
                    session.Stop();
                    session.Start(1);
                    break;
                case "modal":
                    detector.Foreground(12, true, true);
                    break;
                case "injected":
                    detector.Key(0x41, true, true, null, 170, 170);
                    break;
                case "reuse":
                    detector.Lifecycle(EVENT_OBJECT_CREATE, 11, 170);
                    break;
            }
            detector.Lifecycle(EVENT_OBJECT_HIDE, 11, 175);
            detector.Foreground(12, false, true);
        }

        internal void Destroy()
        {
            at = mode == "timeout" ? 1101 : 200;
            if (mode != "hide")
                detector.Destroy(
                    mode == "foreign" ? 12 : 11,
                    8,
                    200,
                    mode.StartsWith("deferred"),
                    at
                );
            Equal(mode == "valid" || !mouse && mode == "unreleased" ? 1 : 0, messages.Count);
        }

        internal void Confirm()
        {
            if (!mode.StartsWith("deferred"))
                return;
            if (mode == "deferred-stop")
                detector.Stop();
            at = mode == "deferred-timeout" ? 1101 : 210;
            detector.Poll(mode == "deferred-reuse", false, at);
        }

        internal void AssertOutput()
        {
            Equal(Accepted ? 1 : 0, messages.Count);
            if (Accepted)
                AssertProof();
            at = Accepted ? 220 : 1101;
            detector.Poll(true, true, at);
            detector.Destroy(11, 8, 220, false, at);
            Equal(Accepted ? 1 : 0, messages.Count);
        }

        private void AssertProof()
        {
            Equal(true, gestures.IsCloseInput(220));
            var envelope = (CandidateEnvelope)messages.Single();
            Equal("independent-results", envelope.route);
            var proof = ((IndependentResultsEvidence)envelope.evidence).results.Single();
            Equal(true, proof is IndependentCloseProof { destroyed: true });
            independentMouseSamples.Add(
                new
                {
                    line = System.Text.Json.JsonSerializer.Serialize(envelope),
                    expected = new[] { "W11" },
                    origin = mouse ? "mouse" : "key",
                }
            );
            detector.Mouse(
                WM_LBUTTONDOWN,
                target with
                {
                    Handle = 12,
                },
                false,
                false,
                false,
                false,
                220,
                220
            );
            Equal(false, gestures.IsCloseInput(220));
        }
    }
}
