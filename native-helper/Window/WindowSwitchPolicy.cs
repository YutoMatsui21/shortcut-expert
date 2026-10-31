// HWND/PID identities are transient and never serialized. Null means an unverified target.
internal sealed record SwitchWindow(nint Handle, uint Process, bool KeyEligible = true);
internal sealed record SwitchCompletion(string Origin, SwitchWindow Target, long InputAgeMs, long SettleMs);

internal sealed class WindowSwitchPolicy
{
    internal Action<WindowDiagnosticReason>? Diagnostic { get; set; }
    private readonly HashSet<uint> held = new();
    private bool ready, key, released, tab;
    private SwitchWindow? before, target, confirmed;
    private long started, releasedAt;
    private readonly HashSet<nint> switcherWindows = new();
    internal bool Pending => before is not null;
    internal static bool KeysReleased(IEnumerable<int> definedKeys, Func<int, bool> released) => definedKeys.All(released);
    internal void Neutral(bool neutral) { if (neutral) { ready = true; held.Clear(); } }
    internal void Cancel() { if (Pending) Diagnostic?.Invoke(WindowDiagnosticReason.W01Cancelled); before = target = confirmed = null; key = released = tab = false; ready = false; switcherWindows.Clear(); }
    internal static bool KnownSwitcherType(string cls, uint process, uint shellProcess, bool visible) => visible && process != 0 && process == shellProcess &&
        cls is "XamlExplorerHostIslandWindow" or "MultitaskingViewFrame";
    internal static bool KnownStagingType(string cls, uint process, uint shellProcess) => process != 0 && process == shellProcess && cls == "ForegroundStaging";
    internal static bool KnownHiddenSwitcherType(string cls, uint process, uint shellProcess, bool visible) => !visible &&
        process != 0 && process == shellProcess && cls is "XamlExplorerHostIslandWindow" or "MultitaskingViewFrame";
    internal static bool ShellHostUnchanged(uint captured, uint current) => captured != 0 && captured == current;
    private static bool Alt(uint k) => k is 0x12 or 0xa4 or 0xa5;
    internal void Key(uint k, bool down, bool injected, SwitchWindow? foreground, long at)
    {
        if (Alt(k) && down) {
            Diagnostic?.Invoke(WindowDiagnosticReason.W01AltDown);
            if (!ready) Diagnostic?.Invoke(WindowDiagnosticReason.W01NotReady);
            if (foreground is null) Diagnostic?.Invoke(WindowDiagnosticReason.W01StartTargetMissing);
        }
        bool repeat = down && !held.Add(k);
        if (!down) held.Remove(k);
        if (injected || !ready) { Cancel(); return; }
        if (Alt(k) && down && !repeat && !Pending && held.Count == 1 && foreground is not null)
        { if (!foreground.KeyEligible) { Diagnostic?.Invoke(WindowDiagnosticReason.W01StartIneligible); Cancel(); return; } before = foreground; started = at; key = true; Diagnostic?.Invoke(WindowDiagnosticReason.W01Started); return; }
        if (!Pending) { if (down) Cancel(); return; }
        if (!key || at - started is < 0 or > 15000) { Cancel(); return; }
        if (k == 0x09 && !released && held.Any(Alt)) { if (down) { tab = true; Diagnostic?.Invoke(WindowDiagnosticReason.W01TabDown); } return; }
        if (k == 0x09 && !down && released) return;
        if (Alt(k) && !down && !held.Any(Alt) && tab && !released)
        { Diagnostic?.Invoke(WindowDiagnosticReason.W01Released); released = true; releasedAt = at; if (confirmed != foreground) confirmed = null; target = confirmed; return; }
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
    internal void Foreground(nint eventWindow, nint currentWindow, SwitchWindow? current, long eventAt, long at, bool knownSwitcher = false, bool knownStaging = false)
    {
        if (!Pending) return;
        if (eventWindow != currentWindow || eventAt < started || eventAt > at) { Diagnostic?.Invoke(WindowDiagnosticReason.W01ForegroundIgnored); return; }
        Diagnostic?.Invoke(current is null ? WindowDiagnosticReason.W01ForegroundUnknown : WindowDiagnosticReason.W01ForegroundConfirmed);
        // Shell can create a different focus-staging HWND for handoff. It is never a result.
        if (key && tab && current is null && knownStaging)
        { Diagnostic?.Invoke(WindowDiagnosticReason.W01KnownStaging); confirmed = null; return; }
        if (key && tab && current is null && knownSwitcher)
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.W01KnownSwitcher);
            if (!released)
            {
                if (!switcherWindows.Contains(currentWindow) && switcherWindows.Count == 4) { Cancel(); return; }
                switcherWindows.Add(currentWindow);
                confirmed = null; return;
            }
            if (switcherWindows.Contains(currentWindow))
            { confirmed = null; return; }
        }
        if (!key)
        {
            if (current != target) { Cancel(); return; }
            confirmed = current;
        }
        else if (!released)
        {
            if (current is null) { Cancel(); return; }
            confirmed = current;
        }
        else
        {
            if (current is null || (target is not null && current != target)) { Cancel(); return; }

            target ??= current; confirmed = current;
        }
    }
    internal void NativeForeground(nint eventWindow, nint currentWindow, SwitchWindow? current,
        uint inputTick, uint eventTick, long at, bool knownSwitcher = false, bool knownStaging = false)
    {
        // Compare native message stamps directly, including DWORD wrap. Never subtract their
        // coarse tick lag from a high-resolution Stopwatch timestamp to infer input ordering.
        if (unchecked((int)(eventTick - inputTick)) < 0) { if (Pending) Diagnostic?.Invoke(WindowDiagnosticReason.W01NativeEventOld); return; }
        Foreground(eventWindow, currentWindow, current, at, at, knownSwitcher, knownStaging);
    }
    internal SwitchCompletion? Poll(SwitchWindow? current, long at)
    {
        if (!Pending) return null;
        long age = at - started, settle = at - releasedAt;
        if (age < 0 || age > (key ? 15000 : 1500) || (released && (settle < 0 || settle > (key ? 2000 : 1500))))
        { Diagnostic?.Invoke(WindowDiagnosticReason.W01Expired); if (confirmed is null) Diagnostic?.Invoke(WindowDiagnosticReason.W01FinalUnconfirmed); Cancel(); return null; }
        if (!released || settle < (key ? 300 : 50)) return null;
        if (confirmed is null) { return null; }
        SwitchCompletion? result = current is not null && current != before && current.Handle != before!.Handle &&
            current == confirmed && current == target && (!key || current.KeyEligible) ? new(key ? "key" : "mouse", current, age, settle) : null;
        Diagnostic?.Invoke(result is not null ? WindowDiagnosticReason.W01Completed : current == before ? WindowDiagnosticReason.W01FinalSame : WindowDiagnosticReason.W01FinalChanged);
        Cancel(); return result;
    }
}
