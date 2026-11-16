internal abstract record SwitchFactsEvent(int Generation, nint Target, long At)
    : ObservedEvent(ObservedKind.SwitchFacts, Generation, Target, At);

internal sealed record SwitchNeutralEvent(int Generation, long At, bool Neutral)
    : SwitchFactsEvent(Generation, 0, At);

internal sealed record SwitchKeyEvent(
    int Generation,
    long At,
    uint Key,
    bool Down,
    bool Injected,
    SwitchWindow? Foreground
) : SwitchFactsEvent(Generation, Foreground?.Handle ?? 0, At);

internal sealed record SwitchMouseEvent(
    int Generation,
    long At,
    nint Message,
    SwitchWindow? Hit,
    SwitchWindow? Foreground,
    bool Injected,
    bool Modified
) : SwitchFactsEvent(Generation, Hit?.Handle ?? 0, At);

internal sealed record SwitchForegroundEvent(
    int Generation,
    long At,
    nint Target,
    nint CurrentWindow,
    SwitchWindow? Current,
    uint InputTick,
    uint EventTick,
    bool KnownSwitcher = false,
    bool KnownStaging = false
) : SwitchFactsEvent(Generation, Target, At)
{
    internal SwitchWindow? EligibleTarget()
    {
        if (Target != CurrentWindow)
            return null;
        if (unchecked((int)(EventTick - InputTick)) < 0)
            return null;
        return Current;
    }
}

internal sealed record SwitchPollEvent(
    int Generation,
    long At,
    SwitchWindow? Current,
    MonitorBounds? Monitor
) : SwitchFactsEvent(Generation, Current?.Handle ?? 0, At);
