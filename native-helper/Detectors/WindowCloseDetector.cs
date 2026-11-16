// Operation-local pending/deadline policy. No Switch/Tracker/Taskbar state is consulted.
internal sealed class WindowCloseDetector(
    DetectionSession session,
    GestureManager gestures,
    CandidateSink sink,
    Func<long> now,
    Func<string>? date = null,
    Action<CloseReason>? diagnostic = null
)
{
    private WindowClosePolicy policy = new();
    private GestureManager.Input? input;
    private ResultComposer.Pending? pending;
    private int generation;
    internal CloseWindow? Target => policy.Target;
    internal bool Ready => policy.Ready;
    internal bool DestroyPending => policy.DestroyPending;

    internal void Start(int epoch)
    {
        Stop();
        generation = epoch;
        gestures.Reset(epoch);
    }

    internal void Stop()
    {
        Cancel();
        generation = 0;
        policy = new();
        gestures.Reset(0);
    }

    internal void Cancel()
    {
        policy.Cancel();
        pending?.Cancel();
        gestures.Cancel(input?.Gesture);
        pending = null;
        input = null;
        gestures.Reset(generation);
    }

    internal void Neutral(bool neutral) => policy.Neutral(neutral);

    internal void Mouse(
        nint message,
        CloseWindow? hit,
        bool button,
        bool foreground,
        bool injected,
        bool modifiers,
        uint tick,
        long at
    )
    {
        if (generation == 0)
            return;
        if (input is null && message != 0x200)
            gestures.Reset(generation);
        policy.Mouse(message, hit, button, foreground, injected, modifiers, tick, at);
        Synchronize("mouse", at);
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
        if (generation == 0)
            return;
        if (input is null && down)
            gestures.Reset(generation);
        policy.Key(key, down, injected, foreground, tick, at);
        Synchronize("key", at);
    }

    private void Synchronize(string origin, long at)
    {
        if (policy.Target is not { } target)
        {
            RetireCancelledInput();
            return;
        }
        if (input is null)
            Begin(target, origin, at);
        else
            ObserveRelease();
    }

    private void RetireCancelledInput()
    {
        if (input is not null)
            Cancel();
    }

    private void ObserveRelease()
    {
        if (input is { } current && policy.ReleasedAt is { } released)
            gestures.AwaitResult(current.Gesture, released);
    }

    private void Begin(CloseWindow target, string origin, long at)
    {
        // Close needs identity only: no live post-destruction state is fabricated or serialized.
        var identity = new WindowState(target.Process, "", 0, null, target.Monitor);
        input = gestures.Begin(
            target.Handle,
            identity,
            origin,
            origin == "mouse" ? "close-button" : "alt-f4",
            at,
            false,
            false,
            true,
            session.Allocator(generation)()
        );
        if (policy.ReleasedAt is { } accepted)
            gestures.AwaitResult(input.Gesture, accepted);
        var composer = new ResultComposer(session, gestures, sink, now);
        pending = composer.Begin(
            new(
                input,
                "",
                at + 1000,
                () => true,
                date ?? (() => DateTime.Now.ToString("yyyy-MM-dd"))
            ),
            new[] { new ResultComposer.Subscription("close", at + 1000) }
        );
    }

    internal void Foreground(nint window, bool ownedDialog, bool enabled)
    {
        policy.Foreground(window, ownedDialog, enabled);
        if (policy.Target is null && input is not null)
            Cancel();
    }

    internal void Lifecycle(uint kind, nint window, uint tick)
    {
        policy.Lifecycle(kind, window, tick);
        if (policy.Target is null && input is not null)
            Cancel();
    }

    internal void Destroy(
        nint window,
        uint thread,
        uint tick,
        bool exists,
        long at,
        Action<CloseReason>? diagnostic = null
    )
    {
        Complete(policy.Destroy(window, thread, tick, exists, at, diagnostic), at);
    }

    internal void Poll(bool exists, bool sameIdentity, long at)
    {
        if (policy.DestroyPending)
        {
            var before = input;
            var completed = policy.ConfirmGone(exists, sameIdentity, at);
            Complete(completed, at);
            if (before is not null && policy.Target is null && completed is null)
                diagnostic?.Invoke(CloseReason.PollCancel);
        }
        else
        {
            policy.Poll(!exists || sameIdentity, at);
            if (policy.Target is null && input is not null)
            {
                diagnostic?.Invoke(CloseReason.PollCancel);
                Cancel();
            }
        }
    }

    private void Complete(CloseCompletion? completed, long at)
    {
        if (completed is null)
        {
            if (policy.Target is null && input is not null)
                Cancel();
            return;
        }
        if (input is null || pending is null)
            return;
        // The retained policy proves mouse release or the Alt+F4 chord, and DESTROY + gone.
        if (!gestures.Complete(input.Gesture, input.Window, input.Before, at))
        {
            Cancel();
            return;
        }
        bool confirmed = pending.Confirm(
            "close",
            new(generation, input.Window, input.Before.Process, input.Gesture.Source),
            input.Gesture,
            new IndependentCloseProof(
                completed.Origin == "mouse"
                    ? IndependentCloseRoute.CloseButton
                    : IndependentCloseRoute.AltF4,
                true,
                completed.Age,
                completed.Monitor
            )
        );
        if (pending.Seal() && confirmed)
            diagnostic?.Invoke(CloseReason.Completed);
        pending = null;
        input = null;
    }
}
