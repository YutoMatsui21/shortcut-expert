internal static class MonitorMovePolicy
{
    internal static bool Separate(MonitorBounds a, MonitorBounds b) =>
        a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0 &&
        ((long)a.x + a.width <= b.x || (long)b.x + b.width <= a.x ||
         (long)a.y + a.height <= b.y || (long)b.y + b.height <= a.y);
    internal static bool TwoDisplays(IReadOnlyList<MonitorBounds> displays) =>
        displays.Count == 2 && Separate(displays[0], displays[1]);
}
