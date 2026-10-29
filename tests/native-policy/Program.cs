using System.Text.Json;
using static NativeMethods;

internal static partial class Program
{
    private static readonly WindowState normal = new(7, "chrome", SW_SHOWNORMAL, false);
    private static readonly WindowState maximized = normal with { Show = SW_SHOWMAXIMIZED };
    private static readonly List<string> passed = new();
    private static readonly List<object> samples = new();
    private static readonly List<object> v2Samples = new();
    private static void Check(string name, Action action) { try { action(); passed.Add(name); } catch (Exception error) { throw new Exception($"{name}: {error.Message}", error); } }
    private static void Equal<T>(T expected, T actual)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new Exception($"expected {expected}, actual {actual}");
    }
    private static CandidateTracker Tracker() { var value = new CandidateTracker(); value.Reset(1); return value; }
    private static JsonElement Complete(CandidateTracker tracker, long at = 135, nint foreground = 11,
        WindowState? before = null, WindowState? after = null) => JsonSerializer.SerializeToElement(
            tracker.Complete(11, before ?? normal, after ?? maximized, at, foreground, "2026-10-11",
                new MonitorBounds(-1920, 0, 1920, 1080)));
    private static void Mouse(CandidateTracker tracker, int hit = HTMAXBUTTON, long at = 0,
        uint flags = 0, bool modifiers = false, bool foreground = true) =>
        tracker.Mouse(11, normal, hit, new Point { X = -100, Y = 20 }, at, 500, flags, modifiers, foreground);

    private static int Main()
    {
        try
        {
            Check("max button + same target + result", () => {
                var tracker = Tracker(); Mouse(tracker);
                var result = Complete(tracker);
                Equal("mouse", result.GetProperty("origin").GetString());
                Equal("max-button", result.GetProperty("route").GetString());
                Equal(true, result.GetProperty("targetMatched").GetBoolean());
                Equal(1, result.GetProperty("sequence").GetInt32());
                samples.Add(result);
            });
            Check("Win+Up + result", () => {
                var tracker = Tracker(); tracker.Key(11, normal, VK_UP, true, false, 0, 0);
                var result = Complete(tracker);
                Equal("key", result.GetProperty("origin").GetString());
                Equal("win-up", result.GetProperty("route").GetString());
                samples.Add(result);
            });
            foreach (var (at, origin) in new[] { (999L, "mouse"), (1000L, "mouse"), (1001L, "unknown"), (-1L, "unknown") })
                Check($"input age {at}", () => { var tracker = Tracker(); Mouse(tracker); Equal(origin, Complete(tracker, at).GetProperty("origin").GetString()); });
            foreach (uint flags in new[] { LLMHF_INJECTED, LLMHF_LOWER_IL_INJECTED })
                Check($"mouse injection flag {flags}", () => { var tracker = Tracker(); Mouse(tracker, flags: flags); var result = Complete(tracker); Equal(true, result.GetProperty("injected").GetBoolean()); samples.Add(result); });
            foreach (uint flags in new[] { LLKHF_INJECTED, LLKHF_LOWER_IL_INJECTED })
                Check($"key injection flag {flags}", () => { var tracker = Tracker(); tracker.Key(11, normal, VK_UP, true, false, 0, flags); Equal(true, Complete(tracker).GetProperty("injected").GetBoolean()); });
            foreach (uint modifier in new uint[] { VK_LWIN, VK_RWIN, VK_LSHIFT, VK_RSHIFT, VK_LCONTROL, VK_RCONTROL, VK_LMENU, VK_RMENU })
                Check($"modifier conflict {modifier}", () => { var tracker = Tracker(); Mouse(tracker); tracker.Key(11, null, modifier, false, false, 1, 0); Equal(true, Complete(tracker).GetProperty("conflicted").GetBoolean()); });
            Check("mouse then key conflict", () => { var tracker = Tracker(); Mouse(tracker); tracker.Key(11, normal, VK_UP, true, false, 1, 0); Equal(true, Complete(tracker).GetProperty("conflicted").GetBoolean()); });
            Check("program change has unknown origin", () => { var tracker = Tracker(); Equal("unknown", Complete(tracker).GetProperty("origin").GetString()); });
            Check("unknown hit test", () => { var tracker = Tracker(); Mouse(tracker, hit: -1); Equal("unknown", Complete(tracker).GetProperty("origin").GetString()); });
            Check("caption double click", () => { var tracker = Tracker(); Mouse(tracker, HTCAPTION); Mouse(tracker, HTCAPTION, 500); Equal("caption-double-click", Complete(tracker, 501).GetProperty("route").GetString()); });
            Check("caption double click expires", () => { var tracker = Tracker(); Mouse(tracker, HTCAPTION); Mouse(tracker, HTCAPTION, 501); Equal("unknown", Complete(tracker, 502).GetProperty("route").GetString()); });
            Check("caption distant click", () => { var tracker = Tracker(); Mouse(tracker, HTCAPTION); tracker.Mouse(11, normal, HTCAPTION, new Point { X = -95, Y = 20 }, 1, 500, 0, false, true); Equal("unknown", Complete(tracker).GetProperty("route").GetString()); });
            Check("key without Win", () => { var tracker = Tracker(); tracker.Key(11, normal, VK_UP, false, false, 0, 0); Equal("unknown", Complete(tracker).GetProperty("origin").GetString()); });
            Check("key with extra modifiers", () => { var tracker = Tracker(); tracker.Key(11, normal, VK_UP, true, true, 0, 0); Equal("unknown", Complete(tracker).GetProperty("origin").GetString()); });
            Check("read failure clears key origin", () => { var tracker = Tracker(); Mouse(tracker); tracker.Key(11, null, VK_UP, true, false, 1, 0); Equal("unknown", Complete(tracker).GetProperty("origin").GetString()); });
            Check("foreground changed", () => { var tracker = Tracker(); Mouse(tracker); Equal(false, Complete(tracker, foreground: 12).GetProperty("targetMatched").GetBoolean()); });
            Check("initial target not foreground", () => { var tracker = Tracker(); Mouse(tracker, foreground: false); Equal(false, Complete(tracker).GetProperty("targetMatched").GetBoolean()); });
            Check("moving transition is conflicted", () => { var tracker = Tracker(); Mouse(tracker); tracker.MoveStart(11); var result = Complete(tracker); Equal(true, result.GetProperty("moving").GetBoolean()); Equal(true, result.GetProperty("conflicted").GetBoolean()); });
            Check("move end clears old input", () => { var tracker = Tracker(); Mouse(tracker); tracker.MoveStart(11); tracker.MoveEnd(11); var result = Complete(tracker); Equal(false, result.GetProperty("moving").GetBoolean()); Equal("unknown", result.GetProperty("origin").GetString()); });
            Check("destroy clears old input", () => { var tracker = Tracker(); Mouse(tracker); tracker.Forget(11); Equal("unknown", Complete(tracker).GetProperty("origin").GetString()); });
            Check("other input clears old origin", () => { var tracker = Tracker(); Mouse(tracker); tracker.ClearInput(); Equal("unknown", Complete(tracker).GetProperty("origin").GetString()); });
            Check("reset creates new generation without input", () => { var tracker = Tracker(); Mouse(tracker); tracker.Reset(2); var result = Complete(tracker); Equal(2, result.GetProperty("generation").GetInt32()); Equal(1, result.GetProperty("sequence").GetInt32()); Equal("unknown", result.GetProperty("origin").GetString()); });
            Check("duplicate result is not a transition", () => { var tracker = Tracker(); Mouse(tracker); Complete(tracker); Equal<object?>(null, tracker.Complete(11, maximized, maximized, 136, 11, "2026-10-11", null)); });
            Check("arranged source is carried without claiming shortcut", () => { var tracker = Tracker(); tracker.Mouse(11, normal with { Arranged = true }, HTMAXBUTTON, default, 0, 500, 0, false, true); Equal(true, Complete(tracker).GetProperty("before").GetProperty("arranged").GetBoolean()); });
            var monitor = new Rect { Left = -1920, Top = 0, Right = 0, Bottom = 1080 };
            Check("negative monitor coordinates", () => Equal("fullscreen", DisplayPolicy.Classify(true, 0, true, monitor, monitor, false, false)));
            Check("fullscreen tolerance at 2px", () => { var rect = monitor; rect.Left += 2; rect.Top += 2; rect.Right -= 2; rect.Bottom -= 2; Equal("fullscreen", DisplayPolicy.Classify(true, 0, true, rect, monitor, false, false)); });
            Check("3px gap is ordinary", () => { var rect = monitor; rect.Left += 3; Equal("ordinary", DisplayPolicy.Classify(true, 0, true, rect, monitor, false, false)); });
            Check("reused window handle cannot join different processes", () => {
                var tracker = Tracker(); Mouse(tracker);
                Equal<object?>(null, tracker.Complete(11, normal, maximized with { Process = 8 }, 135, 11, "2026-10-11", null));
            });
            Check("destroy clears caption double click history", () => {
                var tracker = Tracker(); Mouse(tracker, HTCAPTION); tracker.Forget(11);
                Mouse(tracker, HTCAPTION, 100);
                Equal("unknown", Complete(tracker, 101).GetProperty("origin").GetString());
            });
            Check("caption clicks from different processes are not a double click", () => {
                var tracker = Tracker(); Mouse(tracker, HTCAPTION);
                var replacement = normal with { Process = 8 };
                tracker.Mouse(11, replacement, HTCAPTION, new Point { X = -100, Y = 20 }, 100, 500, 0, false, true);
                Equal("unknown", Complete(tracker, 101, before: replacement, after: replacement with { Show = SW_SHOWMAXIMIZED }).GetProperty("origin").GetString());
            });
            CheckAdditionalOperations();
            CheckWinDownGrouping();
            var windowStateSamples = CheckWindowStates();
            var placementSamples = CheckPlacement();
            CheckMonitorMoves(); CheckCompoundDrags();
            CheckProtocol();
            var snapSamples = SnapTests.Run(passed);
            var taskbarSamples = TaskbarTests.Run(passed);
            var switchSamples = WindowSwitchTests.Run(passed);
            var closeSamples = WindowCloseTests.Run(passed);
            Console.WriteLine(JsonSerializer.Serialize(new { passed, samples, v2Samples, snapSamples, taskbarSamples, switchSamples, windowStateSamples, placementSamples, monitorMoveSamples, compoundSamples, closeSamples, globalInputCollected = false }));
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine($"Native policy failed after {passed.Count} cases: {error.Message}"); return 1; }
    }
    private static void CheckWinDownGrouping()
    {
        foreach (string boundary in new[] { "continuous", "expired", "other-key", "other-window", "mouse", "reset", "foreground-return", "other-target-no-result" })
            Check($"Win+Down grouping: {boundary}", () => {
                var tracker = Tracker();
                tracker.Key(11, maximized, VK_DOWN, true, false, 0, 0);
                var first = tracker.Complete(11, maximized, normal, 100, 11, "2026-10-27", null);
                Equal(true, first is WindowCandidate);
                tracker.KeyReleased(VK_DOWN);
                long at = boundary == "expired" ? 1101 : 200;
                nint target = boundary == "other-window" ? 12 : 11;
                if (boundary == "other-key") tracker.Key(11, normal, 0x41, false, false, 150, 0);
                if (boundary == "mouse") tracker.Mouse(11, normal, HTCAPTION, default, 150, 500, 0, false, true);
                if (boundary == "reset") tracker.Reset(2);
                if (boundary == "foreground-return") { tracker.ForegroundChanged(12); tracker.ForegroundChanged(11); }
                if (boundary == "other-target-no-result") {
                    tracker.Key(12, normal, VK_DOWN, true, false, 150, 0);
                    tracker.KeyReleased(VK_DOWN);
                }
                tracker.Key(target, normal, VK_DOWN, true, false, at, 0);
                var second = tracker.Complete(target, normal, normal with { Show = SW_SHOWMINIMIZED }, at + 100, 12, "2026-10-27", null);
                Equal(boundary != "continuous", second is WindowCandidate);
            });
        Check("Win+Down repeat cannot renew input", () => {
            var tracker = Tracker();
            tracker.Key(11, normal, VK_DOWN, true, false, 0, 0);
            tracker.Key(11, normal, VK_DOWN, true, false, 900, 0);
            var result = (WindowCandidate)tracker.Complete(11, normal, normal with { Show = SW_SHOWMINIMIZED }, 1100, 12, "2026-10-27", null)!;
            Equal("unknown", result.origin);
        });
    }
    private static void CheckProtocol()
    {
        foreach (var sample in samples)
        {
            var legacy = JsonSerializer.Deserialize<WindowCandidate>(JsonSerializer.Serialize(sample))!;
            v2Samples.Add(CandidateProtocol.V2(legacy, legacy.sequence, legacy.sequence));
        }
        Check("final emission order is independent from input transaction order", () => {
            var tracker = Tracker(); Mouse(tracker);
            var first = (WindowCandidate)tracker.Complete(11, normal, maximized, 100, 11, "2026-10-11", null)!;
            Mouse(tracker, at: 200);
            var second = (WindowCandidate)tracker.Complete(11, normal, maximized, 300, 11, "2026-10-11", null)!;
            var delivered = new List<CandidateEnvelope>();
            var emitter = new CandidateProtocol(value => delivered.Add((CandidateEnvelope)value));
            emitter.Start(1, 2); emitter.Complete(second); emitter.Complete(first);
            Equal(1, delivered[0].sequence); Equal(2, delivered[0].transaction);
            Equal(2, delivered[1].sequence); Equal(1, delivered[1].transaction);
            emitter.Stop(); emitter.Complete(first); Equal(2, delivered.Count);
            emitter.Start(2, 2); emitter.Complete(first); Equal(2, delivered.Count);
            emitter.Complete(first with { generation = 2 }); Equal(1, delivered[2].sequence);
        });
        Check("v2 drag emits only its terminal evidence", () => {
            var left = normal with { Monitor = new(-1920, 0, 1920, 1080), Work = new(-1920, 0, 1920, 1040), Dpi = 96, DisplayLayout = "stable" };
            var right = left with { Monitor = new(0, 0, 1920, 1080) };
            var tracker = Tracker(); tracker.Mouse(11, left, HTCAPTION, default, 0, 500, 0, false, true);
            tracker.MoveStart(11, 100);
            Equal<object?>(null, tracker.Complete(11, left, maximized, 200, 11, "2026-10-11", null));
            tracker.MouseReleased(new Point { X = 500, Y = 400 }, right.Monitor, right.Work, 0);
            var end = (WindowCandidate)tracker.FinishMove(11, right, 5000, 11, "2026-10-11")!;
            Equal(1, end.Transaction); Equal("monitor-move", end.operation);
        });
        foreach (Evidence evidence in new Evidence[] {
            new ShellDisplayEvidence("task-view", null, null, null),
            new ActivationEvidence(null, null, null, null, "unknown"),
            new GlobalEvidence("desktop", null, null)
        }) v2Samples.Add(new CandidateEnvelope("candidate", 2, 1, 1, 1, "2026-10-11", "unknown", "unknown", false, false, evidence));
    }
    private static void CheckAdditionalOperations()
    {
        var left = normal with { Monitor = new MonitorBounds(-1920, 0, 1920, 1080), HorizontalPair = true, Work = new(-1920, 0, 1920, 1040), Dpi = 96, DisplayLayout = "stable" };
        var right = left with { Monitor = new MonitorBounds(0, 0, 1920, 1080) };
        var minimized = left with { Show = SW_SHOWMINIMIZED };
        foreach (bool key in new[] { false, true })
        {
            Check($"minimize {key} keeps original target after foreground changes", () => {
                var tracker = Tracker();
                if (key) tracker.Key(11, left, VK_DOWN, true, false, 0, 0);
                else tracker.Mouse(11, left, HTMINBUTTON, default, 0, 500, 0, false, true);
                var result = Complete(tracker, foreground: 12, before: left, after: minimized);
                Equal("minimize", result.GetProperty("operation").GetString());
                Equal(true, result.GetProperty("targetMatched").GetBoolean()); samples.Add(result);
                Equal<object?>(null, tracker.Complete(11, minimized, minimized, 136, 12, "2026-10-11", null));
            });
            Check($"restore {key}", () => {
                var tracker = Tracker(); var before = left with { Show = SW_SHOWMAXIMIZED };
                if (key) tracker.Key(11, before, VK_DOWN, true, false, 0, 0);
                else tracker.Mouse(11, before, HTMAXBUTTON, default, 0, 500, 0, false, true);
                var result = Complete(tracker, before: before, after: left);
                Equal("restore", result.GetProperty("operation").GetString()); samples.Add(result);
            });
            Check($"close {key} captures original screen and consumes input", () => {
                var tracker = Tracker();
                if (key) tracker.Key(11, left, VK_F4, false, false, 0, 0, altDown: true);
                else tracker.Mouse(11, left, HTCLOSE, default, 0, 500, 0, false, true);
                var result = JsonSerializer.SerializeToElement(tracker.Close(11, left, 135, "2026-10-11"));
                Equal("close", result.GetProperty("operation").GetString());
                Equal(-1920, result.GetProperty("monitor").GetProperty("x").GetInt32()); samples.Add(result);
                Equal<object?>(null, tracker.Close(11, left, 136, "2026-10-11"));
            });
            Check($"monitor move {key}", () => {
                var tracker = Tracker(); JsonElement result;
                if (key) {
                    tracker.Key(11, left, VK_RIGHT, true, false, 0, 0, shiftDown: true);
                    tracker.KeyReleased(VK_RIGHT);
                    result = Complete(tracker, before: left, after: right);
                } else {
                    tracker.Mouse(11, left, HTCAPTION, default, 0, 500, 0, false, true);
                    tracker.MoveStart(11, 100);
                    tracker.Complete(11, left, left with { Show = SW_SHOWMAXIMIZED }, 200, 11, "2026-10-11", null);
                    tracker.MouseReleased(new Point { X = 500, Y = 400 }, right.Monitor, right.Work, 0);
                    result = JsonSerializer.SerializeToElement(tracker.FinishMove(11, right, 5000, 11, "2026-10-11"));
                }
                Equal("monitor-move", result.GetProperty("operation").GetString());
                Equal("right", result.GetProperty("moveDirection").GetString());
                Equal(false, result.GetProperty("moving").GetBoolean()); samples.Add(result);
            });
        }
        Check("drag returns to original screen without an observation", () => {
            var tracker = Tracker(); tracker.Mouse(11, left, HTCAPTION, default, 0, 500, 0, false, true);
            tracker.MoveStart(11, 100); tracker.Complete(11, left, right, 300, 11, "2026-10-11", null);
            Equal<object?>(null, tracker.FinishMove(11, left, 5000, 11, "2026-10-11"));
        });
        foreach (string reason in new[] { "expired", "key", "read-failure", "process", "no-end", "display-change" })
            Check($"drag rejects {reason}", () => {
                var tracker = Tracker(); tracker.Mouse(11, left, HTCAPTION, default, 0, 500, 0, false, true);
                tracker.MoveStart(11, reason == "expired" ? 1001 : 100);
                if (reason == "key") tracker.Key(11, null, VK_SHIFT, false, false, 200, 0);
                if (reason == "read-failure") tracker.ClearInput();
                if (reason == "no-end") { tracker.Reset(2); }
                var after = reason switch { "process" => right with { Process = 8 }, "display-change" => right with { DisplayLayout = "changed" }, _ => right };
                Equal<object?>(null, tracker.FinishMove(11, after, 5000, 11, "2026-10-11"));
            });
        Check("key movement does not separately count its intermediate restore", () => {
            var tracker = Tracker(); var before = left with { Show = SW_SHOWMAXIMIZED };
            tracker.Key(11, before, VK_RIGHT, true, false, 0, 0, shiftDown: true);
            Equal<object?>(null, tracker.Complete(11, before, left, 30, 11, "2026-10-11", null));
            tracker.KeyReleased(VK_RIGHT);
            var result = Complete(tracker, before: left, after: right);
            Equal("monitor-move", result.GetProperty("operation").GetString());
        });
        Check("close cancellation has no result; unrelated destruction cannot close target", () => {
            var tracker = Tracker(); tracker.Mouse(11, left, HTCLOSE, default, 0, 500, 0, false, true);
            Equal<object?>(null, tracker.Complete(11, left, left, 100, 11, "2026-10-11", null));
            Equal<object?>(null, tracker.Close(12, left, 135, "2026-10-11"));
            Equal("unknown", JsonSerializer.SerializeToElement(tracker.Close(11, left, 1001, "2026-10-11")).GetProperty("origin").GetString());
        });
        Check("destroy with a reused process rejects old close input", () => {
            var tracker = Tracker(); tracker.Mouse(11, left, HTCLOSE, default, 0, 500, 0, false, true);
            Equal<object?>(null, tracker.Close(11, left with { Process = 8 }, 135, "2026-10-11"));
        });
        Check("only supported exact key combinations create routes", () => {
            Equal<string?>(null, CandidateTracker.KeyRoute(VK_DOWN, true, true, false, false));
            Equal<string?>(null, CandidateTracker.KeyRoute(VK_F4, true, false, true, false));
            Equal<string?>(null, CandidateTracker.KeyRoute(VK_RIGHT, true, true, false, true));
            Equal("win-shift-left", CandidateTracker.KeyRoute(VK_LEFT, true, true, false, false));
        });
    }
}
