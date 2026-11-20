namespace ShortcutExpert.Detection;

internal sealed record OperationObservation(
    nint Target,
    WindowState? After,
    long At,
    nint Foreground,
    bool Injected = false,
    bool Polled = false
);
