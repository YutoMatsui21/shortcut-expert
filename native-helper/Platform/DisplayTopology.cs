using System.Runtime.InteropServices;
using static NativeMethods;

namespace ShortcutExpert.Detection;

internal static class DisplayTopology
{
    internal delegate bool EnumerateDisplays(MonitorEnum callback);
    internal delegate bool ReadMonitor(nint monitor, ref MonitorInfo info);
    internal delegate int ReadScale(nint monitor, out int scale);

    // Read Win32 directly: the WinForms Screen cache can still describe the old layout
    // when a taskbar UIA result arrives ahead of display invalidation.
    internal static string? Read() =>
        Read(
            callback => EnumDisplayMonitors(0, 0, callback, 0),
            GetMonitorInfoW,
            GetScaleFactorForMonitor
        );

    internal static string? Read(
        EnumerateDisplays enumerate,
        ReadMonitor readMonitor,
        ReadScale readScale
    )
    {
        var monitors = new List<string>();
        bool complete = enumerate(
            (monitor, _, _, _) =>
            {
                var info = new MonitorInfo { Size = (uint)Marshal.SizeOf<MonitorInfo>() };
                if (!readMonitor(monitor, ref info) || readScale(monitor, out int scale) != 0)
                    return false;
                monitors.Add(
                    $"{monitor}:{info.Flags}:{Bounds(info.Monitor)}:{Bounds(info.Work)}:{scale}"
                );
                return true;
            }
        );
        return complete && monitors.Count > 0
            ? string.Join(";", monitors.Order(StringComparer.Ordinal))
            : null;
    }

    private static string Bounds(Rect rect) => $"{rect.Left},{rect.Top},{rect.Right},{rect.Bottom}";
}
