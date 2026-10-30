internal enum WindowDiagnosticReason
{
    MouseDown, MouseUp, TargetMissing, TargetRejected, RawCaption, RawClient, RawButton, RawOther,
    TitleReadOk, TitleReadFail, TitleContainsPoint, TitleOutsidePoint, FinalCaption, FinalButton, FinalOther,
    ForegroundMatched, ForegroundOther, MoveStart, MoveEnd,
    HitRoot, HitChildSameProcess, HitChildUnmatched, ChildCaption, ChildClient, ChildOther, ChildHitFailed,
    ChildTitleContainsPoint, ChildTitleOutsidePoint, ChildTitleReadFail,
    DragNoSource, DragNoResult, DragTargetChanged, DragLayoutChanged, DragMonitorUnknown, DragReleaseUnknown, DragArrangedResult,
    DragForegroundCancelled, DragInputCancelled,
    PlacementInputUnmatched, PlacementIncompatible, PlacementStartInvalid, PlacementShapeUnknown,
    PlacementReleaseMonitorMismatch, PlacementReleaseWorkMismatch, PlacementStartAgeInvalid, PlacementGeometryChanged,
    PlacementSideWithin2, PlacementSide3To8, PlacementSide9To32, PlacementSideAbove32, PlacementYOutside,
    PlacementVerticalMismatch, PlacementAccepted,
    ShapeInputInvalid, ShapeLeftEdge, ShapeRightEdge, ShapeLeftEndAtMid, ShapeRightStartAtMid,
    ShapeTop, ShapeBottom, ShapeMidStart, ShapeMidEnd,
    DragMaximizedResult, MoveSameMonitor, MoveReleaseMonitorMismatch, MoveReleaseWorkMismatch, MoveEndStateInvalid, MoveUnstable, MoveInputInvalid, MoveForegroundMismatch, MoveAccepted,
    TitleGeometryValid, TitleGeometryFallback, TitleGeometryInvalid, TitleButtonDisabled, TitleButtonMismatch, RawMinButton, RawMaxButton, RawCloseButton, W11MouseDown, W11MouseUp, W11KeyF4, W11TargetEligible, W11TargetAbsent, W11TargetStyle, W11TargetCloaked, W11TargetClass, W11TargetProcess, W11CloseRectangle, W11NotReady, W11PendingMouse, W11PendingKey, W11ReleasedMouse, W11ForegroundCancel, W11PollCancel, W11DestroyTarget, W11DestroyAlive, W11DestroyThread, W11DestroyTick, W11DestroyAge, W11DestroyUnreleased, W11HideObserved, W11RecreatedCancel, W11ForegroundDeparture, W11Completed, W11Exception, W11GeometryValid, W11GeometryFallback, W11GeometryInvalid, W11GeometryDisabled, W11GeometryOutside, W11GeometryReadFailed, W11RootHitConfirmed, W11RootHitRejected,
    ReleaseSampled, ReleaseWorkLeftSame, ReleaseWorkLeftDifferent, ReleaseEventAtMonitorLeft, ReleaseBeforeAtMonitorLeft, ReleaseAfterAtMonitorLeft, ReleaseObserverCursorShift, DragMotionObserved, DragInjectedMotionObserved, DragLastMotionInjected, DragExtremaAtMonitorTopLeft, DragExtremaAtWorkTopLeft, DragLastAtMonitorLeft, ReleaseLastMotionFar, ReleaseWorkLeftWithin8, ReleaseWorkLeft9To32, ReleaseWorkLeft33To64, ReleaseWorkLeft65To128, ReleaseWorkLeft129To256, ReleaseWorkLeft257To512, ReleaseWorkLeftAbove512, ReleaseBeforeEqual, ReleaseBeforeWithin8, ReleaseBeforeWithin32, ReleaseBeforeFar, ReleaseBeforeUnavailable, ReleaseAfterEqual, ReleaseAfterWithin8, ReleaseAfterWithin32, ReleaseAfterFar, ReleaseAfterUnavailable
}

internal sealed record WindowDiagnosticSummary(int Generation, Dictionary<string, int> Counts);
internal sealed class WindowDiagnosticAccumulator
{
    private int generation;
    private readonly Dictionary<string, int> counts = Enum.GetValues<WindowDiagnosticReason>().ToDictionary(key => key.ToString(), _ => 0);
    internal void Start(int epoch) { generation = epoch; foreach (string key in counts.Keys) counts[key] = 0; }
    internal void Record(WindowDiagnosticReason reason) {
        if (generation > 0) counts[reason.ToString()] = Math.Min(1000, counts[reason.ToString()] + 1);
    }
    internal void RecordClose(CloseReason reason) {
        if (Enum.TryParse<WindowDiagnosticReason>("W11" + reason, out var mapped)) Record(mapped);
    }
    internal WindowDiagnosticSummary? Take() {
        if (generation <= 0) return null;
        var result = new WindowDiagnosticSummary(generation, new(counts)); generation = 0; return result;
    }
}

// Opt-in transient extrema only. No event list, timestamps, coordinates or handles are emitted.
internal sealed class WindowDragReleaseProbe
{
    private NativeMethods.Point? left, right, top, bottom, last;
    private bool motion, injected, lastInjected;
    internal void Sample(NativeMethods.Point point, uint flags)
    {
        motion = true; last = point;
        lastInjected = (flags & (NativeMethods.LLMHF_INJECTED | NativeMethods.LLMHF_LOWER_IL_INJECTED)) != 0;
        if (lastInjected) { injected = true; return; }
        if (left is null || point.X <= left.Value.X) left = point;
        if (right is null || point.X >= right.Value.X) right = point;
        if (top is null || point.Y <= top.Value.Y) top = point;
        if (bottom is null || point.Y >= bottom.Value.Y) bottom = point;
    }
    private static long Gap(NativeMethods.Point a, NativeMethods.Point b) =>
        Math.Max(Math.Abs((long)a.X - b.X), Math.Abs((long)a.Y - b.Y));
    private static bool AtLeft(NativeMethods.Point p, MonitorBounds b) =>
        Math.Abs((long)p.X - b.x) <= 8 && p.Y >= b.y && (long)p.Y < (long)b.y + b.height;
    internal void Record(NativeMethods.Point point, MonitorBounds monitor, MonitorBounds work,
        NativeMethods.Point? before, NativeMethods.Point? after, Action<WindowDiagnosticReason> record)
    {
        record(WindowDiagnosticReason.ReleaseSampled);
        record(work.x == monitor.x ? WindowDiagnosticReason.ReleaseWorkLeftSame : WindowDiagnosticReason.ReleaseWorkLeftDifferent);
        if (AtLeft(point, monitor)) record(WindowDiagnosticReason.ReleaseEventAtMonitorLeft);
        if (before is { } a && AtLeft(a, monitor)) record(WindowDiagnosticReason.ReleaseBeforeAtMonitorLeft);
        if (after is { } b && AtLeft(b, monitor)) record(WindowDiagnosticReason.ReleaseAfterAtMonitorLeft);
        if (before is { } c && after is { } d && Gap(c, d) > 0) record(WindowDiagnosticReason.ReleaseObserverCursorShift);
        if (motion) record(WindowDiagnosticReason.DragMotionObserved);
        if (injected) record(WindowDiagnosticReason.DragInjectedMotionObserved);
        if (lastInjected) record(WindowDiagnosticReason.DragLastMotionInjected);
        var extrema = new[] { left, right, top, bottom };
        bool Corner(MonitorBounds bounds) => extrema.Any(p => p is { } e &&
            Math.Abs((long)e.X - bounds.x) <= 8 && Math.Abs((long)e.Y - bounds.y) <= 8);
        if (Corner(monitor)) record(WindowDiagnosticReason.DragExtremaAtMonitorTopLeft);
        if (Corner(work)) record(WindowDiagnosticReason.DragExtremaAtWorkTopLeft);
        if (last is { } e && AtLeft(e, monitor)) record(WindowDiagnosticReason.DragLastAtMonitorLeft);
        if (last is { } f && Gap(f, point) > 32) record(WindowDiagnosticReason.ReleaseLastMotionFar);
        long distance = Math.Abs((long)point.X - work.x);
        string bin = distance <= 8 ? "Within8" : distance <= 32 ? "9To32" : distance <= 64 ? "33To64" :
            distance <= 128 ? "65To128" : distance <= 256 ? "129To256" : distance <= 512 ? "257To512" : "Above512";
        if (Enum.TryParse<WindowDiagnosticReason>("ReleaseWorkLeft" + bin, out var reason)) record(reason);
        void Difference(string prefix, NativeMethods.Point? value) {
            long? gap = value is { } p ? Gap(point, p) : null;
            string label = gap is null ? "Unavailable" : gap == 0 ? "Equal" : gap <= 8 ? "Within8" : gap <= 32 ? "Within32" : "Far";
            if (Enum.TryParse<WindowDiagnosticReason>("Release" + prefix + label, out var mapped)) record(mapped);
        }
        Difference("Before", before); Difference("After", after);
    }
}
