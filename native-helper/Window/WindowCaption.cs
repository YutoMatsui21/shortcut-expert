using System.Runtime.InteropServices;
using static NativeMethods;
using Point = NativeMethods.Point;

internal static class WindowCaption
{
    // A validated root button/resize/unknown result wins. Only an explicit child caption can refine HTCLIENT.
    internal static int ResolveChildCaption(
        int rootHit,
        int childHit,
        bool sameRoot,
        bool sameProcess
    ) => rootHit == 1 && childHit == HTCAPTION && sameRoot && sameProcess ? HTCAPTION : rootHit;

    internal static bool CloseButton(
        TitleInfo title,
        Rect window,
        Point point,
        Action<CloseReason>? diagnostic = null,
        bool rootCloseConfirmed = false
    )
    {
        string? source = SnapGeometry.Source(
            title.Bounds[2],
            title.Bounds[3],
            title.Bounds[5],
            window
        );
        diagnostic?.Invoke(
            source == "title-rect" ? CloseReason.GeometryValid
            : source == "hit-fallback" ? CloseReason.GeometryFallback
            : CloseReason.GeometryInvalid
        );
        if (source != "title-rect")
        {
            diagnostic?.Invoke(
                rootCloseConfirmed ? CloseReason.RootHitConfirmed : CloseReason.RootHitRejected
            );
            return rootCloseConfirmed;
        }
        if ((title.State[5] & 0x18001) != 0)
        {
            diagnostic?.Invoke(CloseReason.GeometryDisabled);
            return false;
        }
        if (!SnapGeometry.Contains(title.Bounds[5], point))
        {
            diagnostic?.Invoke(CloseReason.GeometryOutside);
            return false;
        }
        return true;
    }

    internal static bool VerifiedRootClose(
        int hit,
        bool sameRoot,
        bool sameProcess,
        bool sameThread
    ) => hit == HTCLOSE && sameRoot && sameProcess && sameThread;

    internal static int QueryRootHit(nint window, Point point)
    {
        long packed = (uint)((point.Y & 0xffff) << 16) | (uint)(point.X & 0xffff);
        return
            SendMessageTimeoutW(
                window,
                WM_NCHITTEST,
                0,
                (nint)packed,
                SMTO_ABORTIFHUNG,
                10,
                out nuint hit
            ) != 0
            ? unchecked((int)hit)
            : -1;
    }

    internal static bool Read(nint window, out TitleInfo info)
    {
        info = new()
        {
            Size = (uint)Marshal.SizeOf<TitleInfo>(),
            State = new uint[6],
            Bounds = new Rect[6],
        };
        nint buffer = Marshal.AllocHGlobal((int)info.Size);
        try
        {
            Marshal.StructureToPtr(info, buffer, false);
            if (SendMessageTimeoutW(window, 0x33f, 0, buffer, SMTO_ABORTIFHUNG, 30, out _) == 0)
                return false;
            info = Marshal.PtrToStructure<TitleInfo>(buffer);
            return true;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    internal static int Hit(
        TitleInfo info,
        Rect window,
        Point point,
        int fallback,
        Action<WindowDiagnosticReason>? diagnostic = null
    )
    {
        string? source = SnapGeometry.Source(
            info.Bounds[2],
            info.Bounds[3],
            info.Bounds[5],
            window
        );
        diagnostic?.Invoke(
            source == "title-rect" ? WindowDiagnosticReason.TitleGeometryValid
            : source == "hit-fallback" ? WindowDiagnosticReason.TitleGeometryFallback
            : WindowDiagnosticReason.TitleGeometryInvalid
        );
        if (source == "hit-fallback")
            return fallback;
        // Malformed custom-title rectangles cannot invalidate an explicit root hit.
        // Client, resize and unknown hits still provide no operation evidence.
        if (source is null)
            return fallback is HTCAPTION or HTMINBUTTON or HTMAXBUTTON or HTCLOSE ? fallback : -1;
        foreach (var (index, hit) in new[] { (2, HTMINBUTTON), (3, HTMAXBUTTON), (5, HTCLOSE) })
            if (SnapGeometry.Contains(info.Bounds[index], point))
            {
                if ((info.State[index] & 0x18001) != 0)
                    diagnostic?.Invoke(WindowDiagnosticReason.TitleButtonDisabled);
                return (info.State[index] & 0x18001) == 0 ? hit : -1;
            }
        if (fallback is HTMINBUTTON or HTMAXBUTTON or HTCLOSE)
            diagnostic?.Invoke(WindowDiagnosticReason.TitleButtonMismatch);
        return fallback is HTMINBUTTON or HTMAXBUTTON or HTCLOSE ? -1 : fallback;
    }
}
