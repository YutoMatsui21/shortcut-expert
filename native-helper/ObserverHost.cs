using System.Text.Json;
using System.Windows.Forms;

internal static class ObserverHost
{
    private static readonly object outputLock = new();
    private static void Emit(object value) { lock (outputLock) Console.WriteLine(JsonSerializer.Serialize(value)); }
    internal static int SelfTest()
    {
        using var observer = new Observer(_ => { }, fixture: true);
        observer.Start(1); bool started = observer.Active; observer.Stop();
        Emit(new { type = "self-test", hooksStarted = started, hooksStopped = !observer.Active, globalInputCollected = false });
        return started && !observer.Active ? 0 : 1;
    }
    internal static int Run(bool fixture = false, bool realDisplay = false)
    {
        using var dispatcher = new Control(); _ = dispatcher.Handle;
        using var context = new ApplicationContext();
        using var observer = new Observer(Emit, fixture);
        Emit(new { type = "ready", protocolVersion = 1, arrangedAvailable = Observer.ArrangedAvailable });
        _ = Task.Run(() =>
        {
            try
            {
                string? line;
                while ((line = Console.ReadLine()) is not null)
                {
                    if (line.Length > 4096) break;
                    string commandLine = line;
                    dispatcher.BeginInvoke(() =>
                    {
                        int requestId = 0;
                        try
                        {
                            using var document = JsonDocument.Parse(commandLine); var command = document.RootElement;
                            requestId = command.GetProperty("requestId").GetInt32();
                            switch (command.GetProperty("command").GetString())
                            {
                                case "start":
                                    observer.Start(command.GetProperty("generation").GetInt32());
                                    Emit(new { type = "started", requestId }); break;
                                case "stop": observer.Stop(); Emit(new { type = "stopped", requestId }); break;
                                case "queryDisplayContext": Emit(new { type = "displayContext", requestId, result = fixture && !realDisplay ? new { known = true, fullscreen = false } : DisplayContext.Query(command.GetProperty("monitor")) }); break;
                                case "fixtureCandidate" when fixture:
                                    Emit(command.GetProperty("candidate")); Emit(new { type = "injected", requestId }); break;
                                case "fixtureFocus" when fixture:
                                    Emit(new { type = "focus", requestId, result = Observer.ForegroundToken }); break;
                                case "shutdown": observer.Stop(); Emit(new { type = "stopped", requestId }); context.ExitThread(); break;
                                default: Emit(new { type = "fault", requestId, reason = "unknown-command" }); break;
                            }
                        }
                        catch { observer.Stop(); Emit(new { type = "fault", requestId, reason = "observer-command-failed" }); }
                    });
                }
            }
            finally { try { dispatcher.BeginInvoke(() => { observer.Stop(); context.ExitThread(); }); } catch { } }
        });
        Application.Run(context); observer.Stop(); return 0;
    }
}
