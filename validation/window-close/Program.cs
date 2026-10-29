using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Forms;

// Consented, manual-only harness: launches the unmodified production helper.
// Writes fixed case IDs and aggregate results only, never helper stdout or window identity.
internal sealed class Panel : Form
{
    [DllImport("user32.dll")] private static extern bool RegisterHotKey(nint h, int id, uint modifiers, uint key);
    [DllImport("user32.dll")] private static extern bool UnregisterHotKey(nint h, int id);
    private readonly ComboBox cases = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 340 };
    private readonly Label status = new() { AutoSize = false, Width = 620, Height = 100 };
    private readonly Button arm = new() { Text = "ARM (4 sec)", Width = 150 };
    private readonly Button finish = new() { Text = "FINISH / F8", Width = 150 };
    private readonly ListBox results = new() { Width = 620, Height = 190 };
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 1000 };
    private readonly Process helper;
    private readonly string output;
    private Form? a, b;
    private string trial = "";
    private int request, generation, countdown, seconds, mouse, key, switches, destroyedA, destroyedB;
    private bool active, cleaning, ready, done;
    private TaskCompletionSource? stopped;
    private Dictionary<string, int>? diagnostics;
    private static readonly string[] caseIds = { "mouse-close", "key-close", "cancel", "hide", "other-destroy", "program", "delay-confirm", "tab-close" };
    internal Panel(string helperPath, string outputPath)
    {
        output = outputPath;
        Text = "W11 manual validation — F8 FINISH"; Width = 680; Height = 480;
        StartPosition = FormStartPosition.Manual; Location = new(30, 40);
        var layout = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown };
        Controls.Add(layout); cases.Items.AddRange(caseIds); cases.SelectedIndex = 0;
        layout.Controls.Add(cases); layout.Controls.Add(arm); layout.Controls.Add(finish); layout.Controls.Add(status); layout.Controls.Add(results);
        status.Text = "Helper starting. Select case, ARM, wait 4 seconds, then operate A manually. F8 finishes.\nNo automatic input. Session stops after 15 minutes.";
        helper = new Process { StartInfo = new(helperPath, "--close-validation-consented") { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true } };
        _ = Handle;
        helper.OutputDataReceived += (_, e) => { if (e.Data is { } line) { try { using var doc = JsonDocument.Parse(line); var value = doc.RootElement.Clone(); BeginInvoke(() => Receive(value)); } catch { BeginInvoke(() => status.Text = "Invalid helper message; trial unknown."); } } };
        helper.ErrorDataReceived += (_, _) => { }; helper.Start(); helper.BeginOutputReadLine(); helper.BeginErrorReadLine();
        arm.Click += (_, _) => Arm(); finish.Click += async (_, _) => await Finish();
        timer.Tick += async (_, _) => {
            if (++seconds >= 900) { await Finish("session-timeout"); Close(); return; }
            if (countdown > 0 && --countdown == 0) {
                mouse = key = switches = destroyedA = destroyedB = 0;
                active = true; Send("start", ++generation); status.Text = "RUNNING: operate A. F8 FINISH within 30 seconds.";
            } else if (active && ++trialSeconds >= 30) await Finish("trial-timeout");
        };
        Shown += (_, _) => { if (!RegisterHotKey(Handle, 39, 0x4000, 0x77)) { status.Text = "F8 unavailable; close panel and retry after freeing F8."; arm.Enabled = false; } timer.Start(); };
        FormClosing += (_, _) => Cleanup();
    }
    private int trialSeconds;
    private void Send(string command, int epoch = 0) => helper.StandardInput.WriteLine(JsonSerializer.Serialize(new { command, requestId = ++request, generation = epoch, protocolVersion = 2 }));
    private void Receive(JsonElement value)
    {
        switch (value.GetProperty("type").GetString()) {
            case "ready": ready = true; break;
            case "stopped": stopped?.TrySetResult(); break;
            case "close-diagnostics":
                // Fixed enum keys with saturated counts, no input sequence or native identifiers.
                diagnostics = value.GetProperty("counts").Deserialize<Dictionary<string, int>>(); break;
            case "fault": status.Text = "HELPER FAULT — trial unknown"; active = false; arm.Enabled = false; break;
            case "candidate" when active:
                if (value.TryGetProperty("evidence", out var evidence)) {
                    if (evidence.GetProperty("kind").GetString() == "window-close") {
                        if (value.GetProperty("origin").GetString() == "mouse") mouse++; else key++;
                    } else if (evidence.GetProperty("kind").GetString() == "window-switch") switches++;
                }
                break;
        }
    }
    private void Arm()
    {
        if (!ready || active || countdown > 0 || done) return;
        cleaning = true; a?.Dispose(); b?.Dispose(); cleaning = false;
        trial = caseIds[cases.SelectedIndex]; trialSeconds = 0; diagnostics = null;
        b = new Form { Text = "W11 B", Width = 430, Height = 280, StartPosition = FormStartPosition.Manual, Location = new(760, 390) };
        a = new Form { Text = "W11 A — " + trial, Width = 560, Height = 320, StartPosition = FormStartPosition.Manual, Location = new(740, 50) };
        var instruction = new Label { Dock = DockStyle.Top, Height = 90, Text = trial switch {
            "key-close" => "4秒待つ → このA窓でAltを押しながらF4 → 両方離す → Aが閉じたらF8。",
            "cancel" => "4秒待つ → A右上の通常の× → 確認で「いいえ/No」 → Aが残ったらF8。",
            "hide" => "4秒待つ → A右上の通常の× → Aが非表示になったらF8。閉鎖とは数えません。",
            "other-destroy" => "4秒待つ → A右上の通常の× → Bだけが閉じ、Aが残ったらF8。",
            "program" => "4秒待つ → 下のPROGRAM CLOSEをクリック（右上×は使わない） → Aが閉じたらF8。",
            "delay-confirm" => "4秒待つ → A右上の通常の× → 確認で2秒以上待つ → 「はい/Yes」 → Aが閉じたらF8。",
            "tab-close" => "4秒待つ → 下のTAB Xをクリック（右上×は使わない） → ボタンだけ消えたらF8。",
            _ => "4秒待つ → このA窓の右上の通常の×をクリック → Aが閉じたらF8。"
        } };
        a.Controls.Add(instruction);
        var button = new Button { Text = trial == "tab-close" ? "TAB X" : "PROGRAM CLOSE", Location = new(100, 120), Width = 180 };
        a.Controls.Add(button); button.Click += (_, _) => { if (trial == "tab-close") button.Visible = false; else a.Close(); };
        bool program = false; button.MouseDown += (_, _) => program = true;
        a.FormClosing += (_, e) => {
            if (cleaning || !active || program) return;
            if (trial is "cancel" or "delay-confirm") {
                if (MessageBox.Show(a, "Close A?", "W11 confirmation", MessageBoxButtons.YesNo) != DialogResult.Yes) e.Cancel = true;
            } else if (trial == "hide") { e.Cancel = true; a.Hide(); }
            else if (trial == "other-destroy") { e.Cancel = true; b?.Close(); }
        };
        a.FormClosed += (_, _) => { if (active) destroyedA++; };
        b.FormClosed += (_, _) => { if (active) destroyedB++; };
        b.Show(); a.Show(); a.Activate(); countdown = 4;
        arm.Enabled = false; cases.Enabled = false; status.Text = "COUNTDOWN 4 seconds: keep A active and release all input. Then follow A instructions.";
    }
    private async Task Finish(string reason = "manual-finish")
    {
        if (countdown > 0 && !active) {
            countdown = 0; arm.Enabled = true; cases.Enabled = true;
            status.Text = "開始前に取消しました。実入力の観測は開始していません。";
            cleaning = true; a?.Dispose(); b?.Dispose(); cleaning = false; return;
        }
        if (!active || done) return;
        done = true; stopped = new(TaskCreationOptions.RunContinuationsAsynchronously); Send("stop");
        bool acknowledged = await Task.WhenAny(stopped.Task, Task.Delay(3000)) == stopped.Task;
        bool terminated = false;
        if (!acknowledged) {
            try { helper.Kill(true); terminated = helper.WaitForExit(3000); } catch { terminated = helper.HasExited; }
        }
        active = false;
        var record = new { kind = "trial", caseId = trial, mouse, key, w01 = switches, destroyedA, destroyedB,
            stopped = acknowledged, terminated, finishReason = reason, operationDisposition = "participant-confirmation-required",
            diagnostics, rawInputSaved = false };
        File.AppendAllText(output, JsonSerializer.Serialize(record) + Environment.NewLine);
        results.Items.Add($"{trial}: mouse={mouse} key={key} W01={switches} A.destroy={destroyedA} B.destroy={destroyedB} stop={acknowledged}");
        status.Text = acknowledged ? "停止確認済み。次のケースを選んでARM。操作できたかどうかは別途確認します。" :
            terminated ? "停止応答なし。helperを強制終了しました。この試行は未確証です。" : "停止を確認できません。このパネルを閉じ、状況を報告してください。";
        cleaning = true; a?.Dispose(); b?.Dispose(); cleaning = false;
        arm.Enabled = acknowledged; cases.Enabled = true; done = false;
    }
    private void Cleanup()
    {
        timer.Stop(); UnregisterHotKey(Handle, 39); active = false; cleaning = true;
        a?.Dispose(); b?.Dispose();
        try { Send("shutdown"); if (!helper.WaitForExit(3000)) helper.Kill(true); } catch { }
        helper.Dispose(); timer.Dispose();
    }
    protected override void WndProc(ref Message m) { if (m.Msg == 0x312 && m.WParam == 39) _ = Finish(); base.WndProc(ref m); }
}
internal static class Program
{
    [STAThread] private static void Main(string[] args)
    {
        if (args.Length != 3 || args[0] != "--observe-consented") return;
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2); Application.EnableVisualStyles();
        Application.Run(new Panel(Path.GetFullPath(args[1]), Path.GetFullPath(args[2])));
    }
}
