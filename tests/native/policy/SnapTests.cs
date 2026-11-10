using static NativeMethods;

internal static class SnapTests
{
    internal static List<object> Run(List<string> passed)
    {
        void Check(string name, bool success)
        {
            if (!success)
                throw new Exception(name);
            passed.Add("W08 " + name);
        }
        bool Advance(SnapDwell dwell, long from, long to, nint target = 11)
        {
            bool result = false;
            for (long at = from; at < to; at += 50)
                result |= dwell.Step(target, at);
            return result | dwell.Step(target, to);
        }
        var dwell = new SnapDwell();
        Check("499ms does not count", !Advance(dwell, 0, 499));
        Check("500ms counts once", dwell.Step(11, 500));
        Check("continued dwell does not repeat", !Advance(dwell, 550, 2000));
        dwell.Step(0, 2050, true);
        Check("exit reentry counts", Advance(dwell, 2100, 2600));
        Check("changed target counts", Advance(dwell, 2650, 3150, 12));
        foreach (bool counted in new[] { false, true })
        {
            dwell.Reset();
            Advance(dwell, 0, counted ? 500 : 450);
            dwell.Step(0, 550); // failure, button, unknown setting: no confirmed exit
            Check(
                $"unknown resets pending, preserves latch {counted}",
                Advance(dwell, 600, 1100) == !counted
            );
            Check($"no duplicate after failure {counted}", !Advance(dwell, 1150, 1700));
        }
        dwell.Reset();
        Advance(dwell, 0, 450);
        Check("gap over 200 resets", !dwell.Step(11, 651));
        Check("new 500ms required after gap", !Advance(dwell, 701, 1150));
        Check("new threshold after gap", dwell.Step(11, 1151));
        Check("counted gap does not rearm", !Advance(dwell, 1500, 2000));
        dwell.Reset();
        Advance(dwell, 0, 300);
        Check("200ms gap allowed", dwell.Step(11, 500));
        dwell.Reset();
        Advance(dwell, 0, 450);
        Check(
            "final settings failure cannot latch an uncounted candidate",
            !dwell.Step(11, 500, verified: false)
        );
        Check("settings recovery starts fresh pending", !Advance(dwell, 550, 1049));
        Check("settings recovery can count after 500ms", dwell.Step(11, 1050));
        Check("resident identifies counted target", dwell.Resident == 11);
        dwell.Step(0, 1100, knownExit: true); // stable other root, even a fixed-size dialog
        Check("confirmed other root permits returning to same target", Advance(dwell, 1150, 1650));
        dwell.Reset();
        for (long at = 0; at <= 450; at += 50)
            dwell.Step(11, at, process: 7);
        Check(
            "reused HWND in another process discards old pending",
            !dwell.Step(11, 500, process: 8)
        );
        for (long at = 550; at < 1000; at += 50)
            dwell.Step(11, at, process: 8);
        Check("new process requires a fresh 500ms", dwell.Step(11, 1000, process: 8));
        dwell.Reset();
        Advance(dwell, 0, 500);
        Check("button-down outside never counts", !dwell.Sample(0, 550, true, true, true, true));
        for (long at = 600; at < 1100; at += 50)
            dwell.Sample(11, at, false, false, true, true);
        Check(
            "confirmed exit during button-down rearms return",
            dwell.Sample(11, 1100, false, false, true, true)
        );
        dwell.Sample(0, 1150, false, true, true, true);
        Check(
            "button on same region preserves counted latch",
            !dwell.Sample(11, 1200, false, false, true, true)
        );
        dwell.Sample(0, 1250, true, false, false, true);
        Check("injected exit does not rearm counted latch", !Advance(dwell, 1300, 1800));
        var keys = new SnapKeys();
        keys.Step(0x5b, true, false);
        Check("startup held keys rejected", !keys.Step(0x5a, true, false));
        foreach (uint win in new uint[] { 0x5b, 0x5c })
        {
            keys.ObserveNeutral(true);
            keys.Step(win, true, false);
            Check($"Win {win} first Z", keys.Step(0x5a, true, false));
            Check("repeat rejected", !keys.Step(0x5a, true, false));
            keys.Step(0x5a, false, false);
            Check("Z release rearms", keys.Step(0x5a, true, false));
        }
        foreach (
            uint modifier in new uint[] { 0x10, 0x11, 0x12, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5 }
        )
        {
            keys.ObserveNeutral(true);
            keys.Step(0x5b, true, false);
            keys.Step(modifier, true, false);
            Check($"extra modifier {modifier}", !keys.Step(0x5a, true, false));
        }
        keys.ObserveNeutral(true);
        keys.Step(0x5b, true, true);
        keys.Step(0x5b, true, false);
        keys.ObserveNeutral(false);
        Check("injection taints epoch", !keys.Step(0x5a, true, false));
        keys.ObserveNeutral(true);
        keys.Step(0x5b, true, false);
        Check("neutral recovers", keys.Step(0x5a, true, false));
        foreach (
            var (spi, arrangement, flyout, expected) in new (
                bool?,
                object?,
                object?,
                SnapSettings
            )[]
            {
                (true, "1", 1, new(true, true)),
                (true, "1", 0, new(true, false)),
                (false, "0", 1, new(false, false)),
                (true, "1", null, new(true, null)),
                (true, "1", "1", new(true, null)),
                (true, "1", 2, new(true, null)),
                (null, "1", 1, new(null, null)),
                (false, "1", 1, new(null, null)),
                (true, "0", 1, new(null, null)),
                (true, null, 1, new(null, null)),
                (true, 1, 1, new(null, null)),
                (true, "2", 1, new(null, null)),
            }
        )
            Check(
                $"settings {spi}/{arrangement}/{flyout}",
                SnapSettings.Resolve(spi, arrangement, flyout) == expected
            );
        Rect window = new() { Right = 300, Bottom = 300 },
            min =
                new()
                {
                    Left = 100,
                    Right = 140,
                    Bottom = 30,
                },
            max =
                new()
                {
                    Left = 140,
                    Right = 180,
                    Bottom = 30,
                },
            close =
                new()
                {
                    Left = 180,
                    Right = 220,
                    Bottom = 30,
                };
        Check(
            "rectangles take priority",
            SnapGeometry.Source(min, max, close, window) == "title-rect"
        );
        Check(
            "all empty fallback",
            SnapGeometry.Source(default, default, default, window) == "hit-fallback"
        );
        Check(
            "partial geometry rejected",
            SnapGeometry.Source(default, max, default, window) == null
        );
        Check("overlap rejected", SnapGeometry.Source(min, max, max, window) == null);
        Check(
            "out of range rejected",
            SnapGeometry.Source(
                min,
                max,
                new()
                {
                    Left = 180,
                    Right = 301,
                    Bottom = 30,
                },
                window
            ) == null
        );
        Check(
            "inverted rectangle not empty",
            SnapGeometry.Source(new() { Left = 1 }, default, default, window) == null
        );
        Check("max right edge is outside", !SnapGeometry.Contains(max, new() { X = 180, Y = 10 }));
        var samples = new List<object>();
        var protocol = new CandidateSink(samples.Add);
        var tracker = new CandidateTracker();
        tracker.Reset(1);
        protocol.Start(1, 2);
        foreach (string origin in new[] { "mouse", "key" })
            protocol.Invocation(
                1,
                tracker.NextTransaction(),
                origin,
                new(
                    true,
                    true,
                    true,
                    origin == "mouse" ? "title-rect" : null,
                    origin == "mouse" ? 500 : 0,
                    0,
                    new(0, 0, 1920, 1080)
                )
            );
        protocol.Invocation(2, 3, "key", new(true, true, true, null, 0, 0, null));
        protocol.Stop();
        protocol.Invocation(1, 4, "key", new(true, true, true, null, 0, 0, null));
        bool rejectedV1 = false;
        try
        {
            protocol.Start(1, 1);
        }
        catch (ArgumentException)
        {
            rejectedV1 = true;
        }
        Check("v1 start fails before emission", rejectedV1);
        Check("old generation, stopped, v1 suppressed", samples.Count == 2);
        Check("transaction allocator shared with legacy input", tracker.NextTransaction() == 3);
        return samples;
    }
}
