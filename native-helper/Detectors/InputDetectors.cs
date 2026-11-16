using static NativeMethods;

internal static class InputDetectionFacts
{
    internal static bool MoveContext(WindowState before, WindowState after) =>
        before.Process == after.Process
        && SameDisplayLayout(before, after)
        && KnownMoveGeometry(before)
        && KnownMoveGeometry(after);

    private static bool SameDisplayLayout(WindowState a, WindowState b) =>
        a.DisplayLayout is not null && a.DisplayLayout == b.DisplayLayout;

    private static bool KnownMoveGeometry(WindowState state) =>
        state
            is {
                HasCaption: true,
                Monitor: not null,
                Work: not null,
                Dpi: > 0,
                Show: SW_SHOWNORMAL or SW_SHOWMAXIMIZED,
            };

    internal static bool Valid(
        GestureManager.Input input,
        WindowState after,
        long at,
        long limit = 1000
    ) =>
        input is { Injected: false, Conflicted: false, Matched: true }
        && input.Before.Process == after.Process
        && Recent(input, at, limit);

    private static bool Recent(GestureManager.Input input, long at, long limit) =>
        at - input.At >= 0 && at - input.At <= limit;
}

internal static partial class MonitorMoveDetector
{
    internal static IndependentMonitorMoveProof? Key(
        GestureManager.Input input,
        WindowState after,
        long at
    )
    {
        var before = input.Before;
        if (
            !InputDetectionFacts.Valid(input, after, at)
            || !InputDetectionFacts.MoveContext(before, after)
            || before.Monitor == after.Monitor
            || input.Route is not ("win-shift-left" or "win-shift-right")
        )
            return null;
        var direction = HorizontalDirection(before, after);
        return new(
            input.Route == "win-shift-left"
                ? IndependentMonitorMoveRoute.WinShiftLeft
                : IndependentMonitorMoveRoute.WinShiftRight,
            true,
            true,
            at - input.At,
            before.Monitor!,
            after.Monitor!,
            direction,
            TwoDisplayLayout(before, after)
        );
    }

    private static IndependentMoveDirection? HorizontalDirection(
        WindowState before,
        WindowState after
    )
    {
        if (
            !before.HorizontalPair
            || !after.HorizontalPair
            || before.Monitor!.y != after.Monitor!.y
        )
            return null;
        return after.Monitor!.x < before.Monitor!.x
            ? IndependentMoveDirection.Left
            : IndependentMoveDirection.Right;
    }

    private static bool TwoDisplayLayout(WindowState before, WindowState after) =>
        before.TwoDisplayPair
        && after.TwoDisplayPair
        && MonitorMovePolicy.Separate(before.Monitor!, after.Monitor!);
}

internal static partial class MaximizeDetector
{
    internal static IndependentStateProof? Key(
        GestureManager.Input? input,
        WindowState after,
        long at
    ) =>
        input is { Route: "win-up" }
        && InputDetectionFacts.Valid(input, after, at)
        && MaximizeTransition(input.Before, after)
            ? Proof(input, after, IndependentStateRoute.WinUp, at - input.At)
            : null;

    internal static IndependentStateProof? Click(
        GestureManager.Input input,
        WindowState after,
        long at,
        bool stationary
    )
    {
        if (
            !stationary
            || !InputDetectionFacts.Valid(input, after, at, input.Route == "unknown" ? 500 : 1000)
            || !KnownMouseTransition(input.Before, after)
        )
            return null;
        var route = ClickRoute(input.Route);
        return route is { } known ? Proof(input, after, known, at - input.At) : null;
    }

    private static IndependentStateRoute? ClickRoute(string route) =>
        route switch
        {
            "max-button" => IndependentStateRoute.MaxButton,
            "caption-double-click" => IndependentStateRoute.CaptionDoubleClick,
            "unknown" => IndependentStateRoute.MouseStateFallback,
            _ => null,
        };

    private static bool MaximizeTransition(WindowState before, WindowState after) =>
        before.Show == SW_SHOWNORMAL && after.Show == SW_SHOWMAXIMIZED;

    private static bool KnownMouseTransition(WindowState before, WindowState after) =>
        before.Arranged is not null && MaximizeTransition(before, after);

    private static IndependentStateProof Proof(
        GestureManager.Input input,
        WindowState after,
        IndependentStateRoute route,
        long age
    ) =>
        new(
            route,
            IndependentStateAction.Maximize,
            IndependentBeforeState.Normal,
            IndependentAfterState.Maximized,
            input.Before.Arranged,
            after.Arranged,
            age,
            after.Monitor
        );
}

internal static partial class QuarterPlacementDetector
{
    internal static IndependentPlacementProof? Key(KeyGestureSeries.TerminalFacts f)
    {
        string? shape = PlacementGeometry.Shape(f.After);
        if (
            shape is null
            || shape == PlacementGeometry.Shape(f.Before)
            || !MatchesDirections(f, shape)
        )
            return null;
        IndependentPlacementShape? quarter = shape switch
        {
            "left-top" => IndependentPlacementShape.LeftTop,
            "right-top" => IndependentPlacementShape.RightTop,
            "left-bottom" => IndependentPlacementShape.LeftBottom,
            "right-bottom" => IndependentPlacementShape.RightBottom,
            _ => null,
        };
        return quarter is { } confirmed
            ? new(
                IndependentPlacementRoute.WinHeldArrows,
                confirmed,
                true,
                true,
                f.Age,
                f.After.Monitor!
            )
            : null;
    }

    private static bool MatchesDirections(KeyGestureSeries.TerminalFacts f, string shape) =>
        HorizontalMatches(f, shape) && VerticalMatches(f, shape);

    private static bool HorizontalMatches(KeyGestureSeries.TerminalFacts f, string shape) =>
        f.Horizontal is not null && shape.StartsWith(f.Horizontal + "-");

    private static bool VerticalMatches(KeyGestureSeries.TerminalFacts f, string shape) =>
        f.Vertical is not null && shape.EndsWith("-" + f.Vertical);
}

internal static partial class HalfPlacementDetector
{
    internal static IndependentPlacementProof? Key(KeyGestureSeries.TerminalFacts f)
    {
        string? shape = PlacementGeometry.Shape(f.After);
        if (
            shape == PlacementGeometry.Shape(f.Before)
            || f.Horizontal is null
            || f.Vertical is not null
            || shape != f.Horizontal + "-half"
        )
            return null;
        return Proof(shape, IndependentPlacementRoute.WinHeldArrows, f.Age, f.After.Monitor);
    }
}
