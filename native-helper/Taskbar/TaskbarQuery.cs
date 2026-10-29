using System.Diagnostics;
using System.Text.Json;
using System.Windows.Automation;
using static NativeMethods;

// UIA providers can hang. Only this child process calls UIA; the hook process has a 2s deadline.
internal sealed class TaskbarQuery(bool fixture = false) : IDisposable
{
    private readonly object gate = new();
    private Process? worker;
    private bool disposed;
    internal async Task<TaskbarSnapshot> Read(string command = "snapshot")
    {
        Process child;
        lock (gate)
        {
            if (disposed) return TaskbarSnapshot.Unknown;
            if (worker is null || worker.HasExited)
            {
                worker?.Dispose();
                worker = Process.Start(new ProcessStartInfo(Environment.ProcessPath!, $"{(fixture ? "--taskbar-worker-fixture" : "--taskbar-worker")} {Environment.ProcessId}")
                { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardInput = true });
            }
            child = worker!;
        }
        try
        {
            await child.StandardInput.WriteLineAsync(command);
            string? line = await child.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(2));
            return line is null || line.Length > 262144 ? TaskbarSnapshot.Unknown : JsonSerializer.Deserialize<TaskbarSnapshot>(line) ?? TaskbarSnapshot.Unknown;
        }
        catch { lock (gate) { Retire(); } return TaskbarSnapshot.Unknown; }
    }
    private void Retire()
    {
        try { if (worker is not null && !worker.HasExited) worker.Kill(); } catch { }
        worker?.Dispose(); worker = null;
    }
    public void Dispose() { lock (gate) { disposed = true; Retire(); } }

    internal static int RunWorker(int parentId, bool fixture = false)
    {
        using var parent = Process.GetProcessById(parentId);
        long querying = 0;
        using var watchdog = new System.Threading.Timer(_ =>
        {
            try { if (parent.HasExited || (Interlocked.Read(ref querying) != 0 && Environment.TickCount64 - Interlocked.Read(ref querying) > 2500)) Environment.Exit(1); }
            catch { Environment.Exit(1); }
        }, null, 250, 250);
        while (Console.ReadLine() is { } command)
        {
            if (command != "snapshot" && !(fixture && command == "delay")) return 2;
            Interlocked.Exchange(ref querying, Environment.TickCount64);
            TaskbarSnapshot snapshot;
            try {
                if (fixture && command == "delay") Thread.Sleep(10000);
                snapshot = fixture ? new(null, 1, 0, 0, 100, 20, [new("fixture", 0, 0, 20, 20)]) : Inspect();
            } catch { snapshot = TaskbarSnapshot.Unknown; }
            Console.WriteLine(JsonSerializer.Serialize(snapshot));
            Interlocked.Exchange(ref querying, 0);
        }
        return 0;
    }
    internal static async Task<int> SelfTest()
    {
        using var query = new TaskbarQuery(fixture: true);
        bool first = (await query.Read()).Items.Length == 1;
        int pid = query.worker!.Id;
        bool reused = (await query.Read()).Items.Length == 1 && query.worker!.Id == pid;
        bool timeout = (await query.Read("delay")).Error is not null;
        bool restarted = (await query.Read()).Items.Length == 1 && query.worker!.Id != pid;
        query.Dispose();
        bool stopped = (await query.Read()).Error is not null;
        Console.WriteLine(JsonSerializer.Serialize(new { first, reused, timeout, restarted, stopped, globalInputCollected = false }));
        return first && reused && timeout && restarted && stopped ? 0 : 1;
    }
    private static TaskbarSnapshot Inspect()
    {
        nint bar = FindWindowW("Shell_TrayWnd", null);
        if (bar == 0 || !IsWindowVisible(bar)) return TaskbarSnapshot.Unknown;
        var root = AutomationElement.FromHandle(bar);
        var bounds = root.Current.BoundingRectangle;
        // RTL and vertical layouts have no verified slot ordering.
        if (bounds.IsEmpty || bounds.Width <= bounds.Height || (GetWindowStyle(bar, -20).ToInt64() & 0x00400000) != 0) return TaskbarSnapshot.Unknown;
        var buttons = root.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button));
        var items = new List<TaskbarItem>(); var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (AutomationElement button in buttons)
        {
            var current = button.Current;
            string id = current.AutomationId, cls = current.ClassName;
            if (id.Contains("Overflow", StringComparison.OrdinalIgnoreCase) && !current.IsOffscreen) return TaskbarSnapshot.Unknown;
            bool appId = id.StartsWith("Appid:", StringComparison.OrdinalIgnoreCase);
            bool appClass = cls.Contains("TaskListButton", StringComparison.OrdinalIgnoreCase);
            if (!appId && !appClass) continue;
            var rect = current.BoundingRectangle;
            if (!appId || !appClass || current.IsOffscreen || !current.IsEnabled || rect.IsEmpty || rect.Width <= 0 || rect.Height <= 0 ||
                !bounds.Contains(rect) || !ids.Add(id) || items.Count >= 256) return TaskbarSnapshot.Unknown;
            items.Add(new(id, rect.X, rect.Y, rect.Width, rect.Height));
        }
        items.Sort((a, b) => a.X.CompareTo(b.X));
        for (int i = 1; i < items.Count; i++) if (items[i - 1].X + items[i - 1].W > items[i].X) return TaskbarSnapshot.Unknown;
        if (items.Count == 0) return TaskbarSnapshot.Unknown;
        return new(null, bar.ToInt64(), bounds.X, bounds.Y, bounds.Width, bounds.Height, items.ToArray());
    }
}
