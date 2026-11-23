using System.Text.Json;
using static NativeMethods;

internal static partial class Program
{
    private static void CheckMaximizeSources()
    {
        Check(
            "max button + same target + result",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker);
                var result = Complete(tracker);
                Equal("mouse", result.GetProperty("origin").GetString());
                Equal("max-button", result.GetProperty("route").GetString());
                Equal(true, result.GetProperty("targetMatched").GetBoolean());
                Equal(1, result.GetProperty("sequence").GetInt32());
                samples.Add(result);
            }
        );
        Check(
            "Win+Up + result",
            () =>
            {
                var tracker = Tracker();
                tracker.Key(11, normal, VK_UP, true, false, 0, 0);
                var result = Complete(tracker);
                Equal("key", result.GetProperty("origin").GetString());
                Equal("win-up", result.GetProperty("route").GetString());
                samples.Add(result);
            }
        );
    }

    private static void CheckMouseInputAge()
    {
        foreach (
            var (at, origin) in new[]
            {
                (999L, "mouse"),
                (1000L, "mouse"),
                (1001L, "unknown"),
                (-1L, "unknown"),
            }
        )
            Check(
                $"input age {at}",
                () =>
                {
                    var tracker = Tracker();
                    Mouse(tracker);
                    Equal(origin, Complete(tracker, at).GetProperty("origin").GetString());
                }
            );
    }

    private static void CheckInjectedInput()
    {
        foreach (uint flags in new[] { LLMHF_INJECTED, LLMHF_LOWER_IL_INJECTED })
            Check(
                $"mouse injection flag {flags}",
                () =>
                {
                    var tracker = Tracker();
                    Mouse(tracker, flags: flags);
                    var result = Complete(tracker);
                    Equal(true, result.GetProperty("injected").GetBoolean());
                    samples.Add(result);
                }
            );
        foreach (uint flags in new[] { LLKHF_INJECTED, LLKHF_LOWER_IL_INJECTED })
            Check(
                $"key injection flag {flags}",
                () =>
                {
                    var tracker = Tracker();
                    tracker.Key(11, normal, VK_UP, true, false, 0, flags);
                    Equal(true, Complete(tracker).GetProperty("injected").GetBoolean());
                }
            );
    }

    private static void CheckInputConflicts()
    {
        foreach (
            uint modifier in new uint[]
            {
                VK_LWIN,
                VK_RWIN,
                VK_LSHIFT,
                VK_RSHIFT,
                VK_LCONTROL,
                VK_RCONTROL,
                VK_LMENU,
                VK_RMENU,
            }
        )
            Check(
                $"modifier conflict {modifier}",
                () =>
                {
                    var tracker = Tracker();
                    Mouse(tracker);
                    tracker.Key(11, null, modifier, false, false, 1, 0);
                    Equal(true, Complete(tracker).GetProperty("conflicted").GetBoolean());
                }
            );
        Check(
            "mouse then key conflict",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker);
                tracker.Key(11, normal, VK_UP, true, false, 1, 0);
                Equal(true, Complete(tracker).GetProperty("conflicted").GetBoolean());
            }
        );
    }

    private static void CheckUnknownMouseOrigin()
    {
        Check(
            "program change has unknown origin",
            () =>
            {
                var tracker = Tracker();
                Equal("unknown", Complete(tracker).GetProperty("origin").GetString());
            }
        );
        Check(
            "unknown hit test waits for release",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker, hit: -1);
                Equal(JsonValueKind.Null, Complete(tracker).ValueKind);
            }
        );
    }

    private static void CheckCaptionDoubleClick()
    {
        Check(
            "caption double click",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker, HTCAPTION);
                Mouse(tracker, HTCAPTION, 500);
                Equal(
                    "caption-double-click",
                    Complete(tracker, 501).GetProperty("route").GetString()
                );
            }
        );
        Check(
            "caption double click expires",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker, HTCAPTION);
                Mouse(tracker, HTCAPTION, 501);
                Equal("unknown", Complete(tracker, 502).GetProperty("route").GetString());
            }
        );
        Check(
            "caption distant click",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker, HTCAPTION);
                tracker.Mouse(
                    11,
                    normal,
                    HTCAPTION,
                    new Point { X = -95, Y = 20 },
                    1,
                    500,
                    0,
                    false,
                    true
                );
                Equal("unknown", Complete(tracker).GetProperty("route").GetString());
            }
        );
    }

    private static void CheckUnmatchedKeys()
    {
        Check(
            "key without Win",
            () =>
            {
                var tracker = Tracker();
                tracker.Key(11, normal, VK_UP, false, false, 0, 0);
                Equal("unknown", Complete(tracker).GetProperty("origin").GetString());
            }
        );
        Check(
            "key with extra modifiers",
            () =>
            {
                var tracker = Tracker();
                tracker.Key(11, normal, VK_UP, true, true, 0, 0);
                Equal("unknown", Complete(tracker).GetProperty("origin").GetString());
            }
        );
        Check(
            "read failure clears key origin",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker);
                tracker.Key(11, null, VK_UP, true, false, 1, 0);
                Equal("unknown", Complete(tracker).GetProperty("origin").GetString());
            }
        );
    }

    private static void CheckForegroundMismatch()
    {
        Check(
            "foreground changed",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker);
                Equal(
                    false,
                    Complete(tracker, foreground: 12).GetProperty("targetMatched").GetBoolean()
                );
            }
        );
        Check(
            "initial target not foreground",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker, foreground: false);
                Equal(false, Complete(tracker).GetProperty("targetMatched").GetBoolean());
            }
        );
    }

    private static void CheckInputCancellation()
    {
        Check(
            "moving transition is conflicted",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker);
                tracker.MoveStart(11);
                var result = Complete(tracker);
                Equal(true, result.GetProperty("moving").GetBoolean());
                Equal(true, result.GetProperty("conflicted").GetBoolean());
            }
        );
        Check(
            "move end clears old input",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker);
                tracker.MoveStart(11);
                tracker.MoveEnd(11);
                var result = Complete(tracker);
                Equal(false, result.GetProperty("moving").GetBoolean());
                Equal("unknown", result.GetProperty("origin").GetString());
            }
        );
        Check(
            "destroy clears old input",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker);
                tracker.Forget(11);
                Equal("unknown", Complete(tracker).GetProperty("origin").GetString());
            }
        );
    }

    private static void CheckClearAndReset()
    {
        Check(
            "other input clears old origin",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker);
                tracker.ClearInput();
                Equal("unknown", Complete(tracker).GetProperty("origin").GetString());
            }
        );
        Check(
            "reset creates new generation without input",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker);
                tracker.Reset(2);
                var result = Complete(tracker);
                Equal(2, result.GetProperty("generation").GetInt32());
                Equal(1, result.GetProperty("sequence").GetInt32());
                Equal("unknown", result.GetProperty("origin").GetString());
            }
        );
    }

    private static void CheckWindowTransitionIdentity()
    {
        Check(
            "duplicate result is not a transition",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker);
                Complete(tracker);
                Equal<object?>(
                    null,
                    tracker.Complete(11, maximized, maximized, 136, 11, "2026-10-11", null)
                );
            }
        );
        Check(
            "arranged source is carried without claiming shortcut",
            () =>
            {
                var tracker = Tracker();
                tracker.Mouse(
                    11,
                    normal with
                    {
                        Arranged = true,
                    },
                    HTMAXBUTTON,
                    default,
                    0,
                    500,
                    0,
                    false,
                    true
                );
                Equal(
                    true,
                    Complete(tracker).GetProperty("before").GetProperty("arranged").GetBoolean()
                );
            }
        );
    }

    private static void CheckReusedWindowHandle()
    {
        Check(
            "reused window handle cannot join different processes",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker);
                Equal<object?>(
                    null,
                    tracker.Complete(
                        11,
                        normal,
                        maximized with
                        {
                            Process = 8,
                        },
                        135,
                        11,
                        "2026-10-11",
                        null
                    )
                );
            }
        );
    }

    private static void CheckCaptionClickIdentity()
    {
        Check(
            "destroy clears caption double click history",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker, HTCAPTION);
                tracker.Forget(11);
                Mouse(tracker, HTCAPTION, 100);
                Equal("unknown", Complete(tracker, 101).GetProperty("origin").GetString());
            }
        );
        Check(
            "caption clicks from different processes are not a double click",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker, HTCAPTION);
                var replacement = normal with { Process = 8 };
                tracker.Mouse(
                    11,
                    replacement,
                    HTCAPTION,
                    new Point { X = -100, Y = 20 },
                    100,
                    500,
                    0,
                    false,
                    true
                );
                Equal(
                    "unknown",
                    Complete(
                            tracker,
                            101,
                            before: replacement,
                            after: replacement with
                            {
                                Show = SW_SHOWMAXIMIZED,
                            }
                        )
                        .GetProperty("origin")
                        .GetString()
                );
            }
        );
    }
}
