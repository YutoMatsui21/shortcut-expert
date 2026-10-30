using static NativeMethods;
using Point = NativeMethods.Point;

internal sealed record PlacementResult(int Transaction, string Origin, PlacementEvidence Evidence);

// Physical DWM frame and monitor work area; never serialize window rectangles or input sequences.
internal static class PlacementGeometry
{
    // Bounded implementation tolerance, informed by the observed 3..8px natural-input counterexample.
    // This is not a measurement or guarantee of Windows' complete Snap activation region.
    internal const int DirectSideReleaseTolerancePx = 8;
    internal static string? Shape(WindowState state, Action<WindowDiagnosticReason>? diagnostic = null)
    {
        if (state.Show != SW_SHOWNORMAL || state.Arranged != true || state.Frame is not { } f ||
            state.Work is not { } w || state.Dpi is < 48 or > 768 || w.width < 2 || w.height < 2)
        { diagnostic?.Invoke(WindowDiagnosticReason.ShapeInputInvalid); return null; }
        // Only rounding of physical coordinates is tolerated. Size-limited/free-ratio windows stay unknown.
        bool Near(long a, long b) => Math.Abs(a - b) <= 1;
        long right = (long)w.x + w.width, bottom = (long)w.y + w.height;
        long midX = (long)w.x + w.width / 2, midY = (long)w.y + w.height / 2;
        if (Near(f.x, w.x)) diagnostic?.Invoke(WindowDiagnosticReason.ShapeLeftEdge);
        if (Near((long)f.x + f.width, right)) diagnostic?.Invoke(WindowDiagnosticReason.ShapeRightEdge);
        if (Near((long)f.x + f.width, midX)) diagnostic?.Invoke(WindowDiagnosticReason.ShapeLeftEndAtMid);
        if (Near(f.x, midX)) diagnostic?.Invoke(WindowDiagnosticReason.ShapeRightStartAtMid);
        if (Near(f.y, w.y)) diagnostic?.Invoke(WindowDiagnosticReason.ShapeTop);
        if (Near((long)f.y + f.height, bottom)) diagnostic?.Invoke(WindowDiagnosticReason.ShapeBottom);
        if (Near(f.y, midY)) diagnostic?.Invoke(WindowDiagnosticReason.ShapeMidStart);
        if (Near((long)f.y + f.height, midY)) diagnostic?.Invoke(WindowDiagnosticReason.ShapeMidEnd);
        bool left = Near(f.x, w.x) && Near((long)f.x + f.width, midX);
        bool onRight = Near(f.x, midX) && Near((long)f.x + f.width, right);
        if (!left && !onRight) return null;
        string side = left ? "left" : "right";
        if (Near(f.y, w.y) && Near((long)f.y + f.height, bottom)) return side + "-half";
        if (Near(f.y, w.y) && Near((long)f.y + f.height, midY)) return side + "-top";
        if (Near(f.y, midY) && Near((long)f.y + f.height, bottom)) return side + "-bottom";
        return null;
    }
    internal static bool Compatible(WindowState a, WindowState b) => a.Process == b.Process &&
        a.DisplayLayout is not null && a.DisplayLayout == b.DisplayLayout && a.Monitor is not null && b.Monitor is not null;
    internal static PlacementEvidence? Drag(WindowState before, WindowState after, Point point,
        MonitorBounds releasedMonitor, MonitorBounds work, long age, bool matched, Action<WindowDiagnosticReason>? diagnostic = null)
    {
        string? shape = Shape(after, diagnostic);
        if (!matched) { diagnostic?.Invoke(WindowDiagnosticReason.PlacementInputUnmatched); return null; }
        if (!Compatible(before, after)) { diagnostic?.Invoke(WindowDiagnosticReason.PlacementIncompatible); return null; }
        if (before.Arranged != false || before.Show is not (SW_SHOWNORMAL or SW_SHOWMAXIMIZED))
        { diagnostic?.Invoke(WindowDiagnosticReason.PlacementStartInvalid); return null; }
        if (shape is null) { diagnostic?.Invoke(WindowDiagnosticReason.PlacementShapeUnknown); return null; }
        if (after.Monitor != releasedMonitor) { diagnostic?.Invoke(WindowDiagnosticReason.PlacementReleaseMonitorMismatch); return null; }
        if (after.Work != work) { diagnostic?.Invoke(WindowDiagnosticReason.PlacementReleaseWorkMismatch); return null; }
        if (age is < 0 or > 1000) { diagnostic?.Invoke(WindowDiagnosticReason.PlacementStartAgeInvalid); return null; }
        if (before.Monitor == after.Monitor && (before.Work != after.Work || before.Dpi != after.Dpi))
        { diagnostic?.Invoke(WindowDiagnosticReason.PlacementGeometryChanged); return null; }
        bool left = shape.StartsWith("left-");
        long edge = left ? work.x : (long)work.x + work.width - 1;
        // Conservative direct side-edge release: excludes the interior top Snap Layout selection area.
        // This is not Windows' undocumented corner hit region (see implementation evidence).
        long distance = Math.Abs((long)point.X - edge);
        diagnostic?.Invoke(distance <= 2 ? WindowDiagnosticReason.PlacementSideWithin2 : distance <= 8 ? WindowDiagnosticReason.PlacementSide3To8 :
            distance <= 32 ? WindowDiagnosticReason.PlacementSide9To32 : WindowDiagnosticReason.PlacementSideAbove32);
        if (distance > DirectSideReleaseTolerancePx) return null;
        if (point.Y < work.y || (long)point.Y >= (long)work.y + work.height) { diagnostic?.Invoke(WindowDiagnosticReason.PlacementYOutside); return null; }
        long mid = (long)work.y + work.height / 2;
        if (shape.EndsWith("-top") && point.Y >= mid || shape.EndsWith("-bottom") && point.Y < mid)
        { diagnostic?.Invoke(WindowDiagnosticReason.PlacementVerticalMismatch); return null; }
        diagnostic?.Invoke(WindowDiagnosticReason.PlacementAccepted);
        return new(shape, true, age, before.Monitor != after.Monitor, after.Monitor);
    }
}

internal sealed class PlacementPolicy
{
    private sealed record Series(nint Window, WindowState Before, int Transaction, long Started, long Last,
        string? Horizontal, string? Vertical, WindowState LastBefore);
    private Series? series;
    private bool cancelled;
    private readonly HashSet<uint> held = new();
    internal bool WinHeld => held.Contains(VK_LWIN) || held.Contains(VK_RWIN);
    internal bool Owns(nint window) => series?.Window == window;
    internal void Cancel() { if (series is not null) cancelled = true; series = null; }
    internal void Reset() { series = null; cancelled = false; held.Clear(); }
    internal void Foreground(nint window) { if (series?.Window != window) Cancel(); }
    internal void Forget(nint window) { if (Owns(window)) Cancel(); }
    internal void Released(uint key) => held.Remove(key);
    internal bool Key(nint window, WindowState? before, uint key, bool win, bool modified, long now, uint flags, Func<int> transaction)
    {
        if (key is VK_LWIN or VK_RWIN && (flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) == 0) {
            if (!WinHeld && series is null) cancelled = false;
            held.Add(key);
            return false;
        }
        bool arrow = key is VK_LEFT or VK_RIGHT or VK_UP or VK_DOWN;
        bool active = series is not null;
        if (cancelled && arrow && win) return true;
        if (!arrow || !win || modified || before is null || (flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0)
        { Cancel(); if (win && key is VK_LEFT or VK_RIGHT) cancelled = true; return active && arrow; }
        if (!held.Add(key)) return active; // repeat cannot extend a transaction or its deadline
        if (series is not null && (series.Window != window || !PlacementGeometry.Compatible(series.Before, before) ||
            series.Before.Monitor != before.Monitor || now - series.Started is < 0 or > 15000))
        { Cancel(); return true; }
        if (series is null)
        {
            string? initial = PlacementGeometry.Shape(before);
            if (key is not (VK_LEFT or VK_RIGHT) && initial is null) return false;
            if (before.Arranged == true && initial is null) { cancelled = true; return true; }
            if (before.Arranged is null || before.Monitor is null || before.DisplayLayout is null ||
                before.Show is not (SW_SHOWNORMAL or SW_SHOWMAXIMIZED)) { cancelled = true; return true; }
            series = new(window, before, transaction(), now, now,
                initial?.Split('-')[0], null, before);
        }
        series = series with { Last = now, LastBefore = before,
            Horizontal = key == VK_LEFT ? "left" : key == VK_RIGHT ? "right" : series.Horizontal,
            Vertical = key == VK_UP ? "top" : key == VK_DOWN ? "bottom" : series.Vertical };
        return true;
    }
    private bool Valid(Series pending, nint window, WindowState? after, long now, bool injected) => !injected &&
        pending.Window == window && after is not null && PlacementGeometry.Compatible(pending.Before, after) &&
        pending.Before.Monitor == after.Monitor && pending.Before.Work == after.Work && pending.Before.Dpi == after.Dpi &&
        now - pending.Started is >= 0 and <= 15000 && now - pending.Last is >= 0 and <= 1000;
    internal (WindowState Before, int Transaction, long Age)? Maximize(nint window, WindowState? after, long now, bool injected)
    {
        if (series is not { } pending || !Valid(pending, window, after, now, injected) ||
            pending.LastBefore.Show != SW_SHOWNORMAL || pending.LastBefore.Arranged is null || pending.Vertical != "top" ||
            after!.Show != SW_SHOWMAXIMIZED || after.Arranged != false) return null;
        return (pending.LastBefore, pending.Transaction, now - pending.Last);
    }
    internal PlacementResult? Finish(nint window, WindowState? after, long now, bool injected)
    {
        var pending = series; series = null; cancelled = false;
        if (pending is null || !Valid(pending, window, after, now, injected)) return null;
        string? shape = PlacementGeometry.Shape(after!);
        string? initial = PlacementGeometry.Shape(pending.Before);
        if (shape is null || shape == initial || pending.Horizontal is null || !shape.StartsWith(pending.Horizontal + "-") ||
            (shape.EndsWith("-half") ? pending.Vertical is not null : !shape.EndsWith("-" + pending.Vertical))) return null;
        return new(pending.Transaction, "key", new(shape, true, now - pending.Started, false, after!.Monitor));
    }
}
