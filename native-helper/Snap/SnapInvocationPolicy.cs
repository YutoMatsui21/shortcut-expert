using static NativeMethods;
using Point = NativeMethods.Point;

// Pure state and geometry rules, shared by the observer and isolated native tests.
internal sealed class SnapDwell
{
    private (nint Window, uint Process) target, latched;
    private long since, last = -1;
    internal long Duration(long now) => now - since;
    internal nint Resident => latched.Window != 0 ? latched.Window : target.Window;
    internal void Reset() { target = latched = default; last = -1; }
    internal bool Sample(nint next, long now, bool knownExit, bool buttons, bool physical, bool? enabled,
        uint process = 0, bool verified = true)
    {
        if (buttons || !physical || enabled != true) return Step(0, now, knownExit && physical);
        return Step(next, now, knownExit, process, verified);
    }
    internal bool Step(nint next, long now, bool knownExit = false, uint process = 0, bool verified = true)
    {
        if (last >= 0 && (now < last || now - last > 200)) target = default;
        last = now;
        if (!verified) { next = 0; knownExit = false; }
        if (next == 0) { target = default; since = now; if (knownExit) latched = default; return false; }
        var identity = (next, process);
        if (identity != target) { target = identity; since = now; }
        if (latched.Window != 0 && identity != latched) latched = default;
        if (identity == latched || now - since < 500) return false;
        latched = identity; return true;
    }
}

internal sealed class SnapKeys
{
    private bool left, right, z, tainted = true;
    private readonly HashSet<uint> modifiers = new();
    internal void ObserveNeutral(bool released)
    {
        if (!released) return;
        left = right = z = tainted = false; modifiers.Clear();
    }
    internal bool Step(uint key, bool down, bool injected)
    {
        if (injected) { tainted = true; return false; }
        if (key is 0x10 or 0x11 or 0x12 || key is >= 0xa0 and <= 0xa5)
        { if (down) modifiers.Add(key); else modifiers.Remove(key); }
        if (key == 0x5b) left = down;
        if (key == 0x5c) right = down;
        if (key != 0x5a) return false;
        bool fire = down && !z && (left || right) && modifiers.Count == 0 && !tainted;
        z = down; return fire;
    }
}

internal readonly record struct SnapSettings(bool? Key, bool? Hover)
{
    internal static SnapSettings Resolve(bool? spi, object? arrangement, object? flyout)
    {
        if (spi is null || arrangement is not string text || text is not ("0" or "1") || spi != (text == "1"))
            return new(null, null);
        if (spi == false) return new(false, false);
        return new(true, flyout is int value && value is 0 or 1 ? value == 1 : null);
    }
}

internal static class SnapGeometry
{
    internal static bool Nonempty(Rect r) => r.Right > r.Left && r.Bottom > r.Top;
    internal static bool Empty(Rect r) => r.Left == 0 && r.Top == 0 && r.Right == 0 && r.Bottom == 0;
    internal static bool Contains(Rect r, Point p) => p.X >= r.Left && p.X < r.Right && p.Y >= r.Top && p.Y < r.Bottom;
    private static bool Within(Rect a, Rect b) => a.Left >= b.Left && a.Top >= b.Top && a.Right <= b.Right && a.Bottom <= b.Bottom;
    private static bool Overlaps(Rect a, Rect b) => a.Left < b.Right && b.Left < a.Right && a.Top < b.Bottom && b.Top < a.Bottom;
    internal static string? Source(Rect min, Rect max, Rect close, Rect window)
    {
        if (Empty(min) && Empty(max) && Empty(close)) return "hit-fallback";
        if (!Nonempty(window) || !Nonempty(max) || !Nonempty(close) || !Within(max, window) || !Within(close, window) || Overlaps(max, close) ||
            (!Empty(min) && (!Nonempty(min) || !Within(min, window) || Overlaps(min, max) || Overlaps(min, close)))) return null;
        return "title-rect";
    }
}
