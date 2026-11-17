using static NativeMethods;
using Point = NativeMethods.Point;

// Message-thread state only. Polling completions are consumed here, never on a hook callback.
internal sealed class TaskbarInputObserver(TaskbarDetector detector, Func<long> now) : IDisposable
{
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 50 };
    private TaskbarDetector.Query? readingIdentity;
    private TaskbarQuery? query;
    private Task<TaskbarSnapshot>? reading;
    private int generation;
    private long nextQuery;
    private static readonly int[] neutral =
    [
        0x5b,
        0x5c,
        0x10,
        0x11,
        0x12,
        0xa0,
        0xa1,
        0xa2,
        0xa3,
        0xa4,
        0xa5,
        0x30,
        0x31,
        0x32,
        0x33,
        0x34,
        0x35,
        0x36,
        0x37,
        0x38,
        0x39,
    ];

    internal void Start(int epoch)
    {
        Stop();
        generation = epoch;
        detector.Start(epoch);
        query = new();
        detector.Neutral(neutral.All(k => GetAsyncKeyState(k) >= 0));
        timer.Tick += Tick;
        timer.Start();
        nextQuery = now();
    }

    internal void Stop()
    {
        timer.Stop();
        timer.Tick -= Tick;
        generation = 0;
        query?.Dispose();
        query = null;
        reading = null;
        readingIdentity = null;
        detector.Stop();
    }

    internal void Key(uint key, bool down, uint flags)
    {
        if (generation == 0)
            return;
        bool injected = (flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0;
        detector.Key(new(key, down, injected, Modifiers()));
        if (down)
            nextQuery = now();
    }

    private static bool Modifiers() =>
        new[] { VK_SHIFT, VK_CONTROL, VK_MENU }.Any(k => GetAsyncKeyState(k) < 0);

    internal void Mouse(nint message, Point point, uint flags)
    {
        if (generation == 0)
            return;
        bool injected = (flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED)) != 0;
        detector.Mouse(
            new(
                message,
                point,
                message is WM_LBUTTONDOWN or WM_LBUTTONUP
                    ? GetAncestor(WindowFromPhysicalPoint(point), GA_ROOT)
                    : 0,
                injected,
                Modifiers() || GetAsyncKeyState(VK_LWIN) < 0 || GetAsyncKeyState(VK_RWIN) < 0
            )
        );
        if (message == WM_LBUTTONUP)
            nextQuery = now();
    }

    private void Tick(object? sender, EventArgs args)
    {
        if (generation == 0)
            return;
        detector.Neutral(neutral.All(k => GetAsyncKeyState(k) >= 0));
        long at = now();
        if (reading is { IsCompleted: true })
        {
            var result = reading.IsCompletedSuccessfully ? reading.Result : TaskbarSnapshot.Unknown;
            reading = null;
            GetWindowThreadProcessId((nint)result.Root, out uint process);
            if (readingIdentity is { } identity)
                detector.Complete(
                    identity,
                    result,
                    process,
                    DisplayContext.Monitor((nint)result.Root)
                );
            readingIdentity = null;
        }
        if (reading is null && at >= nextQuery && query is not null)
        {
            readingIdentity = detector.BeginQuery(at);
            nextQuery = at + 250;
            var provider = query;
            reading = Task.Run(() => provider.Read());
        }
    }

    public void Dispose()
    {
        Stop();
        timer.Dispose();
    }
}
