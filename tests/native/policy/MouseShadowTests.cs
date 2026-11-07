using static NativeMethods;

internal static partial class Program
{
    private static void CheckMouseShadow()
    {
        var m = new MonitorBounds(0, 0, 1920, 1080);
        var w = new MonitorBounds(0, 0, 1920, 1040);
        var start = normal with
        {
            Monitor = m,
            Work = w,
            Dpi = 96,
            DisplayLayout = "stable",
            Frame = new(200, 200, 600, 400),
        };
        WindowState Shape(string shape) =>
            start with
            {
                Arranged = true,
                Frame = shape switch
                {
                    "left-half" => new(0, 0, 960, 1040),
                    "right-half" => new(960, 0, 960, 1040),
                    "left-top" => new(0, 0, 960, 520),
                    _ => new(960, 0, 960, 520),
                },
            };
        var max = start with { Show = SW_SHOWMAXIMIZED };
        var otherMax = max with
        {
            Monitor = new(1920, 0, 1920, 1080),
            Work = new(1920, 0, 1920, 1040),
        };
        var cases = new[]
        {
            (
                "max-max",
                new MouseDetectionShadow.Drag(max, otherMax, new Point { X = 2800, Y = 0 }),
                "",
                "W02"
            ),
            (
                "normal-max",
                new MouseDetectionShadow.Drag(start, otherMax, new Point { X = 2800, Y = 0 }),
                "W02,W03",
                "W02,W03"
            ),
            (
                "half-max",
                new MouseDetectionShadow.Drag(
                    Shape("right-half"),
                    max,
                    new Point { X = 800, Y = 0 }
                ),
                "W03",
                "W03"
            ),
            (
                "quarter-max",
                new MouseDetectionShadow.Drag(Shape("left-top"), max, new Point { X = 800, Y = 0 }),
                "W03",
                "W03"
            ),
            (
                "half-half",
                new MouseDetectionShadow.Drag(
                    Shape("right-half"),
                    Shape("left-half"),
                    new Point { X = 0, Y = 500 }
                ),
                "",
                "W06"
            ),
            (
                "quarter-quarter",
                new MouseDetectionShadow.Drag(
                    Shape("left-top"),
                    Shape("right-top"),
                    new Point { X = 1919, Y = 0 }
                ),
                "",
                "W07"
            ),
            (
                "same-half",
                new MouseDetectionShadow.Drag(
                    Shape("left-half"),
                    Shape("left-half"),
                    new Point { X = 0, Y = 500 }
                ),
                "",
                ""
            ),
        };
        cases = cases
            .Select(c =>
                (
                    c.Item1,
                    c.Item2 with
                    {
                        ReleaseMonitor = c.Item2.After.Monitor,
                        ReleaseWork = c.Item2.After.Work,
                    },
                    c.Item3,
                    c.Item4
                )
            )
            .ToArray();
        foreach (var (name, d, current, shadow) in cases)
            Check(
                "shadow comparison " + name,
                () =>
                {
                    Equal(
                        current,
                        string.Join(
                            ',',
                            MouseDetectionShadow.CurrentOperations(MouseDetectionShadow.Current(d))
                        )
                    );
                    Equal(shadow, string.Join(',', MouseDetectionShadow.Evaluate(d).Operations));
                }
            );
        var positive = cases[4].Item2;
        foreach (
            var (name, d) in new[]
            {
                ("release-monitor", positive with { ReleaseMonitor = m with { x = 1920 } }),
                ("release-work", positive with { ReleaseWork = w with { height = 1000 } }),
                ("resize", positive with { Resize = true }),
                ("cancel", positive with { Cancelled = true }),
                ("conflict", positive with { Conflict = true }),
                ("injected", positive with { Injected = true }),
                ("target", positive with { Target = false }),
                ("layout", positive with { Stable = false }),
                ("release", positive with { Released = false }),
                ("intermediate", positive with { Terminal = false }),
                ("expired", positive with { StartAge = 1001 }),
                ("destroy", positive with { After = positive.After with { Show = 0 } }),
                ("process", positive with { After = positive.After with { Process = 99 } }),
                ("unknown", positive with { Before = positive.Before with { Frame = null } }),
                (
                    "ordinary-resize",
                    positive with
                    {
                        After = positive.After with { Arranged = false },
                    }
                ),
            }
        )
            Check(
                "shadow rejects " + name,
                () => Equal(0, MouseDetectionShadow.Evaluate(d).Operations.Length)
            );
        var click = new MouseDetectionShadow.Click(
            true,
            true,
            true,
            true,
            false,
            false,
            false,
            true,
            false,
            true
        );
        foreach (
            var (name, c, expected) in new[]
            {
                ("custom-caption", click, 1),
                ("body-with-programmatic-change", click, 1),
                ("body-no-change", click with { StateChanged = false }, 0),
                ("single-click", click with { PhysicalReleases = false }, 0),
                ("far", click with { Nearby = false }, 0),
                ("late", click with { WithinDoubleClickTime = false }, 0),
                ("conflict", click with { Conflict = true }, 0),
                ("drag", click with { Dragged = true }, 0),
                ("injected", click with { Injected = true }, 0),
                ("target", click with { SameTarget = false }, 0),
                ("first-change", click with { FirstClickChangedState = true }, 0),
                ("late-result", click with { ResultWithinDeadline = false }, 0),
            }
        )
            Check(
                "shadow click " + name,
                () => Equal(expected, MouseDetectionShadow.DoubleClick(c).Operations.Length)
            );
        Check(
            "live W03 never reconstructs a failed current maximize",
            () =>
            {
                var d = cases[2].Item2 with { CurrentMaximizeConfirmed = false };
                Equal(0, MouseDetectionShadow.Evaluate(d).Operations.Length);
            }
        );
    }
}
