internal static class DisplayPolicy
{
    // DWM cloak status and caption style distinguish hidden/fullscreen windows
    // from ordinary maximized windows, including an auto-hidden taskbar.
    internal static string Classify(bool cloakKnown, int cloaked, bool boundsKnown,
        NativeMethods.Rect rect, NativeMethods.Rect monitor, bool maximized, bool caption)
    {
        if (cloakKnown && cloaked != 0) return "hidden";
        if (!cloakKnown || !boundsKnown) return "unknown";
        bool covers = rect.Left <= monitor.Left + 2 && rect.Top <= monitor.Top + 2 &&
            rect.Right >= monitor.Right - 2 && rect.Bottom >= monitor.Bottom - 2;
        return covers && !(maximized && caption) ? "fullscreen" : "ordinary";
    }

    internal static object Check()
    {
        var monitor = new NativeMethods.Rect { Left = 0, Top = 0, Right = 1920, Bottom = 1080 };
        return new {
            maximized = Classify(true, 0, true, monitor, monitor, true, true),
            cloaked = Classify(true, 2, true, monitor, monitor, false, false),
            fullscreen = Classify(true, 0, true, monitor, monitor, false, false),
            borderlessMaximized = Classify(true, 0, true, monitor, monitor, true, false),
            unknown = Classify(false, 0, true, monitor, monitor, true, true),
            hiddenWithoutBounds = Classify(true, 2, false, default, monitor, false, false),
            ordinary = Classify(true, 0, true, new NativeMethods.Rect { Right = 800, Bottom = 600 }, monitor, false, true)
        };
    }
}
