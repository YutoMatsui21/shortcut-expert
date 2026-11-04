// Disposable, user-operated test. No browser content or external window titles are saved.
// Taskbar AutomationIds are used transiently to find this executable's own button.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Forms;

class TaskbarProbe
{
    [StructLayout(LayoutKind.Sequential)]
    struct Point
    {
        public int x,
            y;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct MouseData
    {
        public Point point;
        public uint data,
            flags,
            time;
        public UIntPtr extra;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct KeyData
    {
        public uint key,
            scan,
            flags,
            time;
        public UIntPtr extra;
    }

    delegate void EventProc(IntPtr h, uint e, IntPtr w, int obj, int child, uint thread, uint time);
    delegate IntPtr InputProc(int code, IntPtr w, IntPtr l);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr FindWindowW(string cls, string name);

    [DllImport("user32.dll")]
    static extern IntPtr WindowFromPoint(Point point);

    [DllImport("user32.dll")]
    static extern IntPtr GetAncestor(IntPtr w, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetClassNameW(IntPtr w, System.Text.StringBuilder text, int max);

    [DllImport("user32.dll")]
    static extern short GetAsyncKeyState(int key);

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetWinEventHook(
        uint min,
        uint max,
        IntPtr module,
        EventProc cb,
        uint pid,
        uint tid,
        uint flags
    );

    [DllImport("user32.dll")]
    static extern bool UnhookWinEvent(IntPtr h);

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetWindowsHookExW(int type, InputProc cb, IntPtr module, uint tid);

    [DllImport("user32.dll")]
    static extern bool UnhookWindowsHookEx(IntPtr h);

    [DllImport("user32.dll")]
    static extern IntPtr CallNextHookEx(IntPtr h, int c, IntPtr w, IntPtr l);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr GetModuleHandleW(string name);

    class ButtonInfo
    {
        public System.Windows.Rect Bounds;
        public bool Own;
    }

    class Snapshot
    {
        public int Slot = -1,
            Matches,
            AppButtons;
        public System.Windows.Rect OwnBounds;
        public string Error = "none";
    }

    static Form form;
    static Label hint;
    static TextBox trace;
    static ComboBox expected;
    static Snapshot snapshot = new Snapshot();
    static bool closing,
        refreshing;
    static long snapshotAt = -100000,
        inputAt = -100000;
    static string inputKind = "unknown",
        inputExpected = "unspecified";
    static bool injected;
    static Stopwatch clock = Stopwatch.StartNew();
    static List<string> evidence = new List<string>();
    static IntPtr foregroundHook,
        mouseHook,
        keyHook;
    static EventProc eventCallback = Foreground;
    static InputProc mouseCallback = Mouse,
        keyCallback = Key;
    static string sessionId = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-fff");

    static void Log(string record)
    {
        evidence.Add(record);
        trace.AppendText(record + Environment.NewLine);
    }

    static Snapshot InspectOwnTaskbarButton()
    {
        Snapshot result = new Snapshot();
        IntPtr bar = FindWindowW("Shell_TrayWnd", null);
        if (bar == IntPtr.Zero)
        {
            result.Error = "primary-taskbar-not-found";
            return result;
        }
        AutomationElement root = AutomationElement.FromHandle(bar);
        AutomationElementCollection buttons = root.FindAll(
            TreeScope.Descendants,
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Button)
        );
        List<ButtonInfo> apps = new List<ButtonInfo>();
        foreach (AutomationElement button in buttons)
        {
            string id = button.Current.AutomationId;
            string cls = button.Current.ClassName;
            if (
                id.IndexOf("Appid:", StringComparison.OrdinalIgnoreCase) < 0
                && cls.IndexOf("TaskListButton", StringComparison.OrdinalIgnoreCase) < 0
            )
                continue;
            System.Windows.Rect rect = button.Current.BoundingRectangle;
            if (rect.IsEmpty || rect.Width <= 0 || rect.Height <= 0 || button.Current.IsOffscreen)
                continue;
            // No names/titles are queried. If own ID cannot be found, report unknown.
            apps.Add(
                new ButtonInfo
                {
                    Bounds = rect,
                    Own = id.IndexOf("TaskbarProbe", StringComparison.OrdinalIgnoreCase) >= 0,
                }
            );
        }
        bool horizontal =
            root.Current.BoundingRectangle.Width >= root.Current.BoundingRectangle.Height;
        apps.Sort(
            delegate(ButtonInfo a, ButtonInfo b)
            {
                return horizontal
                    ? a.Bounds.Left.CompareTo(b.Bounds.Left)
                    : a.Bounds.Top.CompareTo(b.Bounds.Top);
            }
        );
        result.AppButtons = apps.Count;
        for (int i = 0; i < apps.Count; i++)
            if (apps[i].Own)
            {
                result.Matches++;
                result.Slot = i + 1;
                result.OwnBounds = apps[i].Bounds;
            }
        if (result.Matches != 1 || result.Slot < 1 || result.Slot > 10)
            result.Slot = -1;
        return result;
    }

    static void RefreshSnapshot()
    {
        if (refreshing || closing)
            return;
        refreshing = true;
        Thread worker = new Thread(
            delegate()
            {
                Snapshot result;
                try
                {
                    result = InspectOwnTaskbarButton();
                }
                catch (Exception error)
                {
                    result = new Snapshot { Error = error.GetType().Name };
                }
                if (closing)
                    return;
                try
                {
                    form.BeginInvoke(
                        (Action)
                            delegate
                            {
                                refreshing = false;
                                snapshot = result;
                                snapshotAt = clock.ElapsedMilliseconds;
                                string key = result.Slot == 10 ? "0" : result.Slot.ToString();
                                hint.Text =
                                    result.Slot > 0
                                        ? "候補は Win+"
                                            + key
                                            + "。実際に同じ窓へ戻れるか本人が確認します。\n試験中はタスクバーの並びを変更しないでください。"
                                        : "この環境では自分のタスクバーボタン／順位を確認できませんでした。下のログを残して終了してください。";
                                Log(
                                    "{\"kind\":\"taskbar-snapshot\",\"appButtons\":"
                                        + result.AppButtons
                                        + ",\"ownMatches\":"
                                        + result.Matches
                                        + ",\"slotCandidate\":"
                                        + result.Slot
                                        + ",\"error\":\""
                                        + result.Error
                                        + "\",\"keyMappingValidated\":false}"
                                );
                            }
                    );
                }
                catch (InvalidOperationException) { }
            }
        );
        worker.IsBackground = true;
        worker.SetApartmentState(ApartmentState.MTA);
        worker.Start();
    }

    static bool CacheReady()
    {
        return snapshot.Slot > 0 && clock.ElapsedMilliseconds - snapshotAt <= 30000;
    }

    static IntPtr Mouse(int c, IntPtr w, IntPtr l)
    {
        if (c >= 0 && w.ToInt64() == 0x201 && CacheReady())
        {
            MouseData d = (MouseData)Marshal.PtrToStructure(l, typeof(MouseData));
            System.Text.StringBuilder cls = new System.Text.StringBuilder(80);
            GetClassNameW(GetAncestor(WindowFromPoint(d.point), 2), cls, cls.Capacity);
            bool taskbar =
                cls.ToString() == "Shell_TrayWnd" || cls.ToString() == "Shell_SecondaryTrayWnd";
            if (taskbar && snapshot.OwnBounds.Contains(d.point.x, d.point.y))
            {
                inputAt = clock.ElapsedMilliseconds;
                inputKind = "taskbar-mouse";
                injected = (d.flags & 1) != 0;
                inputExpected = Convert.ToString(expected.SelectedItem);
            }
        }
        return CallNextHookEx(IntPtr.Zero, c, w, l);
    }

    static IntPtr Key(int c, IntPtr w, IntPtr l)
    {
        if (c >= 0 && (w.ToInt64() == 0x100 || w.ToInt64() == 0x104) && CacheReady())
        {
            KeyData d = (KeyData)Marshal.PtrToStructure(l, typeof(KeyData));
            uint digit = snapshot.Slot == 10 ? 0x30u : (uint)(0x30 + snapshot.Slot);
            bool win = GetAsyncKeyState(0x5B) < 0 || GetAsyncKeyState(0x5C) < 0;
            if (
                d.key == digit
                && win
                && GetAsyncKeyState(0x10) >= 0
                && GetAsyncKeyState(0x11) >= 0
                && GetAsyncKeyState(0x12) >= 0
            )
            {
                inputAt = clock.ElapsedMilliseconds;
                inputKind = "key";
                injected = (d.flags & 0x10) != 0;
                inputExpected = Convert.ToString(expected.SelectedItem);
            }
        }
        return CallNextHookEx(IntPtr.Zero, c, w, l);
    }

    static void Foreground(IntPtr h, uint e, IntPtr w, int obj, int child, uint thread, uint time)
    {
        if (closing || e != 3 || w != form.Handle || obj != 0 || child != 0)
            return;
        long age = clock.ElapsedMilliseconds - inputAt;
        string candidate = age >= 0 && age <= 1000 && !injected ? inputKind : "unknown";
        Log(
            "{\"kind\":\"own-window-activated\",\"expectedLabel\":\""
                + inputExpected
                + "\",\"originCandidate\":\""
                + candidate
                + "\",\"slotCandidate\":"
                + snapshot.Slot
                + ",\"inputAgeMs\":"
                + (candidate == "unknown" ? -1 : age)
                + ",\"actualTargetMatched\":true,\"causalityConfirmed\":false}"
        );
        inputAt = -100000;
    }

    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        form = new Form();
        form.Text = "OSS Taskbar Probe";
        form.Width = 850;
        form.Height = 610;
        hint = new Label();
        hint.Left = 12;
        hint.Top = 12;
        hint.Width = 800;
        hint.Height = 65;
        hint.Text =
            "自分のタスクバーボタンを調べます。ブラウザの中身・他アプリのタイトルは読みません。";
        form.Controls.Add(hint);
        expected = new ComboBox();
        expected.Left = 12;
        expected.Top = 85;
        expected.Width = 400;
        expected.DropDownStyle = ComboBoxStyle.DropDownList;
        expected.Items.AddRange(new object[] { "mouse-switch", "key-switch", "unspecified" });
        expected.SelectedIndex = 0;
        form.Controls.Add(expected);
        Button refresh = new Button();
        refresh.Text = "候補を再取得（取得後30秒以内に試す）";
        refresh.Left = 12;
        refresh.Top = 125;
        refresh.Width = 500;
        refresh.Height = 35;
        refresh.Click += delegate
        {
            RefreshSnapshot();
        };
        form.Controls.Add(refresh);
        Label help = new Label();
        help.Left = 12;
        help.Top = 170;
        help.Width = 800;
        help.Height = 65;
        help.Text =
            "mouse-switch：他の窓へ切り替え、このアプリ自身のタスクバーボタンをクリック。\nkey-switch：ラベルを変えて他の窓へ切り替え、上に出たWin+数字でこの窓へ戻る。\nUIAの順位は候補です。結果で対応を確かめます。終わったら×でログ保存。";
        form.Controls.Add(help);
        trace = new TextBox();
        trace.Left = 12;
        trace.Top = 245;
        trace.Width = 800;
        trace.Height = 310;
        trace.Multiline = true;
        trace.ReadOnly = true;
        trace.ScrollBars = ScrollBars.Both;
        form.Controls.Add(trace);
        form.Shown += delegate
        {
            uint pid = (uint)Process.GetCurrentProcess().Id;
            foregroundHook = SetWinEventHook(3, 3, IntPtr.Zero, eventCallback, pid, 0, 0);
            mouseHook = SetWindowsHookExW(14, mouseCallback, GetModuleHandleW(null), 0);
            keyHook = SetWindowsHookExW(13, keyCallback, GetModuleHandleW(null), 0);
            Log(
                "{\"kind\":\"session\",\"foregroundHook\":"
                    + (foregroundHook != IntPtr.Zero ? "true" : "false")
                    + ",\"mouseHook\":"
                    + (mouseHook != IntPtr.Zero ? "true" : "false")
                    + ",\"keyHook\":"
                    + (keyHook != IntPtr.Zero ? "true" : "false")
                    + "}"
            );
            RefreshSnapshot();
        };
        form.FormClosed += delegate
        {
            closing = true;
            if (foregroundHook != IntPtr.Zero)
                UnhookWinEvent(foregroundHook);
            if (mouseHook != IntPtr.Zero)
                UnhookWindowsHookEx(mouseHook);
            if (keyHook != IntPtr.Zero)
                UnhookWindowsHookEx(keyHook);
            string dir = AppDomain.CurrentDomain.BaseDirectory;
            File.WriteAllLines(
                Path.Combine(dir, "taskbar-observations-" + sessionId + ".jsonl"),
                evidence.ToArray(),
                new System.Text.UTF8Encoding(false)
            );
            File.WriteAllLines(
                Path.Combine(dir, "taskbar-observations.jsonl"),
                evidence.ToArray(),
                new System.Text.UTF8Encoding(false)
            );
        };
        Application.Run(form);
        GC.KeepAlive(eventCallback);
        GC.KeepAlive(mouseCallback);
        GC.KeepAlive(keyCallback);
    }
}
