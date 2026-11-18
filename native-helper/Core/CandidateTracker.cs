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
    internal bool MoveKeyReleased => moveKeyReleased;
    internal bool ClickReleased => clickReleased;
    internal Action<WindowDiagnosticReason>? Diagnostic { get; set; }
    internal bool HasDrag => gestures.Drags.Count == 1;

    internal void MouseMoved(Point point, uint flags)
    {
        if (
            (flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED)) != 0
            && (gestures.Press is not null || HasDrag)
        )
        {
            ClearInput();
            return;
        }
        foreach (var drag in gestures.Drags.Values)
            drag.Probe?.Sample(point, flags);
        if (
            MouseStateTarget is not null
            && (
                (flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED)) != 0
                || !clickReleased
                    && (
                        Math.Abs((long)point.X - clickPoint.X) > ClickMovementPx
                        || Math.Abs((long)point.Y - clickPoint.Y) > ClickMovementPx
                    )
            )
        )
            CancelMouseState();
    }

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

    internal void ForegroundChanged(nint window)
    {
        if (gestures.Current?.Window != window)
            InputEpoch++;
        Placement.Foreground(window);
        if (gestures.Drags.Keys.Any(target => target != window))
            Diagnostic?.Invoke(WindowDiagnosticReason.DragForegroundCancelled);
        gestures.Foreground(window);
        BaselineForeground(window);
    }

    internal void Reset(int newGeneration)
    {
        InputEpoch++;
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
        if ((flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED)) != 0)
        {
            ClearInput();
            return;
        }
        gestures.Press = null;
        MouseMoved(point, flags);
        clickReleased = true;
        if (gestures.Current?.Source == "caption")
            gestures.AwaitResult(gestures.Current, releasedAt);
        if (
            gestures.Drags.Count == 1
            && monitor is not null
            && work is not null
            && Diagnostic is { } diagnostic
        )
            gestures
                .Drags.Values.First()
                .Probe?.Record(point, monitor, work, physicalBefore, physicalAfter, diagnostic);
        gestures.Release =
            gestures.Drags.Count == 1 && monitor is not null && work is not null
                ? (monitor, work, point)
                : null;
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
        string route = input.Hit switch
        {
            HTMAXBUTTON => "max-button",
            HTMINBUTTON => "min-button",
            HTCLOSE => "close-button",
            HTCAPTION => "caption-press",
            _ => "unknown",
        };
        if (
            input.Hit == HTCAPTION
            && lastCaption == input.Target
            && lastCaptionProcess == input.Before.Process
            && input.At - lastCaptionAt <= input.DoubleClickTime
            && Math.Abs(input.Point.X - lastCaptionPoint.X) <= CaptionDoubleClickDistancePx
            && Math.Abs(input.Point.Y - lastCaptionPoint.Y) <= CaptionDoubleClickDistancePx
        )
            route = "caption-double-click";
        lastCaption = input.Hit == HTCAPTION ? input.Target : 0;
        lastCaptionProcess = input.Before.Process;
        lastCaptionAt = input.At;
        lastCaptionPoint = input.Point;
        gestures.Pending = gestures.Begin(
            input.Target,
            input.Before,
            route is "unknown" or "caption-press" ? "unknown" : "mouse",
            route,
            input.At,
            (input.Flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED)) != 0,
            input.Modified,
            input.Foreground,
            NextTransaction(),
            CaptionPress: route == "caption-press"
        );
        // Explicit resize borders and caption buttons remain outside window-move detection.
        gestures.Press =
            (route is "unknown" or "caption-press") && input.Hit is not (>= 10 and <= 18)
                ? gestures.Pending
                : null;
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
        ObserveKeyEpoch(
            new(
                input.Key,
                injected,
                KeyRoute(input.Key, input.Win, input.Shift, input.Alt, input.Modified)
            )
        );
        if (injected && input.Key is VK_LWIN or VK_RWIN)
            injectedWin.Add(input.Key);
        if (injected || input.Key != VK_UP && input.Key is not (VK_LWIN or VK_RWIN))
            gestures.Maximize = null;
        if (IsModifier(input.Key))
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
            BaselineModifier(input.Key, injected);
            if (gestures.Pending is not null)
                gestures.Pending = gestures.Pending with { Conflicted = true };
            return;
        }
        string? route = KeyRoute(input.Key, input.Win, input.Shift, input.Alt, input.Modified);
        if (HandleMaximizePress(input, route, conflict, injected))
            return;
        if (
            route is "win-shift-left" or "win-shift-right"
            && gestures.Pending?.Route == route
            && !moveKeyReleased
        )
        {
            if ((input.Flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0)
                ClearInput();
            return;
        }
        bool placementKey =
            input.Win
            && !input.Modified
            && !input.Shift
            && !input.Alt
            && input.Key is VK_LEFT or VK_RIGHT or VK_UP or VK_DOWN;
        if (!placementKey)
            Placement.Cancel();
        if (
            placementKey
            && Placement.Key(
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
        {
            gestures.Pending = null;
            ClearBaselineReduction();
            return;
        }
        BaselineKey(input.Target, route);
        if (input.Key == VK_DOWN)
        {
            if (winDownHeld)
                return;
            winDownHeld = true;
        }
        if (route is null || route == "win-up" && !injected && !conflict || input.Before is null)
        {
            gestures.Pending = null;
            return;
        }
        gestures.Pending = gestures.Begin(
            input.Target,
            input.Before,
            "key",
            route,
            input.At,
            (input.Flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0,
            conflict,
            true,
            NextTransaction()
        );
        moveKeyReleased = false;
    }

    // Returns true when a repeated press has already been consumed.
    private bool HandleMaximizePress(
        KeyPressEvent input,
        string? route,
        bool conflict,
        bool injected
    )
    {
        if (input.Key != VK_UP)
            return false;
        if (upHeld)
        {
            if (injected)
                ClearInput();
            return true;
        }
        upHeld = true;
        gestures.Maximize = CanStartMaximize(input, route, conflict, injected)
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

    private bool CanStartMaximize(
        KeyPressEvent input,
        string? route,
        bool conflict,
        bool injected
    ) =>
        route == "win-up"
        && input.Before is { Show: SW_SHOWNORMAL }
        && !injected
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
