// Research only. No input hooks, injected keys, Name/title reads, or product counts.
// Run in a disposable process: a UIA provider call can block indefinitely.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Automation;

class TaskViewProviderProbe {
    delegate bool EnumProc(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int length);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct OsVersion {
        public uint Size, Major, Minor, Build, Platform;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string ServicePack;
    }
    [DllImport("ntdll.dll", CharSet=CharSet.Unicode)] static extern int RtlGetVersion(ref OsVersion version);
    const int MaxRoots=24, MaxNodes=256, MaxDepth=8;
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer();
    static readonly HashSet<string> ShellProcesses=new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        "explorer", "ShellHost", "ShellExperienceHost", "StartMenuExperienceHost", "ApplicationFrameHost"
    };
    static readonly HashSet<string> AllowedClasses=new HashSet<string>(StringComparer.Ordinal) {
        "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "MultitaskingViewFrame",
        "XamlExplorerHostIslandWindow", "Windows.UI.Core.CoreWindow"
    };
    static void Emit(object value) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); }

    // These are search hints, never a verified Task View selector.
    static string Role(string id) {
        if (id=="TaskViewButton") return "entrance-button";
        if (id.IndexOf("TaskView", StringComparison.OrdinalIgnoreCase)>=0 ||
            id.IndexOf("Multitasking", StringComparison.OrdinalIgnoreCase)>=0) return "body-hypothesis";
        return "unclassified";
    }
    static string Verdict(bool complete, int hypotheses) {
        return complete && hypotheses>0 ? "candidate-only" : "unknown";
    }
    static bool Complete(bool enumeration, int roots, int failures, bool limited, bool treesComplete) {
        return enumeration && roots>0 && failures==0 && !limited && treesComplete;
    }
    static void SelfTest() {
        if(Role("TaskViewButton")!="entrance-button" || Role("TaskViewRoot")!="body-hypothesis" ||
           Role("arbitrary-private-id")!="unclassified" || Verdict(true,0)!="unknown" ||
           Verdict(false,1)!="unknown" || Verdict(true,1)!="candidate-only" ||
           Complete(false,1,0,false,true) || Complete(true,0,0,false,true) ||
           Complete(true,1,1,false,true) || Complete(true,1,0,true,true) ||
           Complete(true,1,0,false,false) || !Complete(true,1,0,false,true))
            throw new Exception("Research evidence boundary failed");
        Emit(new { kind="self-test", result="PASS", liveObservation=false });
    }
    class Pending {
        public AutomationElement Element;
        public int Depth, Parent;
        public Pending(AutomationElement element, int depth, int parent) { Element=element; Depth=depth; Parent=parent; }
    }
    static bool Inspect(IntPtr window, string cls, int rootIndex, uint pid) {
        var queue=new Queue<Pending>();
        queue.Enqueue(new Pending(AutomationElement.FromHandle(window),0,-1));
        int nodes=0, failures=0, hypotheses=0, excluded=0;
        bool truncated=false;
        var walker=TreeWalker.RawViewWalker;
        while(queue.Count>0 && nodes<MaxNodes) {
            var pending=queue.Dequeue();
            int index=nodes++;
            try {
                var current=pending.Element.Current;
                // A tree crossing into another process is not explored.
                if(current.ProcessId!=(int)pid) {
                    excluded++;
                    Emit(new {kind="excluded-node",root=rootIndex,index=index,reason="different-process"});
                    continue;
                }
                string role=Role(current.AutomationId ?? "");
                bool offscreen=current.IsOffscreen;
                if(role=="body-hypothesis" && !offscreen) hypotheses++;
                Emit(new {kind="node",root=rootIndex,index=index,parent=pending.Parent,depth=pending.Depth,
                    controlType=current.ControlType.Id,role=role,offscreen=offscreen});
                if(pending.Depth>=MaxDepth || nodes+queue.Count>=MaxNodes) { truncated=true; continue; }
                var child=walker.GetFirstChild(pending.Element);
                while(child!=null) {
                    if(nodes+queue.Count>=MaxNodes) { truncated=true; break; }
                    queue.Enqueue(new Pending(child,pending.Depth+1,index));
                    if(nodes+queue.Count>=MaxNodes) { truncated=true; break; }
                    child=walker.GetNextSibling(child);
                }
            } catch { failures++; Emit(new {kind="read-failure",root=rootIndex,index=index}); }
        }
        bool complete=failures==0 && excluded==0 && !truncated && queue.Count==0;
        Emit(new {kind="root-result",root=rootIndex,hostClass=cls,nodes=nodes,readFailures=failures,
            truncated=truncated,excludedNodes=excluded,queueRemaining=queue.Count,hypotheses=hypotheses,
            verdict=Verdict(complete,hypotheses),selectorVerified=false,originMeasured=false});
        return complete;
    }
    static void Snapshot() {
        var version=new OsVersion(); version.Size=(uint)Marshal.SizeOf(typeof(OsVersion));
        if(RtlGetVersion(ref version)!=0) throw new Exception("OS version unavailable");
        Emit(new {kind="session",osBuild=version.Build,
            maxRoots=MaxRoots,maxNodesPerRoot=MaxNodes,maxDepth=MaxDepth,
            inputHooks=false,keysSent=false,namesRead=false,rawAutomationIdsSaved=false,
            selectorVerified=false,originMeasured=false});
        int roots=0, excluded=0, failures=0;
        bool rootLimit=false, treesComplete=true;
        bool enumerated=EnumWindows(delegate(IntPtr window,IntPtr parameter) {
            try {
                uint pid;
                if(GetWindowThreadProcessId(window,out pid)==0 || pid==0) throw new Exception("PID unavailable");
                using(var process=Process.GetProcessById((int)pid)) {
                    if(!String.Equals(process.ProcessName,"explorer",StringComparison.OrdinalIgnoreCase)) return true;
                }
                var text=new StringBuilder(256);
                if(GetClassName(window,text,text.Capacity)==0) throw new Exception("Class unavailable");
                string cls=text.ToString();
                if(!AllowedClasses.Contains(cls)) { excluded++; return true; }
                if(roots>=MaxRoots) { rootLimit=true; return true; }
                int index=roots++;
                Emit(new {kind="root",root=index,hostClass=cls,visible=IsWindowVisible(window)});
                treesComplete=Inspect(window,cls,index,pid) && treesComplete;
            } catch { failures++; Emit(new {kind="root-failure"}); }
            return true;
        },IntPtr.Zero);
        Emit(new {kind="snapshot-end",roots=roots,excludedRoots=excluded,rootFailures=failures,
            completed=Complete(enumerated,roots,failures,rootLimit,treesComplete),enumerationSucceeded=enumerated,
            rootLimitReached=rootLimit,verdict="unknown",selectorVerified=false,originMeasured=false});
    }
    // Discovery is limited to desktop direct children and five named Shell hosts.
    // Only ProcessId is read before checking the host; no app content is traversed.
    static void DiscoverHosts() {
        int count=0, excluded=0, failures=0;
        var walker=TreeWalker.RawViewWalker;
        var child=walker.GetFirstChild(AutomationElement.RootElement);
        while(child!=null && count<128) {
            count++;
            try {
                int pid=child.Current.ProcessId;
                using(var process=Process.GetProcessById(pid)) {
                    string host=process.ProcessName;
                    if(ShellProcesses.Contains(host))
                        Emit(new {kind="host-candidate",host=host,hostClass=child.Current.ClassName,
                            offscreen=child.Current.IsOffscreen,selectorVerified=false,originMeasured=false});
                    else excluded++;
                }
            } catch { failures++; Emit(new {kind="host-read-failure"}); }
            if(count>=128) break;
            child=walker.GetNextSibling(child);
        }
        Emit(new {kind="snapshot-end",roots=count,excludedRoots=excluded,rootFailures=failures,
            completed=failures==0 && count>0 && count<128,rootLimitReached=count>=128,
            verdict="unknown",selectorVerified=false,originMeasured=false});
    }
    [MTAThread] static int Main(string[] args) {
        try {
            if(args.Length==1 && args[0]=="--self-test") { SelfTest(); return 0; }
            if(args.Length==1 && args[0]=="--snapshot") { Snapshot(); return 0; }
            if(args.Length==1 && args[0]=="--discover-hosts") { DiscoverHosts(); return 0; }
            Console.Error.WriteLine("Use --self-test (offline), --snapshot or --discover-hosts (authorized live research only).");
            return 2;
        } catch { Console.Error.WriteLine("PROBE_FAILED"); return 1; }
    }
}
