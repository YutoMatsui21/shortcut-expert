using ShortcutExpert.Detection;
using static NativeMethods;
using Point = NativeMethods.Point;

// Immutable terminal observations shared by independent drag predicates. No detector result lives here.
internal sealed record DragDetectionFacts(
    WindowState Before,
    WindowState After,
    Point ReleasePoint,
    MonitorBounds ReleaseMonitor,
    MonitorBounds ReleaseWork,
    long StartAge,
    bool InputValid,
    bool Released,
    bool CaptionPress = true
)
{
    internal bool Valid =>
        InputValid
        && Released
        && StartAge is >= 0 and <= 1000
        && Before.Process == After.Process
        && Before.DisplayLayout is not null
        && Before.DisplayLayout == After.DisplayLayout
        && Before.MouseDockThresholdPx == After.MouseDockThresholdPx
        && Before.Monitor is not null
        && After.Monitor is not null
        && After.Monitor == ReleaseMonitor
        && After.Work == ReleaseWork;
}

namespace ShortcutExpert.Detection
{
    internal static class CaptionDragPlacement
    {
        internal static string? TerminalShape(DragDetectionFacts facts)
        {
            if (!facts.Valid || !facts.CaptionPress)
                return null;
            return PlacementGeometry
                .Drag(
                    facts.Before,
                    facts.After,
                    facts.ReleasePoint,
                    facts.ReleaseMonitor,
                    facts.ReleaseWork,
                    facts.StartAge,
                    true
                )
                ?.shape;
        }
    }
}

internal static partial class MonitorMoveDetector
{
    internal static IndependentMonitorMoveProof? Drag(DragDetectionFacts f)
    {
        var a = f.Before;
        var b = f.After;
        if (
            !f.Valid
            || a.Monitor == b.Monitor
            || a.Work is null
            || b.Work is null
            || a.Dpi == 0
            || b.Dpi == 0
            || a.Show is not (SW_SHOWNORMAL or SW_SHOWMAXIMIZED)
            || b.Show is not (SW_SHOWNORMAL or SW_SHOWMAXIMIZED)
        )
            return null;
        IndependentMoveDirection? direction =
            a.HorizontalPair && b.HorizontalPair && a.Monitor!.y == b.Monitor!.y
                ? b.Monitor.x < a.Monitor.x
                    ? IndependentMoveDirection.Left
                    : IndependentMoveDirection.Right
                : null;
        return new(
            IndependentMonitorMoveRoute.CaptionDrag,
            true,
            true,
            f.StartAge,
            a.Monitor!,
            b.Monitor!,
            direction,
            a.TwoDisplayPair
                && b.TwoDisplayPair
                && MonitorMovePolicy.Separate(a.Monitor!, b.Monitor!)
        );
    }
}

internal static partial class MaximizeDetector
{
    internal static IndependentStateProof? Drag(DragDetectionFacts f)
    {
        var a = f.Before;
        var b = f.After;
        var w = f.ReleaseWork;
        var p = f.ReleasePoint;
        int? tolerance = PlacementGeometry.ReleaseTolerance(a, b, 2);
        if (
            !f.Valid
            || a.Show != SW_SHOWNORMAL
            || a.Arranged is null
            || b.Show != SW_SHOWMAXIMIZED
            || b.Arranged != false
            || tolerance is null
            || p.X < w.x
            || (long)p.X >= (long)w.x + w.width
            || p.Y < w.y
            || (long)p.Y > (long)w.y + tolerance.Value
        )
            return null;
        return new(
            IndependentStateRoute.CaptionTopDrag,
            IndependentStateAction.Maximize,
            IndependentBeforeState.Normal,
            IndependentAfterState.Maximized,
            a.Arranged,
            b.Arranged,
            f.StartAge,
            b.Monitor
        );
    }
}

internal static partial class QuarterPlacementDetector
{
    internal static IndependentPlacementProof? Drag(DragDetectionFacts f)
    {
        IndependentPlacementShape? shape = CaptionDragPlacement.TerminalShape(f) switch
        {
            "left-top" => IndependentPlacementShape.LeftTop,
            "right-top" => IndependentPlacementShape.RightTop,
            "left-bottom" => IndependentPlacementShape.LeftBottom,
            "right-bottom" => IndependentPlacementShape.RightBottom,
            _ => null,
        };
        return shape is { } confirmed
            ? new(
                IndependentPlacementRoute.CaptionEdgeDrag,
                confirmed,
                true,
                true,
                f.StartAge,
                f.After.Monitor!
            )
            : null;
    }
}
