using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using static NativeMethods;
using Point = NativeMethods.Point;

// Uses the existing message-thread hooks. No window identity or raw input crosses the protocol.
internal sealed class WindowSwitchObserver(CandidateProtocol protocol, Func<int> transaction, Func<long> now) : IDisposable
{
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 50 };
    private WindowSwitchPolicy policy = new();
    private int generation, pendingTransaction;
    private string date = "";
    private uint inputTick;
    private Point? mouseDown;
    internal void Start(int epoch)
    {
        Stop(); generation = epoch; Neutral(); timer.Tick += Tick; timer.Start();
    }
    internal void Stop()
    { timer.Stop(); timer.Tick -= Tick; generation = 0; pendingTransaction = 0; policy = new(); mouseDown = null; }
    internal void Cancel() { policy.Cancel(); mouseDown = null; }
    private void Neutral() => policy.Neutral(Enumerable.Range(1, 254).All(k => GetAsyncKeyState(k) >= 0));
    private static SwitchWindow? Read(nint window)
    {
        if (window == 0 || window == GetDesktopWindow() || window == GetShellWindow() ||
            GetAncestor(window, GA_ROOT) != window || GetWindow(window, 4) != 0 || !IsWindowVisible(window) || IsIconic(window)) return null;
        var cls = new StringBuilder(256);
        if (GetClassNameW(window, cls, cls.Capacity) == 0 || cls.ToString() is "Shell_TrayWnd" or "Shell_SecondaryTrayWnd" or
            "Progman" or "WorkerW" or "XamlExplorerHostIslandWindow" or "MultitaskingViewFrame") return null;
        long style = GetWindowStyle(window, GWL_STYLE).ToInt64(), extended = GetWindowStyle(window, -20).ToInt64();
        if ((style & 0x40000000) != 0 || (style & WS_CAPTION) != WS_CAPTION || (extended & (0x80 | 0x08000000)) != 0 ||
            DwmGetWindowAttribute(window, DWMWA_CLOAKED, out int cloaked, sizeof(int)) != 0 || cloaked != 0) return null;
        GetWindowThreadProcessId(window, out uint pid);
        if (pid == 0 || pid == Environment.ProcessId || !Observer.OrdinaryProcess(pid)) return null;
        try
        {
            using var process = Process.GetProcessById((int)pid);
            // Edge can expose tabs to Alt+Tab; HWND alone does not prove a window-level switch.
            return new(window, pid, !process.ProcessName.Equals("msedge", StringComparison.OrdinalIgnoreCase));
        }
        catch { return null; }
    }
    private void Capture(bool wasPending, uint tick)
    {
        if (!wasPending && policy.Pending) { pendingTransaction = transaction(); inputTick = tick; date = DateTime.Now.ToString("yyyy-MM-dd"); }
    }
    internal void Key(uint key, bool down, uint flags, uint tick)
    {
        if (generation == 0) return;
        bool pending = policy.Pending;
        policy.Key(key, down, (flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0,
            key is 0x12 or 0xa4 or 0xa5 ? Read(GetForegroundWindow()) : null, now());
        Capture(pending, tick);
    }
    internal void Mouse(nint message, Point point, uint flags, uint tick)
    {
        if (generation == 0) return;
        if (message == 0x200 && flags == 0)
        {
            if (policy.Pending && mouseDown is { } p &&
                (Math.Abs((long)point.X - p.X) > Math.Max(1, GetSystemMetrics(68) / 2) ||
                 Math.Abs((long)point.Y - p.Y) > Math.Max(1, GetSystemMetrics(69) / 2))) Cancel();
            return;
        }
        bool pending = policy.Pending;
        policy.Mouse(message, message is 0x201 or 0x202 ? Read(GetAncestor(WindowFromPhysicalPoint(point), GA_ROOT)) : null,
            message == 0x201 ? Read(GetForegroundWindow()) : null,
            (flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED)) != 0,
            new[] { VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN }.Any(k => GetAsyncKeyState(k) < 0), now());
        Capture(pending, tick);
        if (message == 0x201) mouseDown = policy.Pending ? point : null;
        else if (message == 0x202) mouseDown = null;
    }
    internal void Foreground(nint window, uint eventTime)
    {
        if (generation == 0 || !policy.Pending) return;
        nint current = GetForegroundWindow();
        long at = now();
        policy.NativeForeground(window, current, window == current ? Read(current) : null, inputTick, eventTime, at);
    }
    private void Tick(object? sender, EventArgs args)
    {
        if (generation == 0) return;
        try
        {
            Neutral();
            var completed = policy.Poll(policy.Pending ? Read(GetForegroundWindow()) : null, now());
            if (completed is not null && Read(GetForegroundWindow()) == completed.Target)
                protocol.Switch(generation, pendingTransaction, date, completed.Origin,
                    new(true, true, true, true, completed.InputAgeMs, completed.SettleMs, DisplayContext.Monitor(completed.Target.Handle)));
        }
        catch { policy.Cancel(); }
    }
    public void Dispose() { Stop(); timer.Dispose(); }
}
