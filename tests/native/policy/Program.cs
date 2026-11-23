using System.Text.Json;
using static NativeMethods;

internal static partial class Program
{
    private static readonly WindowState normal = new(7, "chrome", SW_SHOWNORMAL, false);
    private static readonly WindowState maximized = normal with { Show = SW_SHOWMAXIMIZED };
    private static readonly List<string> passed = new();
    private static readonly List<object> samples = new();
    private static readonly List<object> v2Samples = new();

    private static void Check(string name, Action action)
    {
        try
        {
            action();
            passed.Add(name);
        }
        catch (Exception error)
        {
            throw new Exception($"{name}: {error.Message}", error);
        }
    }

    private static void Equal<T>(T expected, T actual)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new Exception($"expected {expected}, actual {actual}");
    }

    private static CandidateTracker Tracker()
    {
        var value = new CandidateTracker();
        value.Reset(1);
        return value;
    }

    private static JsonElement Complete(
        CandidateTracker tracker,
        long at = 135,
        nint foreground = 11,
        WindowState? before = null,
        WindowState? after = null
    ) =>
        JsonSerializer.SerializeToElement(
            tracker.Complete(
                11,
                before ?? normal,
                after ?? maximized,
                at,
                foreground,
                "2026-10-11",
                new MonitorBounds(-1920, 0, 1920, 1080)
            )
        );

    private static void Mouse(
        CandidateTracker tracker,
        int hit = HTMAXBUTTON,
        long at = 0,
        uint flags = 0,
        bool modifiers = false,
        bool foreground = true
    ) =>
        tracker.Mouse(
            11,
            normal,
            hit,
            new Point { X = -100, Y = 20 },
            at,
            500,
            flags,
            modifiers,
            foreground
        );

    private static void CheckSessionAllocator()
    {
        Check(
            "session allocator is shared, survives cancellation and rejects stale leases",
            () =>
            {
                var session = new DetectionSession();
                session.Start(1);
                var allocate = session.Allocator(1);
                Equal(1, allocate());
                var tracker = new CandidateTracker(session);
                tracker.Reset(1);
                Mouse(tracker);
                tracker.ClearInput();
                Equal(3, allocate());
                tracker.Reset(1); // clearing detector state must not rewind shared IDs
                Equal(4, allocate());
                session.Stop();
                Equal(0, allocate());
                session.Start(2);
                Equal(0, allocate());
                Equal(1, session.Allocator(2)());
                var secondLease = session.Allocator(2);
                var ids = new System.Collections.Concurrent.ConcurrentBag<int>();
                Parallel.For(0, 100, _ => ids.Add(secondLease()));
                Equal(100, ids.Distinct().Count());
                Equal(2, ids.Min());
                Equal(101, ids.Max());
                session.Start(2);
                Equal(0, secondLease());
                Equal(1, session.Allocator(2)());
                var sink = new CandidateSink(_ => throw new Exception("stale completion emitted"));
                sink.Start(2, 2);
                sink.Close(1, 1, "2026-11-10", "key", new(true, true, 25, null));
                sink.Taskbar(1, 2, "2026-11-10", "key", new(1, true, 0, 25, null));
                sink.Stop();
                sink.Close(2, 1, "2026-11-10", "key", new(true, true, 25, null));
            }
        );
    }

    private static int Main()
    {
        try
        {
            CheckSessionAllocator();
            CheckMaximizeSources();
            CheckInjectedAndConflictingInput();
            CheckCaptionClickRecognition();
            CheckUnmatchedKeysAndForeground();
            CheckInputCancellation();
            CheckWindowTransitionIdentity();
            CheckCaptionClickIdentity();
            CheckLegacyOperations();
            CheckWinDownGrouping();
            RunAdditionalPolicyTests();
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(
                $"Native policy failed after {passed.Count} cases: {error.Message}"
            );
            return 1;
        }
    }

    private static void RunAdditionalPolicyTests()
    {
        IndependentTaskbarTests();
        var windowStateSamples = CheckWindowStates();
        var placementSamples = CheckPlacement();
        CheckMonitorMoves();
        CheckCompoundDrags();
        CheckMouseReposition(placementSamples);
        CheckMouseShadow();
        CheckClickComparison();
        CheckProtocol();
        InputInfrastructureTests();
        var snapSamples = SnapTests.Run(passed);
        var taskbarSamples = TaskbarTests.Run(passed);
        var switchSamples = WindowSwitchTests.Run(passed);
        var captionSamples = InactiveCaptionTests.Run(passed);
        IndependentCloseTests();
        var closeSamples = WindowCloseTests.Run(passed);
        var independentResultSamples = IndependentResultsTests.Run(passed);
        CheckIndependentDragDetectors();
        var independentDragSamples = IndependentDragRouterTests();
        var composerSamples = ResultComposerTests();
        WriteReport(
            new
            {
                passed,
                samples,
                v2Samples,
                snapSamples,
                taskbarSamples,
                switchSamples,
                captionSamples,
                windowStateSamples,
                placementSamples,
                monitorMoveSamples,
                compoundSamples,
                closeSamples,
                independentResultSamples,
                composerSamples,
                independentDragSamples,
                independentInputSamples = IndependentSequenceTests()
                    .Concat(independentMouseSamples)
                    .ToArray(),
                independence = IndependentDetection.Run(VerifyRouterDrag),
                windowDiagnosticKeys = Enum.GetNames<WindowDiagnosticReason>(),
                globalInputCollected = false,
            }
        );
    }

    private static void WriteReport(object report) =>
        Console.WriteLine(JsonSerializer.Serialize(report));
}
