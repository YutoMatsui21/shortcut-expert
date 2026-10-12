using System.Runtime.InteropServices;
using System.Text;

internal static class NativeMethods
{
    [StructLayout(LayoutKind.Sequential)] internal struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int Left, Top, Right, Bottom; }
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
    [DllImport("user32.dll")] internal static extern nint WindowFromPoint(Point point);
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
