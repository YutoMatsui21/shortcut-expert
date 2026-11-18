using static NativeMethods;
using Point = NativeMethods.Point;

// Frozen legacy candidate generation for the #172 v2 compatibility baseline.
// The policy test project links the shared input collector and adds these fixtures.
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
    private const long MouseStateMatchWindowMs = 500;
    private GestureManager.Input? completedWinDown;
    private int generation,
        sequence;

    internal bool IndependentResults { get; set; }

    partial void ReadBaselineMode(ref bool legacy) => legacy = !IndependentResults;

    partial void ResetBaseline(int nextGeneration)
    {
        generation = nextGeneration;
        sequence = 0;
    }

    partial void BaselineForeground(nint window)
    {
        if (completedWinDown is not null && completedWinDown.Window != window)
            ClearBaselineReduction();
    }

    partial void BaselineForget(nint window)
    {
        if (completedWinDown?.Window == window)
            ClearBaselineReduction();
    }

    partial void BaselineModifier(uint key, bool injected)
    {
        if (key is not (VK_LWIN or VK_RWIN) || injected)
            ClearBaselineReduction();
    }

    partial void BaselineKey(nint window, string? route)
    {
        if (route != "win-down" || completedWinDown?.Window != window)
            ClearBaselineReduction();
    }

    partial void ClearBaselineReduction() => completedWinDown = null;

    internal void Mouse(
        nint window,
        WindowState before,
        int hit,
        Point point,
        long now,
        uint doubleClickTime,
        uint flags,
        bool modifiers,
        bool foreground
    ) =>
        Mouse(
            new(0, window, now, before, hit, point, doubleClickTime, flags, modifiers, foreground)
        );

    internal void Key(
        nint window,
        WindowState? before,
        uint key,
        bool winDown,
        bool modifiers,
        long now,
        uint flags,
        bool shiftDown = false,
        bool altDown = false
    ) => Key(new(0, window, now, before, key, winDown, modifiers, flags, shiftDown, altDown));

    internal WindowCandidate? ConfirmMaximize(
        nint window,
        WindowState? after,
        long now,
        nint foreground,
        string date
    )
    {
        if (IndependentResults)
            return null;
        if (MaximizeTarget(now) is not { } target || target != window)
            return null;
        var pending = gestures.Maximize!;
        if (foreground != window || after is null || after.Process != pending.Before.Process)
        {
            gestures.Maximize = null;
            gestures.RetireUnreferenced(Placement.Owns(window));
            return null;
        }
        if (after.Show != SW_SHOWMAXIMIZED)
            return null;
        gestures.Complete(pending.Gesture, window, after, now);
        gestures.Maximize = null;
        gestures.Pending = null;
        Placement.Cancel();
        return (WindowCandidate)Build(
            "maximize",
            pending.Before,
            after,
            pending,
            now - pending.At,
            true,
            false,
            date,
            after.Monitor
        );
    }

    internal object? FinishKey(
        nint window,
        WindowState? after,
        long now,
        bool injected,
        string date
    )
    {
        if (injected)
        {
            gestures.Maximize = null;
            gestures.RetireUnreferenced(Placement.Owns(window));
        }
        var confirmed = ConfirmMaximize(window, after, now, window, date);
        if (confirmed is not null)
            return confirmed;
        if (
            gestures.Pending is { Route: "win-shift-left" or "win-shift-right" } move
            && move.Window == window
            && moveKeyReleased
        )
        {
            if (injected || after is null)
            {
                ClearInput();
                return null;
            }
            return Complete(window, move.Before, after, now, window, date, after.Monitor);
        }
        if (Placement.WinHeld)
            return null;
        var placed = Placement.Finish(window, after, now, injected);
        return placed;
    }

    internal object? FinishMove(
        nint window,
        WindowState? after,
        long now,
        nint foreground,
        string date
    )
    {
        var gesture = gestures.Drags.GetValueOrDefault(window)?.Gesture;
        var result = FinishMoveCore(window, after, now, foreground, date);
        if (after is not null && result is not null)
            gestures.Complete(gesture, window, after, now);
        else
            gestures.Cancel(gesture);
        return result;
    }

    private object? FinishMoveCore(
        nint window,
        WindowState? after,
        long now,
        nint foreground,
        string date
    )
    {
        gestures.Drags.TryGetValue(window, out GestureManager.Input? drag);
        var released = gestures.Release;
        gestures.Release = null;
        Forget(window, preserveGesture: true);
        if (drag is null)
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.DragNoSource);
            return null;
        }
        if (drag.Injected || drag.Conflicted || !drag.Matched)
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.MoveInputInvalid);
            return null;
        }
        if (after is null)
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.DragNoResult);
            return null;
        }
        if (drag.Before.Process != after.Process)
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.DragTargetChanged);
            return null;
        }
        if (drag.Before.DisplayLayout != after.DisplayLayout)
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.DragLayoutChanged);
            return null;
        }
        if (drag.Before.Monitor is null || after.Monitor is null)
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.DragMonitorUnknown);
            return null;
        }
        // Moving an already maximized window does not maximize it again. Keep this
        // separate from compound validation so an invalid compound is never split.
        if (
            State(drag.Before.Show) == "maximized"
            && State(after.Show) == "maximized"
            && drag.Before.Monitor != after.Monitor
            && released is { } maxRelease
            && maxRelease.Monitor == after.Monitor
            && maxRelease.Work == after.Work
            && foreground == window
            && StableMove(drag.Before, after, requireCaption: false)
        )
            return Build(
                "monitor-move",
                drag.Before,
                after,
                drag,
                drag.At,
                true,
                false,
                date,
                after.Monitor
            );
        if (after.Arranged == true)
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.DragArrangedResult);
            if (!drag.CaptionPress)
                return null; // W06/W07 retain their existing input gate.
            if (released is null)
                Diagnostic?.Invoke(WindowDiagnosticReason.DragReleaseUnknown);
            var placement = released is { } r
                ? PlacementGeometry.Drag(
                    drag.Before,
                    after,
                    r.Point,
                    r.Monitor,
                    r.Work,
                    drag.At,
                    foreground == window && drag.Matched && !drag.Injected && !drag.Conflicted,
                    Diagnostic
                )
                : null;
            if (placement is { monitorChanged: true })
                return
                    !placement.shape.EndsWith("-half")
                    && StableMove(drag.Before, after, requireCaption: false)
                    ? Compound(drag, after, placement.shape)
                    : null;
            return placement is null
                ? null
                : new PlacementResult(drag.Transaction, "mouse", placement);
        }
        if (State(after.Show) == "maximized")
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.DragMaximizedResult);
            if (released is null)
            {
                Diagnostic?.Invoke(WindowDiagnosticReason.MaxReleaseMissing);
                return null;
            }
            var r = released.Value;
            if (r.Monitor != after.Monitor)
            {
                Diagnostic?.Invoke(WindowDiagnosticReason.MaxReleaseMonitorMismatch);
                return null;
            }
            if (r.Work != after.Work)
            {
                Diagnostic?.Invoke(WindowDiagnosticReason.MaxReleaseWorkMismatch);
                return null;
            }
            if (
                after.Arranged != false
                || State(drag.Before.Show) != "normal"
                || drag.Before.Arranged is null
            )
            {
                Diagnostic?.Invoke(WindowDiagnosticReason.MaxStartInvalid);
                // Fixed categories only: distinguish start state from an unknown terminal API result.
                if (State(drag.Before.Show) != "normal")
                    Diagnostic?.Invoke(WindowDiagnosticReason.MaxStartNotNormal);
                if (drag.Before.Arranged is null)
                    Diagnostic?.Invoke(WindowDiagnosticReason.MaxStartArrangedUnknown);
                if (after.Arranged is null)
                    Diagnostic?.Invoke(WindowDiagnosticReason.MaxResultArrangedUnknown);
                return null;
            }
            if (foreground != window)
            {
                Diagnostic?.Invoke(WindowDiagnosticReason.MaxForegroundMismatch);
                return null;
            }
            long topGap = (long)r.Point.Y - r.Work.y;
            Diagnostic?.Invoke(
                topGap < 0 ? WindowDiagnosticReason.MaxReleaseYBeforeTop
                : topGap <= 2 ? WindowDiagnosticReason.MaxReleaseTopWithin2
                : topGap <= 8 ? WindowDiagnosticReason.MaxReleaseTop3To8
                : topGap <= 32 ? WindowDiagnosticReason.MaxReleaseTop9To32
                : topGap <= 64 ? WindowDiagnosticReason.MaxReleaseTop33To64
                : WindowDiagnosticReason.MaxReleaseTopAbove64
            );
            // The published docking setting is a bounded tolerance, not the full Snap hit region.
            // Retain the historical two-pixel fallback when the setting cannot be read.
            int? tolerance = PlacementGeometry.ReleaseTolerance(drag.Before, after, 2);
            if (tolerance is null)
            {
                Diagnostic?.Invoke(WindowDiagnosticReason.MaxDockThresholdChanged);
                return null;
            }
            if (r.Point.X < r.Work.x || (long)r.Point.X >= (long)r.Work.x + r.Work.width)
            {
                Diagnostic?.Invoke(WindowDiagnosticReason.MaxReleaseXOutside);
                return null;
            }
            if (r.Point.Y < r.Work.y || (long)r.Point.Y > (long)r.Work.y + tolerance.Value)
                return null;
            Diagnostic?.Invoke(WindowDiagnosticReason.MaxAccepted);
            if (drag.Before.Monitor != after.Monitor)
                return
                    StableMove(drag.Before, after, requireCaption: false)
                    && drag.Matched
                    && !drag.Injected
                    && !drag.Conflicted
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
                date,
                after.Monitor
            );
        }
        if (drag.Before.Monitor == after.Monitor)
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.MoveSameMonitor);
            return null;
        }
        if (released is null)
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.DragReleaseUnknown);
            return null;
        }
        if (released.Value.Monitor != after.Monitor)
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.MoveReleaseMonitorMismatch);
            return null;
        }
        if (released.Value.Work != after.Work)
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.MoveReleaseWorkMismatch);
            return null;
        }
        if (State(after.Show) != "normal" || after.Arranged != false)
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.MoveEndStateInvalid);
            return null;
        }
        if (!StableMove(drag.Before, after, requireCaption: false))
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.MoveUnstable);
            return null;
        }
        if (drag.Injected || drag.Conflicted || !drag.Matched)
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.MoveInputInvalid);
            return null;
        }
        if (foreground != window)
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.MoveForegroundMismatch);
            return null;
        }
        Diagnostic?.Invoke(WindowDiagnosticReason.MoveAccepted);
        // Drag lifetime is bounded by MOVESIZEEND; age is the input-to-start interval, not its duration.
        return Build(
            "monitor-move",
            drag.Before,
            after,
            drag,
            drag.At,
            foreground == window,
            false,
            date,
            after.Monitor
        );
    }

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

    private static string? MoveDirection(WindowState before, WindowState after) =>
        before.HorizontalPair
        && after.HorizontalPair
        && before.Monitor is not null
        && after.Monitor is not null
        && before.Monitor.y == after.Monitor.y
        && before.Monitor != after.Monitor
            ? after.Monitor.x < before.Monitor.x
                ? "left"
                : "right"
            : null;

    internal object? Close(nint window, WindowState? previous, long now, string date)
    {
        GestureManager.Input? candidate =
            gestures.Pending?.Window == window ? gestures.Pending : null;
        Forget(window);
        if (
            previous is null
            || candidate is null
            || !candidate.Before.HasCaption
            || !previous.HasCaption
            || candidate.Before.Process != previous.Process
            || candidate.Route is not ("close-button" or "alt-f4")
        )
            return null;
        return Build(
            "close",
            candidate.Before,
            previous with
            {
                Show = 0,
            },
            candidate,
            now - candidate.At,
            true,
            false,
            date,
            candidate.Before.Monitor
        );
    }

    internal object? Complete(
        nint window,
        WindowState? previous,
        WindowState after,
        long now,
        nint foreground,
        string date,
        MonitorBounds? monitor
    )
    {
        var maximized = ConfirmMaximize(window, after, now, foreground, date);
        if (maximized is not null)
            return maximized;
        if (previous is null)
            return null;
        if (previous.Process != after.Process)
        {
            Forget(window);
            return null;
        }
        if (Placement.Owns(window))
            return null;
        // A drag owns this transaction until its terminal result; derived transitions cannot consume it.
        if (gestures.Drags.ContainsKey(window))
            return null;
        // Re-read from the click start: a state event may have updated the cache before button-up.
        bool fallback = gestures.Pending is { Route: "unknown" } mouse && mouse.Window == window;
        if (fallback && clickReleased)
            previous = gestures.Pending!.Before;
        string? operation = (State(previous.Show), State(after.Show)) switch
        {
            ("normal", "maximized") => "maximize",
            ("normal" or "maximized", "minimized") => "minimize",
            ("maximized", "normal") => "restore",
            _ => null,
        };
        GestureManager.Input? candidate =
            gestures.Pending?.Window == window ? gestures.Pending : null;
        if (candidate is not null && candidate.Before.Process != after.Process)
        {
            ClearInput();
            candidate = null;
        }
        if (candidate is { Route: "win-shift-left" or "win-shift-right" } && !moveKeyReleased)
            return null;
        if (
            candidate is { Route: "win-shift-left" or "win-shift-right" }
            && !StableMove(candidate.Before, after)
        )
        {
            ClearInput();
            return null;
        }
        if (
            candidate is { Route: "win-shift-left" or "win-shift-right" }
            && candidate.Before.Monitor is not null
            && after.Monitor is not null
            && candidate.Before.Monitor != after.Monitor
        )
            operation = "monitor-move";
        // A move can restore/maximize the window as a side effect; consume only its terminal monitor result.
        if (
            candidate is { Route: "win-shift-left" or "win-shift-right" }
            && operation != "monitor-move"
        )
            return null;
        if (!RetainsOperation(operation))
            return null;
        long age = candidate is null ? -1 : now - candidate.At;
        if (fallback)
        {
            // Do not emit a rejected candidate with this transaction: Main deduplicates before classification.
            if (!clickReleased)
                return null;
            if (
                age is >= 0 and <= MouseStateMatchWindowMs
                && candidate is { Injected: false, Conflicted: false, Matched: true }
                && !gestures.Moving.Contains(window)
                && (operation == "minimize" || foreground == window)
            )
                candidate = candidate with { Origin = "mouse", Route = "mouse-state-fallback" };
        }
        bool recent = age >= 0 && age <= InputMatchWindowMs;
        WindowState before = recent && candidate is not null ? candidate.Before : previous;
        if (candidate is not null)
            gestures.Complete(candidate.Gesture, window, after, now);
        object result = Build(
            operation,
            before,
            after,
            candidate,
            age,
            operation == "minimize" || foreground == window,
            gestures.Moving.Contains(window),
            date,
            monitor
        );
        if (gestures.Pending?.Window == window)
            gestures.Pending = null;
        // The first confirmed reduction counts immediately. A second physical Win+Down
        // on the same window within one second is the continuation of that operation.
        if (
            result
                is WindowCandidate
                {
                    origin: "key",
                    route: "win-down",
                    injected: false,
                    conflicted: false,
                    targetMatched: true,
                    moving: false
                }
            && candidate is not null
            && operation is "restore" or "minimize"
            && before.Arranged == false
            && recent
        )
        {
            bool continuation =
                completedWinDown is not null
                && completedWinDown.Window == window
                && completedWinDown.Before.Process == before.Process
                && now >= completedWinDown.At
                && State(completedWinDown.Before.Show) == "maximized"
                && State(before.Show) == "normal"
                && operation == "minimize"
                && candidate.At - completedWinDown.At is >= 0 and <= InputMatchWindowMs;
            completedWinDown = operation == "restore" && after.Arranged == false ? candidate : null;
            if (continuation)
                return null;
        }
        else
            completedWinDown = null;
        return result;
    }

    private object Build(
        string operation,
        WindowState before,
        WindowState after,
        GestureManager.Input? candidate,
        long age,
        bool target,
        bool isMoving,
        string date,
        MonitorBounds? monitor
    )
    {
        bool recent = candidate is not null && age is >= 0 and <= InputMatchWindowMs;
        string? direction = MoveDirection(before, after);
        return new WindowCandidate(
            "candidate",
            1,
            generation,
            checked(++sequence),
            before.App,
            operation,
            date,
            new(State(before.Show), before.Arranged),
            new(operation == "close" ? "closed" : State(after.Show)),
            after.Arranged,
            recent ? candidate!.Origin : "unknown",
            recent && candidate!.Origin != "unknown" ? candidate.Route : "unknown",
            candidate?.Injected ?? false,
            candidate?.Conflicted ?? false,
            isMoving,
            false,
            recent && candidate!.Matched && target,
            age,
            monitor,
            before.Monitor,
            after.Monitor,
            direction,
            operation == "monitor-move" && StableMove(before, after, candidate?.Origin != "mouse"),
            operation == "monitor-move"
                && TwoDisplayLayout(before, after, candidate?.Origin != "mouse")
        )
        {
            Transaction = candidate?.Transaction ?? NextTransaction(),
        };
    }

    private static bool TwoDisplayLayout(
        WindowState before,
        WindowState after,
        bool requireCaption = true
    ) =>
        before.TwoDisplayPair
        && after.TwoDisplayPair
        && StableMove(before, after, requireCaption)
        && MonitorMovePolicy.Separate(before.Monitor!, after.Monitor!);

    private static bool StableMove(
        WindowState before,
        WindowState after,
        bool requireCaption = true
    ) =>
        (!requireCaption || before.HasCaption && after.HasCaption)
        && before.Process == after.Process
        && before.DisplayLayout is not null
        && before.DisplayLayout == after.DisplayLayout
        && before.Monitor is not null
        && after.Monitor is not null
        && before.Work is not null
        && after.Work is not null
        && before.Dpi > 0
        && after.Dpi > 0
        && State(before.Show) is "normal" or "maximized"
        && State(after.Show) is "normal" or "maximized";

    private bool RetainsOperation(
        [System.Diagnostics.CodeAnalysis.NotNullWhen(true)] string? operation
    ) =>
        operation is not null
        && (
            !IndependentResults
            || operation is not ("maximize" or "monitor-move" or "restore" or "minimize")
        );
}
