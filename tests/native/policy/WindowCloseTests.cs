using static NativeMethods;

internal static class WindowCloseTests
{
    internal static List<object> Run(List<string> passed)
    {
        var samples = new List<object>();
        var a = new CloseWindow(11, 7, 8, new(-1920, 0, 1920, 1080));
        var b = a with { Handle = 12 };
        void Check(string name, bool ok)
        {
            if (!ok)
                throw new Exception(name);
            passed.Add("close: " + name);
        }
        WindowClosePolicy Begin(bool mouse, uint tick = 100)
        {
            var p = new WindowClosePolicy();
            p.Neutral(true);
            if (mouse)
                p.Mouse(WM_LBUTTONDOWN, a, true, true, false, false, tick, 100);
            else
            {
                p.Key(VK_LMENU, true, false, a, tick - 1, 99);
                p.Key(VK_F4, true, false, a, tick, 100);
            }
            return p;
        }
        void Release(WindowClosePolicy p) =>
            p.Mouse(WM_LBUTTONUP, a, true, true, false, false, 150, 150);
        foreach (bool mouse in new[] { true, false })
        {
            var p = Begin(mouse);
            if (mouse)
                Release(p);
            Check("request alone emits nothing " + mouse, p.Target == a);
            Check(
                "other window destroy cannot complete " + mouse,
                p.Destroy(12, 8, 200, false, 200) is null && p.Target == a
            );
            var result = p.Destroy(11, 8, 200, false, 200);
            Check(
                "same target destroyed " + mouse,
                result is not null
                    && result.Origin == (mouse ? "mouse" : "key")
                    && result.Monitor == a.Monitor
            );
            Check("duplicate destroy " + mouse, p.Destroy(11, 8, 201, false, 201) is null);
            var messages = new List<object>();
            var protocol = new CandidateProtocol(messages.Add);
            protocol.Start(1, 2);
            protocol.Close(
                1,
                mouse ? 3000 : 3001,
                "2026-10-28",
                result!.Origin,
                new(true, true, result.Age, result.Monitor)
            );
            // Samples from independent protocols are joined after the earlier suites in TS.
            samples.Add(
                new
                {
                    candidate = ((CandidateEnvelope)messages.Single()) with
                    {
                        sequence = mouse ? 3000 : 3001,
                    },
                    expected = "W11",
                }
            );
            protocol.Stop();
            protocol.Close(
                1,
                2,
                "2026-10-28",
                result.Origin,
                new(true, true, result.Age, result.Monitor)
            );
            Check("stopped protocol cannot emit " + mouse, messages.Count == 1);
        }
        foreach (
            string reason in new[]
            {
                "unreleased",
                "cancel",
                "identity-change",
                "timeout",
                "negative-age",
                "stale-tick",
                "future-tick",
                "thread",
                "mixed-key",
                "injected",
                "release-outside",
                "release-other",
                "release-modifier",
                "release-injected",
                "restart",
                "program",
            }
        )
        {
            var p = Begin(true);
            if (reason != "unreleased")
                Release(p);
            switch (reason)
            {
                case "cancel":
                    p.Cancel();
                    break;
                case "identity-change":
                    p.Poll(false, 180);
                    break;
                case "timeout":
                    p.Poll(true, 1101);
                    break;
                case "mixed-key":
                    p.Key(0x41, true, false, a, 160, 160);
                    break;
                case "injected":
                    p.Key(VK_F4, true, true, a, 160, 160);
                    break;
                case "release-outside":
                    p.Mouse(WM_LBUTTONUP, a, false, true, false, false, 160, 160);
                    break;
                case "release-other":
                    p.Mouse(WM_LBUTTONUP, b, true, true, false, false, 160, 160);
                    break;
                case "release-modifier":
                    p.Mouse(WM_LBUTTONUP, a, true, true, false, true, 160, 160);
                    break;
                case "release-injected":
                    p.Mouse(WM_LBUTTONUP, a, true, true, true, false, 160, 160);
                    break;
                case "restart":
                case "program":
                    p = new();
                    p.Neutral(true);
                    break;
            }
            Check(
                reason,
                p.Destroy(
                    11,
                    reason == "thread" ? 9u : 8u,
                    reason == "stale-tick" ? 99u
                        : reason == "future-tick" ? 1101u
                        : 200u,
                    false,
                    reason == "negative-age" ? 99 : 200
                )
                    is null
            );
        }
        foreach (string reason in new[] { "repeat", "ctrl", "shift", "injected", "held-at-start" })
        {
            var p = reason == "held-at-start" ? new WindowClosePolicy() : Begin(false);
            if (reason == "repeat")
                p.Key(VK_F4, true, false, a, 1090, 1090);
            if (reason == "ctrl")
                p.Key(VK_CONTROL, true, false, a, 160, 160);
            if (reason == "shift")
                p.Key(VK_SHIFT, true, false, a, 160, 160);
            if (reason == "injected")
                p.Key(VK_F4, true, true, a, 160, 160);
            Check(
                "Alt+F4 " + reason,
                p.Destroy(
                    11,
                    8,
                    reason == "repeat" ? 1150u : 200u,
                    false,
                    reason == "repeat" ? 1150 : 200
                )
                    is null
            );
        }
        var wrapped = Begin(false, uint.MaxValue - 10);
        Check("native tick wrap", wrapped.Destroy(11, 8, 5, false, 120) is not null);
        var departure = Begin(false);
        departure.Foreground(12, false, true);
        Check(
            "close activates B while A exists before destroy",
            departure.Destroy(11, 8, 200, false, 200) is not null
        );
        foreach (string mode in new[] { "modal", "disabled", "recreated" })
        {
            var p = Begin(false);
            if (mode == "modal")
                p.Foreground(12, true, true);
            if (mode == "disabled")
                p.Foreground(12, false, false);
            if (mode == "recreated")
                p.Lifecycle(EVENT_OBJECT_CREATE, 11, 160);
            Check(
                mode + " cancellation is latched before destroy",
                p.Destroy(11, 8, 200, false, 200) is null
            );
        }
        foreach (bool mouse in new[] { true, false })
        {
            var p = Begin(mouse);
            if (mouse)
                Release(p);
            p.Lifecycle(EVENT_OBJECT_HIDE, 11, 160);
            p.Poll(true, 170); // Same hidden HWND/process/thread, before DESTROY.
            p.Foreground(12, false, true);
            Check(
                "observed normal close hide-before-destroy " + mouse,
                p.Destroy(11, 8, 180, false, 180) is not null
            );
        }
        var hideOnly = Begin(false);
        hideOnly.Lifecycle(EVENT_OBJECT_HIDE, 11, 160);
        hideOnly.Poll(true, 180);
        Check(
            "hide-only cannot complete without DESTROY",
            hideOnly.ConfirmGone(false, false, 190) is null
        );
        hideOnly.Poll(true, 1101);
        Check(
            "hide-only expires and cannot revive",
            hideOnly.Destroy(11, 8, 200, false, 1102) is null
        );
        var oldHide = Begin(false);
        oldHide.Lifecycle(EVENT_OBJECT_HIDE, 11, 99);
        Check(
            "stale hide cannot cancel new input",
            oldHide.Destroy(11, 8, 200, false, 200) is not null
        );
        var released = Begin(false);
        released.Key(VK_F4, false, false, a, 110, 110);
        released.Key(VK_LMENU, false, false, a, 120, 120);
        Check(
            "ordinary key releases preserve result",
            released.Destroy(11, 8, 200, false, 200) is not null
        );

        foreach (bool mouse in new[] { true, false })
        {
            var p = Begin(mouse);
            if (mouse)
                Release(p);
            p.Lifecycle(EVENT_OBJECT_HIDE, 11, 160);
            p.Foreground(12, false, true);
            Check(
                "DESTROY while HWND still exists waits " + mouse,
                p.Destroy(11, 8, 180, true, 180) is null && p.Target == a
            );
            Check("surviving HWND is not a close " + mouse, p.ConfirmGone(true, true, 190) is null);
            Check(
                "observed DESTROY plus eventual HWND disappearance " + mouse,
                p.ConfirmGone(false, false, 200) is not null
            );
            Check("confirmation emits once " + mouse, p.ConfirmGone(false, false, 210) is null);
        }
        foreach (string mode in new[] { "reuse", "create", "timeout", "stop", "no-destroy" })
        {
            var p = Begin(false);
            if (mode != "no-destroy")
                p.Destroy(11, 8, 180, true, 180);
            if (mode == "create")
                p.Lifecycle(EVENT_OBJECT_CREATE, 11, 190);
            if (mode == "stop")
                p = new();
            Check(
                "deferred confirmation rejects " + mode,
                p.ConfirmGone(mode == "reuse", false, mode == "timeout" ? 1101 : 200) is null
            );
            if (mode == "reuse")
                Check("reuse cancellation is latched", p.ConfirmGone(false, false, 210) is null);
        }

        var title = new TitleInfo { State = new uint[6], Bounds = new Rect[6] };
        var rect = new Rect { Right = 300, Bottom = 200 };
        var point = new Point { X = 280, Y = 10 };
        Check(
            "hit-test fallback cannot prove window close",
            !WindowCaption.CloseButton(title, rect, point)
        );
        Check(
            "explicit identity-verified root HTCLOSE replaces absent custom button geometry",
            WindowCaption.CloseButton(title, rect, point, rootCloseConfirmed: true)
        );
        foreach (int hit in new[] { 1, 0, -1, HTCAPTION, HTMAXBUTTON, HTMINBUTTON, 10, 12 })
            Check(
                "client/tab/resize/unknown cannot prove root close " + hit,
                !WindowCaption.VerifiedRootClose(hit, true, true, true)
            );
        foreach (string mismatch in new[] { "root", "process", "thread" })
            Check(
                "root close rejects changed " + mismatch,
                !WindowCaption.VerifiedRootClose(
                    HTCLOSE,
                    mismatch != "root",
                    mismatch != "process",
                    mismatch != "thread"
                )
            );
        Check(
            "matching root close proof",
            WindowCaption.VerifiedRootClose(HTCLOSE, true, true, true)
        );
        foreach (bool missingGeometry in new[] { false, true })
        {
            var custom = new TitleInfo { State = new uint[6], Bounds = new Rect[6] };
            if (!missingGeometry)
                custom.Bounds[3] = new Rect
                {
                    Left = 220,
                    Right = 250,
                    Bottom = 30,
                };
            foreach (bool proof in new[] { false, true })
            {
                bool button = WindowCaption.CloseButton(
                    custom,
                    rect,
                    point,
                    rootCloseConfirmed: proof
                );
                Check("custom geometry requires proof " + missingGeometry + proof, button == proof);
                var policy = new WindowClosePolicy();
                policy.Neutral(true);
                policy.Mouse(WM_LBUTTONDOWN, a, button, true, false, false, 100, 100);
                policy.Mouse(WM_LBUTTONUP, a, button, true, false, false, 150, 150);
                Check(
                    "custom close still requires same-target destroy " + missingGeometry + proof,
                    (policy.Destroy(11, 8, 200, false, 200) is not null) == proof
                );
            }
        }

        title.Bounds[3] = new Rect
        {
            Left = 220,
            Right = 250,
            Bottom = 30,
        };
        title.Bounds[5] = new Rect
        {
            Left = 250,
            Right = 300,
            Bottom = 30,
        };
        Check("verified close rectangle", WindowCaption.CloseButton(title, rect, point));
        Check(
            "tab close outside window close",
            !WindowCaption.CloseButton(title, rect, new Point { X = 200, Y = 50 })
        );
        Check(
            "valid geometry cannot be bypassed by root proof",
            !WindowCaption.CloseButton(
                title,
                rect,
                new Point { X = 200, Y = 50 },
                rootCloseConfirmed: true
            )
        );
        title.State[5] = 1;
        Check("disabled close", !WindowCaption.CloseButton(title, rect, point));
        Check(
            "valid geometry disabled state retains priority",
            !WindowCaption.CloseButton(title, rect, point, rootCloseConfirmed: true)
        );
        return samples;
    }
}
