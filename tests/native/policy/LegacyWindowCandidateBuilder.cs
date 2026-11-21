// Serialization inputs for the pre-migration window candidate shape.
internal sealed partial class CandidateTracker
{
    private int generation,
        sequence;

    internal bool IndependentResults { get; set; }

    partial void ReadBaselineMode(ref bool legacy) => legacy = !IndependentResults;

    partial void ResetBaseline(int nextGeneration)
    {
        generation = nextGeneration;
        sequence = 0;
    }

    private WindowCandidate Build(
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
        bool recent = RecentInput(candidate, age);
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

    private static bool TwoDisplayLayout(
        WindowState before,
        WindowState after,
        bool requireCaption = true
    ) =>
        before.TwoDisplayPair
        && after.TwoDisplayPair
        && StableMove(before, after, requireCaption)
        && MonitorMovePolicy.Separate(before.Monitor!, after.Monitor!);

    private static bool RecentInput(GestureManager.Input? candidate, long age) =>
        candidate is not null && age is >= 0 and <= InputMatchWindowMs;

    private static bool StableMove(
        WindowState before,
        WindowState after,
        bool requireCaption = true
    ) =>
        CompatibleMoveTarget(before, after, requireCaption)
        && HasMoveGeometry(before)
        && HasMoveGeometry(after);

    private static bool CompatibleMoveTarget(
        WindowState before,
        WindowState after,
        bool requireCaption
    ) =>
        (!requireCaption || before.HasCaption && after.HasCaption)
        && before.Process == after.Process
        && before.DisplayLayout is not null
        && before.DisplayLayout == after.DisplayLayout;

    private static bool HasMoveGeometry(WindowState value) =>
        value.Monitor is not null
        && value.Work is not null
        && value.Dpi > 0
        && State(value.Show) is "normal" or "maximized";
}
