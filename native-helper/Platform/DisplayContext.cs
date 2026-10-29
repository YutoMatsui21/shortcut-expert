using System.Runtime.InteropServices;
using System.Windows.Forms;
using static NativeMethods;

internal static class DisplayContext
{
    internal static MonitorBounds? Monitor(nint window)
    {
        var info = new MonitorInfo { Size = (uint)Marshal.SizeOf<MonitorInfo>() };
        if (!GetMonitorInfoW(MonitorFromWindow(window, MONITOR_DEFAULTTONULL), ref info)) return null;
        Rect r = info.Monitor;
        return new MonitorBounds(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
    }
    internal static bool HorizontalPair()
    {
        var displays = Screen.AllScreens;
        if (displays.Length != 2) return false;
        var a = displays[0].Bounds; var b = displays[1].Bounds;
        return a.Top == b.Top && (a.Right <= b.Left || b.Right <= a.Left);
    }
    internal static string Layout() => string.Join(";", Screen.AllScreens.OrderBy(screen => screen.Bounds.X).ThenBy(screen => screen.Bounds.Y)
        .Select(screen => $"{screen.Bounds.X},{screen.Bounds.Y},{screen.Bounds.Width},{screen.Bounds.Height}:" +
            $"{screen.WorkingArea.X},{screen.WorkingArea.Y},{screen.WorkingArea.Width},{screen.WorkingArea.Height}"));
    internal static MonitorBounds? Bounds(nint window) => Monitor(window);
}
