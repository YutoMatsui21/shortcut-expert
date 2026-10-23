// Opt-in research only. No text, titles, paths, raw keys, cursor coordinates or input timeline is saved.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;
using PointDrawing = System.Drawing.Point;

class SnapInvocationProbe {
    // A gap or a different target ends a dwell; one continuous dwell emits at most once.
    class Dwell {
        public IntPtr Target,Latched; public long Since,Last=-1;
        public bool Step(IntPtr target,long now,int threshold,bool knownExit=true) {
            if(Last>=0 && (now<Last || now-Last>200)) Target=IntPtr.Zero;
            Last=now;
            if(target==IntPtr.Zero) { Target=IntPtr.Zero; Since=now; if(knownExit) Latched=IntPtr.Zero; return false; }
            if(target!=Target) { Target=target; Since=now; }
            if(Latched!=IntPtr.Zero && target!=Latched) Latched=IntPtr.Zero;
            if(target==Latched || now-Since<threshold) return false;
            Latched=target; return true;
        }
    }
    class Keys {
        bool left,right,z,tainted; readonly HashSet<uint> modifiers=new HashSet<uint>();
        public bool Step(uint key,bool down,bool injected) {
            if(injected) { tainted=true; return false; }
            if(key==0x10 || key==0x11 || key==0x12 || (key>=0xa0 && key<=0xa5)) {
                if(down) modifiers.Add(key); else modifiers.Remove(key);
            }
            if(key==0x5b) left=down;
            if(key==0x5c) right=down;
            if(key!=0x5a) return false;
            bool fire=down && !z && (left || right) && modifiers.Count==0 && !tainted; z=down; return fire;
        }
    }
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; }
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left,Top,Right,Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct TitleInfo {
        public uint Size; public Rect Bar;
        [MarshalAs(UnmanagedType.ByValArray,SizeConst=6)] public uint[] State;
        [MarshalAs(UnmanagedType.ByValArray,SizeConst=6)] public Rect[] Bounds;
    }
    [StructLayout(LayoutKind.Sequential)] struct KeyData { public uint Key,Scan,Flags,Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct OsVersion {
        public uint Size,Major,Minor,Build,Platform;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string ServicePack;
    }
    delegate IntPtr HookProc(int code,IntPtr message,IntPtr data);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] static extern bool GetPhysicalCursorPos(out Point point);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out Rect rect);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flag);
    [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll",EntryPoint="GetWindowLongW")] static extern int GetStyle(IntPtr window,int index);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window,StringBuilder name,int count);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SendMessageTimeoutW(IntPtr window,uint message,IntPtr wp,IntPtr lp,uint flags,uint timeout,out UIntPtr result);
    [DllImport("user32.dll",SetLastError=true)] static extern bool SystemParametersInfoW(uint action,uint param,out int value,uint flags);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookExW(int id,HookProc callback,IntPtr module,uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandleW(string module);
    [DllImport("kernel32.dll",EntryPoint="SetLastError")] static extern void ClearLastError(uint error);
    [DllImport("ntdll.dll")] static extern int RtlGetVersion(ref OsVersion version);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern IntPtr GetThreadDpiAwarenessContext();
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
    [DllImport("user32.dll")] static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool PhysicalToLogicalPointForPerMonitorDPI(IntPtr window,ref Point point);
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
    static readonly Stopwatch Clock=Stopwatch.StartNew();
    static readonly string[] Cases={"1 app Win+Z / Snap ON", "2 desktop Win+Z / Snap ON", "3 app Win+Z / Snap OFF",
        "4 app Win+Z / hover OFF", "5 long hover / both ON", "6 short hover / both ON",
        "7 hover / Snap OFF", "8 hover / hover OFF"};
    static Form panel,target; static ComboBox cases,oracle,application,activeState; static NumericUpDown threshold;
    static Label status,targetStatus; static Button arm,finish; static IntPtr hook; static HookProc callback=OnKey;
    static Keys keys=new Keys(); static Dwell dwell=new Dwell(); static bool observing;
    static int keyCalls,hoverCalls,repeats,hitTimeouts,titleTimeouts,titleMatches,hitMatches,desktopKeys,injectedKeys;
    static int hookCallbacks,winEvents,zEvents,cursorFailures,eligibleSamples,polls;
    static long maxQueryMs,maxPollGapMs,lastPoll; static int buttonHeldSamples;
    static readonly Dictionary<string,int> QueryFailures=new Dictionary<string,int>(),HitResults=new Dictionary<string,int>();
    static readonly Dictionary<string,int> CaptionSources=new Dictionary<string,int>();
    static string lastCaptionSource; static int geometryDisagreements,unstableSamples,dpiFailures;
    static readonly Dictionary<string,int> Rejections=new Dictionary<string,int>();
    static long started; static string output; static SettingSnapshot startSettings; static int trialNumber;
    static readonly Dictionary<IntPtr,int[]> Targets=new Dictionary<IntPtr,int[]>();
    static readonly Queue<IntPtr> PendingKeys=new Queue<IntPtr>();
    static void Increment(Dictionary<string,int> counts,string key) { int n; counts.TryGetValue(key,out n); counts[key]=n+1; }
    static bool Query(IntPtr window,uint message,IntPtr data,out UIntPtr result) {
        long before=Clock.ElapsedMilliseconds; ClearLastError(0);
        IntPtr success=SendMessageTimeoutW(window,message,IntPtr.Zero,data,0x22,30,out result);
        int error=Marshal.GetLastWin32Error(); long elapsed=Clock.ElapsedMilliseconds-before;
        maxQueryMs=Math.Max(maxQueryMs,elapsed);
        if(success!=IntPtr.Zero) return true;
        Increment(QueryFailures,Category(window)+":"+(message==0x84?"hit":"title")+":error="+error);
        return false;
    }
    class SettingSnapshot {
        public bool spiSuccess; public bool? spiWindowArranging;
        public object windowArrangementActive,enableSnapAssistFlyout;
        public string arrangementRead,flyoutRead;
    }
    static object ReadSetting(string path,string name,RegistryValueKind expected,out string state) {
        try {
            using(var key=Registry.CurrentUser.OpenSubKey(path)) {
                if(key==null || key.GetValue(name)==null) { state="missing"; return null; }
                if(key.GetValueKind(name)!=expected) { state="wrong-type"; return null; }
                object value=key.GetValue(name);
                if((expected==RegistryValueKind.String && ((string)value=="0" || (string)value=="1")) ||
                   (expected==RegistryValueKind.DWord && ((int)value==0 || (int)value==1))) { state="known"; return value; }
                state="invalid-value"; return null;
            }
        } catch { state="read-failed"; return null; }
    }
    static SettingSnapshot Settings() {
        int value; bool ok=SystemParametersInfoW(0x0082,0,out value,0);
        var snapshot=new SettingSnapshot {spiSuccess=ok,spiWindowArranging=ok?(bool?)(value!=0):null};
        snapshot.windowArrangementActive=ReadSetting("Control Panel\\Desktop","WindowArrangementActive",RegistryValueKind.String,out snapshot.arrangementRead);
        snapshot.enableSnapAssistFlyout=ReadSetting("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced","EnableSnapAssistFlyout",RegistryValueKind.DWord,out snapshot.flyoutRead);
        return snapshot;
    }
    // Experimental, deliberately conservative policy. A missing preference is not evidence of ON.
    static bool? Gate(SettingSnapshot snapshot,bool hover) {
        if(!snapshot.spiSuccess || snapshot.spiWindowArranging==null || snapshot.arrangementRead!="known") return null;
        bool arrangement=(string)snapshot.windowArrangementActive=="1";
        if(arrangement!=snapshot.spiWindowArranging.Value) return null;
        if(!arrangement) return false;
        if(!hover) return true;
        if(snapshot.flyoutRead!="known") return null;
        return (int)snapshot.enableSnapAssistFlyout==1;
    }
    static int? GatedCount(SettingSnapshot snapshot,bool hover,int raw,bool stable) {
        bool? enabled=stable?Gate(snapshot,hover):null;
        return enabled==null?(int?)null:enabled.Value?raw:0;
    }
    static bool Nonempty(Rect rect) { return rect.Right>rect.Left && rect.Bottom>rect.Top; }
    static bool Contains(Rect rect,Point point) { return point.X>=rect.Left && point.X<rect.Right && point.Y>=rect.Top && point.Y<rect.Bottom; }
    static bool Within(Rect inner,Rect outer) { return inner.Left>=outer.Left && inner.Top>=outer.Top && inner.Right<=outer.Right && inner.Bottom<=outer.Bottom; }
    static bool Overlaps(Rect a,Rect b) { return a.Left<b.Right && b.Left<a.Right && a.Top<b.Bottom && b.Top<a.Bottom; }
    // null means the returned geometry cannot be trusted. "empty" is a successful API response,
    // not a timeout: only that case permits the custom-caption hit-test fallback.
    static string CaptionSource(TitleInfo info,Rect window) {
        if(!Nonempty(info.Bounds[2]) && !Nonempty(info.Bounds[3]) && !Nonempty(info.Bounds[5])) return "hit-fallback";
        Rect max=info.Bounds[3],close=info.Bounds[5],min=info.Bounds[2];
        if(!Nonempty(max) || !Nonempty(close) || !Within(max,window) || !Within(close,window) || Overlaps(max,close) ||
           (Nonempty(min) && (!Within(min,window) || Overlaps(min,max) || Overlaps(min,close)))) return null;
        return "title-rect";
    }
    static bool ReadTitle(IntPtr window,out TitleInfo info) {
        info=new TitleInfo {Size=(uint)Marshal.SizeOf(typeof(TitleInfo)),State=new uint[6],Bounds=new Rect[6]};
        IntPtr memory=Marshal.AllocHGlobal((int)info.Size);
        try {
            Marshal.StructureToPtr(info,memory,false); UIntPtr ignored;
            if(!Query(window,0x33f,memory,out ignored)) return false;
            info=(TitleInfo)Marshal.PtrToStructure(memory,typeof(TitleInfo)); return true;
        } finally { Marshal.FreeHGlobal(memory); }
    }
    static string Category(IntPtr window) {
        if(window==IntPtr.Zero) return "none";
        if(target!=null && target.IsHandleCreated && window==target.Handle) return "standard-fixture";
        if(panel!=null && panel.IsHandleCreated && window==panel.Handle) return "probe-panel";
        var name=new StringBuilder(256); GetClassName(window,name,name.Capacity);
        string cls=name.ToString();
        if(window==GetDesktopWindow() || window==GetShellWindow() || cls=="Progman" || cls=="WorkerW" ||
           cls=="Shell_TrayWnd" || cls=="Shell_SecondaryTrayWnd") return "desktop-shell";
        uint pid; GetWindowThreadProcessId(window,out pid);
        try { using(var p=Process.GetProcessById((int)pid)) if(p.ProcessName.Equals("chrome",StringComparison.OrdinalIgnoreCase)) return "chrome"; }
        catch { return "unknown"; }
        return "other-app";
    }
    static bool Eligible(IntPtr window) {
        string category=Category(window);
        if(category=="none" || category=="desktop-shell" || category=="probe-panel" || category=="unknown") return false;
        // A candidate filter, not a proof that this app supports Snap Layout.
        uint style=unchecked((uint)GetStyle(window,-16));
        return IsWindowVisible(window) && !IsIconic(window) && (style & 0x40000000)==0 && (style & 0x10000)!=0 && (style & 0x40000)!=0;
    }
    static void Count(IntPtr window,int index) {
        int[] counts; if(!Targets.TryGetValue(window,out counts)) { counts=new int[3]; Targets.Add(window,counts); }
        counts[index]++;
        if(GetForegroundWindow()==window) counts[2]++;
    }
    static IntPtr OnKey(int code,IntPtr message,IntPtr data) {
        if(code>=0 && observing) {
            hookCallbacks++;
            var key=(KeyData)Marshal.PtrToStructure(data,typeof(KeyData));
            if(key.Key==0x5a || key.Key==0x5b || key.Key==0x5c || key.Key==0x10 || key.Key==0x11 || key.Key==0x12 || (key.Key>=0xa0 && key.Key<=0xa5)) {
                if(key.Key==0x5a) zEvents++; else if(key.Key==0x5b || key.Key==0x5c) winEvents++;
                bool down=message.ToInt64()==0x100 || message.ToInt64()==0x104;
                bool injected=(key.Flags & 0x12)!=0;
                if(injected) injectedKeys++;
                if(keys.Step(key.Key,down,injected)) PendingKeys.Enqueue(GetAncestor(GetForegroundWindow(),2));
                else if(key.Key==0x5a && down && !injected) repeats++;
            }
        }
        return CallNextHookEx(hook,code,message,data);
    }
    static void Tick() {
        if(!observing) return;
        IntPtr previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
        if(previous==IntPtr.Zero) { dpiFailures++; dwell.Step(IntPtr.Zero,Clock.ElapsedMilliseconds,(int)threshold.Value,false); return; }
        try { TickCore(); } finally { SetThreadDpiAwarenessContext(previous); }
    }
    static void TickCore() {
        while(PendingKeys.Count>0) {
            IntPtr window=PendingKeys.Dequeue();
            if(Eligible(window)) { keyCalls++; Count(window,0); }
            else {
                string reason=Category(window); if(reason=="desktop-shell") desktopKeys++;
                int count; Rejections.TryGetValue(reason,out count); Rejections[reason]=count+1;
            }
        }
        polls++;
        string currentHit="outside eligible window";
        long pollAt=Clock.ElapsedMilliseconds; maxPollGapMs=Math.Max(maxPollGapMs,pollAt-lastPoll); lastPoll=pollAt;
        Point point; IntPtr candidate=IntPtr.Zero; string captionSource=null; bool knownExit=false;
        if(GetPhysicalCursorPos(out point)) {
            IntPtr window=GetAncestor(WindowFromPoint(point),2);
            if(Eligible(window)) {
                eligibleSamples++;
                UIntPtr hit; bool hitSuccess=false; long code=0;
                long packed=unchecked((int)(((point.Y & 0xffff)<<16) | (point.X & 0xffff)));
                // Own fixture dispatch is synchronous; external requests abort at 30 ms.
                if(point.X<short.MinValue || point.X>short.MaxValue || point.Y<short.MinValue || point.Y>short.MaxValue) {
                    currentHit="coordinates outside signed hit-test range";
                }
                else if(!Query(window,0x84,new IntPtr(packed),out hit)) { hitTimeouts++; currentHit=Category(window)+": query failed"; }
                else {
                    hitSuccess=true; code=unchecked((long)hit.ToUInt64());
                    currentHit=Category(window)+":"+(code==9?"maximize":code==8?"minimize":code==20?"close":"other");
                    Increment(HitResults,currentHit);
                    if(code==9) hitMatches++;
                }
                TitleInfo info; Rect bounds;
                if(!ReadTitle(window,out info)) titleTimeouts++;
                else if(GetWindowRect(window,out bounds)) {
                    captionSource=CaptionSource(info,bounds);
                    bool titleMax=Nonempty(info.Bounds[3]) && (info.State[3]&0x18001)==0 && Contains(info.Bounds[3],point);
                    if(titleMax) titleMatches++;
                    if(captionSource=="title-rect") {
                        if(titleMax) candidate=window;
                        else knownExit=true;
                        if(hitSuccess && titleMax!=(code==9)) geometryDisagreements++;
                    } else if(captionSource=="hit-fallback" && hitSuccess) { if(code==9) candidate=window; else knownExit=true; }
                    Point after; Rect afterBounds;
                    if(!GetPhysicalCursorPos(out after) || GetAncestor(WindowFromPoint(after),2)!=window ||
                       !GetWindowRect(window,out afterBounds) || !bounds.Equals(afterBounds) ||
                       (candidate!=IntPtr.Zero && (captionSource=="title-rect"?!Contains(info.Bounds[3],after):after.X!=point.X || after.Y!=point.Y))) {
                        candidate=IntPtr.Zero; knownExit=false; unstableSamples++;
                    }
                    Increment(CaptionSources,Category(window)+":"+(captionSource ?? "unknown"));
                    currentHit+=" / chosen="+(captionSource ?? "unknown")+(candidate!=IntPtr.Zero?":MAX":"");
                }
            }
            else if(window!=IntPtr.Zero) knownExit=true;
        }
        else cursorFailures++;
        if((GetAsyncKeyState(1)&0x8000)!=0 || (GetAsyncKeyState(2)&0x8000)!=0 || (GetAsyncKeyState(4)&0x8000)!=0 ||
           (GetAsyncKeyState(5)&0x8000)!=0 || (GetAsyncKeyState(6)&0x8000)!=0) {
            candidate=IntPtr.Zero; knownExit=false; buttonHeldSamples++;
        }
        if(captionSource!=lastCaptionSource) dwell.Step(IntPtr.Zero,Clock.ElapsedMilliseconds,(int)threshold.Value,false);
        lastCaptionSource=captionSource;
        if(dwell.Step(candidate,Clock.ElapsedMilliseconds,(int)threshold.Value,knownExit)) { hoverCalls++; Count(candidate,1); }
        targetStatus.Text="Maximize / restore is the square button immediately LEFT of X.\nLive hit: "+currentHit+
            "\nMaximize samples: "+hitMatches+"   Hover candidates: "+hoverCalls;
        status.Text="OBSERVING  Win+Z="+keyCalls+"  hover="+hoverCalls+"  desktop excluded="+desktopKeys+
            "  hit/timeouts="+hitMatches+"/"+hitTimeouts;
        if(Clock.ElapsedMilliseconds-started>=60000) EndTrial("timeout-unknown");
    }
    static void StartTrial() {
        if(observing) return;
        if((GetAsyncKeyState(0x5b)&0x8000)!=0 || (GetAsyncKeyState(0x5c)&0x8000)!=0 || (GetAsyncKeyState(0x5a)&0x8000)!=0 ||
           (GetAsyncKeyState(0x10)&0x8000)!=0 || (GetAsyncKeyState(0x11)&0x8000)!=0 || (GetAsyncKeyState(0x12)&0x8000)!=0) {
            status.Text="Release Win, Z, Shift, Ctrl and Alt, then arm."; return;
        }
        startSettings=Settings(); keys=new Keys(); dwell=new Dwell(); Targets.Clear(); PendingKeys.Clear();
        keyCalls=hoverCalls=repeats=hitTimeouts=titleTimeouts=titleMatches=hitMatches=desktopKeys=injectedKeys=0;
        hookCallbacks=winEvents=zEvents=cursorFailures=eligibleSamples=polls=0; Rejections.Clear();
        QueryFailures.Clear(); HitResults.Clear(); maxQueryMs=maxPollGapMs=0; lastPoll=Clock.ElapsedMilliseconds; buttonHeldSamples=0;
        CaptionSources.Clear(); lastCaptionSource=null; geometryDisagreements=unstableSamples=dpiFailures=0;
        hook=SetWindowsHookExW(13,callback,GetModuleHandleW(null),0);
        if(hook==IntPtr.Zero) { status.Text="HOOK FAILED: "+Marshal.GetLastWin32Error(); return; }
        oracle.SelectedIndex=0; // Never carry the previous trial's display answer into a new trial.
        started=Clock.ElapsedMilliseconds; observing=true; trialNumber++;
        cases.Enabled=application.Enabled=activeState.Enabled=threshold.Enabled=arm.Enabled=false;
        finish.Enabled=true; status.Text="OBSERVING (60 seconds maximum). Perform one trial; select observed display and Finish.";
    }
    static void EndTrial(string outcome) {
        if(!observing) return;
        observing=false; bool unhooked=UnhookWindowsHookEx(hook); hook=IntPtr.Zero;
        // Drain only keys already captured before stopping; no observation occurs after finish.
        while(PendingKeys.Count>0) { var w=PendingKeys.Dequeue(); if(Eligible(w)) { keyCalls++; Count(w,0); } else if(Category(w)=="desktop-shell") desktopKeys++; }
        var targets=new List<object>();
        foreach(var pair in Targets) targets.Add(new {id=targets.Count+1,category=Category(pair.Key),key=pair.Value[0],hover=pair.Value[1],foregroundAtCount=pair.Value[2]});
        var endSettings=Settings(); bool stable=Json.Serialize(startSettings)==Json.Serialize(endSettings);
        var result=new {kind="trial",trial=trialNumber,scenario=cases.SelectedIndex+1,application=application.SelectedItem,
            requestedActiveState=activeState.SelectedItem,displayOracle=outcome,thresholdMs=(int)threshold.Value,
            settingsBefore=startSettings,settingsAfter=endSettings,rawKeyCandidates=keyCalls,rawHoverCandidates=hoverCalls,
            desktopExcluded=desktopKeys,zDownWithoutNewChord=repeats,injectedRelevantKeyEvents=injectedKeys,
            hitSamples=hitMatches,titleBoundsSamples=titleMatches,hitQueryFailures=hitTimeouts,titleQueryFailures=titleTimeouts,
            hookCallbacks=hookCallbacks,winKeyEvents=winEvents,zKeyEvents=zEvents,keyTargetRejections=Rejections,
            cursorQueryFailures=cursorFailures,eligibleCursorSamples=eligibleSamples,pollCount=polls,
            queryFailures=QueryFailures,hitResults=HitResults,maxQueryMs=maxQueryMs,maxPollGapMs=maxPollGapMs,buttonHeldSamples=buttonHeldSamples,
            captionSources=CaptionSources,geometryDisagreements=geometryDisagreements,unstableSamples=unstableSamples,dpiFailures=dpiFailures,
            targets=targets,hookRemoved=unhooked,settingsStable=stable,
            experimentalGatedKeyCandidates=GatedCount(startSettings,false,keyCalls,stable),
            experimentalGatedHoverCandidates=GatedCount(startSettings,true,hoverCalls,stable),displayProven=false};
        File.AppendAllText(output,Json.Serialize(result)+Environment.NewLine,new UTF8Encoding(false));
        cases.Enabled=application.Enabled=activeState.Enabled=threshold.Enabled=arm.Enabled=true; finish.Enabled=false;
        status.Text="SAVED trial "+trialNumber+": Win+Z="+keyCalls+", hover="+hoverCalls+", oracle="+outcome+". Observation stopped.";
    }
    static int assertions;
    static void Check(bool condition,string name) { assertions++; if(!condition) throw new Exception(name); }
    static bool Advance(Dwell dwell,IntPtr target,long start,long end) {
        bool fired=false; for(long at=start;at<=end;at+=50) fired=dwell.Step(target,at,500) || fired; return fired;
    }
    static void SelfTest() {
        var d=new Dwell(); IntPtr a=new IntPtr(1),b=new IntPtr(2);
        Check(!Advance(d,a,0,450),"below"); Check(!d.Step(a,499,500),"just below"); Check(d.Step(a,500,500),"threshold");
        Check(!Advance(d,a,550,900),"no duplicate"); Check(!d.Step(IntPtr.Zero,901,500),"leave");
        Check(!Advance(d,a,902,1352),"reenter"); Check(d.Step(a,1402,500),"reenter fires");
        Check(!Advance(d,b,1403,1853),"target switch"); Check(d.Step(b,1903,500),"second target");
        Check(!d.Step(b,2204,500),"long observation gap resets dwell");
        Check(!Advance(d,b,2254,2704),"gap must not rearm an already counted hover");
        Check(!d.Step(IntPtr.Zero,2754,500),"failed query resets dwell");
        Check(!Advance(d,b,2804,3254),"failure cannot bridge dwell");
        Check(d.Step(b,3304,500),"confirmed exit permits reentry");
        Check(!d.Step(IntPtr.Zero,3354,500,false),"unknown sample is not an exit");
        Check(!Advance(d,b,3404,3904),"unknown sample must not rearm counted hover");
        var pendingGap=new Dwell(); Advance(pendingGap,a,0,450);
        Check(!pendingGap.Step(a,751,500),"gap resets a pending dwell");
        Check(Advance(pendingGap,a,801,1251),"fresh full dwell after pending gap");
        var k=new Keys(); Check(!k.Step(0x5a,true,false),"z alone"); k.Step(0x5a,false,false);
        k.Step(0x5b,true,false); Check(k.Step(0x5a,true,false),"win z"); Check(!k.Step(0x5a,true,false),"repeat");
        k.Step(0x5a,false,false); Check(k.Step(0x5a,true,false),"second press"); k.Step(0x5a,false,false);
        k.Step(0x5b,false,false); k.Step(0x5c,true,false); Check(k.Step(0x5a,true,false),"right win");
        Check(!new Keys().Step(0x5b,true,true),"injection");
        var mixed=new Keys(); mixed.Step(0x5b,true,true); Check(!mixed.Step(0x5a,true,false),"injected modifier ignored");
        mixed.Step(0x5a,false,false); mixed.Step(0x5b,true,false);
        Check(!mixed.Step(0x5a,true,false),"injection requires a fresh neutral observation epoch");
        foreach(uint modifier in new uint[]{0xa0,0xa1,0xa2,0xa3,0xa4,0xa5}) {
            var modified=new Keys(); modified.Step(modifier,true,false); modified.Step(0x5b,true,false);
            Check(!modified.Step(0x5a,true,false),"extra modifier rejected");
            modified.Step(modifier,false,false); Check(!modified.Step(0x5a,true,false),"held z not retriggered");
            modified.Step(0x5a,false,false); Check(modified.Step(0x5a,true,false),"fresh unmodified chord accepted");
        }
        var settings=new SettingSnapshot {spiSuccess=true,spiWindowArranging=true,windowArrangementActive="1",arrangementRead="known",flyoutRead="missing"};
        Check(Gate(settings,false)==true,"missing flyout does not disable keyboard");
        Check(Gate(settings,true)==null,"missing hover preference is unknown");
        settings.flyoutRead="known"; settings.enableSnapAssistFlyout=0;
        Check(Gate(settings,false)==true && Gate(settings,true)==false,"hover off affects hover only");
        settings.enableSnapAssistFlyout=1; Check(Gate(settings,true)==true,"explicit hover on");
        settings.spiWindowArranging=false; Check(Gate(settings,false)==null,"inconsistent sources are unknown");
        settings.windowArrangementActive="0"; Check(Gate(settings,false)==false && Gate(settings,true)==false,"snap off affects both");
        settings.spiSuccess=false; Check(Gate(settings,false)==null,"failed SPI is unknown");
        settings.spiSuccess=true; settings.spiWindowArranging=true; settings.windowArrangementActive="1";
        foreach(string state in new string[]{"missing","wrong-type","invalid-value","read-failed"}) {
            settings.flyoutRead=state; Check(Gate(settings,true)==null,"invalid hover source is unknown");
        }
        Check(GatedCount(settings,false,1,false)==null,"changed settings invalidate trial");
        var title=new TitleInfo {State=new uint[6],Bounds=new Rect[6]};
        var window=new Rect {Left=0,Top=0,Right=300,Bottom=200};
        Check(CaptionSource(title,window)=="hit-fallback","successful empty geometry permits fallback");
        title.Bounds[2]=new Rect {Left=180,Top=0,Right=220,Bottom=30};
        title.Bounds[3]=new Rect {Left=220,Top=0,Right=260,Bottom=30};
        title.Bounds[5]=new Rect {Left=260,Top=0,Right=300,Bottom=30};
        Check(CaptionSource(title,window)=="title-rect","valid caption geometry preferred");
        Check(Contains(title.Bounds[3],new Point {X=220,Y=0}),"rectangle includes left top");
        Check(!Contains(title.Bounds[3],new Point {X=260,Y=15}),"close boundary is not maximize");
        title.Bounds[5].Left=250; Check(CaptionSource(title,window)==null,"overlap is unknown");
        title.Bounds[5].Left=260; title.Bounds[3].Top=-1;
        Check(CaptionSource(title,window)==null,"out of window is unknown");
        title.Bounds[3]=new Rect(); Check(CaptionSource(title,window)==null,"partial geometry does not permit fallback");
        Console.WriteLine("SNAP_INVOCATION_SELF_TEST_OK ("+assertions+" assertions; no live observation)");
    }
    // Message-only fixture in a separate process. No input hooks or user-window queries.
    class SlowWindow : NativeWindow {
        public SlowWindow() { CreateHandle(new CreateParams {Parent=new IntPtr(-3)}); }
        protected override void WndProc(ref Message message) {
            if(message.Msg==0x84) { System.Threading.Thread.Sleep(250); message.Result=new IntPtr(9); return; }
            base.WndProc(ref message);
        }
    }
    static void QuerySelfTest() {
        using(var process=Process.Start(new ProcessStartInfo {
            FileName=Process.GetCurrentProcess().MainModule.FileName,Arguments="--query-target",
            UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true
        })) {
            try {
                var window=new IntPtr(long.Parse(process.StandardOutput.ReadLine()));
                UIntPtr result; bool success=Query(window,0x84,IntPtr.Zero,out result);
                Check(!success,"slow external window must not become a positive hit");
                Check(maxQueryMs<1000,"query must return before fixture process deadline");
                var pending=new Dwell(); Advance(pending,window,0,450);
                Check(!pending.Step(success?window:IntPtr.Zero,500,500,false),"failed query cannot complete pending dwell");
                Check(!Advance(pending,window,550,1000),"failure requires a fresh full dwell");
                Check(pending.Step(window,1050,500),"later successful full dwell can recover");
                Console.WriteLine(Json.Serialize(new {kind="query-self-test",failures=QueryFailures,maxQueryMs=maxQueryMs,liveObservation=false}));
                Console.WriteLine("SNAP_INVOCATION_QUERY_SELF_TEST_OK");
            } finally { if(!process.HasExited) process.Kill(); process.WaitForExit(); }
        }
    }
    class GeometryForm : Form { protected override bool ShowWithoutActivation { get { return true; } } }
    static void GeometrySelfTest() {
        bool set=SetProcessDpiAwarenessContext(new IntPtr(-4));
        Application.EnableVisualStyles();
        using(var form=new GeometryForm {Text="Issue 83 isolated geometry fixture",Width=650,Height=400}) {
            target=form;
            var timer=new System.Windows.Forms.Timer {Interval=500};
            timer.Tick+=(s,e)=> {
                timer.Stop();
                try {
                    var info=new TitleInfo {Size=(uint)Marshal.SizeOf(typeof(TitleInfo)),State=new uint[6],Bounds=new Rect[6]};
                    IntPtr memory=Marshal.AllocHGlobal((int)info.Size);
                    try {
                        Marshal.StructureToPtr(info,memory,false); UIntPtr result;
                        Check(Query(form.Handle,0x33f,memory,out result),"own title query");
                        info=(TitleInfo)Marshal.PtrToStructure(memory,typeof(TitleInfo));
                        var rows=new List<object>();
                        foreach(int index in new int[]{2,3,5}) {
                            Rect rect=info.Bounds[index];
                            var physical=new Point {X=(rect.Left+rect.Right)/2,Y=(rect.Top+rect.Bottom)/2};
                            var logical=physical; bool converted=PhysicalToLogicalPointForPerMonitorDPI(form.Handle,ref logical);
                            Func<Point,object> hit=point=> {
                                long packed=unchecked((int)(((point.Y & 0xffff)<<16) | (point.X & 0xffff)));
                                UIntPtr code; bool ok=Query(form.Handle,0x84,new IntPtr(packed),out code);
                                return new {success=ok,code=ok?(long?)unchecked((long)code.ToUInt64()):null};
                            };
                            var grid=new List<object>();
                            foreach(int y in new int[]{20,50,80}) foreach(int x in new int[]{20,50,80})
                                grid.Add(new {xPercent=x,yPercent=y,result=hit(new Point {X=rect.Left+(rect.Right-rect.Left)*x/100,Y=rect.Top+(rect.Bottom-rect.Top)*y/100})});
                            rows.Add(new {element=index,nonempty=rect.Right>rect.Left && rect.Bottom>rect.Top,
                                physicalHit=hit(physical),convertedHit=converted?hit(logical):null,conversionChanged=physical.X!=logical.X || physical.Y!=logical.Y,grid=grid});
                        }
                        Console.WriteLine(Json.Serialize(new {kind="geometry-self-test",processDpiSet=set,
                            threadAwareness=GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext()),
                            targetAwareness=GetAwarenessFromDpiAwarenessContext(GetWindowDpiAwarenessContext(form.Handle)),
                            targetDpi=GetDpiForWindow(form.Handle),rows=rows,liveInputObserved=false}));
                        Console.WriteLine("SNAP_INVOCATION_GEOMETRY_SELF_TEST_COMPLETE");
                    } finally { Marshal.FreeHGlobal(memory); }
                } finally { form.Close(); }
            };
            form.Shown+=(s,e)=>timer.Start();
            try { Application.Run(form); } finally { timer.Dispose(); }
        }
    }
    [STAThread] static int Main(string[] args) {
        if(args.Length==1 && args[0]=="--self-test") { SelfTest(); return 0; }
        if(args.Length==1 && args[0]=="--query-self-test") { QuerySelfTest(); return 0; }
        if(args.Length==1 && args[0]=="--geometry-self-test") { GeometrySelfTest(); return 0; }
        if(args.Length==1 && args[0]=="--query-target") {
            var window=new SlowWindow(); Console.WriteLine(window.Handle.ToInt64()); Console.Out.Flush();
            var deadline=new System.Windows.Forms.Timer {Interval=3000}; deadline.Tick+=(s,e)=>Application.ExitThread(); deadline.Start();
            try { Application.Run(); } finally { deadline.Dispose(); window.DestroyHandle(); } return 0;
        }
        if(args.Length!=2 || args[0]!="--observe-consented") return 2;
        output=args[1]; SetProcessDpiAwarenessContext(new IntPtr(-4));
        var os=new OsVersion(); os.Size=(uint)Marshal.SizeOf(typeof(OsVersion)); int osResult=RtlGetVersion(ref os);
        File.AppendAllText(output,Json.Serialize(new {kind="environment",osVersionSuccess=osResult==0,build=os.Build,
            session=Process.GetCurrentProcess().SessionId,initialSettings=Settings(),noRawInputSaved=true})+Environment.NewLine,new UTF8Encoding(false));
        Application.EnableVisualStyles();
        target=new Form {Text="Snap Invocation - isolated standard target",Width=650,Height=400,StartPosition=FormStartPosition.Manual,Location=new PointDrawing(70,140)};
        targetStatus=new Label {Text="Maximize / restore is the square button immediately LEFT of X.\nThe panel must be armed first. No product data is used.",Dock=DockStyle.Fill,TextAlign=ContentAlignment.MiddleCenter};
        target.Controls.Add(targetStatus);
        target.Show();
        panel=new Form {Text="Issue 83 - Snap invocation research",Width=850,Height=400,StartPosition=FormStartPosition.Manual,Location=new PointDrawing(750,140)};
        var layout=new FlowLayoutPanel {Dock=DockStyle.Fill,FlowDirection=FlowDirection.TopDown,WrapContents=false,Padding=new Padding(12)}; panel.Controls.Add(layout);
        layout.Controls.Add(new Label {Text="Choose case/app, ARM, perform ONE trial, choose actual display, FINISH.\nOnly armed trials observe Win/Z and maximize hover. Auto-stop at 60 seconds.",Width=800,Height=42});
        cases=new ComboBox {Width=760,DropDownStyle=ComboBoxStyle.DropDownList}; cases.Items.AddRange(Cases); cases.SelectedIndex=0; layout.Controls.Add(cases);
        application=new ComboBox {Width=760,DropDownStyle=ComboBoxStyle.DropDownList}; application.Items.AddRange(new object[]{"standard-fixture","chrome","desktop-shell","other-app"}); application.SelectedIndex=0; layout.Controls.Add(application);
        activeState=new ComboBox {Width=760,DropDownStyle=ComboBoxStyle.DropDownList}; activeState.Items.AddRange(new object[]{"active target","inactive target","desktop focused"}); activeState.SelectedIndex=0; layout.Controls.Add(activeState);
        threshold=new NumericUpDown {Minimum=100,Maximum=3000,Increment=100,Value=500,Width=150}; layout.Controls.Add(threshold);
        arm=new Button {Text="ARM trial (60s max)",Width=250}; arm.Click+=(s,e)=>StartTrial(); layout.Controls.Add(arm);
        oracle=new ComboBox {Width=760,DropDownStyle=ComboBoxStyle.DropDownList}; oracle.Items.AddRange(new object[]{"unknown","displayed","not-displayed","cancelled"}); oracle.SelectedIndex=0; layout.Controls.Add(oracle);
        finish=new Button {Text="FINISH / save display oracle",Width=300,Enabled=false}; finish.Click+=(s,e)=>EndTrial((string)oracle.SelectedItem); layout.Controls.Add(finish);
        status=new Label {Width=800,Height=50,Text="Idle. No observation. Settings are read only."}; layout.Controls.Add(status);
        var timer=new System.Windows.Forms.Timer {Interval=50}; timer.Tick+=(s,e)=>Tick(); timer.Start();
        panel.FormClosing+=(s,e)=>EndTrial("cancelled");
        panel.Shown+=(s,e)=> { Console.WriteLine("SNAP_INVOCATION_READY (idle; arm via panel)"); Console.Out.Flush(); };
        try { Application.Run(panel); } finally { timer.Stop(); if(hook!=IntPtr.Zero) UnhookWindowsHookEx(hook); target.Dispose(); }
        Console.WriteLine("SNAP_INVOCATION_CLOSED"); return 0;
    }
}
