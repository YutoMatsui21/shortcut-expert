using static NativeMethods;
using Point = NativeMethods.Point;

// Message-thread state only. Polling completions are consumed here, never on a hook callback.
internal sealed class TaskbarInputObserver(CandidateProtocol protocol, Func<int> transaction, Func<long> now) : IDisposable
{
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 50 };
    private readonly TaskbarConfirmation confirmation = new();
    private TaskbarKeys keys = new();
    private TaskbarQuery? query;
    private Task<TaskbarSnapshot>? reading;
    private TaskbarSnapshot snapshot = TaskbarSnapshot.Unknown;
    private int generation;
    private long queryAt, snapshotAt, nextQuery;
    private (int Slot, TaskbarSnapshot Snapshot, long SnapshotAt)? mouse;
    private static readonly int[] neutral = [0x5b, 0x5c, 0x10, 0x11, 0x12, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5,
        0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39];
    internal void Start(int epoch)
    {
        Stop(); generation = epoch; query = new();
        keys.Neutral(neutral.All(k => GetAsyncKeyState(k) >= 0));
        timer.Tick += Tick; timer.Start(); nextQuery = now();
    }
    internal void Stop()
    {
        timer.Stop(); timer.Tick -= Tick; generation = 0;
        query?.Dispose(); query = null; reading = null;
        confirmation.Clear(); snapshot = TaskbarSnapshot.Unknown; mouse = null; keys = new();
    }
    internal void Key(uint key, bool down, uint flags)
    {
        if (generation == 0) return;
        bool injected = (flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0;
        if (down) mouse = null;
        int slot = keys.Step(key, down, injected);
        if (injected) { confirmation.Clear(); mouse = null; }
        if (slot != 0 && GetAsyncKeyState(VK_SHIFT) >= 0 && GetAsyncKeyState(VK_CONTROL) >= 0 && GetAsyncKeyState(VK_MENU) >= 0)
            Add("key", slot, snapshot, snapshotAt);
    }
    internal void Mouse(nint message, Point point, uint flags)
    {
        if (generation == 0) return;
        if ((flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED)) != 0) { mouse = null; confirmation.Clear(); return; }
        if (message != WM_LBUTTONDOWN && message != 0x202) { if (message != 0x200) mouse = null; return; }
        long at = now();
        bool fresh = at - snapshotAt is >= 0 and <= 750 && snapshot.Error is null;
        bool primary = fresh && GetAncestor(WindowFromPhysicalPoint(point), GA_ROOT).ToInt64() == snapshot.Root;
        bool modifiers = neutral.Take(11).Any(k => GetAsyncKeyState(k) < 0);
        int slot = primary && !modifiers ? snapshot.Hit(point) : 0;
        if (message == WM_LBUTTONDOWN) mouse = slot > 0 ? (slot, snapshot, snapshotAt) : null;
        else
        {
            if (mouse is { } p && slot == p.Slot && p.Snapshot.Same(snapshot)) Add("mouse", slot, p.Snapshot, p.SnapshotAt);
            mouse = null;
        }
    }
    private void Add(string origin, int slot, TaskbarSnapshot basis, long started)
    {
        confirmation.Add(new(transaction(), DateTime.Now.ToString("yyyy-MM-dd"), origin, slot, now(), started, basis));
        nextQuery = now();
    }
    private void Tick(object? sender, EventArgs args)
    {
        if (generation == 0) return;
        keys.Neutral(neutral.All(k => GetAsyncKeyState(k) >= 0));
        long at = now();
        if (reading is { IsCompleted: true })
        {
            var result = reading.IsCompletedSuccessfully ? reading.Result : TaskbarSnapshot.Unknown;
            reading = null;
            foreach (var p in confirmation.Confirm(result, queryAt, at))
            {
                // No app identity, coordinates or target HWND crosses the candidate boundary.
                var monitor = DisplayContext.Monitor((nint)result.Root);
                protocol.Taskbar(generation, p.Transaction, p.Date, p.Origin,
                    new(p.Slot, true, p.At - p.SnapshotAt, at - p.At, monitor));
            }
            if (!snapshot.Same(result)) mouse = null;
            snapshot = result; snapshotAt = queryAt;
        }
        if (reading is null && at >= nextQuery && query is not null)
        {
            queryAt = at; nextQuery = at + 250;
            var provider = query;
            reading = Task.Run(() => provider.Read());
        }
    }
    public void Dispose() { Stop(); timer.Dispose(); }
}
