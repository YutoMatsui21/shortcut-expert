// Disposable experiment. The user explicitly selects one external window.
// No keystroke text, external window title, URL, screenshot or clipboard is read/saved.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

class ExternalWindowProbe {
    [StructLayout(LayoutKind.Sequential)] struct Point { public int x,y; }
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int left,top,right,bottom; }
    [StructLayout(LayoutKind.Sequential)] struct Placement { public int length,flags,show; public Point min,max; public Rect rect; }
    [StructLayout(LayoutKind.Sequential)] struct MouseData { public Point point; public uint data,flags,time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct KeyData { public uint key,scan,flags,time; public UIntPtr extra; }
    delegate void WinEvent(IntPtr h,uint e,IntPtr w,int obj,int child,uint thread,uint time);
    delegate IntPtr InputHook(int code,IntPtr w,IntPtr l);
    [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr w,ref Placement p);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr w,uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr w,uint flag);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeoutW(IntPtr w,uint msg,IntPtr wp,IntPtr lp,uint flags,uint timeout,out UIntPtr result);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr w,out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr w);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr module,WinEvent cb,uint pid,uint tid,uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr h);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookExW(int type,InputHook cb,IntPtr module,uint tid);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h,int c,IntPtr w,IntPtr l);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandleW(string name);
    static Form panel;
    static IntPtr target;
    static string app="none",inputExpected="unspecified";
    static System.Windows.Forms.Timer capture;
    static TextBox trace;
    static ComboBox label;
    static IntPtr eventHook,moveHook,mouseHook,keyHook;
    static WinEvent eventCallback=OnEvent;
    static InputHook mouseCallback=OnMouse,keyCallback=OnKey;
    static Stopwatch clock=Stopwatch.StartNew();
    static Dictionary<IntPtr,int> monitors=new Dictionary<IntPtr,int>();
    static List<string> evidence=new List<string>();
    static long inputAt=-10000;
    static string inputAction="none";
    static bool injected;
    static bool closing;
    static WindowStateSequence sequence=new WindowStateSequence();
    static InputOriginCandidate origin=new InputOriginCandidate();
    static string sessionId=DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-fff");
    static string SavePath { get { return Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"external-window-observations.jsonl"); } }
    static void Log(string text) { trace.AppendText(text+Environment.NewLine); }
    static int MonitorIndex(IntPtr handle) {
        if(handle==IntPtr.Zero) return -1;
        if(!monitors.ContainsKey(handle)) monitors.Add(handle,monitors.Count);
        return monitors[handle];
    }
    static void OnEvent(IntPtr h,uint e,IntPtr w,int obj,int child,uint thread,uint time) {
        if(closing || target==IntPtr.Zero || w!=target || obj!=0 || child!=0) return;
        if(e==0x000A) {
            sequence.BeginMoveSize(); origin.BeginMoveSize(clock.ElapsedMilliseconds);
            return;
        }
        if(e==0x000B) {
            sequence.EndMoveSize(); Observe("move-size-end"); origin.EndMoveSize();
            return;
        }
        Observe();
    }
    static void Observe(string phase="state-change") {
        if(closing || target==IntPtr.Zero || !IsWindow(target)) return;
        // Do not count intermediate monitor crossings of one drag as operations.
        if(sequence.IsMoving) return;
        Placement p=new Placement(); p.length=Marshal.SizeOf(typeof(Placement));
        if(!GetWindowPlacement(target,ref p)) return;
        int currentMonitor=MonitorIndex(MonitorFromWindow(target,2));
        WindowTransition transition=sequence.Observe(p.show,currentMonitor,phase);
        if(transition==null) return;
        string operation=transition.Operation;
        long now=clock.ElapsedMilliseconds;
        bool recent=now-inputAt>=0 && now-inputAt<=1000;
        string candidate=origin.Resolve(now);
        string expected=candidate=="unknown"?Convert.ToString(label.SelectedItem):inputExpected;
        // Time proximity is deliberately named 'candidate'; never claimed causal proof.
        string record="{\"probeVersion\":1,\"app\":\""+app+"\",\"observationPhase\":\""+phase+"\",\"expectedLabel\":\""+expected+"\",\"operation\":\""+operation+"\",\"beforeState\":"+transition.BeforeState+",\"afterState\":"+transition.AfterState+",\"beforeMonitor\":"+transition.BeforeMonitor+",\"afterMonitor\":"+currentMonitor+",\"originCandidate\":\""+candidate+"\",\"shortcutCandidate\":\""+(recent?inputAction:"none")+"\",\"injected\":"+(injected?"true":"false")+",\"inputAgeMs\":"+(now-inputAt>=0?now-inputAt:-1)+",\"causalityConfirmed\":false}";
        evidence.Add(record);
        Log(record);
    }
    static IntPtr OnMouse(int c,IntPtr w,IntPtr l) {
        if(c>=0 && target!=IntPtr.Zero && w.ToInt64()==0x201) {
            MouseData d=(MouseData)Marshal.PtrToStructure(l,typeof(MouseData));
            if(GetAncestor(WindowFromPoint(d.point),2)==target) {
                long packed=(uint)((d.point.y & 0xffff)<<16) | (uint)(d.point.x & 0xffff);
                UIntPtr result;
                // Read-only non-client hit test; abandon unresponsive targets within 20ms.
                if(SendMessageTimeoutW(target,0x84,IntPtr.Zero,new IntPtr(packed),2,20,out result)==IntPtr.Zero)
                    return CallNextHookEx(IntPtr.Zero,c,w,l);
                int hit=unchecked((int)result.ToUInt64());
                // Only target's caption, maximize/minimize, and resizing borders.
                if(hit==2 || hit==8 || hit==9 || (hit>=10 && hit<=17)) {
                    inputAt=clock.ElapsedMilliseconds; inputAction="none"; injected=(d.flags & 1)!=0; inputExpected=Convert.ToString(label.SelectedItem);
                    origin.MouseDown(inputAt,injected,hit==2);
                }
            }
        }
        return CallNextHookEx(IntPtr.Zero,c,w,l);
    }
    static IntPtr OnKey(int c,IntPtr w,IntPtr l) {
        if(c>=0 && target!=IntPtr.Zero && GetForegroundWindow()==target && (w.ToInt64()==0x100 || w.ToInt64()==0x104)) {
            KeyData d=(KeyData)Marshal.PtrToStructure(l,typeof(KeyData));
            bool win=GetAsyncKeyState(0x5B)<0 || GetAsyncKeyState(0x5C)<0;
            bool shift=GetAsyncKeyState(0x10)<0;
            string action="none";
            if(win && d.key==0x26) action="Win+Up";
            if(win && d.key==0x28) action=shift?"Win+Shift+Down":"Win+Down";
            if(win && shift && d.key==0x25) action="Win+Shift+Left";
            if(win && shift && d.key==0x27) action="Win+Shift+Right";
            if(action!="none") {
                inputAt=clock.ElapsedMilliseconds; inputAction=action; injected=(d.flags & 0x10)!=0; inputExpected=Convert.ToString(label.SelectedItem);
                origin.KeyDown(inputAt,injected);
            }
        }
        return CallNextHookEx(IntPtr.Zero,c,w,l);
    }
    static Button Button(string text,int top,EventHandler action) {
        Button b=new Button(); b.Text=text; b.Left=12; b.Top=top; b.Width=520; b.Height=30; b.Click+=action; panel.Controls.Add(b); return b;
    }
    static void SelectTarget() {
        IntPtr selected=GetForegroundWindow(); uint pid;
        GetWindowThreadProcessId(selected,out pid);
        string name;
        try { using(Process process=Process.GetProcessById((int)pid)) name=process.ProcessName.ToLowerInvariant(); }
        catch { Log("対象を取得できません。再選択してください。"); return; }
        if(name!="chrome" && name!="obsidian" && name!="code" && name!="chatgpt" && name!="codex") {
            Log("Chrome / Obsidian / VS Code / ChatGPT / Codexを手前にして再選択してください。"); return;
        }
        Placement p=new Placement(); p.length=Marshal.SizeOf(typeof(Placement));
        if(!GetWindowPlacement(selected,ref p)) { Log("対象の状態読取に失敗。別の通常権限ウィンドウで再選択してください。"); return; }
        if(eventHook!=IntPtr.Zero) UnhookWinEvent(eventHook);
        if(moveHook!=IntPtr.Zero) UnhookWinEvent(moveHook);
        target=selected; app=name;
        sequence=new WindowStateSequence(); origin=new InputOriginCandidate();
        inputAt=-10000; inputAction="none"; injected=false; inputExpected="unspecified";
        sequence.Observe(p.show,MonitorIndex(MonitorFromWindow(target,2)),"baseline");
        eventHook=SetWinEventHook(0x8000,0x800B,IntPtr.Zero,eventCallback,pid,0,0);
        moveHook=SetWinEventHook(0x000A,0x000B,IntPtr.Zero,eventCallback,pid,0,0);
        string metadata="{\"kind\":\"target-selected\",\"app\":\""+app+"\",\"monitors\":"+Screen.AllScreens.Length+",\"winEvent\":"+(eventHook!=IntPtr.Zero?"true":"false")+",\"moveHook\":"+(moveHook!=IntPtr.Zero?"true":"false")+",\"mouseHook\":"+(mouseHook!=IntPtr.Zero?"true":"false")+",\"keyHook\":"+(keyHook!=IntPtr.Zero?"true":"false")+"}";
        evidence.Add(metadata); Log(metadata);
        if(eventHook==IntPtr.Zero || moveHook==IntPtr.Zero || mouseHook==IntPtr.Zero || keyHook==IntPtr.Zero) Log("初期化失敗あり。合格試験として使わないでください。");
    }
    [STAThread] static void Main() {
        Application.EnableVisualStyles();
        panel=new Form(); panel.Text="OSS external window probe - controller"; panel.Width=850; panel.Height=620;
        Label instructions=new Label(); instructions.Left=12; instructions.Top=12; instructions.Width=810; instructions.Height=55;
        instructions.Text="対象選択を押し、5秒以内に調べたいアプリを手前にしてください。選んだ窓の状態だけを観測します。\n操作前にラベルを選択。文字・タイトル・URLは保存しません。×で監視解除・ログ保存。"; panel.Controls.Add(instructions);
        label=new ComboBox(); label.Left=12; label.Top=75; label.Width=520; label.DropDownStyle=ComboBoxStyle.DropDownList;
        label.Items.AddRange(new object[]{"mouse-maximize","key-maximize","mouse-monitor-move","key-monitor-move","reset","unspecified"}); label.SelectedIndex=0; panel.Controls.Add(label);
        trace=new TextBox(); trace.Left=12; trace.Top=225; trace.Width=810; trace.Height=340; trace.Multiline=true; trace.ScrollBars=ScrollBars.Both; trace.ReadOnly=true; panel.Controls.Add(trace);
        capture=new System.Windows.Forms.Timer(); capture.Interval=5000;
        capture.Tick+=delegate { capture.Stop(); SelectTarget(); };
        Button("5秒後に手前のウィンドウを対象にする",110,delegate { capture.Stop(); capture.Start(); Log("5秒以内に対象アプリをクリックして手前にしてください。"); });
        Button("現在の結果を保存（監視は継続）",145,delegate { Save(); Log("保存しました。"); });
        panel.Shown+=delegate {
            mouseHook=SetWindowsHookExW(14,mouseCallback,GetModuleHandleW(null),0);
            keyHook=SetWindowsHookExW(13,keyCallback,GetModuleHandleW(null),0);
            string metadata="{\"kind\":\"session\",\"probeVersion\":1,\"mouseHook\":"+(mouseHook!=IntPtr.Zero?"true":"false")+",\"keyHook\":"+(keyHook!=IntPtr.Zero?"true":"false")+"}";
            evidence.Add(metadata); Log(metadata);
            if(mouseHook==IntPtr.Zero || keyHook==IntPtr.Zero) Log("入力hookの初期化失敗。終了してください。");
        };
        System.Windows.Forms.Timer poll=new System.Windows.Forms.Timer(); poll.Interval=100; poll.Tick+=delegate { Observe(); }; poll.Start();
        panel.FormClosed+=delegate {
            closing=true; poll.Stop(); capture.Stop();
            if(eventHook!=IntPtr.Zero) UnhookWinEvent(eventHook);
            if(moveHook!=IntPtr.Zero) UnhookWinEvent(moveHook);
            if(mouseHook!=IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
            if(keyHook!=IntPtr.Zero) UnhookWindowsHookEx(keyHook);
            Save();
        };
        Application.Run(panel);
        GC.KeepAlive(eventCallback); GC.KeepAlive(mouseCallback); GC.KeepAlive(keyCallback);
    }
    static void Save() {
        string archive=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"external-window-observations-"+sessionId+".jsonl");
        File.WriteAllLines(archive,evidence.ToArray(),new System.Text.UTF8Encoding(false));
        File.WriteAllLines(SavePath,evidence.ToArray(),new System.Text.UTF8Encoding(false));
    }
}
