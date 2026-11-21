using ShortcutExpert.Detection;
using static NativeMethods;

internal static partial class HalfPlacementDetector
{
    internal static IndependentPlacementProof? Drag(DragDetectionFacts f) =>
        Proof(
            CaptionDragPlacement.TerminalShape(f),
            IndependentPlacementRoute.CaptionEdgeDrag,
            f.StartAge,
            f.After.Monitor
        );

    private static IndependentPlacementProof? Proof(
        string? shape,
        IndependentPlacementRoute route,
        long age,
        MonitorBounds? monitor
    )
    {
        IndependentPlacementShape? half = shape switch
        {
            "left-half" => IndependentPlacementShape.LeftHalf,
            "right-half" => IndependentPlacementShape.RightHalf,
            _ => null,
        };
        return half is { } confirmed && monitor is not null
            ? new(route, confirmed, true, true, age, monitor)
            : null;
    }
}

internal static partial class HalfPlacementDetector
{
    internal static IndependentPlacementProof? Key(KeyGestureSeries.TerminalFacts f)
    {
        string? shape = PlacementGeometry.Shape(f.After);
        if (shape == PlacementGeometry.Shape(f.Before) || !MatchesHalfDirections(f, shape))
            return null;
        return Proof(shape, IndependentPlacementRoute.WinHeldArrows, f.Age, f.After.Monitor);
    }

    private static bool MatchesHalfDirections(KeyGestureSeries.TerminalFacts f, string? shape) =>
        f.Horizontal is not null && f.Vertical is null && shape == f.Horizontal + "-half";
}
