using static NativeMethods;

internal static class TaskbarTests
{
    internal static List<object> Run(List<string> passed)
    {
        void Check(string name, bool ok) { if (!ok) throw new Exception(name); passed.Add("W12 " + name); }
        TaskbarSnapshot Layout(int count = 10) => new(null, 11, 0, 0, 1200, 40,
            Enumerable.Range(1, count).Select(i => new TaskbarItem("fixture" + i, i * 40, 0, 40, 40)).ToArray());
        var layout = Layout();
        for (int i = 1; i <= 10; i++)
        {
            var keys = new TaskbarKeys(); keys.Neutral(true); keys.Step(0x5b, true, false);
            uint digit = (uint)(i == 10 ? 0x30 : 0x30 + i);
            Check("digit " + i, keys.Step(digit, true, false) == i);
            Check("repeat " + i, keys.Step(digit, true, false) == 0);
            Check("hit " + i, layout.Hit(new Point { X = i * 40, Y = 0 }) == i);
        }
        foreach (uint modifier in new uint[] { 0x10, 0x11, 0x12, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5 })
        {
            var keys = new TaskbarKeys(); keys.Neutral(true); keys.Step(0x5b, true, false); keys.Step(modifier, true, false);
            Check("modifier " + modifier, keys.Step(0x31, true, false) == 0);
        }
        foreach (uint injected in new uint[] { 0x5b, 0x31 })
        {
            var keys = new TaskbarKeys(); keys.Neutral(true); keys.Step(0x5b, true, injected == 0x5b);
            Check("injected " + injected, keys.Step(0x31, true, injected == 0x31) == 0);
            keys.Neutral(false); keys.Step(0x31, false, false);
            Check("tainted chord", keys.Step(0x31, true, false) == 0);
            keys.Neutral(true); keys.Step(0x5b, true, false);
            Check("neutral recovery", keys.Step(0x31, true, false) == 1);
        }
        var notArmed = new TaskbarKeys(); notArmed.Step(0x5b, true, false);
        Check("held at start", notArmed.Step(0x31, true, false) == 0);
        var noWin = new TaskbarKeys(); noWin.Neutral(true);
        Check("no Win", noWin.Step(0x31, true, false) == 0);
        Check("non app and thumbnail", layout.Hit(new Point { X = 20, Y = 10 }) == 0 && layout.Hit(new Point { X = 40, Y = 40 }) == 0);
        Check("unknown hit", TaskbarSnapshot.Unknown.Hit(new Point { X = 40, Y = 10 }) == 0);
        TaskbarPending Pending(int slot = 1, long at = 100, long snapshotAt = 0) => new(1, "2026-10-21", "mouse", slot, at, snapshotAt, layout);
        var confirmation = new TaskbarConfirmation();
        confirmation.Add(Pending());
        Check("cannot confirm using pre-input query", confirmation.Confirm(layout, 99, 150).Length == 0);
        Check("post input query confirms", confirmation.Confirm(layout, 101, 200).Length == 1);
        Check("once only", confirmation.Confirm(layout, 201, 300).Length == 0);
        foreach (var changed in new[] { TaskbarSnapshot.Unknown, Layout(9), layout with { Root = 12 },
            layout with { Items = layout.Items.Reverse().ToArray() }, layout with { X = 1 } })
        {
            confirmation.Add(Pending()); Check("layout change rejects", confirmation.Confirm(changed, 101, 200).Length == 0);
            Check("old candidate cannot revive", confirmation.Confirm(layout, 201, 300).Length == 0);
        }
        foreach (var p in new[] { Pending(0), Pending(11), Pending(1, 751), Pending(1, 100, 101) })
        { confirmation.Add(p); Check("invalid mapping or freshness", confirmation.Confirm(layout, 1000, 1100).Length == 0); }
        confirmation.Add(Pending()); Check("deadline", confirmation.Confirm(layout, 101, 2601).Length == 0);
        confirmation.Add(Pending()); confirmation.Clear(); Check("stop drops pending", confirmation.Confirm(layout, 101, 200).Length == 0);
        confirmation.Add(Pending(10, 750)); Check("inclusive age bounds", confirmation.Confirm(layout, 751, 3250).Length == 1);
        var emitted = new List<object>(); var protocol = new CandidateProtocol(emitted.Add); protocol.Start(1, 2);
        protocol.Taskbar(1, 1, "2026-10-21", "mouse", new(10, true, 100, 200, new(0, 0, 1920, 1080)));
        protocol.Taskbar(1, 2, "2026-10-21", "key", new(1, true, 100, 200, new(0, 0, 1920, 1080)));
        protocol.Stop(); protocol.Taskbar(1, 3, "2026-10-21", "mouse", new(1, true, 0, 0, null));
        protocol.Start(2, 2); protocol.Taskbar(1, 4, "2026-10-21", "mouse", new(1, true, 0, 0, null));
        protocol.Start(3, 1); protocol.Taskbar(3, 5, "2026-10-21", "mouse", new(1, true, 0, 0, null));
        Check("stop epoch and v1 reject", emitted.Count == 2);
        return emitted;
    }
}
