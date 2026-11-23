using ShortcutExpert.Detection;
using static NativeMethods;
using Point = NativeMethods.Point;

internal sealed record MonitorBounds(int x, int y, int width, int height);

internal sealed record WindowState(
    uint Process,
    string App,
    uint Show,
    bool? Arranged,
    MonitorBounds? Monitor = null,
    bool HorizontalPair = false,
    string? DisplayLayout = null,
    MonitorBounds? Frame = null,
    MonitorBounds? Work = null,
    uint Dpi = 0,
    bool TwoDisplayPair = false,
    int? MouseDockThresholdPx = null
)
{
    // Retain caption metadata for keyboard moves and placement; never sent on the wire.
    internal bool HasCaption { get; init; } = true;
}

// Only verified terminal evidence crosses the protocol; HWND/process stay in the tracker.
// Collects input facts and owns their lifetime on the message-loop thread.
internal sealed partial class CandidateTracker
{
    private bool UsesLegacyBaseline
    {
        get
        {
            bool legacy = false;
            ReadBaselineMode(ref legacy);
            return legacy;
        }
    }

    // Implemented only by the frozen #172 policy fixtures.
    partial void ReadBaselineMode(ref bool legacy);

    partial void ResetBaseline(int nextGeneration);

    partial void BaselineForeground(nint window);

    partial void BaselineForget(nint window);

    partial void BaselineModifier(uint key, bool injected);

    partial void BaselineKey(nint window, string? route);

    partial void ClearBaselineReduction();

    internal GestureManager Gestures => gestures;
    private readonly GestureManager gestures = new();

    private const long InputMatchWindowMs = 1000;
    private const int ClickMovementPx = 4;
    private Point clickPoint;
    private bool clickReleased;
    internal nint? MouseStateTarget =>
        gestures.Pending is { Route: "unknown" } ? gestures.Pending.Window : null;

    internal void CancelMouseState()
    {
        if (MouseStateTarget is not null)
        {
            gestures.Pending = null;
            gestures.RetireUnreferenced();
        }
    }

    internal void MouseMessage(nint message)
    {
        if (message is not (0x200 or WM_LBUTTONDOWN or WM_LBUTTONUP))
        {
            CancelMouseState();
            gestures.AbandonPress();
        }
    }

    private const int CaptionDoubleClickDistancePx = 4;
    private const long NoCaptionClickAt = -10000;

    private bool upHeld;
    private readonly HashSet<uint> injectedWin = new();

    private bool moveKeyReleased;
    private bool winDownHeld;
    private nint lastCaption;
    private uint lastCaptionProcess;
    private long lastCaptionAt = NoCaptionClickAt;
    private Point lastCaptionPoint;
    private readonly DetectionSession session;
    private readonly bool ownsSession;
    private Func<int> allocate = () => 0;

    internal CandidateTracker(DetectionSession? session = null)
    {
        Placement = new(gestures);
        ownsSession = session is null;
        this.session = session ?? new DetectionSession();
    }

    internal KeyGestureSeries Placement { get; }
    internal long InputEpoch { get; private set; }
    private (GestureManager.Gesture Gesture, nint Foreground, long Epoch)? reductionDeparture;
    private (GestureManager.Gesture Gesture, uint Tick)? reductionPress;
    private (GestureManager.Gesture Gesture, uint Tick)? reductionMinimizeStart;
    internal bool MoveKeyReleased => moveKeyReleased;
    internal bool ClickReleased => clickReleased;
    internal Action<WindowDiagnosticReason>? Diagnostic { get; set; }
    internal bool HasDrag => gestures.Drags.Count == 1;

    internal void MouseMoved(Point point, uint flags)
    {
        bool injected = IsInjectedMouse(flags);
        if (injected && HasActiveMouseGesture())
        {
            ClearInput();
            return;
        }
        foreach (var drag in gestures.Drags.Values)
            drag.Probe?.Sample(point, flags);
        if (MouseStateTarget is not null && (injected || MovedBeforeClickRelease(point)))
            CancelMouseState();
    }

    private bool HasActiveMouseGesture() => gestures.Press is not null || HasDrag;

    private bool MovedBeforeClickRelease(Point point)
    {
        if (clickReleased)
            return false;
        return Math.Abs((long)point.X - clickPoint.X) > ClickMovementPx
            || Math.Abs((long)point.Y - clickPoint.Y) > ClickMovementPx;
    }

    private static bool IsInjectedMouse(uint flags) =>
        (flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED)) != 0;

    internal int NextTransaction() => allocate();

    internal void DiscardKeyResult(OperationObservation result)
    {
        if (result.Injected)
        {
            gestures.Maximize = null;
            gestures.RetireUnreferenced(Placement.Owns(result.Target));
        }
        if (HasReleasedMonitorInput(result.Target))
        {
            if (result.Injected || result.After is null)
                ClearInput();
            return;
        }
        if (!Placement.WinHeld)
            Placement.Retire(result);
    }

    private bool HasReleasedMonitorInput(nint target) =>
        moveKeyReleased
        && gestures.Pending is { Route: "win-shift-left" or "win-shift-right" } move
        && move.Window == target;

    internal void KeyReleased(uint key, long? now = null)
    {
        ReleaseReductionKey(new(key, now));
        Placement.Released(key, now);
        if (!Placement.WinHeld && gestures.Current?.Source == "key")
            gestures.AwaitResult(gestures.Current, now);
        injectedWin.Remove(key);
        if (key == VK_UP)
            upHeld = false;
        if (key == VK_DOWN)
            winDownHeld = false;
        ReleaseMonitorKey(key, now);
    }

    internal void MinimizeStarted(MinimizeStartedEvent observed)
    {
        if (reductionPress is not { } press || !MatchesReductionTarget(press.Gesture, observed))
            return;
        uint age = unchecked(observed.NativeTick - press.Tick);
        if (age is > 0 and <= (uint)InputMatchWindowMs)
            reductionMinimizeStart ??= (press.Gesture, observed.NativeTick);
    }

    private bool MatchesReductionTarget(
        GestureManager.Gesture gesture,
        MinimizeStartedEvent observed
    ) =>
        gestures.Pending is { } input
        && input.Gesture == gesture
        && input.Window == observed.Target
        && input.Before.Process == observed.Process;

    internal void ForegroundChanged(nint window, ForegroundObservedEvent? observed = null)
    {
        reductionDeparture = null;
        if (gestures.Current?.Window != window)
        {
            InputEpoch++;
            if (IsMinimizeDeparture(window, observed))
                reductionDeparture = (gestures.Pending!.Gesture, window, InputEpoch);
        }
        Placement.Foreground(window);
        if (gestures.Drags.Keys.Any(target => target != window))
            Diagnostic?.Invoke(WindowDiagnosticReason.DragForegroundCancelled);
        gestures.Foreground(window);
        BaselineForeground(window);
    }

    internal (nint Window, uint Process)? MinimizeDepartureTarget(nint foreground) =>
        reductionMinimizeStart is { } start
        && gestures.Pending is { } input
        && input.Gesture == start.Gesture
        && input.Window != foreground
            ? (input.Window, input.Before.Process)
            : null;

    private bool IsMinimizeDeparture(nint window, ForegroundObservedEvent? observed) =>
        observed is { MinimizedWindow: { } minimized }
        && MinimizeDepartureTarget(window) == minimized
        && observed.NativeTick == reductionMinimizeStart!.Value.Tick;

    internal long? MinimizeInputEpoch(GestureManager.Gesture gesture, nint foreground)
    {
        if (foreground == gesture.Window)
            return InputEpoch;
        return reductionDeparture == (gesture, foreground, InputEpoch) ? InputEpoch - 1 : null;
    }

    internal void Reset(int newGeneration)
    {
        InputEpoch++;
        reductionDeparture = null;
        reductionPress = reductionMinimizeStart = null;
        ResetBaseline(newGeneration);
        if (ownsSession)
        {
            if (newGeneration > 0)
                session.Start(newGeneration);
            else
                session.Stop();
        }
        allocate = session.Allocator(newGeneration);
        gestures.Reset(newGeneration);
        ClearBaselineReduction();
        winDownHeld = false;
        lastCaption = 0;
        lastCaptionAt = NoCaptionClickAt;
        Placement.Reset();
        gestures.Maximize = null;
        upHeld = false;
        injectedWin.Clear();
    }

    internal void ClearInput()
    {
        InputEpoch++;
        reductionDeparture = null;
        reductionPress = reductionMinimizeStart = null;
        if (gestures.Drags.Count > 0)
            Diagnostic?.Invoke(WindowDiagnosticReason.DragInputCancelled);
        Placement.Cancel();
        gestures.Clear();
        ClearBaselineReduction();
    }

    internal void Forget(nint window, bool preserveGesture = false)
    {
        if (gestures.Current?.Window == window)
            InputEpoch++;
        Placement.Forget(window);
        gestures.Forget(window, preserveGesture);
        BaselineForget(window);
        if (lastCaption == window)
        {
            lastCaption = 0;
            lastCaptionAt = NoCaptionClickAt;
        }
    }

    internal void MoveStart(nint window, long now = 0)
    {
        gestures.MoveStarted(window, now, Diagnostic is not null);
        lastCaption = 0;
        lastCaptionAt = NoCaptionClickAt;
    }

    internal void MoveEnd(nint window) => Forget(window);

    internal void MouseReleased(
        Point point,
        MonitorBounds? monitor,
        MonitorBounds? work,
        uint flags,
        Point? physicalBefore = null,
        Point? physicalAfter = null,
        long? releasedAt = null
    )
    {
        if (IsInjectedMouse(flags))
        {
            ClearInput();
            return;
        }
        gestures.Press = null;
        MouseMoved(point, flags);
        clickReleased = true;
        if (gestures.Current?.Source == "caption")
            gestures.AwaitResult(gestures.Current, releasedAt);
        if (!HasDrag || monitor is null || work is null)
        {
            gestures.Release = null;
            return;
        }
        if (Diagnostic is { } diagnostic)
            gestures
                .Drags.Values.First()
                .Probe?.Record(point, monitor, work, physicalBefore, physicalAfter, diagnostic);
        gestures.Release = HasDrag ? (monitor, work, point) : null;
    }

    internal static bool IsModifier(uint key) =>
        key
            is VK_LWIN
                or VK_RWIN
                or VK_SHIFT
                or VK_CONTROL
                or VK_MENU
                or VK_LSHIFT
                or VK_RSHIFT
                or VK_LCONTROL
                or VK_RCONTROL
                or VK_LMENU
                or VK_RMENU;

    internal void Mouse(MousePressEvent input)
    {
        InputEpoch++;
        Placement.Cancel();
        gestures.Maximize = null;
        gestures.Drags.Clear();
        gestures.Release = null;
        ClearBaselineReduction();
        clickPoint = input.Point;
        clickReleased = false;
        string route = MouseRoute(input);
        bool canStartDrag = route is "unknown" or "caption-press";
        gestures.Pending = gestures.Begin(
            input.Target,
            input.Before,
            canStartDrag ? "unknown" : "mouse",
            route,
            input.At,
            IsInjectedMouse(input.Flags),
            input.Modified,
            input.Foreground,
            NextTransaction(),
            CaptionPress: route == "caption-press"
        );
        // Explicit resize borders and caption buttons remain outside window-move detection.
        gestures.Press =
            canStartDrag && input.Hit is not (>= 10 and <= 18) ? gestures.Pending : null;
    }

    private string MouseRoute(MousePressEvent input)
    {
        string route = input.Hit switch
        {
            HTMAXBUTTON => "max-button",
            HTMINBUTTON => "min-button",
            HTCLOSE => "close-button",
            HTCAPTION => IsCaptionDoubleClick(input) ? "caption-double-click" : "caption-press",
            _ => "unknown",
        };
        lastCaption = input.Hit == HTCAPTION ? input.Target : 0;
        lastCaptionProcess = input.Before.Process;
        lastCaptionAt = input.At;
        lastCaptionPoint = input.Point;
        return route;
    }

    private bool IsCaptionDoubleClick(MousePressEvent input)
    {
        if (lastCaption != input.Target || lastCaptionProcess != input.Before.Process)
            return false;
        if (input.At - lastCaptionAt > input.DoubleClickTime)
            return false;
        return Math.Abs(input.Point.X - lastCaptionPoint.X) <= CaptionDoubleClickDistancePx
            && Math.Abs(input.Point.Y - lastCaptionPoint.Y) <= CaptionDoubleClickDistancePx;
    }

    internal void Key(KeyPressEvent input)
    {
        try
        {
            KeyCore(input);
        }
        finally
        {
            gestures.RetireUnreferenced(
                gestures.Current is { } current && Placement.Owns(current.Window)
            );
        }
    }

    private bool MouseInputConflict(long now) =>
        gestures.Pending is { Origin: "mouse" } pending && now - pending.At <= InputMatchWindowMs;

    private void ReleaseReductionKey(KeySequenceRelease release)
    {
        if (release.Key != VK_DOWN || UsesLegacyBaseline)
            return;
        if (gestures.Pending is { Route: "win-down" } down)
            gestures.AwaitResult(down.Gesture, release.At);
    }

    private void ObserveKeyEpoch(KeySequenceInput input)
    {
        if (!KeepsReductionSeries(input))
            InputEpoch++;
    }

    private static bool KeepsReductionSeries(KeySequenceInput input) =>
        !input.Injected && (input.Key is VK_LWIN or VK_RWIN || input.Route == "win-down");

    private void KeyCore(KeyPressEvent input)
    {
        gestures.Drags.Clear();
        gestures.Press = null;
        gestures.Release = null;
        bool conflict = MouseInputConflict(input.At);
        bool injected = (input.Flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0;
        string? route = KeyRoute(input.Key, input.Win, input.Shift, input.Alt, input.Modified);
        var keyPress = new KeySequenceInput(input.Key, injected, route);
        ObserveKeyEpoch(keyPress);
        TrackMaximizeModifiers(keyPress);
        if (IsModifier(input.Key))
        {
            TrackModifier(input, keyPress);
            return;
        }
        if (HandleMaximizePress(input, keyPress, conflict))
            return;
        if (ConsumeRepeatedMonitorMove(keyPress))
            return;
        if (TrackPlacement(input, keyPress, conflict))
            return;

        BaselineKey(input.Target, route);
        if (ConsumeRepeatedReduction(keyPress))
            return;
        if (input.Before is null || !CanStartStandaloneKey(keyPress, conflict))
        {
            gestures.Pending = null;
            return;
        }
        StartStandaloneKey(input, keyPress, conflict);
    }

    private void TrackMaximizeModifiers(KeySequenceInput keyPress)
    {
        if (keyPress is { Injected: true, Key: VK_LWIN or VK_RWIN })
            injectedWin.Add(keyPress.Key);
        if (keyPress is { Injected: true } or { Key: not (VK_UP or VK_LWIN or VK_RWIN) })
            gestures.Maximize = null;
    }

    private void TrackModifier(KeyPressEvent input, KeySequenceInput keyPress)
    {
        Placement.Key(
            input.Target,
            input.Before,
            input.Key,
            input.Win,
            input.Modified,
            input.At,
            input.Flags,
            NextTransaction
        );
        BaselineModifier(input.Key, keyPress.Injected);
        if (gestures.Pending is { } pending)
            gestures.Pending = pending with { Conflicted = true };
    }

    private bool ConsumeRepeatedMonitorMove(KeySequenceInput keyPress)
    {
        if (keyPress.Route is not ("win-shift-left" or "win-shift-right"))
            return false;
        if (moveKeyReleased || gestures.Pending?.Route != keyPress.Route)
            return false;
        if (keyPress.Injected)
            ClearInput();
        return true;
    }

    private bool TrackPlacement(KeyPressEvent input, KeySequenceInput keyPress, bool conflict)
    {
        if (keyPress.Route is not ("win-left" or "win-right" or "win-up" or "win-down"))
        {
            Placement.Cancel();
            return false;
        }
        if (
            !Placement.Key(
                input.Target,
                input.Before,
                input.Key,
                input.Win,
                conflict,
                input.At,
                input.Flags,
                NextTransaction
            )
        )
            return false;
        gestures.Pending = null;
        ClearBaselineReduction();
        return true;
    }

    private bool ConsumeRepeatedReduction(KeySequenceInput keyPress)
    {
        if (keyPress.Key != VK_DOWN)
            return false;
        if (winDownHeld)
            return true;
        winDownHeld = true;
        return false;
    }

    private static bool CanStartStandaloneKey(KeySequenceInput keyPress, bool conflict) =>
        keyPress.Route is not null && (keyPress.Route != "win-up" || keyPress.Injected || conflict);

    private void StartStandaloneKey(KeyPressEvent input, KeySequenceInput keyPress, bool conflict)
    {
        gestures.Pending = gestures.Begin(
            input.Target,
            input.Before!,
            "key",
            keyPress.Route!,
            input.At,
            keyPress.Injected,
            conflict,
            true,
            NextTransaction()
        );
        RememberReductionPress(input.NativeTick, gestures.Pending);
        moveKeyReleased = false;
    }

    private void RememberReductionPress(uint? tick, GestureManager.Input input)
    {
        reductionMinimizeStart = null;
        reductionPress =
            tick is { } at && input is { Route: "win-down", Before.Show: SW_SHOWNORMAL }
                ? (input.Gesture, at)
                : null;
    }

    // Returns true when a repeated press has already been consumed.
    private bool HandleMaximizePress(KeyPressEvent input, KeySequenceInput keyPress, bool conflict)
    {
        if (input.Key != VK_UP)
            return false;
        if (upHeld)
        {
            if (keyPress.Injected)
                ClearInput();
            return true;
        }
        upHeld = true;
        gestures.Maximize = CanStartMaximize(input, keyPress, conflict)
            ? gestures.Begin(
                input.Target,
                input.Before!,
                "key",
                "win-up",
                input.At,
                false,
                false,
                true,
                NextTransaction(),
                ContinueSeries: Placement.Owns(input.Target)
            )
            : null;
        return false;
    }

    private bool CanStartMaximize(KeyPressEvent input, KeySequenceInput keyPress, bool conflict) =>
        keyPress.Route == "win-up"
        && input.Before is { Show: SW_SHOWNORMAL }
        && !keyPress.Injected
        && injectedWin.Count == 0
        && !conflict
        && !gestures.Moving.Contains(input.Target)
        && !Placement.Cancelled;

    internal static string? KeyRoute(uint key, bool win, bool shift, bool alt, bool other) =>
        other
            ? null
            : (key, win, shift, alt) switch
            {
                (VK_UP, true, false, false) => "win-up",
                (VK_DOWN, true, false, false) => "win-down",
                (VK_LEFT, true, false, false) => "win-left",
                (VK_RIGHT, true, false, false) => "win-right",
                (VK_LEFT, true, true, false) => "win-shift-left",
                (VK_RIGHT, true, true, false) => "win-shift-right",
                (VK_F4, false, false, true) => "alt-f4",
                _ => null,
            };

    internal static string State(uint show) =>
        show switch
        {
            SW_SHOWNORMAL => "normal",
            SW_SHOWMAXIMIZED => "maximized",
            SW_SHOWMINIMIZED or SW_MINIMIZE or SW_SHOWMINNOACTIVE => "minimized",
            _ => "other",
        };
}
