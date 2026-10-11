// Technical-validation probe only. No existing app windows are inspected or changed.
// Creates an invisible window owned by this process, checks native API reachability,
// and immediately releases pass-through input hooks. Does not record any input data.
using System;
using System.Runtime.InteropServices;
using System.Threading;

class NativeHealthProbe {
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int x,y; }
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left,top,right,bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct Placement {
        public int length,flags,showCmd; public Point min,max; public Rect normal;
    }
    [StructLayout(LayoutKind.Sequential)] public struct Message {
        public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam;
        public uint time; public Point pt; public uint privateValue;
    }
    public delegate bool MonitorProc(IntPtr monitor,IntPtr dc,ref Rect rect,IntPtr data);
    public delegate void EventProc(IntPtr hook,uint e,IntPtr window,int obj,int child,uint thread,uint time);
    public delegate IntPtr InputProc(int code,IntPtr w,IntPtr l);
    [DllImport("user32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowExW(uint ex,string cls,string name,uint style,int x,int y,int width,int height,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr data);
    [DllImport("user32.dll",SetLastError=true)] static extern bool DestroyWindow(IntPtr window);
    [DllImport("user32.dll",SetLastError=true)] static extern bool GetWindowPlacement(IntPtr window,ref Placement placement);
    [DllImport("user32.dll",SetLastError=true)] static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window,uint flags);
    [DllImport("user32.dll",SetLastError=true)] static extern bool EnumDisplayMonitors(IntPtr dc,IntPtr clip,MonitorProc proc,IntPtr data);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr module,EventProc proc,uint process,uint thread,uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookExW(int kind,InputProc proc,IntPtr module,uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr w,IntPtr l);
    [DllImport("user32.dll")] static extern bool PeekMessageW(out Message msg,IntPtr window,uint min,uint max,uint flags);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref Message msg);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessageW(ref Message msg);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandleW(string name);
    [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
    static int monitorCount,ownLocationEvents;
    static bool VisitMonitor(IntPtr m,IntPtr dc,ref Rect r,IntPtr data) { monitorCount++; return true; }
    static IntPtr PassThrough(int code,IntPtr w,IntPtr l) { return CallNextHookEx(IntPtr.Zero,code,w,l); }
    static void OwnEvent(IntPtr h,uint e,IntPtr window,int obj,int child,uint thread,uint time) {
        if(e==0x800B && obj==0 && child==0) ownLocationEvents++;
    }
    static string B(bool value) { return value?"true":"false"; }
    static void Main() {
        IntPtr window=IntPtr.Zero,eventHook=IntPtr.Zero,mouseHook=IntPtr.Zero,keyHook=IntPtr.Zero;
        MonitorProc monitorProc=VisitMonitor; EventProc eventProc=OwnEvent; InputProc inputProc=PassThrough;
        try {
            bool monitors=EnumDisplayMonitors(IntPtr.Zero,IntPtr.Zero,monitorProc,IntPtr.Zero);
            int monitorError=monitors?0:Marshal.GetLastWin32Error();
            window=CreateWindowExW(0,"STATIC","OSS native API health probe",0x00CF0000,100,100,500,300,IntPtr.Zero,IntPtr.Zero,GetModuleHandleW(null),IntPtr.Zero);
            int windowError=window!=IntPtr.Zero?0:Marshal.GetLastWin32Error();
            Placement before=new Placement(); before.length=Marshal.SizeOf(typeof(Placement));
            bool readBefore=window!=IntPtr.Zero && GetWindowPlacement(window,ref before);
            IntPtr monitor=window!=IntPtr.Zero?MonitorFromWindow(window,2):IntPtr.Zero;
            eventHook=SetWinEventHook(0x800B,0x800B,IntPtr.Zero,eventProc,GetCurrentProcessId(),0,0);
            int eventError=eventHook!=IntPtr.Zero?0:Marshal.GetLastWin32Error();
            // Own invisible window only: a programmatic resize, not a mouse/key trial.
            bool resized=window!=IntPtr.Zero && SetWindowPos(window,IntPtr.Zero,120,120,600,350,0x0014);
            Placement after=new Placement(); after.length=Marshal.SizeOf(typeof(Placement));
            bool readAfter=window!=IntPtr.Zero && GetWindowPlacement(window,ref after);
            bool changed=readBefore && readAfter && (before.normal.right-before.normal.left != after.normal.right-after.normal.left);
            DateTime end=DateTime.UtcNow.AddMilliseconds(300);
            while(DateTime.UtcNow<end) {
                Message msg;
                while(PeekMessageW(out msg,IntPtr.Zero,0,0,1)) { TranslateMessage(ref msg); DispatchMessageW(ref msg); }
                Thread.Sleep(5);
            }
            // Installation check only; callback never reads the hook payload.
            mouseHook=SetWindowsHookExW(14,inputProc,GetModuleHandleW(null),0);
            bool mouseInstalled=mouseHook!=IntPtr.Zero;
            int mouseError=mouseHook!=IntPtr.Zero?0:Marshal.GetLastWin32Error();
            if(mouseHook!=IntPtr.Zero) { UnhookWindowsHookEx(mouseHook); mouseHook=IntPtr.Zero; }
            keyHook=SetWindowsHookExW(13,inputProc,GetModuleHandleW(null),0);
            bool keyInstalled=keyHook!=IntPtr.Zero;
            int keyError=keyHook!=IntPtr.Zero?0:Marshal.GetLastWin32Error();
            if(keyHook!=IntPtr.Zero) { UnhookWindowsHookEx(keyHook); keyHook=IntPtr.Zero; }
            Console.WriteLine("{\"kind\":\"api-health-only\",\"monitorEnumeration\":"+B(monitors)+",\"monitorCount\":"+monitorCount+",\"monitorError\":"+monitorError+",\"ownInvisibleWindow\":"+B(window!=IntPtr.Zero)+",\"windowError\":"+windowError+",\"placementRead\":"+B(readBefore)+",\"monitorLookup\":"+B(monitor!=IntPtr.Zero)+",\"programmaticOwnResize\":"+B(resized && changed)+",\"winEventHook\":"+B(eventHook!=IntPtr.Zero)+",\"winEventError\":"+eventError+",\"ownLocationEvents\":"+ownLocationEvents+",\"mouseHookInstallation\":"+B(mouseInstalled)+",\"mouseHookError\":"+mouseError+",\"keyboardHookInstallation\":"+B(keyInstalled)+",\"keyboardHookError\":"+keyError+",\"inputPayloadRead\":false,\"naturalInputTrials\":0}");
        } finally {
            if(mouseHook!=IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
            if(keyHook!=IntPtr.Zero) UnhookWindowsHookEx(keyHook);
            if(eventHook!=IntPtr.Zero) UnhookWinEvent(eventHook);
            if(window!=IntPtr.Zero) DestroyWindow(window);
            GC.KeepAlive(monitorProc); GC.KeepAlive(eventProc); GC.KeepAlive(inputProc);
        }
    }
}
