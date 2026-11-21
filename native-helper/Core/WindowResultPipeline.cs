namespace ShortcutExpert.Detection;

internal sealed class WindowResultPipeline(DetectionSession session, CandidateSink sink)
{
    internal CaptionClickResultAdapter Register(
        DetectionRouter router,
        CandidateTracker tracker,
        Action<nint, WindowState>? remember = null,
        Func<string>? date = null
    )
    {
        var caption = new CaptionClickResultAdapter(session, sink);
        caption.Register(router);
        var operations = new IndependentOperationAdapter(tracker, session, sink, date);
        new TrackerEventAdapter(tracker, operations, remember).Register(router);
        return caption;
    }
}
