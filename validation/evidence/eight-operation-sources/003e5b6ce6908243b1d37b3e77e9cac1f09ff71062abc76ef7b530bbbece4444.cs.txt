// Issue #9 research only. Owned windows; bounded manual ARM/FINISH; no product detector.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;

class EightOperationProbe {
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; }
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int L,T,R,B; }
    [StructLayout(LayoutKind.Sequential)] struct Placement { public uint Length,Flags,Show; public Point Min,Max; public Rect Normal; }
    [StructLayout(LayoutKind.Sequential)] struct MouseData { public Point Point; public uint Data,Flags,Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] struct KeyData { public uint Key,Scan,Flags,Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] struct TitleInfo {
        public uint Size; public Rect Bar;
        [MarshalAs(UnmanagedType.ByValArray,SizeConst=6)] public uint[] State;
        [MarshalAs(UnmanagedType.ByValArray,SizeConst=6)] public Rect[] Bounds;
    }
    delegate IntPtr Hook(int code,IntPtr message,IntPtr data);
    delegate void WinEvent(IntPtr hook,uint kind,IntPtr window,int obj,int child,uint thread,uint time);
    delegate int Arranged(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr WindowFromPhysicalPoint(Point p);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr w,uint flags);
    [DllImport("user32.dll")] static extern IntPtr SendMessageW(IntPtr w,uint m,IntPtr a,IntPtr b);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeoutW(IntPtr w,uint m,IntPtr a,ref TitleInfo info,uint flags,uint timeout,out UIntPtr result);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr w,ref Placement p);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr w,uint flags);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr w);
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookExW(int id,Hook callback,IntPtr module,uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h,int code,IntPtr m,IntPtr data);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint first,uint last,IntPtr module,WinEvent callback,uint pid,uint tid,uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr h);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandleW(string name);
    [DllImport("kernel32.dll",CharSet=CharSet.Ansi)] static extern IntPtr GetProcAddress(IntPtr m,string name);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr w,uint attr,out Rect rect,int size);
    [DllImport("ntdll.dll")] static extern int RtlGetVersion(ref OSVersion version);
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct OSVersion {
        public uint Size,Major,Minor,Build,Platform; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string Service;
    }
    class Snapshot {
        public string state="unknown",shape="unknown"; public bool? arranged; public bool visible;
        // Monitor identity and coordinates are memory-only, never serialized.
        public IntPtr monitor; public Rect rect;
        public object Safe() { return new { state,shape,arranged,visible }; }
    }
    public static string Shape(int l,int t,int r,int b,int x,int y,int width,int height) {
        const int tolerance=3;
        Func<int,int,bool> near=(a,c)=>Math.Abs(a-c)<=tolerance;
        int midX=x+width/2,midY=y+height/2;
        bool left=near(l,x)&&near(r,midX),right=near(l,midX)&&near(r,x+width);
        bool top=near(t,y)&&near(b,midY),bottom=near(t,midY)&&near(b,y+height);
        if(left&&top)return "quarter-top-left"; if(right&&top)return "quarter-top-right";
        if(left&&bottom)return "quarter-bottom-left"; if(right&&bottom)return "quarter-bottom-right";
        if(near(t,y)&&near(b,y+height)) { if(left)return "half-left"; if(right)return "half-right"; }
        return "other";
    }
    static readonly JavaScriptSerializer json=new JavaScriptSerializer();
    static readonly Stopwatch clock=Stopwatch.StartNew();
    static readonly Hook mouseCallback=Mouse,keyCallback=Key;
    static readonly WinEvent eventCallback=Event;
    static readonly List<IntPtr> eventHooks=new List<IntPtr>();
    static readonly HashSet<uint> held=new HashSet<uint>();
    static Arranged arrangedApi; static Form panel,target,other; static IntPtr targetHandle,otherHandle;
    static Label status,instruction; static ComboBox cases; static Button arm,finish,reset;
    static TextBox output; static string file,scenario,route,releaseZone; static IntPtr mouseHook,keyHook;
    static bool armed,pending,destroyed,captionPressed,drag,hookFault;
    static int unhookFailures;
    static long armAt,startAt,lastCaptionAt,lastDownAt; static Point lastCaptionPoint;
    static Snapshot before,last; static string previousShape;
    static int index,mouseInputs,keyPresses,repeats,winReleases,competing,injected,moveStarts,moveEnds,
        maximizeTransitions,restoreTransitions,minimizeTransitions,halfTransitions,quarterTransitions,
        destroyEvents,otherDestroyEvents,foregroundChanges,externalClicks,downPresses,shortDownGaps,longDownGaps,outsideTargetKeys;
    static int hitCaptionCount,hitMinCount,rectMinCount,rectMaxCount,rectCloseCount,rectHitDisagreements,titleInfoFailures,
        winKeyDowns,winChordArrows,arrowsWithoutWin,arrowsWithExtraModifier,asyncWinDisagreements;
    static readonly string[] caseNames={
        "W03 caption double click", "W03 direct top drag", "W03 Snap Layout negative",
        "W04 restore button", "W04 restore double click", "W04 normal minimize button",
        "W04 maximized minimize button", "W04 key restore", "W04 key minimize",
        "W04 two physical Win+Down", "W04 held Down repeat", "W04 other input boundary",
        "W06 mouse left", "W06 mouse right", "W06 key left", "W06 key right",
        "W07 mouse top left", "W07 mouse top right", "W07 mouse bottom left", "W07 mouse bottom right",
        "W07 key top left", "W07 key top right", "W07 key bottom left", "W07 key bottom right",
        "W07 independent half then quarter", "Negative resize", "Negative drag cancel",
        "W02 maximized drag other monitor", "W02 key direction",
        "W11 mouse close", "W11 Alt+F4", "W11 cancel close", "W11 hide close", "W11 other destroyed"
    };
    static bool Down(int key) { return GetAsyncKeyState(key)<0; }
    static bool Neutral() { foreach(int k in new[]{1,2,4,0x10,0x11,0x12,0x25,0x26,0x27,0x28,0x5b,0x5c,0x73})if(Down(k))return false; return true; }
    static Snapshot Read() {
        if(destroyed)return new Snapshot {state="closed",shape="none",visible=false};
        var s=new Snapshot(); var p=new Placement(); p.Length=(uint)Marshal.SizeOf(p);
        if(!GetWindowPlacement(targetHandle,ref p))return s;
        s.state=p.Show==3?"maximized":(p.Show==2||p.Show==6||p.Show==7)?"minimized":p.Show==1?"normal":"other";
        s.visible=IsWindowVisible(targetHandle); s.monitor=MonitorFromWindow(targetHandle,0);
        if(arrangedApi!=null)s.arranged=arrangedApi(targetHandle)!=0;
        Rect r; if(DwmGetWindowAttribute(targetHandle,9,out r,Marshal.SizeOf(typeof(Rect)))==0) {
            s.rect=r; Rectangle w=Screen.FromHandle(targetHandle).WorkingArea;
            s.shape=s.state=="normal"?Shape(r.L,r.T,r.R,r.B,w.X,w.Y,w.Width,w.Height):"none";
        }
        return s;
    }
    static void Sample() {
        Snapshot next=Read();
        if(last!=null) {
            if(next.state!=last.state) {
                if(next.state=="maximized")maximizeTransitions++;
                if(next.state=="minimized")minimizeTransitions++;
                if(last.state=="maximized"&&next.state=="normal")restoreTransitions++;
            }
            if(next.shape!=previousShape) {
                if(next.shape.StartsWith("half-"))halfTransitions++;
                if(next.shape.StartsWith("quarter-"))quarterTransitions++;
            }
        }
        last=next; previousShape=next.shape;
    }
    static void SetRoute(string value) {
        if(route=="none"||route==value)route=value;
        else if(route=="caption-press"&&(value=="caption-double-click"||value=="caption-drag"))route=value;
        else { competing++; route="mixed"; }
    }
    static int ButtonHit(Rect[] rects,uint[] states,Point point) {
        int result=0;
        foreach(int i in new[]{2,3,5}) {
            Rect r=rects[i];
            if((states[i]&0x18001)!=0||r.R<=r.L||r.B<=r.T)continue;
            if(point.X>=r.L&&point.X<r.R&&point.Y>=r.T&&point.Y<r.B) {
                if(result!=0)return 0; // Ambiguous rectangles are not evidence.
                result=i==2?8:i==3?9:20;
            }
        }
        return result;
    }
    static int CaptionButton(Point point) {
        var info=new TitleInfo {Size=(uint)Marshal.SizeOf(typeof(TitleInfo)),State=new uint[6],Bounds=new Rect[6]};
        UIntPtr result;
        if(SendMessageTimeoutW(targetHandle,0x33f,IntPtr.Zero,ref info,2,20,out result)==IntPtr.Zero){titleInfoFailures++;return 0;}
        return ButtonHit(info.Bounds,info.State,point);
    }
    static IntPtr Mouse(int code,IntPtr message,IntPtr data) {
        try { if(code>=0&&armed) {
            int kind=message.ToInt32();
            if(kind==0x201||kind==0x202||kind==0x204||kind==0x207||kind==0x20a) {
                MouseData m=(MouseData)Marshal.PtrToStructure(data,typeof(MouseData));
                IntPtr root=GetAncestor(WindowFromPhysicalPoint(m.Point),2);
                if(root==panel.Handle)return CallNextHookEx(mouseHook,code,message,data);
                if((m.Flags&3)!=0)injected++;
                if(kind==0x201) {
                    if(root!=targetHandle)externalClicks++;
                    else {
                        mouseInputs++;
                        long packed=((long)(ushort)m.Point.Y<<16)|(ushort)m.Point.X;
                        int hit=SendMessageW(targetHandle,0x84,IntPtr.Zero,new IntPtr(packed)).ToInt32();
                        if(hit==2)hitCaptionCount++;if(hit==8)hitMinCount++;
                        int button=CaptionButton(m.Point);
                        if(button==8)rectMinCount++;if(button==9)rectMaxCount++;if(button==20)rectCloseCount++;
                        if(button!=0&&button!=hit)rectHitDisagreements++;
                        // Alternative API evidence is retained independently of original hit-test counts.
                        if(button!=0)hit=button;
                        if(hit==2) {
                            bool dbl=clock.ElapsedMilliseconds-lastCaptionAt<=SystemInformation.DoubleClickTime&&
                                Math.Abs(m.Point.X-lastCaptionPoint.X)<=SystemInformation.DoubleClickSize.Width/2&&
                                Math.Abs(m.Point.Y-lastCaptionPoint.Y)<=SystemInformation.DoubleClickSize.Height/2;
                            SetRoute(dbl?"caption-double-click":"caption-press"); captionPressed=true;
                            lastCaptionAt=clock.ElapsedMilliseconds; lastCaptionPoint=m.Point;
                        } else SetRoute(hit==9?"max-button":hit==8?"min-button":hit==20?"close-button":"other-mouse");
                    }
                } else if(kind==0x202&&captionPressed) {
                    Rectangle w=Screen.FromPoint(new System.Drawing.Point(m.Point.X,m.Point.Y)).WorkingArea;
                    releaseZone=(m.Point.Y<=w.Top+16?"top-":m.Point.Y>=w.Bottom-16?"bottom-":"middle-")+
                        (m.Point.X<=w.Left+16?"left":m.Point.X>=w.Right-16?"right":"center");
                    captionPressed=false;
                } else if(kind!=0x202)competing++;
            }
        }} catch { hookFault=true; }
        return CallNextHookEx(mouseHook,code,message,data);
    }
    static IntPtr Key(int code,IntPtr message,IntPtr data) {
        try { if(code>=0&&armed) {
            KeyData k=(KeyData)Marshal.PtrToStructure(data,typeof(KeyData)); int kind=message.ToInt32();
            bool down=kind==0x100||kind==0x104;
            // Manual stop control works even when maximize/minimize/close hides the panel.
            if(down&&k.Key==0x77&&(k.Flags&0x12)==0){Finish("manual-f8");return CallNextHookEx(keyHook,code,message,data);}
            if(!down) {
                held.Remove(k.Key); if(k.Key==0x5b||k.Key==0x5c)winReleases++;
            } else if(held.Contains(k.Key)) {
                // A target-origin held key can repeat after minimizing the target.
                repeats++;if((k.Flags&0x12)!=0)injected++;
            } else if(GetForegroundWindow()==targetHandle) {
                if((k.Flags&0x12)!=0)injected++;
                held.Add(k.Key);
                bool win=Down(0x5b)||Down(0x5c),shift=Down(0x10),alt=Down(0x12),ctrl=Down(0x11);
                if(k.Key==0x5b||k.Key==0x5c)winKeyDowns++;
                if(k.Key>=0x25&&k.Key<=0x28) {
                    if(win)winChordArrows++;else arrowsWithoutWin++;
                    if(ctrl||shift||alt)arrowsWithExtraModifier++;
                    bool rememberedWin=held.Contains(0x5b)||held.Contains(0x5c);
                    if(rememberedWin!=win)asyncWinDisagreements++;
                }
                if(k.Key==0x5b||k.Key==0x5c||k.Key==0x10||k.Key==0xa0||k.Key==0xa1||k.Key==0x12||k.Key==0xa4||k.Key==0xa5)return CallNextHookEx(keyHook,code,message,data);
                keyPresses++;
                if(k.Key==0x28&&win&&!shift&&!alt&&!ctrl) {
                    if(downPresses>0){if(clock.ElapsedMilliseconds-lastDownAt<=1000)shortDownGaps++;else longDownGaps++;}
                    downPresses++;lastDownAt=clock.ElapsedMilliseconds;
                }
                if(win&&!ctrl&&!alt&&k.Key>=0x25&&k.Key<=0x28) {
                    string value=shift&&(k.Key==0x25||k.Key==0x27)?"win-shift-direction":
                        shift?"unsupported-key":k.Key==0x28?"win-down":k.Key==0x26?"win-up":"win-horizontal";
                    if((route=="win-horizontal"||route=="win-up"||route=="win-down"||route=="win-direction-series")&&value!=route&&!shift)route="win-direction-series";
                    else SetRoute(value);
                } else if(k.Key==0x73&&alt&&!win&&!ctrl&&!shift)SetRoute("alt-f4");
                else {competing++;SetRoute("unsupported-key");}
            } else if(GetForegroundWindow()!=panel.Handle)outsideTargetKeys++;
        }} catch {hookFault=true;}
        return CallNextHookEx(keyHook,code,message,data);
    }
    static void Event(IntPtr h,uint kind,IntPtr window,int obj,int child,uint thread,uint time) {
        if(!armed)return;
        try {
            if(kind==3){foregroundChanges++;return;}
            if(kind==0x8001&&obj==0&&child==0) {
                if(window==targetHandle){destroyed=true;destroyEvents++;Sample();}
                else if(window==otherHandle)otherDestroyEvents++;
                return;
            }
            if(window!=targetHandle)return;
            if(kind==0xa){moveStarts++;drag=true;if(captionPressed)SetRoute("caption-drag");}
            if(kind==0xb){moveEnds++;drag=false;}
            if(kind==0xa||kind==0xb||kind==0x16||kind==0x17||(obj==0&&child==0))Sample();
        } catch {hookFault=true;}
    }
    static void Stop() {
        armed=false; pending=false;
        if(mouseHook!=IntPtr.Zero&&!UnhookWindowsHookEx(mouseHook))unhookFailures++;
        if(keyHook!=IntPtr.Zero&&!UnhookWindowsHookEx(keyHook))unhookFailures++;
        foreach(IntPtr h in eventHooks)if(h!=IntPtr.Zero&&!UnhookWinEvent(h))unhookFailures++;
        eventHooks.Clear();mouseHook=keyHook=IntPtr.Zero;held.Clear();
    }
    static void Save(object row) {string line=json.Serialize(row);File.AppendAllText(file,line+Environment.NewLine,new System.Text.UTF8Encoding(false));output.AppendText(line+Environment.NewLine);}
    static void Start() {
        pending=false;
        if(target==null||target.IsDisposed||GetForegroundWindow()!=targetHandle||!Neutral()) {
            status.Text="ARM refused: focus Target A and release all keys/buttons.";arm.Enabled=cases.Enabled=reset.Enabled=true;return;
        }
        before=Read();last=before;previousShape=before.shape;destroyed=captionPressed=drag=hookFault=false;
        route="none";releaseZone="none";lastCaptionAt=-100000;
        mouseInputs=keyPresses=repeats=winReleases=competing=injected=moveStarts=moveEnds=maximizeTransitions=restoreTransitions=
            minimizeTransitions=halfTransitions=quarterTransitions=destroyEvents=otherDestroyEvents=foregroundChanges=externalClicks=
            downPresses=shortDownGaps=longDownGaps=outsideTargetKeys=0;
        held.Clear();startAt=clock.ElapsedMilliseconds;
        hitCaptionCount=hitMinCount=rectMinCount=rectMaxCount=rectCloseCount=rectHitDisagreements=titleInfoFailures=
            winKeyDowns=winChordArrows=arrowsWithoutWin=arrowsWithExtraModifier=asyncWinDisagreements=0;
        mouseHook=SetWindowsHookExW(14,mouseCallback,GetModuleHandleW(null),0);
        keyHook=SetWindowsHookExW(13,keyCallback,GetModuleHandleW(null),0);
        uint pid=(uint)Process.GetCurrentProcess().Id;
        foreach(uint[] range in new[]{new uint[]{3,3},new uint[]{0xa,0xb},new uint[]{0x16,0x17},new uint[]{0x8001,0x8001},new uint[]{0x800b,0x800b}})
            eventHooks.Add(SetWinEventHook(range[0],range[1],IntPtr.Zero,eventCallback,pid,0,0));
        if(mouseHook==IntPtr.Zero||keyHook==IntPtr.Zero||eventHooks.Contains(IntPtr.Zero)) {
            Stop();status.Text="Hook setup failed. No trial.";arm.Enabled=cases.Enabled=reset.Enabled=true;return;
        }
        armed=true;finish.Enabled=true;status.Text="ARMED: perform ONE case; then FINISH. Timeout 45s.";
    }
    static void Finish(string cause) {
        if(!armed)return;Sample();Stop();
        bool moved=before.monitor!=IntPtr.Zero&&last.monitor!=IntPtr.Zero&&before.monitor!=last.monitor;
        Save(new {kind="trial",index=++index,scenario,stop=cause,before=before.Safe(),after=last.Safe(),route,
            releaseZone,mouseInputs,keyPresses,repeats,winReleases,competing,injected,moveStarts,moveEnds,
            maximizeTransitions,restoreTransitions,minimizeTransitions,halfTransitions,quarterTransitions,destroyEvents,
            otherDestroyEvents,foregroundChanges,externalClicks,downPresses,shortDownGaps,longDownGaps,outsideTargetKeys,
            monitorChanged=moved,movingAtStop=drag,hookFault,unhookFailures,
            hitCaptionCount,hitMinCount,rectMinCount,rectMaxCount,rectCloseCount,rectHitDisagreements,titleInfoFailures,
            winKeyDowns,winChordArrows,arrowsWithoutWin,arrowsWithExtraModifier,asyncWinDisagreements,
            researchOnly=true,causalAttributionProven=false,productPass=false});
        status.Text="FINISHED; hooks removed. Report what you actually did/saw, then choose next case.";
        finish.Enabled=false;arm.Enabled=cases.Enabled=reset.Enabled=true;
    }
    static void Target() {
        if(target!=null&&!target.IsDisposed)target.Dispose();
        target=new Form {Text="Issue 9 - Target A",StartPosition=FormStartPosition.Manual,Bounds=new Rectangle(140,180,640,440),MinimumSize=new Size(180,140)};
        target.Controls.Add(new Label {Dock=DockStyle.Fill,Text="TARGET A: use title bar / caption buttons / manual Windows keys.\nNo product detector is running here.",TextAlign=ContentAlignment.MiddleCenter});
        target.FormClosing+=(s,e)=>{
            if(!armed)return;
            if(scenario=="W11 cancel close"){
                DialogResult answer=MessageBox.Show(target,"Close Target A? Select No for this negative case.","Issue 9 - confirmation",MessageBoxButtons.YesNo);
                if(answer!=DialogResult.Yes){e.Cancel=true;status.Text="Close CANCELLED by confirmation; FINISH.";}
            }
            if(scenario=="W11 hide close"){e.Cancel=true;target.Hide();status.Text="Target HIDDEN, not destroyed; FINISH.";}
            if(scenario=="W11 other destroyed"){e.Cancel=true;if(other!=null&&!other.IsDisposed)other.Close();}
        };
        target.Show();targetHandle=target.Handle;destroyed=false;
    }
    static void Prepare() {
        if(armed||pending)return;Target();
        if(other!=null&&!other.IsDisposed)other.Dispose();
        other=new Form {Text="Issue 9 - Other B",StartPosition=FormStartPosition.Manual,Bounds=new Rectangle(820,500,280,180)};
        other.Show();otherHandle=other.Handle;target.Activate();
        string c=(string)cases.SelectedItem;
        if(c=="W04 restore button"||c=="W04 restore double click"||c=="W04 maximized minimize button"||c=="W04 key restore"||c=="W04 two physical Win+Down"||c=="W04 other input boundary"||c=="W02 maximized drag other monitor")target.WindowState=FormWindowState.Maximized;
        status.Text="Prepared. ARM then focus Target A within 5 seconds; release keys/buttons; wait for ARMED.";
    }
    static void SelfTest() {
        int n=0;Action<bool> check=b=>{if(!b)throw new Exception("self-test "+n);n++;};
        check(Shape(0,0,960,1080,0,0,1920,1080)=="half-left");
        check(Shape(960,0,1920,1080,0,0,1920,1080)=="half-right");
        foreach(int x in new[]{-1920,0})foreach(int y in new[]{-1080,0}) {
            check(Shape(x,y,x+960,y+540,x,y,1920,1080)=="quarter-top-left");
            check(Shape(x+960,y,x+1920,y+540,x,y,1920,1080)=="quarter-top-right");
            check(Shape(x,y+540,x+960,y+1080,x,y,1920,1080)=="quarter-bottom-left");
            check(Shape(x+960,y+540,x+1920,y+1080,x,y,1920,1080)=="quarter-bottom-right");
        }
        check(Shape(0,40,960,1080,0,40,1920,1040)=="half-left");
        check(Shape(4,0,960,1080,0,0,1920,1080)=="other");
        check(Shape(0,0,700,1080,0,0,1920,1080)=="other");
        string safe=json.Serialize(new Snapshot().Safe());check(!safe.Contains("monitor")&&!safe.Contains("rect"));
        var rects=new Rect[6];var states=new uint[6];
        rects[2]=new Rect {L=0,T=0,R=20,B=20};rects[3]=new Rect {L=20,T=0,R=40,B=20};rects[5]=new Rect {L=40,T=0,R=60,B=20};
        check(ButtonHit(rects,states,new Point {X=10,Y=10})==8);
        check(ButtonHit(rects,states,new Point {X=20,Y=10})==9);
        check(ButtonHit(rects,states,new Point {X=50,Y=10})==20);
        check(ButtonHit(rects,states,new Point {X=60,Y=10})==0);
        states[2]=0x8000;check(ButtonHit(rects,states,new Point {X=10,Y=10})==0);
        states[2]=0x10000;check(ButtonHit(rects,states,new Point {X=10,Y=10})==0);
        states[2]=1;check(ButtonHit(rects,states,new Point {X=10,Y=10})==0);
        states[2]=0;rects[3]=rects[2];check(ButtonHit(rects,states,new Point {X=10,Y=10})==0);
        Console.WriteLine("EIGHT_OPERATION_SELF_TEST_OK "+n+" (pure geometry/serialization; no hooks/windows)");
    }
    [STAThread] static void Main(string[] args) {
        if(args.Length==1&&args[0]=="--self-test"){SelfTest();return;}
        if(args.Length!=3||args[0]!="--observe-consented")throw new ArgumentException("Explicit consent and parent process required");
        Process parent=Process.GetProcessById(int.Parse(args[2]));
        // A parent crash or blocked modal UI cannot leave observation running indefinitely.
        var watchdog=new System.Threading.Timer(s=>{
            try {if(parent.HasExited||clock.ElapsedMilliseconds>1210000)Process.GetCurrentProcess().Kill();}
            catch {Process.GetCurrentProcess().Kill();}
        },null,1000,1000);
        file=args[1];bool dpi=SetProcessDpiAwarenessContext(new IntPtr(-4));
        IntPtr api=GetProcAddress(GetModuleHandleW("user32.dll"),"IsWindowArranged");
        if(api!=IntPtr.Zero)arrangedApi=(Arranged)Marshal.GetDelegateForFunctionPointer(api,typeof(Arranged));
        Application.EnableVisualStyles();
        panel=new Form {Text="Issue 9 - manual feasibility probe",Width=860,Height=510,StartPosition=FormStartPosition.CenterScreen};
        cases=new ComboBox {Left=12,Top=12,Width=810,DropDownStyle=ComboBoxStyle.DropDownList};cases.Items.AddRange(caseNames);cases.SelectedIndex=0;
        reset=new Button {Text="1 Prepare / reset",Left=12,Top=50,Width=170};reset.Click+=(s,e)=>Prepare();
        arm=new Button {Text="2 ARM (5s delay)",Left=195,Top=50,Width=180};arm.Click+=(s,e)=>{
            scenario=(string)cases.SelectedItem;pending=true;armAt=clock.ElapsedMilliseconds;
            arm.Enabled=reset.Enabled=cases.Enabled=false;status.Text="Focus Target A; release input; observation starts after 5 seconds.";
        };
        finish=new Button {Text="3 FINISH",Left=390,Top=50,Width=160,Enabled=false};finish.Click+=(s,e)=>Finish("manual");
        instruction=new Label {Left=12,Top=94,Width=810,Height=58,Text="Select case, PREPARE, ARM, focus Target A, wait 6s, perform ONE operation, press F8 to FINISH.\nF8 also stops when panel is hidden. Only owned-window state/input categories are saved."};
        status=new Label {Left=12,Top=155,Width=810,Height=65};
        output=new TextBox {Left=12,Top=225,Width=810,Height=230,Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Vertical};
        panel.Controls.AddRange(new Control[]{cases,reset,arm,finish,instruction,status,output});
        OSVersion os=new OSVersion();os.Size=(uint)Marshal.SizeOf(os);RtlGetVersion(ref os);
        var displays=new List<object>();foreach(Screen screen in Screen.AllScreens) {
            // No device name or raw monitor coordinates. Topology remains in memory.
            Rectangle b=screen.Bounds;Rectangle w=screen.WorkingArea;
            displays.Add(new {primary=screen.Primary,width=b.Width,height=b.Height,workWidth=w.Width,workHeight=w.Height});
        }
        Save(new {kind="environment",windowsBuild=os.Major+"."+os.Minor+"."+os.Build,dpiAware=dpi,arrangedAvailable=arrangedApi!=null,
            displays,scope="owned-windows-only",trialLimitSeconds=45,sessionLimitSeconds=1200});
        var timer=new Timer {Interval=50};timer.Tick+=(s,e)=>{
            if(clock.ElapsedMilliseconds>1200000){Finish("session-timeout");panel.Close();return;}
            if(pending&&clock.ElapsedMilliseconds-armAt>=5000)Start();
            if(armed){Sample();if(clock.ElapsedMilliseconds-startAt>45000)Finish("timeout");}
        };timer.Start();
        panel.FormClosing+=(s,e)=>{Finish("panel-close");Stop();timer.Stop();if(target!=null&&!target.IsDisposed)target.Dispose();if(other!=null&&!other.IsDisposed)other.Dispose();Save(new {kind="session-end",trials=index,hooksRemoved=unhookFailures==0,unhookFailures});};
        Prepare();Application.Run(panel);watchdog.Dispose();parent.Dispose();
    }
}
