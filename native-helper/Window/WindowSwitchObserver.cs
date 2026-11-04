using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using static NativeMethods;
using Point = NativeMethods.Point;

// Uses the existing message-thread hooks. No window identity or raw input crosses the protocol.
internal sealed class WindowSwitchObserver(
    CandidateProtocol protocol,
    Func<int> transaction,
    Func<long> now,
    Action<WindowDiagnosticReason>? diagnostic = null
) : IDisposable
{
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 50 };
    private WindowSwitchPolicy policy = new();
    private int generation,
        pendingTransaction;
    private string date = "";
    private uint inputTick;
    private uint shellProcess;
    private Point? mouseDown;
    internal bool MousePending => mouseDown is not null && policy.Pending;

    // Query only defined key/button codes, not reserved virtual values with undefined state.
    private static readonly int[] neutralKeys = Enum.GetValues<System.Windows.Forms.Keys>()
        .Select(k => (int)k)
        .Where(k => k is >= 1 and <= 254)
        .Distinct()
        .ToArray();

    internal void Start(int epoch)
    {
        Stop();
        generation = epoch;
        Neutral();
        timer.Tick += Tick;
        timer.Start();
    }

    internal void Stop()
    {
        timer.Stop();
        timer.Tick -= Tick;
        generation = 0;
        pendingTransaction = 0;
        shellProcess = 0;
        policy = new() { Diagnostic = diagnostic };
        mouseDown = null;
    }

    internal void Cancel()
    {
        policy.Cancel();
        mouseDown = null;
    }

    private void Neutral() =>
        policy.Neutral(WindowSwitchPolicy.KeysReleased(neutralKeys, k => GetAsyncKeyState(k) >= 0));

    internal static SwitchWindow? Read(nint window, Action<WindowDiagnosticReason>? note = null)
    {
        if (
            window == 0
            || window == GetDesktopWindow()
            || window == GetShellWindow()
            || GetAncestor(window, GA_ROOT) != window
            || GetWindow(window, 4) != 0
            || !IsWindowVisible(window)
            || IsIconic(window)
        )
        {
            note?.Invoke(WindowDiagnosticReason.W01ReadWindowRejected);
            return null;
        }
        var cls = new StringBuilder(256);
        if (
            GetClassNameW(window, cls, cls.Capacity) == 0
            || cls.ToString()
                is "Shell_TrayWnd"
                    or "Shell_SecondaryTrayWnd"
                    or "Progman"
                    or "WorkerW"
                    or "XamlExplorerHostIslandWindow"
                    or "MultitaskingViewFrame"
        )
        {
            note?.Invoke(WindowDiagnosticReason.W01ReadClassRejected);
            return null;
        }
        long style = GetWindowStyle(window, GWL_STYLE).ToInt64(),
            extended = GetWindowStyle(window, -20).ToInt64();
        if (
            (style & 0x40000000) != 0
            || (style & WS_CAPTION) != WS_CAPTION
            || (extended & (0x80 | 0x08000000)) != 0
            || DwmGetWindowAttribute(window, DWMWA_CLOAKED, out int cloaked, sizeof(int)) != 0
            || cloaked != 0
        )
        {
            note?.Invoke(WindowDiagnosticReason.W01ReadStyleRejected);
            return null;
        }
        GetWindowThreadProcessId(window, out uint pid);
        if (pid == 0 || pid == Environment.ProcessId || !Observer.OrdinaryProcess(pid))
        {
            note?.Invoke(WindowDiagnosticReason.W01ReadProcessRejected);
            return null;
        }
        try
        {
            using var process = Process.GetProcessById((int)pid);
            // Edge can expose tabs to Alt+Tab; HWND alone does not prove a window-level switch.
            note?.Invoke(WindowDiagnosticReason.W01ReadAccepted);
            return new(
                window,
                pid,
                !process.ProcessName.Equals("msedge", StringComparison.OrdinalIgnoreCase)
            );
        }
        catch
        {
            note?.Invoke(WindowDiagnosticReason.W01ReadFailed);
            return null;
        }
    }

    private void Capture(bool wasPending, uint tick)
    {
        if (!wasPending && policy.Pending)
        {
            pendingTransaction = transaction();
            inputTick = tick;
            GetWindowThreadProcessId(GetShellWindow(), out shellProcess);
            date = DateTime.Now.ToString("yyyy-MM-dd");
        }
    }

    internal void Key(uint key, bool down, uint flags, uint tick)
    {
        if (generation == 0)
            return;
        bool pending = policy.Pending;
        policy.Key(
            key,
            down,
            (flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0,
            key is 0x12 or 0xa4 or 0xa5 ? Read(GetForegroundWindow(), diagnostic) : null,
            now()
        );
        Capture(pending, tick);
    }

    internal void Mouse(nint message, Point point, uint flags, uint tick)
    {
        if (generation == 0)
            return;
        if (message == 0x200 && flags == 0)
        {
            if (
                policy.Pending
                && mouseDown is { } p
                && (
                    Math.Abs((long)point.X - p.X) > Math.Max(1, GetSystemMetrics(68) / 2)
                    || Math.Abs((long)point.Y - p.Y) > Math.Max(1, GetSystemMetrics(69) / 2)
                )
            )
                Cancel();
            return;
        }
        bool pending = policy.Pending;
        policy.Mouse(
            message,
            message is 0x201 or 0x202
                ? Read(GetAncestor(WindowFromPhysicalPoint(point), GA_ROOT))
                : null,
            message == 0x201 ? Read(GetForegroundWindow()) : null,
            (flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED)) != 0,
            new[] { VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN }.Any(k =>
                GetAsyncKeyState(k) < 0
            ),
            now()
        );
        Capture(pending, tick);
        if (message == 0x201)
            mouseDown = policy.Pending ? point : null;
        else if (message == 0x202)
            mouseDown = null;
    }

    internal void Foreground(nint window, uint eventTime)
    {
        if (generation == 0 || !policy.Pending)
            return;

        nint current = GetForegroundWindow();
        long at = now();
        policy.NativeForeground(
            window,
            current,
            window == current ? Read(current, diagnostic) : null,
            inputTick,
            eventTime,
            at,
            window == current && KnownSwitcher(current),
            window == current && KnownSwitcher(current, staging: true)
        );
    }

    private bool KnownSwitcher(nint window, bool staging = false)
    {
        if (window == 0 || GetAncestor(window, GA_ROOT) != window)
            return false;
        var cls = new StringBuilder(256);
        if (GetClassNameW(window, cls, cls.Capacity) == 0)
            return false;
        GetWindowThreadProcessId(window, out uint pid);
        GetWindowThreadProcessId(GetShellWindow(), out uint shellPid);
        if (!WindowSwitchPolicy.ShellHostUnchanged(shellProcess, shellPid))
        {
            diagnostic?.Invoke(WindowDiagnosticReason.W01ShellHostChanged);
            return false;
        }
        bool known = staging
            ? WindowSwitchPolicy.KnownStagingType(cls.ToString(), pid, shellPid)
                || WindowSwitchPolicy.KnownHiddenSwitcherType(
                    cls.ToString(),
                    pid,
                    shellPid,
                    IsWindowVisible(window)
                )
            : WindowSwitchPolicy.KnownSwitcherType(
                cls.ToString(),
                pid,
                shellPid,
                IsWindowVisible(window)
            );
        if (!known)
            diagnostic?.Invoke(WindowDiagnosticReason.W01SwitcherUnknownType);
        return known;
    }

    private void Tick(object? sender, EventArgs args)
    {
        if (generation == 0)
            return;
        try
        {
            Neutral();
            var completed = policy.Poll(policy.Pending ? Read(GetForegroundWindow()) : null, now());
            if (completed is not null && Read(GetForegroundWindow()) == completed.Target)
            {
                protocol.Switch(
                    generation,
                    pendingTransaction,
                    date,
                    completed.Origin,
                    new(
                        true,
                        true,
                        true,
                        true,
                        completed.InputAgeMs,
                        completed.SettleMs,
                        DisplayContext.Monitor(completed.Target.Handle)
                    )
                );
            }
        }
        catch
        {
            policy.Cancel();
        }
    }

    public void Dispose()
    {
        Stop();
        timer.Dispose();
    }
}
