using static NativeMethods;

// General window eligibility is independent of executable names. The category is fixed wire data.
internal static class WindowTargetPolicy
{
    internal const string ApplicationCategory = "ordinary-window";
    // Only a live Win+Up candidate supplies expectedProcess. Caption may disappear on maximization.
    internal static bool AllowsMaximizeResult(uint process, uint expectedProcess, uint selfProcess, long? style, long? extended,
        bool owned, bool? cloaked, string? windowClass, bool ordinary) => process == expectedProcess &&
        style is { } knownStyle && extended is { } knownExtended &&
        AllowsTarget(process, selfProcess, knownStyle, knownExtended, owned, cloaked, windowClass, ordinary);
    internal static bool Allows(uint process, uint selfProcess, long style, long extended, bool owned,
        bool? cloaked, string? windowClass, bool ordinary) => (style & WS_CAPTION) == WS_CAPTION &&
        AllowsTarget(process, selfProcess, style, extended, owned, cloaked, windowClass, ordinary);
    private static bool AllowsTarget(uint process, uint selfProcess, long style, long extended, bool owned,
        bool? cloaked, string? windowClass, bool ordinary) =>
        process != 0 && process != selfProcess && ordinary && !owned && cloaked == false &&
        (style & 0x40000000) == 0 &&
        (extended & (0x80 | 0x08000000)) == 0 && !string.IsNullOrEmpty(windowClass) &&
        windowClass is not ("Shell_TrayWnd" or "Shell_SecondaryTrayWnd" or "Progman" or "WorkerW" or
            "XamlExplorerHostIslandWindow" or "MultitaskingViewFrame");
}
