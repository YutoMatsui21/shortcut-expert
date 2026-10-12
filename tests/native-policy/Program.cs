using System.Text.Json;
using static NativeMethods;

internal static class Program
{
    private static readonly WindowState normal = new(7, "chrome", SW_SHOWNORMAL, false);
    private static readonly WindowState maximized = normal with { Show = SW_SHOWMAXIMIZED };
    private static readonly List<string> passed = new();
    private static readonly List<object> samples = new();
    private static void Check(string name, Action action) { action(); passed.Add(name); }
    private static void Equal<T>(T expected, T actual)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new Exception($"expected {expected}, actual {actual}");
    }
    private static CandidateTracker Tracker() { var value = new CandidateTracker(); value.Reset(1); return value; }
    private static JsonElement Complete(CandidateTracker tracker, long at = 135, nint foreground = 11,
        WindowState? before = null, WindowState? after = null) => JsonSerializer.SerializeToElement(
            tracker.Complete(11, before ?? normal, after ?? maximized, at, foreground, "2026-10-11",
                new { x = -1920, y = 0, width = 1920, height = 1080 }));
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
            Console.WriteLine(JsonSerializer.Serialize(new { passed, samples, globalInputCollected = false }));
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine($"Native policy failed after {passed.Count} cases: {error.Message}"); return 1; }
    }
}
