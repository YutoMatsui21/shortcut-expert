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
        return samples;
    }
}
