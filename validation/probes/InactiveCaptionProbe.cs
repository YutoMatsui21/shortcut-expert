// Issue #152: consented, bounded event-order research. No product IPC or storage.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;

class InactiveCaptionProbe
{
    [StructLayout(LayoutKind.Sequential)]
    struct Point
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

    delegate IntPtr Hook(int code, IntPtr message, IntPtr data);
    delegate void EventHook(
        IntPtr hook,
        uint type,
        IntPtr window,
        int obj,
        int child,
        uint thread,
        uint time
    );

    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    static extern IntPtr WindowFromPhysicalPoint(Point p);

    [DllImport("user32.dll")]
    static extern IntPtr GetAncestor(IntPtr w, uint flags);

    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr w, out uint process);

    [DllImport("user32.dll")]
    static extern bool IsIconic(IntPtr w);

    [DllImport("user32.dll")]
    static extern bool IsZoomed(IntPtr w);

    [DllImport("user32.dll")]
    static extern bool IsWindow(IntPtr w);

    [DllImport("user32.dll")]
    static extern int GetWindowLongW(IntPtr w, int index);

    [DllImport("user32.dll")]
    static extern bool UnhookWindowsHookEx(IntPtr hook);

    [DllImport("user32.dll")]
    static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr SetWindowsHookExW(int id, Hook callback, IntPtr module, uint thread);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr GetModuleHandleW(string name);

    [DllImport("user32.dll")]
    static extern IntPtr SetWinEventHook(
        uint first,
        uint last,
        IntPtr module,
        EventHook callback,
        uint process,
        uint thread,
        uint flags
    );

    [DllImport("user32.dll")]
    static extern bool UnhookWinEvent(IntPtr hook);

    [DllImport("user32.dll")]
    static extern bool SetProcessDpiAwarenessContext(IntPtr context);

    static readonly List<string> order = new List<string>();
    static readonly Stopwatch clock = Stopwatch.StartNew();
    static readonly Hook mouseCallback = Mouse;
    static readonly EventHook eventCallback = Event;
    static readonly List<IntPtr> eventHooks = new List<IntPtr>();
    static Form panel;
    static Label status;
    static Button arm,
        finish;
    static ComboBox scenario;
    static IntPtr mouseHook,
        target,
        sampledForeground,
        armedForeground;
    static uint process;
    static string file,
        before,
        lastState,
        caseName;
    static long armAt,
        startAt,
        releaseAt;
    static bool pending,
        observing,
        clicked,
        released,
        inactive,
        caption,
        overflow,
        sampledInactive,
        armedInactive;
    static int trials;

    static string State(IntPtr w)
    {
        return !IsWindow(w) ? "unavailable"
            : IsIconic(w) ? "minimized"
            : IsZoomed(w) ? "maximized"
            : "normal";
    }

    static void Add(string value)
    {
        if (order.Count < 64)
            order.Add(value);
        else
            overflow = true;
    }

    static string Delay(long ms)
    {
        return ms < 0 ? "unavailable"
            : ms <= 50 ? "0-50ms"
            : ms <= 100 ? "51-100ms"
            : ms <= 250 ? "101-250ms"
            : ms <= 500 ? "251-500ms"
            : ms <= 1000 ? "501-1000ms"
            : "over-1000ms";
    }

    static void Stop()
    {
        observing = pending = false;
        if (mouseHook != IntPtr.Zero)
            UnhookWindowsHookEx(mouseHook);
        mouseHook = IntPtr.Zero;
        foreach (IntPtr h in eventHooks)
            UnhookWinEvent(h);
        eventHooks.Clear();
    }

    static void Start()
    {
        pending = false;
        order.Clear();
        target = IntPtr.Zero;
        clicked = released = overflow = false;
        releaseAt = -1;
        mouseHook = SetWindowsHookExW(14, mouseCallback, GetModuleHandleW(null), 0);
        foreach (uint type in new uint[] { 3, 0x16, 0x17, 0x800b })
        {
            IntPtr h = SetWinEventHook(type, type, IntPtr.Zero, eventCallback, 0, 0, 0);
            if (h == IntPtr.Zero)
            {
                Stop();
                status.Text = "Hook failed. No trial recorded.";
                arm.Enabled = scenario.Enabled = true;
                return;
            }
            eventHooks.Add(h);
        }
        if (mouseHook == IntPtr.Zero)
        {
            Stop();
            status.Text = "Mouse hook failed.";
            arm.Enabled = scenario.Enabled = true;
            return;
        }
        observing = true;
        startAt = clock.ElapsedMilliseconds;
        sampledForeground = armedForeground = GetForegroundWindow();
        status.Text = "ARMED: click one background window button. Auto stop in 20 seconds.";
    }

    static IntPtr Mouse(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0 && observing)
        {
            long msg = message.ToInt64();
            if (msg == 0x201 || msg == 0x202)
            {
                MouseData m = (MouseData)Marshal.PtrToStructure(data, typeof(MouseData));
                if ((m.Flags & 3) != 0)
                {
                    Add("injected-click-rejected");
                    Finish("injected");
                }
                else if (msg == 0x201)
                {
                    if (clicked)
                    {
                        Add("extra-click");
                        Finish("competing-input");
                    }
                    else
                    {
                        target = GetAncestor(WindowFromPhysicalPoint(m.Point), 2);
                        if (target == IntPtr.Zero || target == panel.Handle)
                        {
                            Finish("invalid-target");
                        }
                        else
                        {
                            clicked = true;
                            startAt = clock.ElapsedMilliseconds;
                            GetWindowThreadProcessId(target, out process);
                            inactive = GetForegroundWindow() != target;
                            sampledInactive = sampledForeground != target;
                            armedInactive = armedForeground != target;
                            caption = (GetWindowLongW(target, -16) & 0x00c00000) == 0x00c00000;
                            before = lastState = State(target);
                            Add("mouse-down");
                        }
                    }
                }
                else if (clicked)
                {
                    released = true;
                    releaseAt = clock.ElapsedMilliseconds;
                    Add("mouse-up");
                }
            }
        }
        return CallNextHookEx(mouseHook, code, message, data);
    }

    static void Event(IntPtr hook, uint type, IntPtr w, int obj, int child, uint thread, uint time)
    {
        if (!observing || !clicked)
            return;
        if (type == 3)
            Add(w == target ? "foreground-target" : "foreground-other");
        else if (w == target && obj == 0 && child == 0)
            Add(
                type == 0x16 ? "minimize-start-target"
                : type == 0x17 ? "minimize-end-target"
                : "location-target"
            );
        Sample();
    }

    static void Sample()
    {
        if (!clicked)
            return;
        string state = State(target);
        if (state != lastState)
        {
            Add("state-" + state);
            lastState = state;
        }
    }

    static void Finish(string reason)
    {
        if (!observing)
            return;
        Sample();
        uint currentProcess = 0;
        if (clicked)
            GetWindowThreadProcessId(target, out currentProcess);
        var row = new
        {
            kind = "trial",
            index = ++trials,
            scenario = caseName,
            stop = reason,
            clicked,
            released,
            inactiveAtPress = clicked && inactive,
            inactiveAtPreviousTimerSample = clicked && sampledInactive,
            inactiveAtArm = clicked && armedInactive,
            hasCaption = clicked && caption,
            sameProcess = clicked && process != 0 && process == currentProcess,
            before = clicked ? before : "unknown",
            after = clicked ? lastState : "unknown",
            finalForegroundTarget = clicked && GetForegroundWindow() == target,
            releaseDelay = clicked && released ? Delay(releaseAt - startAt) : "unavailable",
            overflow,
            events = order.ToArray(),
            productPass = false,
        };
        Stop();
        target = IntPtr.Zero;
        process = 0;
        string json = new JavaScriptSerializer().Serialize(row);
        File.AppendAllText(file, json + Environment.NewLine);
        Console.WriteLine(json);
        arm.Enabled = scenario.Enabled = true;
        finish.Enabled = false;
        status.Text = "FINISH: hooks stopped. Result saved. Select next case and ARM.";
    }

    [STAThread]
    static void Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--self-test")
        {
            if (Delay(50) != "0-50ms" || Delay(51) != "51-100ms" || Delay(501) != "501-1000ms")
                throw new Exception("Delay boundary");
            order.Clear();
            for (int i = 0; i < 65; i++)
                Add("mouse-down");
            if (order.Count != 64 || !overflow)
                throw new Exception("Bounded trace");
            Console.WriteLine("INACTIVE_CAPTION_SELF_TEST_OK");
            return;
        }
        if (args.Length != 2 || args[0] != "--observe-consented")
            throw new Exception("Explicit consent required");
        file = args[1];
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        Application.EnableVisualStyles();
        panel = new Form
        {
            Text = "Issue 152 - consented caption click probe",
            Size = new Size(760, 220),
            TopMost = true,
        };
        scenario = new ComboBox
        {
            Left = 12,
            Top = 12,
            Width = 460,
            DropDownStyle = ComboBoxStyle.DropDownList,
        };
        scenario.Items.AddRange(
            new object[]
            {
                "Chrome-normal-maximize",
                "Chrome-normal-minimize",
                "Chrome-maximized-minimize",
                "ChatGPT-normal-maximize",
                "ChatGPT-normal-minimize",
                "ChatGPT-maximized-minimize",
                "Obsidian-normal-maximize",
                "Obsidian-normal-minimize",
                "Obsidian-maximized-minimize",
                "control-active-maximize",
                "control-background-body",
            }
        );
        scenario.SelectedIndex = 0;
        arm = new Button
        {
            Text = "ARM (5 sec)",
            Left = 490,
            Top = 12,
            Width = 110,
        };
        finish = new Button
        {
            Text = "FINISH",
            Left = 610,
            Top = 12,
            Width = 100,
            Enabled = false,
        };
        status = new Label
        {
            Left = 12,
            Top = 60,
            Width = 710,
            Height = 100,
            Text =
                "Select case. ARM, then focus another window within 5 seconds.\nClick the exposed target caption button after ARMED.\nAuto FINISH 2 seconds after release; 20 second limit. No titles, paths, keys or coordinates saved.",
        };
        panel.Controls.AddRange(new Control[] { scenario, arm, finish, status });
        arm.Click += delegate
        {
            caseName = scenario.SelectedItem.ToString();
            arm.Enabled = scenario.Enabled = false;
            pending = true;
            armAt = clock.ElapsedMilliseconds;
            status.Text =
                "5 seconds: focus the starting window. Wait for ARMED before the test click.";
        };
        finish.Click += delegate
        {
            Finish("manual");
        };
        panel.FormClosing += delegate
        {
            if (observing)
                Finish("closed");
            Stop();
        };
        var timer = new Timer { Interval = 20 };
        long sessionAt = clock.ElapsedMilliseconds;
        timer.Tick += delegate
        {
            if (pending && clock.ElapsedMilliseconds - armAt >= 5000)
                Start();
            if (observing)
            {
                if (!clicked)
                    sampledForeground = GetForegroundWindow();
                Sample();
                if (released && clock.ElapsedMilliseconds - releaseAt >= 2000)
                    Finish("settled");
                else if (clock.ElapsedMilliseconds - startAt >= 20000)
                    Finish("timeout");
            }
            if (clock.ElapsedMilliseconds - sessionAt >= 1200000)
                panel.Close();
        };
        timer.Start();
        Application.Run(panel);
        Stop();
    }
}
