using System.Text.Json;
using ShortcutExpert.Detection;

internal static partial class Program
{
    private static void CheckObserverDiagnostics()
    {
        Check(
            "all close reasons map into bounded generation-scoped window diagnostics",
            () =>
            {
                var counters = new WindowDiagnosticAccumulator();
                counters.Start(7);
                foreach (var reason in Enum.GetValues<CloseReason>())
                    counters.RecordClose(reason);
                var result = counters.Take()!;
                foreach (var reason in Enum.GetValues<CloseReason>())
                    Equal(1, result.Counts["W11" + reason]);
                counters.RecordClose(CloseReason.Completed);
                Equal(true, counters.Take() is null);
                counters.Start(8);
                for (int i = 0; i < 1005; i++)
                    counters.RecordClose(CloseReason.Completed);
                Equal(1000, counters.Take()!.Counts["W11Completed"]);
            }
        );
        Check(
            "diagnostic stop summary is consumed once and cannot leak into a stopped trial",
            () =>
            {
                var counters = new WindowDiagnosticAccumulator();
                counters.Record(WindowDiagnosticReason.RawClient);
                Equal(true, counters.Take() is null);
                counters.Start(7);
                counters.Record(WindowDiagnosticReason.RawClient);
                counters.Record(WindowDiagnosticReason.RawClient);
                var first = counters.Take()!;
                Equal(7, first.Generation);
                Equal(2, first.Counts["RawClient"]);
                counters.Record(WindowDiagnosticReason.RawClient);
                Equal(true, counters.Take() is null);
                counters.Start(8);
                var second = counters.Take()!;
                Equal(8, second.Generation);
                Equal(0, second.Counts["RawClient"]);
                Equal(2, first.Counts["RawClient"]);
                counters.Start(9);
                for (int i = 0; i < 1005; i++)
                    counters.Record(WindowDiagnosticReason.MouseDown);
                Equal(1000, counters.Take()!.Counts["MouseDown"]);
                Equal(true, counters.Take() is null);
            }
        );
        Check(
            "stop emits compatible diagnostic JSON and consumes the window summary",
            DiagnosticOutput
        );
    }

    private static void DiagnosticOutput()
    {
        var output = new List<JsonElement>();
        void Write(object message) => output.Add(JsonSerializer.SerializeToElement(message));
        var windows = new WindowDiagnosticAccumulator();
        windows.Start(7);
        windows.Record(WindowDiagnosticReason.RawClient);

        ObserverDiagnosticOutput.Emit(Write, new() { ["Completed"] = 2 }, windows);
        ObserverDiagnosticOutput.Emit(Write, null, windows);

        Equal(2, output.Count);
        Equal("close-diagnostics", output[0].GetProperty("type").GetString());
        Equal(2, output[0].GetProperty("counts").GetProperty("Completed").GetInt32());
        Equal("window-diagnostics", output[1].GetProperty("type").GetString());
        Equal(7, output[1].GetProperty("generation").GetInt32());
        Equal(1, output[1].GetProperty("counts").GetProperty("RawClient").GetInt32());
    }
}
