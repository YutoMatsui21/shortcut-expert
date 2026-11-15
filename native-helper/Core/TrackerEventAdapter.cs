// Shared input collection stays in CandidateTracker / KeyGestureSeries / GestureManager.
// Migrated verdicts go through independent predicates and Composer; retained operations use the legacy outlet.
internal sealed class TrackerEventAdapter(
    CandidateTracker tracker,
    CandidateSink sink,
    Action<nint, WindowState>? remember = null,
    IndependentOperationAdapter? independent = null
)
{
    internal void Register(DetectionRouter router)
    {
        tracker.IndependentResults = independent is not null;
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
                independent?.Observe(e);
            }
        );
        router.Subscribe(
            new[] { ObservedKind.KeyPress, ObservedKind.KeyRelease, ObservedKind.KeyResult },
            (e, _) => Key(e)
        );
        router.Subscribe(
            new[] { ObservedKind.Foreground, ObservedKind.MoveStart, ObservedKind.Destroy },
            (e, _) =>
            {
                Lifecycle(e);
                independent?.Observe(e);
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
                tracker.Mouse(
                    e.Target,
                    e.Before,
                    e.Hit,
                    e.Point,
                    e.At,
                    e.DoubleClickTime,
                    e.Flags,
                    e.Modified,
                    e.Foreground
                );
                break;
        }
    }

    private void Key(ObservedEvent observed)
    {
        switch (observed)
        {
            case KeyPressEvent e:
                tracker.Key(
                    e.Target,
                    e.Before,
                    e.Key,
                    e.Win,
                    e.Modified,
                    e.At,
                    e.Flags,
                    e.Shift,
                    e.Alt
                );
                independent?.Observe(e);
                break;
            case KeyReleaseEvent e:
                tracker.KeyReleased(e.Key, e.At);
                break;
            case KeyResultEvent e:
                if (independent?.State(new(e.Target, e.After, e.At, e.Target, e.Injected)) == true)
                    break;
                Emit(
                    tracker.FinishKey(e.Target, e.After, e.At, e.Injected, e.Date),
                    e.Generation,
                    e.Date
                );
                break;
        }
    }

    private void Lifecycle(ObservedEvent e)
    {
        switch (e.Kind)
        {
            case ObservedKind.Foreground:
                tracker.ForegroundChanged(e.Target);
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
                independent?.State(new(e.Target, e.After, e.At, e.Foreground));
                if (
                    tracker.Complete(
                        e.Target,
                        e.Before,
                        e.After,
                        e.At,
                        e.Foreground,
                        e.Date,
                        e.Monitor
                    )
                    is WindowCandidate candidate
                )
                    Emit(candidate, e.Generation, e.Date);
                break;
            case MoveEndEvent e:
                if (independent?.Finish(e) == true)
                {
                    tracker.MoveEnd(e.Target);
                    Remember(e.Target, e.After);
                    break;
                }
                var move = tracker.FinishMove(e.Target, e.After, e.At, e.Foreground, e.Date);
                Remember(e.Target, e.After);
                Emit(move, e.Generation, e.Date);
                break;
            case TickEvent e:
                independent?.State(new(e.Target, e.After, e.At, e.Foreground));
                var maximized = tracker.ConfirmMaximize(
                    e.Target,
                    e.After,
                    e.At,
                    e.Foreground,
                    e.Date
                );
                Remember(e.Target, e.After);
                if (maximized is not null)
                    sink.Complete(maximized);
                break;
        }
    }

    private void Remember(nint target, WindowState? after)
    {
        if (after is not null)
            remember?.Invoke(target, after);
    }

    private void Emit(object? result, int generation, string date)
    {
        if (
            independent is not null
            && (
                result is WindowCandidate { operation: "maximize" or "monitor-move" }
                || result is PlacementResult p && !p.Evidence.shape.EndsWith("-half")
                || result is CompoundMoveResult
            )
        )
            return;
        switch (result)
        {
            case WindowCandidate candidate:
                sink.Complete(candidate);
                break;
            case PlacementResult placement:
                sink.Placement(generation, date, placement);
                break;
            case CompoundMoveResult compound:
                sink.Compound(generation, date, compound);
                break;
        }
    }
}
