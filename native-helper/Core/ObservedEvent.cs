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
    MinimizeStart,
    MoveStart,
    MoveEnd,
    Destroy,
    Tick,
    State,
    CaptionPress,
    CaptionResult,
    SwitchFacts,
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
    bool Alt = false,
    uint? NativeTick = null
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

internal sealed record CaptionPressEvent(int Generation, CaptionPressFacts Facts, string Date)
    : ObservedEvent(ObservedKind.CaptionPress, Generation, Facts.Target, Facts.At);

internal sealed record CaptionResultEvent(int Generation, CaptionCompletionFacts Facts)
    : ObservedEvent(ObservedKind.CaptionResult, Generation, Facts.Press.Target, Facts.At);

namespace ShortcutExpert.Detection
{
    internal sealed record ForegroundObservedEvent(
        int Generation,
        nint Target,
        long At,
        uint NativeTick
    ) : ObservedEvent(ObservedKind.Foreground, Generation, Target, At);

    internal sealed record MinimizeStartedEvent(
        int Generation,
        nint Target,
        long At,
        uint Process,
        uint NativeTick
    ) : ObservedEvent(ObservedKind.MinimizeStart, Generation, Target, At);
}
