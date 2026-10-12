using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text;
using System.Windows.Forms;
using static NativeMethods;

internal static class DisplayContext
{
    internal static object? Bounds(nint window)
    {
        var info = new MonitorInfo { Size = (uint)Marshal.SizeOf<MonitorInfo>() };
        if (!GetMonitorInfoW(MonitorFromWindow(window, 0), ref info)) return null;
        Rect r = info.Monitor; return new { x = r.Left, y = r.Top, width = r.Right - r.Left, height = r.Bottom - r.Top };
    }
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
                if (!IsWindowVisible(window) || IsIconic(window) || GetAncestor(window, 2) != window) return true;
                GetWindowThreadProcessId(window, out uint pid);
                if (pid == own) return true;
                bool cloakKnown = DwmGetWindowAttribute(window, 14, out int cloaked, 4) == 0;
                if (cloakKnown && cloaked != 0 && !diagnostic) return true;
                // Exclude desktop/taskbar classes, while retaining Explorer application windows.
                var className = new StringBuilder(128);
                if (GetClassNameW(window, className, className.Capacity) == 0) { unknown = true; return true; }
                if (className.ToString() is "Progman" or "WorkerW" or "Shell_TrayWnd" or "Shell_SecondaryTrayWnd") return true;
                bool boundsKnown = DwmGetWindowAttribute(window, 9, out Rect rect, (uint)Marshal.SizeOf<Rect>()) == 0;
                bool maximized = IsZoomed(window);
                bool caption = (GetWindowStyle(window, -16).ToInt64() & 0x00C00000) == 0x00C00000;
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
