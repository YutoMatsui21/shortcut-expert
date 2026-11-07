using static NativeMethods;
using Point = NativeMethods.Point;

// Research only. No protocol, persistence, notification, or installed hooks.
internal static class MouseDetectionShadow
{
    internal sealed record Drag(
        WindowState Before,
        WindowState After,
        Point Release,
        bool Physical = true,
        bool Target = true,
        bool Stable = true,
        bool Cancelled = false,
        bool Resize = false,
        bool Injected = false,
        bool Conflict = false,
        bool Released = true,
        bool Terminal = true,
        long StartAge = 100,
        MonitorBounds? ReleaseMonitor = null,
        MonitorBounds? ReleaseWork = null,
        bool? CurrentMaximizeConfirmed = null
    );

    internal sealed record Result(string[] Operations, string Reason);

    internal static Result Evaluate(Drag d)
    {
        Result Reject(string reason) => new([], reason);
        var a = d.Before;
        var b = d.After;
        if (!d.Terminal)
            return Reject("intermediate");
        if (!d.Physical || !d.Released || d.Cancelled || d.Resize || d.Injected || d.Conflict)
            return Reject("input-invalid");
        if (!d.Target || a.Process != b.Process)
            return Reject("target-invalid");
        if (!d.Stable || a.DisplayLayout is null || a.DisplayLayout != b.DisplayLayout)
            return Reject("layout-invalid");
        if (d.StartAge is < 0 or > 1000)
            return Reject("input-expired");
        if (
            a.Monitor is null
            || b.Monitor is null
            || a.Work is null
            || b.Work is null
            || a.Dpi == 0
            || b.Dpi == 0
            || a.Show is not (SW_SHOWNORMAL or SW_SHOWMAXIMIZED)
            || b.Show is not (SW_SHOWNORMAL or SW_SHOWMAXIMIZED)
        )
            return Reject("state-unknown");
        if (d.ReleaseMonitor != b.Monitor || d.ReleaseWork != b.Work)
            return Reject("release-mismatch");
        bool changed = a.Monitor != b.Monitor;
        if (!changed && (a.Work != b.Work || a.Dpi != b.Dpi))
            return Reject("geometry-changed");
        var operations = new List<string>();
        if (changed)
            operations.Add("W02");
        // Reuse all current release/shape/target gates, relaxing only the known arranged origin.
        string? initial = PlacementGeometry.Shape(a);
        if (a.Arranged == true && initial is null)
            return Reject("start-shape-unknown");
        if (a.Arranged is null)
            return Reject("start-state-unknown");
        var placement = PlacementGeometry.Drag(
            a with
            {
                Arranged = false,
            },
            b,
            d.Release,
            b.Monitor,
            b.Work,
            d.StartAge,
            true
        );
        if (placement is not null && (changed || initial != placement.shape))
            operations.Add(placement.shape.EndsWith("-half") ? "W06" : "W07");
        // B deliberately delegates its complete terminal validation to the current tracker.
        if (a.Show == SW_SHOWNORMAL && b.Show == SW_SHOWMAXIMIZED)
        {
            bool confirmed =
                d.CurrentMaximizeConfirmed
                ?? (
                    Current(d)
                    is WindowCandidate { operation: "maximize" }
                        or CompoundMoveResult { Terminal: "maximized" }
                );
            if (confirmed)
                operations.Add("W03");
        }
        return new(
            operations.ToArray(),
            operations.Count == 0 ? "unchanged-or-unconfirmed" : "confirmed"
        );
    }

    internal static object? Current(Drag d)
    {
        var tracker = new CandidateTracker();
        tracker.Reset(1);
        tracker.Mouse(
            11,
            d.Before,
            d.Resize ? 10 : HTCAPTION,
            default,
            0,
            500,
            d.Injected ? 1u : 0u,
            d.Conflict,
            d.Target
        );
        tracker.MoveStart(11, d.StartAge);
        if (d.Cancelled || !d.Physical || !d.Stable)
            tracker.ClearInput();
        if (d.Released)
            tracker.MouseReleased(d.Release, d.ReleaseMonitor, d.ReleaseWork, d.Injected ? 1u : 0u);
        return d.Terminal
            ? tracker.FinishMove(d.Target ? 11 : 12, d.After, 500, 11, "2026-11-07")
            : null;
    }

    internal static string[] CurrentOperations(object? value) =>
        value switch
        {
            WindowCandidate { operation: "monitor-move", targetMatched: true } => ["W02"],
            WindowCandidate { operation: "maximize", targetMatched: true } => ["W03"],
            PlacementResult p => [p.Evidence.shape.EndsWith("-half") ? "W06" : "W07"],
            CompoundMoveResult c => ["W02", c.Terminal == "maximized" ? "W03" : "W07"],
            _ => [],
        };

    // Facts remain ephemeral. Caller must obtain these from physical input, never UI meaning guesses.
    internal sealed record Click(
        bool SameTarget,
        bool PhysicalReleases,
        bool Nearby,
        bool WithinDoubleClickTime,
        bool Conflict,
        bool Dragged,
        bool Injected,
        bool StateChanged,
        bool FirstClickChangedState,
        bool ResultWithinDeadline
    );

    internal static Result DoubleClick(Click c) =>
        c.SameTarget
        && c.PhysicalReleases
        && c.Nearby
        && c.WithinDoubleClickTime
        && !c.Conflict
        && !c.Dragged
        && !c.Injected
        && c.StateChanged
        && !c.FirstClickChangedState
        && c.ResultWithinDeadline
            ? new(["state-change"], "causality-unproven")
            : new([], "click-rejected");
}
