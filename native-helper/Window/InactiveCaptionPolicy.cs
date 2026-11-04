using static NativeMethods;
using Point = NativeMethods.Point;

// One physical, explicitly hit-tested inactive caption click owns its transaction.
// Identities and input coordinates remain transient; the wire carries only confirmed results.
internal sealed class InactiveCaptionPolicy
{
    internal nint Target { get; private set; }
    internal uint Process { get; private set; }
    internal bool Pending => Target != 0;
    internal bool Fallback { get; private set; }
    internal Action<WindowDiagnosticReason>? Diagnostic { get; set; }

    internal static bool EligiblePress(
        bool neutral,
        SwitchWindow? foreground,
        SwitchWindow? target,
        uint process
    ) =>
        neutral
        && foreground is not null
        && target is not null
        && foreground.Handle != target.Handle
        && target.Process == process;

    private WindowState? before;
    private Point press;
    private long started;
    private uint tick;
    private int hit,
        transaction;
    private bool released,
        switched;
    private string? terminal;

    internal void Cancel()
    {
        Target = 0;
        Process = 0;
        before = null;
        terminal = null;
        released = switched = false;
        Fallback = false;
    }

    internal bool Start(
        nint target,
        WindowState state,
        int button,
        Point point,
        long at,
        uint inputTick,
        int id,
        bool eligible,
        bool physical,
        bool modifiers
    )
    {
        Cancel();
        if (
            !eligible
            || !physical
            || modifiers
            || target == 0
            || state.Process == 0
            || state.Show is not (SW_SHOWNORMAL or SW_SHOWMAXIMIZED)
            || !(
                button is 1 or 0 or -1
                || button == HTMINBUTTON
                || button == HTMAXBUTTON && state.Show == SW_SHOWNORMAL
            )
        )
            return false;
        Target = target;
        Process = state.Process;
        before = state;
        press = point;
        started = at;
        tick = inputTick;
        transaction = id;
        hit = button;
        Fallback = button is 1 or 0 or -1;
        return true;
    }

    internal void Mouse(
        nint message,
        Point point,
        uint flags,
        bool modifiers,
        nint root,
        uint process,
        long at
    )
    {
        if (!Pending)
            return;
        if (
            flags != 0
            || modifiers
            || message is not (0x200 or WM_LBUTTONUP)
            || !released
                && (Math.Abs((long)point.X - press.X) > 4 || Math.Abs((long)point.Y - press.Y) > 4)
        )
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.CaptionMotionOrInputRejected);
            Cancel();
            return;
        }
        if (message == WM_LBUTTONUP)
        {
            if (released || root != Target || process != Process || at - started is < 0 or > 500)
            {
                Diagnostic?.Invoke(WindowDiagnosticReason.CaptionReleaseRejected);
                Cancel();
            }
            else
                released = true;
        }
    }

    internal void State(WindowState? after, long at)
    {
        if (!Pending)
            return;
        if (at - started > 500)
            return;
        if (after is null || after.Process != Process || at - started < 0)
        {
            Diagnostic?.Invoke(WindowDiagnosticReason.CaptionStateRejected);
            Cancel();
            return;
        }
        if ((hit == HTMINBUTTON || Fallback) && after.Show == SW_SHOWMINIMIZED)
            terminal = "minimized";
        if (
            (hit == HTMAXBUTTON || Fallback && before!.Show == SW_SHOWNORMAL)
            && after.Show == SW_SHOWMAXIMIZED
        )
            terminal = "maximized";
    }

    internal void Foreground(nint window, nint current, uint eventTick)
    {
        if (!Pending || unchecked((int)(eventTick - tick)) is < 0 or > 500 || window != current)
            return;
        if (window == Target)
            switched = true;
        else if (terminal != "minimized")
            Cancel();
    }

    internal (int Transaction, CaptionClickEvidence Evidence)? Poll(WindowState? after, long at)
    {
        if (!Pending)
            return null;
        long age = at - started;
        // Existing conservative click boundary: allow event reordering, never join later input.
        if (age < 0 || age > 750)
        {
            Cancel();
            return null;
        }
        if (age < 500)
        {
            State(after, at);
            return null;
        }
        bool matched = after is not null && after.Process == Process;
        string? result =
            matched
            && (
                terminal == "minimized" && after!.Show == SW_SHOWMINIMIZED
                || terminal == "maximized" && after!.Show == SW_SHOWMAXIMIZED
            )
            && (!Fallback || switched)
                ? terminal
                : null;
        var evidence =
            matched && released && (switched || result is not null)
                ? new CaptionClickEvidence(result, switched, true, true, 500, before!.Monitor)
                : null;
        int id = transaction;
        if (evidence is null)
            Diagnostic?.Invoke(WindowDiagnosticReason.CaptionNoResult);
        Cancel();
        return evidence is null ? null : (id, evidence);
    }
}
