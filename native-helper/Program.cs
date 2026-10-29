using System.Text.Json;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        if (args.Length == 2 && args[0] == "--taskbar-worker" && int.TryParse(args[1], out int parent)) return TaskbarQuery.RunWorker(parent);
        if (args.Length == 2 && args[0] == "--taskbar-worker-fixture" && int.TryParse(args[1], out int fixtureParent)) return TaskbarQuery.RunWorker(fixtureParent, fixture: true);
        if (args.Length != 1) return 2;
        switch (args[0])
        {
            case "--observe": return ObserverHost.Run();
            case "--close-validation-consented": return ObserverHost.Run(closeValidation: true);
            case "--fixture": return ObserverHost.Run(fixture: true);
            case "--fixture-display": return ObserverHost.Run(fixture: true, realDisplay: true);
            case "--self-test": return ObserverHost.SelfTest();
            case "--taskbar-query-self-test": return TaskbarQuery.SelfTest().GetAwaiter().GetResult();
            case "--display-policy-test":
                Console.WriteLine(JsonSerializer.Serialize(DisplayPolicy.Check())); return 0;
            case "--display-check":
                foreach (Screen screen in Screen.AllScreens)
                {
                    var r = screen.Bounds;
                    using var document = JsonDocument.Parse(JsonSerializer.Serialize(new { x = r.X, y = r.Y, width = r.Width, height = r.Height }));
                    Console.WriteLine(JsonSerializer.Serialize(DisplayContext.Query(document.RootElement, diagnostic: true)));
                }
                return 0;
            default: Console.Error.WriteLine("Unknown observer mode."); return 2;
        }
    }
}
