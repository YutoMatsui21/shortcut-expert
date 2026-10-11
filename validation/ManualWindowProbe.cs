// Disposable experiment. Observes only its own target window.
// No keystroke text, external window title, URL, screenshot or clipboard is read/saved.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

class ManualWindowProbe {
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
    [DllImport("user32.dll")] static extern IntPtr SendMessageW(IntPtr w,uint msg,IntPtr wp,IntPtr lp);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr module,WinEvent cb,uint pid,uint tid,uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr h);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookExW(int type,InputHook cb,IntPtr module,uint tid);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h,int c,IntPtr w,IntPtr l);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandleW(string name);
    static Form panel,target;
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
    static string SavePath { get { return Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"manual-window-observations.jsonl"); } }
    static void Log(string text) { trace.AppendText(text+Environment.NewLine); }
    static int MonitorIndex(IntPtr handle) {
        if(handle==IntPtr.Zero) return -1;
        if(!monitors.ContainsKey(handle)) monitors.Add(handle,monitors.Count);
        return monitors[handle];
    }
    static void OnEvent(IntPtr h,uint e,IntPtr w,int obj,int child,uint thread,uint time) {
        if(closing || target==null || !target.IsHandleCreated || w!=target.Handle || obj!=0 || child!=0) return;
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
        if(closing || target==null || !target.IsHandleCreated) return;
        // Do not count intermediate monitor crossings of one drag as operations.
        if(sequence.IsMoving) return;
        Placement p=new Placement(); p.length=Marshal.SizeOf(typeof(Placement));
        if(!GetWindowPlacement(target.Handle,ref p)) return;
        int currentMonitor=MonitorIndex(MonitorFromWindow(target.Handle,2));
        WindowTransition transition=sequence.Observe(p.show,currentMonitor,phase);
        if(transition==null) return;
        string operation=transition.Operation;
        long now=clock.ElapsedMilliseconds;
        bool recent=now-inputAt>=0 && now-inputAt<=1000;
        string candidate=origin.Resolve(now);
        string expected=Convert.ToString(label.SelectedItem);
        // Time proximity is deliberately named 'candidate'; never claimed causal proof.
        string record="{\"probeVersion\":2,\"observationPhase\":\""+phase+"\",\"expectedLabel\":\""+expected+"\",\"operation\":\""+operation+"\",\"beforeState\":"+transition.BeforeState+",\"afterState\":"+transition.AfterState+",\"beforeMonitor\":"+transition.BeforeMonitor+",\"afterMonitor\":"+currentMonitor+",\"originCandidate\":\""+candidate+"\",\"shortcutCandidate\":\""+(recent?inputAction:"none")+"\",\"injected\":"+(injected?"true":"false")+",\"inputAgeMs\":"+(now-inputAt>=0?now-inputAt:-1)+",\"causalityConfirmed\":false}";
        evidence.Add(record);
        Log(record);
    }
    static IntPtr OnMouse(int c,IntPtr w,IntPtr l) {
        if(c>=0 && target!=null && target.IsHandleCreated && w.ToInt64()==0x201) {
            MouseData d=(MouseData)Marshal.PtrToStructure(l,typeof(MouseData));
            if(GetAncestor(WindowFromPoint(d.point),2)==target.Handle) {
                long packed=(uint)((d.point.y & 0xffff)<<16) | (uint)(d.point.x & 0xffff);
                int hit=SendMessageW(target.Handle,0x84,IntPtr.Zero,new IntPtr(packed)).ToInt32();
                // Only target's caption, maximize/minimize, and resizing borders.
                if(hit==2 || hit==8 || hit==9 || (hit>=10 && hit<=17)) {
                    inputAt=clock.ElapsedMilliseconds; inputAction="none"; injected=(d.flags & 1)!=0;
                    origin.MouseDown(inputAt,injected,hit==2);
                }
            }
        }
        return CallNextHookEx(IntPtr.Zero,c,w,l);
    }
    static IntPtr OnKey(int c,IntPtr w,IntPtr l) {
        if(c>=0 && target!=null && target.IsHandleCreated && GetForegroundWindow()==target.Handle && (w.ToInt64()==0x100 || w.ToInt64()==0x104)) {
            KeyData d=(KeyData)Marshal.PtrToStructure(l,typeof(KeyData));
            bool win=GetAsyncKeyState(0x5B)<0 || GetAsyncKeyState(0x5C)<0;
            bool shift=GetAsyncKeyState(0x10)<0;
            string action="none";
            if(win && d.key==0x26) action="Win+Up";
            if(win && d.key==0x28) action=shift?"Win+Shift+Down":"Win+Down";
            if(win && shift && d.key==0x25) action="Win+Shift+Left";
            if(win && shift && d.key==0x27) action="Win+Shift+Right";
            if(action!="none") {
                inputAt=clock.ElapsedMilliseconds; inputAction=action; injected=(d.flags & 0x10)!=0;
                origin.KeyDown(inputAt,injected);
            }
        }
        return CallNextHookEx(IntPtr.Zero,c,w,l);
    }
    static Button Button(string text,int top,EventHandler action) {
        Button b=new Button(); b.Text=text; b.Left=12; b.Top=top; b.Width=520; b.Height=30; b.Click+=action; panel.Controls.Add(b); return b;
    }
    [STAThread] static void Main() {
        Application.EnableVisualStyles();
        panel=new Form(); panel.Text="OSS technical probe - controller"; panel.Width=850; panel.Height=620;
        Label instructions=new Label(); instructions.Left=12; instructions.Top=12; instructions.Width=810; instructions.Height=55;
        instructions.Text="検証用ウィンドウだけを観測します。操作前に正解ラベルを選んでください。\n近接入力は推定であり、causalityConfirmedは常にfalseです。閉じると集計証拠だけ保存し、監視を解除します。"; panel.Controls.Add(instructions);
        label=new ComboBox(); label.Left=12; label.Top=75; label.Width=520; label.DropDownStyle=ComboBoxStyle.DropDownList;
        label.Items.AddRange(new object[]{"mouse-maximize","key-maximize","mouse-monitor-move","key-monitor-move","program-maximize","program-monitor-move","unrelated-input-plus-program","reset","unspecified"}); label.SelectedIndex=0; panel.Controls.Add(label);
        trace=new TextBox(); trace.Left=12; trace.Top=225; trace.Width=810; trace.Height=340; trace.Multiline=true; trace.ScrollBars=ScrollBars.Both; trace.ReadOnly=true; panel.Controls.Add(trace);
        target=new Form(); target.Text="OSS probe target - no user data"; target.Width=620; target.Height=400;
        Label targetHelp=new Label(); targetHelp.Text="このウィンドウの最大化・復元・画面間移動を試します。\n実際のアプリ対応やタスクバーの順位対応は別途未検証です。"; targetHelp.Dock=DockStyle.Fill; target.Controls.Add(targetHelp);
        Button("対象ウィンドウを表示／手前へ",110,delegate { target.Show(); target.Activate(); });
        Button("プログラムで最大化（負例）",145,delegate { target.WindowState=FormWindowState.Maximized; });
        Button("対象ウィンドウを通常サイズへ戻す（resetラベルを選ぶ）",180,delegate { target.WindowState=FormWindowState.Normal; });
        panel.Shown+=delegate {
            target.Show(); Observe();
            uint pid=(uint)Process.GetCurrentProcess().Id;
            eventHook=SetWinEventHook(0x8000,0x800B,IntPtr.Zero,eventCallback,pid,0,0);
            moveHook=SetWinEventHook(0x000A,0x000B,IntPtr.Zero,eventCallback,pid,0,0);
            mouseHook=SetWindowsHookExW(14,mouseCallback,GetModuleHandleW(null),0);
            keyHook=SetWindowsHookExW(13,keyCallback,GetModuleHandleW(null),0);
            string metadata="{\"kind\":\"session\",\"probeVersion\":2,\"monitors\":"+Screen.AllScreens.Length+",\"winEvent\":"+(eventHook!=IntPtr.Zero?"true":"false")+",\"moveHook\":"+(moveHook!=IntPtr.Zero?"true":"false")+",\"mouseHook\":"+(mouseHook!=IntPtr.Zero?"true":"false")+",\"keyHook\":"+(keyHook!=IntPtr.Zero?"true":"false")+"}";
            evidence.Add(metadata); Log(metadata);
            if(eventHook==IntPtr.Zero || moveHook==IntPtr.Zero || mouseHook==IntPtr.Zero || keyHook==IntPtr.Zero) Log("初期化失敗あり。合格試験として使わないでください。");
        };
        System.Windows.Forms.Timer poll=new System.Windows.Forms.Timer(); poll.Interval=100; poll.Tick+=delegate { Observe(); }; poll.Start();
        panel.FormClosed+=delegate {
            closing=true; poll.Stop();
            if(eventHook!=IntPtr.Zero) UnhookWinEvent(eventHook);
            if(moveHook!=IntPtr.Zero) UnhookWinEvent(moveHook);
            if(mouseHook!=IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
            if(keyHook!=IntPtr.Zero) UnhookWindowsHookEx(keyHook);
            if(target!=null && !target.IsDisposed) target.Close();
            string archive=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"manual-window-observations-"+sessionId+".jsonl");
            File.WriteAllLines(archive,evidence.ToArray(),new System.Text.UTF8Encoding(false));
            File.WriteAllLines(SavePath,evidence.ToArray(),new System.Text.UTF8Encoding(false));
        };
        Application.Run(panel);
        GC.KeepAlive(eventCallback); GC.KeepAlive(mouseCallback); GC.KeepAlive(keyCallback);
    }
}
