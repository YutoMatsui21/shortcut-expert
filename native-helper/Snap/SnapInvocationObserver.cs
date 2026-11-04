using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;
using static NativeMethods;
using Point = NativeMethods.Point;

// All mutable state lives on the helper's message thread. No raw input leaves this class.
internal sealed class SnapInvocationObserver(
    CandidateProtocol protocol,
    Func<int> transaction,
    Func<long> now
) : IDisposable
{
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 50 };
    private SnapKeys keys = new();
    private readonly SnapDwell dwell = new();
    private int generation;
    private SnapSettings settings;
    private long settingsAt;
    private bool physicalMouse;
    private (nint Window, uint Process, long At, int Transaction, SnapSettings Settings)? pending;
    private static readonly int[] neutralKeys =
    [
        0x5b,
        0x5c,
        0x5a,
        0x10,
        0x11,
        0x12,
        0xa0,
        0xa1,
        0xa2,
        0xa3,
        0xa4,
        0xa5,
    ];

    internal void Start(int epoch)
    {
        Stop();
        generation = epoch;
        settings = ReadSettings();
        settingsAt = now();
        keys.ObserveNeutral(neutralKeys.All(key => GetAsyncKeyState(key) >= 0));
        timer.Tick += Tick;
        timer.Start();
    }

    internal void Stop()
    {
        timer.Stop();
        timer.Tick -= Tick;
        generation = 0;
        pending = null;
        physicalMouse = false;
        keys = new();
        dwell.Reset();
    }

    internal void Key(uint key, bool down, uint flags)
    {
        if (generation == 0)
            return;
        bool injected = (flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0;
        if (injected || (down && key != 0x5a))
            pending = null;
        if (!keys.Step(key, down, injected))
            return;
        nint window = GetAncestor(GetForegroundWindow(), GA_ROOT);
        long at = now();
        if (
            window != 0
            && settings.Key == true
            && at - settingsAt <= 200
            && Eligible(window, out uint pid)
            && GetAsyncKeyState(VK_CONTROL) >= 0
            && GetAsyncKeyState(VK_MENU) >= 0
            && GetAsyncKeyState(VK_SHIFT) >= 0
        )
            pending = (window, pid, at, transaction(), settings);
    }

    internal void Mouse(nint message, uint flags)
    {
        if (generation == 0)
            return;
        if ((flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED)) != 0)
        {
            physicalMouse = false;
            dwell.Step(0, now());
            pending = null;
        }
        else if (message == 0x200)
            physicalMouse = true;
        else
        {
            dwell.Step(0, now());
            pending = null;
        }
    }

    private static object? Setting(string path, string name, RegistryValueKind kind)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(path);
            return key?.GetValueKind(name) == kind ? key.GetValue(name) : null;
        }
        catch
        {
            return null;
        }
    }

    private static SnapSettings ReadSettings()
    {
        bool success = SystemParametersInfoW(0x82, 0, out int value, 0);
        return SnapSettings.Resolve(
            success && value is 0 or 1 ? value == 1 : null,
            Setting(@"Control Panel\Desktop", "WindowArrangementActive", RegistryValueKind.String),
            Setting(
                @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
                "EnableSnapAssistFlyout",
                RegistryValueKind.DWord
            )
        );
    }

    private static bool Eligible(nint window, out uint pid)
    {
        pid = 0;
        if (
            window == 0
            || GetAncestor(window, GA_ROOT) != window
            || window == GetDesktopWindow()
            || window == GetShellWindow()
            || !IsWindowVisible(window)
            || IsIconic(window)
        )
            return false;
        var name = new StringBuilder(256);
        if (
            GetClassNameW(window, name, name.Capacity) == 0
            || name.ToString()
                is "Progman"
                    or "WorkerW"
                    or "Shell_TrayWnd"
                    or "Shell_SecondaryTrayWnd"
        )
            return false;
        long style = GetWindowStyle(window, GWL_STYLE).ToInt64();
        if ((style & 0x40000000) != 0 || (style & 0x10000) == 0 || (style & 0x40000) == 0)
            return false;
        GetWindowThreadProcessId(window, out pid);
        return pid != 0 && pid != Environment.ProcessId && Observer.OrdinaryProcess(pid);
    }

    private void Tick(object? sender, EventArgs args)
    {
        if (generation == 0)
            return;
        try
        {
            keys.ObserveNeutral(neutralKeys.All(key => GetAsyncKeyState(key) >= 0));
            SnapSettings current = ReadSettings();
            if (current != settings)
            {
                pending = null;
                dwell.Step(0, now());
            }
            settings = current;
            settingsAt = now();
            var key = pending;
            pending = null;
            if (
                key is { } p
                && now() - p.At is >= 0 and <= 200
                && p.Settings == current
                && current.Key == true
                && Eligible(p.Window, out uint pid)
                && pid == p.Process
                && ReadSettings() == current
            )
                protocol.Invocation(
                    generation,
                    p.Transaction,
                    "key",
                    new(true, true, true, null, 0, now() - p.At, DisplayContext.Monitor(p.Window))
                );
            PollHover(current);
        }
        catch
        {
            pending = null;
            dwell.Step(0, now());
        }
    }

    private void PollHover(SnapSettings current)
    {
        nint previous = SetThreadDpiAwarenessContext(-4);
        if (previous == 0)
        {
            dwell.Step(0, now());
            return;
        }
        try
        {
            nint candidate = 0;
            uint candidatePid = 0;
            bool exit = false;
            string? source = null;
            if (GetPhysicalCursorPos(out Point point))
            {
                nint window = GetAncestor(WindowFromPoint(point), GA_ROOT);
                if (
                    Eligible(window, out uint pid)
                    && GetWindowRect(window, out Rect before)
                    && WindowCaption.Read(window, out TitleInfo title)
                )
                {
                    source = SnapGeometry.Source(
                        title.Bounds[2],
                        title.Bounds[3],
                        title.Bounds[5],
                        before
                    );
                    bool? hit =
                        source == "title-rect"
                            ? (title.State[3] & 0x18001) == 0
                                && SnapGeometry.Contains(title.Bounds[3], point)
                        : source == "hit-fallback" ? Hit(window, point)
                        : null;
                    if (
                        hit is not null
                        && GetPhysicalCursorPos(out Point after)
                        && GetAncestor(WindowFromPoint(after), GA_ROOT) == window
                        && GetWindowRect(window, out Rect end)
                        && before.Equals(end)
                        && Eligible(window, out uint endPid)
                        && pid == endPid
                        && (
                            source == "title-rect"
                                ? SnapGeometry.Contains(title.Bounds[3], point)
                                    == SnapGeometry.Contains(title.Bounds[3], after)
                                : point.Equals(after)
                        )
                    )
                    {
                        if (hit == true)
                        {
                            candidate = window;
                            candidatePid = pid;
                        }
                        else
                            exit =
                                source != "title-rect"
                                || !SnapGeometry.Contains(title.Bounds[3], after);
                    }
                }
                // An ineligible window is a confirmed exit only when it can be identified.
                else if (KnownOutside(window))
                    exit = true;
            }
            bool buttons = new[] { 1, 2, 4, 5, 6 }.Any(key => GetAsyncKeyState(key) < 0);
            // OFF/unknown must not rearm an already counted dwell. A confirmed geometric exit may.
            bool verified =
                candidate == 0
                || buttons
                || !physicalMouse
                || current.Hover != true
                || ReadSettings() == current;
            long at = now();
            if (
                dwell.Sample(
                    candidate,
                    at,
                    exit,
                    buttons,
                    physicalMouse,
                    current.Hover,
                    candidatePid,
                    verified
                )
            )
                protocol.Invocation(
                    generation,
                    transaction(),
                    "mouse",
                    new(
                        true,
                        true,
                        true,
                        source,
                        dwell.Duration(at),
                        0,
                        DisplayContext.Monitor(candidate)
                    )
                );
        }
        finally
        {
            SetThreadDpiAwarenessContext(previous);
        }
    }

    private static bool? Hit(nint window, Point point)
    {
        if (
            point.X is < short.MinValue or > short.MaxValue
            || point.Y is < short.MinValue or > short.MaxValue
        )
            return null;
        int packed = (point.Y << 16) | (point.X & 0xffff);
        return
            SendMessageTimeoutW(
                window,
                WM_NCHITTEST,
                0,
                packed,
                SMTO_ABORTIFHUNG,
                30,
                out nuint result
            ) == 0
            ? null
            : (int)result == HTMAXBUTTON;
    }

    private bool KnownOutside(nint window)
    {
        if (window == 0)
            return false;
        if (window == GetDesktopWindow() || window == GetShellWindow())
            return true;
        var name = new StringBuilder(256);
        if (
            GetClassNameW(window, name, name.Capacity) != 0
            && name.ToString()
                is "Progman"
                    or "WorkerW"
                    or "Shell_TrayWnd"
                    or "Shell_SecondaryTrayWnd"
        )
            return true;
        // A stable different root proves exit even if that window has no maximize button.
        return window != dwell.Resident
            && IsWindowVisible(window)
            && GetWindowThreadProcessId(window, out uint pid) != 0
            && pid != 0
            && GetPhysicalCursorPos(out Point point)
            && GetAncestor(WindowFromPoint(point), GA_ROOT) == window;
    }

    public void Dispose()
    {
        Stop();
        timer.Dispose();
    }
}
