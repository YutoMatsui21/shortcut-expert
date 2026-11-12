using Point = NativeMethods.Point;

internal enum ObservedKind
{
    RawMouse,
    RawKey,
    MouseMessage,
    MouseMove,
    MouseRelease,
    MousePress,
    KeyPress,
    KeyRelease,
    KeyResult,
    Foreground,
    MoveStart,
    MoveEnd,
    Destroy,
    Tick,
    State,
}

// Local snapshots at the original observation point; never serialized or retained as history.
internal record ObservedEvent(ObservedKind Kind, int Generation, nint Target, long At);

internal sealed record MousePressEvent(
    int Generation,
    nint Target,
    long At,
    WindowState Before,
    int Hit,
    Point Point,
    uint DoubleClickTime,
    uint Flags,
    bool Modified,
    bool Foreground
) : ObservedEvent(ObservedKind.MousePress, Generation, Target, At);

internal sealed record KeyPressEvent(
    int Generation,
    nint Target,
    long At,
    WindowState? Before,
    uint Key,
    bool Win,
    bool Modified,
    uint Flags,
    bool Shift = false,
    bool Alt = false
) : ObservedEvent(ObservedKind.KeyPress, Generation, Target, At);

internal sealed record KeyReleaseEvent(int Generation, long At, uint Key)
    : ObservedEvent(ObservedKind.KeyRelease, Generation, 0, At);

internal sealed record StateObservedEvent(
    int Generation,
    nint Target,
    long At,
    WindowState? Before,
    WindowState After,
    nint Foreground,
    string Date,
    MonitorBounds? Monitor
) : ObservedEvent(ObservedKind.State, Generation, Target, At);

internal sealed record MoveEndEvent(
    int Generation,
    nint Target,
    long At,
    WindowState? After,
    nint Foreground,
    string Date
) : ObservedEvent(ObservedKind.MoveEnd, Generation, Target, At);

internal sealed record TickEvent(
    int Generation,
    nint Target,
    long At,
    WindowState? After,
    nint Foreground,
    string Date
) : ObservedEvent(ObservedKind.Tick, Generation, Target, At);

internal sealed record MouseMessageEvent(int Generation, long At, nint Message)
    : ObservedEvent(ObservedKind.MouseMessage, Generation, 0, At);

internal sealed record MouseMoveEvent(int Generation, long At, Point Point, uint Flags)
    : ObservedEvent(ObservedKind.MouseMove, Generation, 0, At);

internal sealed record MouseReleaseEvent(
    int Generation,
    long At,
    Point Point,
    MonitorBounds? Monitor,
    MonitorBounds? Work,
    uint Flags,
    Point? PhysicalBefore,
    Point? PhysicalAfter
) : ObservedEvent(ObservedKind.MouseRelease, Generation, 0, At);

internal sealed record KeyResultEvent(
    int Generation,
    nint Target,
    long At,
    WindowState? After,
    bool Injected,
    string Date
) : ObservedEvent(ObservedKind.KeyResult, Generation, Target, At);

internal sealed record RawMouseEvent(
    int Generation,
    long At,
    nint Message,
    Point Point,
    uint Flags,
    uint InputTime
) : ObservedEvent(ObservedKind.RawMouse, Generation, 0, At);

internal sealed record RawKeyEvent(
    int Generation,
    long At,
    uint Key,
    bool Down,
    uint Flags,
    uint InputTime
) : ObservedEvent(ObservedKind.RawKey, Generation, 0, At);
