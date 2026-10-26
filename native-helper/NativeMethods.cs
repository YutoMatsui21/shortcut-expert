using System.Runtime.InteropServices;
using System.Text;

internal static class NativeMethods
{
    internal const int WH_MOUSE_LL = 14, WH_KEYBOARD_LL = 13;
    internal const int SM_REMOTESESSION = 0x1000;
    internal const uint GA_ROOT = 2;
    internal const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000, TOKEN_QUERY = 0x8;
    internal const int TokenElevation = 20;
    internal const uint EVENT_OBJECT_LOCATIONCHANGE = 0x800B, EVENT_SYSTEM_MOVESIZESTART = 0xA,
        EVENT_SYSTEM_MOVESIZEEND = 0xB, EVENT_SYSTEM_FOREGROUND = 3, EVENT_OBJECT_DESTROY = 0x8001,
        EVENT_SYSTEM_MINIMIZESTART = 0x16, EVENT_SYSTEM_MINIMIZEEND = 0x17;
    internal const int OBJID_WINDOW = 0, CHILDID_SELF = 0;
    internal const int WM_LBUTTONDOWN = 0x201, WM_RBUTTONDOWN = 0x204, WM_MBUTTONDOWN = 0x207,
        WM_MOUSEWHEEL = 0x20A, WM_KEYDOWN = 0x100, WM_SYSKEYDOWN = 0x104;
    internal const uint WM_NCHITTEST = 0x84, SMTO_ABORTIFHUNG = 2;
    internal const int HTMAXBUTTON = 9, HTCAPTION = 2, HTMINBUTTON = 8, HTCLOSE = 20;
    internal const int VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12,
        VK_LWIN = 0x5B, VK_RWIN = 0x5C, VK_UP = 0x26, VK_DOWN = 0x28, VK_LEFT = 0x25, VK_RIGHT = 0x27, VK_F4 = 0x73,
        VK_LSHIFT = 0xA0, VK_RSHIFT = 0xA1, VK_LCONTROL = 0xA2, VK_RCONTROL = 0xA3,
        VK_LMENU = 0xA4, VK_RMENU = 0xA5;
    internal const uint LLMHF_INJECTED = 1, LLMHF_LOWER_IL_INJECTED = 2,
        LLKHF_INJECTED = 0x10, LLKHF_LOWER_IL_INJECTED = 2;
    internal const uint SW_SHOWNORMAL = 1, SW_SHOWMAXIMIZED = 3, SW_SHOWMINIMIZED = 2, SW_MINIMIZE = 6, SW_SHOWMINNOACTIVE = 7;
    internal const uint MONITOR_DEFAULTTONULL = 0, DWMWA_CLOAKED = 14, DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    internal const int GWL_STYLE = -16;
    internal const long WS_CAPTION = 0x00C00000;

    [StructLayout(LayoutKind.Sequential)] internal struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] internal struct TitleInfo
    {
        public uint Size; public Rect Bar;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 6)] public uint[] State;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 6)] public Rect[] Bounds;
    }
    [DllImport("user32.dll")] internal static extern nint GetDesktopWindow();
    [DllImport("user32.dll")] internal static extern nint GetShellWindow();
    [DllImport("user32.dll")] internal static extern bool GetPhysicalCursorPos(out Point point);
    [DllImport("user32.dll")] internal static extern bool GetWindowRect(nint window, out Rect rect);
    [DllImport("user32.dll")] internal static extern nint SetThreadDpiAwarenessContext(nint context);
    [DllImport("user32.dll")] internal static extern bool SystemParametersInfoW(uint action, uint param, out int value, uint flags);
    [StructLayout(LayoutKind.Sequential)] internal struct Placement
    {
        public uint Length, Flags, Show; public Point Min, Max; public Rect Normal;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct MouseData
    {
        public Point Point; public uint Data, Flags, Time; public nuint Extra;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct KeyData
    {
        public uint Key, Scan, Flags, Time; public nuint Extra;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct MonitorInfo { public uint Size; public Rect Monitor, Work; public uint Flags; }
    internal delegate nint InputHook(int code, nint message, nint data);
    internal delegate void EventHook(nint hook, uint kind, nint window, int obj, int child, uint thread, uint time);
    internal delegate bool Enumerate(nint window, nint data);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] internal delegate int Arranged(nint window);
    [DllImport("user32.dll")] internal static extern nint SetWindowsHookExW(int kind, InputHook callback, nint module, uint thread);
    [DllImport("user32.dll")] internal static extern bool UnhookWindowsHookEx(nint hook);
    [DllImport("user32.dll")] internal static extern nint CallNextHookEx(nint hook, int code, nint message, nint data);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] internal static extern nint GetModuleHandleW(string? name);
    [DllImport("user32.dll")] internal static extern nint SetWinEventHook(uint min, uint max, nint module, EventHook callback, uint process, uint thread, uint flags);
    [DllImport("user32.dll")] internal static extern bool UnhookWinEvent(nint hook);
    [DllImport("user32.dll")] internal static extern bool EnumWindows(Enumerate callback, nint data);
    [DllImport("user32.dll")] internal static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] internal static extern nint GetAncestor(nint window, uint flags);
    [DllImport("user32.dll")] internal static extern nint GetWindow(nint window, uint command);
    [DllImport("user32.dll")] internal static extern nint WindowFromPoint(Point point);
    [DllImport("user32.dll")] internal static extern nint WindowFromPhysicalPoint(Point point);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern nint FindWindowW(string cls, string? name);
    [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(nint window, out uint process);
    [DllImport("user32.dll")] internal static extern bool GetWindowPlacement(nint window, ref Placement placement);
    [DllImport("user32.dll")] internal static extern bool IsWindowVisible(nint window);
    [DllImport("user32.dll")] internal static extern bool IsIconic(nint window);
    [DllImport("user32.dll")] internal static extern bool IsZoomed(nint window);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] internal static extern nint GetWindowStyle(nint window, int index);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern int GetClassNameW(nint window, StringBuilder name, int maximum);
    [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] internal static extern uint GetDoubleClickTime();
    [DllImport("user32.dll")] internal static extern int GetSystemMetrics(int index);
    [DllImport("kernel32.dll")] internal static extern nint OpenProcess(uint access, bool inherit, uint process);
    [DllImport("kernel32.dll")] internal static extern bool CloseHandle(nint handle);
    [DllImport("advapi32.dll")] internal static extern bool OpenProcessToken(nint process, uint access, out nint token);
    [DllImport("advapi32.dll")] internal static extern bool GetTokenInformation(nint token, int kind, out int value, uint length, out uint returned);
    [DllImport("user32.dll")] internal static extern nint MonitorFromWindow(nint window, uint flags);
    [DllImport("user32.dll")] internal static extern bool GetMonitorInfoW(nint monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] internal static extern nint SendMessageTimeoutW(nint window, uint message, nint wp, nint lp, uint flags, uint timeout, out nuint result);
    [DllImport("dwmapi.dll")] internal static extern int DwmGetWindowAttribute(nint window, uint attribute, out Rect rect, uint size);
    [DllImport("dwmapi.dll")] internal static extern int DwmGetWindowAttribute(nint window, uint attribute, out int value, uint size);

}
