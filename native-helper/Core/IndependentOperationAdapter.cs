using static NativeMethods;

internal sealed class IndependentOperationAdapter
{
    private readonly CandidateTracker tracker;
    private readonly GestureManager gestures;
    private readonly OperationResultSession results;

    internal IndependentOperationAdapter(
        CandidateTracker tracker,
        DetectionSession session,
        CandidateSink sink,
        Func<string>? date = null
    )
    {
        this.tracker = tracker;
        gestures = tracker.Gestures;
        results = new(gestures, session, sink, date ?? (() => DateTime.Now.ToString("yyyy-MM-dd")));
    }

    internal void Observe(ObservedEvent e)
    {
        switch (e)
        {
            case MousePressEvent:
                if (gestures.Pending is { } mouse)
                    results.Begin(mouse, e.At);
                break;
            case KeyPressEvent:
                var input =
                    tracker.Placement.Input
                    ?? gestures.Maximize
                    ?? (
                        gestures.Pending is { Route: "win-shift-left" or "win-shift-right" } move
                            ? move
                            : null
                    );
                if (input is not null)
                    results.Begin(input, e.At);
                break;
            case ObservedEvent { Kind: ObservedKind.MoveStart }:
                if (gestures.Drags.TryGetValue(e.Target, out var drag))
                    results.Begin(drag, e.At);
                break;
        }
    }

    internal bool Finish(MoveEndEvent e)
    {
        if (!gestures.Drags.TryGetValue(e.Target, out var input))
            return false;
        if (e.After is not { } after || gestures.Release is not { } release)
            return true;
        var f = new DragDetectionFacts(
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
        results.Finish(
            after,
            e.At,
            MonitorMoveDetector.Drag(f),
            MaximizeDetector.Drag(f),
            QuarterPlacementDetector.Drag(f)
        );
        // Only same-monitor W06 can use its retained outlet.
        return !(
            input.Before.Monitor == after.Monitor
            && PlacementGeometry.Shape(after)?.EndsWith("-half") == true
        );
    }

    private bool MigratedInput(nint target) =>
        gestures.Drags.ContainsKey(target)
        || tracker.Placement.Owns(target)
        || gestures.Maximize?.Window == target
        || gestures.Pending is { } input
            && input.Window == target
            && (
                input.Route is "win-shift-left" or "win-shift-right"
                || input.Before.Show == SW_SHOWNORMAL
                    && input.Route is "max-button" or "caption-double-click" or "unknown"
            );

    internal bool State(
        nint target,
        WindowState? after,
        long at,
        nint foreground,
        bool injected = false
    )
    {
        if (gestures.Current is not { } current || current.Window != target)
            return false;
        // Retained W04 minimization may legitimately leave the foreground. Do not
        // apply migrated W03 checks to a legacy-only input or reduction result.
        if (
            !MigratedInput(target)
            || after?.Show is SW_SHOWMINIMIZED or SW_MINIMIZE or SW_SHOWMINNOACTIVE
        )
            return false;
        if (
            after is null
            || foreground != target
            || injected
            || after.Process != current.Start.State.Process
        )
        {
            tracker.ClearInput();
            return false;
        }
        if (
            current.Start.State.DisplayLayout is { } layout
            && after.DisplayLayout is { } finalLayout
            && layout != finalLayout
        )
        {
            tracker.ClearInput();
            return false;
        }
        bool monitorChord = gestures.Pending is { Route: "win-shift-left" or "win-shift-right" };
        if (gestures.Drags.ContainsKey(target) || tracker.Placement.WinHeld && !monitorChord)
            return false;
        if (tracker.Placement.Input is { } series && series.Window == target)
        {
            if (tracker.Placement.PendingResultTarget(at) is null)
                return false;
            if (!tracker.Placement.ResultObserved(after))
                return true;
            var f = tracker.Placement.Terminal(target, after, at, injected);
            // A series can end in maximize without being a valid placement geometry.
            var max = MaximizeDetector.Key(gestures.Maximize, after, at);
            results.Finish(
                after,
                at,
                null,
                max,
                f is null ? null : QuarterPlacementDetector.Key(f)
            );
            gestures.Maximize = null;
            return false;
        }
        if (gestures.Maximize is { } up && up.Window == target && up.Gesture.ReleasedAt is not null)
        {
            var proof = MaximizeDetector.Key(up, after, at);
            if (proof is not null)
            {
                results.Finish(after, at, null, proof, null);
                gestures.Maximize = null;
            }
            return false;
        }
        if (gestures.Pending is not { } input || input.Window != target)
            return false;
        if (input.Route is "win-shift-left" or "win-shift-right")
        {
            if (tracker.MoveKeyReleased)
            {
                if (!InputDetectionFacts.MoveContext(input.Before, after))
                {
                    tracker.ClearInput();
                    return false;
                }
                var proof = MonitorMoveDetector.Key(input, after, at);
                if (proof is not null)
                {
                    results.Finish(after, at, proof, null, null);
                    gestures.Pending = null;
                }
            }
            return false;
        }
        if (tracker.ClickReleased)
        {
            var proof = MaximizeDetector.Click(input, after, at, !gestures.Moving.Contains(target));
            if (proof is not null)
            {
                results.Finish(after, at, null, proof, null);
                gestures.Pending = null;
            }
        }
        return false;
    }
}
