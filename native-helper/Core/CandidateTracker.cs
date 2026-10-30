using static NativeMethods;
using Point = NativeMethods.Point;

internal sealed record MonitorBounds(int x, int y, int width, int height);
internal sealed record WindowState(uint Process, string App, uint Show, bool? Arranged,
    MonitorBounds? Monitor = null, bool HorizontalPair = false, string? DisplayLayout = null,
    MonitorBounds? Frame = null, MonitorBounds? Work = null, uint Dpi = 0);
// Only verified terminal evidence crosses the protocol; HWND/process stay in the tracker.
internal sealed record CompoundMoveResult(int Transaction, MonitorBounds FromMonitor, MonitorBounds ToMonitor,
    string Terminal, long InputAgeMs, string? MoveDirection = null);

// Same candidate construction for live callbacks and isolated event-sequence tests.
// Windows reads, hooks and input payload lifetimes remain in Observer.
internal sealed class CandidateTracker
{
    private const long InputMatchWindowMs = 1000;
    private const int CaptionDoubleClickDistancePx = 4;
    private const long NoCaptionClickAt = -10000;
    private sealed record Input(nint Window, WindowState Before, string Origin, string Route,
        long At, bool Injected, bool Conflicted, bool Matched, int Transaction);
    private readonly HashSet<nint> moving = new();
    private readonly Dictionary<nint, Input> drags = new();
    private (MonitorBounds Monitor, MonitorBounds Work, Point Point)? release;
    private Input? input;
    private bool moveKeyReleased;
    private Input? completedWinDown;
    private bool winDownHeld;
    private nint lastCaption;
    private uint lastCaptionProcess;
    private long lastCaptionAt = NoCaptionClickAt;
    private Point lastCaptionPoint;
    private int generation, sequence, transaction;
    internal PlacementPolicy Placement { get; } = new();
    internal Action<WindowDiagnosticReason>? Diagnostic { get; set; }
    internal int NextTransaction() => checked(++transaction);
    internal object? FinishKey(nint window, WindowState? after, long now, bool injected, string date)
    {
        if (input is { Route: "win-shift-left" or "win-shift-right" } move && move.Window == window && moveKeyReleased) {
            if (injected || after is null) { ClearInput(); return null; }
            return Complete(window, move.Before, after, now, window, date, after.Monitor);
        }
        if (Placement.WinHeld) return null;
        var maximize = Placement.Maximize(window, after, now, injected);
        var placed = Placement.Finish(window, after, now, injected);
        if (maximize is not { } m || after is null) return placed;
        var source = new Input(window, m.Before, "key", "win-up", now - m.Age, false, false, true, m.Transaction);
        return Build("maximize", m.Before, after, source, m.Age, true, false, date, after.Monitor);
    }
    internal void KeyReleased(uint key) {
        Placement.Released(key); if (key == VK_DOWN) winDownHeld = false;
        if (input is { Route: "win-shift-left" } && key == VK_LEFT || input is { Route: "win-shift-right" } && key == VK_RIGHT)
            moveKeyReleased = true;
    }
    internal void ForegroundChanged(nint window) {
        Placement.Foreground(window);
        if (input is { Route: "win-shift-left" or "win-shift-right" } && input.Window != window) input = null;
        if (drags.Keys.Any(target => target != window)) { Diagnostic?.Invoke(WindowDiagnosticReason.DragForegroundCancelled); drags.Clear(); release = null; }
        if (completedWinDown is not null && completedWinDown.Window != window) completedWinDown = null;
    }

    internal void Reset(int newGeneration)
    {
        generation = newGeneration; sequence = 0; transaction = 0; moving.Clear(); drags.Clear(); input = null;
        completedWinDown = null; winDownHeld = false; release = null;
        lastCaption = 0; lastCaptionAt = NoCaptionClickAt;
        Placement.Reset();
    }
    internal void ClearInput() { if (drags.Count > 0) Diagnostic?.Invoke(WindowDiagnosticReason.DragInputCancelled); Placement.Cancel(); input = null; drags.Clear(); completedWinDown = null; release = null; }
    internal void Forget(nint window)
    {
        Placement.Forget(window);
        moving.Remove(window);
        drags.Remove(window);
        if (input?.Window == window) input = null;
        if (completedWinDown?.Window == window) completedWinDown = null;
        if (lastCaption == window) { lastCaption = 0; lastCaptionAt = NoCaptionClickAt; }
    }
    internal void MoveStart(nint window, long now = 0)
    {
        release = null;
        moving.Add(window);
        if (input is { Route: "caption-press" } && input.Window == window && now - input.At is >= 0 and <= InputMatchWindowMs)
            drags[window] = input with { Origin = "mouse", Route = "caption-drag", At = now - input.At };
        if (input?.Window == window) input = input with { Conflicted = true };
        lastCaption = 0; lastCaptionAt = NoCaptionClickAt;
    }
    internal void MoveEnd(nint window) => Forget(window);
    internal void MouseReleased(Point point, MonitorBounds? monitor, MonitorBounds? work, uint flags)
    {
        if ((flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED)) != 0) { ClearInput(); return; }
        release = drags.Count == 1 && monitor is not null && work is not null ? (monitor, work, point) : null;
    }
    internal static bool IsModifier(uint key) => key is VK_LWIN or VK_RWIN or VK_SHIFT or VK_CONTROL or VK_MENU or
        VK_LSHIFT or VK_RSHIFT or VK_LCONTROL or VK_RCONTROL or VK_LMENU or VK_RMENU;

    internal void Mouse(nint window, WindowState before, int hit, Point point, long now,
        uint doubleClickTime, uint flags, bool modifiers, bool foreground)
    {
        Placement.Cancel();
        drags.Clear();
        release = null;
        completedWinDown = null;
        string route = hit switch { HTMAXBUTTON => "max-button", HTMINBUTTON => "min-button", HTCLOSE => "close-button", HTCAPTION => "caption-press", _ => "unknown" };
        if (hit == HTCAPTION && lastCaption == window && lastCaptionProcess == before.Process && now - lastCaptionAt <= doubleClickTime &&
            Math.Abs(point.X - lastCaptionPoint.X) <= CaptionDoubleClickDistancePx &&
            Math.Abs(point.Y - lastCaptionPoint.Y) <= CaptionDoubleClickDistancePx)
            route = "caption-double-click";
        lastCaption = hit == HTCAPTION ? window : 0; lastCaptionProcess = before.Process;
        lastCaptionAt = now; lastCaptionPoint = point;
        input = new Input(window, before, route is "unknown" or "caption-press" ? "unknown" : "mouse", route, now,
            (flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED)) != 0, modifiers, foreground, checked(++transaction));
    }
    internal void Key(nint window, WindowState? before, uint key, bool winDown, bool modifiers, long now, uint flags,
        bool shiftDown = false, bool altDown = false)
    {
        drags.Clear();
        release = null;
        bool conflict = input is not null && input.Origin == "mouse" && now - input.At <= InputMatchWindowMs;
        if (IsModifier(key)) {
            Placement.Key(window, before, key, winDown, modifiers, now, flags, NextTransaction);
            if (key is not (VK_LWIN or VK_RWIN) || (flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0) completedWinDown = null;
            if (input is not null) input = input with { Conflicted = true }; return;
        }
        string? route = KeyRoute(key, winDown, shiftDown, altDown, modifiers);
        if (route is "win-shift-left" or "win-shift-right" && input?.Route == route && !moveKeyReleased) {
            if ((flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0) ClearInput();
            return;
        }
        bool placementKey = winDown && !modifiers && !shiftDown && !altDown && key is VK_LEFT or VK_RIGHT or VK_UP or VK_DOWN;
        if (!placementKey) Placement.Cancel();
        if (placementKey && Placement.Key(window, before, key, winDown, conflict, now, flags, NextTransaction))
        { input = null; completedWinDown = null; return; }
        if (route != "win-down" || completedWinDown?.Window != window) completedWinDown = null;
        if (key == VK_DOWN) {
            if (winDownHeld) return;
            winDownHeld = true;
        }
        if (route is null || before is null) { input = null; return; }
        input = new Input(window, before, "key", route, now,
            (flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0, conflict, true, checked(++transaction));
        moveKeyReleased = false;
    }
    internal static string? KeyRoute(uint key, bool win, bool shift, bool alt, bool other) => other ? null :
        (key, win, shift, alt) switch {
            (VK_UP, true, false, false) => "win-up", (VK_DOWN, true, false, false) => "win-down",
            (VK_LEFT, true, false, false) => "win-left", (VK_RIGHT, true, false, false) => "win-right",
            (VK_LEFT, true, true, false) => "win-shift-left", (VK_RIGHT, true, true, false) => "win-shift-right",
            (VK_F4, false, false, true) => "alt-f4", _ => null };
    internal static string State(uint show) => show switch {
        SW_SHOWNORMAL => "normal", SW_SHOWMAXIMIZED => "maximized",
        SW_SHOWMINIMIZED or SW_MINIMIZE or SW_SHOWMINNOACTIVE => "minimized", _ => "other" };

    internal object? FinishMove(nint window, WindowState? after, long now, nint foreground, string date)
    {
        drags.TryGetValue(window, out Input? drag);
        var released = release; release = null;
        Forget(window);
        if (drag is null) { Diagnostic?.Invoke(WindowDiagnosticReason.DragNoSource); return null; }
        if (after is null) { Diagnostic?.Invoke(WindowDiagnosticReason.DragNoResult); return null; }
        if (drag.Before.Process != after.Process) { Diagnostic?.Invoke(WindowDiagnosticReason.DragTargetChanged); return null; }
        if (drag.Before.DisplayLayout != after.DisplayLayout) { Diagnostic?.Invoke(WindowDiagnosticReason.DragLayoutChanged); return null; }
        if (drag.Before.Monitor is null || after.Monitor is null) { Diagnostic?.Invoke(WindowDiagnosticReason.DragMonitorUnknown); return null; }
        if (after.Arranged == true)
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.DragArrangedResult);
            if (released is null) Diagnostic?.Invoke(WindowDiagnosticReason.DragReleaseUnknown);
            var placement = released is { } r ? PlacementGeometry.Drag(drag.Before, after, r.Point, r.Monitor, r.Work,
                drag.At, foreground == window && drag.Matched && !drag.Injected && !drag.Conflicted, Diagnostic) : null;
            if (placement is { monitorChanged: true })
                return !placement.shape.EndsWith("-half") && StableMove(drag.Before, after)
                    ? Compound(drag, after, placement.shape) : null;
            return placement is null ? null : new PlacementResult(drag.Transaction, "mouse", placement);
        }
        if (State(after.Show) == "maximized")
        {
            if (released is null || released.Value.Monitor != after.Monitor ||
                released.Value.Work != after.Work || after.Arranged != false ||
                State(drag.Before.Show) != "normal" || drag.Before.Arranged != false || foreground != window) return null;
            var r = released.Value;
            // A narrow edge check is a conservative implementation boundary, not a claim
            // about Windows' Snap hit regions. Interior layout selections are excluded.
            if (r.Point.X < r.Work.x || (long)r.Point.X >= (long)r.Work.x + r.Work.width ||
                r.Point.Y < r.Work.y || (long)r.Point.Y > (long)r.Work.y + 2) return null;
            if (drag.Before.Monitor != after.Monitor)
                return StableMove(drag.Before, after) && drag.Matched && !drag.Injected && !drag.Conflicted
                    ? Compound(drag, after, "maximized") : null;
            return Build("maximize", drag.Before, after, drag with { Route = "caption-top-drag" }, drag.At, true, false, date, after.Monitor);
        }
        if (drag.Before.Monitor == after.Monitor || released is null || released.Value.Monitor != after.Monitor ||
            released.Value.Work != after.Work || State(after.Show) != "normal" || after.Arranged != false ||
            !StableMove(drag.Before, after) || drag.Injected || drag.Conflicted || !drag.Matched || foreground != window) return null;
        // Drag lifetime is bounded by MOVESIZEEND; age is the input-to-start interval, not its duration.
        return Build("monitor-move", drag.Before, after, drag, drag.At, foreground == window, false, date, after.Monitor);
    }

    private static CompoundMoveResult Compound(Input drag, WindowState after, string terminal) =>
        new(drag.Transaction, drag.Before.Monitor!, after.Monitor!, terminal, drag.At,
            MoveDirection(drag.Before, after));

    private static string? MoveDirection(WindowState before, WindowState after) =>
        before.HorizontalPair && after.HorizontalPair && before.Monitor is not null && after.Monitor is not null &&
        before.Monitor.y == after.Monitor.y && before.Monitor != after.Monitor
            ? after.Monitor.x < before.Monitor.x ? "left" : "right" : null;

    internal object? Close(nint window, WindowState? previous, long now, string date)
    {
        Input? candidate = input?.Window == window ? input : null;
        Forget(window);
        if (previous is null || candidate is null || candidate.Before.Process != previous.Process ||
            candidate.Route is not ("close-button" or "alt-f4")) return null;
        return Build("close", candidate.Before, previous with { Show = 0 }, candidate, now - candidate.At, true, false, date, candidate.Before.Monitor);
    }
    internal object? Complete(nint window, WindowState? previous, WindowState after, long now,
        nint foreground, string date, MonitorBounds? monitor)
    {
        if (previous is null) return null;
        if (previous.Process != after.Process) { Forget(window); return null; }
        if (Placement.Owns(window)) return null;
        // A drag owns this transaction until its terminal result; derived transitions cannot consume it.
        if (drags.ContainsKey(window)) return null;
        string? operation = (State(previous.Show), State(after.Show)) switch {
            ("normal", "maximized") => "maximize",
            ("normal" or "maximized", "minimized") => "minimize",
            ("maximized", "normal") => "restore", _ => null };
        Input? candidate = input?.Window == window ? input : null;
        if (candidate is not null && candidate.Before.Process != after.Process) { ClearInput(); candidate = null; }
        if (candidate is { Route: "win-shift-left" or "win-shift-right" } && !moveKeyReleased) return null;
        if (candidate is { Route: "win-shift-left" or "win-shift-right" } && !StableMove(candidate.Before, after))
        { ClearInput(); return null; }
        if (candidate is { Route: "win-shift-left" or "win-shift-right" } && candidate.Before.Monitor is not null &&
            after.Monitor is not null && candidate.Before.Monitor != after.Monitor) operation = "monitor-move";
        // A move can restore/maximize the window as a side effect; consume only its terminal monitor result.
        if (candidate is { Route: "win-shift-left" or "win-shift-right" } && operation != "monitor-move") return null;
        if (operation is null) return null;
        long age = candidate is null ? -1 : now - candidate.At;
        bool recent = age >= 0 && age <= InputMatchWindowMs;
        WindowState before = recent && candidate is not null ? candidate.Before : previous;
        object result = Build(operation, before, after, candidate, age,
            operation == "minimize" || foreground == window, moving.Contains(window), date, monitor);
        if (input?.Window == window) input = null;
        // The first confirmed reduction counts immediately. A second physical Win+Down
        // on the same window within one second is the continuation of that operation.
        if (result is WindowCandidate { origin: "key", route: "win-down", injected: false,
            conflicted: false, targetMatched: true, moving: false } && candidate is not null &&
            operation is "restore" or "minimize" && before.Arranged == false && recent)
        {
            bool continuation = completedWinDown is not null && completedWinDown.Window == window &&
                completedWinDown.Before.Process == before.Process && now >= completedWinDown.At &&
                State(completedWinDown.Before.Show) == "maximized" && State(before.Show) == "normal" &&
                operation == "minimize" && candidate.At - completedWinDown.At is >= 0 and <= InputMatchWindowMs;
            completedWinDown = operation == "restore" && after.Arranged == false ? candidate : null;
            if (continuation) return null;
        }
        else completedWinDown = null;
        return result;
    }
    private object Build(string operation, WindowState before, WindowState after, Input? candidate, long age,
        bool target, bool isMoving, string date, MonitorBounds? monitor)
    {
        bool recent = candidate is not null && age is >= 0 and <= InputMatchWindowMs;
        string? direction = MoveDirection(before, after);
        return new WindowCandidate("candidate", 1, generation, checked(++sequence), before.App, operation, date,
            new(State(before.Show), before.Arranged), new(operation == "close" ? "closed" : State(after.Show)), after.Arranged,
            recent ? candidate!.Origin : "unknown", recent && candidate!.Origin != "unknown" ? candidate.Route : "unknown",
            candidate?.Injected ?? false, candidate?.Conflicted ?? false, isMoving, false,
            recent && candidate!.Matched && target, age, monitor, before.Monitor, after.Monitor, direction,
            operation == "monitor-move" && StableMove(before, after))
            { Transaction = candidate?.Transaction ?? checked(++transaction) };
    }
    private static bool StableMove(WindowState before, WindowState after) =>
        before.Process == after.Process && before.DisplayLayout is not null && before.DisplayLayout == after.DisplayLayout &&
        before.Monitor is not null && after.Monitor is not null && before.Work is not null && after.Work is not null &&
        before.Dpi > 0 && after.Dpi > 0 && State(before.Show) is "normal" or "maximized" &&
        State(after.Show) is "normal" or "maximized";
}
