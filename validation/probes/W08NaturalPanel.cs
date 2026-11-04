// Manual operator panel only: no hooks, synthetic input, screenshots, titles or window discovery.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Web.Script.Serialization;
using System.Windows.Forms;

class W08NaturalPanel
{
    static string directory;
    static int sequence;
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static ComboBox kind,
        application,
        state;
    static CheckBox paused;
    static Button arm,
        finish,
        cancel;
    static Label status;
    static TextBox results;
    static string lastStatus;

    static void Send(string action)
    {
        var command = new
        {
            sequence = ++sequence,
            action,
            plan = new
            {
                kind = (string)kind.SelectedItem,
                application = (string)application.SelectedItem,
                state = (string)state.SelectedItem,
                paused = paused.Checked,
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

    static ComboBox Choice(string[] values, int x, int y, Form form)
    {
        var box = new ComboBox
        {
            Left = x,
            Top = y,
            Width = 140,
            DropDownStyle = ComboBoxStyle.DropDownList,
        };
        box.Items.AddRange(values);
        box.SelectedIndex = 0;
        form.Controls.Add(box);
        return box;
    }

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length != 1 || !Directory.Exists(args[0]))
            return 2;
        directory = args[0];
        Application.EnableVisualStyles();
        var form = new Form
        {
            Text = "W08 natural input - manual trials",
            Width = 650,
            Height = 580,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            StartPosition = FormStartPosition.Manual,
            Location = new Point(20, 30),
        };
        form.Controls.Add(
            new Label
            {
                Left = 15,
                Top = 12,
                Width = 610,
                Height = 90,
                Text =
                    "1. Select mouse / key / negative, target, learning state.\n2. Release Win/Z, click ARM, wait for ARMED.\n3. Perform exactly ONE natural input on the target.\n4. Leave via the client area and click FINISH. No operation: CANCEL.\n45s timeout is INVALID. Idle: observation OFF. Close this panel to end.",
            }
        );
        kind = Choice(new[] { "mouse", "key", "negative" }, 15, 110, form);
        application = Choice(new[] { "standard", "chrome" }, 170, 110, form);
        state = Choice(new[] { "learning", "mastered", "excluded" }, 325, 110, form);
        paused = new CheckBox
        {
            Text = "Pause notices",
            Left = 480,
            Top = 112,
            Width = 140,
        };
        form.Controls.Add(paused);
        arm = new Button
        {
            Text = "ARM",
            Left = 15,
            Top = 150,
            Width = 150,
        };
        finish = new Button
        {
            Text = "FINISH (performed)",
            Left = 180,
            Top = 150,
            Width = 180,
            Enabled = false,
        };
        cancel = new Button
        {
            Text = "CANCEL",
            Left = 375,
            Top = 150,
            Width = 150,
            Enabled = false,
        };
        form.Controls.AddRange(new Control[] { arm, finish, cancel });
        arm.Click += (s, e) =>
        {
            arm.Enabled = false;
            Send("arm");
        };
        finish.Click += (s, e) =>
        {
            finish.Enabled = false;
            cancel.Enabled = false;
            Send("finish");
        };
        cancel.Click += (s, e) =>
        {
            finish.Enabled = false;
            cancel.Enabled = false;
            Send("cancel");
        };
        status = new Label
        {
            Left = 15,
            Top = 195,
            Width = 610,
            Height = 45,
            Text = "Waiting for product READY...",
        };
        form.Controls.Add(status);
        results = new TextBox
        {
            Left = 15,
            Top = 245,
            Width = 610,
            Height = 245,
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
        };
        form.Controls.Add(results);
        var target = new Form
        {
            Text = "W08 standard caption TARGET",
            Width = 700,
            Height = 440,
            StartPosition = FormStartPosition.Manual,
            Location = new Point(700, 160),
        };
        target.Controls.Add(
            new Label
            {
                Dock = DockStyle.Fill,
                Text =
                    "STANDARD TARGET\n\nMouse: hover over the square maximize button (left of X) for 1 second.\nKey: focus this window, press Win+Z once and release.\n\nDo not click maximize during a positive hover trial.\nLeave through this client area before returning to FINISH.",
                Font = new Font("Segoe UI", 13),
                Padding = new Padding(25),
            }
        );
        target.FormClosing += (s, e) =>
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                target.Hide();
            }
        };
        var show = new Button
        {
            Text = "Show standard target",
            Left = 15,
            Top = 500,
            Width = 180,
        };
        show.Click += (s, e) => target.Show();
        form.Controls.Add(show);
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
                int acknowledged = Convert.ToInt32(value["sequence"]);
                bool error = (bool)value["error"];
                status.Text =
                    current
                    + (error ? " - ERROR: stop and report" : "")
                    + " | completed trials: "
                    + ((System.Collections.ICollection)value["results"]).Count;
                if (acknowledged >= sequence)
                {
                    arm.Enabled = current == "IDLE" && !error;
                    finish.Enabled = cancel.Enabled = current == "ARMED";
                }
                results.Text = Json.Serialize(value["results"]);
                if (current == "CLOSED")
                    form.Close();
            }
            catch { }
        };
        form.FormClosing += (s, e) =>
        {
            timer.Stop();
            try
            {
                Send("end");
            }
            catch { }
            ;
        };
        form.Shown += (s, e) =>
        {
            target.Show();
            timer.Start();
        };
        Application.Run(form);
        target.Dispose();
        timer.Dispose();
        return 0;
    }
}
