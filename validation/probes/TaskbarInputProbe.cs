// Research only. UIA identities/rectangles stay in memory; only trial summaries are saved.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

class TaskbarInputProbe
{
    [StructLayout(LayoutKind.Sequential)]
    public struct Point
    {
        public int X,
            Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MouseData
    {
        public Point Point;
        public uint Data,
            Flags,
            Time;
        public UIntPtr Extra;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct KeyData
    {
        public uint Key,
            Scan,
            Flags,
            Time;
        public UIntPtr Extra;
    }

    delegate IntPtr Hook(int code, IntPtr message, IntPtr data);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr FindWindowW(string cls, string name);

    [DllImport("user32.dll")]
    static extern IntPtr WindowFromPhysicalPoint(Point point);

    [DllImport("user32.dll")]
    static extern bool SetProcessDpiAwarenessContext(IntPtr context);

    [DllImport("user32.dll")]
    static extern IntPtr GetThreadDpiAwarenessContext();

    [DllImport("user32.dll")]
    static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetClassNameW(IntPtr window, System.Text.StringBuilder name, int count);

    [DllImport("user32.dll")]
    static extern IntPtr GetAncestor(IntPtr window, uint flags);

    [DllImport("user32.dll")]
    static extern short GetAsyncKeyState(int key);

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetWindowsHookExW(int id, Hook callback, IntPtr module, uint thread);

    [DllImport("user32.dll")]
    static extern bool UnhookWindowsHookEx(IntPtr hook);

    [DllImport("user32.dll")]
    static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr GetModuleHandleW(string name);

    public class Item
    {
        public string Id;
        public double X,
            Y,
            W,
            H;
    }

    public class Snapshot
    {
        public string Error = "none";
        public bool Secondary;
        public double X,
            Y,
            W,
            H;
        public List<Item> Items = new List<Item>();
    }

    // Only Win/modifier/digit state is retained, never text or arbitrary key sequences.
    class KeyState
    {
        readonly HashSet<uint> held = new HashSet<uint>(),
            synthetic = new HashSet<uint>();
        bool tainted;

        public int Step(uint key, bool down, bool injected)
        {
            bool relevant =
                key == 0x5b
                || key == 0x5c
                || (key >= 0x30 && key <= 0x39)
                || key == 0x10
                || key == 0x11
                || key == 0x12
                || (key >= 0xa0 && key <= 0xa5);
            if (!relevant)
                return 0;
            if (injected)
            {
                tainted = true;
                if (down)
                    synthetic.Add(key);
                else
                    synthetic.Remove(key);
                if (held.Count == 0 && synthetic.Count == 0)
                    tainted = false;
                return 0;
            }
            bool repeat = held.Contains(key);
            if (down)
                held.Add(key);
            else
                held.Remove(key);
            bool modifiers = false;
            foreach (uint value in held)
                if (
                    value == 0x10
                    || value == 0x11
                    || value == 0x12
                    || (value >= 0xa0 && value <= 0xa5)
                )
                    modifiers = true;
            int slot =
                down
                && !repeat
                && !tainted
                && !modifiers
                && (held.Contains(0x5b) || held.Contains(0x5c))
                && key >= 0x30
                && key <= 0x39
                    ? (key == 0x30 ? 10 : (int)key - 0x30)
                    : 0;
            if (held.Count == 0 && synthetic.Count == 0)
                tainted = false;
            return slot;
        }
    }

    static JavaScriptSerializer json = new JavaScriptSerializer();

    static Snapshot Inspect()
    {
        Snapshot result = new Snapshot();
        result.Secondary = FindWindowW("Shell_SecondaryTrayWnd", null) != IntPtr.Zero;
        IntPtr bar = FindWindowW("Shell_TrayWnd", null);
        if (bar == IntPtr.Zero)
        {
            result.Error = "primary-taskbar-missing";
            return result;
        }
        AutomationElement root = AutomationElement.FromHandle(bar);
        System.Windows.Rect bounds = root.Current.BoundingRectangle;
        if (bounds.IsEmpty || bounds.Width <= bounds.Height)
        {
            result.Error = "unsupported-geometry";
            return result;
        }
        result.X = bounds.X;
        result.Y = bounds.Y;
        result.W = bounds.Width;
        result.H = bounds.Height;
        AutomationElementCollection buttons = root.FindAll(
            TreeScope.Descendants,
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button)
        );
        HashSet<string> ids = new HashSet<string>();
        foreach (AutomationElement button in buttons)
        {
            string id = button.Current.AutomationId,
                cls = button.Current.ClassName;
            // Shell implementation detail, not a documented stable Windows contract.
            if (
                id.IndexOf("Overflow", StringComparison.OrdinalIgnoreCase) >= 0
                && !button.Current.IsOffscreen
            )
                result.Error = "overflow-unknown";
            bool app =
                id.StartsWith("Appid:", StringComparison.OrdinalIgnoreCase)
                && cls.IndexOf("TaskListButton", StringComparison.OrdinalIgnoreCase) >= 0;
            if (!app)
            {
                if (
                    id.StartsWith("Appid:", StringComparison.OrdinalIgnoreCase)
                    || cls.IndexOf("TaskListButton", StringComparison.OrdinalIgnoreCase) >= 0
                )
                    result.Error = "unclassified-app-button";
                continue;
            }
            System.Windows.Rect rect = button.Current.BoundingRectangle;
            if (
                rect.IsEmpty
                || rect.Width <= 0
                || rect.Height <= 0
                || button.Current.IsOffscreen
                || !bounds.Contains(rect)
            )
            {
                result.Error = "hidden-app-unknown";
                continue;
            }
            if (!ids.Add(id))
                result.Error = "duplicate-identity";
            result.Items.Add(
                new Item
                {
                    Id = id,
                    X = rect.X,
                    Y = rect.Y,
                    W = rect.Width,
                    H = rect.Height,
                }
            );
        }
        result.Items.Sort(
            delegate(Item a, Item b)
            {
                return a.X.CompareTo(b.X);
            }
        );
        for (int i = 1; i < result.Items.Count; i++)
            if (result.Items[i - 1].X + result.Items[i - 1].W > result.Items[i].X)
                result.Error = "overlapping-buttons";
        if (result.Items.Count == 0 && result.Error == "none")
            result.Error = "no-app-buttons";
        return result;
    }

    static Process queryWorker;
    static readonly object workerLock = new object();

    static void StopWorker()
    {
        lock (workerLock)
        {
            if (queryWorker == null)
                return;
            try
            {
                if (!queryWorker.HasExited)
                    queryWorker.Kill();
            }
            catch { }
            queryWorker.Dispose();
            queryWorker = null;
        }
    }

    static Snapshot Query(string request = "snapshot")
    {
        // A stuck provider cannot block the hook message pump or outlive the query timeout.
        try
        {
            Process worker;
            lock (workerLock)
            {
                if (closing)
                    return new Snapshot { Error = "closing" };
                if (queryWorker == null || queryWorker.HasExited)
                {
                    if (queryWorker != null)
                        queryWorker.Dispose();
                    queryWorker = new Process();
                    queryWorker.StartInfo = new ProcessStartInfo(
                        Application.ExecutablePath,
                        "--snapshot-worker " + Process.GetCurrentProcess().Id
                    )
                    {
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        RedirectStandardOutput = true,
                        RedirectStandardInput = true,
                    };
                    queryWorker.Start();
                }
                worker = queryWorker;
            }
            string output = null;
            Thread reader = new Thread(
                delegate()
                {
                    try
                    {
                        output = worker.StandardOutput.ReadLine();
                    }
                    catch { }
                }
            );
            reader.IsBackground = true;
            reader.Start();
            worker.StandardInput.WriteLine(request);
            worker.StandardInput.Flush();
            if (!reader.Join(2000))
            {
                StopWorker();
                reader.Join(1000);
                return new Snapshot { Error = "provider-timeout" };
            }
            if (output == null)
            {
                StopWorker();
                return new Snapshot { Error = "provider-failed" };
            }
            return json.Deserialize<Snapshot>(output);
        }
        catch
        {
            StopWorker();
            return new Snapshot { Error = "query-failed" };
        }
    }

    static string Fingerprint(Snapshot value)
    {
        return json.Serialize(value);
    }

    static int Hit(Snapshot value, Point point)
    {
        if (value.Error != "none")
            return 0;
        for (int i = 0; i < Math.Min(10, value.Items.Count); i++)
        {
            Item item = value.Items[i];
            if (
                point.X >= item.X
                && point.X < item.X + item.W
                && point.Y >= item.Y
                && point.Y < item.Y + item.H
            )
                return i + 1;
        }
        return 0;
    }

    static Form panel;
    static Label status;
    static ComboBox scenario;
    static NumericUpDown expected;
    static Button arm,
        finish;
    static TextBox trace;
    static string file;
    static Snapshot current;
    static string baseline;
    static long snapshotStart,
        trialStart;
    static bool busy,
        armed,
        closing,
        finishing;
    static string unknown;
    static int mouseCount,
        keyCount,
        mouseSlot,
        keySlot,
        unknownInputs,
        trial,
        primaryDowns,
        boundsDowns,
        itemDowns,
        secondaryDowns;
    static long maxQueryMs,
        maxInputSnapshotAgeMs;
    static KeyState keys;
    static bool mouseHeld;
    static int mouseDownSlot;
    static IntPtr mouseHook,
        keyHook,
        primary;
    static Hook mouseCallback = Mouse,
        keyCallback = Key;
    static Stopwatch clock = Stopwatch.StartNew();

    static void Save(object row)
    {
        string line = json.Serialize(row);
        File.AppendAllText(file, line + Environment.NewLine, new System.Text.UTF8Encoding(false));
        trace.AppendText(line + Environment.NewLine);
    }

    static void Refresh(bool arming, bool ending)
    {
        if (busy || closing)
            return;
        busy = true;
        long started = clock.ElapsedMilliseconds;
        Thread thread = new Thread(
            delegate()
            {
                Snapshot result = Query();
                try
                {
                    panel.BeginInvoke(
                        (Action)
                            delegate
                            {
                                busy = false;
                                if (closing)
                                    return;
                                current = result;
                                snapshotStart = started;
                                if (armed || finishing)
                                    maxQueryMs = Math.Max(
                                        maxQueryMs,
                                        clock.ElapsedMilliseconds - started
                                    );
                                status.Text =
                                    (armed ? "ARMED. " : "DISARMED. ")
                                    + "Primary apps: "
                                    + result.Items.Count
                                    + "; secondary: "
                                    + result.Secondary
                                    + "; "
                                    + result.Error
                                    + ". Left-to-right rank is a research candidate.";
                                if (arming)
                                {
                                    Save(
                                        new
                                        {
                                            kind = "arm-query",
                                            primaryApps = result.Items.Count,
                                            secondaryPresent = result.Secondary,
                                            error = result.Error,
                                            queryFresh = clock.ElapsedMilliseconds - started <= 750,
                                        }
                                    );
                                    BeginTrial();
                                }
                                else if (
                                    (armed || finishing)
                                    && (result.Error != "none" || Fingerprint(result) != baseline)
                                )
                                    unknown = "layout-changed-or-query-failed";
                                if (ending)
                                    EndTrial();
                                else if (finishing)
                                    Refresh(false, true);
                                else if (!armed)
                                    arm.Enabled = true;
                            }
                    );
                }
                catch (InvalidOperationException) { }
            }
        );
        thread.IsBackground = true;
        thread.Start();
    }

    static bool Neutral()
    {
        for (int key = 0x30; key <= 0x39; key++)
            if (GetAsyncKeyState(key) < 0)
                return false;
        int[] values = { 1, 2, 4, 0x10, 0x11, 0x12, 0x5b, 0x5c };
        foreach (int key in values)
            if (GetAsyncKeyState(key) < 0)
                return false;
        return true;
    }

    static void BeginTrial()
    {
        if (
            current.Error != "none"
            || clock.ElapsedMilliseconds - snapshotStart > 750
            || !Neutral()
        )
        {
            status.Text +=
                " ARM refused: query must be fresh and keys/buttons released. Retry ARM.";
            arm.Enabled = true;
            return;
        }
        keys = new KeyState();
        mouseHeld = false;
        mouseCount = keyCount = mouseSlot = keySlot = unknownInputs = 0;
        primaryDowns = boundsDowns = itemDowns = secondaryDowns = 0;
        maxQueryMs = clock.ElapsedMilliseconds - snapshotStart;
        maxInputSnapshotAgeMs = 0;
        unknown = "none";
        baseline = Fingerprint(current);
        primary = FindWindowW("Shell_TrayWnd", null);
        mouseHook = SetWindowsHookExW(14, mouseCallback, GetModuleHandleW(null), 0);
        keyHook = SetWindowsHookExW(13, keyCallback, GetModuleHandleW(null), 0);
        if (mouseHook == IntPtr.Zero || keyHook == IntPtr.Zero)
        {
            StopHooks();
            status.Text = "Hook setup failed; no trial.";
            arm.Enabled = true;
            return;
        }
        trialStart = clock.ElapsedMilliseconds;
        armed = true;
        scenario.Enabled = expected.Enabled = false;
        finish.Enabled = true;
        status.Text =
            "ARMED (30 seconds maximum). Perform the selected case, then FINISH. No foreground/result tracking.";
    }

    static bool Fresh()
    {
        return armed
            && unknown == "none"
            && current != null
            && clock.ElapsedMilliseconds - snapshotStart <= 750;
    }

    static IntPtr Mouse(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0 && armed)
        {
            long type = message.ToInt64();
            if (type == 0x201 || type == 0x202)
            {
                MouseData input = (MouseData)Marshal.PtrToStructure(data, typeof(MouseData));
                if ((input.Flags & 1) != 0)
                {
                    mouseHeld = false;
                    mouseDownSlot = 0;
                }
                else if (type == 0x201)
                {
                    if (!mouseHeld)
                    {
                        mouseHeld = true;
                        IntPtr root = GetAncestor(WindowFromPhysicalPoint(input.Point), 2);
                        bool onPrimary = root == primary;
                        bool inBounds =
                            input.Point.X >= current.X
                            && input.Point.X < current.X + current.W
                            && input.Point.Y >= current.Y
                            && input.Point.Y < current.Y + current.H;
                        if (onPrimary)
                            primaryDowns++;
                        if (onPrimary)
                            maxInputSnapshotAgeMs = Math.Max(
                                maxInputSnapshotAgeMs,
                                clock.ElapsedMilliseconds - snapshotStart
                            );
                        if (inBounds)
                            boundsDowns++;
                        int hit = Hit(current, input.Point);
                        if (hit > 0)
                            itemDowns++;
                        System.Text.StringBuilder cls = new System.Text.StringBuilder(80);
                        GetClassNameW(root, cls, cls.Capacity);
                        if (cls.ToString() == "Shell_SecondaryTrayWnd")
                        {
                            secondaryDowns++;
                            unknownInputs++;
                        }
                        if (inBounds && !onPrimary)
                            unknownInputs++;
                        mouseDownSlot = Fresh() && onPrimary ? hit : 0;
                        if (onPrimary && !Fresh())
                            unknownInputs++;
                    }
                }
                else
                {
                    if (mouseHeld && mouseDownSlot > 0 && !Fresh())
                        unknownInputs++;
                    if (
                        mouseHeld
                        && Fresh()
                        && GetAncestor(WindowFromPhysicalPoint(input.Point), 2) == primary
                        && mouseDownSlot > 0
                        && Hit(current, input.Point) == mouseDownSlot
                    )
                    {
                        mouseCount++;
                        mouseSlot = mouseDownSlot;
                    }
                    mouseHeld = false;
                    mouseDownSlot = 0;
                }
            }
        }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }

    static IntPtr Key(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0 && armed)
        {
            long type = message.ToInt64();
            if (type == 0x100 || type == 0x104 || type == 0x101 || type == 0x105)
            {
                KeyData input = (KeyData)Marshal.PtrToStructure(data, typeof(KeyData));
                int slot = keys.Step(
                    input.Key,
                    type == 0x100 || type == 0x104,
                    (input.Flags & 0x10) != 0
                );
                if (slot > 0)
                {
                    maxInputSnapshotAgeMs = Math.Max(
                        maxInputSnapshotAgeMs,
                        clock.ElapsedMilliseconds - snapshotStart
                    );
                    if (!Fresh())
                        unknownInputs++;
                    else if (slot <= current.Items.Count)
                    {
                        keyCount++;
                        keySlot = slot;
                    }
                }
            }
        }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }

    static void StopHooks()
    {
        armed = false;
        if (mouseHook != IntPtr.Zero)
            UnhookWindowsHookEx(mouseHook);
        if (keyHook != IntPtr.Zero)
            UnhookWindowsHookEx(keyHook);
        mouseHook = keyHook = IntPtr.Zero;
    }

    static void FinishTrial()
    {
        if (!armed)
            return;
        StopHooks();
        finishing = true;
        finish.Enabled = false;
        if (!busy)
            Refresh(false, true);
    }

    static void EndTrial()
    {
        if (!finishing)
            return;
        if (current.Error != "none" || Fingerprint(current) != baseline)
            unknown = "layout-changed-or-query-failed";
        if (unknownInputs > 0)
            unknown = "input-mapping-unknown";
        Save(
            new
            {
                kind = "trial",
                index = ++trial,
                scenario = Convert.ToString(scenario.SelectedItem),
                expectedSlot = (int)expected.Value,
                mouseCandidates = mouseCount,
                keyCandidates = keyCount,
                mouseSlot = mouseSlot,
                keySlot = keySlot,
                unknown = unknown,
                primaryApps = current.Items.Count,
                secondaryPresent = current.Secondary,
                primaryMouseDowns = primaryDowns,
                withinPrimaryBoundsDowns = boundsDowns,
                appBoundsDowns = itemDowns,
                secondaryMouseDowns = secondaryDowns,
                maxQueryMs = maxQueryMs,
                maxInputSnapshotAgeMs = maxInputSnapshotAgeMs,
                eventTimeMappingProven = false,
                productPass = false,
            }
        );
        finishing = false;
        scenario.Enabled = expected.Enabled = arm.Enabled = true;
        status.Text =
            "DISARMED. Review summary. No hooks active. Change case/expected slot before ARM.";
    }

    static void Check(bool value, string label)
    {
        if (!value)
            throw new Exception("Self-test: " + label);
    }

    static void SelfTest()
    {
        KeyState state = new KeyState();
        state.Step(0x5b, true, false);
        Check(state.Step(0x31, true, false) == 1, "Win+1");
        Check(state.Step(0x31, true, false) == 0, "repeat");
        state.Step(0x31, false, false);
        Check(state.Step(0x30, true, false) == 10, "Win+0");
        state = new KeyState();
        state.Step(0x5c, true, false);
        state.Step(0xa0, true, false);
        Check(state.Step(0x39, true, false) == 0, "extra modifier");
        state = new KeyState();
        state.Step(0x5b, true, true);
        Check(state.Step(0x31, true, false) == 0, "injected modifier");
        state = new KeyState();
        state.Step(0x5b, true, false);
        Check(state.Step(0x31, true, true) == 0, "injected digit");
        state = new KeyState();
        state.Step(0x5b, true, true);
        state.Step(0x31, true, true);
        state.Step(0x31, false, true);
        state.Step(0x5b, false, true);
        state.Step(0x5b, true, false);
        Check(state.Step(0x31, true, false) == 1, "recover after injected chord");
        state = new KeyState();
        Check(state.Step(0x31, true, false) == 0, "no Win");
        uint[] digits = { 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x30 };
        for (int i = 0; i < digits.Length; i++)
        {
            state = new KeyState();
            state.Step(0x5c, true, false);
            Check(state.Step(digits[i], true, false) == i + 1, "all ten slot mappings");
        }
        Snapshot value = new Snapshot();
        value.Items.Add(
            new Item
            {
                Id = "fixture",
                X = 10,
                Y = 10,
                W = 20,
                H = 20,
            }
        );
        Check(Hit(value, new Point { X = 10, Y = 10 }) == 1, "hit");
        Check(Hit(value, new Point { X = 30, Y = 10 }) == 0, "edge");
        value.Error = "overflow-unknown";
        Check(Hit(value, new Point { X = 15, Y = 15 }) == 0, "unknown layout");
        try
        {
            Check(Query("fixture-snapshot").Items.Count == 1, "worker roundtrip");
            int workerPid = queryWorker.Id;
            Check(
                Query("fixture-snapshot").Items.Count == 1 && queryWorker.Id == workerPid,
                "worker reuse"
            );
            Check(Query("fixture-delay").Error == "provider-timeout", "blocked worker timeout");
            Check(
                Query("fixture-snapshot").Items.Count == 1 && queryWorker.Id != workerPid,
                "worker restart"
            );
        }
        finally
        {
            StopWorker();
        }
        Console.WriteLine("TASKBAR_INPUT_SELF_TEST_OK (25 fixture checks; no live observation)");
    }

    [STAThread]
    static void Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--self-test")
        {
            SelfTest();
            return;
        }
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        if (GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext()) != 2)
            throw new InvalidOperationException("Per-monitor DPI awareness required");
        if (args.Length == 2 && args[0] == "--snapshot-worker")
        {
            // Independent watchdog survives a blocked UIA call and bounds orphan lifetime.
            // Holding the parent's Process handle also prevents PID reuse from extending it.
            using (Process parent = Process.GetProcessById(int.Parse(args[1])))
            {
                IntPtr parentHandle = parent.Handle;
                long activeSince = -1;
                Stopwatch lifetime = Stopwatch.StartNew();
                using (
                    System.Threading.Timer watchdog = new System.Threading.Timer(
                        delegate(object unused)
                        {
                            try
                            {
                                long start = Interlocked.Read(ref activeSince);
                                if (
                                    parent.HasExited
                                    || (start >= 0 && lifetime.ElapsedMilliseconds - start >= 2500)
                                )
                                    Environment.Exit(3);
                            }
                            catch
                            {
                                Environment.Exit(3);
                            }
                        },
                        null,
                        100,
                        100
                    )
                )
                {
                    string request;
                    while ((request = Console.ReadLine()) != null)
                    {
                        Interlocked.Exchange(ref activeSince, lifetime.ElapsedMilliseconds);
                        Snapshot result;
                        if (request == "fixture-delay")
                        {
                            Thread.Sleep(Timeout.Infinite);
                            return;
                        }
                        if (request == "fixture-snapshot")
                        {
                            result = new Snapshot();
                            result.Items.Add(
                                new Item
                                {
                                    Id = "fixture",
                                    X = 10,
                                    Y = 10,
                                    W = 20,
                                    H = 20,
                                }
                            );
                        }
                        else if (request == "snapshot")
                        {
                            try
                            {
                                result = Inspect();
                            }
                            catch
                            {
                                result = new Snapshot { Error = "uia-failed" };
                            }
                        }
                        else
                            return;
                        Console.WriteLine(json.Serialize(result));
                        Console.Out.Flush();
                        Interlocked.Exchange(ref activeSince, -1);
                    }
                }
                GC.KeepAlive(parentHandle);
            }
            return;
        }
        if (args.Length != 2 || args[0] != "--observe-consented")
            throw new ArgumentException("Explicit consent required");
        file = args[1];
        Application.EnableVisualStyles();
        panel = new Form
        {
            Text = "W12 Taskbar Input Research — manual ARM",
            Width = 900,
            Height = 540,
        };
        status = new Label
        {
            Left = 12,
            Top = 10,
            Width = 850,
            Height = 60,
            Text =
                "DISARMED. No hooks active. Select case and expected app number (0 = exclusion).",
        };
        scenario = new ComboBox
        {
            Left = 12,
            Top = 80,
            Width = 340,
            DropDownStyle = ComboBoxStyle.DropDownList,
        };
        scenario.Items.AddRange(
            new object[]
            {
                "mouse-app",
                "key-app",
                "key-zero",
                "key-repeat",
                "key-extra-modifier",
                "key-absent",
                "non-app",
                "thumbnail",
                "reorder",
                "pin-unpin",
                "launch-exit",
                "overflow",
                "secondary-taskbar",
            }
        );
        scenario.SelectedIndex = 0;
        expected = new NumericUpDown
        {
            Left = 370,
            Top = 80,
            Minimum = 0,
            Maximum = 10,
            Value = 1,
        };
        arm = new Button
        {
            Left = 12,
            Top = 120,
            Width = 220,
            Height = 40,
            Text = "ARM (fresh UIA query)",
        };
        finish = new Button
        {
            Left = 250,
            Top = 120,
            Width = 220,
            Height = 40,
            Text = "FINISH / disarm",
            Enabled = false,
        };
        trace = new TextBox
        {
            Left = 12,
            Top = 180,
            Width = 850,
            Height = 300,
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Both,
        };
        panel.Controls.AddRange(new Control[] { status, scenario, expected, arm, finish, trace });
        arm.Click += delegate
        {
            arm.Enabled = false;
            Refresh(true, false);
        };
        finish.Click += delegate
        {
            FinishTrial();
        };
        System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 250 };
        timer.Tick += delegate
        {
            if (armed && clock.ElapsedMilliseconds - trialStart >= 30000)
                FinishTrial();
            else if (armed && !busy)
                Refresh(false, false);
        };
        timer.Start();
        panel.FormClosing += delegate
        {
            StopHooks();
            closing = true;
            timer.Stop();
            StopWorker();
        };
        panel.FormClosed += delegate
        {
            Save(
                new
                {
                    kind = "session-end",
                    completedTrials = trial,
                    unfinishedTrialDiscarded = finishing || !arm.Enabled,
                }
            );
        };
        Application.Run(panel);
        GC.KeepAlive(mouseCallback);
        GC.KeepAlive(keyCallback);
    }
}
