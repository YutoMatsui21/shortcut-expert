using static NativeMethods;

// Identity and native ticks live only for the bounded input transaction; never serialized.
internal sealed record CloseWindow(nint Handle, uint Process, uint Thread, MonitorBounds? Monitor);

internal sealed record CloseCompletion(string Origin, long Age, MonitorBounds? Monitor);

internal enum CloseReason
{
    MouseDown,
    MouseUp,
    KeyF4,
    TargetEligible,
    TargetAbsent,
    TargetStyle,
    TargetCloaked,
    TargetClass,
    TargetProcess,
    CloseRectangle,
    NotReady,
    PendingMouse,
    PendingKey,
    ReleasedMouse,
    ForegroundCancel,
    PollCancel,
    DestroyTarget,
    DestroyAlive,
    DestroyThread,
    DestroyTick,
    DestroyAge,
    DestroyUnreleased,
    HideObserved,
    RecreatedCancel,
    ForegroundDeparture,
    Completed,
    Exception,
    GeometryValid,
    GeometryFallback,
    GeometryInvalid,
    GeometryDisabled,
    GeometryOutside,
    GeometryReadFailed,
    RootHitConfirmed,
    RootHitRejected,
}

internal sealed class WindowClosePolicy
{
    private readonly HashSet<uint> held = new();
    private bool ready,
        released,
        mouse,
        destroying;
    private CloseWindow? target;
    private uint inputTick;
    private long started;
    internal CloseWindow? Target => target;
    internal bool Ready => ready;
    internal bool DestroyPending => destroying;

    internal void Neutral(bool neutral)
    {
        if (neutral && target is null)
        {
            ready = true;
            held.Clear();
        }
    }

    internal void Cancel()
    {
        target = null;
        ready = false;
        released = destroying = false;
    }

    private void Begin(CloseWindow window, bool isMouse, uint tick, long at)
    {
        target = window;
        mouse = isMouse;
        released = !isMouse;
        inputTick = tick;
        started = at;
    }

    internal void Key(
        uint key,
        bool down,
        bool injected,
        CloseWindow? foreground,
        uint tick,
        long at
    )
    {
        bool repeat = down && !held.Add(key);
        if (!down)
            held.Remove(key);
        if (!ready || injected)
        {
            Cancel();
            return;
        }
        bool alt = key is VK_MENU or VK_LMENU or VK_RMENU;
        if (!down && !mouse && target is not null && (alt || key == VK_F4))
            return;
        if (repeat && key == VK_F4 && target is not null && !mouse)
            return;
        if (alt && down && target is null && held.Count == 1)
            return;
        if (
            key == VK_F4
            && down
            && !repeat
            && target is null
            && foreground is not null
            && held.Count == 2
            && held.Any(k => k is VK_MENU or VK_LMENU or VK_RMENU)
        )
        {
            Begin(foreground, false, tick, at);
            return;
        }
        Cancel();
    }

    internal void Mouse(
        nint message,
        CloseWindow? hit,
        bool closeButton,
        bool foreground,
        bool injected,
        bool modifiers,
        uint tick,
        long at
    )
    {
        if (message == 0x200 && !injected)
            return;
        if (!ready || injected || modifiers || held.Count != 0)
        {
            Cancel();
            return;
        }
        if (
            message == WM_LBUTTONDOWN
            && target is null
            && hit is not null
            && closeButton
            && foreground
        )
        {
            Begin(hit, true, tick, at);
            return;
        }
        if (
            message == WM_LBUTTONUP
            && target is not null
            && mouse
            && !released
            && hit == target
            && closeButton
            && foreground
            && at - started is >= 0 and <= 1000
        )
        {
            released = true;
            return;
        }
        Cancel();
    }

    internal void Poll(bool identityUnchanged, long at)
    {
        if (target is not null && (!identityUnchanged || at - started is < 0 or > 1000))
            Cancel();
    }

    internal void Foreground(nint window, bool ownedDialog, bool targetEnabled)
    {
        // A normal close can activate B before A's DESTROY. Only a verified modal/disabled
        // target cancels here; independent input, hide, identity change and deadline still cancel.
        if (target is not null && window != target.Handle && (ownedDialog || !targetEnabled))
            Cancel();
    }

    internal void Lifecycle(uint kind, nint window, uint tick)
    {
        if (target is null || target.Handle != window || unchecked((int)(tick - inputTick)) < 0)
            return;
        // HIDE also precedes a normal close in observed Windows callbacks. It cannot
        // prove either cancellation or closure. Hide-only expires without any completion.
        if (kind == EVENT_OBJECT_CREATE)
            Cancel();
    }

    internal CloseCompletion? Destroy(
        nint window,
        uint thread,
        uint tick,
        bool windowExists,
        long at,
        Action<CloseReason>? diagnostic = null
    )
    {
        if (target is null || target.Handle != window)
            return null;
        diagnostic?.Invoke(CloseReason.DestroyTarget);
        if (windowExists)
            diagnostic?.Invoke(CloseReason.DestroyAlive);
        if (thread != target.Thread)
            diagnostic?.Invoke(CloseReason.DestroyThread);
        if (unchecked((int)(tick - inputTick)) < 0 || unchecked((uint)(tick - inputTick)) > 1000)
            diagnostic?.Invoke(CloseReason.DestroyTick);
        if (at - started is < 0 or > 1000)
            diagnostic?.Invoke(CloseReason.DestroyAge);
        if (!released)
            diagnostic?.Invoke(CloseReason.DestroyUnreleased);
        bool confirmed =
            released
            && thread == target.Thread
            && unchecked((int)(tick - inputTick)) >= 0
            && unchecked((uint)(tick - inputTick)) <= 1000
            && at - started is >= 0 and <= 1000;
        if (!confirmed)
        {
            Cancel();
            return null;
        }
        destroying = true;
        return ConfirmGone(windowExists, true, at);
    }

    internal CloseCompletion? ConfirmGone(bool windowExists, bool sameIdentity, long at)
    {
        if (target is null || !destroying)
            return null;
        if (at - started is < 0 or > 1000 || windowExists && !sameIdentity)
        {
            Cancel();
            return null;
        }
        if (windowExists)
            return null;
        var before = target;
        Cancel();
        return new(mouse ? "mouse" : "key", at - started, before.Monitor);
    }
}
