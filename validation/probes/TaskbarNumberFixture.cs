// Disposable taskbar items with distinct identities. No hooks, UIA or input observation.
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

class TaskbarNumberFixture
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SetCurrentProcessExplicitAppUserModelID(string id);

    [STAThread]
    static void Main(string[] args)
    {
        int index;
        if (args.Length != 1 || !int.TryParse(args[0], out index) || index < 1 || index > 24)
            throw new ArgumentException("Fixture index 1..24 required");
        int result = SetCurrentProcessExplicitAppUserModelID(
            "ShortcutExpert.Research.W12Fixture." + index
        );
        if (result < 0)
            Marshal.ThrowExceptionForHR(result);
        Application.EnableVisualStyles();
        Form form = new Form
        {
            Text = "W12 number fixture " + index,
            Width = 360,
            Height = 150,
            StartPosition = FormStartPosition.Manual,
            Left = 80 + index * 8,
            Top = 100 + index * 8,
        };
        form.Controls.Add(
            new Label
            {
                Dock = DockStyle.Fill,
                Text =
                    "W12 taskbar number fixture "
                    + index
                    + "\nNo hooks or observation. Close after testing.",
                Font = new Font("Segoe UI", 12),
            }
        );
        Timer timer = new Timer { Interval = 1200000 };
        timer.Tick += delegate
        {
            form.Close();
        };
        timer.Start();
        Application.Run(form);
        timer.Dispose();
    }
}
