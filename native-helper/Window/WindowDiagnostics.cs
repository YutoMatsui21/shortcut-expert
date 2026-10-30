internal enum WindowDiagnosticReason
{
    MouseDown, MouseUp, TargetMissing, TargetRejected, RawCaption, RawClient, RawButton, RawOther,
    TitleReadOk, TitleReadFail, TitleContainsPoint, TitleOutsidePoint, FinalCaption, FinalButton, FinalOther,
    ForegroundMatched, ForegroundOther, MoveStart, MoveEnd,
    HitRoot, HitChildSameProcess, HitChildUnmatched, ChildCaption, ChildClient, ChildOther, ChildHitFailed,
    ChildTitleContainsPoint, ChildTitleOutsidePoint, ChildTitleReadFail
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
    internal WindowDiagnosticSummary? Take() {
        if (generation <= 0) return null;
        var result = new WindowDiagnosticSummary(generation, new(counts)); generation = 0; return result;
    }
}
