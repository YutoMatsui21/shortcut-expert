using static NativeMethods;

// EXPERIMENT ONLY. Never linked by the production helper. All identities are synthetic.
internal static class IndependentDetection
{
    private const string Date = "2026-11-07";
    private static readonly WindowState Start = new(
        7,
        "ordinary-window",
        SW_SHOWNORMAL,
        false,
        new(-1920, 0, 1920, 1080),
        true,
        "pair",
        null,
        new(-1920, 0, 1920, 1040),
        96,
        true
    );

    // Identity is input + target + generation, not temporal proximity.
    internal sealed record Identity(int Generation, int Input, nint Target);

    internal sealed record Drag(
        Identity Id,
        WindowState Before,
        WindowState After,
        Point Release,
        MonitorBounds ReleaseMonitor,
        MonitorBounds ReleaseWork,
        int Hit = HTCAPTION,
        long StartAge = 100,
        bool Released = true,
        bool Physical = true,
        bool Cancelled = false,
        nint Foreground = 11
    );

    internal sealed record Click(
        Identity Id,
        int Hit = HTMAXBUTTON,
        bool Switched = true,
        uint Final = SW_SHOWMAXIMIZED,
        bool StateSeen = true,
        bool Eligible = true,
        bool Physical = true,
        bool Modifiers = false,
        int Motion = 0,
        long ReleaseAt = 100,
        nint ReleaseTarget = 11,
        uint ReleaseProcess = 7,
        uint FinalProcess = 7,
        uint ForegroundTick = 110,
        bool ForeignAfter = false,
        bool DragStarted = false,
        long PollAt = 510,
        bool Released = true,
        bool Cancelled = false,
        uint Initial = SW_SHOWNORMAL,
        bool ForeignBeforeState = false
    );

    internal sealed record Part(Identity Id, string Operation);

    // A small lifecycle gate, not an event framework. Final snapshots are immutable;
    // pending completions cannot publish before closure or after cancellation/reset.
    private sealed class GestureLifetime
    {
        private int generation = 1;
        private readonly Dictionary<Identity, string> states = new();

        internal void Begin(Identity id)
        {
            if (id.Generation == generation)
                states.TryAdd(id, "open");
        }

        internal void Close(Identity id)
        {
            if (states.GetValueOrDefault(id) == "open")
                states[id] = "closed";
        }

        internal void Cancel(Identity id) => states[id] = "cancelled";

        internal bool Take(Identity id)
        {
            if (id.Generation != generation || states.GetValueOrDefault(id) != "closed")
                return false;
            states[id] = "published";
            return true;
        }

        internal void Reset(int next)
        {
            generation = next;
            states.Clear();
        }
    }

    private static void Require(bool value, string name)
    {
        if (!value)
            throw new Exception("independence: " + name);
    }

    // Common gesture admission: only input lifetime/target facts, no detector results.
    private static bool Live(Drag g) =>
        g.Physical
        && !g.Cancelled
        && g.Released
        && g.StartAge is >= 0 and <= 1000
        && g.Foreground == g.Id.Target
        && g.Before.Process == g.After.Process
        && g.Before.DisplayLayout == g.After.DisplayLayout
        && g.After.Monitor == g.ReleaseMonitor
        && g.After.Work == g.ReleaseWork;

    private static bool Stable(Drag g) =>
        g.Before.DisplayLayout is not null
        && g.Before.Monitor is not null
        && g.After.Monitor is not null
        && g.Before.Work is not null
        && g.After.Work is not null
        && g.Before.Dpi > 0
        && g.After.Dpi > 0
        && g.Before.Show is SW_SHOWNORMAL or SW_SHOWMAXIMIZED
        && g.After.Show is SW_SHOWNORMAL or SW_SHOWMAXIMIZED;

    // Each predicate has only an immutable gesture argument. No peer state/results.
    private static Part? Move(Drag g) =>
        Live(g) && Stable(g) && g.Before.Monitor != g.After.Monitor ? new(g.Id, "W02") : null;

    private static Part? Maximize(Drag g)
    {
        int? tolerance = PlacementGeometry.ReleaseTolerance(g.Before, g.After, 2);
        var w = g.ReleaseWork;
        return
            Live(g)
            && g.Before.Show == SW_SHOWNORMAL
            && g.Before.Arranged is not null
            && g.After.Show == SW_SHOWMAXIMIZED
            && g.After.Arranged == false
            && tolerance is not null
            && g.Release.X >= w.x
            && (long)g.Release.X < (long)w.x + w.width
            && g.Release.Y >= w.y
            && (long)g.Release.Y <= (long)w.y + tolerance
            ? new(g.Id, "W03")
            : null;
    }

    private static Part? Quarter(Drag g)
    {
        var p =
            Live(g) && g.Hit == HTCAPTION
                ? PlacementGeometry.Drag(
                    g.Before,
                    g.After,
                    g.Release,
                    g.ReleaseMonitor,
                    g.ReleaseWork,
                    g.StartAge,
                    true
                )
                : null;
        return p is not null && !p.shape.EndsWith("-half") ? new(g.Id, "W07") : null;
    }

    private static readonly Func<Drag, Part?>[] DragDetectors = [Move, Maximize, Quarter];

    // Minimal composer alone is insufficient: W02 survives invalid compound terminals.
    private static string[] Bundle(Identity id, IEnumerable<Part?> parts) =>
        parts
            .Where(p => p is not null && p.Id == id)
            .Select(p => p!.Operation)
            .Distinct()
            .Order()
            .ToArray();

    // Explicit semantic admission, separate from bundling. This is residual arbitration.
    private static bool Admit(Drag g, string[] operations)
    {
        bool moved = operations.Contains("W02");
        if (g.After.Arranged == true)
            return operations.Contains("W07") && (!moved || Stable(g));
        if (g.After.Show == SW_SHOWMAXIMIZED)
            return g.Before.Show == SW_SHOWMAXIMIZED ? moved : operations.Contains("W03");
        return moved && g.After.Show == SW_SHOWNORMAL && g.After.Arranged == false;
    }

    private static CandidateEnvelope? Compose(Drag g, Part?[] parts, bool admission)
    {
        string[] ids = Bundle(g.Id, parts);
        if (ids.Length == 0 || admission && !Admit(g, ids))
            return null;
        var output = new List<object>();
        var wire = new CandidateSink(output.Add);
        wire.Start(1, 2);
        string? direction =
            g.Before.Monitor == g.After.Monitor ? null
            : g.After.Monitor!.x > g.Before.Monitor!.x ? "right"
            : "left";
        if (ids.Contains("W02") && ids.Length == 2)
            wire.Compound(
                g.Id.Generation,
                Date,
                new(
                    g.Id.Input,
                    g.Before.Monitor!,
                    g.After.Monitor!,
                    ids.Contains("W03") ? "maximized" : PlacementGeometry.Shape(g.After)!,
                    g.StartAge,
                    direction,
                    true
                )
            );
        else if (ids.Contains("W07"))
            wire.Placement(
                g.Id.Generation,
                Date,
                new(
                    g.Id.Input,
                    "mouse",
                    PlacementGeometry.Drag(
                        g.Before,
                        g.After,
                        g.Release,
                        g.ReleaseMonitor,
                        g.ReleaseWork,
                        g.StartAge,
                        true
                    )!
                )
            );
        else
        {
            bool move = ids.Contains("W02");
            string State(uint show) => show == SW_SHOWMAXIMIZED ? "maximized" : "normal";
            wire.Complete(
                new WindowCandidate(
                    "candidate",
                    1,
                    g.Id.Generation,
                    1,
                    "ordinary-window",
                    move ? "monitor-move" : "maximize",
                    Date,
                    new(State(g.Before.Show), g.Before.Arranged),
                    new(State(g.After.Show)),
                    g.After.Arranged,
                    "mouse",
                    move ? "caption-drag" : "caption-top-drag",
                    false,
                    false,
                    false,
                    false,
                    true,
                    g.StartAge,
                    g.After.Monitor,
                    g.Before.Monitor,
                    g.After.Monitor,
                    direction,
                    move,
                    move
                )
                {
                    Transaction = g.Id.Input,
                }
            );
        }
        return output.Cast<CandidateEnvelope>().SingleOrDefault();
    }

    private static CandidateEnvelope? Baseline(Drag g)
    {
        var tracker = new CandidateTracker();
        tracker.Reset(1);
        tracker.Mouse(
            11,
            g.Before,
            g.Hit,
            default,
            0,
            500,
            g.Physical ? 0u : LLMHF_INJECTED,
            false,
            true
        );
        tracker.MoveStart(11, g.StartAge);
        // Intermediate restoration must not consume the drag transaction.
        var interim = tracker.Complete(
            11,
            g.Before,
            g.Before with
            {
                Show = SW_SHOWNORMAL,
            },
            150,
            11,
            Date,
            g.Before.Monitor
        );
        Require(interim is null, "intermediate W04 suppressed");
        if (g.Released)
            tracker.MouseReleased(g.Release, g.ReleaseMonitor, g.ReleaseWork, 0);
        if (g.Cancelled)
            tracker.Reset(1);
        object? result = tracker.FinishMove(11, g.After, 5000, g.Foreground, Date);
        Require(tracker.FinishMove(11, g.After, 5001, 11, Date) is null, "no second END");
        var output = new List<object>();
        var wire = new CandidateSink(output.Add);
        wire.Start(1, 2);
        switch (result)
        {
            case CompoundMoveResult compound:
                wire.Compound(1, Date, compound);
                break;
            case PlacementResult placement:
                wire.Placement(1, Date, placement);
                break;
            case WindowCandidate window:
                wire.Complete(window);
                break;
        }
        return output.Cast<CandidateEnvelope>().SingleOrDefault();
    }

    // Shared click facts retain chronology. Foreign foreground is tolerated only after
    // a matching minimization state. This is semantic cancellation, not mere fan-out.
    private static bool Activated(Click g) =>
        g.Switched && unchecked((int)(g.ForegroundTick - 100)) is >= 0 and <= 500;

    private static bool Fallback(Click g) => g.Hit is 1 or 0 or -1;

    private static bool ClickLive(Click g) =>
        g.Eligible
        && g.Physical
        && !g.Modifiers
        && g.Initial is SW_SHOWNORMAL or SW_SHOWMAXIMIZED
        && !(g.Hit == HTMAXBUTTON && g.Initial != SW_SHOWNORMAL)
        && (Fallback(g) || g.Hit is HTMAXBUTTON or HTMINBUTTON)
        && !g.Cancelled
        && !g.DragStarted
        && g.Motion <= 4
        && g.Released
        && g.ReleaseAt is >= 0 and <= 500
        && g.ReleaseTarget == g.Id.Target
        && g.ReleaseProcess == Start.Process
        && g.FinalProcess == Start.Process
        && g.PollAt is >= 500 and <= 750
        && !g.ForeignBeforeState
        && (
            !g.ForeignAfter
            || g.StateSeen && g.Final == SW_SHOWMINIMIZED && (Fallback(g) || g.Hit == HTMINBUTTON)
        );

    private static Part? Switch(Click g) => ClickLive(g) && Activated(g) ? new(g.Id, "W01") : null;

    private static Part? CaptionMax(Click g) =>
        ClickLive(g)
        && g.StateSeen
        && g.Initial == SW_SHOWNORMAL
        && g.Final == SW_SHOWMAXIMIZED
        && (Fallback(g) || g.Hit == HTMAXBUTTON)
        && (!Fallback(g) || Activated(g))
            ? new(g.Id, "W03")
            : null;

    private static Part? CaptionMin(Click g) =>
        ClickLive(g)
        && g.StateSeen
        && g.Final == SW_SHOWMINIMIZED
        && (Fallback(g) || g.Hit == HTMINBUTTON)
        && (!Fallback(g) || Activated(g))
            ? new(g.Id, "W04")
            : null;

    private static readonly Func<Click, Part?>[] ClickDetectors = [Switch, CaptionMax, CaptionMin];

    private static CandidateEnvelope? Compose(Click g, Part?[] parts)
    {
        var ids = Bundle(g.Id, parts);
        if (ids.Length == 0)
            return null;
        var output = new List<object>();
        var wire = new CandidateSink(output.Add);
        wire.Start(1, 2);
        wire.CaptionClick(
            g.Id.Generation,
            g.Id.Input,
            Date,
            new(
                ids.Contains("W03") ? "maximized"
                    : ids.Contains("W04") ? "minimized"
                    : null,
                ids.Contains("W01"),
                true,
                true,
                500,
                Start.Monitor
            )
        );
        return output.Cast<CandidateEnvelope>().SingleOrDefault();
    }

    private static CandidateEnvelope? Baseline(Click g)
    {
        var policy = new InactiveCaptionPolicy();
        var before = Start with { Show = g.Initial };
        policy.Start(
            11,
            before,
            g.Hit,
            default,
            0,
            100,
            g.Id.Input,
            g.Eligible,
            g.Physical,
            g.Modifiers
        );
        if (g.Switched)
            policy.Foreground(11, 11, g.ForegroundTick);
        if (g.Motion > 0)
            policy.Mouse(0x200, new() { X = g.Motion }, 0, false, 11, 7, 90);
        if (g.Released)
            policy.Mouse(
                WM_LBUTTONUP,
                default,
                0,
                g.Modifiers,
                g.ReleaseTarget,
                g.ReleaseProcess,
                g.ReleaseAt
            );
        var after = before with { Show = g.Final, Process = g.FinalProcess };
        if (g.ForeignBeforeState)
            policy.Foreground(12, 12, 140);
        if (g.StateSeen)
            policy.State(after, 150);
        if (g.ForeignAfter)
            policy.Foreground(12, 12, 160);
        if (g.DragStarted || g.Cancelled)
            policy.Cancel();
        Require(policy.Poll(after, 499) is null, "caption not published early");
        var result = policy.Poll(after, g.PollAt);
        Require(policy.Poll(after, 751) is null, "caption at most once");
        if (result is null)
            return null;
        var output = new List<object>();
        var wire = new CandidateSink(output.Add);
        wire.Start(1, 2);
        wire.CaptionClick(g.Id.Generation, result.Value.Transaction, Date, result.Value.Evidence);
        return output.Cast<CandidateEnvelope>().SingleOrDefault();
    }

    internal static object Run(Action<string, Drag, CandidateEnvelope?>? validateDrag = null)
    {
        var rows = new List<object>();
        int mismatches = 0;
        var id = new Identity(1, 1, 11);
        var destination = Start with
        {
            Monitor = new(0, 0, 1920, 1080),
            Work = new(0, 0, 1920, 1040),
        };
        var max = destination with { Show = SW_SHOWMAXIMIZED };
        var quarter = destination with { Arranged = true, Frame = new(0, 0, 960, 520) };
        Drag G(WindowState before, WindowState after, Point point) =>
            new(id, before, after, point, after.Monitor!, after.Work!);
        var dragCases = new (string Name, Drag Gesture, string[] Expected)[]
        {
            (
                "maxA-maxB",
                G(Start with { Show = SW_SHOWMAXIMIZED }, max, new() { X = 900 }),
                ["W02"]
            ),
            ("normalA-maxB", G(Start, max, new() { X = 900 }), ["W02", "W03"]),
            (
                "normalA-maxA",
                G(Start, Start with { Show = SW_SHOWMAXIMIZED }, new() { X = -900 }),
                ["W03"]
            ),
            ("normalA-quarterB", G(Start, quarter, default), ["W02", "W07"]),
            ("return-normal", G(Start, Start, new() { X = -900, Y = 300 }), []),
            ("same-quarter", G(quarter, quarter, default), []),
            ("invalid-max-release", G(Start, max, new() { X = 900, Y = 80 }), []),
            ("invalid-quarter-release", G(Start, quarter, new() { X = 80 }), []),
            (
                "unsupported-cross-half",
                G(Start, quarter with { Frame = new(0, 0, 960, 1040) }, default),
                []
            ),
            ("no-release", G(Start, max, default) with { Released = false }, []),
            ("cancel", G(Start, max, default) with { Cancelled = true }, []),
            ("injected", G(Start, max, default) with { Physical = false }, []),
            ("late-start", G(Start, max, default) with { StartAge = 1001 }, []),
            ("foreign-foreground", G(Start, max, default) with { Foreground = 12 }, []),
            ("process-changed", G(Start, max with { Process = 8 }, default), []),
            ("layout-changed", G(Start, max with { DisplayLayout = "other" }, default), []),
            (
                "release-monitor",
                G(Start, max, default) with
                {
                    ReleaseMonitor = Start.Monitor!,
                },
                []
            ),
            ("release-work", G(Start, max, default) with { ReleaseWork = Start.Work! }, []),
        };
        foreach (var (name, g, expected) in dragCases)
        {
            var parts = DragDetectors.Select(d => d(g)).ToArray();
            for (int i = 0; i < parts.Length; i++)
                Require(parts[i] == DragDetectors[i](g), "solo drag");
            Require(Bundle(id, parts).SequenceEqual(Bundle(id, parts.Reverse())), "order drag");
            var naive = Compose(g, parts, false);
            var composed = Compose(g, parts, true);
            var baseline = Baseline(g);
            validateDrag?.Invoke(name, g, baseline);
            // Compare complete protocol envelopes, not just the final operation names.
            Require(
                Equals(baseline, composed),
                name
                    + " full envelope parity: "
                    + System.Text.Json.JsonSerializer.Serialize(new { baseline, composed })
            );
            if (!Equals(naive, baseline))
                mismatches++;
            rows.Add(
                new
                {
                    name,
                    expected,
                    baseline,
                    composed,
                    naive,
                    independent = Bundle(id, parts),
                    confirmedAt = 5000,
                }
            );
        }
        var clickCases = new (string Name, Click Gesture, string[] Expected)[]
        {
            ("switch-max", new(id), ["W01", "W03"]),
            (
                "switch-min-transient-foreground",
                new(id, Hit: HTMINBUTTON, Final: SW_SHOWMINIMIZED, ForeignAfter: true),
                ["W01", "W04"]
            ),
            ("switch-only", new(id, Final: SW_SHOWNORMAL, StateSeen: false), ["W01"]),
            ("max-only", new(id, Switched: false), ["W03"]),
            (
                "min-only",
                new(
                    id,
                    Hit: HTMINBUTTON,
                    Switched: false,
                    Final: SW_SHOWMINIMIZED,
                    ForeignAfter: true
                ),
                ["W04"]
            ),
            ("fallback-max", new(id, Hit: 1), ["W01", "W03"]),
            ("fallback-no-activation", new(id, Hit: -1, Switched: false), []),
            ("fallback-body", new(id, Hit: 0, Final: SW_SHOWNORMAL), ["W01"]),
            ("drag-handoff", new(id, Hit: 1, DragStarted: true), []),
            ("motion-4", new(id, Motion: 4), ["W01", "W03"]),
            ("motion-5", new(id, Motion: 5), []),
            ("release-500", new(id, ReleaseAt: 500), ["W01", "W03"]),
            ("release-501", new(id, ReleaseAt: 501), []),
            ("wrong-target", new(id, ReleaseTarget: 12), []),
            ("wrong-process", new(id, ReleaseProcess: 8), []),
            ("result-process", new(id, FinalProcess: 8), []),
            ("old-foreground", new(id, ForegroundTick: 99), ["W03"]),
            ("foreign-max", new(id, ForeignAfter: true), []),
            ("injected-click", new(id, Physical: false), []),
            ("modifier", new(id, Modifiers: true), []),
            ("ineligible", new(id, Eligible: false), []),
            ("unreleased", new(id, Released: false), []),
            ("expired", new(id, PollAt: 751), []),
            ("cancelled", new(id, Cancelled: true), []),
            (
                "max-start-min",
                new(
                    id,
                    Hit: HTMINBUTTON,
                    Initial: SW_SHOWMAXIMIZED,
                    Final: SW_SHOWMINIMIZED,
                    ForeignAfter: true
                ),
                ["W01", "W04"]
            ),
            ("max-start-max-button", new(id, Initial: SW_SHOWMAXIMIZED), []),
            (
                "fallback-max-start-restore",
                new(id, Hit: 1, Initial: SW_SHOWMAXIMIZED, Final: SW_SHOWNORMAL),
                ["W01"]
            ),
            (
                "fallback-min",
                new(id, Hit: -1, Final: SW_SHOWMINIMIZED, ForeignAfter: true),
                ["W01", "W04"]
            ),
            (
                "foreign-before-min",
                new(id, Hit: HTMINBUTTON, Final: SW_SHOWMINIMIZED, ForeignBeforeState: true),
                []
            ),
            ("poll-500", new(id, PollAt: 500), ["W01", "W03"]),
            ("poll-750", new(id, PollAt: 750), ["W01", "W03"]),
        };
        foreach (var (name, g, expected) in clickCases)
        {
            var parts = ClickDetectors.Select(d => d(g)).ToArray();
            for (int i = 0; i < parts.Length; i++)
                Require(parts[i] == ClickDetectors[i](g), "solo click");
            Require(Bundle(id, parts).SequenceEqual(Bundle(id, parts.Reverse())), "order click");
            var baseline = Baseline(g);
            var composed = Compose(g, parts);
            Require(Equals(baseline, composed), name + " full envelope parity");
            rows.Add(
                new
                {
                    name,
                    expected,
                    baseline,
                    composed,
                    independent = Bundle(id, parts),
                    confirmedAt = g.PollAt,
                }
            );
        }
        Require(
            mismatches == 3,
            "minimal composer must expose three partial-adoption counterexamples"
        );
        Require(
            Bundle(
                    id,
                    [
                        new(id, "W02"),
                        new(id, "W02"),
                        new(id with { Input = 2 }, "W03"),
                        new(id with { Target = 12 }, "W03"),
                        new(id with { Generation = 2 }, "W03"),
                    ]
                )
                .SequenceEqual(["W02"]),
            "identity and dedup"
        );
        var emissions = new List<object>();
        var sink = new CandidateSink(emissions.Add);
        sink.Start(1, 2);
        sink.Stop();
        sink.CaptionClick(1, 1, Date, new(null, true, true, true, 500, Start.Monitor));
        sink.Start(2, 2);
        sink.CaptionClick(1, 1, Date, new(null, true, true, true, 500, Start.Monitor));
        Require(emissions.Count == 0, "old completion after stop/reset");
        var lifetime = new GestureLifetime();
        lifetime.Begin(id);
        Require(!lifetime.Take(id), "pending results cannot publish before closure");
        lifetime.Close(id);
        Require(lifetime.Take(id) && !lifetime.Take(id), "one publication per gesture");
        var other = id with { Input = 2 };
        lifetime.Begin(other);
        lifetime.Cancel(other);
        lifetime.Close(other);
        Require(!lifetime.Take(other), "cancelled late result");
        lifetime.Reset(2);
        lifetime.Begin(id);
        lifetime.Close(id);
        Require(!lifetime.Take(id), "reset old gesture");
        return new
        {
            rows,
            minimalComposerMismatches = mismatches,
            globalInputCollected = false,
        };
    }
}
