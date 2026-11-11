using static NativeMethods;

internal static partial class Program
{
    private static WindowState GesturePlacementState() =>
        normal with
        {
            Monitor = new(0, 0, 1000, 800),
            Work = new(0, 0, 1000, 800),
            Frame = new(0, 0, 500, 800),
            Dpi = 96,
            DisplayLayout = "one",
            Arranged = true,
        };

    private static void GestureTests()
    {
        Check(
            "unrelated source release cannot end the current physical input",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker, hit: HTCAPTION);
                var mouse = tracker.Gestures.Current!;
                tracker.KeyReleased(VK_LWIN, 10);
                Equal(GestureManager.Phase.Observing, mouse.State);
                tracker.ClearInput();
                tracker.Key(11, normal, VK_LWIN, true, false, 20, 0);
                tracker.Key(11, normal, VK_UP, true, false, 30, 0);
                var key = tracker.Gestures.Current!;
                tracker.MouseReleased(default, null, null, 0, releasedAt: 40);
                Equal(GestureManager.Phase.Observing, key.State);
            }
        );
        Check(
            "discarded maximize confirmations and injected releases retire their gesture",
            () =>
            {
                foreach (bool injected in new[] { false, true })
                {
                    var tracker = Tracker();
                    tracker.Key(11, normal, VK_UP, true, false, 10, 0);
                    var old = tracker.Gestures.Current!;
                    if (injected)
                        tracker.FinishKey(11, maximized, 20, true, "2026-11-11");
                    else
                        tracker.ConfirmMaximize(
                            11,
                            maximized with
                            {
                                Process = 8,
                            },
                            20,
                            11,
                            "2026-11-11"
                        );
                    Equal(GestureManager.Phase.Cancelled, old.State);
                    Equal(false, tracker.Gestures.Complete(old, 11, maximized, 30));
                }
            }
        );
        Check(
            "unrelated key input retires an unowned maximize gesture",
            () =>
            {
                var tracker = Tracker();
                tracker.Key(11, normal, VK_UP, true, false, 10, 0);
                var old = tracker.Gestures.Current!;
                tracker.Key(11, normal, 0x41, true, false, 20, 0);
                Equal(GestureManager.Phase.Cancelled, old.State);
                Equal(false, tracker.Gestures.Complete(old, 11, maximized, 30));
            }
        );
        Check(
            "same Win Up reuses the maximize gesture when placement begins",
            () =>
            {
                var tracker = Tracker();
                var half = GesturePlacementState();
                tracker.Key(11, half, VK_LWIN, true, false, 0, 0);
                tracker.Key(11, half, VK_UP, true, false, 10, 0);
                var maximize = tracker.Gestures.Maximize!.Gesture;
                Equal(maximize, tracker.Gestures.Current);
                var end = half with { Show = SW_SHOWMAXIMIZED, Arranged = false };
                Equal(
                    true,
                    tracker.ConfirmMaximize(11, end, 50, 11, "2026-11-11") is WindowCandidate
                );
                Equal(GestureManager.Phase.Completed, maximize.State);
                Equal(end, maximize.End!.State);
            }
        );
        Check(
            "maximize timeout cannot expire the ongoing Win held placement gesture",
            () =>
            {
                var tracker = Tracker();
                var half = GesturePlacementState();
                var start = half with { Arranged = false, Frame = new(100, 100, 600, 500) };
                tracker.Key(11, start, VK_LWIN, true, false, 0, 0);
                tracker.Key(11, start, VK_LEFT, true, false, 10, 0);
                var series = tracker.Gestures.Current!;
                tracker.KeyReleased(VK_LEFT);
                tracker.Key(11, half, VK_UP, true, false, 30, 0);
                Equal<nint?>(null, tracker.MaximizeTarget(1031));
                Equal(GestureManager.Phase.Observing, series.State);
                tracker.KeyReleased(VK_UP);
                tracker.Key(11, half, VK_DOWN, true, false, 2000, 0);
                Equal(series, tracker.Gestures.Current);
                tracker.KeyReleased(VK_DOWN);
                tracker.KeyReleased(VK_LWIN);
                var bottom = half with { Frame = new(0, 400, 500, 400) };
                Equal(
                    true,
                    tracker.FinishKey(11, bottom, 2050, false, "2026-11-11") is PlacementResult
                );
                Equal(GestureManager.Phase.Completed, series.State);
                Equal(bottom, series.End!.State);
            }
        );
        Check(
            "other mouse messages terminate an abandoned press but movement retains drag identity",
            () =>
            {
                var tracker = Tracker();
                Mouse(
                    tracker,
                    hit: 1 /* HTCLIENT */
                );
                var old = tracker.Gestures.Current!;
                tracker.MouseMessage(0x204);
                Equal(GestureManager.Phase.Cancelled, old.State);
                tracker.MouseReleased(default, null, null, 0);
                Equal(false, tracker.Gestures.Complete(old, 11, maximized, 30));
                Mouse(
                    tracker,
                    hit: 1 /* HTCLIENT */
                    ,
                    at: 40
                );
                var current = tracker.Gestures.Current!;
                tracker.MouseMoved(new Point { X = 100, Y = 100 }, 0);
                Equal(GestureManager.Phase.Observing, current.State);
                tracker.MoveStart(11, 50);
                Equal(current, tracker.Gestures.Drags[11].Gesture);
            }
        );
        Check(
            "gesture click retains timed snapshots and completes only once",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker, at: 10);
                var manager = tracker.Gestures;
                var click = manager.Current!;
                Equal(10L, click.Start.At);
                Equal(normal, click.Start.State);
                Equal("caption", click.Source);
                tracker.MouseReleased(default, null, null, 0, releasedAt: 20);
                Equal(GestureManager.Phase.AwaitingResult, click.State);
                Equal<long?>(20, click.ReleasedAt);
                Complete(tracker, at: 35);
                Equal(GestureManager.Phase.Completed, click.State);
                Equal(35L, click.End!.At);
                Equal(maximized, click.End.State);
                Equal(false, manager.Complete(click, 11, maximized, 40));
                Equal(false, manager.Cancel(click));
                Equal(35L, click.End.At);
            }
        );
        Check(
            "gesture drag uses the physical press through intermediate restore and release",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker, hit: HTCAPTION, at: 10);
                var drag = tracker.Gestures.Current!;
                tracker.MoveStart(11, 20);
                Equal(drag, tracker.Gestures.Current);
                Equal(drag, tracker.Gestures.Drags[11].Gesture);
                Equal(10L, drag.Start.At);
                Equal<object?>(
                    null,
                    tracker.Complete(11, normal, normal, 30, 11, "2026-11-11", null)
                );
                Equal(GestureManager.Phase.Observing, drag.State);
                tracker.MouseReleased(default, null, null, 0, releasedAt: 50);
                Equal(GestureManager.Phase.AwaitingResult, drag.State);
                // A rejected operation still terminates this input; no later END can revive it.
                Equal<object?>(null, tracker.FinishMove(11, normal, 60, 11, "2026-11-11"));
                Equal(GestureManager.Phase.Cancelled, drag.State);
                Equal(false, tracker.Gestures.Complete(drag, 11, maximized, 70));
            }
        );
        Check(
            "gesture successful drag associates the terminal snapshot with the original press",
            () =>
            {
                var tracker = Tracker();
                var start = normal with
                {
                    Monitor = new(0, 0, 1000, 800),
                    Work = new(0, 0, 1000, 800),
                };
                tracker.Mouse(11, start, HTCAPTION, default, 10, 500, 0, false, true);
                var gesture = tracker.Gestures.Current!;
                tracker.MoveStart(11, 20);
                tracker.MouseReleased(
                    new Point { X = 500, Y = 0 },
                    start.Monitor,
                    start.Work,
                    0,
                    releasedAt: 100
                );
                var end = start with { Show = SW_SHOWMAXIMIZED };
                Equal(true, tracker.FinishMove(11, end, 110, 11, "2026-11-11") is WindowCandidate);
                Equal(GestureManager.Phase.Completed, gesture.State);
                Equal(start, gesture.Start.State);
                Equal(end, gesture.End!.State);
                Equal(110L, gesture.End.At);
            }
        );
        Check(
            "gesture key series retains one start until Win release",
            () =>
            {
                var tracker = Tracker();
                var start = normal with
                {
                    Monitor = new(0, 0, 1000, 800),
                    Work = new(0, 0, 1000, 800),
                    Frame = new(100, 100, 600, 500),
                    Dpi = 96,
                    DisplayLayout = "one",
                };
                tracker.Key(11, start, VK_LWIN, true, false, 1, 0);
                tracker.Key(11, start, VK_LEFT, true, false, 10, 0);
                var series = tracker.Gestures.Current!;
                tracker.KeyReleased(VK_LEFT);
                var half = start with { Arranged = true, Frame = new(0, 0, 500, 800) };
                tracker.Key(11, half, VK_UP, true, false, 30, 0);
                Equal(series, tracker.Gestures.Current);
                Equal(start, series.Start.State);
                Equal<object?>(null, tracker.FinishKey(11, half, 35, false, "2026-11-11"));
                tracker.KeyReleased(VK_UP);
                tracker.KeyReleased(VK_LWIN);
                Equal(GestureManager.Phase.AwaitingResult, series.State);
                var quarter = half with { Frame = new(0, 0, 500, 400) };
                Equal(
                    true,
                    tracker.FinishKey(11, quarter, 40, false, "2026-11-11") is PlacementResult
                );
                Equal(GestureManager.Phase.Completed, series.State);
                Equal(quarter, series.End!.State);
            }
        );
        Check(
            "gesture cancellation replacement and reset reject stale completions",
            () =>
            {
                var manager = new GestureManager();
                manager.Reset(1);
                var old = manager.Start(11, normal, "caption", 10, injected: true, modified: true);
                Equal(true, old.Injected);
                Equal(true, old.Modified);
                var next = manager.Start(12, normal, "taskbar", 20);
                Equal(GestureManager.Phase.Cancelled, old.State);
                Equal(false, old.Id == next.Id);
                Equal(false, manager.Complete(old, 11, maximized, 30));
                Equal(false, manager.Complete(next, 11, maximized, 30));
                Equal(false, manager.Complete(next, 12, maximized with { Process = 8 }, 30));
                Equal(false, manager.Complete(next, 12, maximized, 19));
                manager.Foreground(12);
                Equal<nint?>(12, next.Foreground);
                Equal(false, manager.Expire(next, 50, 50));
                Equal(true, manager.Expire(next, 51, 50));
                Equal(GestureManager.Phase.Expired, next.State);
                Equal(false, manager.Complete(next, 12, maximized, 60));
                var pending = manager.Start(11, normal, "key", 60);
                manager.AwaitResult(pending, 70);
                manager.Reset(0);
                Equal(GestureManager.Phase.Cancelled, pending.State);
                manager.Reset(1); // even a reused protocol generation has a new lifecycle lease
                var current = manager.Start(11, normal, "key", 80);
                Equal(false, manager.Complete(pending, 11, maximized, 90));
                Equal(true, manager.Complete(current, 11, maximized, 90));
                Equal(false, manager.AwaitResult(pending, 100));
            }
        );
        Check(
            "gesture production cancellation and maximize deadline are terminal",
            () =>
            {
                var tracker = Tracker();
                Mouse(tracker);
                var old = tracker.Gestures.Current!;
                tracker.ClearInput();
                Equal(GestureManager.Phase.Cancelled, old.State);
                tracker.Key(11, normal, VK_UP, true, false, 10, 0);
                var key = tracker.Gestures.Current!;
                Equal<nint?>(null, tracker.MaximizeTarget(1011));
                Equal(GestureManager.Phase.Expired, key.State);
                Mouse(tracker, hit: HTCAPTION, at: 1100);
                var drag = tracker.Gestures.Current!;
                tracker.MoveStart(11, 1110);
                tracker.ForegroundChanged(12);
                Equal(GestureManager.Phase.Cancelled, drag.State);
                Equal(false, tracker.HasDrag);
            }
        );
    }
}
