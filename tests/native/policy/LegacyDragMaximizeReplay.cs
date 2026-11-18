internal sealed partial class CandidateTracker
{
    private object? FinishMaximizedDrag(DragTerminal terminal)
    {
        Diagnostic?.Invoke(WindowDiagnosticReason.DragMaximizedResult);
        if (MaximizeTerminalFailure(terminal) is { } failure)
        {
            Diagnostic?.Invoke(failure);
            if (failure == WindowDiagnosticReason.MaxStartInvalid)
                TraceInvalidMaximizeState(terminal);
            return null;
        }
        if (!ReachedTopEdge(terminal))
            return null;
        Diagnostic?.Invoke(WindowDiagnosticReason.MaxAccepted);
        var drag = terminal.Start;
        var after = terminal.After;
        if (drag.Before.Monitor != after.Monitor)
            return StableMove(drag.Before, after, requireCaption: false)
                ? Compound(drag, after, "maximized")
                : null;
        return Build(
            "maximize",
            drag.Before,
            after,
            drag with
            {
                Route = "caption-top-drag",
            },
            drag.At,
            true,
            false,
            terminal.Date,
            after.Monitor
        );
    }

    private static WindowDiagnosticReason? MaximizeTerminalFailure(DragTerminal terminal)
    {
        if (terminal.Release is not { } release)
            return WindowDiagnosticReason.MaxReleaseMissing;
        if (release.Monitor != terminal.After.Monitor)
            return WindowDiagnosticReason.MaxReleaseMonitorMismatch;
        if (release.Work != terminal.After.Work)
            return WindowDiagnosticReason.MaxReleaseWorkMismatch;
        if (!CanMaximize(terminal))
            return WindowDiagnosticReason.MaxStartInvalid;
        return terminal.InForeground ? null : WindowDiagnosticReason.MaxForegroundMismatch;
    }

    private static bool CanMaximize(DragTerminal terminal) =>
        terminal.After.Arranged == false
        && State(terminal.Start.Before.Show) == "normal"
        && terminal.Start.Before.Arranged is not null;

    private void TraceInvalidMaximizeState(DragTerminal terminal)
    {
        if (State(terminal.Start.Before.Show) != "normal")
            Diagnostic?.Invoke(WindowDiagnosticReason.MaxStartNotNormal);
        if (terminal.Start.Before.Arranged is null)
            Diagnostic?.Invoke(WindowDiagnosticReason.MaxStartArrangedUnknown);
        if (terminal.After.Arranged is null)
            Diagnostic?.Invoke(WindowDiagnosticReason.MaxResultArrangedUnknown);
    }

    private bool ReachedTopEdge(DragTerminal terminal)
    {
        var release = terminal.Release!;
        long topGap = (long)release.Point.Y - release.Work.y;
        Diagnostic?.Invoke(TopGapReason(topGap));
        var tolerance = PlacementGeometry.ReleaseTolerance(
            terminal.Start.Before,
            terminal.After,
            2
        );
        if (tolerance is null)
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.MaxDockThresholdChanged);
            return false;
        }
        if (!WithinHorizontalWorkArea(release))
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.MaxReleaseXOutside);
            return false;
        }
        return topGap >= 0 && topGap <= tolerance.Value;
    }

    private static bool WithinHorizontalWorkArea(DragRelease release) =>
        release.Point.X >= release.Work.x
        && (long)release.Point.X < (long)release.Work.x + release.Work.width;

    private static WindowDiagnosticReason TopGapReason(long topGap) =>
        topGap switch
        {
            < 0 => WindowDiagnosticReason.MaxReleaseYBeforeTop,
            <= 2 => WindowDiagnosticReason.MaxReleaseTopWithin2,
            <= 8 => WindowDiagnosticReason.MaxReleaseTop3To8,
            <= 32 => WindowDiagnosticReason.MaxReleaseTop9To32,
            <= 64 => WindowDiagnosticReason.MaxReleaseTop33To64,
            _ => WindowDiagnosticReason.MaxReleaseTopAbove64,
        };
}
