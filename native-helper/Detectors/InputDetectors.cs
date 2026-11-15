using static NativeMethods;

internal static class InputDetectionFacts
{
    internal static bool MoveContext(WindowState before, WindowState after) =>
        before.HasCaption
        && after.HasCaption
        && before.Process == after.Process
        && before.DisplayLayout is not null
        && before.DisplayLayout == after.DisplayLayout
        && before.Monitor is not null
        && after.Monitor is not null
        && before.Work is not null
        && after.Work is not null
        && before.Dpi > 0
        && after.Dpi > 0
        && before.Show is SW_SHOWNORMAL or SW_SHOWMAXIMIZED
        && after.Show is SW_SHOWNORMAL or SW_SHOWMAXIMIZED;

    internal static bool Valid(
        GestureManager.Input input,
        WindowState after,
        long at,
        long limit = 1000
    ) =>
        !input.Injected
        && !input.Conflicted
        && input.Matched
        && input.Before.Process == after.Process
        && at - input.At is >= 0
        && at - input.At <= limit;
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
        IndependentMoveDirection? direction =
            before.HorizontalPair && after.HorizontalPair && before.Monitor!.y == after.Monitor!.y
                ? after.Monitor!.x < before.Monitor!.x
                    ? IndependentMoveDirection.Left
                    : IndependentMoveDirection.Right
                : null;
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
            before.TwoDisplayPair
                && after.TwoDisplayPair
                && MonitorMovePolicy.Separate(before.Monitor!, after.Monitor!)
        );
    }
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
        && input.Before.Show == SW_SHOWNORMAL
        && after.Show == SW_SHOWMAXIMIZED
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
            || input.Before.Show != SW_SHOWNORMAL
            || input.Before.Arranged is null
            || after.Show != SW_SHOWMAXIMIZED
        )
            return null;
        IndependentStateRoute? route = input.Route switch
        {
            "max-button" => IndependentStateRoute.MaxButton,
            "caption-double-click" => IndependentStateRoute.CaptionDoubleClick,
            "unknown" => IndependentStateRoute.MouseStateFallback,
            _ => null,
        };
        return route is { } known ? Proof(input, after, known, at - input.At) : null;
    }

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
            || f.Horizontal is null
            || !shape.StartsWith(f.Horizontal + "-")
            || f.Vertical is null
            || !shape.EndsWith("-" + f.Vertical)
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
}
