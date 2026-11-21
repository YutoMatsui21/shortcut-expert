using static NativeMethods;
using Point = NativeMethods.Point;

// Operation-local UIA confirmation. All methods run on the message-loop thread.
internal sealed class TaskbarDetector(
    DetectionSession session,
    CandidateSink sink,
    Func<long> now,
    Func<uint> displayTopology,
    Func<string>? date = null
)
{
    internal sealed record KeyFacts(uint Key, bool Down, bool Injected, bool Modifiers);

    internal sealed record MouseFacts(
        nint Message,
        Point Point,
        nint Root,
        bool Injected,
        bool Modifiers
    );

    internal sealed record Admission(
        string Origin,
        int Slot,
        TaskbarSnapshot Snapshot,
        long SnapshotAt,
        uint Process
    );

    internal sealed record Query(long Revision, long At, Func<bool> Lease, uint DisplayTopology);

    private sealed record Completion(
        Query Query,
        TaskbarSnapshot Snapshot,
        uint Process,
        MonitorBounds? Monitor
    );

    private sealed record Pending(
        TaskbarPending Fact,
        uint Process,
        GestureManager Manager,
        GestureManager.Input Input,
        ResultComposer.Pending Result
    );

    private readonly List<Pending> pending = new();
    private TaskbarKeys keys = new();
    private TaskbarSnapshot snapshot = TaskbarSnapshot.Unknown;
    private long snapshotAt;
    private uint snapshotProcess;
    private uint? snapshotTopology;
    private (int Slot, TaskbarSnapshot Snapshot, long At, uint Process)? mouse;
    private int generation;
    private long revision;

    internal static TaskbarDetector Register(
        DetectionRouter router,
        DetectionSession session,
        CandidateSink sink,
        Func<long> now,
        Func<uint> displayTopology,
        Func<string>? date = null
    )
    {
        var detector = new TaskbarDetector(session, sink, now, displayTopology, date);
        router.Subscribe(
            new[] { ObservedKind.DisplayInvalidated },
            (_, _) => detector.ResetInput()
        );
        return detector;
    }

    internal void Start(int epoch)
    {
        Stop();
        generation = epoch;
    }

    internal void Stop()
    {
        generation = 0;
        ResetInput();
    }

    private void ResetInput()
    {
        Cancel();
        keys = new();
        snapshot = TaskbarSnapshot.Unknown;
        snapshotTopology = null;
        mouse = null;
    }

    internal void Cancel()
    {
        revision++;
        foreach (var item in pending)
        {
            item.Result.Cancel();
            item.Manager.Reset(0);
        }
        pending.Clear();
    }

    internal void Neutral(bool released) => keys.Neutral(released);

    internal void Key(KeyFacts facts)
    {
        var (key, down, injected, modifiers) = facts;
        if (generation == 0)
            return;
        if (down)
            mouse = null;
        int slot = keys.Step(key, down, injected);
        if (injected)
        {
            Cancel();
            mouse = null;
        }
        if (slot != 0 && !modifiers)
            Add(new("key", slot, snapshot, snapshotAt, snapshotProcess));
    }

    internal void Mouse(MouseFacts facts)
    {
        if (generation == 0)
            return;
        if (facts.Injected)
        {
            Cancel();
            mouse = null;
            return;
        }
        if (facts.Message is WM_LBUTTONDOWN or WM_LBUTTONUP)
            Click(facts);
        else if (facts.Message != 0x200)
            mouse = null;
    }

    private void Click(MouseFacts facts)
    {
        int slot = MouseSlot(facts);
        if (facts.Message == WM_LBUTTONDOWN)
        {
            mouse = slot > 0 ? (slot, snapshot, snapshotAt, snapshotProcess) : null;
            return;
        }
        ReleaseMouse(slot);
    }

    private int MouseSlot(MouseFacts facts) =>
        now() - snapshotAt is >= 0 and <= 750
        && facts.Root.ToInt64() == snapshot.Root
        && !facts.Modifiers
            ? snapshot.Hit(facts.Point)
            : 0;

    private void ReleaseMouse(int slot)
    {
        if (mouse is { } p && MatchesMouse(p, slot))
            Add(new("mouse", slot, p.Snapshot, p.At, p.Process));
        mouse = null;
    }

    private bool MatchesMouse(
        (int Slot, TaskbarSnapshot Snapshot, long At, uint Process) press,
        int slot
    ) => slot == press.Slot && press.Snapshot.Same(snapshot);

    internal Query BeginQuery(long at) =>
        new(revision, at, session.Lease(generation), displayTopology());

    internal void Add(Admission admission)
    {
        var (origin, slot, snapshot, snapshotAt, process) = admission;
        long at = now();
        if (!Admissible(admission))
            return;
        var fact = new TaskbarPending(
            session.Allocator(generation)(),
            (date ?? (() => DateTime.Now.ToString("yyyy-MM-dd")))(),
            origin,
            slot,
            at,
            snapshotAt,
            snapshot
        );
        if (!TaskbarConfirmation.Valid(fact))
            return;
        if (pending.Count >= 16)
        {
            Cancel();
            return;
        }
        // Each outstanding physical input retains its own lifetime; another accepted
        // click must not replace an earlier gesture while the single UIA worker waits.
        var manager = new GestureManager();
        manager.Reset(generation);
        var identity = new WindowState(process, "", 0, null);
        var input = manager.Begin(
            (nint)snapshot.Root,
            identity,
            origin,
            "taskbar",
            at,
            false,
            false,
            true,
            fact.Transaction
        );
        manager.AwaitResult(input.Gesture, at);
        var result = new ResultComposer(session, manager, sink, now).Begin(
            new(input, fact.Date, at + 2500, () => true),
            new[] { new ResultComposer.Subscription("taskbar", at + 2500) }
        );
        pending.Add(new(fact, process, manager, input, result));
    }

    private bool Admissible(Admission input) =>
        generation > 0 && input.Process != 0 && input.Origin is "mouse" or "key";

    private bool Current(Query query) =>
        generation > 0 && query.Revision == revision && query.Lease();

    internal void Complete(
        Query query,
        TaskbarSnapshot snapshot,
        uint process,
        MonitorBounds? monitor
    )
    {
        if (!Current(query) || !RefreshDisplay(query))
            return;
        if (!this.snapshot.Same(snapshot))
            mouse = null;
        this.snapshot = snapshot;
        snapshotAt = query.At;
        snapshotProcess = process;
        foreach (var item in pending.ToArray())
            Resolve(item, new(query, snapshot, process, monitor));
    }

    private bool RefreshDisplay(Query query)
    {
        uint topology = displayTopology();
        bool queryMatches = query.DisplayTopology == topology;
        if (!queryMatches || snapshotTopology.GetValueOrDefault(topology) != topology)
            ResetInput();
        if (!queryMatches)
            return false;
        snapshotTopology = topology;
        return true;
    }

    private void Resolve(Pending item, Completion completed)
    {
        var (query, snapshot, process, monitor) = completed;
        if (!MatchingResult(item, snapshot, process))
        {
            item.Result.Cancel();
            item.Manager.Reset(0);
        }
        else if (query.At > item.Fact.At)
            Confirm(item, now(), monitor);
        else
            return;
        pending.Remove(item);
    }

    private bool MatchingResult(Pending item, TaskbarSnapshot snapshot, uint process) =>
        process == item.Process
        && item.Fact.Snapshot.Same(snapshot)
        && now() - item.Fact.At is >= 0 and <= 2500;

    private void Confirm(Pending item, long at, MonitorBounds? monitor)
    {
        var input = item.Input;
        if (!item.Manager.Complete(input.Gesture, input.Window, input.Before, at))
        {
            item.Result.Cancel();
            return;
        }
        item.Result.Confirm(
            "taskbar",
            new(generation, input.Window, item.Process, input.Gesture.Source),
            input.Gesture,
            new IndependentTaskbarProof(
                item.Fact.Origin == "key"
                    ? IndependentTaskbarRoute.WinDigit
                    : IndependentTaskbarRoute.TaskbarClick,
                item.Fact.Slot,
                true,
                item.Fact.At - item.Fact.SnapshotAt,
                at - item.Fact.At,
                monitor
            )
        );
        item.Result.Seal();
    }
}
