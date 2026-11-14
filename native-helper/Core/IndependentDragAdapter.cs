// Migration outlet for terminal drag observations. The legacy tracker continues to
// own input admission until its lifecycle adapters are removed. No legacy result
// is consulted and an owned drag never reaches both output routes.
internal sealed class IndependentDragAdapter(
    GestureManager gestures,
    DetectionSession session,
    CandidateSink sink
)
{
    private static readonly (
        string Name,
        Func<DragDetectionFacts, IndependentProof?> Detect
    )[] detectors =
    [
        ("monitor-move", f => MonitorMoveDetector.Drag(f)),
        ("maximize", f => MaximizeDetector.Drag(f)),
        ("quarter", f => QuarterPlacementDetector.Drag(f)),
    ];

    internal bool Finish(MoveEndEvent e)
    {
        if (!gestures.Drags.TryGetValue(e.Target, out var input))
            return false;
        // Same-monitor half placement remains owned by W06. Cross-monitor half
        // contributes W02 only; this issue does not migrate W06.
        if (
            e.After is { } half
            && input.Before.Monitor == half.Monitor
            && PlacementGeometry.Shape(half)?.EndsWith("-half") == true
        )
            return false;
        if (e.After is not { } after || gestures.Release is not { } release)
            return true;
        var facts = new DragDetectionFacts(
            input.Before,
            after,
            release.Point,
            release.Monitor,
            release.Work,
            input.At,
            !input.Injected && !input.Conflicted && input.Matched && e.Foreground == e.Target,
            input.Gesture.ReleasedAt is not null,
            input.CaptionPress
        );
        if (!facts.Valid)
            return true;
        var composer = new ResultComposer(session, gestures, sink, () => e.At);
        var pending = composer.Begin(
            new(input, e.Date, e.At, () => e.Foreground == e.Target),
            detectors.Select(d => new ResultComposer.Subscription(d.Name, e.At))
        );
        if (!gestures.Complete(input.Gesture, e.Target, after, e.At))
        {
            pending.Cancel();
            return true;
        }
        var identity = new DetectionRouter.CompletionIdentity(
            e.Generation,
            e.Target,
            input.Before.Process,
            input.Gesture.Source
        );
        foreach (var detector in detectors)
        {
            var proof = detector.Detect(facts);
            if (proof is null)
                pending.Reject(detector.Name, identity, input.Gesture);
            else
                pending.Confirm(detector.Name, identity, input.Gesture, proof);
        }
        pending.Seal();
        return true;
    }
}
