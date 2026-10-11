using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text;
using System.Windows.Forms;

internal sealed class Observer : IDisposable
{
    [StructLayout(LayoutKind.Sequential)] internal struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct Placement
    {
        public uint Length, Flags, Show; public Point Min, Max; public Rect Normal;
    }
    [StructLayout(LayoutKind.Sequential)] private struct MouseData
    {
        public Point Point; public uint Data, Flags, Time; public nuint Extra;
    }
    [StructLayout(LayoutKind.Sequential)] private struct KeyData
    {
        public uint Key, Scan, Flags, Time; public nuint Extra;
    }
    [StructLayout(LayoutKind.Sequential)] private struct MonitorInfo { public uint Size; public Rect Monitor, Work; public uint Flags; }
    private delegate nint InputHook(int code, nint message, nint data);
    private delegate void EventHook(nint hook, uint kind, nint window, int obj, int child, uint thread, uint time);
    private delegate bool Enumerate(nint window, nint data);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate int Arranged(nint window);
    [DllImport("user32.dll")] private static extern nint SetWindowsHookExW(int kind, InputHook callback, nint module, uint thread);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(nint hook);
    [DllImport("user32.dll")] private static extern nint CallNextHookEx(nint hook, int code, nint message, nint data);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern nint GetModuleHandleW(string? name);
    [DllImport("user32.dll")] private static extern nint SetWinEventHook(uint min, uint max, nint module, EventHook callback, uint process, uint thread, uint flags);
    [DllImport("user32.dll")] private static extern bool UnhookWinEvent(nint hook);
    [DllImport("user32.dll")] private static extern bool EnumWindows(Enumerate callback, nint data);
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern nint GetAncestor(nint window, uint flags);
    [DllImport("user32.dll")] private static extern nint WindowFromPoint(Point point);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint window, out uint process);
    [DllImport("user32.dll")] private static extern bool GetWindowPlacement(nint window, ref Placement placement);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint window);
    [DllImport("user32.dll")] private static extern bool IsIconic(nint window);
    [DllImport("user32.dll")] private static extern bool IsZoomed(nint window);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern nint GetWindowStyle(nint window, int index);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassNameW(nint window, StringBuilder name, int maximum);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern uint GetDoubleClickTime();
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("kernel32.dll")] private static extern nint OpenProcess(uint access, bool inherit, uint process);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(nint handle);
    [DllImport("advapi32.dll")] private static extern bool OpenProcessToken(nint process, uint access, out nint token);
    [DllImport("advapi32.dll")] private static extern bool GetTokenInformation(nint token, int kind, out int value, uint length, out uint returned);
    [DllImport("user32.dll")] private static extern nint MonitorFromWindow(nint window, uint flags);
    [DllImport("user32.dll")] private static extern bool GetMonitorInfoW(nint monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] private static extern nint SendMessageTimeoutW(nint window, uint message, nint wp, nint lp, uint flags, uint timeout, out nuint result);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(nint window, uint attribute, out Rect rect, uint size);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(nint window, uint attribute, out int value, uint size);

    private sealed record State(uint Process, string App, uint Show, bool? Arranged);
    private sealed record Input(nint Window, State Before, string Origin, string Route, long At, bool Injected, bool Conflicted, bool Matched);
    private readonly Action<object> emit;
    private readonly bool fixture;
    private readonly Stopwatch clock = Stopwatch.StartNew();
    private readonly Dictionary<nint, State> states = new();
    private readonly HashSet<nint> moving = new();
    private readonly InputHook mouseCallback, keyCallback;
    private readonly EventHook eventCallback;
    private readonly List<nint> eventHooks = new();
    private nint mouseHook, keyHook;
    private Input? input;
    private nint lastCaption;
    private long lastCaptionAt = -10000;
    private Point lastCaptionPoint;
    private int generation, sequence;
    private static readonly Arranged? isArranged = LoadArranged();

    internal Observer(Action<object> emit, bool fixture = false)
    {
        this.emit = emit; this.fixture = fixture;
        mouseCallback = OnMouse; keyCallback = OnKey; eventCallback = OnEvent;
    }
    internal bool Active => mouseHook != 0 && keyHook != 0 && eventHooks.Count == 4;
    internal static bool ArrangedAvailable => isArranged is not null;
    internal static string ForegroundToken => GetForegroundWindow().ToString();
    private static Arranged? LoadArranged()
    {
        nint user = GetModuleHandleW("user32.dll");
        return user != 0 && NativeLibrary.TryGetExport(user, "IsWindowArranged", out nint address)
            ? Marshal.GetDelegateForFunctionPointer<Arranged>(address) : null;
    }
    internal void Start(int newGeneration)
    {
        Stop(); generation = newGeneration; sequence = 0;
        if (!fixture && GetSystemMetrics(0x1000) != 0) throw new InvalidOperationException("remote-session-unsupported");
        if (!fixture) EnumWindows((window, _) => { Remember(window); return true; }, 0);
        nint module = GetModuleHandleW(null);
        mouseHook = SetWindowsHookExW(14, mouseCallback, module, 0);
        keyHook = SetWindowsHookExW(13, keyCallback, module, 0);
        foreach ((uint min, uint max) in new[] { (0x800Bu, 0x800Bu), (0x000Au, 0x000Bu), (0x0003u, 0x0003u), (0x8001u, 0x8001u) })
        {
            nint hook = SetWinEventHook(min, max, 0, eventCallback, 0, 0, 0);
            if (hook != 0) eventHooks.Add(hook);
        }
        if (!Active) { Stop(); throw new InvalidOperationException("hook-init-failed"); }
    }
    internal void Stop()
    {
        bool released = true;
        if (mouseHook != 0) released &= UnhookWindowsHookEx(mouseHook);
        if (keyHook != 0) released &= UnhookWindowsHookEx(keyHook);
        foreach (nint hook in eventHooks) released &= UnhookWinEvent(hook);
        mouseHook = keyHook = 0; eventHooks.Clear(); states.Clear(); moving.Clear(); input = null;
        lastCaption = 0; lastCaptionAt = -10000;
        if (!released) throw new InvalidOperationException("hook-release-failed");
    }
    private State? Read(nint window, State? cached = null)
    {
        if (window == 0 || GetAncestor(window, 2) != window || !IsWindowVisible(window)) return null;
        GetWindowThreadProcessId(window, out uint pid);
        string app;
        if (cached is not null && cached.Process == pid) app = cached.App;
        else
        {
            try { using var process = Process.GetProcessById((int)pid); app = process.ProcessName.ToLowerInvariant(); }
            catch { return null; }
            if (app is not ("chrome" or "obsidian" or "code" or "chatgpt")) return null;
            if (!OrdinaryProcess(pid)) return null;
        }
        var placement = new Placement { Length = (uint)Marshal.SizeOf<Placement>() };
        if (!GetWindowPlacement(window, ref placement)) return null;
        return new State(pid, app, placement.Show, isArranged is null ? null : isArranged(window) != 0);
    }
    private static bool OrdinaryProcess(uint pid)
    {
        nint process = OpenProcess(0x1000, false, pid), token = 0;
        if (process == 0) return false;
        try { return OpenProcessToken(process, 0x8, out token) &&
            GetTokenInformation(token, 20, out int elevated, 4, out uint size) && size == 4 && elevated == 0; }
        finally { if (token != 0) CloseHandle(token); CloseHandle(process); }
    }
    private void Remember(nint window)
    {
        states.TryGetValue(window, out State? cached);
        State? state = Read(window, cached);
        if (state is not null) states[window] = state;
    }
    private nint OnMouse(int code, nint message, nint data)
    {
        try
        {
            if (code < 0 || fixture || !Active) return CallNextHookEx(0, code, message, data);
            if (message != 0x201) { if (message is 0x204 or 0x207 or 0x20A) input = null; return CallNextHookEx(0, code, message, data); }
            var mouse = Marshal.PtrToStructure<MouseData>(data);
            nint target = GetAncestor(WindowFromPoint(mouse.Point), 2);
            if (!states.TryGetValue(target, out State? cached)) { input = null; return CallNextHookEx(0, code, message, data); }
            State? before = Read(target, cached);
            if (before is null) { input = null; return CallNextHookEx(0, code, message, data); }
            states[target] = before;
            long packed = (uint)((mouse.Point.Y & 0xffff) << 16) | (uint)(mouse.Point.X & 0xffff);
            int hit = -1;
            if (SendMessageTimeoutW(target, 0x84, 0, (nint)packed, 2, 10, out nuint result) != 0) hit = unchecked((int)result);
            long now = clock.ElapsedMilliseconds;
            string route = hit == 9 ? "max-button" : "unknown";
            if (hit == 2 && lastCaption == target && now - lastCaptionAt <= GetDoubleClickTime() &&
                Math.Abs(mouse.Point.X - lastCaptionPoint.X) <= 4 && Math.Abs(mouse.Point.Y - lastCaptionPoint.Y) <= 4)
                route = "caption-double-click";
            lastCaption = hit == 2 ? target : 0; lastCaptionAt = now; lastCaptionPoint = mouse.Point;
            input = new Input(target, before, route == "unknown" ? "unknown" : "mouse", route, now,
                (mouse.Flags & 3) != 0, GetAsyncKeyState(0x10) < 0 || GetAsyncKeyState(0x11) < 0 ||
                GetAsyncKeyState(0x12) < 0 || GetAsyncKeyState(0x5B) < 0 || GetAsyncKeyState(0x5C) < 0,
                GetForegroundWindow() == target);
        }
        catch { input = null; }
        return CallNextHookEx(0, code, message, data);
    }
    private nint OnKey(int code, nint message, nint data)
    {
        try
        {
            if (code < 0 || fixture || !Active || (message != 0x100 && message != 0x104)) return CallNextHookEx(0, code, message, data);
            var key = Marshal.PtrToStructure<KeyData>(data);
            bool modifier = key.Key is 0x5B or 0x5C or 0x10 or 0x11 or 0x12 or 0xA0 or 0xA1 or 0xA2 or 0xA3 or 0xA4 or 0xA5;
            nint target = GetForegroundWindow();
            bool conflict = input is not null && input.Origin == "mouse" && clock.ElapsedMilliseconds - input.At <= 1000;
            if (modifier) { if (input is not null) input = input with { Conflicted = true }; return CallNextHookEx(0, code, message, data); }
            if (key.Key != 0x26 || (GetAsyncKeyState(0x5B) >= 0 && GetAsyncKeyState(0x5C) >= 0) ||
                GetAsyncKeyState(0x10) < 0 || GetAsyncKeyState(0x11) < 0 || GetAsyncKeyState(0x12) < 0 ||
                !states.TryGetValue(target, out State? cached)) { input = null; return CallNextHookEx(0, code, message, data); }
            State? before = Read(target, cached);
            if (before is null) { input = null; return CallNextHookEx(0, code, message, data); }
            states[target] = before;
            input = new Input(target, before, "key", "win-up", clock.ElapsedMilliseconds, (key.Flags & 0x12) != 0, conflict, true);
        }
        catch { input = null; }
        return CallNextHookEx(0, code, message, data);
    }
    private void OnEvent(nint hook, uint kind, nint window, int obj, int child, uint thread, uint time)
    {
        if (fixture || !Active || window == 0) return;
        try
        {
            if (kind == 0x8001 && obj == 0 && child == 0) { states.Remove(window); moving.Remove(window); if (input?.Window == window) input = null; return; }
            if (kind == 0xA) { moving.Add(window); if (input?.Window == window) input = input with { Conflicted = true }; return; }
            if (kind == 0xB) { moving.Remove(window); Remember(window); if (input?.Window == window) input = null; return; }
            if (kind != 3 && (obj != 0 || child != 0)) return;
            states.TryGetValue(window, out State? previous);
            State? after = Read(window, previous);
            if (after is null) return;
            states[window] = after;
            if (previous is null || previous.Show != 1 || after.Show != 3) return;
            Input? candidate = input?.Window == window ? input : null;
            long age = candidate is null ? -1 : clock.ElapsedMilliseconds - candidate.At;
            bool recent = age >= 0 && age <= 1000;
            State before = recent && candidate is not null ? candidate.Before : previous;
            emit(new { type = "candidate", protocolVersion = 1, generation, sequence = ++sequence,
                app = after.App, operation = "maximize", date = DateTime.Now.ToString("yyyy-MM-dd"),
                before = new { state = before.Show == 1 ? "normal" : "other", arranged = before.Arranged },
                after = new { state = "maximized" }, origin = recent ? candidate!.Origin : "unknown",
                route = recent ? candidate!.Route : "unknown", injected = candidate?.Injected ?? false,
                conflicted = candidate?.Conflicted ?? false, moving = moving.Contains(window), elevated = false,
                targetMatched = recent && candidate!.Matched && GetForegroundWindow() == window,
                inputAgeMs = age, monitor = Bounds(window) });
            if (input?.Window == window) input = null;
        }
        catch { input = null; }
    }
    internal static object? Bounds(nint window)
    {
        var info = new MonitorInfo { Size = (uint)Marshal.SizeOf<MonitorInfo>() };
        if (!GetMonitorInfoW(MonitorFromWindow(window, 0), ref info)) return null;
        Rect r = info.Monitor; return new { x = r.Left, y = r.Top, width = r.Right - r.Left, height = r.Bottom - r.Top };
    }
    internal static object DisplayContext(JsonElement bounds, bool diagnostic = false)
    {
        try
        {
            int x = bounds.GetProperty("x").GetInt32(), y = bounds.GetProperty("y").GetInt32();
            int width = bounds.GetProperty("width").GetInt32(), height = bounds.GetProperty("height").GetInt32();
            Screen? display = Screen.AllScreens.FirstOrDefault(s => s.Bounds.X == x && s.Bounds.Y == y && s.Bounds.Width == width && s.Bounds.Height == height);
            if (display is null) return new { known = false, fullscreen = true };
            bool fullscreen = false, unknown = false;
            int covering = 0, maximizedCovering = 0, cloakedCovering = 0;
            var monitorRect = new Rect { Left = x, Top = y, Right = x + width, Bottom = y + height };
            uint own = (uint)Environment.ProcessId;
            bool enumerated = EnumWindows((window, _) =>
            {
                if (!IsWindowVisible(window) || IsIconic(window) || GetAncestor(window, 2) != window) return true;
                GetWindowThreadProcessId(window, out uint pid);
                if (pid == own) return true;
                bool cloakKnown = DwmGetWindowAttribute(window, 14, out int cloaked, 4) == 0;
                if (cloakKnown && cloaked != 0 && !diagnostic) return true;
                // Exclude desktop/taskbar classes, while retaining Explorer application windows.
                var className = new StringBuilder(128);
                if (GetClassNameW(window, className, className.Capacity) == 0) { unknown = true; return true; }
                if (className.ToString() is "Progman" or "WorkerW" or "Shell_TrayWnd" or "Shell_SecondaryTrayWnd") return true;
                bool boundsKnown = DwmGetWindowAttribute(window, 9, out Rect rect, (uint)Marshal.SizeOf<Rect>()) == 0;
                bool maximized = IsZoomed(window);
                bool caption = (GetWindowStyle(window, -16).ToInt64() & 0x00C00000) == 0x00C00000;
                string status = DisplayPolicy.Classify(cloakKnown, cloaked, boundsKnown, rect, monitorRect, maximized, caption);
                if (status == "unknown") unknown = true;
                if (status == "fullscreen") fullscreen = true;
                if (diagnostic && boundsKnown && rect.Left <= x + 2 && rect.Top <= y + 2 && rect.Right >= x + width - 2 && rect.Bottom >= y + height - 2)
                {
                    covering++;
                    if (maximized && caption && cloaked == 0) maximizedCovering++;
                    if (cloakKnown && cloaked != 0) cloakedCovering++;
                }
                return true;
            }, 0);
            if (diagnostic) return new { known = enumerated && !unknown, fullscreen, covering, maximizedCovering, cloakedCovering };
            return new { known = enumerated && !unknown, fullscreen };
        }
        catch { return new { known = false, fullscreen = true }; }
    }
    public void Dispose() { Stop(); GC.KeepAlive(mouseCallback); GC.KeepAlive(keyCallback); GC.KeepAlive(eventCallback); }
}

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
                                case "queryDisplayContext": Emit(new { type = "displayContext", requestId, result = fixture && !realDisplay ? new { known = true, fullscreen = false } : Observer.DisplayContext(command.GetProperty("monitor")) }); break;
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
