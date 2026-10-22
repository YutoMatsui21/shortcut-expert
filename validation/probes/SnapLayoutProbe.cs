// Authorized research only: no hooks, input injection, names, titles or screenshots.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;
using Accessibility;

class SnapLayoutProbe {
    delegate bool EnumProc(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left,Top,Right,Bottom; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out Rect rect);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr window, uint objectId, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object accessible);
    [DllImport("oleacc.dll")] static extern int AccessibleChildren(IAccessible accessible, int start, int count, [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex=2)] object[] children, out int obtained);
    [DllImport("oleacc.dll")] static extern int WindowFromAccessibleObject(IAccessible accessible, out IntPtr window);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct OsVersion {
        public uint Size, Major, Minor, Build, Platform;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string ServicePack;
    }
    [DllImport("ntdll.dll", CharSet=CharSet.Unicode)] static extern int RtlGetVersion(ref OsVersion version);
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
    static string FailureStage="arguments";
    static readonly HashSet<string> Hosts=new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        "explorer", "ShellHost", "ShellExperienceHost", "StartMenuExperienceHost", "ApplicationFrameHost"
    };
    static void Emit(object value) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); }
    static string Role(string id) {
        return id.IndexOf("Snap",StringComparison.OrdinalIgnoreCase)>=0 ? "snap-hypothesis" : "unclassified";
    }
    static string ClassCategory(string name) {
        switch(name) {
            case "XamlExplorerHostIslandWindow": case "Windows.UI.Core.CoreWindow":
            case "Shell_TrayWnd": case "Shell_SecondaryTrayWnd": case "tooltips_class32": return name;
            default: return "other-shell-class";
        }
    }
    static bool OwnerMatches(IntPtr window, IntPtr target) {
        for(int i=0;i<8 && window!=IntPtr.Zero;i++) {
            window=GetWindow(window,4);
            if(window!=IntPtr.Zero && window==target) return true;
        }
        return false;
    }
    class Pending {
        public AutomationElement Element; public int Depth, Parent;
        public Pending(AutomationElement e,int d,int p) { Element=e; Depth=d; Parent=p; }
    }
    static void Uia(IntPtr window,uint pid,int root) {
        var queue=new Queue<Pending>();
        queue.Enqueue(new Pending(AutomationElement.FromHandle(window),0,-1));
        int nodes=0,failures=0,excluded=0; bool limited=false;
        var walker=TreeWalker.RawViewWalker;
        while(queue.Count>0 && nodes<256) {
            var item=queue.Dequeue(); int index=nodes++;
            try {
                var current=item.Element.Current;
                if(current.ProcessId!=(int)pid) { excluded++; continue; }
                Emit(new {kind="uia-node",root=root,index=index,parent=item.Parent,depth=item.Depth,
                    controlType=current.ControlType.Id,role=Role(current.AutomationId ?? ""),offscreen=current.IsOffscreen});
                if(item.Depth>=8 || nodes+queue.Count>=256) { limited=true; continue; }
                var child=walker.GetFirstChild(item.Element);
                while(child!=null) {
                    if(nodes+queue.Count>=256) { limited=true; break; }
                    queue.Enqueue(new Pending(child,item.Depth+1,index));
                    if(nodes+queue.Count>=256) { limited=true; break; }
                    child=walker.GetNextSibling(child);
                }
            } catch { failures++; }
        }
        Emit(new {kind="uia-end",root=root,nodes=nodes,failures=failures,excluded=excluded,
            limited=limited,completed=failures==0 && excluded==0 && !limited && queue.Count==0});
    }
    static void Msaa(IntPtr window,uint pid,int root) {
        Guid iid=new Guid("618736E0-3C3D-11CF-810C-00AA00389B71"); object value;
        int hr=AccessibleObjectFromWindow(window,0xFFFFFFFC,ref iid,out value);
        var accessible=value as IAccessible;
        if(hr<0 || accessible==null) { Emit(new {kind="msaa-end",root=root,available=false,completed=false}); return; }
        int nodes=0,failures=0; bool limited=false;
        var queue=new Queue<Tuple<IAccessible,object,int,int>>();
        queue.Enqueue(Tuple.Create(accessible,(object)0,0,-1));
        while(queue.Count>0 && nodes<128) {
            var item=queue.Dequeue(); int index=nodes++;
            try {
                IntPtr hostWindow; uint hostPid;
                if(WindowFromAccessibleObject(item.Item1,out hostWindow)<0 || hostWindow==IntPtr.Zero ||
                    GetWindowThreadProcessId(hostWindow,out hostPid)==0 || hostPid!=pid) { failures++; continue; }
                object role=item.Item1.get_accRole(item.Item2),state=item.Item1.get_accState(item.Item2);
                bool full=item.Item2 is int && (int)item.Item2==0;
                int count=full ? item.Item1.accChildCount : 0;
                Emit(new {kind="msaa-node",root=root,index=index,parent=item.Item4,depth=item.Item3,
                    role=role is int ? (int)role : -1,state=state is int ? (int)state : -1,childCount=count});
                if(count<=0) continue;
                if(item.Item3>=6) { limited=true; continue; }
                int take=Math.Min(count,128-nodes-queue.Count);
                if(take<count) limited=true;
                if(take<=0) continue;
                var children=new object[take]; int obtained;
                int result=AccessibleChildren(item.Item1,0,take,children,out obtained);
                if(result<0 || obtained!=take) failures++;
                for(int i=0;i<Math.Max(0,Math.Min(obtained,take));i++) {
                    var child=children[i] as IAccessible;
                    if(child!=null) queue.Enqueue(Tuple.Create(child,(object)0,item.Item3+1,index));
                    else if(children[i] is int) queue.Enqueue(Tuple.Create(item.Item1,children[i],item.Item3+1,index));
                    else failures++;
                }
            } catch { failures++; }
        }
        Emit(new {kind="msaa-end",root=root,available=true,nodes=nodes,failures=failures,
            limited=limited,completed=failures==0 && !limited && queue.Count==0});
    }
    // Three fixed points beneath our fixture's maximize button; no cursor or text reads.
    static void PointHosts(IntPtr target,int targetPid) {
        IntPtr previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
        if(previous==IntPtr.Zero) { Emit(new {kind="point-failure",stage="dpi-context"}); return; }
        try {
            Rect rect;
            if(!GetWindowRect(target,out rect)) { Emit(new {kind="point-failure",stage="target-bounds"}); return; }
            for(int point=0;point<3;point++) {
                try {
                    var element=AutomationElement.FromPoint(new System.Windows.Point(rect.Right-80-point*100,rect.Top+100+point*40));
                    for(int depth=0;depth<8 && element!=null;depth++) {
                        int pid=element.Current.ProcessId;
                        if(pid==targetPid) { Emit(new {kind="point-exclusion",point=point,depth=depth,reason="fixture"}); break; }
                        if(pid<=0) { Emit(new {kind="point-exclusion",point=point,depth=depth,reason="no-process"}); break; }
                        using(var process=Process.GetProcessById(pid)) {
                            if(!Hosts.Contains(process.ProcessName)) {
                                Emit(new {kind="point-exclusion",point=point,depth=depth,reason="outside-shell-scope"}); break;
                            }
                            var current=element.Current;
                            Emit(new {kind="point-host",point=point,depth=depth,host=process.ProcessName,
                                hostClass=ClassCategory(current.ClassName),controlType=current.ControlType.Id,
                                role=Role(current.AutomationId ?? ""),offscreen=current.IsOffscreen});
                        }
                        if(depth<7) element=TreeWalker.RawViewWalker.GetParent(element);
                    }
                } catch { Emit(new {kind="point-failure",point=point,stage="provider"}); }
            }
        } finally { SetThreadDpiAwarenessContext(previous); }
    }
    static void Snapshot(int targetPid,bool xamlOnly) {
        FailureStage="target-process";
        IntPtr target;
        using(var process=Process.GetProcessById(targetPid)) {
            if(!String.Equals(process.MainModule.FileName,Process.GetCurrentProcess().MainModule.FileName,StringComparison.OrdinalIgnoreCase))
                throw new Exception("Target is not this probe");
            FailureStage="target-window";
            target=process.MainWindowHandle;
        }
        if(target==IntPtr.Zero) throw new Exception("Target unavailable");
        FailureStage="os-version";
        var version=new OsVersion(); version.Size=(uint)Marshal.SizeOf(typeof(OsVersion));
        if(RtlGetVersion(ref version)!=0) throw new Exception("OS unavailable");
        Emit(new {kind="session",osBuild=version.Build,targetForeground=GetForegroundWindow()==target,
            inputHooks=false,keysSent=false,namesRead=false,selectorVerified=false,originMeasured=false});
        if(xamlOnly) { FailureStage="point-provider"; PointHosts(target,targetPid); }
        FailureStage="shell-enumeration";
        int roots=0,failures=0; bool limited=false;
        bool enumerated=EnumWindows(delegate(IntPtr window,IntPtr ignored) {
            try {
                uint pid;
                if(GetWindowThreadProcessId(window,out pid)==0 || pid==0) throw new Exception("PID unavailable");
                using(var process=Process.GetProcessById((int)pid)) { if(!Hosts.Contains(process.ProcessName)) return true; }
                if(!IsWindowVisible(window)) return true;
                if(roots>=24) { limited=true; return true; }
                var text=new StringBuilder(256);
                if(GetClassName(window,text,text.Capacity)==0) throw new Exception("Class unavailable");
                if(xamlOnly && text.ToString()!="XamlExplorerHostIslandWindow" && text.ToString()!="Windows.UI.Core.CoreWindow") return true;
                int root=roots++;
                Emit(new {kind="root",root=root,hostClass=ClassCategory(text.ToString()),ownerMatchesTarget=OwnerMatches(window,target)});
                try { Uia(window,pid,root); } catch { Emit(new {kind="uia-end",root=root,completed=false}); }
                try { Msaa(window,pid,root); } catch { Emit(new {kind="msaa-end",root=root,available=false,completed=false}); }
            } catch { failures++; }
            return true;
        },IntPtr.Zero);
        // Enumeration completion does not imply either provider tree is complete or a selector exists.
        Emit(new {kind="snapshot-end",roots=roots,failures=failures,limited=limited,
            enumerationCompleted=enumerated && failures==0 && !limited,verdict="unknown",selectorVerified=false,originMeasured=false});
    }
    [STAThread] static int Main(string[] args) {
        try {
            if(args.Length==1 && args[0]=="--self-test") {
                if(Role("SnapLayout")!="snap-hypothesis" || Role("private")!="unclassified" ||
                    ClassCategory("private")!="other-shell-class") throw new Exception("Boundary failed");
                Emit(new {kind="self-test",result="PASS",liveObservation=false}); return 0;
            }
            if(args.Length==1 && args[0]=="--target") {
                Application.EnableVisualStyles();
                var form=new Form { Text="Snap Layout Research — isolated target",Width=900,Height=650 };
                form.Shown+=delegate { Emit(new {kind="target-ready"}); };
                form.Controls.Add(new Label { Dock=DockStyle.Fill,Text="Issue #5 / isolated target\r\nHover the standard maximize button, move away, then Win+Z and Esc.\r\nNo input hooks or product data. Close this window to finish.",Padding=new Padding(24) });
                Application.Run(form); return 0;
            }
            int targetPid;
            if(args.Length==2 && (args[0]=="--snapshot" || args[0]=="--snapshot-xaml") && int.TryParse(args[1],out targetPid)) {
                bool failed=false;
                var worker=new Thread(delegate() {
                    try { Snapshot(targetPid,args[0]=="--snapshot-xaml"); }
                    catch { failed=true; Emit(new {kind="worker-failure",stage=FailureStage}); }
                });
                worker.SetApartmentState(ApartmentState.MTA); worker.Start(); worker.Join();
                return failed ? 1 : 0;
            }
            return 2;
        } catch { Emit(new {kind="worker-failure",stage=FailureStage}); return 1; }
    }
}
