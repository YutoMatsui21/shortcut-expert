using ShortcutExpert.Detection;
using static NativeMethods;

internal static partial class Program
{
    private static void IndependentTaskbarTests()
    {
        foreach (string origin in new[] { "mouse", "key" })
        {
            foreach (
                string mode in new[]
                {
                    "valid",
                    "delay",
                    "unknown",
                    "slot",
                    "stale",
                    "failure",
                    "reorder",
                    "early",
                    "timeout",
                    "stop",
                    "reset",
                    "lease",
                    "process",
                    "cancel",
                }
            )
                Check(
                    $"independent taskbar {origin}/{mode}",
                    () => new TaskbarReplay(origin, mode).ConfirmAdmission()
                );
            foreach (
                string mode in new[]
                {
                    "valid",
                    "repeat",
                    "injected",
                    "modifier",
                    "unknown",
                    "delay",
                    "failure",
                    "cancel",
                    "root",
                    "unreleased",
                }
            )
                Check(
                    $"taskbar input and W01 exclusion {origin}/{mode}",
                    () => new TaskbarReplay(origin, mode).ReplayInput()
                );
        }
        Check(
            "old UIA completion cannot resolve a new gesture after same-generation reset",
            TaskbarResetCompletion
        );
        Check("taskbar pending overflow cancels all results", TaskbarPendingOverflow);
        Check(
            "taskbar retains distinct pending gestures and consumes completions once",
            () => TaskbarConcurrentInputs(false)
        );
        TaskbarDisplayTests();
    }

    private static void TaskbarDisplayTests()
    {
        Check("display change invalidates taskbar input and UIA snapshots", TaskbarDisplayChange);
        Check(
            "taskbar display topology is order-independent and rejects incomplete reads",
            TaskbarDisplayTopology
        );
        Check(
            "display change before router delivery rejects an in-flight UIA query",
            () => TaskbarTopologyChange(false)
        );
        Check(
            "fresh UIA query cannot confirm input from the old display topology",
            () => TaskbarTopologyChange(true)
        );
        Check(
            "an unreadable display topology cannot confirm taskbar input",
            () => TaskbarTopologyChange(true, null)
        );
        Check(
            "display change during output discards remaining taskbar gestures",
            () => TaskbarConcurrentInputs(true)
        );
    }

    private static void TaskbarDisplayTopology()
    {
        int secondaryScale = 150;
        bool Monitor(nint handle, ref MonitorInfo info)
        {
            info.Monitor = new Rect { Left = (int)handle * 100, Right = (int)handle * 100 + 100 };
            return handle != 3;
        }
        int Scale(nint handle, out int scale)
        {
            scale = handle == 1 ? 100 : secondaryScale;
            return handle == 4 ? -1 : 0;
        }
        string? Read(params int[] handles) =>
            DisplayTopology.Read(
                callback => handles.All(handle => callback(handle, 0, 0, 0)),
                Monitor,
                Scale
            );

        string? initial = Read(1, 2);
        Equal(true, initial is not null);
        Equal(initial, Read(2, 1));
        Equal(false, initial == Read(1));
        secondaryScale = 200;
        Equal(false, initial == Read(1, 2));
        Equal<string?>(null, Read(1, 3));
        Equal<string?>(null, Read(1, 4));
        Equal<string?>(null, Read());
    }

    private static void TaskbarTopologyChange(bool queryAfterChange, string? topology = "changed")
    {
        var replay = new TaskbarReplay("mouse", "valid");
        var detector = replay.Detector;
        var point = new Point { X = 20, Y = 20 };
        detector.Complete(detector.BeginQuery(50), replay.Layout, 7, null);
        detector.Mouse(new(WM_LBUTTONDOWN, point, 11, false, false));
        detector.Mouse(new(WM_LBUTTONUP, point, 11, false, false));

        var query = detector.BeginQuery(101);
        replay.DisplayTopology = topology;
        if (queryAfterChange)
            query = detector.BeginQuery(102);
        replay.At = 110;
        detector.Complete(query, replay.Layout, 7, null);
        Equal(0, replay.Output.Count);

        replay.DisplayTopology = "changed";
        replay.At = 115;
        detector.Complete(detector.BeginQuery(111), replay.Layout, 7, null);
        replay.At = 120;
        detector.Mouse(new(WM_LBUTTONDOWN, point, 11, false, false));
        detector.Mouse(new(WM_LBUTTONUP, point, 11, false, false));
        replay.At = 130;
        detector.Complete(detector.BeginQuery(121), replay.Layout, 7, null);
        Equal(1, replay.Output.Count);
    }

    private static void TaskbarDisplayChange()
    {
        var replay = new TaskbarReplay("mouse", "valid");
        replay.Detector.Complete(replay.Detector.BeginQuery(50), replay.Layout, 7, null);
        var point = new Point { X = 20, Y = 20 };
        replay.Add();
        replay.Detector.Mouse(new(WM_LBUTTONDOWN, point, 11, false, false));
        var old = replay.Detector.BeginQuery(101);

        replay.At = 110;
        replay.Router.Dispatch(new ObservedEvent(ObservedKind.DisplayInvalidated, 1, 0, replay.At));
        replay.Detector.Complete(old, replay.Layout, 7, null);
        replay.Detector.Mouse(new(WM_LBUTTONUP, point, 11, false, false));
        replay.Detector.Mouse(new(WM_LBUTTONDOWN, point, 11, false, false));
        replay.Detector.Mouse(new(WM_LBUTTONUP, point, 11, false, false));
        replay.At = 130;
        replay.Detector.Complete(replay.Detector.BeginQuery(120), replay.Layout, 7, null);
        Equal(0, replay.Output.Count);

        replay.Detector.Mouse(new(WM_LBUTTONDOWN, point, 11, false, false));
        replay.Detector.Mouse(new(WM_LBUTTONUP, point, 11, false, false));
        replay.At = 150;
        replay.Detector.Complete(replay.Detector.BeginQuery(140), replay.Layout, 7, null);
        Equal(1, replay.Output.Count);
    }

    private static void TaskbarConcurrentInputs(bool displayChanges)
    {
        var replay = new TaskbarReplay("mouse", "valid");
        if (displayChanges)
            replay.AfterOutput = () => replay.DisplayTopology = "changed";
        replay.Add();
        replay.At = 110;
        replay.Add();
        replay.At = 200;
        var query = replay.Detector.BeginQuery(111);
        replay.Detector.Complete(query, replay.Layout, 7, null);
        int expected = displayChanges ? 1 : 2;
        Equal(expected, replay.Output.Count);
        Equal(
            expected,
            replay.Output.Cast<CandidateEnvelope>().Select(e => e.transaction).Distinct().Count()
        );
        replay.Detector.Complete(query, replay.Layout, 7, null);
        Equal(expected, replay.Output.Count);
    }

    private static void TaskbarResetCompletion()
    {
        var replay = new TaskbarReplay("mouse", "valid");
        replay.Add();
        var old = replay.Detector.BeginQuery(101);
        replay.Detector.Start(1);
        replay.At = 120;
        replay.Add();
        replay.At = 200;
        replay.Detector.Complete(old, replay.Layout, 7, null);
        Equal(0, replay.Output.Count);
        replay.Detector.Complete(replay.Detector.BeginQuery(121), replay.Layout, 7, null);
        Equal(1, replay.Output.Count);
    }

    private static void TaskbarPendingOverflow()
    {
        var replay = new TaskbarReplay("mouse", "valid");
        for (int i = 0; i < 17; i++)
            replay.Add();
        replay.At = 200;
        replay.Detector.Complete(replay.Detector.BeginQuery(101), replay.Layout, 7, null);
        Equal(0, replay.Output.Count);
    }

    private sealed class TaskbarReplay
    {
        private readonly string origin,
            mode;
        private readonly DetectionSession session = new();
        private readonly WindowSwitchDetector switching;
        internal readonly List<object> Output = new();
        internal readonly DetectionRouter Router = new();
        internal readonly TaskbarDetector Detector;
        internal long At = 100;
        internal string? DisplayTopology = "initial";
        internal Action? AfterOutput;
        internal readonly TaskbarSnapshot Layout = new(
            null,
            11,
            0,
            0,
            100,
            40,
            new[] { new TaskbarItem("fixture", 0, 0, 40, 40) }
        );
        private bool Key => origin == "key";

        internal TaskbarReplay(string origin, string mode)
        {
            this.origin = origin;
            this.mode = mode;
            session.Start(1);
            var sink = new CandidateSink(candidate =>
            {
                Output.Add(candidate);
                AfterOutput?.Invoke();
            });
            sink.Start(1, 2);
            Router.Reset(1);
            Detector = TaskbarDetector.Register(
                Router,
                session,
                sink,
                () => At,
                () => DisplayTopology,
                () => "2026-11-15"
            );
            Detector.Start(1);
            Detector.Neutral(true);
            switching = new(session, sink, new DetectionRouter(), session.Allocator(1), new());
            switching.Start(1);
            switching.Dispatch(new SwitchNeutralEvent(1, 0, true));
        }

        internal void Add() =>
            Detector.Add(
                new(
                    origin,
                    mode == "slot" ? 2 : 1,
                    mode == "unknown" ? TaskbarSnapshot.Unknown : Layout,
                    mode == "stale" ? -651 : 50,
                    7
                )
            );

        internal void ConfirmAdmission()
        {
            var query = Detector.BeginQuery(mode == "early" ? 99 : 101);
            Add();
            Equal(0, Output.Count);
            Interrupt();
            At =
                mode == "timeout" ? 2601
                : mode == "delay" ? 2500
                : 200;
            var result = Result();
            Detector.Complete(query, result, mode == "process" ? 8u : 7u, new(0, 0, 1920, 1080));
            bool accepted = mode is "valid" or "delay";
            AssertCount(accepted);
            Detector.Complete(query, result, 7, null);
            AssertCount(accepted);
            if (accepted)
                Export();
        }

        private TaskbarSnapshot Result() =>
            mode switch
            {
                "failure" => TaskbarSnapshot.Unknown,
                "reorder" => Layout with
                {
                    Items = new[] { new TaskbarItem("other", 0, 0, 40, 40) },
                },
                _ => Layout,
            };

        private void Interrupt()
        {
            switch (mode)
            {
                case "stop":
                    Detector.Stop();
                    break;
                case "reset":
                    Detector.Start(1);
                    break;
                case "lease":
                    session.Stop();
                    session.Start(1);
                    break;
                case "cancel":
                    Detector.Cancel();
                    break;
            }
        }

        internal void ReplayInput()
        {
            At = 50;
            Detector.Complete(
                Detector.BeginQuery(0),
                mode == "unknown" ? TaskbarSnapshot.Unknown : Layout,
                7,
                null
            );
            At = 100;
            if (Key)
                PressKeys();
            else
                Click();
            Equal(0, Output.Count);
            switching.Dispatch(new SwitchForegroundEvent(1, 150, 13, 13, new(13, 9), 100, 150));
            switching.Dispatch(new SwitchPollEvent(1, 500, new(13, 9), null));
            Interrupt();
            At = mode == "delay" ? 2000 : 200;
            Detector.Complete(Detector.BeginQuery(151), Result(), 7, null);
            AssertCount(InputAccepted());
        }

        private bool InputAccepted() =>
            mode is "valid" or "repeat" or "delay" || Key && mode is "root" or "unreleased";

        private void PressKeys()
        {
            Detector.Key(new(VK_LWIN, true, false, false));
            Detector.Key(new(0x31, true, mode == "injected", mode == "modifier"));
            if (mode == "repeat")
                Detector.Key(new(0x31, true, false, false));
            switching.Dispatch(new SwitchKeyEvent(1, 100, VK_LWIN, true, false, new(12, 8)));
            switching.Dispatch(new SwitchKeyEvent(1, 100, 0x31, true, false, null));
        }

        private void Click()
        {
            var point = new Point { X = 20, Y = 20 };
            Detector.Mouse(
                new(
                    WM_LBUTTONDOWN,
                    point,
                    mode == "root" ? 99 : 11,
                    mode == "injected",
                    mode == "modifier"
                )
            );
            if (mode != "unreleased")
                Detector.Mouse(new(WM_LBUTTONUP, point, 11, false, mode == "modifier"));
            // Taskbar classes are ineligible W01 targets independently of UIA results.
            switching.Dispatch(
                new SwitchMouseEvent(1, 100, WM_LBUTTONDOWN, null, new(12, 8), false, false)
            );
            switching.Dispatch(
                new SwitchMouseEvent(1, 110, WM_LBUTTONUP, null, null, false, false)
            );
        }

        private void AssertCount(bool accepted)
        {
            Equal(accepted ? 1 : 0, Output.Count);
            if (!accepted)
                return;
            var envelope = (CandidateEnvelope)Output.Single();
            Equal("independent-results", envelope.route);
            Equal(
                true,
                ((IndependentResultsEvidence)envelope.evidence).results.Single()
                    is IndependentTaskbarProof { slot: 1, mappingConfirmed: true }
            );
        }

        private void Export() =>
            independentMouseSamples.Add(
                new
                {
                    line = System.Text.Json.JsonSerializer.Serialize(
                        (CandidateEnvelope)Output.Single()
                    ),
                    expected = new[] { "W12" },
                    origin,
                }
            );
    }
}
