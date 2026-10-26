// HWND/PID identities are transient and never serialized. Null means an unverified target.
internal sealed record SwitchWindow(nint Handle, uint Process, bool KeyEligible = true);
internal sealed record SwitchCompletion(string Origin, SwitchWindow Target, long InputAgeMs, long SettleMs);

internal sealed class WindowSwitchPolicy
{
    private readonly HashSet<uint> held = new();
    private bool ready, key, released, tab;
    private SwitchWindow? before, target, confirmed;
    private long started, releasedAt;
    internal bool Pending => before is not null;
    internal void Neutral(bool neutral) { if (neutral) { ready = true; held.Clear(); } }
    internal void Cancel() { before = target = confirmed = null; key = released = tab = false; ready = false; }
    private static bool Alt(uint k) => k is 0x12 or 0xa4 or 0xa5;
    internal void Key(uint k, bool down, bool injected, SwitchWindow? foreground, long at)
    {
        bool repeat = down && !held.Add(k);
        if (!down) held.Remove(k);
        if (injected || !ready) { Cancel(); return; }
        if (Alt(k) && down && !repeat && !Pending && held.Count == 1 && foreground is not null)
        { if (!foreground.KeyEligible) { Cancel(); return; } before = foreground; started = at; key = true; return; }
        if (!Pending) { if (down) Cancel(); return; }
        if (!key || at - started is < 0 or > 15000) { Cancel(); return; }
        if (k == 0x09 && !released && held.Any(Alt)) { if (down) tab = true; return; }
        if (k == 0x09 && !down && released) return;
        if (Alt(k) && !down && !held.Any(Alt) && tab && !released)
        { released = true; releasedAt = at; if (confirmed != foreground) confirmed = null; return; }
        // Escape, extra modifiers, mixed input and Alt re-press cannot revive a transaction.
        Cancel();
    }
    internal void Mouse(nint message, SwitchWindow? hit, SwitchWindow? foreground, bool injected, bool modifiers, long at)
    {
        if (message == 0x200 && !injected) return;
        if (injected || modifiers || !ready || (message != 0x201 && message != 0x202)) { Cancel(); return; }
        if (message == 0x201)
        {
            if (Pending || foreground is null || hit is null || hit.Handle == foreground.Handle) { Cancel(); return; }
            before = foreground; target = hit; started = at; key = false; released = false; return;
        }
        if (!Pending || key || hit != target || at - started is < 0 or > 1500) { Cancel(); return; }
        released = true; releasedAt = at;
    }
    internal void Foreground(nint eventWindow, nint currentWindow, SwitchWindow? current, long eventAt, long at)
    {
        if (!Pending || eventWindow != currentWindow || eventAt < started || eventAt > at) return;
        if (!key)
        {
            if (current != target) { Cancel(); return; }
            confirmed = current;
        }
        else if (!released) confirmed = current;
        else
        {
            if (current is null || (confirmed is not null && current != confirmed)) { Cancel(); return; }
            confirmed = current;
        }
    }
    internal void NativeForeground(nint eventWindow, nint currentWindow, SwitchWindow? current,
        uint inputTick, uint eventTick, long at)
    {
        // Compare native message stamps directly, including DWORD wrap. Never subtract their
        // coarse tick lag from a high-resolution Stopwatch timestamp to infer input ordering.
        if (unchecked((int)(eventTick - inputTick)) < 0) return;
        Foreground(eventWindow, currentWindow, current, at, at);
    }
    internal SwitchCompletion? Poll(SwitchWindow? current, long at)
    {
        if (!Pending) return null;
        long age = at - started, settle = at - releasedAt;
        if (age < 0 || age > (key ? 15000 : 1500) || (released && (settle < 0 || settle > (key ? 2000 : 1500))))
        { Cancel(); return null; }
        if (!released || settle < (key ? 300 : 50)) return null;
        if (confirmed is null) return null; // A late matching callback may still arrive within the bounded deadline.
        SwitchCompletion? result = current is not null && current != before && current.Handle != before!.Handle &&
            current == confirmed && (key ? current.KeyEligible : current == target) ? new(key ? "key" : "mouse", current, age, settle) : null;
        Cancel(); return result;
    }
}
