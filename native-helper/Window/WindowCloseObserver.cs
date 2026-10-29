using System.Text;
using static NativeMethods;
using Point = NativeMethods.Point;

// Reads only the target needed for a bounded close transaction. No app/title/path is emitted.
internal sealed class WindowCloseObserver(CandidateProtocol protocol, Func<int> transaction, Func<long> now,
    Action<CloseReason>? diagnostic = null) : IDisposable
{
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 50 };
    private WindowClosePolicy policy = new();
    private int generation, pendingTransaction;
    private static readonly int[] neutralKeys = Enum.GetValues<System.Windows.Forms.Keys>().Select(k => (int)k)
        .Where(k => k is >= 1 and <= 254).Distinct().ToArray();
    internal void Start(int epoch) { Stop(); generation = epoch; Neutral(); timer.Tick += Tick; timer.Start(); }
    internal void Stop() { timer.Stop(); timer.Tick -= Tick; generation = 0; policy = new(); }
    internal void Cancel() => policy.Cancel();
    private void Neutral() => policy.Neutral(neutralKeys.All(k => GetAsyncKeyState(k) >= 0));
    private CloseWindow? Read(nint window)
    {
        if (window == 0 || window == GetDesktopWindow() || window == GetShellWindow() ||
            GetAncestor(window, GA_ROOT) != window || GetWindow(window, 4) != 0 || !IsWindowVisible(window) || IsIconic(window))
        { diagnostic?.Invoke(CloseReason.TargetAbsent); return null; }
        long style = GetWindowStyle(window, GWL_STYLE).ToInt64(), extended = GetWindowStyle(window, -20).ToInt64();
        if ((style & 0x40000000) != 0 || (style & WS_CAPTION) != WS_CAPTION || (extended & (0x80 | 0x08000000)) != 0)
        { diagnostic?.Invoke(CloseReason.TargetStyle); return null; }
        if (DwmGetWindowAttribute(window, DWMWA_CLOAKED, out int cloaked, sizeof(int)) != 0 || cloaked != 0)
        { diagnostic?.Invoke(CloseReason.TargetCloaked); return null; }
        var cls = new StringBuilder(256);
        if (GetClassNameW(window, cls, cls.Capacity) == 0 || cls.ToString() is "Shell_TrayWnd" or "Shell_SecondaryTrayWnd" or
            "Progman" or "WorkerW" or "XamlExplorerHostIslandWindow" or "MultitaskingViewFrame")
        { diagnostic?.Invoke(CloseReason.TargetClass); return null; }
        uint thread = GetWindowThreadProcessId(window, out uint pid);
        if (thread == 0 || pid == 0 || pid == Environment.ProcessId || !Observer.OrdinaryProcess(pid))
        { diagnostic?.Invoke(CloseReason.TargetProcess); return null; }
        diagnostic?.Invoke(CloseReason.TargetEligible);
        return new(window, pid, thread, DisplayContext.Monitor(window));
    }
    private static bool CloseButton(nint window, Point point) => GetWindowRect(window, out Rect rect) &&
        WindowCaption.Read(window, out TitleInfo title) && WindowCaption.CloseButton(title, rect, point);
    private void Capture(CloseWindow? previous)
    { if (previous is null && policy.Target is not null) pendingTransaction = transaction(); }
    internal void Mouse(nint message, Point point, uint flags, uint tick)
    {
        if (generation == 0) return;
        if (message == 0x200 && flags == 0) return;
        var previous = policy.Target;
        if (message == WM_LBUTTONDOWN) diagnostic?.Invoke(CloseReason.MouseDown);
        if (message == WM_LBUTTONUP) diagnostic?.Invoke(CloseReason.MouseUp);
        if (!policy.Ready) diagnostic?.Invoke(CloseReason.NotReady);
        bool click = message is WM_LBUTTONDOWN or WM_LBUTTONUP;
        nint window = click ? GetAncestor(WindowFromPhysicalPoint(point), GA_ROOT) : 0;
        var hit = click ? Read(window) : null;
        bool button = hit is not null && CloseButton(window, point);
        if (button) diagnostic?.Invoke(CloseReason.CloseRectangle);
        policy.Mouse(message, hit, button, GetForegroundWindow() == window,
            (flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED)) != 0,
            new[] { VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN }.Any(k => GetAsyncKeyState(k) < 0), tick, now());
        Capture(previous);
        if (previous is null && policy.Target is not null) diagnostic?.Invoke(CloseReason.PendingMouse);
        if (message == WM_LBUTTONUP && policy.Target is not null) diagnostic?.Invoke(CloseReason.ReleasedMouse);
    }
    internal void Key(uint key, bool down, uint flags, uint tick)
    {
        if (generation == 0) return;
        var previous = policy.Target;
        if (key == VK_F4 && down) diagnostic?.Invoke(CloseReason.KeyF4);
        if (key == VK_F4 && down && !policy.Ready) diagnostic?.Invoke(CloseReason.NotReady);
        policy.Key(key, down, (flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0,
            key == VK_F4 && down ? Read(GetForegroundWindow()) : null, tick, now());
        Capture(previous);
        if (previous is null && policy.Target is not null) diagnostic?.Invoke(CloseReason.PendingKey);
    }
    internal void Event(uint kind, nint window, int obj, int child, uint thread, uint tick)
    {
        if (generation == 0) return;
        if (kind == EVENT_SYSTEM_FOREGROUND && policy.Target is { } target && window != target.Handle)
        {
            bool exists = IsWindow(target.Handle);
            policy.Foreground(window, GetWindow(window, 4) == target.Handle, !exists || IsWindowEnabled(target.Handle));
            diagnostic?.Invoke(policy.Target is null ? CloseReason.ForegroundCancel : CloseReason.ForegroundDeparture);
        }
        if (obj == OBJID_WINDOW && child == CHILDID_SELF && policy.Target is { } pending && window == pending.Handle &&
            kind is EVENT_OBJECT_CREATE or EVENT_OBJECT_HIDE)
        {
            if (kind == EVENT_OBJECT_HIDE) diagnostic?.Invoke(CloseReason.HideObserved);
            policy.Lifecycle(kind, window, tick);
            if (policy.Target is null) diagnostic?.Invoke(CloseReason.RecreatedCancel);
        }
        if (kind != EVENT_OBJECT_DESTROY || obj != OBJID_WINDOW || child != CHILDID_SELF) return;
        var completed = policy.Destroy(window, thread, tick, IsWindow(window), now(), diagnostic);
        Complete(completed);
    }
    private void Complete(CloseCompletion? completed)
    {
        if (completed is not null)
        {
            diagnostic?.Invoke(CloseReason.Completed);
            protocol.Close(generation, pendingTransaction, DateTime.Now.ToString("yyyy-MM-dd"), completed.Origin,
                new(true, true, completed.Age, completed.Monitor));
        }
    }
    private void Tick(object? sender, EventArgs args)
    {
        try {
            var previous = policy.Target;
            CloseCompletion? completed = null;
            if (previous is { } target)
            {
                bool exists = IsWindow(target.Handle);
                uint pid = 0, thread = exists ? GetWindowThreadProcessId(target.Handle, out pid) : 0;
                bool same = pid == target.Process && thread == target.Thread;
                if (policy.DestroyPending) { completed = policy.ConfirmGone(exists, same, now()); Complete(completed); }
                // Normal closure can hide/activate B before DESTROY. Only identity or
                // lifetime is checked here; disappearance without DESTROY cannot complete.
                else policy.Poll(!exists || same, now());
            }
            if (previous is not null && policy.Target is null && completed is null) diagnostic?.Invoke(CloseReason.PollCancel);
            Neutral();
        } catch { diagnostic?.Invoke(CloseReason.Exception); Cancel(); }
    }
    public void Dispose() { Stop(); timer.Dispose(); }
}
