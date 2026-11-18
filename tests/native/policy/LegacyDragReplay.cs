using Point = NativeMethods.Point;

internal sealed record CompoundMoveResult(
    int Transaction,
    MonitorBounds FromMonitor,
    MonitorBounds ToMonitor,
    string Terminal,
    long InputAgeMs,
    string? MoveDirection = null,
    bool TwoDisplayLayoutConfirmed = false
);

internal sealed partial class CandidateTracker
{
    internal object? FinishMove(
        nint window,
        WindowState? after,
        long now,
        nint foreground,
        string date
    )
    {
        var gesture = gestures.Drags.GetValueOrDefault(window)?.Gesture;
        var result = FinishMoveCore(window, after, foreground, date);
        if (after is not null && result is not null)
            gestures.Complete(gesture, window, after, now);
        else
            gestures.Cancel(gesture);
        return result;
    }

    private sealed record DragRelease(MonitorBounds Monitor, MonitorBounds Work, Point Point);

    private sealed record DragTerminal(
        GestureManager.Input Start,
        WindowState After,
        DragRelease? Release,
        bool InForeground,
        string Date
    );

    private object? FinishMoveCore(nint window, WindowState? after, nint foreground, string date)
    {
        var drag = gestures.Drags.GetValueOrDefault(window);
        var released = gestures.Release;
        gestures.Release = null;
        Forget(window, preserveGesture: true);
        if (DragAdmissionFailure(drag, after) is { } failure)
        {
            Diagnostic?.Invoke(failure);
            return null;
        }
        var terminal = new DragTerminal(
            drag!,
            after!,
            released is { } r ? new(r.Monitor, r.Work, r.Point) : null,
            foreground == window,
            date
        );
        if (MovesWhileMaximized(terminal))
            return BuildDragMove(terminal);
        if (terminal.After.Arranged == true)
            return FinishArrangedDrag(terminal);
        return State(terminal.After.Show) == "maximized"
            ? FinishMaximizedDrag(terminal)
            : FinishOrdinaryDrag(terminal);
    }

    private static WindowDiagnosticReason? DragAdmissionFailure(
        GestureManager.Input? drag,
        WindowState? after
    ) =>
        (drag, after) switch
        {
            (null, _) => WindowDiagnosticReason.DragNoSource,
            ({ Injected: true } or { Conflicted: true } or { Matched: false }, _) =>
                WindowDiagnosticReason.MoveInputInvalid,
            (_, null) => WindowDiagnosticReason.DragNoResult,
            ({ Before.Process: var process }, { Process: var result }) when process != result =>
                WindowDiagnosticReason.DragTargetChanged,
            ({ Before.DisplayLayout: var layout }, { DisplayLayout: var result })
                when layout != result => WindowDiagnosticReason.DragLayoutChanged,
            ({ Before.Monitor: null }, _) or (_, { Monitor: null }) =>
                WindowDiagnosticReason.DragMonitorUnknown,
            _ => null,
        };

    private static bool MovesWhileMaximized(DragTerminal terminal) =>
        State(terminal.Start.Before.Show) == "maximized"
        && State(terminal.After.Show) == "maximized"
        && terminal.Start.Before.Monitor != terminal.After.Monitor
        && MatchesRelease(terminal)
        && terminal.InForeground
        && StableMove(terminal.Start.Before, terminal.After, requireCaption: false);

    private static bool MatchesRelease(DragTerminal terminal) =>
        terminal.Release is { } release
        && release.Monitor == terminal.After.Monitor
        && release.Work == terminal.After.Work;

    private object? FinishArrangedDrag(DragTerminal terminal)
    {
        Diagnostic?.Invoke(WindowDiagnosticReason.DragArrangedResult);
        if (!terminal.Start.CaptionPress)
            return null;
        if (terminal.Release is not { } release)
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.DragReleaseUnknown);
            return null;
        }
        var drag = terminal.Start;
        var placement = PlacementGeometry.Drag(
            drag.Before,
            terminal.After,
            release.Point,
            release.Monitor,
            release.Work,
            drag.At,
            terminal.InForeground,
            Diagnostic
        );
        if (placement is null)
            return null;
        if (!placement.monitorChanged)
            return new PlacementResult(drag.Transaction, "mouse", placement);
        return CanComposeQuarter(terminal, placement.shape)
            ? Compound(drag, terminal.After, placement.shape)
            : null;
    }

    private static bool CanComposeQuarter(DragTerminal terminal, string shape) =>
        !shape.EndsWith("-half")
        && StableMove(terminal.Start.Before, terminal.After, requireCaption: false);

    private static CompoundMoveResult Compound(
        GestureManager.Input drag,
        WindowState after,
        string terminal
    ) =>
        new(
            drag.Transaction,
            drag.Before.Monitor!,
            after.Monitor!,
            terminal,
            drag.At,
            MoveDirection(drag.Before, after),
            TwoDisplayLayout(drag.Before, after, requireCaption: false)
        );
}
