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
        foreach (string mode in new[] { "deadline", "unknown", "old-event", "same", "extra-key", "no-neutral" }) {
            var reasons = new List<WindowDiagnosticReason>();
            SwitchCompletion? Run(bool diagnostics) {
                var p = new WindowSwitchPolicy(); if (diagnostics) p.Diagnostic = reasons.Add;
                p.Neutral(mode != "no-neutral"); p.Key(0xa4, true, false, a, 0);
                p.Key(9, true, false, null, 10); p.Key(9, false, false, null, 20);
                p.Key(9, true, false, null, 25); p.Key(9, false, false, null, 26);
                if (mode == "extra-key") p.Key(0x41, true, false, null, 27);
                var target = mode == "same" ? a : b;
                if (mode == "unknown") p.Foreground(99, 99, null, 30, 30);
                else p.NativeForeground(target.Handle, target.Handle, target, 10, mode == "old-event" ? 9u : 30u, 30);
                p.Key(0xa4, false, false, target, 40);
                return p.Poll(target, 3500);
            }
            // The long poll exercises failure reasons; the next loop covers actual completion.
            Check("diagnostic failure parity " + mode, Run(false) == Run(true));
            Check("diagnostic reason observed " + mode, reasons.Contains(WindowDiagnosticReason.W01AltDown));
            if (mode == "unknown") Check("unknown focus reason", reasons.Contains(WindowDiagnosticReason.W01ForegroundUnknown));
            if (mode == "old-event") Check("old native focus reason", reasons.Contains(WindowDiagnosticReason.W01NativeEventOld));
            if (mode == "no-neutral") Check("not ready reason", reasons.Contains(WindowDiagnosticReason.W01NotReady));
        }
        foreach (bool diagnostics in new[] { false, true }) {
            var reasons = new List<WindowDiagnosticReason>(); var p = Key(); if (diagnostics) p.Diagnostic = reasons.Add;
            Foreground(p, b); p.Key(0xa4, false, false, b, 40);
            Check("diagnostic completed switch unchanged " + diagnostics, p.Poll(b, 340)?.Target == b);
            Check("completion reason only opt-in " + diagnostics, reasons.Contains(WindowDiagnosticReason.W01Completed) == diagnostics);
        }
        var mouse = Mouse(); Foreground(mouse, b); mouse.Mouse(0x202, b, null, false, false, 40);
        var result = mouse.Poll(b, 100); Check("direct click", result?.Origin == "mouse" && result.Target == b);
        Check("once", mouse.Poll(b, 150) is null);
        int[] definedKeys = [1, 2, 4, 5, 6, 9, 13, 16, 17, 18, 27, 32, 0x41, 0x5b, 0x5c, 0xa4];
        var virtualKey = new WindowSwitchPolicy();
        virtualKey.Neutral(WindowSwitchPolicy.KeysReleased(definedKeys, k => k != 7));
        virtualKey.Mouse(0x201, b, a, false, false, 0); Foreground(virtualKey, b);
        virtualKey.Mouse(0x202, b, null, false, false, 40);
        Check("non-key virtual values cannot prevent a confirmed click", virtualKey.Poll(b, 100)?.Target == b);
        foreach (int pressed in definedKeys)
        {
            var held = new WindowSwitchPolicy();
            held.Neutral(WindowSwitchPolicy.KeysReleased(definedKeys, k => k != pressed));
            held.Mouse(0x201, b, a, false, false, 0); Foreground(held, b);
            held.Mouse(0x202, b, null, false, false, 40);
            Check("defined held key prevents adoption " + pressed, held.Poll(b, 100) is null);
        }
        var coarseClock = new WindowSwitchPolicy(); coarseClock.Neutral(true);
        coarseClock.Mouse(0x201, b, a, false, false, 1000);
        coarseClock.NativeForeground(12, 12, b, 0, 0, 1005);
        coarseClock.Mouse(0x202, b, null, false, false, 1010);
        Check("coarse native tick must not become a pre-input Stopwatch time", coarseClock.Poll(b, 1060)?.Target == b);
        foreach (var (inputTick, eventTick, accepted) in new[] { (100u, 99u, false), (0xfffffff0u, 5u, true) })
        {
            var p = Mouse(); p.NativeForeground(12, 12, b, inputTick, eventTick, 30);
            p.Mouse(0x202, b, null, false, false, 40);
            Check("native stamp stale/wrap " + accepted, (p.Poll(b, 100) is not null) == accepted);
        }
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
        foreach (bool previouslyConfirmed in new[] { false, true })
        {
            var p = Key(); if (previouslyConfirmed) Foreground(p, b, 25);
            Foreground(p, null, 30); Foreground(p, b, 35);
            p.Key(0xa4, false, false, b, 40);
            Check("unverified foreground while Alt held cannot revive B " + previouslyConfirmed, p.Poll(b, 340) is null);
        }
        var switcher = Key(); switcher.Foreground(99, 99, null, 30, 30, knownSwitcher: true);
        switcher.Key(0xa4, false, false, null, 40);
        switcher.Foreground(99, 99, null, 45, 45, knownSwitcher: true);
        Foreground(switcher, b, 50);
        Check("same verified Shell switcher can close after Alt release before final B", switcher.Poll(b, 340)?.Target == b);
        foreach (var (cls, pid, shell, expected) in new[] { ("XamlExplorerHostIslandWindow", 7u, 7u, true),
            ("MultitaskingViewFrame", 7u, 7u, true), ("XamlExplorerHostIslandWindow", 8u, 7u, false),
            ("other", 7u, 7u, false), ("XamlExplorerHostIslandWindow", 0u, 0u, false) })
            Check("verified Shell identity " + cls + pid, WindowSwitchPolicy.KnownSwitcherType(cls, pid, shell, true) == expected);
        foreach (var (handle, verified) in new[] { ((nint)99, false), ((nint)100, true) })
        {
            var p = Key(); p.Foreground(99, 99, null, 30, 30, true);
            p.Key(0xa4, false, false, null, 40); p.Foreground(handle, handle, null, 45, 45, verified);
            Foreground(p, b, 50);
            Check("unknown or different switcher cannot revive B " + handle, p.Poll(b, 340) is null);
        }
        var noFinal = Key(); noFinal.Foreground(99, 99, null, 30, 30, true);
        noFinal.Key(0xa4, false, false, null, 40); noFinal.Foreground(99, 99, null, 45, 45, true);
        Check("switcher alone cannot prove a final window", noFinal.Poll(b, 340) is null);
        var returnedUi = Key(); returnedUi.Foreground(99, 99, null, 30, 30, true);
        returnedUi.Key(0xa4, false, false, null, 40); Foreground(returnedUi, b, 45);
        returnedUi.Foreground(99, 99, null, 50, 50, true);
        Check("returning switcher invalidates old B confirmation", returnedUi.Poll(b, 340) is null);
        Foreground(returnedUi, b, 350);
        Check("fresh B callback after transient can settle", returnedUi.Poll(b, 400)?.Target == b);
        var staging = Key(); staging.Foreground(98, 98, null, 25, 25, knownStaging: true);
        staging.Foreground(99, 99, null, 30, 30, knownSwitcher: true);
        staging.Key(0xa4, false, false, null, 40);
        staging.Foreground(98, 98, null, 45, 45, knownStaging: true); Foreground(staging, b, 50);
        Check("observed staging can bridge a verified switcher close", staging.Poll(b, 340)?.Target == b);
        foreach (bool verified in new[] { false, true })
        {
            var p = Key(); p.Foreground(98, 98, null, 25, 25, knownStaging: verified);
            p.Key(0xa4, false, false, null, 40); p.Foreground(100, 100, null, 45, 45, knownStaging: verified); Foreground(p, b, 50);
            Check("only verified Shell staging can bridge release " + verified, (p.Poll(b, 340) is not null) == verified);
        }
        var oldB = Key(); oldB.Foreground(98, 98, null, 25, 25, knownStaging: true);
        oldB.Foreground(99, 99, null, 30, 30, knownSwitcher: true); oldB.Key(0xa4, false, false, null, 40);
        Foreground(oldB, b, 45); oldB.Foreground(98, 98, null, 50, 50, knownStaging: true);
        Check("staging transient clears previous B", oldB.Poll(b, 340) is null);
        Foreground(oldB, b, 350); Check("staging requires fresh final B callback", oldB.Poll(b, 400)?.Target == b);
        var manySurfaces = Key(); for (int i = 0; i < 5; i++) manySurfaces.Foreground(90 + i, 90 + i, null, 25 + i, 25 + i, true);
        Check("Shell surface set is bounded", !manySurfaces.Pending);
        Check("Shell staging identity", WindowSwitchPolicy.KnownStagingType("ForegroundStaging", 7, 7));
        Check("no fake staging identity", !WindowSwitchPolicy.KnownStagingType("other", 7, 7) &&
            !WindowSwitchPolicy.KnownStagingType("ForegroundStaging", 8, 7) && !WindowSwitchPolicy.KnownStagingType("ForegroundStaging", 0, 0));
        foreach (string cls in new[] { "XamlExplorerHostIslandWindow", "MultitaskingViewFrame" })
        {
            Check("invisible UI cannot prove switcher presence " + cls, !WindowSwitchPolicy.KnownSwitcherType(cls, 7, 7, false));
            Check("verified hidden Shell UI can bridge but cannot prove a switch " + cls,
                WindowSwitchPolicy.KnownHiddenSwitcherType(cls, 7, 7, false) &&
                !WindowSwitchPolicy.KnownHiddenSwitcherType(cls, 7, 7, true) &&
                !WindowSwitchPolicy.KnownHiddenSwitcherType(cls, 8, 7, false));
        }
        foreach (bool stagingSurface in new[] { false, true })
        {
            var p = Key(); p.Foreground(98, 98, null, 25, 25, knownStaging: true);
            p.Foreground(99, 99, null, 30, 30, knownSwitcher: true); p.Key(0xa4, false, false, null, 40);
            Foreground(p, b, 45);
            nint surface = stagingSurface ? 98 : 99;
            p.Foreground(surface, surface, null, 50, 50, !stagingSurface, stagingSurface);
            Foreground(p, c, 55);
            Check("Shell transient cannot replace committed B with C " + stagingSurface, p.Poll(c, 340) is null);
        }
        var stagingOnly = Key(); stagingOnly.Foreground(98, 98, null, 25, 25, knownStaging: true);
        stagingOnly.Key(0xa4, false, false, null, 40); stagingOnly.Foreground(98, 98, null, 45, 45, knownStaging: true);
        Check("staging alone is not a result", stagingOnly.Poll(b, 340) is null);
        Foreground(stagingOnly, b, 350);
        Check("AltTab plus matched final window does not require UI display evidence", stagingOnly.Poll(b, 400)?.Target == b);
        var recreated = Key(); recreated.Foreground(98, 98, null, 25, 25, knownStaging: true);
        recreated.Key(0xa4, false, false, null, 40);
        recreated.Foreground(100, 100, null, 45, 45, knownStaging: true); Foreground(recreated, b, 50);
        Check("Shell staging HWND recreation does not replace final-window identity", recreated.Poll(b, 340)?.Target == b);
        Check("Shell process must not change within transaction", WindowSwitchPolicy.ShellHostUnchanged(7, 7) &&
            !WindowSwitchPolicy.ShellHostUnchanged(7, 8) && !WindowSwitchPolicy.ShellHostUnchanged(0, 0));
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
        bool rejectedV1 = false;
        try { protocol.Start(3, 1); } catch (ArgumentException) { rejectedV1 = true; }
        Check("v1 start fails before emission", rejectedV1);
        Check("epoch stop and v1", emitted.Count == 2);
        return emitted;
    }
}
