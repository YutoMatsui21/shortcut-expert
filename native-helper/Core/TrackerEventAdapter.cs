using ShortcutExpert.Detection;

internal sealed class TrackerEventAdapter(
    CandidateTracker tracker,
    IndependentOperationAdapter operations,
    Action<nint, WindowState>? remember = null
)
{
    internal void Register(DetectionRouter router)
    {
        router.Subscribe(
            new[]
            {
                ObservedKind.MouseMessage,
                ObservedKind.MouseMove,
                ObservedKind.MouseRelease,
                ObservedKind.MousePress,
            },
            (e, _) =>
            {
                Mouse(e);
                operations.Observe(e);
            }
        );
        router.Subscribe(
            new[] { ObservedKind.KeyPress, ObservedKind.KeyRelease, ObservedKind.KeyResult },
            (e, _) => Key(e)
        );
        router.Subscribe(
            new[]
            {
                ObservedKind.Foreground,
                ObservedKind.MinimizeStart,
                ObservedKind.MoveStart,
                ObservedKind.Destroy,
            },
            (e, _) =>
            {
                Lifecycle(e);
                operations.Observe(e);
            }
        );
        router.Subscribe(
            new[] { ObservedKind.State, ObservedKind.MoveEnd, ObservedKind.Tick },
            (e, _) => Result(e)
        );
    }

    private void Mouse(ObservedEvent observed)
    {
        switch (observed)
        {
            case MouseMessageEvent e:
                tracker.MouseMessage(e.Message);
                break;
            case MouseMoveEvent e:
                tracker.MouseMoved(e.Point, e.Flags);
                break;
            case MouseReleaseEvent e:
                tracker.MouseReleased(
                    e.Point,
                    e.Monitor,
                    e.Work,
                    e.Flags,
                    e.PhysicalBefore,
                    e.PhysicalAfter,
                    e.At
                );
                break;
            case MousePressEvent e:
                tracker.Mouse(e);
                break;
        }
    }

    private void Key(ObservedEvent observed)
    {
        switch (observed)
        {
            case KeyPressEvent e:
                tracker.Key(e);
                operations.Observe(e);
                break;
            case KeyReleaseEvent e:
                tracker.KeyReleased(e.Key, e.At);
                break;
            case KeyResultEvent e:
                operations.KeyResult(e);
                break;
        }
    }

    private void Lifecycle(ObservedEvent e)
    {
        switch (e.Kind)
        {
            case ObservedKind.Foreground:
                tracker.ForegroundChanged(e.Target, (e as ForegroundObservedEvent)?.NativeTick);
                break;
            case ObservedKind.MinimizeStart:
                tracker.MinimizeStarted((MinimizeStartedEvent)e);
                break;
            case ObservedKind.MoveStart:
                tracker.MoveStart(e.Target, e.At);
                break;
            case ObservedKind.Destroy:
                tracker.Forget(e.Target);
                break;
        }
    }

    private void Result(ObservedEvent observed)
    {
        switch (observed)
        {
            case StateObservedEvent e:
                StateResult(e);
                break;
            case MoveEndEvent e:
                operations.Finish(e);
                tracker.MoveEnd(e.Target);
                Remember(e.Target, e.After);
                break;
            case TickEvent e:
                operations.TryState(new(e.Target, e.After, e.At, e.Foreground));
                Remember(e.Target, e.After);
                break;
        }
    }

    private void StateResult(StateObservedEvent observed)
    {
        if (
            operations.TryState(
                new(observed.Target, observed.After, observed.At, observed.Foreground)
            )
        )
            return;
        if (observed.Before is not { } previous)
            return;
        if (previous.Process != observed.After.Process)
            tracker.Forget(observed.Target);
    }

    private void Remember(nint target, WindowState? after)
    {
        if (after is not null)
            remember?.Invoke(target, after);
    }
}
