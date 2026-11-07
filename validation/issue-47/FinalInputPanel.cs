// Operator control only: no input hooks, window enumeration, title reads, or synthesized input.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Web.Script.Serialization;
using System.Windows.Forms;

class FinalInputPanel
{
    class ToolPanel : Form
    {
        protected override CreateParams CreateParams
        {
            get
            {
                var p = base.CreateParams;
                p.ExStyle |= 0x80;
                return p;
            }
        }
    }

    static readonly JavaScriptSerializer Json = new JavaScriptSerializer
    {
        MaxJsonLength = 2000000,
    };
    static string directory,
        lastStatus;
    static int sequence;
    static object[] cases;
    static ComboBox selected,
        application,
        state,
        secondary,
        result,
        notice,
        equivalence;
    static CheckBox paused,
        stopped;
    static NumericUpDown slot;
    static Label instruction,
        status;
    static TextBox results;
    static Button arm,
        finish,
        cancel,
        next;
    static bool closing;

    static Dictionary<string, object> Current()
    {
        return (Dictionary<string, object>)cases[selected.SelectedIndex];
    }

    static void Send(string action)
    {
        var command = new
        {
            sequence = ++sequence,
            action,
            plan = new
            {
                caseId = (string)Current()["id"],
                application = (string)application.SelectedItem,
                state = (string)state.SelectedItem,
                secondaryState = (string)secondary.SelectedItem,
                paused = paused.Checked,
                stopped = stopped.Checked,
                slot = (int)slot.Value,
            },
            confirmation = new
            {
                result = (string)result.SelectedItem,
                notification = (string)notice.SelectedItem,
                equivalence = (string)equivalence.SelectedItem,
            },
        };
        string target = Path.Combine(directory, "control.json"),
            temp = Path.Combine(directory, "control-panel.tmp");
        File.WriteAllText(temp, Json.Serialize(command));
        if (File.Exists(target))
            File.Replace(temp, target, null);
        else
            File.Move(temp, target);
    }

    static ComboBox Choice(string[] values, int x, int y, int width, Form form)
    {
        var box = new ComboBox
        {
            Left = x,
            Top = y,
            Width = width,
            DropDownStyle = ComboBoxStyle.DropDownList,
        };
        box.Items.AddRange(values);
        box.SelectedIndex = 0;
        form.Controls.Add(box);
        return box;
    }

    static void WriteEnvironment()
    {
        var screens = new List<object>();
        foreach (var screen in Screen.AllScreens)
            screens.Add(
                new
                {
                    primary = screen.Primary,
                    x = screen.Bounds.X,
                    y = screen.Bounds.Y,
                    width = screen.Bounds.Width,
                    height = screen.Bounds.Height,
                    workX = screen.WorkingArea.X,
                    workY = screen.WorkingArea.Y,
                    workWidth = screen.WorkingArea.Width,
                    workHeight = screen.WorkingArea.Height,
                }
            );
        File.WriteAllText(
            Path.Combine(directory, "environment.json"),
            Json.Serialize(new { osBuild = Environment.OSVersion.Version.Build, screens = screens })
        );
    }

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length != 2 || !Directory.Exists(args[0]))
            return 2;
        directory = args[0];
        cases = (object[])Json.DeserializeObject(File.ReadAllText(args[1]));
        Application.EnableVisualStyles();
        WriteEnvironment();
        var form = new ToolPanel
        {
            Text = "#47 最終受入 - 手動 ARM / FINISH",
            Width = 820,
            Height = 750,
            ShowInTaskbar = false,
            MaximizeBox = false,
            TopMost = true,
            StartPosition = FormStartPosition.Manual,
            Location = new Point(15, 15),
        };
        form.Controls.Add(
            new Label
            {
                Left = 15,
                Top = 10,
                Width = 770,
                Height = 100,
                Text =
                    "1. IDLE中に起点のウィンドウを準備し、ケースとアプリ種別を選択。\n2. ARMを押し、4秒以内に対象ウィンドウをクリック。その後は全キーを離す。\n3. ARMEDを確認して2秒待ち、指定操作を1回だけ実施。3秒待つ。\n4. 下の実結果・Toast・キー同等性を選びFINISH。未実施はCANCEL。\n1試行45秒、session20分。閉じると観測停止。自動キー送出なし。",
            }
        );
        selected = new ComboBox
        {
            Left = 15,
            Top = 115,
            Width = 770,
            DropDownStyle = ComboBoxStyle.DropDownList,
        };
        foreach (Dictionary<string, object> c in cases)
            selected.Items.Add((string)c["id"] + " : " + (string)c["label"]);
        selected.SelectedIndex = 0;
        form.Controls.Add(selected);
        instruction = new Label
        {
            Left = 15,
            Top = 150,
            Width = 770,
            Height = 70,
        };
        form.Controls.Add(instruction);
        Action update = () =>
        {
            instruction.Text =
                (string)Current()["instruction"]
                + "\n期待: "
                + (string)Current()["origin"]
                + " / "
                + Json.Serialize(Current()["records"]);
        };
        selected.SelectedIndexChanged += (s, e) => update();
        update();
        form.Controls.Add(
            new Label
            {
                Left = 15,
                Top = 225,
                Width = 760,
                Text =
                    "アプリ種別                  主操作の学習状態           複合2件目の状態          W12番号",
            }
        );
        application = Choice(
            new[] { "standard", "chrome", "edge", "external" },
            15,
            250,
            165,
            form
        );
        state = Choice(new[] { "learning", "mastered", "excluded" }, 195, 250, 165, form);
        secondary = Choice(new[] { "learning", "mastered", "excluded" }, 375, 250, 165, form);
        slot = new NumericUpDown
        {
            Left = 555,
            Top = 250,
            Width = 70,
            Minimum = 1,
            Maximum = 10,
            Value = 1,
        };
        form.Controls.Add(slot);
        paused = new CheckBox
        {
            Text = "通知pause",
            Left = 15,
            Top = 290,
            Width = 160,
        };
        stopped = new CheckBox
        {
            Text = "全停止中の負例",
            Left = 195,
            Top = 290,
            Width = 170,
        };
        form.Controls.AddRange(new Control[] { paused, stopped });
        form.Controls.Add(
            new Label
            {
                Left = 15,
                Top = 330,
                Width = 770,
                Text =
                    "実際のウィンドウの結果               Toastの目視確認                 代替キーの結果同等性",
            }
        );
        result = Choice(new[] { "not-observed", "matched", "different" }, 15, 355, 230, form);
        notice = Choice(
            new[] { "not-seen", "matched", "different", "not-expected" },
            260,
            355,
            245,
            form
        );
        equivalence = Choice(new[] { "not-tested", "matched", "different" }, 520, 355, 265, form);
        arm = new Button
        {
            Text = "ARM (4秒準備)",
            Left = 15,
            Top = 400,
            Width = 180,
        };
        finish = new Button
        {
            Text = "FINISH 実施済み",
            Left = 210,
            Top = 400,
            Width = 180,
            Enabled = false,
        };
        cancel = new Button
        {
            Text = "CANCEL 未実施",
            Left = 405,
            Top = 400,
            Width = 180,
            Enabled = false,
        };
        next = new Button
        {
            Text = "次のケース",
            Left = 600,
            Top = 400,
            Width = 180,
        };
        form.Controls.AddRange(new Control[] { arm, finish, cancel, next });
        Control[] planning =
        {
            selected,
            application,
            state,
            secondary,
            slot,
            paused,
            stopped,
            next,
        };
        Action<bool> enable = enabled =>
        {
            foreach (Control c in planning)
                c.Enabled = enabled;
        };
        arm.Click += (s, e) =>
        {
            arm.Enabled = false;
            enable(false);
            result.SelectedIndex = notice.SelectedIndex = equivalence.SelectedIndex = 0;
            status.Text = "COUNTDOWN: 4秒以内に対象ウィンドウをclick。hooks OFF";
            Send("arm");
        };
        finish.Click += (s, e) =>
        {
            finish.Enabled = cancel.Enabled = false;
            Send("finish");
        };
        cancel.Click += (s, e) =>
        {
            finish.Enabled = cancel.Enabled = false;
            Send("cancel");
        };
        next.Click += (s, e) =>
        {
            if (selected.SelectedIndex < selected.Items.Count - 1)
                selected.SelectedIndex++;
        };
        status = new Label
        {
            Left = 15,
            Top = 445,
            Width = 770,
            Height = 40,
            Text = "Waiting for READY (観測停止中)",
        };
        form.Controls.Add(status);
        results = new TextBox
        {
            Left = 15,
            Top = 490,
            Width = 770,
            Height = 195,
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
        };
        form.Controls.Add(results);
        var timer = new Timer { Interval = 250 };
        timer.Tick += (s, e) =>
        {
            try
            {
                string text = File.ReadAllText(Path.Combine(directory, "status.json"));
                if (text == lastStatus)
                    return;
                lastStatus = text;
                var value = Json.Deserialize<Dictionary<string, object>>(text);
                string current = (string)value["state"];
                var rows = (ICollection)value["results"];
                bool error = (bool)value["error"];
                if (Convert.ToInt32(value["sequence"]) >= sequence)
                {
                    status.Text =
                        current
                        + (error ? " ERROR: 停止して報告してください" : "")
                        + " / 試行数 "
                        + rows.Count;
                    arm.Enabled = current == "IDLE" && !error;
                    enable(arm.Enabled);
                    finish.Enabled = cancel.Enabled = current == "ARMED" && !error;
                }
                results.Text = Json.Serialize(value["results"]);
                if (current == "CLOSED")
                {
                    closing = true;
                    form.Close();
                }
            }
            catch { }
        };
        form.Shown += (s, e) => timer.Start();
        form.FormClosing += (s, e) =>
        {
            timer.Stop();
            if (!closing)
                try
                {
                    Send("end");
                }
                catch { }
        };
        Application.Run(form);
        timer.Dispose();
        return 0;
    }
}
