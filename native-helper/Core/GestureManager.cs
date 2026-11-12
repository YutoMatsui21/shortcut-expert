using Point = NativeMethods.Point;

internal sealed class GestureManager
{
    internal enum Phase
    {
        Observing,
        AwaitingResult,
        Completed,
        Cancelled,
        Expired,
    }

    internal sealed record Snapshot(long At, WindowState State);

    // In-memory facts only; ID is local and is deliberately independent of transaction numbering.
    internal sealed class Gesture(
        long id,
        long revision,
        int generation,
        nint window,
        string source,
        Snapshot start,
        bool injected,
        bool modified,
        bool matched
    )
    {
        internal long Id { get; } = id;
        internal long Revision { get; } = revision;
        internal int Generation { get; } = generation;
        internal nint Window { get; } = window;
        internal string Source { get; } = source;
        internal Snapshot Start { get; } = start;
        internal Snapshot? End { get; set; }
        internal long? ReleasedAt { get; set; }
        internal nint? Foreground { get; set; }
        internal bool Injected { get; } = injected;
        internal bool Modified { get; } = modified;
        internal bool Matched { get; } = matched;
        internal Phase State { get; set; } = Phase.Observing;
    }

    // Compatibility input: route, age convention, transaction and drag evidence still belong
    // to the existing policies. Cloning this record cannot clone the physical input identity.
    internal sealed record Input(
        Gesture Gesture,
        WindowState Before,
        string Origin,
        string Route,
        long At,
        bool Injected,
        bool Conflicted,
        bool Matched,
        int Transaction,
        WindowDragReleaseProbe? Probe = null,
        bool CaptionPress = false
    )
    {
        internal nint Window => Gesture.Window;
    }

    private int generation;
    private long revision,
        identity;
    internal Gesture? Current { get; private set; }

    internal void Reset(int nextGeneration)
    {
        Cancel(Current);
        generation = nextGeneration;
        revision++;
        Current = null;
        Clear();
        Moving.Clear();
    }

    internal Gesture Start(
        nint window,
        WindowState before,
        string source,
        long at,
        bool injected = false,
        bool modified = false,
        bool matched = true
    )
    {
        Cancel(Current);
        Current = new Gesture(
            checked(++identity),
            revision,
            generation,
            window,
            source,
            new Snapshot(at, before),
            injected,
            modified,
            matched
        );
        if (generation <= 0)
            Current.State = Phase.Cancelled;
        return Current;
    }

    internal Gesture StartKeySeries(nint window, WindowState before, long at) =>
        Live(Current)
        && Current!.Source == "key"
        && Current.Window == window
        && Current.Start.At == at
        && Current.Start.State == before
            ? Current
            : Start(window, before, "key", at);

    internal Input Begin(
        nint window,
        WindowState before,
        string origin,
        string route,
        long at,
        bool injected,
        bool conflicted,
        bool matched,
        int transaction,
        bool CaptionPress = false,
        bool ContinueSeries = false
    ) =>
        new(
            ContinueSeries
            && Live(Current)
            && Current!.Window == window
            && Current.Start.State.Process == before.Process
                ? Current
                : Start(
                    window,
                    before,
                    origin == "key" ? "key" : "caption",
                    at,
                    injected,
                    conflicted,
                    matched
                ),
            before,
            origin,
            route,
            at,
            injected,
            conflicted,
            matched,
            transaction,
            CaptionPress: CaptionPress
        );

    private bool Live(Gesture? value) =>
        value is not null
        && ReferenceEquals(value, Current)
        && value.Revision == revision
        && value.Generation == generation
        && generation > 0
        && value.State is Phase.Observing or Phase.AwaitingResult;

    internal bool AwaitResult(Gesture? value, long? releasedAt = null)
    {
        if (!Live(value))
            return false;
        value!.State = Phase.AwaitingResult;
        value.ReleasedAt ??= releasedAt;
        return true;
    }

    internal bool Complete(Gesture? value, nint window, WindowState after, long at)
    {
        if (
            !Live(value)
            || value!.Window != window
            || value.Start.State.Process != after.Process
            || at < value.Start.At
        )
            return false;
        value.End = new Snapshot(at, after);
        value.State = Phase.Completed;
        return true;
    }

    internal bool Cancel(Gesture? value)
    {
        if (!Live(value))
            return false;
        value!.State = Phase.Cancelled;
        return true;
    }

    // Deadline selection remains with each policy, especially W11 DESTROY and W12 UIA.
    internal bool Expire(Gesture? value, long now, long deadline)
    {
        if (!Live(value) || now <= deadline)
            return false;
        value!.State = Phase.Expired;
        return true;
    }

    internal void Foreground(nint window)
    {
        if (Live(Current))
            Current!.Foreground = window;
        if (Press?.Window != window)
            Press = null;
        if (Maximize?.Window != window)
        {
            Cancel(Maximize?.Gesture);
            Maximize = null;
        }
        if (Pending is { Route: "win-shift-left" or "win-shift-right" } && Pending.Window != window)
        {
            Cancel(Pending.Gesture);
            Pending = null;
        }
        if (Drags.Keys.Any(target => target != window))
        {
            Cancel(Current);
            Drags.Clear();
            Release = null;
        }
    }

    internal void RetireUnreferenced(bool retainedByPolicy = false)
    {
        if (
            !retainedByPolicy
            && Live(Current)
            && Pending?.Gesture != Current
            && Press?.Gesture != Current
            && Maximize?.Gesture != Current
            && !Drags.Values.Any(drag => drag.Gesture == Current)
        )
            Cancel(Current);
    }

    internal void AbandonPress()
    {
        var press = Press;
        Press = null;
        if (
            press is not null
            && Pending?.Gesture != press.Gesture
            && !Drags.Values.Any(drag => drag.Gesture == press.Gesture)
        )
            Cancel(press.Gesture);
    }

    internal void MoveStarted(nint window, long now, bool probe)
    {
        Release = null;
        Moving.Add(window);
        Maximize = null;
        if (Press is { } press && press.Window == window && now - press.At is >= 0 and <= 1000)
            Drags[window] = press with
            {
                Origin = "mouse",
                Route = "caption-drag",
                At = now - press.At,
                Probe = probe ? new() : null,
            };
        Press = null;
        // Compatibility flag suppresses derived state candidates during a move, not
        // the physical drag itself. Keep it separate from shared input facts.
        if (Pending?.Window == window)
            Pending = Pending with { Conflicted = true };
    }

    internal void Clear()
    {
        Cancel(Current);
        Pending = Press = Maximize = null;
        Drags.Clear();
        Release = null;
    }

    // Detach policy references without changing the saved terminal facts.
    internal void Forget(nint window, bool preserveGesture = false)
    {
        if (!preserveGesture && Current?.Window == window)
            Cancel(Current);
        if (Press?.Window == window)
            Press = null;
        if (Maximize?.Window == window)
            Maximize = null;
        Moving.Remove(window);
        Drags.Remove(window);
        if (Pending?.Window == window)
            Pending = null;
    }

    internal readonly HashSet<nint> Moving = new();
    internal readonly Dictionary<nint, Input> Drags = new();
    internal (MonitorBounds Monitor, MonitorBounds Work, Point Point)? Release;
    internal Input? Pending;
    internal Input? Press;
    internal Input? Maximize;
}
