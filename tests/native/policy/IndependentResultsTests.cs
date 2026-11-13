using System.Text.Json;

// Synthetic wire fixtures only: no detector or global-input connection.
internal static class IndependentResultsTests
{
    internal static List<string> Run(List<string> passed)
    {
        var samples = new List<string>();
        var monitor = new MonitorBounds(0, 0, 1920, 1080);
        var other = new MonitorBounds(1920, 0, 1920, 1080);
        void Add(string origin, params IndependentProof[] proofs)
        {
            var envelope = new CandidateEnvelope(
                "candidate",
                2,
                1,
                samples.Count + 1,
                samples.Count + 1,
                "2026-11-13",
                origin,
                "independent-results",
                false,
                false,
                new IndependentResultsEvidence(true, true, true, proofs)
            );
            string line = JsonSerializer.Serialize(envelope);
            using var doc = JsonDocument.Parse(line);
            var evidence = doc.RootElement.GetProperty("evidence");
            if (
                evidence.GetProperty("kind").GetString() != "independent-results"
                || evidence.GetProperty("profile").GetString() != "independent-results-v1"
                || evidence.GetProperty("results").GetArrayLength() != proofs.Length
            )
                throw new Exception("Independent results serialization mismatch");
            samples.Add(line);
        }
        var move = new IndependentMonitorMoveProof(
            IndependentMonitorMoveRoute.CaptionDrag,
            true,
            true,
            200,
            monitor,
            other,
            IndependentMoveDirection.Right,
            true
        );
        var placement = new IndependentPlacementProof(
            IndependentPlacementRoute.CaptionEdgeDrag,
            IndependentPlacementShape.LeftHalf,
            true,
            true,
            200,
            other
        );
        var switched = new IndependentSwitchProof(
            IndependentSwitchRoute.DirectClick,
            true,
            true,
            true,
            200,
            100,
            null
        );
        Add("mouse", move);
        Add("mouse", move, placement);
        Add("mouse", switched, move, placement);
        Add("mouse", switched);
        Add(
            "key",
            new IndependentSwitchProof(
                IndependentSwitchRoute.AltTab,
                true,
                true,
                true,
                15000,
                2000,
                monitor
            )
        );
        foreach (var route in Enum.GetValues<IndependentMonitorMoveRoute>())
        {
            var direction =
                route == IndependentMonitorMoveRoute.WinShiftLeft
                    ? IndependentMoveDirection.Left
                    : IndependentMoveDirection.Right;
            Add(
                route == IndependentMonitorMoveRoute.CaptionDrag ? "mouse" : "key",
                new IndependentMonitorMoveProof(
                    route,
                    true,
                    true,
                    1000,
                    direction == IndependentMoveDirection.Left ? other : monitor,
                    direction == IndependentMoveDirection.Left ? monitor : other,
                    direction,
                    false
                )
            );
        }
        Add("mouse", move with { moveDirection = null, twoDisplayLayoutConfirmed = false });
        foreach (var route in Enum.GetValues<IndependentStateRoute>())
        {
            bool key = route is IndependentStateRoute.WinUp or IndependentStateRoute.WinDown;
            bool minimize =
                route is IndependentStateRoute.MinButton or IndependentStateRoute.WinDown;
            Add(
                key ? "key" : "mouse",
                new IndependentStateProof(
                    route,
                    minimize ? IndependentStateAction.Minimize : IndependentStateAction.Maximize,
                    IndependentBeforeState.Normal,
                    minimize ? IndependentAfterState.Minimized : IndependentAfterState.Maximized,
                    false,
                    null,
                    route == IndependentStateRoute.MouseStateFallback ? 500 : 1000,
                    null
                )
            );
        }
        foreach (
            var route in new[]
            {
                IndependentStateRoute.MaxButton,
                IndependentStateRoute.CaptionDoubleClick,
                IndependentStateRoute.MouseStateFallback,
                IndependentStateRoute.WinDown,
            }
        )
            Add(
                route == IndependentStateRoute.WinDown ? "key" : "mouse",
                new IndependentStateProof(
                    route,
                    IndependentStateAction.Restore,
                    IndependentBeforeState.Maximized,
                    IndependentAfterState.Normal,
                    route == IndependentStateRoute.WinDown ? null : false,
                    false,
                    0,
                    monitor
                )
            );
        foreach (var route in Enum.GetValues<IndependentPlacementRoute>())
        foreach (var shape in Enum.GetValues<IndependentPlacementShape>())
            Add(
                route == IndependentPlacementRoute.CaptionEdgeDrag ? "mouse" : "key",
                new IndependentPlacementProof(
                    route,
                    shape,
                    true,
                    true,
                    route == IndependentPlacementRoute.CaptionEdgeDrag ? 1000 : 15000,
                    monitor
                )
            );
        foreach (var route in Enum.GetValues<IndependentCloseRoute>())
            Add(
                route == IndependentCloseRoute.CloseButton ? "mouse" : "key",
                new IndependentCloseProof(route, true, 1000, null)
            );
        foreach (var route in Enum.GetValues<IndependentTaskbarRoute>())
        foreach (int slot in new[] { 1, 10 })
            Add(
                route == IndependentTaskbarRoute.TaskbarClick ? "mouse" : "key",
                new IndependentTaskbarProof(route, slot, true, 750, 2500, null)
            );
        passed.Add("independent result proof enums and 1/2/3-result JSON serialization");
        return samples;
    }
}
