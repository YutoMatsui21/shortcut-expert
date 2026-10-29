using System.Runtime.InteropServices;
using static NativeMethods;
using Point = NativeMethods.Point;

internal static class WindowCaption
{
    internal static bool CloseButton(TitleInfo title, Rect window, Point point) =>
        SnapGeometry.Source(title.Bounds[2], title.Bounds[3], title.Bounds[5], window) == "title-rect" &&
        (title.State[5] & 0x18001) == 0 && SnapGeometry.Contains(title.Bounds[5], point);
    internal static bool Read(nint window, out TitleInfo info)
    {
        info = new() { Size = (uint)Marshal.SizeOf<TitleInfo>(), State = new uint[6], Bounds = new Rect[6] };
        nint buffer = Marshal.AllocHGlobal((int)info.Size);
        try
        {
            Marshal.StructureToPtr(info, buffer, false);
            if (SendMessageTimeoutW(window, 0x33f, 0, buffer, SMTO_ABORTIFHUNG, 30, out _) == 0) return false;
            info = Marshal.PtrToStructure<TitleInfo>(buffer); return true;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    internal static int Hit(TitleInfo info, Rect window, Point point, int fallback)
    {
        string? source = SnapGeometry.Source(info.Bounds[2], info.Bounds[3], info.Bounds[5], window);
        if (source == "hit-fallback") return fallback;
        if (source is null) return -1;
        foreach (var (index, hit) in new[] { (2, HTMINBUTTON), (3, HTMAXBUTTON), (5, HTCLOSE) })
            if (SnapGeometry.Contains(info.Bounds[index], point))
                return (info.State[index] & 0x18001) == 0 ? hit : -1;
        return fallback is HTMINBUTTON or HTMAXBUTTON or HTCLOSE ? -1 : fallback;
    }
}
