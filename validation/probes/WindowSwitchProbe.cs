// Issue #7 research only. No product IPC, storage, notification or arbitrary key logging.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

class WindowSwitchProbe {
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; }
    [StructLayout(LayoutKind.Sequential)] struct MouseData { public Point Point; public uint Data,Flags,Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] struct KeyData { public uint Key,Scan,Flags,Time; public UIntPtr Extra; }
    delegate IntPtr Hook(int code,IntPtr message,IntPtr data);
    delegate void WinEvent(IntPtr hook,uint type,IntPtr window,int obj,int child,uint thread,uint time);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr WindowFromPhysicalPoint(Point point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window,uint command);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr window,StringBuilder name,int count);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookExW(int id,Hook callback,IntPtr module,uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWinEventHook(uint first,uint last,IntPtr module,WinEvent callback,uint process,uint thread,uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandleW(string name);

    // Pure trial oracle. Only one final result; ambiguity invalidates the entire trial.
    public class Policy {
        public string Before,Target,Origin="none",Reason="no-correlated-input";
        public bool Alt,TabHeld,Released,Cancelled,Tainted,MouseUp,ForegroundMatched;
        public int Tabs,Inputs; public long Started,ReleaseAt,MouseAt;
        public Policy(string before) { Before=before; }
        public void Invalidate(string reason) { Tainted=true; Reason=reason; }
        public void MouseDown(string target,bool ordinary,bool taskbar,bool injected,long now) {
            if(injected) { Invalidate("injected-input"); return; }
            if(Alt || Origin!="none" || Inputs>0) { Invalidate("competing-input"); return; }
            Inputs++;
            if(taskbar) { Origin="w12"; Reason="taskbar-input-w12-only"; return; }
            if(!ordinary) { Invalidate("non-ordinary-or-external-window"); return; }
            Origin="mouse"; Target=target; MouseAt=now;
            if(target==Before) Reason="same-window";
        }
        public void MouseRelease(string target,long now) {
            if(Origin=="mouse") {
                MouseUp=target==Target && now-MouseAt<=1500;
                if(!MouseUp) Invalidate("mouse-release-mismatch-or-expired");
            }
        }
        public void Key(string key,bool down,bool injected,long now) {
            if(injected) { Invalidate("injected-input"); return; }
            if(key=="alt") {
                if(down) {
                    if(Released || (Origin!="none" && Origin!="key")) Invalidate("competing-alt-press");
                    if(!Alt) Started=now; Alt=true;
                }
                else { Alt=false; if(Origin=="key") { Released=true; ReleaseAt=now; } }
                return;
            }
            if(key=="tab") {
                if(!down) { TabHeld=false; return; }
                if(TabHeld) return;
                TabHeld=true;
                if(!Alt || Released || (Origin!="none" && Origin!="key")) { Invalidate("competing-input"); return; }
                Origin="key"; Tabs++; return;
            }
            if(!down) return;
            if(key=="esc" && Origin=="key") { Cancelled=true; Reason="cancelled"; return; }
            if(key=="win") {
                if(Origin=="none" && !Alt) { Origin="w12"; Reason="win-chord-excluded"; }
                else Invalidate("competing-input");
                return;
            }
            // Shift, Ctrl, Enter, cursor keys, typing: conservative exclusion (no key values retained).
            if(Origin!="w12") Invalidate("unsupported-or-competing-key");
        }
        public void Foreground(string target,bool ordinary,long now) {
            if(Origin=="mouse" && target!=Before) {
                if(target==Target && ordinary && now-MouseAt<=1500) ForegroundMatched=true;
                else Invalidate("foreground-mismatch-or-expired");
            }
            // During Alt+Tab the foreground may temporarily be Shell; final HWND is polled after release.
            if(Origin=="none" && target!=Before) Invalidate("foreground-without-input");
        }
        public bool ObserveForeground(string target,string current,bool ordinary,long now) {
            // Out-of-context callbacks describe a past event; they need not describe the current foreground.
            if(target!=current) return false;
            Foreground(target,ordinary,now); return true;
        }
        public string Result(string final,bool ordinary,long now) {
            if(Tainted) return "unknown";
            if(Cancelled) return "excluded";
            if(final==Before) { Reason="same-window"; return "excluded"; }
            if(Origin=="w12") return "excluded";
            if(!ordinary) { Reason="non-ordinary-or-external-final"; return "unknown"; }
            if(Origin=="mouse" && MouseUp && ForegroundMatched && final==Target) { Reason="matched-direct-click"; return "mouse"; }
            if(Origin=="key" && Released && !Alt && Tabs>0 && now-Started<=15000 && now-ReleaseAt>=250 && now-ReleaseAt<=2000) {
                Reason="alt-release-and-final-window"; return "key";
            }
            Reason="incomplete-or-expired"; return "unknown";
        }
    }

    static readonly JavaScriptSerializer json=new JavaScriptSerializer();
    static readonly Stopwatch clock=Stopwatch.StartNew();
    static readonly Dictionary<IntPtr,string> aliases=new Dictionary<IntPtr,string>();
    static readonly List<object> events=new List<object>();
    static Form panel; static readonly List<Form> targets=new List<Form>();
    static Label status; static ComboBox scenario; static TextBox output; static Button arm,finish;
    static IntPtr mouseHook,keyHook,fgHook,switchHook; static Policy policy;
    static readonly Hook mouseCallback=Mouse,keyCallback=Key;
    static readonly WinEvent eventCallback=Event;
    static string file,caseName; static long trialStart,armAt,settleAt; static int trials;
    static bool armed,pending,done; static string settledResult,settledReason,settledFinal;
    static long settledAt,maxCallbackLagMs; static int staleForegroundEvents; static IntPtr lastForeground;
    static string Alias(IntPtr window) {
        if(window==IntPtr.Zero) return "none";
        string value;
        if(!aliases.TryGetValue(window,out value)) { value="external-"+(aliases.Count+1); aliases.Add(window,value); }
        return value;
    }
    static string Class(IntPtr window) { StringBuilder text=new StringBuilder(128); GetClassNameW(window,text,text.Capacity); return text.ToString(); }
    static bool Taskbar(IntPtr root) { string cls=Class(root); return cls=="Shell_TrayWnd" || cls=="Shell_SecondaryTrayWnd"; }
    static bool Ordinary(IntPtr window) {
        // Research gate is intentionally restricted to the three known ordinary windows.
        foreach(Form target in targets) if(target.Handle==window) return IsWindowVisible(window) && GetAncestor(window,2)==window && GetWindow(window,4)==IntPtr.Zero;
        return false;
    }
    static bool Panel(IntPtr window) { return window==panel.Handle; }
    static void Trace(string kind,IntPtr window,uint sourceTime=0) {
        if(events.Count>=256) { policy.Invalidate("trace-overflow"); return; }
        // Preserve bounded API arrival order, not an input timestamp sequence or OS uptime.
        events.Add(new { kind=kind,window=Alias(window),ordinary=Ordinary(window),
            root=Alias(GetAncestor(window,2)),owner=Alias(GetWindow(window,4)) });
    }
    static void Save(object row) { string line=json.Serialize(row); File.AppendAllText(file,line+Environment.NewLine,new UTF8Encoding(false)); output.AppendText(line+Environment.NewLine); }
    static bool Neutral() {
        int[] keys={1,2,4,5,6,0x09,0x0d,0x10,0x11,0x12,0x1b,0x5b,0x5c};
        foreach(int key in keys) if(GetAsyncKeyState(key)<0) return false;
        return true;
    }
    static void Start() {
        pending=false;
        IntPtr before=GetForegroundWindow();
        if(!Ordinary(before) || !Neutral()) { status.Text="ARM refused: foreground must be A/B/C, with keys/buttons released."; arm.Enabled=true; scenario.Enabled=true; return; }
        policy=new Policy(Alias(before)); events.Clear(); trialStart=clock.ElapsedMilliseconds;
        done=false; settleAt=0; lastForeground=before; maxCallbackLagMs=0; staleForegroundEvents=0;
        mouseHook=SetWindowsHookExW(14,mouseCallback,GetModuleHandleW(null),0);
        keyHook=SetWindowsHookExW(13,keyCallback,GetModuleHandleW(null),0);
        fgHook=SetWinEventHook(3,3,IntPtr.Zero,eventCallback,0,0,0);
        switchHook=SetWinEventHook(0x14,0x15,IntPtr.Zero,eventCallback,0,0,0);
        if(mouseHook==IntPtr.Zero || keyHook==IntPtr.Zero || fgHook==IntPtr.Zero || switchHook==IntPtr.Zero) {
            Stop(); status.Text="Hook setup failed; no trial saved."; arm.Enabled=scenario.Enabled=true; return;
        }
        armed=true; finish.Enabled=true; Trace("armed",before);
        status.Text="ARMED: perform one case. Auto stop after 20s; FINISH also stops. Results do not prove causal attribution.";
    }
    static void Stop() {
        armed=false;
        if(mouseHook!=IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
        if(keyHook!=IntPtr.Zero) UnhookWindowsHookEx(keyHook);
        if(fgHook!=IntPtr.Zero) UnhookWinEvent(fgHook);
        if(switchHook!=IntPtr.Zero) UnhookWinEvent(switchHook);
        mouseHook=keyHook=fgHook=switchHook=IntPtr.Zero;
    }
    static void Finish(string cause) {
        if(!armed) return;
        IntPtr final=GetForegroundWindow();
        // Only the settle timer can freeze an adopted candidate. Early FINISH cannot bypass it.
        if(!done) policy.Invalidate("stopped-before-settle");
        string result=done?settledResult:policy.Result(Alias(final),Ordinary(final),clock.ElapsedMilliseconds);
        string reason=done?settledReason:policy.Reason;
        Stop();
        Save(new { kind="trial",index=++trials,scenario=caseName,stop=cause,before=policy.Before,
            final=done?settledFinal:Alias(final),result=result,reason=reason,tabs=policy.Tabs,
            settledMs=done?settledAt-trialStart:-1,events=events.ToArray(),
            staleForegroundEvents=staleForegroundEvents,maxCallbackLagMs=maxCallbackLagMs,
            scope="owned-three-window-research",causalAttributionProven=false,taskbarNumber="unknown",productPass=false });
        arm.Enabled=scenario.Enabled=true; finish.Enabled=false; status.Text="DISARMED. Review result; no hooks active.";
    }
    static IntPtr Mouse(int code,IntPtr message,IntPtr data) {
        if(code>=0 && armed) {
            long type=message.ToInt64();
            if(type==0x201 || type==0x202 || type==0x204 || type==0x205 || type==0x207 || type==0x208 ||
                type==0x20b || type==0x20c || type==0x20a || type==0x20e) {
                MouseData value=(MouseData)Marshal.PtrToStructure(data,typeof(MouseData));
                IntPtr root=GetAncestor(WindowFromPhysicalPoint(value.Point),2);
                // End before the panel click can alter foreground. Panel input is never a candidate.
                if(Panel(root) && type==0x201) Finish("panel-click");
                else if(!done) {
                    if(type==0x201) {
                        Trace((value.Flags&1)!=0?"injected-mouse":"left-down",root,value.Time);
                        policy.MouseDown(Alias(root),Ordinary(root),Taskbar(root),(value.Flags&1)!=0,clock.ElapsedMilliseconds);
                    } else if(type==0x202) {
                        Trace("left-up",root,value.Time);
                        if((value.Flags&1)!=0) policy.Invalidate("injected-input");
                        else policy.MouseRelease(Alias(root),clock.ElapsedMilliseconds);
                        settleAt=clock.ElapsedMilliseconds+300;
                    } else policy.Invalidate("unsupported-or-competing-mouse");
                }
            }
        }
        return CallNextHookEx(IntPtr.Zero,code,message,data);
    }
    static IntPtr Key(int code,IntPtr message,IntPtr data) {
        if(code>=0 && armed && !done) {
            long type=message.ToInt64();
            if(type==0x100 || type==0x101 || type==0x104 || type==0x105) {
                KeyData value=(KeyData)Marshal.PtrToStructure(data,typeof(KeyData)); bool down=type==0x100 || type==0x104;
                string key=value.Key==0x12 || value.Key==0xa4 || value.Key==0xa5?"alt":value.Key==9?"tab":value.Key==0x1b?"esc":value.Key==0x5b || value.Key==0x5c?"win":"other";
                // Do not retain arbitrary virtual keys, scan codes, text or coordinates.
                if(key!="other") Trace(key+(down?"-down":"-up"),GetForegroundWindow(),value.Time);
                policy.Key(key,down,(value.Flags&0x10)!=0,clock.ElapsedMilliseconds);
                if(key=="alt" && !down) settleAt=clock.ElapsedMilliseconds+300;
            }
        }
        return CallNextHookEx(IntPtr.Zero,code,message,data);
    }
    static void Event(IntPtr hook,uint type,IntPtr window,int obj,int child,uint thread,uint time) {
        if(!armed || done) return;
        IntPtr current=GetForegroundWindow();
        maxCallbackLagMs=Math.Max(maxCallbackLagMs,unchecked((uint)Environment.TickCount-time));
        Trace(type==3?"foreground":type==0x14?"switch-start":"switch-end",window,time);
        if(type==3) {
            Trace("foreground-callback-current",current);
            if(policy.ObserveForeground(Alias(window),Alias(current),Ordinary(window),clock.ElapsedMilliseconds)) lastForeground=window;
            else { staleForegroundEvents++; Trace("stale-foreground-event",window); }
        }
    }
    static int checks;
    static void Check(bool condition,string label) { checks++; if(!condition) throw new Exception("Self-test: "+label); }
    static Policy AltTrial(int tabs) {
        Policy p=new Policy("A"); p.Key("alt",true,false,0);
        for(int i=0;i<tabs;i++) { p.Key("tab",true,false,10+i*20); p.Key("tab",false,false,20+i*20); }
        p.Key("alt",false,false,100); return p;
    }
    static void SelfTest() {
        Policy p=new Policy("A"); p.MouseDown("B",true,false,false,0); p.Foreground("B",true,5); p.MouseRelease("B",10);
        Check(p.Result("B",true,400)=="mouse","direct click");
        p=new Policy("A"); p.MouseDown("A",true,false,false,0); p.MouseRelease("A",10); Check(p.Result("A",true,400)=="excluded","same window");
        p=new Policy("A"); p.Foreground("B",true,5); Check(p.Result("B",true,400)=="unknown","program foreground");
        p=new Policy("A"); p.MouseDown("B",true,false,false,0); p.Foreground("C",true,5); p.MouseRelease("B",10); Check(p.Result("C",true,400)=="unknown","mismatch");
        p=new Policy("A"); p.MouseDown("B",true,false,false,0); p.Foreground("B",true,1600); p.MouseRelease("B",1700); Check(p.Result("B",true,1800)=="unknown","mouse expiry");
        p=new Policy("A"); p.MouseDown("taskbar",false,true,false,0); p.Foreground("B",true,5); Check(p.Result("B",true,400)=="excluded","W12 taskbar");
        p=new Policy("A"); p.Key("win",true,false,0); p.Key("other",true,false,1); p.Foreground("B",true,5); Check(p.Result("B",true,400)=="excluded","W12 Win digit");
        p=AltTrial(1); Check(p.Result("B",true,400)=="key","Alt Tab");
        p=AltTrial(3); Check(p.Tabs==3 && p.Result("C",true,400)=="key","multiple Tab one result");
        p=AltTrial(1); Check(p.Result("A",true,400)=="excluded","return to origin");
        p=AltTrial(1); p.Key("esc",true,false,200); Check(p.Result("B",true,400)=="excluded","Esc");
        p=AltTrial(1); p.MouseDown("B",true,false,false,200); Check(p.Result("B",true,500)=="unknown","switcher mouse");
        p=AltTrial(1); p.Key("other",true,false,200); Check(p.Result("B",true,500)=="unknown","modifier/other");
        p=AltTrial(1); Check(p.Result("external",false,500)=="unknown","external/popup/Edge tabs");
        p=AltTrial(1); Check(p.Result("B",true,2300)=="unknown","key expiry");
        p=AltTrial(1); Check(p.Result("B",true,200)=="unknown","settle too soon");
        p=new Policy("A"); p.Key("alt",true,true,0); p.Key("tab",true,false,1); Check(p.Result("B",true,400)=="unknown","injected modifier");
        p=new Policy("A"); p.MouseDown("B",true,false,true,0); Check(p.Result("B",true,400)=="unknown","injected click");
        p=new Policy("A"); p.MouseDown("B",true,false,false,0); p.MouseRelease("C",20); Check(p.Result("B",true,400)=="unknown","release mismatch");
        p=new Policy("A"); p.Key("tab",true,false,0); Check(p.Result("B",true,400)=="unknown","Tab without Alt");
        p=new Policy("A"); p.Key("alt",true,false,0); p.Key("tab",true,false,1); p.Key("tab",true,false,2); Check(p.Tabs==1,"Tab repeat");
        p=AltTrial(1); p.Foreground("shell",false,50); Check(p.Result("B",true,400)=="key","Shell intermediate");
        p=AltTrial(1); p.Key("alt",true,false,200); Check(p.Result("B",true,500)=="unknown","second Alt while settling");
        p=new Policy("A"); p.MouseDown("B",true,false,false,0); p.Foreground("B",true,5); p.MouseRelease("B",10);
        p.Key("alt",true,false,50); Check(p.Result("B",true,400)=="unknown","Alt during mouse settling");
        p=AltTrial(1); p.Invalidate("stopped-before-settle"); Check(p.Result("B",true,400)=="unknown","early stop cannot adopt");
        p=AltTrial(1); p.Invalidate("unsupported-or-competing-mouse"); Check(p.Result("B",true,400)=="unknown","auxiliary button conflict");
        p=AltTrial(1); Check(p.ObserveForeground("B","B",true,200),"current foreground corroborates event");
        Check(!p.ObserveForeground("shell","B",false,210) && p.Result("B",true,500)=="key","late Shell event does not replace current B");
        p=new Policy("A"); p.MouseDown("B",true,false,false,0); p.MouseRelease("B",10);
        Check(!p.ObserveForeground("B","C",true,20) && p.Result("B",true,400)=="unknown","stale target event cannot prove click result");
        Console.WriteLine("WINDOW_SWITCH_SELF_TEST_OK ("+checks+" fixture checks; no hooks or live observation)");
    }
    [STAThread] static void Main(string[] args) {
        if(args.Length==1 && args[0]=="--self-test") { SelfTest(); return; }
        if(args.Length!=2 || args[0]!="--observe-consented") throw new ArgumentException("Explicit consent required");
        if(!SetProcessDpiAwarenessContext(new IntPtr(-4))) throw new InvalidOperationException("DPI setup failed");
        file=args[1]; Application.EnableVisualStyles();
        panel=new Form { Text="W01 research - manual ARM",Width=880,Height=510 };
        aliases.Add(panel.Handle,"panel");
        status=new Label { Left=12,Top=10,Width=830,Height=65,Text="DISARMED. Select case; ARM gives 4 seconds to click starting window A/B/C. No observation until countdown ends." };
        scenario=new ComboBox { Left=12,Top=80,Width=400,DropDownStyle=ComboBoxStyle.DropDownList };
        scenario.Items.AddRange(new object[]{"direct-click-two","alt-tab-two","alt-tab-multiple-three","escape-cancel","return-to-origin","same-window-click","programmatic-foreground","taskbar-click-w12","win-digit-w12","switcher-mouse-unknown","external-window-unknown"}); scenario.SelectedIndex=0;
        arm=new Button { Left=12,Top=120,Width=200,Height=36,Text="ARM after 4 seconds" };
        finish=new Button { Left=230,Top=120,Width=200,Height=36,Text="FINISH",Enabled=false };
        output=new TextBox { Left=12,Top=175,Width=830,Height=280,Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Both };
        panel.Controls.AddRange(new Control[]{status,scenario,arm,finish,output});
        Rectangle work=Screen.PrimaryScreen.WorkingArea;
        for(int i=0;i<3;i++) {
            Form target=new Form { Text="W01 trial "+(char)('A'+i),Width=360,Height=240,StartPosition=FormStartPosition.Manual,
                Left=work.Left+40+i*180,Top=work.Top+40+i*90,BackColor=i==0?Color.LightBlue:i==1?Color.LightGreen:Color.LightYellow };
            target.Controls.Add(new Label { Left=20,Top=20,Width=300,Height=80,Text="Window "+(char)('A'+i)+"\nResearch target. Click visible client area.\nKeep all three windows available." });
            targets.Add(target); aliases.Add(target.Handle,((char)('A'+i)).ToString()); target.Show();
        }
        arm.Click+=delegate { caseName=Convert.ToString(scenario.SelectedItem); pending=true; armAt=clock.ElapsedMilliseconds+4000; arm.Enabled=scenario.Enabled=false; status.Text="COUNTDOWN: click starting window A/B/C now. ARM starts after 4 seconds."; };
        finish.Click+=delegate { Finish("finish-button"); };
        System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer { Interval=50 };
        long sessionStart=clock.ElapsedMilliseconds;
        timer.Tick+=delegate {
            long now=clock.ElapsedMilliseconds;
            if(now-sessionStart>=1200000) { panel.Close(); return; }
            if(pending && now>=armAt) Start();
            if(!armed) return;
            if(!done && settleAt>0 && now>=settleAt) {
                IntPtr final=GetForegroundWindow();
                // Poll + callback agreement, then freeze exactly one final candidate.
                if(final!=lastForeground) policy.Invalidate("foreground-poll-event-disagreement");
                Trace("settle-poll",final); settledResult=policy.Result(Alias(final),Ordinary(final),now);
                settledReason=policy.Reason; settledFinal=Alias(final); settledAt=now; done=true;
                status.Text="RESULT FROZEN: "+settledResult+" / "+settledReason+". Click FINISH.";
            }
            if(caseName=="programmatic-foreground" && !done && now-trialStart>=3000) { targets[1].Activate(); caseName="programmatic-foreground-triggered"; }
            if(now-trialStart>=20000) Finish("trial-timeout");
        }; timer.Start();
        panel.FormClosing+=delegate { pending=false; if(armed) Finish("panel-close"); Stop(); timer.Stop(); foreach(Form target in targets) target.Close(); };
        panel.FormClosed+=delegate { Save(new { kind="session-end",completedTrials=trials,observationActive=false }); };
        Application.Run(panel); GC.KeepAlive(mouseCallback); GC.KeepAlive(keyCallback); GC.KeepAlive(eventCallback);
    }
}
