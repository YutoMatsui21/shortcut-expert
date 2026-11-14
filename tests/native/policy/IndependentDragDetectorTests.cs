using static NativeMethods;

internal static partial class Program
{
    private static void CheckIndependentDragDetectors()
    {
        var before = normal with
        {
            Monitor = new(-1920, 0, 1920, 1080),
            Work = new(-1920, 0, 1920, 1040),
            Dpi = 96,
            DisplayLayout = "pair",
            HorizontalPair = true,
            TwoDisplayPair = true,
        };
        var destination = before with
        {
            Monitor = new(0, 0, 1920, 1080),
            Work = new(0, 0, 1920, 1040),
        };
        var max = destination with { Show = SW_SHOWMAXIMIZED };
        var quarter = destination with { Arranged = true, Frame = new(0, 0, 960, 520) };
        foreach (
            var (name, end, point, count) in new (string, WindowState, Point, int)[]
            {
                ("normal-max", max, new() { X = 900 }, 2),
                ("normal-quarter", quarter, default, 2),
                ("invalid-max-release", max, new() { X = 900, Y = 80 }, 1),
                ("invalid-quarter-release", quarter, new() { X = 80 }, 1),
                (
                    "unsupported-cross-half",
                    quarter with
                    {
                        Frame = new(0, 0, 960, 1040),
                    },
                    default,
                    1
                ),
            }
        )
            Check(
                "independent drag " + name,
                () =>
                {
                    var facts = new DragDetectionFacts(
                        before,
                        end,
                        point,
                        end.Monitor!,
                        end.Work!,
                        100,
                        true,
                        true
                    );
                    IndependentProof?[] parts =
                    [
                        MonitorMoveDetector.Drag(facts),
                        MaximizeDetector.Drag(facts),
                        QuarterPlacementDetector.Drag(facts),
                    ];
                    Equal(count, parts.Count(p => p is not null));
                    Equal(true, parts[0] is IndependentMonitorMoveProof);
                    Equal(parts[0], MonitorMoveDetector.Drag(facts));
                    Equal(parts[1], MaximizeDetector.Drag(facts));
                    Equal(parts[2], QuarterPlacementDetector.Drag(facts));
                    foreach (
                        var invalid in new[]
                        {
                            facts with
                            {
                                InputValid = false,
                            },
                            facts with
                            {
                                Released = false,
                            },
                            facts with
                            {
                                After = end with { Process = 8 },
                            },
                            facts with
                            {
                                After = end with { DisplayLayout = "changed" },
                            },
                            facts with
                            {
                                ReleaseMonitor = before.Monitor!,
                            },
                            facts with
                            {
                                After = end with { Monitor = null },
                            },
                        }
                    )
                    {
                        Equal<IndependentProof?>(null, MonitorMoveDetector.Drag(invalid));
                        Equal<IndependentProof?>(null, MaximizeDetector.Drag(invalid));
                        Equal<IndependentProof?>(null, QuarterPlacementDetector.Drag(invalid));
                    }
                }
            );
    }
}
