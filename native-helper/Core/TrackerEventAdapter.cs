// Compatibility translation only. Admission, cancellation, deadlines and operation results
// stay in CandidateTracker / PlacementPolicy / GestureManager; emission stays in CandidateSink.
internal sealed class TrackerEventAdapter(
    CandidateTracker tracker,
    CandidateSink sink,
    Action<nint, WindowState>? remember = null
)
{
    internal void Register(DetectionRouter router) =>
        router.Subscribe(
            Enum.GetValues<ObservedKind>()
                .Except(new[] { ObservedKind.RawMouse, ObservedKind.RawKey }),
            Handle
        );

    private void Handle(ObservedEvent observed, DetectionRouter.Delivery delivery)
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
            case KeyResultEvent e:
                var keyResult = tracker.FinishKey(e.Target, e.After, e.At, e.Injected, e.Date);
                if (keyResult is PlacementResult placed)
                    sink.Placement(e.Generation, e.Date, placed);
                if (keyResult is WindowCandidate window)
                    sink.Complete(window);
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
                break;
            case KeyReleaseEvent e:
                tracker.KeyReleased(e.Key, e.At);
                break;
            case StateObservedEvent e:
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
                    sink.Complete(candidate);
                break;
            case MoveEndEvent e:
                var result = tracker.FinishMove(e.Target, e.After, e.At, e.Foreground, e.Date);
                if (e.After is not null)
                    remember?.Invoke(e.Target, e.After);
                switch (result)
                {
                    case WindowCandidate moved:
                        sink.Complete(moved);
                        break;
                    case PlacementResult placement:
                        sink.Placement(e.Generation, e.Date, placement);
                        break;
                    case CompoundMoveResult compound:
                        sink.Compound(e.Generation, e.Date, compound);
                        break;
                }
                break;
            case TickEvent e:
                var maximized = tracker.ConfirmMaximize(
                    e.Target,
                    e.After,
                    e.At,
                    e.Foreground,
                    e.Date
                );
                if (e.After is not null)
                    remember?.Invoke(e.Target, e.After);
                if (maximized is not null)
                    sink.Complete(maximized);
                break;
            default:
                switch (observed.Kind)
                {
                    case ObservedKind.Foreground:
                        tracker.ForegroundChanged(observed.Target);
                        break;
                    case ObservedKind.MoveStart:
                        tracker.MoveStart(observed.Target, observed.At);
                        break;
                    case ObservedKind.Destroy:
                        tracker.Forget(observed.Target);
                        break;
                }
                break;
        }
    }
}
