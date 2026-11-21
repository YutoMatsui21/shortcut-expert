internal sealed partial class CandidateTracker
{
    private object? FinishOrdinaryDrag(DragTerminal terminal)
    {
        if (MoveTerminalFailure(terminal) is { } failure)
        {
            Diagnostic?.Invoke(failure);
            return null;
        }
        Diagnostic?.Invoke(WindowDiagnosticReason.MoveAccepted);
        return BuildDragMove(terminal);
    }

    private static WindowDiagnosticReason? MoveTerminalFailure(DragTerminal terminal)
    {
        var before = terminal.Start.Before;
        var after = terminal.After;
        if (before.Monitor == after.Monitor)
            return WindowDiagnosticReason.MoveSameMonitor;
        if (terminal.Release is not { } release)
            return WindowDiagnosticReason.DragReleaseUnknown;
        if (release.Monitor != after.Monitor)
            return WindowDiagnosticReason.MoveReleaseMonitorMismatch;
        if (release.Work != after.Work)
            return WindowDiagnosticReason.MoveReleaseWorkMismatch;
        if (!OrdinaryState(after))
            return WindowDiagnosticReason.MoveEndStateInvalid;
        if (!StableMove(before, after, requireCaption: false))
            return WindowDiagnosticReason.MoveUnstable;
        return terminal.InForeground ? null : WindowDiagnosticReason.MoveForegroundMismatch;
    }

    private static bool OrdinaryState(WindowState state) =>
        State(state.Show) == "normal" && state.Arranged == false;

    private object BuildDragMove(DragTerminal terminal) =>
        Build(
            "monitor-move",
            terminal.Start.Before,
            terminal.After,
            terminal.Start,
            terminal.Start.At,
            terminal.InForeground,
            false,
            terminal.Date,
            terminal.After.Monitor
        );
}
