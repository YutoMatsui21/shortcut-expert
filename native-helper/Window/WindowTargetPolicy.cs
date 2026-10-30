using static NativeMethods;

// General window eligibility is independent of executable names. The category is fixed wire data.
internal static class WindowTargetPolicy
{
    internal const string ApplicationCategory = "ordinary-window";
    internal static bool Allows(uint process, uint selfProcess, long style, long extended, bool owned,
        bool? cloaked, string? windowClass, bool ordinary) =>
        process != 0 && process != selfProcess && ordinary && !owned && cloaked == false &&
        (style & 0x40000000) == 0 && (style & WS_CAPTION) == WS_CAPTION &&
        (extended & (0x80 | 0x08000000)) == 0 && !string.IsNullOrEmpty(windowClass) &&
        windowClass is not ("Shell_TrayWnd" or "Shell_SecondaryTrayWnd" or "Progman" or "WorkerW" or
            "XamlExplorerHostIslandWindow" or "MultitaskingViewFrame");
}
