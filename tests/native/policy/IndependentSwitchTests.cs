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
        var a = new SwitchWindow(11, 7);
        var b = mode == "same" ? a : new SwitchWindow(12, 8);
        var output = new List<object>();
        var session = new DetectionSession();
        session.Start(1);
        var sink = new CandidateSink(output.Add);
        sink.Start(1, 2);
        var router = new DetectionRouter();
        router.Reset(1);
        var detector = new WindowSwitchDetector(
            session,
            sink,
            router,
            session.Allocator(1),
            date: () => "2026-11-15"
        );
        detector.Start(1);
        detector.Dispatch(new SwitchNeutralEvent(1, 0, true));
        if (mode is not ("unattributed" or "unknown-source"))
        {
            if (key)
            {
                detector.Dispatch(new SwitchKeyEvent(1, 0, 0xa4, true, mode == "injected", a));
                detector.Dispatch(new SwitchKeyEvent(1, 10, 9, true, false, null));
                detector.Dispatch(new SwitchKeyEvent(1, 20, 9, false, false, null));
            }
            else
                detector.Dispatch(
                    new SwitchMouseEvent(1, 0, WM_LBUTTONDOWN, b, a, mode == "injected", false)
                );
        }
        if (mode == "unknown-source")
            detector.Dispatch(new SwitchMouseEvent(1, 0, WM_LBUTTONDOWN, null, a, false, false));
        detector.Dispatch(
            new SwitchForegroundEvent(
                1,
                30,
                b.Handle,
                b.Handle,
                b,
                10,
                mode == "old-event" ? 9u : 30u
            )
        );
        if (mode != "no-release")
        {
            if (key)
                detector.Dispatch(new SwitchKeyEvent(1, 40, 0xa4, false, false, b));
            else
                detector.Dispatch(new SwitchMouseEvent(1, 40, WM_LBUTTONUP, b, null, false, false));
        }
        if (mode == "foreign")
            detector.Dispatch(new SwitchForegroundEvent(1, 45, 13, 13, new(13, 9), 10, 45));
        if (mode == "cancel")
            detector.Cancel();
        if (mode == "stop")
            session.Stop();
        if (mode == "reset")
            session.Start(1); // Same generation still invalidates an earlier input lease.
        var current = mode == "target-process" ? b with { Process = 9 } : b;
        long at = mode == "expired" ? 16000 : 400;
        detector.Dispatch(new SwitchPollEvent(1, at, current, new(0, 0, 1920, 1080)));
        detector.Dispatch(new SwitchPollEvent(1, at + 1, current, null));
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
