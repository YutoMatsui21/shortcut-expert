using static NativeMethods;

internal static partial class Program
{
    private static void CheckClickComparison()
    {
        foreach (bool restore in new[] { false, true })
        foreach (int hit in new[] { HTCAPTION, 1 })
            Check(
                $"three-way click {restore}/{hit}",
                () =>
                {
                    var before = restore ? maximized : normal;
                    var after = restore ? normal : maximized;
                    var p = new MouseShadowClicks.Press(before, hit, default, 0, 20);
                    var r = MouseShadowClicks.Compare(
                        new[] { p, p with { At = 150, Up = 170 } },
                        after,
                        200,
                        500,
                        4,
                        4
                    );
                    Equal(hit == HTCAPTION ? 1 : 0, r.Standard.Length);
                    Equal(hit == 1 ? 1 : 0, r.Fallback.Length);
                    Equal(1, r.Double.Length);
                }
            );
        foreach (int hit in new[] { HTMINBUTTON, 1 })
            Check(
                $"three-way single minimize {hit}",
                () =>
                {
                    var p = new MouseShadowClicks.Press(normal, hit, default, 0, 20);
                    var r = MouseShadowClicks.Compare(
                        new[] { p },
                        normal with
                        {
                            Show = SW_SHOWMINIMIZED,
                        },
                        100,
                        500,
                        4,
                        4
                    );
                    Equal(hit == HTMINBUTTON ? 1 : 0, r.Standard.Length);
                    Equal(hit == 1 ? 1 : 0, r.Fallback.Length);
                    Equal(0, r.Double.Length);
                }
            );
        Check(
            "three-way movement rejects client fallback and double",
            () =>
            {
                var p = new MouseShadowClicks.Press(
                    normal,
                    1,
                    default,
                    0,
                    20,
                    FurthestPoint: new Point { X = 5 }
                );
                var r = MouseShadowClicks.Compare(
                    new[] { p, p with { At = 150, Up = 170 } },
                    maximized,
                    200,
                    500,
                    4,
                    4
                );
                Equal(0, r.Fallback.Length + r.Double.Length);
            }
        );
        Check(
            "three-way body double click no change",
            () =>
            {
                var p = new MouseShadowClicks.Press(normal, 1, default, 0, 20);
                var r = MouseShadowClicks.Compare(
                    new[] { p, p with { At = 150, Up = 170 } },
                    normal,
                    200,
                    500,
                    4,
                    4
                );
                Equal(0, r.Standard.Length + r.Fallback.Length + r.Double.Length);
            }
        );
        Check(
            "three-way programmatic body counterexample remains visible",
            () =>
            {
                var p = new MouseShadowClicks.Press(normal, 1, default, 0, 20);
                var r = MouseShadowClicks.Compare(
                    new[] { p, p with { At = 150, Up = 170 } },
                    maximized,
                    200,
                    500,
                    4,
                    4
                );
                Equal(0, r.Standard.Length);
                Equal(1, r.Fallback.Length);
                Equal(1, r.Double.Length);
            }
        );
        Check(
            "three-way foreground loss rejects maximize",
            () =>
            {
                var p = new MouseShadowClicks.Press(normal, 1, default, 0, 20);
                var r = MouseShadowClicks.Compare(
                    new[] { p, p with { At = 150, Up = 170 } },
                    maximized,
                    200,
                    500,
                    4,
                    4,
                    false
                );
                Equal(0, r.Standard.Length + r.Fallback.Length + r.Double.Length);
            }
        );
        Check(
            "three-way inactive press rejects client fallback",
            () =>
            {
                var p = new MouseShadowClicks.Press(
                    normal,
                    1,
                    default,
                    0,
                    20,
                    ForegroundAtPress: false
                );
                var r = MouseShadowClicks.Compare(new[] { p }, maximized, 200, 500, 4, 4);
                Equal(0, r.Standard.Length + r.Fallback.Length + r.Double.Length);
            }
        );
        Check(
            "three-way held click cannot use early state time",
            () =>
            {
                var p = new MouseShadowClicks.Press(normal, 1, default, 0, 800);
                var r = MouseShadowClicks.Compare(new[] { p }, maximized, 800, 500, 4, 4);
                Equal(0, r.Fallback.Length + r.Double.Length);
            }
        );
        Check(
            "three-way invalidation after release rejects",
            () =>
            {
                var p = new MouseShadowClicks.Press(normal, 1, default, 0, 20, Conflict: true);
                var r = MouseShadowClicks.Compare(
                    new[] { p, p with { At = 150, Up = 170 } },
                    maximized,
                    200,
                    500,
                    4,
                    4
                );
                Equal(0, r.Standard.Length + r.Fallback.Length + r.Double.Length);
            }
        );
        Check(
            "three-way target changed rejects",
            () =>
            {
                var p = new MouseShadowClicks.Press(normal, 1, default, 0, 20, SameTarget: false);
                var r = MouseShadowClicks.Compare(
                    new[] { p, p with { At = 150, Up = 170 } },
                    maximized,
                    200,
                    500,
                    4,
                    4
                );
                Equal(0, r.Standard.Length + r.Fallback.Length + r.Double.Length);
            }
        );
    }
}
