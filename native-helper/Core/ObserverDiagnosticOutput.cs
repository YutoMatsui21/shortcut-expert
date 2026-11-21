namespace ShortcutExpert.Detection;

internal static class ObserverDiagnosticOutput
{
    internal static void Emit(
        Action<object> write,
        Dictionary<string, int>? closeCounts,
        WindowDiagnosticAccumulator? windowCounts
    )
    {
        if (closeCounts is not null)
            write(new { type = "close-diagnostics", counts = closeCounts });
        var diagnostic = windowCounts?.Take();
        if (diagnostic is not null)
            write(
                new
                {
                    type = "window-diagnostics",
                    generation = diagnostic.Generation,
                    counts = diagnostic.Counts,
                }
            );
    }
}
