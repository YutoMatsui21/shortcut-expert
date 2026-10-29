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
    internal static int Run(bool fixture = false, bool realDisplay = false, bool closeValidation = false)
    {
        using var dispatcher = new Control(); _ = dispatcher.Handle;
        using var context = new ApplicationContext();
        var closeCounts = closeValidation ? Enum.GetValues<CloseReason>().ToDictionary(k => k.ToString(), _ => 0) : null;
        void CloseDiagnostic(CloseReason reason) {
            if (closeCounts is not null) closeCounts[reason.ToString()] = Math.Min(1000, closeCounts[reason.ToString()] + 1);
        }
        using var observer = new Observer(Emit, fixture, closeValidation ? CloseDiagnostic : null);
        // Marshal display/settings invalidation to the same thread as input and WinEvent callbacks.
        void DisplayChanged(object? sender, EventArgs args) {
            try { dispatcher.BeginInvoke(() => observer.InvalidateDisplay()); } catch (InvalidOperationException) { }
        }
        Microsoft.Win32.SystemEvents.DisplaySettingsChanging += DisplayChanged;
        Microsoft.Win32.SystemEvents.UserPreferenceChanging += DisplayChanged;
        int selectedProtocol = 1;
        Emit(new { type = "ready", protocolVersion = 1, supportedProtocols = new[] { 1, 2 }, arrangedAvailable = Observer.ArrangedAvailable });
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
                                    if (closeCounts is not null) foreach (var key in closeCounts.Keys) closeCounts[key] = 0;
                                    selectedProtocol = command.TryGetProperty("protocolVersion", out var version) ? version.GetInt32() : 1;
                                    observer.Start(command.GetProperty("generation").GetInt32(), selectedProtocol);
                                    Emit(new { type = "started", requestId }); break;
                                case "stop":
                                    observer.Stop();
                                    if (closeCounts is not null) Emit(new { type = "close-diagnostics", counts = closeCounts });
                                    Emit(new { type = "stopped", requestId }); break;
                                case "queryDisplayContext": Emit(new { type = "displayContext", requestId, result = fixture && !realDisplay ? new { known = true, fullscreen = false } : DisplayContext.Query(command.GetProperty("monitor")) }); break;
                                case "fixtureCandidate" when fixture:
                                    var fixtureValue = command.GetProperty("candidate");
                                    if (selectedProtocol == 2 && fixtureValue.GetProperty("protocolVersion").GetInt32() == 1)
                                    {
                                        var legacy = fixtureValue.Deserialize<WindowCandidate>() ?? throw new ArgumentException("fixture");
                                        Emit(CandidateProtocol.V2(legacy, legacy.sequence, legacy.sequence));
                                    }
                                    else Emit(fixtureValue);
                                    Emit(new { type = "injected", requestId }); break;
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
        try { Application.Run(context); observer.Stop(); return 0; }
        finally {
            Microsoft.Win32.SystemEvents.DisplaySettingsChanging -= DisplayChanged;
            Microsoft.Win32.SystemEvents.UserPreferenceChanging -= DisplayChanged;
        }
    }
}
