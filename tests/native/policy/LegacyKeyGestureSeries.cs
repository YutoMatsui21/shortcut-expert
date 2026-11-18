// Legacy placement evidence used by v2 baseline fixtures.
internal sealed partial class KeyGestureSeries
{
    internal PlacementResult? Finish(nint window, WindowState? after, long now, bool injected)
    {
        var pending = RetireSeries(window, after, now, injected);
        if (pending is null)
            return null;
        string? shape = PlacementGeometry.Shape(after!);
        string? initial = PlacementGeometry.Shape(pending.Before);
        if (
            shape is null
            || shape == initial
            || pending.Horizontal is null
            || !shape.StartsWith(pending.Horizontal + "-")
            || (
                shape.EndsWith("-half")
                    ? pending.Vertical is not null
                    : !shape.EndsWith("-" + pending.Vertical)
            )
        )
            return null;
        return new(
            pending.Transaction,
            "key",
            new(shape, true, now - pending.Started, false, after!.Monitor)
        );
    }
}
