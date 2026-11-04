using static NativeMethods;
using Point = NativeMethods.Point;

// Identities and geometry are ephemeral; neither belongs in candidate JSON or storage.
internal sealed record TaskbarItem(string Id, double X, double Y, double W, double H);

internal sealed record TaskbarSnapshot(
    string? Error,
    long Root,
    double X,
    double Y,
    double W,
    double H,
    TaskbarItem[] Items
)
{
    internal static TaskbarSnapshot Unknown => new("unknown", 0, 0, 0, 0, 0, []);

    internal bool Same(TaskbarSnapshot other) =>
        Error is null
        && other.Error is null
        && Root == other.Root
        && X == other.X
        && Y == other.Y
        && W == other.W
        && H == other.H
        && Items.SequenceEqual(other.Items);

    internal int Hit(Point point)
    {
        if (Error is not null)
            return 0;
        for (int i = 0; i < Math.Min(10, Items.Length); i++)
        {
            var item = Items[i];
            if (
                point.X >= item.X
                && point.X < item.X + item.W
                && point.Y >= item.Y
                && point.Y < item.Y + item.H
            )
                return i + 1;
        }
        return 0;
    }
}

internal sealed class TaskbarKeys
{
    private readonly HashSet<uint> held = new(),
        synthetic = new();
    private bool tainted = true;

    internal void Neutral(bool released)
    {
        if (released)
        {
            held.Clear();
            synthetic.Clear();
            tainted = false;
        }
    }

    internal static bool Relevant(uint key) =>
        key is 0x5b or 0x5c or 0x10 or 0x11 or 0x12
        || key is >= 0x30 and <= 0x39
        || key is >= 0xa0 and <= 0xa5;

    internal int Step(uint key, bool down, bool injected)
    {
        if (injected)
            tainted = true;
        if (!Relevant(key))
            return 0;
        if (injected)
        {
            tainted = true;
            if (down)
                synthetic.Add(key);
            else
                synthetic.Remove(key);
            return 0;
        }
        bool repeat = held.Contains(key);
        if (down)
            held.Add(key);
        else
            held.Remove(key);
        bool modifiers = held.Any(k => k is 0x10 or 0x11 or 0x12 || k is >= 0xa0 and <= 0xa5);
        return
            down
            && !repeat
            && !tainted
            && !modifiers
            && (held.Contains(0x5b) || held.Contains(0x5c))
            && key is >= 0x30 and <= 0x39
            ? key == 0x30
                ? 10
                : (int)key - 0x30
            : 0;
    }
}

internal sealed record TaskbarPending(
    int Transaction,
    string Date,
    string Origin,
    int Slot,
    long At,
    long SnapshotAt,
    TaskbarSnapshot Snapshot
);

internal sealed class TaskbarConfirmation
{
    private readonly List<TaskbarPending> pending = new();

    internal void Clear() => pending.Clear();

    internal void Add(TaskbarPending value)
    {
        if (
            value.Snapshot.Error is not null
            || value.Slot < 1
            || value.Slot > Math.Min(10, value.Snapshot.Items.Length)
            || value.At - value.SnapshotAt is < 0 or > 750
        )
            return;
        if (pending.Count >= 16)
        {
            pending.Clear();
            return;
        }
        pending.Add(value);
    }

    internal TaskbarPending[] Confirm(TaskbarSnapshot snapshot, long queryAt, long now)
    {
        var accepted = pending
            .Where(p =>
                p.Snapshot.Same(snapshot) && queryAt > p.At && now - p.At is >= 0 and <= 2500
            )
            .ToArray();
        pending.RemoveAll(p =>
            !p.Snapshot.Same(snapshot) || now - p.At is < 0 or > 2500 || queryAt > p.At
        );
        return accepted;
    }
}
