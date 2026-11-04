// Experiment seam for observable state transitions. Input cause is separate.
public sealed class WindowTransition
{
    public int BeforeState,
        AfterState,
        BeforeMonitor,
        AfterMonitor;
    public string Operation;
}

public sealed class WindowStateSequence
{
    int state = -1,
        monitor = -1;
    public bool IsMoving { get; private set; }

    public void BeginMoveSize()
    {
        IsMoving = true;
    }

    public void EndMoveSize()
    {
        IsMoving = false;
    }

    public WindowTransition Observe(int newState, int newMonitor, string phase)
    {
        if (IsMoving)
            return null;
        if (state == -1)
        {
            state = newState;
            monitor = newMonitor;
            return null;
        }
        if (state == newState && monitor == newMonitor)
            return null;
        string operation =
            newState != state
                ? (
                    newState == 3 ? "maximize"
                    : newState == 2 ? "minimize"
                    : "restore"
                )
                : (phase == "move-size-end" ? "monitor-move-ended" : "monitor-majority-change");
        WindowTransition result = new WindowTransition
        {
            BeforeState = state,
            AfterState = newState,
            BeforeMonitor = monitor,
            AfterMonitor = newMonitor,
            Operation = operation,
        };
        state = newState;
        monitor = newMonitor;
        return result;
    }
}
