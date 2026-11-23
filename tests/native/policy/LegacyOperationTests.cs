using System.Text.Json;
using static NativeMethods;

internal static partial class Program
{
    private static WindowState LeftMonitorWindow() =>
        normal with
        {
            Monitor = new MonitorBounds(-1920, 0, 1920, 1080),
            HorizontalPair = true,
            Work = new(-1920, 0, 1920, 1040),
            Dpi = 96,
            DisplayLayout = "stable",
        };

    private static void CheckLegacyOperations()
    {
        var left = LeftMonitorWindow();
        var right = left with { Monitor = new MonitorBounds(0, 0, 1920, 1080) };
        var minimized = left with { Show = SW_SHOWMINIMIZED };
        foreach (bool key in new[] { false, true })
        {
            Check(
                $"minimize {key} keeps original target after foreground changes",
                () =>
                {
                    var tracker = Tracker();
                    if (key)
                        tracker.Key(11, left, VK_DOWN, true, false, 0, 0);
                    else
                        tracker.Mouse(11, left, HTMINBUTTON, default, 0, 500, 0, false, true);
                    var result = Complete(tracker, foreground: 12, before: left, after: minimized);
                    Equal("minimize", result.GetProperty("operation").GetString());
                    Equal(true, result.GetProperty("targetMatched").GetBoolean());
                    samples.Add(result);
                    Equal<object?>(
                        null,
                        tracker.Complete(11, minimized, minimized, 136, 12, "2026-10-11", null)
                    );
                }
            );
            Check(
                $"restore {key}",
                () =>
                {
                    var tracker = Tracker();
                    var before = left with { Show = SW_SHOWMAXIMIZED };
                    if (key)
                        tracker.Key(11, before, VK_DOWN, true, false, 0, 0);
                    else
                        tracker.Mouse(11, before, HTMAXBUTTON, default, 0, 500, 0, false, true);
                    var result = Complete(tracker, before: before, after: left);
                    Equal("restore", result.GetProperty("operation").GetString());
                    samples.Add(result);
                }
            );
            Check(
                $"close {key} captures original screen and consumes input",
                () =>
                {
                    var tracker = Tracker();
                    if (key)
                        tracker.Key(11, left, VK_F4, false, false, 0, 0, altDown: true);
                    else
                        tracker.Mouse(11, left, HTCLOSE, default, 0, 500, 0, false, true);
                    var result = JsonSerializer.SerializeToElement(
                        tracker.Close(11, left, 135, "2026-10-11")
                    );
                    Equal("close", result.GetProperty("operation").GetString());
                    Equal(-1920, result.GetProperty("monitor").GetProperty("x").GetInt32());
                    samples.Add(result);
                    Equal<object?>(null, tracker.Close(11, left, 136, "2026-10-11"));
                }
            );
            CheckMonitorMoveResult(key, left, right);
        }
        CheckRejectedDrags(left, right);
        CheckIntermediateMonitorMoveRestore(left, right);
        CheckCloseCancellation(left);
    }

    private static void CheckMonitorMoveResult(bool key, WindowState left, WindowState right)
    {
        Check(
            $"monitor move {key}",
            () =>
            {
                var tracker = Tracker();
                JsonElement result;
                if (key)
                {
                    tracker.Key(11, left, VK_RIGHT, true, false, 0, 0, shiftDown: true);
                    tracker.KeyReleased(VK_RIGHT);
                    result = Complete(tracker, before: left, after: right);
                }
                else
                {
                    tracker.Mouse(11, left, HTCAPTION, default, 0, 500, 0, false, true);
                    tracker.MoveStart(11, 100);
                    tracker.Complete(
                        11,
                        left,
                        left with
                        {
                            Show = SW_SHOWMAXIMIZED,
                        },
                        200,
                        11,
                        "2026-10-11",
                        null
                    );
                    tracker.MouseReleased(
                        new Point { X = 500, Y = 400 },
                        right.Monitor,
                        right.Work,
                        0
                    );
                    result = JsonSerializer.SerializeToElement(
                        tracker.FinishMove(11, right, 5000, 11, "2026-10-11")
                    );
                }
                Equal("monitor-move", result.GetProperty("operation").GetString());
                Equal("right", result.GetProperty("moveDirection").GetString());
                Equal(false, result.GetProperty("moving").GetBoolean());
                samples.Add(result);
            }
        );
    }

    private static void CheckRejectedDrags(WindowState left, WindowState right)
    {
        Check(
            "drag returns to original screen without an observation",
            () =>
            {
                var tracker = Tracker();
                tracker.Mouse(11, left, HTCAPTION, default, 0, 500, 0, false, true);
                tracker.MoveStart(11, 100);
                tracker.Complete(11, left, right, 300, 11, "2026-10-11", null);
                Equal<object?>(null, tracker.FinishMove(11, left, 5000, 11, "2026-10-11"));
            }
        );
        foreach (
            string reason in new[]
            {
                "expired",
                "key",
                "read-failure",
                "process",
                "no-end",
                "display-change",
            }
        )
            Check(
                $"drag rejects {reason}",
                () =>
                {
                    var tracker = Tracker();
                    tracker.Mouse(11, left, HTCAPTION, default, 0, 500, 0, false, true);
                    tracker.MoveStart(11, reason == "expired" ? 1001 : 100);
                    InterruptDrag(tracker, reason);
                    var after = reason switch
                    {
                        "process" => right with { Process = 8 },
                        "display-change" => right with { DisplayLayout = "changed" },
                        _ => right,
                    };
                    Equal<object?>(null, tracker.FinishMove(11, after, 5000, 11, "2026-10-11"));
                }
            );
    }

    private static void InterruptDrag(CandidateTracker tracker, string reason)
    {
        if (reason == "key")
            tracker.Key(11, null, VK_SHIFT, false, false, 200, 0);
        if (reason == "read-failure")
            tracker.ClearInput();
        if (reason == "no-end")
        {
            tracker.Reset(2);
        }
    }

    private static void CheckIntermediateMonitorMoveRestore(WindowState left, WindowState right)
    {
        Check(
            "key movement does not separately count its intermediate restore",
            () =>
            {
                var tracker = Tracker();
                var before = left with { Show = SW_SHOWMAXIMIZED };
                tracker.Key(11, before, VK_RIGHT, true, false, 0, 0, shiftDown: true);
                Equal<object?>(
                    null,
                    tracker.Complete(11, before, left, 30, 11, "2026-10-11", null)
                );
                tracker.KeyReleased(VK_RIGHT);
                var result = Complete(tracker, before: left, after: right);
                Equal("monitor-move", result.GetProperty("operation").GetString());
            }
        );
    }

    private static void CheckCloseCancellation(WindowState left)
    {
        Check(
            "close cancellation has no result; unrelated destruction cannot close target",
            () =>
            {
                var tracker = Tracker();
                tracker.Mouse(11, left, HTCLOSE, default, 0, 500, 0, false, true);
                Equal<object?>(null, tracker.Complete(11, left, left, 100, 11, "2026-10-11", null));
                Equal<object?>(null, tracker.Close(12, left, 135, "2026-10-11"));
                Equal(
                    "unknown",
                    JsonSerializer
                        .SerializeToElement(tracker.Close(11, left, 1001, "2026-10-11"))
                        .GetProperty("origin")
                        .GetString()
                );
            }
        );
        Check(
            "destroy with a reused process rejects old close input",
            () =>
            {
                var tracker = Tracker();
                tracker.Mouse(11, left, HTCLOSE, default, 0, 500, 0, false, true);
                Equal<object?>(
                    null,
                    tracker.Close(11, left with { Process = 8 }, 135, "2026-10-11")
                );
            }
        );
        Check(
            "only supported exact key combinations create routes",
            () =>
            {
                Equal<string?>(null, CandidateTracker.KeyRoute(VK_DOWN, true, true, false, false));
                Equal<string?>(null, CandidateTracker.KeyRoute(VK_F4, true, false, true, false));
                Equal<string?>(null, CandidateTracker.KeyRoute(VK_RIGHT, true, true, false, true));
                Equal(
                    "win-shift-left",
                    CandidateTracker.KeyRoute(VK_LEFT, true, true, false, false)
                );
            }
        );
    }
}
