using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text;
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
    internal static object Query(JsonElement bounds, bool diagnostic = false)
    {
        try
        {
            int x = bounds.GetProperty("x").GetInt32(), y = bounds.GetProperty("y").GetInt32();
            int width = bounds.GetProperty("width").GetInt32(), height = bounds.GetProperty("height").GetInt32();
            Screen? display = Screen.AllScreens.FirstOrDefault(s => s.Bounds.X == x && s.Bounds.Y == y && s.Bounds.Width == width && s.Bounds.Height == height);
            if (display is null) return new { known = false, fullscreen = true };
            bool fullscreen = false, unknown = false;
            int covering = 0, maximizedCovering = 0, cloakedCovering = 0;
            var monitorRect = new Rect { Left = x, Top = y, Right = x + width, Bottom = y + height };
            uint own = (uint)Environment.ProcessId;
            bool enumerated = EnumWindows((window, _) =>
            {
                if (!IsWindowVisible(window) || IsIconic(window) || GetAncestor(window, GA_ROOT) != window) return true;
                GetWindowThreadProcessId(window, out uint pid);
                if (pid == own) return true;
                bool cloakKnown = DwmGetWindowAttribute(window, DWMWA_CLOAKED, out int cloaked, sizeof(int)) == 0;
                if (cloakKnown && cloaked != 0 && !diagnostic) return true;
                // Exclude desktop/taskbar classes, while retaining Explorer application windows.
                var className = new StringBuilder(128);
                if (GetClassNameW(window, className, className.Capacity) == 0) { unknown = true; return true; }
                if (className.ToString() is "Progman" or "WorkerW" or "Shell_TrayWnd" or "Shell_SecondaryTrayWnd") return true;
                bool boundsKnown = DwmGetWindowAttribute(window, DWMWA_EXTENDED_FRAME_BOUNDS, out Rect rect, (uint)Marshal.SizeOf<Rect>()) == 0;
                bool maximized = IsZoomed(window);
                bool caption = (GetWindowStyle(window, GWL_STYLE).ToInt64() & WS_CAPTION) == WS_CAPTION;
                string status = DisplayPolicy.Classify(cloakKnown, cloaked, boundsKnown, rect, monitorRect, maximized, caption);
                if (status == "unknown") unknown = true;
                if (status == "fullscreen") fullscreen = true;
                if (diagnostic && boundsKnown && rect.Left <= x + 2 && rect.Top <= y + 2 && rect.Right >= x + width - 2 && rect.Bottom >= y + height - 2)
                {
                    covering++;
                    if (maximized && caption && cloaked == 0) maximizedCovering++;
                    if (cloakKnown && cloaked != 0) cloakedCovering++;
                }
                return true;
            }, 0);
            if (diagnostic) return new { known = enumerated && !unknown, fullscreen, covering, maximizedCovering, cloakedCovering };
            return new { known = enumerated && !unknown, fullscreen };
        }
        catch { return new { known = false, fullscreen = true }; }
    }
}
