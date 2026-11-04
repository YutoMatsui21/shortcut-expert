using static NativeMethods;

internal static class WindowDockSettings
{
    // SPI_GETMOUSEDOCKTHRESHOLD is documented in pixels, but SystemParametersInfo is not per-monitor-DPI aware.
    // Query in a scoped system-aware context; ForDpi does not support this action. Never set a Windows preference.
    internal static int? ReadMouseDockThreshold() =>
        Read(
            SetThreadDpiAwarenessContext,
            () => SystemParametersInfoW(0x007E, 0, out int value, 0) ? value : null
        );

    internal static int? Read(Func<nint, nint> setContext, Func<int?> query)
    {
        nint previous = setContext(-2);
        if (previous == 0)
            return null;
        try
        {
            return PlacementGeometry.NormalizeMouseDockThreshold(query());
        }
        finally
        {
            setContext(previous);
        }
    }
}
