using static NativeMethods;
using Point = NativeMethods.Point;

internal sealed record WindowState(uint Process, string App, uint Show, bool? Arranged);

// Same candidate construction for live callbacks and isolated event-sequence tests.
// Windows reads, hooks and input payload lifetimes remain in Observer.
internal sealed class CandidateTracker
{
    private const long InputMatchWindowMs = 1000;
    private const int CaptionDoubleClickDistancePx = 4;
    private const long NoCaptionClickAt = -10000;
    private sealed record Input(nint Window, WindowState Before, string Origin, string Route,
        long At, bool Injected, bool Conflicted, bool Matched);
    private readonly HashSet<nint> moving = new();
    private Input? input;
    private nint lastCaption;
    private uint lastCaptionProcess;
    private long lastCaptionAt = NoCaptionClickAt;
    private Point lastCaptionPoint;
    private int generation, sequence;

    internal void Reset(int newGeneration)
    {
        generation = newGeneration; sequence = 0; moving.Clear(); input = null;
        lastCaption = 0; lastCaptionAt = NoCaptionClickAt;
    }
    internal void ClearInput() => input = null;
    internal void Forget(nint window)
    {
        moving.Remove(window);
        if (input?.Window == window) input = null;
        if (lastCaption == window) { lastCaption = 0; lastCaptionAt = NoCaptionClickAt; }
    }
    internal void MoveStart(nint window)
    {
        moving.Add(window);
        if (input?.Window == window) input = input with { Conflicted = true };
    }
    internal void MoveEnd(nint window) => Forget(window);
    internal static bool IsModifier(uint key) => key is VK_LWIN or VK_RWIN or VK_SHIFT or VK_CONTROL or VK_MENU or
        VK_LSHIFT or VK_RSHIFT or VK_LCONTROL or VK_RCONTROL or VK_LMENU or VK_RMENU;

    internal void Mouse(nint window, WindowState before, int hit, Point point, long now,
        uint doubleClickTime, uint flags, bool modifiers, bool foreground)
    {
        string route = hit == HTMAXBUTTON ? "max-button" : "unknown";
        if (hit == HTCAPTION && lastCaption == window && lastCaptionProcess == before.Process && now - lastCaptionAt <= doubleClickTime &&
            Math.Abs(point.X - lastCaptionPoint.X) <= CaptionDoubleClickDistancePx &&
            Math.Abs(point.Y - lastCaptionPoint.Y) <= CaptionDoubleClickDistancePx)
            route = "caption-double-click";
        lastCaption = hit == HTCAPTION ? window : 0; lastCaptionProcess = before.Process;
        lastCaptionAt = now; lastCaptionPoint = point;
        input = new Input(window, before, route == "unknown" ? "unknown" : "mouse", route, now,
            (flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED)) != 0, modifiers, foreground);
    }
    internal void Key(nint window, WindowState? before, uint key, bool winDown, bool modifiers, long now, uint flags)
    {
        bool conflict = input is not null && input.Origin == "mouse" && now - input.At <= InputMatchWindowMs;
        if (IsModifier(key)) { if (input is not null) input = input with { Conflicted = true }; return; }
        if (key != VK_UP || !winDown || modifiers || before is null) { input = null; return; }
        input = new Input(window, before, "key", "win-up", now,
            (flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0, conflict, true);
    }
    internal object? Complete(nint window, WindowState? previous, WindowState after, long now,
        nint foreground, string date, object? monitor)
    {
        if (previous is null || previous.Show != SW_SHOWNORMAL || after.Show != SW_SHOWMAXIMIZED) return null;
        if (previous.Process != after.Process) { Forget(window); return null; }
        Input? candidate = input?.Window == window ? input : null;
        if (candidate is not null && candidate.Before.Process != after.Process) { ClearInput(); candidate = null; }
        long age = candidate is null ? -1 : now - candidate.At;
        bool recent = age >= 0 && age <= InputMatchWindowMs;
        WindowState before = recent && candidate is not null ? candidate.Before : previous;
        object result = new { type = "candidate", protocolVersion = 1, generation, sequence = ++sequence,
            app = after.App, operation = "maximize", date,
            before = new { state = before.Show == SW_SHOWNORMAL ? "normal" : "other", arranged = before.Arranged },
            after = new { state = "maximized" }, origin = recent ? candidate!.Origin : "unknown",
            route = recent ? candidate!.Route : "unknown", injected = candidate?.Injected ?? false,
            conflicted = candidate?.Conflicted ?? false, moving = moving.Contains(window), elevated = false,
            targetMatched = recent && candidate!.Matched && foreground == window,
            inputAgeMs = age, monitor };
        if (input?.Window == window) input = null;
        return result;
    }
}
