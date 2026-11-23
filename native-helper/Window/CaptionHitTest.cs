using static NativeMethods;
using Point = NativeMethods.Point;

namespace ShortcutExpert.Detection;

internal sealed class CaptionHitTest(Action<WindowDiagnosticReason>? diagnostic)
{
    private const uint HitTestTimeoutMs = 10;

    internal int Read(nint target, uint process, Point point)
    {
        int raw = QueryHit(target, point) ?? -1;
        ReportRawHit(raw);
        var (hit, rootCaptionRead) = ReadRootCaption(target, point, raw);
        if (rootCaptionRead && hit == 1 || diagnostic is not null)
            hit = ReadChildCaption(target, process, point, hit, rootCaptionRead);
        diagnostic?.Invoke(
            hit switch
            {
                HTCAPTION => WindowDiagnosticReason.FinalCaption,
                HTMINBUTTON or HTMAXBUTTON or HTCLOSE => WindowDiagnosticReason.FinalButton,
                _ => WindowDiagnosticReason.FinalOther,
            }
        );
        return hit;
    }

    private static int? QueryHit(nint window, Point point)
    {
        long packed = (uint)((point.Y & 0xffff) << 16) | (uint)(point.X & 0xffff);
        return
            SendMessageTimeoutW(
                window,
                WM_NCHITTEST,
                0,
                (nint)packed,
                SMTO_ABORTIFHUNG,
                HitTestTimeoutMs,
                out nuint hit
            ) != 0
            ? unchecked((int)hit)
            : null;
    }

    private void ReportRawHit(int hit)
    {
        diagnostic?.Invoke(
            hit switch
            {
                HTCAPTION => WindowDiagnosticReason.RawCaption,
                1 => WindowDiagnosticReason.RawClient,
                HTMINBUTTON or HTMAXBUTTON or HTCLOSE => WindowDiagnosticReason.RawButton,
                _ => WindowDiagnosticReason.RawOther,
            }
        );
        if (hit is HTMINBUTTON or HTMAXBUTTON or HTCLOSE)
            diagnostic?.Invoke(
                hit switch
                {
                    HTMINBUTTON => WindowDiagnosticReason.RawMinButton,
                    HTMAXBUTTON => WindowDiagnosticReason.RawMaxButton,
                    _ => WindowDiagnosticReason.RawCloseButton,
                }
            );
    }

    private (int Hit, bool Read) ReadRootCaption(nint target, Point point, int raw)
    {
        if (!GetWindowRect(target, out Rect rect) || !WindowCaption.Read(target, out var title))
        {
            diagnostic?.Invoke(WindowDiagnosticReason.TitleReadFail);
            return (raw, false);
        }
        diagnostic?.Invoke(WindowDiagnosticReason.TitleReadOk);
        diagnostic?.Invoke(
            SnapGeometry.Contains(title.Bar, point)
                ? WindowDiagnosticReason.TitleContainsPoint
                : WindowDiagnosticReason.TitleOutsidePoint
        );
        return (WindowCaption.Hit(title, rect, point, raw, diagnostic), true);
    }

    private int ReadChildCaption(
        nint target,
        uint process,
        Point point,
        int rootHit,
        bool rootCaptionRead
    )
    {
        nint child = WindowFromPhysicalPoint(point);
        if (child == target)
        {
            diagnostic?.Invoke(WindowDiagnosticReason.HitRoot);
            return rootHit;
        }
        if (!MatchesChild(child, target, process))
        {
            diagnostic?.Invoke(WindowDiagnosticReason.HitChildUnmatched);
            return rootHit;
        }
        int? childHit = QueryHit(child, point);
        // Revalidate after the bounded query so a reparented or replaced child cannot refine the root hit.
        bool sameRoot = GetAncestor(child, GA_ROOT) == target;
        bool sameProcess = MatchesProcess(child, process);
        if (sameRoot && sameProcess)
            ReportChildHit(child, point, childHit);
        else
            diagnostic?.Invoke(WindowDiagnosticReason.HitChildUnmatched);
        return rootCaptionRead
            ? WindowCaption.ResolveChildCaption(rootHit, childHit ?? -1, sameRoot, sameProcess)
            : rootHit;
    }

    private static bool MatchesChild(nint child, nint target, uint process) =>
        child != 0 && GetAncestor(child, GA_ROOT) == target && MatchesProcess(child, process);

    private static bool MatchesProcess(nint window, uint process) =>
        GetWindowThreadProcessId(window, out uint actual) != 0 && actual == process;

    private void ReportChildHit(nint child, Point point, int? hit)
    {
        if (diagnostic is null)
            return;
        diagnostic(WindowDiagnosticReason.HitChildSameProcess);
        diagnostic(
            hit switch
            {
                HTCAPTION => WindowDiagnosticReason.ChildCaption,
                1 => WindowDiagnosticReason.ChildClient,
                null => WindowDiagnosticReason.ChildHitFailed,
                _ => WindowDiagnosticReason.ChildOther,
            }
        );
        if (!WindowCaption.Read(child, out var title))
        {
            diagnostic(WindowDiagnosticReason.ChildTitleReadFail);
            return;
        }
        diagnostic(
            SnapGeometry.Contains(title.Bar, point)
                ? WindowDiagnosticReason.ChildTitleContainsPoint
                : WindowDiagnosticReason.ChildTitleOutsidePoint
        );
    }
}
