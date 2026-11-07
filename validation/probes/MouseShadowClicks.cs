using static NativeMethods;
using Point = NativeMethods.Point;

internal static class MouseShadowClicks
{
    internal sealed record Press(
        WindowState Before,
        int Hit,
        Point Point,
        long At,
        long Up,
        bool SameTarget = true,
        bool Injected = false,
        bool Conflict = false,
        bool Dragged = false,
        Point? FurthestPoint = null,
        bool ForegroundAtPress = true
    );

    internal sealed record Comparison(
        string[] Standard,
        string[] Fallback,
        string[] Double,
        string Reason
    );

    internal static Comparison Compare(
        IReadOnlyList<Press> presses,
        WindowState after,
        long at,
        uint doubleTime,
        int width,
        int height,
        bool foregroundAtResult = true
    )
    {
        if (presses.Count is < 1 or > 2)
            return new([], [], [], "click-count");
        var tracker = new CandidateTracker();
        tracker.Reset(1);
        WindowCandidate? result = null;
        for (int i = 0; i < presses.Count; i++)
        {
            var p = presses[i];
            tracker.Mouse(
                p.SameTarget ? 11 : 12,
                p.Before,
                p.Hit,
                p.Point,
                p.At,
                doubleTime,
                p.Injected ? 1u : 0u,
                p.Conflict,
                p.ForegroundAtPress
            );
            if (p.FurthestPoint is { } moved)
                tracker.MouseMoved(moved, 0);
            if (p.Dragged)
                tracker.MoveStart(11, p.At + 1);
            if (p.Up >= p.At)
                tracker.MouseReleased(p.Point, null, null, p.Injected ? 1u : 0u);
            result =
                tracker.Complete(
                    11,
                    p.Before,
                    i + 1 < presses.Count ? presses[i + 1].Before : after,
                    i + 1 < presses.Count ? p.Up : at,
                    foregroundAtResult ? 11 : 12,
                    "2026-11-07",
                    null
                ) as WindowCandidate;
        }
        var last = presses[^1];
        string? operation = (last.Before.Show, after.Show) switch
        {
            (SW_SHOWNORMAL, SW_SHOWMAXIMIZED) => "W03",
            (SW_SHOWMAXIMIZED, SW_SHOWNORMAL) when after.Arranged == false => "W04",
            (SW_SHOWNORMAL or SW_SHOWMAXIMIZED, SW_SHOWMINIMIZED) => "W04",
            _ => null,
        };
        bool accepted =
            result is { targetMatched: true, injected: false, conflicted: false, moving: false }
            && result.origin == "mouse"
            && operation is not null
            && last.SameTarget;
        string[] standard = accepted && result!.route != "mouse-state-fallback" ? [operation!] : [];
        string[] fallback = accepted && result!.route == "mouse-state-fallback" ? [operation!] : [];
        bool two = presses.Count == 2;
        var first = presses[0];
        var facts = new MouseDetectionShadow.Click(
            foregroundAtResult
                && presses.All(p =>
                    p.SameTarget && p.ForegroundAtPress && p.Before.Process == after.Process
                ),
            two && presses.All(p => p.Up >= p.At && p.Up <= at) && first.Up < last.At,
            Math.Abs((long)first.Point.X - last.Point.X) * 2 <= width
                && Math.Abs((long)first.Point.Y - last.Point.Y) * 2 <= height,
            two && last.At - first.At >= 0 && last.At - first.At <= doubleTime,
            presses.Any(p => p.Conflict),
            presses.Any(p =>
                p.Dragged
                || p.FurthestPoint is { } f
                    && (Math.Abs((long)f.X - p.Point.X) > 4 || Math.Abs((long)f.Y - p.Point.Y) > 4)
            ),
            presses.Any(p => p.Injected),
            operation is not null,
            first.Before.Show != last.Before.Show
                || first.Before.Arranged != last.Before.Arranged
                || first.Before.Monitor != last.Before.Monitor
                || PlacementGeometry.Shape(first.Before) != PlacementGeometry.Shape(last.Before),
            at - last.At is >= 0 and <= 500
        );
        var shadow = MouseDetectionShadow.DoubleClick(facts);
        return new(
            standard,
            fallback,
            shadow.Operations.Length > 0 ? [operation!] : [],
            shadow.Reason
        );
    }
}
