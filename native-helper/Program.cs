using System.Text.Json;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        if (args.Length != 1) return 2;
        switch (args[0])
        {
            case "--observe": return ObserverHost.Run();
            case "--fixture": return ObserverHost.Run(fixture: true);
            case "--fixture-display": return ObserverHost.Run(fixture: true, realDisplay: true);
            case "--self-test": return ObserverHost.SelfTest();
            case "--display-policy-test":
                Console.WriteLine(JsonSerializer.Serialize(DisplayPolicy.Check())); return 0;
            case "--display-check":
                foreach (Screen screen in Screen.AllScreens)
                {
                    var r = screen.Bounds;
                    using var document = JsonDocument.Parse(JsonSerializer.Serialize(new { x = r.X, y = r.Y, width = r.Width, height = r.Height }));
                    Console.WriteLine(JsonSerializer.Serialize(Observer.DisplayContext(document.RootElement, diagnostic: true)));
                }
                return 0;
            default: Console.Error.WriteLine("Unknown observer mode."); return 2;
        }
    }
}
