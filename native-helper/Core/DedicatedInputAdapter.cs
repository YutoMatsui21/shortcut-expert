// Preserve W12 -> W01 input ordering. Each OS adapter keeps its own target reads,
// timers and UIA worker; independent detectors own admission and source exclusion. No arbitration lives in the router.
internal sealed class DedicatedInputAdapter(
    TaskbarInputObserver taskbar,
    WindowSwitchObserver switching
)
{
    internal void Register(DetectionRouter router) =>
        router.Subscribe(
            new[] { ObservedKind.RawMouse, ObservedKind.RawKey },
            (observed, delivery) =>
            {
                switch (observed)
                {
                    case RawMouseEvent e:
                        taskbar.Mouse(e.Message, e.Point, e.Flags);
                        switching.Mouse(e.Message, e.Point, e.Flags, e.InputTime);
                        break;
                    case RawKeyEvent e:
                        taskbar.Key(e.Key, e.Down, e.Flags);
                        switching.Key(e.Key, e.Down, e.Flags, e.InputTime);
                        break;
                }
            }
        );
}
