// Preserve W12 -> W01 -> W11 input ordering. Each observer keeps its own target reads,
// timers, UIA worker, admission and W01/W12 exclusion. No arbitration lives in the router.
internal sealed class DedicatedInputAdapter(
    TaskbarInputObserver taskbar,
    WindowSwitchObserver switching,
    WindowCloseObserver closing
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
                        closing.Mouse(e.Message, e.Point, e.Flags, e.InputTime);
                        break;
                    case RawKeyEvent e:
                        taskbar.Key(e.Key, e.Down, e.Flags);
                        switching.Key(e.Key, e.Down, e.Flags, e.InputTime);
                        closing.Key(e.Key, e.Down, e.Flags, e.InputTime);
                        break;
                }
            }
        );
}
