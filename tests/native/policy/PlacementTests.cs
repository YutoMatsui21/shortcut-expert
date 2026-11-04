using static NativeMethods;

internal static partial class Program
{
    private static List<object> CheckPlacement()
    {
        var output = new List<object>();
        var monitor = new MonitorBounds(-1921, -1200, 1921, 1200);
        var work = new MonitorBounds(-1921, -1160, 1921, 1120);
        var start = normal with
        {
            Monitor = monitor,
            Work = work,
            Dpi = 144,
            DisplayLayout = "stable",
            Frame = new(-1700, -1000, 600, 600),
        };
        WindowState Placed(string side, string vertical) =>
            start with
            {
                Arranged = true,
                Frame = new(
                    work.x + (side == "left" ? 0 : work.width / 2),
                    work.y + (vertical == "bottom" ? work.height / 2 : 0),
                    side == "left" ? work.width / 2 : work.width - work.width / 2,
                    vertical == "half" ? work.height : work.height / 2
                ),
            };
        foreach (bool inputCaption in new[] { false, true })
            Check(
                $"placement retains caption requirement on input/result: {inputCaption}",
                () =>
                {
                    var before = start with { HasCaption = inputCaption };
                    var after = Placed("left", "half") with { HasCaption = !inputCaption };
                    var tracker = Tracker();
                    tracker.Key(11, before, VK_LEFT, true, false, 0, 0);
                    Equal<object?>(null, tracker.FinishKey(11, after, 100, false, "2026-10-28"));
                    tracker = Tracker();
                    tracker.Mouse(11, before, HTCAPTION, default, 0, 500, 0, false, true);
                    tracker.MoveStart(11, 100);
                    tracker.MouseReleased(
                        new Point { X = work.x, Y = work.y + work.height / 2 },
                        monitor,
                        work,
                        0
                    );
                    Equal<object?>(null, tracker.FinishMove(11, after, 200, 11, "2026-10-28"));
                }
            );
        void Sample(PlacementResult result, string? expected)
        {
            int id = 1000 + output.Count;
            output.Add(
                new
                {
                    candidate = new CandidateEnvelope(
                        "candidate",
                        2,
                        1,
                        id,
                        id,
                        "2026-10-28",
                        result.Origin,
                        result.Origin == "mouse" ? "caption-edge-drag" : "win-held-arrows",
                        false,
                        false,
                        result.Evidence
                    ),
                    expected,
                }
            );
        }
        Check(
            "dock settings reads are isolated and restore DPI context even on failure",
            () =>
            {
                foreach (int? value in new int?[] { null, -1, 0, 1, 8, 64, 256, 257, int.MaxValue })
                {
                    var calls = new List<nint>();
                    var read = WindowDockSettings.Read(
                        context =>
                        {
                            calls.Add(context);
                            return -4;
                        },
                        () => value
                    );
                    Equal(value is >= 1 and <= 256 ? value : null, read);
                    Equal(2, calls.Count);
                    Equal((nint)(-2), calls[0]);
                    Equal((nint)(-4), calls[1]);
                }
                int queries = 0;
                Equal<int?>(
                    null,
                    WindowDockSettings.Read(
                        _ => 0,
                        () =>
                        {
                            queries++;
                            return 64;
                        }
                    )
                );
                Equal(0, queries);
                var restored = new List<nint>();
                bool threw = false;
                try
                {
                    WindowDockSettings.Read(
                        context =>
                        {
                            restored.Add(context);
                            return -4;
                        },
                        () => throw new InvalidOperationException("fixture")
                    );
                }
                catch (InvalidOperationException)
                {
                    threw = true;
                }
                Equal(true, threw);
                Equal(2, restored.Count);
                Equal((nint)(-4), restored[1]);
            }
        );
        Check(
            "OS docking threshold admits early side/corner previews while rejecting its outside",
            () =>
            {
                foreach (string side in new[] { "left", "right" })
                foreach (string vertical in new[] { "half", "top", "bottom" })
                {
                    var before = start with { MouseDockThresholdPx = 64 };
                    var after = Placed(side, vertical) with { MouseDockThresholdPx = 64 };
                    int edge = side == "left" ? work.x : work.x + work.width - 1;
                    int y = vertical == "bottom" ? work.y + work.height - 1 : work.y;
                    foreach (int distance in new[] { 8, 33, 64, 65, 500 })
                    {
                        var point = new Point
                        {
                            X = edge + (side == "left" ? distance : -distance),
                            Y = y,
                        };
                        var evidence = PlacementGeometry.Drag(
                            before,
                            after,
                            point,
                            monitor,
                            work,
                            100,
                            true
                        );
                        Equal(distance <= 64, evidence is not null);
                    }
                    var preview = new Point { X = edge + (side == "left" ? 60 : -60), Y = y };
                    foreach (int? raw in new int?[] { null, 0, -1, 257, int.MaxValue })
                        Equal<PlacementEvidence?>(
                            null,
                            PlacementGeometry.Drag(
                                before with
                                {
                                    MouseDockThresholdPx = raw,
                                },
                                after with
                                {
                                    MouseDockThresholdPx = raw,
                                },
                                preview,
                                monitor,
                                work,
                                100,
                                true
                            )
                        );
                    Equal<PlacementEvidence?>(
                        null,
                        PlacementGeometry.Drag(
                            before,
                            after with
                            {
                                MouseDockThresholdPx = 8,
                            },
                            new Point { X = edge, Y = y },
                            monitor,
                            work,
                            100,
                            true
                        )
                    );
                    Equal<PlacementEvidence?>(
                        null,
                        PlacementGeometry.Drag(
                            before with
                            {
                                Arranged = true,
                            },
                            after,
                            preview,
                            monitor,
                            work,
                            100,
                            true
                        )
                    );
                    Equal<PlacementEvidence?>(
                        null,
                        PlacementGeometry.Drag(before, after, preview, monitor, work, 100, false)
                    );
                    Equal<PlacementEvidence?>(
                        null,
                        PlacementGeometry.Drag(before, after, preview, monitor, work, 1001, true)
                    );
                }
            }
        );
        Check(
            "natural direct side-edge release accepts observed 3..8px while preserving interior/start guards",
            () =>
            {
                foreach (string side in new[] { "left", "right" })
                foreach (string vertical in new[] { "half", "top", "bottom" })
                {
                    var after = Placed(side, vertical);
                    int y = vertical == "bottom" ? work.y + work.height / 2 : work.y;
                    int edge = side == "left" ? work.x : work.x + work.width - 1;
                    foreach (int distance in new[] { 3, 8, 9, 100 })
                    {
                        var point = new Point
                        {
                            X = edge + (side == "left" ? distance : -distance),
                            Y = y,
                        };
                        var evidence = PlacementGeometry.Drag(
                            start,
                            after,
                            point,
                            monitor,
                            work,
                            100,
                            true
                        );
                        Equal(distance <= 8, evidence is not null);
                        if (evidence is not null)
                            Equal(side + "-" + vertical, evidence.shape);
                    }
                    var release = new Point { X = edge + (side == "left" ? 8 : -8), Y = y };
                    Equal<PlacementEvidence?>(
                        null,
                        PlacementGeometry.Drag(
                            start with
                            {
                                Arranged = true,
                            },
                            after,
                            release,
                            monitor,
                            work,
                            100,
                            true
                        )
                    );
                    Equal<PlacementEvidence?>(
                        null,
                        PlacementGeometry.Drag(
                            start with
                            {
                                Arranged = null,
                            },
                            after,
                            release,
                            monitor,
                            work,
                            100,
                            true
                        )
                    );
                    Equal<PlacementEvidence?>(
                        null,
                        PlacementGeometry.Drag(start, after, release, monitor, work, 100, false)
                    );
                    Equal<PlacementEvidence?>(
                        null,
                        PlacementGeometry.Drag(start, after, release, monitor, work, 1001, true)
                    );
                }
            }
        );
        Check(
            "placement diagnostics preserve outcomes and categorize bounded rejection reasons",
            () =>
            {
                foreach (
                    string mode in new[]
                    {
                        "valid",
                        "side3",
                        "side12",
                        "side64",
                        "outside-y",
                        "shape",
                        "age",
                        "unmatched",
                    }
                )
                {
                    var after = Placed("left", "top");
                    int offset =
                        mode == "side3" ? 3
                        : mode == "side12" ? 12
                        : mode == "side64" ? 64
                        : 0;
                    var point = new Point
                    {
                        X = work.x + offset,
                        Y = mode == "outside-y" ? work.y - 1 : work.y,
                    };
                    if (mode == "shape")
                        after = after with { Frame = after.Frame! with { x = after.Frame!.x + 3 } };
                    long age = mode == "age" ? 1001 : 100;
                    bool matched = mode != "unmatched";
                    var expected = PlacementGeometry.Drag(
                        start,
                        after,
                        point,
                        monitor,
                        work,
                        age,
                        matched
                    );
                    var reasons = new List<WindowDiagnosticReason>();
                    var actual = PlacementGeometry.Drag(
                        start,
                        after,
                        point,
                        monitor,
                        work,
                        age,
                        matched,
                        reasons.Add
                    );
                    Equal(expected, actual);
                    Equal(true, reasons.Count > 0);
                    var reason = mode switch
                    {
                        "valid" => WindowDiagnosticReason.PlacementAccepted,
                        "side3" => WindowDiagnosticReason.PlacementSide3To8,
                        "side12" => WindowDiagnosticReason.PlacementSide9To32,
                        "side64" => WindowDiagnosticReason.PlacementSideAbove32,
                        "outside-y" => WindowDiagnosticReason.PlacementYOutside,
                        "shape" => WindowDiagnosticReason.PlacementShapeUnknown,
                        "age" => WindowDiagnosticReason.PlacementStartAgeInvalid,
                        _ => WindowDiagnosticReason.PlacementInputUnmatched,
                    };
                    Equal(true, reasons.Contains(reason));
                }
                foreach (bool foreground in new[] { true, false })
                {
                    var tracker = Tracker();
                    var reasons = new List<WindowDiagnosticReason>();
                    tracker.Diagnostic = reasons.Add;
                    tracker.Mouse(11, start, HTCAPTION, default, 0, 500, 0, false, true);
                    tracker.MoveStart(11, 100);
                    if (foreground)
                        tracker.ForegroundChanged(12);
                    else
                        tracker.ClearInput();
                    Equal<object?>(
                        null,
                        tracker.FinishMove(11, Placed("left", "top"), 300, 11, "2026-10-28")
                    );
                    Equal(
                        true,
                        reasons.Contains(
                            foreground
                                ? WindowDiagnosticReason.DragForegroundCancelled
                                : WindowDiagnosticReason.DragInputCancelled
                        )
                    );
                    Equal(true, reasons.Contains(WindowDiagnosticReason.DragNoSource));
                }
            }
        );
        foreach (uint dpi in new uint[] { 96, 144, 192 })
        foreach (uint show in new uint[] { SW_SHOWNORMAL, SW_SHOWMAXIMIZED })
            Check(
                $"placement geometry physical units/start {show}/DPI {dpi}",
                () =>
                {
                    var after = Placed("right", "top") with { Dpi = dpi };
                    var before = start with { Show = show, Dpi = dpi };
                    Equal("right-top", PlacementGeometry.Shape(after));
                    Equal(
                        true,
                        PlacementGeometry.Drag(
                            before,
                            after,
                            new Point { X = work.x + work.width - 1, Y = work.y },
                            monitor,
                            work,
                            100,
                            true
                        )
                            is not null
                    );
                    Equal<string?>(
                        null,
                        PlacementGeometry.Shape(
                            after with
                            {
                                Frame = after.Frame! with { x = after.Frame!.x + 3 },
                            }
                        )
                    );
                    Equal<string?>(null, PlacementGeometry.Shape(after with { Arranged = false }));
                    Equal<string?>(null, PlacementGeometry.Shape(after with { Dpi = 0 }));
                }
            );
        foreach (string side in new[] { "left", "right" })
        foreach (string vertical in new[] { "half", "top", "bottom" })
        {
            var after = Placed(side, vertical);
            uint horizontal = (uint)(side == "left" ? VK_LEFT : VK_RIGHT);
            uint direction = (uint)(vertical == "top" ? VK_UP : VK_DOWN);
            Check(
                $"placement key sequence {side}-{vertical}: only terminal result",
                () =>
                {
                    var tracker = Tracker();
                    tracker.Key(11, start, horizontal, true, false, 0, 0);
                    var half = Placed(side, "half");
                    Equal<object?>(
                        null,
                        tracker.Complete(11, start, half, 20, 11, "2026-10-28", monitor)
                    );
                    // Held-key repeat is ignored, including its timestamp.
                    tracker.Key(11, half, horizontal, true, false, 30, 0);
                    tracker.KeyReleased(horizontal);
                    if (vertical != "half")
                    {
                        tracker.Key(11, half, direction, true, false, 50, 0);
                        Equal<object?>(
                            null,
                            tracker.Complete(11, half, after, 70, 11, "2026-10-28", monitor)
                        );
                        tracker.KeyReleased(direction);
                    }
                    var result = tracker.Placement.Finish(11, after, 100, false);
                    Equal(true, result is not null);
                    Sample(result!, vertical == "half" ? "W06" : "W07");
                    Equal<PlacementResult?>(null, tracker.Placement.Finish(11, after, 101, false));
                }
            );
            Check(
                $"placement direct drag {side}-{vertical}",
                () =>
                {
                    var tracker = Tracker();
                    tracker.Mouse(11, start, HTCAPTION, default, 0, 500, 0, false, true);
                    tracker.MoveStart(11, 100);
                    Equal<object?>(
                        null,
                        tracker.Complete(11, start, after, 200, 11, "2026-10-28", monitor)
                    );
                    tracker.MouseReleased(
                        new Point
                        {
                            X = side == "left" ? work.x : work.x + work.width - 1,
                            Y = vertical == "bottom" ? work.y + work.height - 1 : work.y,
                        },
                        monitor,
                        work,
                        0
                    );
                    var result = tracker.FinishMove(11, after, 5000, 11, "2026-10-28");
                    Equal(true, result is PlacementResult);
                    Sample((PlacementResult)result!, vertical == "half" ? "W06" : "W07");
                    Equal<object?>(null, tracker.FinishMove(11, after, 5001, 11, "2026-10-28"));
                }
            );
        }
        Check(
            "completed W06 then a new Win-held W07 are independent",
            () =>
            {
                var tracker = Tracker();
                var half = Placed("left", "half");
                var quarter = Placed("left", "top");
                tracker.Key(11, start, VK_LEFT, true, false, 0, 0);
                tracker.KeyReleased(VK_LEFT);
                Sample(tracker.Placement.Finish(11, half, 50, false)!, "W06");
                tracker.Key(11, null, VK_LWIN, false, false, 100, 1);
                tracker.Key(11, half, VK_UP, true, false, 110, 0);
                tracker.KeyReleased(VK_UP);
                Sample(tracker.Placement.Finish(11, quarter, 150, false)!, "W07");
            }
        );
        foreach (
            var before in new[] { start with { Arranged = null }, start with { Arranged = true } }
        )
            Check(
                "unknown initial placement cannot restart from its intermediate half",
                () =>
                {
                    var tracker = Tracker();
                    tracker.Key(11, before, VK_LEFT, true, false, 0, 0);
                    tracker.KeyReleased(VK_LEFT);
                    tracker.Key(11, Placed("left", "half"), VK_UP, true, false, 50, 0);
                    Equal<PlacementResult?>(
                        null,
                        tracker.Placement.Finish(11, Placed("left", "top"), 100, false)
                    );
                }
            );
        Check(
            "both physical Win keys must be released before finishing one series",
            () =>
            {
                var tracker = Tracker();
                var half = Placed("left", "half");
                var quarter = Placed("left", "top");
                tracker.Key(11, null, VK_LWIN, false, false, 0, 1);
                tracker.Key(11, start, VK_LEFT, true, false, 10, 0);
                tracker.KeyReleased(VK_LEFT);
                tracker.Key(11, null, VK_RWIN, false, false, 30, 1);
                tracker.KeyReleased(VK_LWIN);
                Equal<object?>(null, tracker.FinishKey(11, half, 50, false, "2026-10-28"));
                tracker.Key(11, half, VK_UP, true, false, 60, 0);
                tracker.KeyReleased(VK_UP);
                tracker.KeyReleased(VK_RWIN);
                var result = tracker.FinishKey(11, quarter, 100, false, "2026-10-28");
                Equal(true, result is PlacementResult);
                Sample((PlacementResult)result!, "W07");
            }
        );
        foreach (uint flags in new[] { LLKHF_INJECTED, LLKHF_LOWER_IL_INJECTED })
            Check(
                $"injected Up repeat cancels an existing placement series: {flags}",
                () =>
                {
                    var tracker = Tracker();
                    var half = Placed("left", "half");
                    var quarter = Placed("left", "top");
                    tracker.Key(11, start, VK_LWIN, false, false, 0, 0);
                    tracker.Key(11, start, VK_LEFT, true, false, 10, 0);
                    tracker.KeyReleased(VK_LEFT);
                    tracker.Key(11, half, VK_UP, true, false, 20, 0);
                    tracker.Key(11, quarter, VK_UP, true, false, 30, flags);
                    tracker.KeyReleased(VK_UP);
                    tracker.Key(11, quarter, VK_UP, true, false, 40, 0);
                    Equal<WindowCandidate?>(
                        null,
                        tracker.ConfirmMaximize(
                            11,
                            start with
                            {
                                Show = SW_SHOWMAXIMIZED,
                            },
                            45,
                            11,
                            "2026-10-28"
                        )
                    );
                    tracker.KeyReleased(VK_UP);
                    tracker.KeyReleased(VK_LWIN);
                    Equal<object?>(null, tracker.FinishKey(11, quarter, 50, false, "2026-10-28"));
                }
            );
        Check(
            "arranged Win+Up maximize still records W03 without claiming an equivalent key",
            () =>
            {
                var tracker = Tracker();
                var before = Placed("left", "top");
                var after = start with { Show = SW_SHOWMAXIMIZED };
                tracker.Key(11, before, VK_UP, true, false, 0, 0);
                var result = tracker.Complete(11, before, after, 20, 11, "2026-10-28", monitor);
                tracker.KeyReleased(VK_UP);
                Equal<object?>(null, tracker.FinishKey(11, after, 100, false, "2026-10-28"));
                Equal(true, result is WindowCandidate);
                var c = (WindowCandidate)result!;
                int id = 1000 + output.Count;
                output.Add(new { candidate = CandidateProtocol.V2(c, id, id), expected = "W03" });
            }
        );
        Check(
            "Win+Shift repeated physical moves retain the existing W02 route",
            () =>
            {
                var tracker = Tracker();
                var moved = start with { Monitor = new(0, -1200, 1921, 1200) };
                for (int i = 0; i < 2; i++)
                {
                    var before = i == 0 ? start : moved;
                    var after = i == 0 ? moved : start;
                    tracker.Key(11, before, VK_RIGHT, true, false, i * 200, 0, shiftDown: true);
                    tracker.KeyReleased(VK_RIGHT);
                    var c =
                        tracker.Complete(
                            11,
                            before,
                            after,
                            i * 200 + 50,
                            11,
                            "2026-10-28",
                            after.Monitor
                        ) as WindowCandidate;
                    Equal(true, c is not null);
                    Equal("key", c!.origin);
                    Equal("win-shift-right", c.route);
                    tracker.KeyReleased(VK_RIGHT);
                }
            }
        );
        Check(
            "nonstandard arranged window retains standalone W03",
            () =>
            {
                var tracker = Tracker();
                var before = start with { Arranged = true };
                tracker.Key(11, before, VK_UP, true, false, 0, 0);
                var c =
                    tracker.Complete(
                        11,
                        before,
                        start with
                        {
                            Show = SW_SHOWMAXIMIZED,
                        },
                        50,
                        11,
                        "2026-10-28",
                        monitor
                    ) as WindowCandidate;
                Equal(true, c is not null);
                Equal("key", c!.origin);
                Equal("win-up", c.route);
            }
        );
        Check(
            "normal to half to quarter to maximized ends in W03",
            () =>
            {
                var tracker = Tracker();
                var half = Placed("left", "half");
                var quarter = Placed("left", "top");
                tracker.Key(11, start, VK_LEFT, true, false, 0, 0);
                tracker.KeyReleased(VK_LEFT);
                tracker.Key(11, half, VK_UP, true, false, 50, 0);
                tracker.KeyReleased(VK_UP);
                tracker.Key(11, quarter, VK_UP, true, false, 100, 0);
                tracker.KeyReleased(VK_UP);
                var c =
                    tracker.FinishKey(
                        11,
                        start with
                        {
                            Show = SW_SHOWMAXIMIZED,
                        },
                        150,
                        false,
                        "2026-10-28"
                    ) as WindowCandidate;
                Equal(true, c is not null);
                Equal(true, c!.before.arranged);
                int id = 1000 + output.Count;
                output.Add(new { candidate = CandidateProtocol.V2(c, id, id), expected = "W03" });
            }
        );
        foreach (
            string mode in new[]
            {
                "cancel",
                "click",
                "modifier",
                "injected",
                "release-injected",
                "repeat-expired",
                "timeout",
                "clock",
                "window",
                "foreground",
                "process",
                "layout",
                "work",
                "dpi",
                "monitor",
                "unknown-arranged",
                "maximized",
                "size-limit",
                "free-ratio",
                "stop",
                "destroy",
            }
        )
            Check(
                $"placement key rejects {mode}",
                () =>
                {
                    var tracker = Tracker();
                    var after = Placed("right", "bottom");
                    tracker.Key(
                        11,
                        start,
                        VK_RIGHT,
                        true,
                        false,
                        0,
                        mode == "injected" ? LLKHF_INJECTED : 0
                    );
                    tracker.KeyReleased(VK_RIGHT);
                    tracker.Key(11, Placed("right", "half"), VK_DOWN, true, false, 50, 0);
                    if (mode == "cancel")
                        tracker.Key(11, after, 0x1b, false, false, 60, 0);
                    if (mode == "click")
                        tracker.Mouse(11, after, HTCAPTION, default, 60, 500, 0, false, true);
                    if (mode == "modifier")
                        tracker.Key(11, null, VK_SHIFT, false, false, 60, 0);
                    if (mode == "foreground")
                        tracker.ForegroundChanged(12);
                    if (mode == "repeat-expired")
                        tracker.Key(11, after, VK_DOWN, true, false, 1100, 0);
                    if (mode == "stop")
                        tracker.Reset(2);
                    if (mode == "destroy")
                        tracker.Forget(11);
                    after = mode switch
                    {
                        "process" => after with { Process = 8 },
                        "layout" => after with { DisplayLayout = "new" },
                        "dpi" => after with { Dpi = 192 },
                        "work" => after with { Work = work with { height = 1000 } },
                        "monitor" => after with { Monitor = new(0, 0, 1921, 1200) },
                        "unknown-arranged" => after with { Arranged = null },
                        "maximized" => after with { Show = SW_SHOWMAXIMIZED },
                        "size-limit" => after with { Frame = after.Frame! with { width = 1300 } },
                        "free-ratio" => after with { Frame = after.Frame! with { height = 550 } },
                        _ => after,
                    };
                    long time =
                        mode == "timeout" ? 15001
                        : mode == "repeat-expired" ? 1101
                        : mode == "clock" ? -1
                        : 100;
                    Equal<PlacementResult?>(
                        null,
                        tracker.Placement.Finish(
                            mode == "window" ? 12 : 11,
                            after,
                            time,
                            mode == "release-injected"
                        )
                    );
                }
            );
        foreach (
            string mode in new[]
            {
                "layout-selection",
                "resize",
                "no-start",
                "no-release",
                "cancel",
                "other-window",
                "injected",
                "program",
                "cross-half",
                "cross-quarter",
            }
        )
            Check(
                $"placement drag boundary {mode}",
                () =>
                {
                    var tracker = Tracker();
                    var after = Placed("left", mode == "cross-half" ? "half" : "top");
                    if (mode != "program")
                        tracker.Mouse(
                            11,
                            start,
                            mode == "resize" ? 10 : HTCAPTION,
                            default,
                            0,
                            500,
                            0,
                            false,
                            true
                        );
                    if (mode != "no-start")
                        tracker.MoveStart(11, 100);
                    var destination = mode.StartsWith("cross-")
                        ? new MonitorBounds(0, 0, 1921, 1200)
                        : monitor;
                    var destinationWork = mode.StartsWith("cross-")
                        ? new MonitorBounds(0, 40, 1921, 1120)
                        : work;
                    if (mode.StartsWith("cross-"))
                        after = after with
                        {
                            Monitor = destination,
                            Work = destinationWork,
                            Frame = new(0, 40, 960, mode == "cross-half" ? 1120 : 560),
                        };
                    if (mode != "no-release")
                        tracker.MouseReleased(
                            new Point
                            {
                                X = mode == "layout-selection" ? work.x + 500 : destinationWork.x,
                                Y = destinationWork.y,
                            },
                            destination,
                            destinationWork,
                            mode == "injected" ? LLMHF_INJECTED : 0
                        );
                    if (mode == "cancel")
                        tracker.Key(11, start, 0x1b, false, false, 200, 0);
                    var result = tracker.FinishMove(
                        11,
                        after,
                        5000,
                        mode == "other-window" ? 12 : 11,
                        "2026-10-28"
                    );
                    if (mode == "cross-quarter")
                        Equal(true, result is CompoundMoveResult);
                    else
                        Equal<object?>(null, result);
                }
            );
        return output;
    }
}
