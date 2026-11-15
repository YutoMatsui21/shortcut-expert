using static NativeMethods;

internal sealed class IndependentOperationAdapter
{
    private readonly CandidateTracker tracker;
    private readonly GestureManager gestures;
    private readonly OperationResultSession results;
    private readonly CandidateSink sink;
    private readonly Func<string> date;

    internal IndependentOperationAdapter(
        CandidateTracker tracker,
        DetectionSession session,
        CandidateSink sink,
        Func<string>? date = null
    )
    {
        this.tracker = tracker;
        gestures = tracker.Gestures;
        this.sink = sink;
        this.date = date ?? (() => DateTime.Now.ToString("yyyy-MM-dd"));
        results = new(gestures, session, sink, this.date);
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
        || MigratedPendingInput(target);

    private bool MigratedPendingInput(nint target)
    {
        if (gestures.Pending is not { } input || input.Window != target)
            return false;
        return input.Route switch
        {
            "win-shift-left" or "win-shift-right" => true,
            "max-button" or "caption-double-click" or "unknown" => input.Before.Show
                == SW_SHOWNORMAL,
            _ => false,
        };
    }

    internal OperationDispatch State(OperationObservation observed)
    {
        if (!OwnsObservation(observed))
            return OperationDispatch.Legacy;
        if (!ValidObservedWindow(observed))
        {
            tracker.ClearInput();
            return OperationDispatch.Consumed;
        }
        if (InputStillOpen(observed.Target))
            return OperationDispatch.Pending;
        if (tracker.Placement.Owns(observed.Target))
            return FinishSeries(observed);
        return FinishStandalone(observed);
    }

    private bool OwnsObservation(OperationObservation observed) =>
        gestures.Current?.Window == observed.Target
        && MigratedInput(observed.Target)
        && observed.After?.Show is not (SW_SHOWMINIMIZED or SW_MINIMIZE or SW_SHOWMINNOACTIVE);

    private bool ValidObservedWindow(OperationObservation o)
    {
        if (o.After is not { } after || o.Foreground != o.Target || o.Injected)
            return false;
        if (after.Process != gestures.Current!.Start.State.Process)
            return false;
        var layout = gestures.Current.Start.State.DisplayLayout;
        return layout is null || after.DisplayLayout is null || layout == after.DisplayLayout;
    }

    private bool InputStillOpen(nint target)
    {
        if (gestures.Drags.ContainsKey(target))
            return true;
        bool monitorChord = gestures.Pending is { Route: "win-shift-left" or "win-shift-right" };
        return tracker.Placement.WinHeld && !monitorChord;
    }

    private OperationDispatch FinishSeries(OperationObservation o)
    {
        if (tracker.Placement.PendingResultTarget(o.At) is null)
            return OperationDispatch.Consumed;
        if (!tracker.Placement.ResultObserved(o.After!))
            return OperationDispatch.Pending;
        var facts = tracker.Placement.Terminal(o.Target, o.After, o.At, o.Injected);
        results.Finish(
            o.After!,
            o.At,
            null,
            MaximizeDetector.Key(gestures.Maximize, o.After!, o.At),
            facts is null ? null : QuarterPlacementDetector.Key(facts)
        );
        gestures.Maximize = null;
        RetireSeries(o);
        return OperationDispatch.Consumed;
    }

    private void RetireSeries(OperationObservation o)
    {
        int generation = tracker.Placement.Input!.Gesture.Generation;
        var retained = tracker.Placement.Finish(o.Target, o.After, o.At, o.Injected);
        if (retained is not null && retained.Evidence.shape.EndsWith("-half"))
            sink.Placement(generation, date(), retained);
    }

    private OperationDispatch FinishStandalone(OperationObservation o)
    {
        if (gestures.Maximize is { } up && up.Window == o.Target)
            return up.Gesture.ReleasedAt is not null
                ? FinishMaximize(up, o)
                : OperationDispatch.Pending;
        if (gestures.Pending is not { } input || input.Window != o.Target)
            return OperationDispatch.Legacy;
        return input.Route is "win-shift-left" or "win-shift-right"
            ? FinishMonitorChord(input, o)
            : FinishClick(input, o);
    }

    private OperationDispatch FinishMaximize(GestureManager.Input input, OperationObservation o)
    {
        var proof = MaximizeDetector.Key(input, o.After!, o.At);
        if (proof is null)
            return OperationDispatch.Pending;
        results.Finish(o.After!, o.At, null, proof, null);
        gestures.Maximize = null;
        return OperationDispatch.Consumed;
    }

    private OperationDispatch FinishMonitorChord(GestureManager.Input input, OperationObservation o)
    {
        if (!tracker.MoveKeyReleased)
            return OperationDispatch.Pending;
        if (!InputDetectionFacts.MoveContext(input.Before, o.After!))
        {
            tracker.ClearInput();
            return OperationDispatch.Consumed;
        }
        var proof = MonitorMoveDetector.Key(input, o.After!, o.At);
        if (proof is null)
            return OperationDispatch.Pending;
        results.Finish(o.After!, o.At, proof, null, null);
        gestures.Pending = null;
        return OperationDispatch.Consumed;
    }

    private OperationDispatch FinishClick(GestureManager.Input input, OperationObservation o)
    {
        if (!tracker.ClickReleased)
            return OperationDispatch.Pending;
        var proof = MaximizeDetector.Click(
            input,
            o.After!,
            o.At,
            !gestures.Moving.Contains(o.Target)
        );
        if (proof is null)
            return OperationDispatch.Pending;
        results.Finish(o.After!, o.At, null, proof, null);
        gestures.Pending = null;
        return OperationDispatch.Consumed;
    }
}

internal sealed record OperationObservation(
    nint Target,
    WindowState? After,
    long At,
    nint Foreground,
    bool Injected = false
);

internal enum OperationDispatch
{
    Legacy,
    Pending,
    Consumed,
}
