using System.Globalization;
using System.Runtime.InteropServices;
using static NativeMethods;

namespace ShortcutExpert.Detection;

internal sealed class DisplayTopology(Func<string?> read)
{
    private long revision;

    internal string? Capture()
    {
        long before = Volatile.Read(ref revision);
        string? layout = read();
        return layout is not null && before == Volatile.Read(ref revision)
            ? $"{before}:{layout}"
            : null;
    }

    internal void Changed() => Interlocked.Increment(ref revision);

    // SystemEvents captures the subscription's synchronization context.
    // Its callback must advance the revision before posting to the window thread.
    internal static void SubscribeWithoutMarshalling(Action subscribe)
    {
        var previous = SynchronizationContext.Current;
        try
        {
            SynchronizationContext.SetSynchronizationContext(null);
            subscribe();
        }
        finally
        {
            SynchronizationContext.SetSynchronizationContext(previous);
        }
    }

    internal delegate bool EnumerateDisplays(MonitorEnum callback);
    internal delegate bool ReadMonitor(nint monitor, ref MonitorInfo info);
    internal delegate int ReadScale(nint monitor, out int scale);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate uint ReadTopologyId();

    private static readonly Lazy<ReadTopologyId?> topologyId = new(LoadTopologyId);

    private static ReadTopologyId? LoadTopologyId()
    {
        nint user = GetModuleHandleW("user32.dll");
        return
            user != 0
            && NativeLibrary.TryGetExport(user, "GetCurrentMonitorTopologyId", out nint address)
            ? Marshal.GetDelegateForFunctionPointer<ReadTopologyId>(address)
            : null;
    }

    // Read Win32 directly: the WinForms Screen cache can still describe the old layout
    // when a taskbar UIA result arrives ahead of display invalidation.
    internal static string? Read() =>
        topologyId.Value is { } readId
            ? readId().ToString(CultureInfo.InvariantCulture)
            : Read(
                callback => EnumDisplayMonitors(0, 0, callback, 0),
                GetMonitorInfoW,
                GetScaleFactorForMonitor
            );

    internal static string? Read(
        EnumerateDisplays enumerate,
        ReadMonitor readMonitor,
        ReadScale readScale
    )
    {
        var monitors = new List<string>();
        bool complete = enumerate(
            (monitor, _, _, _) =>
            {
                var info = new MonitorInfo { Size = (uint)Marshal.SizeOf<MonitorInfo>() };
                if (!readMonitor(monitor, ref info) || readScale(monitor, out int scale) != 0)
                    return false;
                monitors.Add(
                    $"{monitor}:{info.Flags}:{Bounds(info.Monitor)}:{Bounds(info.Work)}:{scale}"
                );
                return true;
            }
        );
        return complete && monitors.Count > 0
            ? string.Join(";", monitors.Order(StringComparer.Ordinal))
            : null;
    }

    private static string Bounds(Rect rect) => $"{rect.Left},{rect.Top},{rect.Right},{rect.Bottom}";
}
