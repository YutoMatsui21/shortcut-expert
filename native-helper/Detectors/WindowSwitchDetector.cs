using static NativeMethods;

// W01 owns only switch input and foreground evidence. Other detectors never
// supply verdicts here; taskbar/close foreground changes cannot start an input.
internal sealed class WindowSwitchDetector
{
    internal sealed record Options(
        bool Independent = true,
        Action<WindowDiagnosticReason>? Diagnostic = null,
        Func<string>? Date = null
    );

    private readonly DetectionSession session;
    private readonly CandidateSink sink;
    private readonly DetectionRouter router;
    private readonly Func<int> transaction;
    private readonly Func<string> date;
    private readonly bool independent;
    private readonly GestureManager gestures = new();
    private GestureManager.Input? input;
    private Func<bool>? lease;
    private string inputDate = "";
    private int generation;
    internal WindowSwitchPolicy Policy { get; }

    internal WindowSwitchDetector(
        DetectionSession session,
        CandidateSink sink,
        DetectionRouter router,
        Func<int> transaction,
        Options? options = null
    )
    {
        this.session = session;
        this.sink = sink;
        this.router = router;
        this.transaction = transaction;
        options ??= new();
        independent = options.Independent;
        date = options.Date ?? (() => DateTime.Now.ToString("yyyy-MM-dd"));
        Policy = new() { Diagnostic = options.Diagnostic };
        router.Subscribe(
            new[] { ObservedKind.SwitchFacts },
            (e, _) => Observe((SwitchFactsEvent)e)
        );
    }

    internal void Start(int epoch)
    {
        Cancel();
        generation = epoch;
        gestures.Reset(epoch);
    }

    internal void Stop()
    {
        Cancel();
        generation = 0;
        gestures.Reset(0);
    }

    internal void Cancel()
    {
        Policy.Cancel();
        gestures.Clear();
        input = null;
        lease = null;
    }

    internal void Dispatch(SwitchFactsEvent facts) => router.Dispatch(facts);

    private void Observe(SwitchFactsEvent facts)
    {
        if (facts is SwitchPollEvent poll)
        {
            Poll(poll);
            return;
        }
        bool wasPending = Policy.Pending;
        ObserveInput(facts);
        UpdateInputLifetime(wasPending);
    }

    private void ObserveInput(SwitchFactsEvent facts)
    {
        switch (facts)
        {
            case SwitchNeutralEvent e:
                Policy.Neutral(e.Neutral);
                break;
            case SwitchKeyEvent e:
                Policy.Key(e.Key, e.Down, e.Injected, e.Foreground, e.At);
                break;
            case SwitchMouseEvent e:
                Policy.Mouse(e.Message, e.Hit, e.Foreground, e.Injected, e.Modified, e.At);
                break;
            case SwitchForegroundEvent e:
                Foreground(e);
                break;
        }
    }

    private void UpdateInputLifetime(bool wasPending)
    {
        if (!wasPending && Policy.Pending)
            Begin();
        if (input is not null && Policy.ReleasedAt is { } released)
            gestures.AwaitResult(input.Gesture, released);
        RetireCancelledInput();
    }

    private void RetireCancelledInput()
    {
        if (!Policy.Pending)
        {
            gestures.Cancel(input?.Gesture);
            input = null;
        }
    }

    private static WindowState State(SwitchWindow window, MonitorBounds? monitor = null) =>
        new(window.Process, "ordinary-window", 0, null, monitor);

    private void Begin()
    {
        var start = Policy.InputWindow!;
        inputDate = date();
        lease = session.Lease(generation);
        input = gestures.Begin(
            start.Handle,
            State(start),
            Policy.KeyboardInput ? "key" : "mouse",
            Policy.KeyboardInput ? "alt-tab" : "direct-click",
            Policy.StartedAt,
            false,
            false,
            true,
            transaction()
        );
    }

    private void Foreground(SwitchForegroundEvent e)
    {
        Policy.NativeForeground(
            e.Target,
            e.CurrentWindow,
            e.Current,
            e.InputTick,
            e.EventTick,
            e.At,
            e.KnownSwitcher,
            e.KnownStaging
        );
        if (input is null || !Policy.Pending)
            return;
        if (e.EligibleTarget() is { } current)
            gestures.ObserveSwitchTarget(input.Gesture, current.Handle, State(current), e.At);
    }

    private void Poll(SwitchPollEvent e)
    {
        var completed = Policy.Poll(e.Current, e.At);
        if (completed is not null)
            PublishIfCurrent(completed, e);
        RetireCancelledInput();
    }

    private void PublishIfCurrent(SwitchCompletion completed, SwitchPollEvent e)
    {
        if (input is null)
            return;
        if (lease?.Invoke() != true)
            return;
        Publish(completed, e);
    }

    private void Publish(SwitchCompletion completed, SwitchPollEvent e)
    {
        if (!independent)
        {
            sink.Switch(
                generation,
                input!.Transaction,
                inputDate,
                completed.Origin,
                new(true, true, true, true, completed.InputAgeMs, completed.SettleMs, e.Monitor)
            );
            return;
        }
        var gesture = input!.Gesture;
        var terminal = State(completed.Target, e.Monitor);
        if (!gestures.Complete(gesture, completed.Target.Handle, terminal, e.At))
            return;
        var targetInput = input with { Before = gesture.ResultIdentity };
        var composer = new ResultComposer(session, gestures, sink, () => e.At);
        var pending = composer.Begin(
            new(targetInput, inputDate, e.At, () => true),
            new[] { new ResultComposer.Subscription("switch", e.At) }
        );
        pending.Confirm(
            "switch",
            new(generation, targetInput.Window, targetInput.Before.Process, gesture.Source),
            gesture,
            new IndependentSwitchProof(
                completed.Origin == "key"
                    ? IndependentSwitchRoute.AltTab
                    : IndependentSwitchRoute.DirectClick,
                true,
                true,
                true,
                completed.InputAgeMs,
                completed.SettleMs,
                e.Monitor
            )
        );
        pending.Seal();
    }
}
