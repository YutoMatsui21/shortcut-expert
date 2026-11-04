using static NativeMethods;

internal static class InactiveCaptionTests
{
    internal static List<object> Run(List<string> passed)
    {
        var samples = new List<object>();
        var state = new WindowState(
            7,
            "ordinary-window",
            SW_SHOWNORMAL,
            false,
            new(0, 0, 1920, 1080)
        );
        void Check(string name, bool ok)
        {
            if (!ok)
                throw new Exception("caption: " + name);
            passed.Add("caption: " + name);
        }
        foreach (bool maximize in new[] { false, true })
        foreach (bool maximizedStart in new[] { false, true })
        foreach (
            string mode in new[]
            {
                "normal",
                "post-release-move",
                "late-release",
                "state-before-release",
                "no-foreground",
                "no-state",
                "no-release",
                "injected",
                "move",
                "key",
                "wrong-process",
                "wrong-release",
                "old-event",
                "foreign-window",
                "expired",
                "stopped",
            }
        )
        {
            var p = new InactiveCaptionPolicy();
            var before = state with { Show = maximizedStart ? SW_SHOWMAXIMIZED : SW_SHOWNORMAL };
            bool started = p.Start(
                11,
                before,
                maximize ? HTMAXBUTTON : HTMINBUTTON,
                new(),
                0,
                100,
                1,
                true,
                true,
                false
            );
            string name = $"{maximize}/{maximizedStart}/{mode}";
            if (maximize && maximizedStart)
            {
                Check("restore excluded " + name, !started);
                continue;
            }
            Check("started " + name, started);
            if (mode != "no-foreground")
                p.Foreground(11, 11, mode == "old-event" ? 99u : 101u);
            var after = before with { Show = maximize ? SW_SHOWMAXIMIZED : SW_SHOWMINIMIZED };
            if (mode == "wrong-process")
                after = after with { Process = 8 };
            if (mode == "state-before-release")
                p.State(after, 90);
            if (mode == "move")
                p.Mouse(0x200, new() { X = 5 }, 0, false, 11, 7, 95);
            if (mode != "no-release")
                p.Mouse(
                    WM_LBUTTONUP,
                    new(),
                    mode == "injected" ? 1u : 0u,
                    false,
                    mode == "wrong-release" ? 12 : 11,
                    7,
                    mode == "late-release" ? 600 : 100
                );
            if (mode == "post-release-move")
                p.Mouse(0x200, new() { X = 5 }, 0, false, 11, 7, 160);
            if (mode == "key" || mode == "stopped")
                p.Cancel();
            if (mode != "no-state")
                p.State(after, 150);
            if (mode == "foreign-window")
                p.Foreground(12, 12, 160);
            else if (!maximize && mode != "no-state")
                p.Foreground(12, 12, 160);
            var result = p.Poll(mode == "no-state" ? before : after, mode == "expired" ? 751 : 510);
            bool good =
                mode
                    is "normal"
                        or "post-release-move"
                        or "state-before-release"
                        or "no-foreground"
                        or "old-event"
                        or "no-state"
                || mode == "foreign-window" && !maximize;
            Check("result " + name, (result is not null) == good);
            if (result is { } completed)
            {
                Check("single result " + name, p.Poll(after, 520) is null);
                Check(
                    "terminal " + name,
                    completed.Evidence.terminal
                        == (
                            mode == "no-state" ? null
                            : maximize ? "maximized"
                            : "minimized"
                        )
                );
                Check(
                    "switch " + name,
                    completed.Evidence.switched == (mode is not ("no-foreground" or "old-event"))
                );
                if (mode == "normal")
                {
                    var wire = new CandidateProtocol(samples.Add);
                    wire.Start(1, 2);
                    wire.CaptionClick(1, completed.Transaction, "2026-11-04", completed.Evidence);
                    wire.Stop();
                    wire.CaptionClick(1, 2, "2026-11-04", completed.Evidence);
                }
            }
        }
        foreach (
            string mode in new[] { "active", "injected", "modifier", "unknown-button", "minimized" }
        )
        {
            var p = new InactiveCaptionPolicy();
            Check(
                "reject " + mode,
                !p.Start(
                    11,
                    mode == "minimized" ? state with { Show = SW_SHOWMINIMIZED } : state,
                    mode == "unknown-button" ? HTCAPTION : HTMINBUTTON,
                    new(),
                    0,
                    100,
                    1,
                    mode != "active",
                    mode != "injected",
                    mode == "modifier"
                )
            );
        }
        foreach (uint initial in new[] { SW_SHOWNORMAL, SW_SHOWMAXIMIZED })
        foreach (
            string mode in new[]
            {
                "maximize",
                "minimize",
                "body",
                "restore",
                "no-activation",
                "drag",
                "injected",
                "wrong-release",
                "late-release",
            }
        )
        {
            var p = new InactiveCaptionPolicy();
            var before = state with { Show = initial };
            Check(
                "unidentified physical click starts " + mode,
                p.Start(11, before, 1, new(), 0, 100, 9, true, true, false)
            );
            if (mode != "no-activation")
                p.Foreground(11, 11, 110);
            var after = before with
            {
                Show =
                    mode is "minimize" or "no-activation" ? SW_SHOWMINIMIZED
                    : mode == "maximize" ? SW_SHOWMAXIMIZED
                    : SW_SHOWNORMAL,
            };
            if (mode == "body")
                after = before;
            if (mode == "drag")
                p.Cancel(); // MOVESIZESTART transfers ownership to the existing tracker.
            p.Mouse(
                WM_LBUTTONUP,
                new(),
                mode == "injected" ? 1u : 0u,
                false,
                mode == "wrong-release" ? 12 : 11,
                7,
                mode == "late-release" ? 501 : 100
            );
            p.State(after, 150);
            if (after.Show == SW_SHOWMINIMIZED)
                p.Foreground(12, 12, 160);
            var result = p.Poll(after, 510);
            bool good = mode is "maximize" or "minimize" or "body" or "restore";
            Check("fallback result " + initial + "/" + mode, (result is not null) == good);
            if (result is { } completed)
            {
                string? terminal =
                    mode == "minimize" ? "minimized"
                    : mode == "maximize" && initial == SW_SHOWNORMAL ? "maximized"
                    : null;
                Check("fallback terminal " + mode, completed.Evidence.terminal == terminal);
                Check("fallback switch " + mode, completed.Evidence.switched);
                if (terminal is not null)
                {
                    var wire = new CandidateProtocol(samples.Add);
                    wire.Start(1, 2);
                    wire.CaptionClick(1, completed.Transaction, "2026-11-04", completed.Evidence);
                }
            }
        }
        var fg = new SwitchWindow(12, 8);
        var dragTracker = new CandidateTracker();
        dragTracker.Reset(1);
        dragTracker.Mouse(11, state, 1, new(), 0, 500, 0, false, false);
        var dragClick = new InactiveCaptionPolicy();
        Check(
            "fallback retains shadow drag tracking",
            dragClick.Start(11, state, 1, new(), 0, 100, 9, true, true, false) && dragClick.Fallback
        );
        dragTracker.ForegroundChanged(11);
        dragClick.Cancel(); // Same ownership handoff as Observer's MOVESIZESTART.
        dragTracker.CancelMouseState(); // Cancel shadow click evidence without losing the drag press.
        dragTracker.MoveStart(11, 30);
        Check("custom surface drag keeps its candidate", dragTracker.HasDrag && !dragClick.Pending);
        var target = new SwitchWindow(11, 7);
        Check(
            "captionless click eligible",
            InactiveCaptionPolicy.EligiblePress(true, fg, target, 7)
        );
        Check(
            "same window rejected",
            !InactiveCaptionPolicy.EligiblePress(true, target, target, 7)
        );
        Check(
            "unknown foreground rejected",
            !InactiveCaptionPolicy.EligiblePress(true, null, target, 7)
        );
        Check(
            "process mismatch rejected",
            !InactiveCaptionPolicy.EligiblePress(true, fg, target, 9)
        );
        Check("nonneutral rejected", !InactiveCaptionPolicy.EligiblePress(false, fg, target, 7));
        var switching = new WindowSwitchPolicy();
        Check("initial not ready", !switching.CanStartMouse);
        switching.Neutral(true);
        Check("neutral ready", switching.CanStartMouse);
        switching.Mouse(WM_LBUTTONDOWN, target, fg, false, false, 0);
        Check("pending press not reusable", !switching.CanStartMouse);
        switching.Cancel();
        Check("cancel needs neutral", !switching.CanStartMouse);
        Check(
            "ordinary W01 still requires caption",
            !WindowSwitchPolicy.AllowsStyle(0x10000000, 0, false)
        );
        Check(
            "compound accepts no caption",
            WindowSwitchPolicy.AllowsStyle(0x10000000, 0, false, false)
        );
        foreach (
            var styles in new (long? Style, long? Extended, bool? Cloaked)[]
            {
                (null, 0, false),
                (0x10000000, null, false),
                (0x50000000, 0, false),
                (0x10000000, 0x80, false),
                (0x10000000, 0x08000000, false),
                (0x10000000, 0, true),
                (0x10000000, 0, null),
            }
        )
            Check(
                "compound retains style safety",
                !WindowSwitchPolicy.AllowsStyle(
                    styles.Style,
                    styles.Extended,
                    styles.Cloaked,
                    false
                )
            );
        return samples;
    }
}
