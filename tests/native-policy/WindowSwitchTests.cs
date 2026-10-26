internal static class WindowSwitchTests
{
    internal static List<object> Run(List<string> passed)
    {
        var a = new SwitchWindow(11, 7); var b = new SwitchWindow(12, 8); var c = new SwitchWindow(13, 9);
        void Check(string name, bool ok) { if (!ok) throw new Exception("switch: " + name); passed.Add("switch: " + name); }
        WindowSwitchPolicy Mouse(bool neutral = true)
        {
            var p = new WindowSwitchPolicy(); p.Neutral(neutral); p.Mouse(0x201, b, a, false, false, 0); return p;
        }
        WindowSwitchPolicy Key()
        {
            var p = new WindowSwitchPolicy(); p.Neutral(true); p.Key(0xa4, true, false, a, 0);
            p.Key(9, true, false, null, 10); p.Key(9, false, false, null, 20); return p;
        }
        void Foreground(WindowSwitchPolicy p, SwitchWindow? w, long at = 30) => p.Foreground(w?.Handle ?? 99, w?.Handle ?? 99, w, at, at);
        var mouse = Mouse(); Foreground(mouse, b); mouse.Mouse(0x202, b, null, false, false, 40);
        var result = mouse.Poll(b, 100); Check("direct click", result?.Origin == "mouse" && result.Target == b);
        Check("once", mouse.Poll(b, 150) is null);
        foreach (string fault in new[] { "no-neutral", "no-event", "stale-event", "old-event", "different-final", "reused-pid", "different-up", "late", "no-up", "injected", "modifier", "right", "xbutton", "wheel", "key", "competing", "stop" })
        {
            var p = Mouse(fault != "no-neutral");
            if (fault == "stale-event") p.Foreground(12, 13, c, 30, 30);
            else if (fault == "old-event") p.Foreground(12, 12, b, -1, 30);
            else if (fault != "no-event") Foreground(p, b);
            if (fault != "no-up") p.Mouse(0x202, fault == "different-up" ? c : b, null, false, false, 40);
            if (fault is "injected" or "modifier" or "right" or "xbutton" or "wheel")
                p.Mouse(fault == "right" ? 0x204 : fault == "xbutton" ? 0x20b : 0x20a, b, a, fault == "injected", fault == "modifier", 45);
            if (fault == "key") p.Key(0x41, true, false, null, 45);
            if (fault == "competing") Foreground(p, c, 45);
            if (fault == "stop") p.Cancel();
            Check(fault, p.Poll(fault == "different-final" ? c : fault == "reused-pid" ? b with { Process = 10 } : b, fault == "late" ? 1501 : 100) is null);
        }
        foreach (var hit in new SwitchWindow?[] { null, a })
        {
            var p = new WindowSwitchPolicy(); p.Neutral(true); p.Mouse(0x201, hit, a, false, false, 0);
            Foreground(p, b); p.Mouse(0x202, hit, null, false, false, 40);
            Check("same window or W12/unknown root", p.Poll(b, 100) is null);
        }
        var multi = Key(); multi.Key(9, true, false, null, 25); multi.Key(9, true, false, null, 26);
        multi.Key(9, false, false, null, 27); Foreground(multi, c);
        multi.Key(0xa4, false, false, c, 40); Check("settle waits", multi.Poll(c, 339) is null);
        var keyResult = multi.Poll(c, 340); Check("multiple Tab/repeat final only", keyResult?.Origin == "key" && keyResult.Target == c);
        foreach (string fault in new[] { "esc", "same", "mouse", "extra-key", "shift", "win-digit", "alt-again", "injected", "no-event", "stale", "late", "held-too-long", "unverified-target", "edge-tabs", "changed-after-release" })
        {
            var p = Key();
            if (fault == "stale") p.Foreground(99, 12, b, 30, 30);
            else if (fault != "no-event") Foreground(p, fault == "same" ? a : b);
            p.Key(0xa4, false, false, fault == "same" ? a : b, 40);
            if (fault is "esc" or "extra-key" or "shift" or "win-digit" or "alt-again" or "injected")
                p.Key(fault == "esc" ? 27u : fault == "shift" ? 0xa0u : fault == "win-digit" ? 0x5bu : fault == "alt-again" ? 0xa4u : 0x41u, true, fault == "injected", b, 50);
            if (fault == "mouse") p.Mouse(0x201, b, a, false, false, 50);
            if (fault == "changed-after-release") Foreground(p, c, 50);
            Check("key " + fault, p.Poll(fault == "same" ? a : fault == "unverified-target" ? null : fault == "edge-tabs" ? b with { KeyEligible = false } : b,
                fault == "late" ? 2041 : fault == "held-too-long" ? 15001 : 340) is null);
        }
        var delayed = Key(); delayed.Key(0xa4, false, false, null, 40);
        Foreground(delayed, b, 45); delayed.Foreground(99, 12, null, 20, 46);
        Check("post-release result and delayed Shell callback", delayed.Poll(b, 340)?.Target == b);
        var unknownCompetition = Key(); Foreground(unknownCompetition, b);
        unknownCompetition.Key(0xa4, false, false, b, 40);
        Foreground(unknownCompetition, null, 45); Foreground(unknownCompetition, b, 50);
        Check("post-release unknown window cannot return and revive B", unknownCompetition.Poll(b, 340) is null);
        var program = new WindowSwitchPolicy(); program.Neutral(true); Foreground(program, b);
        Check("program foreground alone", program.Poll(b, 340) is null);
        var taskbar = new WindowSwitchPolicy(); taskbar.Neutral(true); taskbar.Key(0x5b, true, false, a, 0);
        taskbar.Key(0x31, true, false, a, 10); Foreground(taskbar, b);
        Check("Win digit never W01", taskbar.Poll(b, 340) is null);
        var emitted = new List<object>(); var protocol = new CandidateProtocol(emitted.Add); protocol.Start(1, 2);
        foreach (var sample in new[] { result!, keyResult! })
            protocol.Switch(1, emitted.Count + 1, "2026-10-21", sample.Origin, new(true, true, true, true, sample.InputAgeMs, sample.SettleMs, new(0, 0, 1920, 1080)));
        protocol.Stop(); protocol.Switch(1, 3, "2026-10-21", "mouse", new(true, true, true, true, 100, 50, null));
        protocol.Start(2, 2); protocol.Switch(1, 4, "2026-10-21", "mouse", new(true, true, true, true, 100, 50, null));
        protocol.Start(3, 1); protocol.Switch(3, 5, "2026-10-21", "mouse", new(true, true, true, true, 100, 50, null));
        Check("epoch stop and v1", emitted.Count == 2);
        return emitted;
    }
}
