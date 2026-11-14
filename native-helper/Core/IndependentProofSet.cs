// Semantic categories supply stable ordering and conflict boundaries, never
// product operation IDs, detector priority or an allowlist of combinations.
internal static class IndependentProofSet
{
    private enum Category
    {
        Switch,
        MonitorMove,
        Maximize,
        RestoreOrMinimize,
        Half,
        Quarter,
        Close,
        Taskbar,
    }

    // These proof kinds each represent one category. State and placement have
    // category-bearing variants, handled separately below.
    private static readonly IReadOnlyDictionary<Type, Category> singleCategories = new Dictionary<
        Type,
        Category
    >
    {
        [typeof(IndependentSwitchProof)] = Category.Switch,
        [typeof(IndependentMonitorMoveProof)] = Category.MonitorMove,
        [typeof(IndependentCloseProof)] = Category.Close,
        [typeof(IndependentTaskbarProof)] = Category.Taskbar,
    };

    internal static IndependentProof[] Select(IEnumerable<IndependentProof> proofs) =>
        proofs
            .GroupBy(CategoryOf)
            .OrderBy(group => group.Key)
            .Select(group => group.Distinct().ToArray())
            .Where(group => group.Length == 1)
            .Select(group => group[0])
            .ToArray();

    private static Category CategoryOf(IndependentProof proof)
    {
        if (proof is IndependentStateProof state)
            return StateCategory(state);
        if (proof is IndependentPlacementProof placement)
            return PlacementCategory(placement);
        if (singleCategories.TryGetValue(proof.GetType(), out var category))
            return category;
        throw new ArgumentException("Unsupported proof", nameof(proof));
    }

    private static Category StateCategory(IndependentStateProof proof) =>
        proof.action == IndependentStateAction.Maximize
            ? Category.Maximize
            : Category.RestoreOrMinimize;

    private static Category PlacementCategory(IndependentPlacementProof proof) =>
        proof.shape is IndependentPlacementShape.LeftHalf or IndependentPlacementShape.RightHalf
            ? Category.Half
            : Category.Quarter;
}
