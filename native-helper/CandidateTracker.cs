using static NativeMethods;
using Point = NativeMethods.Point;

internal sealed record MonitorBounds(int x, int y, int width, int height);
internal sealed record WindowState(uint Process, string App, uint Show, bool? Arranged,
    MonitorBounds? Monitor = null, bool HorizontalPair = false, string? DisplayLayout = null);

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
    private Input? input;
    private nint lastCaption;
    private uint lastCaptionProcess;
    private long lastCaptionAt = NoCaptionClickAt;
    private Point lastCaptionPoint;
    private int generation, sequence, transaction;
    internal int NextTransaction() => checked(++transaction);

    internal void Reset(int newGeneration)
    {
        generation = newGeneration; sequence = 0; transaction = 0; moving.Clear(); drags.Clear(); input = null;
        lastCaption = 0; lastCaptionAt = NoCaptionClickAt;
    }
    internal void ClearInput() { input = null; drags.Clear(); }
    internal void Forget(nint window)
    {
        moving.Remove(window);
        drags.Remove(window);
        if (input?.Window == window) input = null;
        if (lastCaption == window) { lastCaption = 0; lastCaptionAt = NoCaptionClickAt; }
    }
    internal void MoveStart(nint window, long now = 0)
    {
        moving.Add(window);
        if (input is { Route: "caption-press" } && input.Window == window && now - input.At is >= 0 and <= InputMatchWindowMs)
            drags[window] = input with { Origin = "mouse", Route = "caption-drag", At = now - input.At };
        if (input?.Window == window) input = input with { Conflicted = true };
    }
    internal void MoveEnd(nint window) => Forget(window);
    internal static bool IsModifier(uint key) => key is VK_LWIN or VK_RWIN or VK_SHIFT or VK_CONTROL or VK_MENU or
        VK_LSHIFT or VK_RSHIFT or VK_LCONTROL or VK_RCONTROL or VK_LMENU or VK_RMENU;

    internal void Mouse(nint window, WindowState before, int hit, Point point, long now,
        uint doubleClickTime, uint flags, bool modifiers, bool foreground)
    {
        drags.Clear();
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
        bool conflict = input is not null && input.Origin == "mouse" && now - input.At <= InputMatchWindowMs;
        if (IsModifier(key)) { if (input is not null) input = input with { Conflicted = true }; return; }
        string? route = KeyRoute(key, winDown, shiftDown, altDown, modifiers);
        if (route is null || before is null) { input = null; return; }
        input = new Input(window, before, "key", route, now,
            (flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0, conflict, true, checked(++transaction));
    }
    internal static string? KeyRoute(uint key, bool win, bool shift, bool alt, bool other) => other ? null :
        (key, win, shift, alt) switch {
            (VK_UP, true, false, false) => "win-up", (VK_DOWN, true, false, false) => "win-down",
            (VK_LEFT, true, true, false) => "win-shift-left", (VK_RIGHT, true, true, false) => "win-shift-right",
            (VK_F4, false, false, true) => "alt-f4", _ => null };
    internal static string State(uint show) => show switch {
        SW_SHOWNORMAL => "normal", SW_SHOWMAXIMIZED => "maximized",
        SW_SHOWMINIMIZED or SW_MINIMIZE or SW_SHOWMINNOACTIVE => "minimized", _ => "other" };

    internal object? FinishMove(nint window, WindowState? after, long now, nint foreground, string date)
    {
        drags.TryGetValue(window, out Input? drag);
        Forget(window);
        if (drag is null || after is null || drag.Before.Process != after.Process ||
            drag.Before.DisplayLayout != after.DisplayLayout || drag.Before.Monitor is null || after.Monitor is null || drag.Before.Monitor == after.Monitor) return null;
        // Drag lifetime is bounded by MOVESIZEEND; age is the input-to-start interval, not its duration.
        return Build("monitor-move", drag.Before, after, drag, drag.At, foreground == window, false, date, after.Monitor);
    }

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
        // A drag owns this transaction until its terminal result; derived transitions cannot consume it.
        if (drags.ContainsKey(window)) return null;
        string? operation = (State(previous.Show), State(after.Show)) switch {
            ("normal", "maximized") => "maximize",
            ("normal" or "maximized", "minimized") => "minimize",
            ("maximized", "normal") => "restore", _ => null };
        Input? candidate = input?.Window == window ? input : null;
        if (candidate is not null && candidate.Before.Process != after.Process) { ClearInput(); candidate = null; }
        if (candidate is { Route: "win-shift-left" or "win-shift-right" } && candidate.Before.DisplayLayout != after.DisplayLayout)
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
        return result;
    }
    private object Build(string operation, WindowState before, WindowState after, Input? candidate, long age,
        bool target, bool isMoving, string date, MonitorBounds? monitor)
    {
        bool recent = candidate is not null && age is >= 0 and <= InputMatchWindowMs;
        string? direction = before.HorizontalPair && after.HorizontalPair && before.Monitor is not null && after.Monitor is not null
            && before.Monitor.y == after.Monitor.y && before.Monitor != after.Monitor
            ? after.Monitor.x < before.Monitor.x ? "left" : "right" : null;
        return new WindowCandidate("candidate", 1, generation, checked(++sequence), before.App, operation, date,
            new(State(before.Show), before.Arranged), new(operation == "close" ? "closed" : State(after.Show)), after.Arranged,
            recent ? candidate!.Origin : "unknown", recent && candidate!.Origin != "unknown" ? candidate.Route : "unknown",
            candidate?.Injected ?? false, candidate?.Conflicted ?? false, isMoving, false,
            recent && candidate!.Matched && target, age, monitor, before.Monitor, after.Monitor, direction)
            { Transaction = candidate?.Transaction ?? checked(++transaction) };
    }
}
