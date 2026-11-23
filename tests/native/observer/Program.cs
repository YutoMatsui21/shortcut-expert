using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using ShortcutExpert.Detection;
using static NativeMethods;
using Point = NativeMethods.Point;

namespace ShortcutExpert.Tests;

internal static partial class Program
{
    private const nint Root = 101,
        Child = 102,
        Other = 103,
        Forwarded = 73;
    private const uint DefaultProcessId = uint.MaxValue;
    private const int WindowObject = 0,
        Self = 0;
    private const int ClientHit = 1;
    private const nint MouseMove = 0x200,
        KeyUp = 0x101;
    private const string Library = "observer-win32";

    [LibraryImport(Library)]
    private static partial void FixtureTargets(nint foreground, nint logical, nint physical);

    [LibraryImport(Library)]
    private static partial void FixtureProcess(uint pid);

    [LibraryImport(Library)]
    private static partial void FixtureHit(int root, int child, int titleFails, int reparent);

    [LibraryImport(Library)]
    private static partial void FixtureState(uint show, int win);

    [LibraryImport(Library)]
    private static partial nint FixtureMouse(int code, nint message, uint flags);

    [LibraryImport(Library)]
    private static partial nint FixtureKey(int code, nint message, uint key, uint flags);

    [LibraryImport(Library)]
    private static partial void FixtureEvent(uint kind, nint window, int obj, int child);

    [STAThread]
    private static void Main(string[] args)
    {
        if (args is ["--fixture-process"])
        {
            Console.ReadLine();
            return;
        }
        nint library = NativeLibrary.Load(Path.GetFullPath(args.Single()));
        // All P/Invokes made by the production code linked into this test assembly
        // resolve against the fixture. There is no fallback to the desktop APIs.
        NativeLibrary.SetDllImportResolver(typeof(Program).Assembly, (_, _, _) => library);
        CaptionHitResolution();
        MouseEvents();
        KeyAndWindowEvents();
        InactiveCaptionCancellation();
        Console.WriteLine("Observer fixtures passed.");
    }

    private static void CaptionHitResolution()
    {
        var reasons = new List<WindowDiagnosticReason>();
        var test = new CaptionHitTest(reasons.Add);
        var point = new Point { X = 10, Y = 10 };
        FixtureTargets(Root, Root, Child);
        FixtureHit(1, HTCAPTION, 0, 0);
        Equal(HTCAPTION, test.Read(Root, DefaultProcessId, point));
        Noted(reasons, WindowDiagnosticReason.ChildCaption, WindowDiagnosticReason.FinalCaption);
        FixtureHit(1, HTCAPTION, 0, 1);
        Equal(1, test.Read(Root, DefaultProcessId, point));
        Noted(reasons, WindowDiagnosticReason.HitChildUnmatched, WindowDiagnosticReason.FinalOther);
        FixtureHit(HTMAXBUTTON, HTCAPTION, 0, 0);
        Equal(HTMAXBUTTON, test.Read(Root, DefaultProcessId, new Point { X = 740, Y = 10 }));
        Noted(reasons, WindowDiagnosticReason.RawMaxButton, WindowDiagnosticReason.FinalButton);
        FixtureHit(1, -1, 0, 0);
        Equal(1, test.Read(Root, DefaultProcessId, point));
        Noted(reasons, WindowDiagnosticReason.ChildHitFailed);
        FixtureHit(1, HTCAPTION, 1, 0);
        Equal(1, test.Read(Root, DefaultProcessId, point));
        Noted(reasons, WindowDiagnosticReason.TitleReadFail);
        FixtureTargets(Root, Root, Root);
        Equal(1, test.Read(Root, DefaultProcessId, point));
        Noted(reasons, WindowDiagnosticReason.HitRoot);
        FixtureTargets(Root, Root, 0);
        Equal(1, test.Read(Root, DefaultProcessId, point));
        Noted(reasons, WindowDiagnosticReason.HitChildUnmatched);
    }

    private static void MouseEvents()
    {
        var reasons = new List<WindowDiagnosticReason>();
        var candidates = new List<object>();
        using var observer = new Observer(candidates.Add, windowDiagnostic: reasons.Add);
        FixtureTargets(Root, 0, Root);
        FixtureHit(HTCAPTION, HTCAPTION, 0, 0);
        observer.Start(1);
        Equal(true, observer.Active);
        Equal(Forwarded, FixtureMouse(-1, WM_LBUTTONDOWN, 0));
        Equal(0, reasons.Count);
        Equal(Forwarded, FixtureMouse(0, WM_LBUTTONDOWN, 0));
        Noted(reasons, WindowDiagnosticReason.TargetMissing);
        FixtureTargets(Root, Root, Root);
        Equal(Forwarded, FixtureMouse(0, WM_LBUTTONDOWN, 0));
        Noted(reasons, WindowDiagnosticReason.RawCaption, WindowDiagnosticReason.FinalCaption);
        Equal(Forwarded, FixtureMouse(0, MouseMove, 0));
        FixtureEvent(EVENT_SYSTEM_MOVESIZESTART, Root, WindowObject, Self);
        Equal(Forwarded, FixtureMouse(0, WM_LBUTTONUP, 0));
        FixtureEvent(EVENT_SYSTEM_MOVESIZEEND, Root, WindowObject, Self);
        Noted(
            reasons,
            WindowDiagnosticReason.MoveStart,
            WindowDiagnosticReason.MouseUp,
            WindowDiagnosticReason.MoveEnd
        );
        Equal(Forwarded, FixtureMouse(0, WM_RBUTTONDOWN, 0));

        FixtureTargets(Other, Root, Root);
        FixtureHit(ClientHit, HTCAPTION, 0, 0);
        Equal(Forwarded, FixtureMouse(0, WM_LBUTTONDOWN, LLMHF_INJECTED));
        Noted(reasons, WindowDiagnosticReason.CaptionInactivePress);
        Equal(0, candidates.Count);
        observer.Stop();
        Equal(false, observer.Active);
    }

    private static void KeyAndWindowEvents()
    {
        var reasons = new List<WindowDiagnosticReason>();
        var candidates = new List<object>();
        using var observer = new Observer(candidates.Add, windowDiagnostic: reasons.Add);
        FixtureTargets(Root, Root, Root);
        FixtureState(SW_SHOWNORMAL, 0);
        observer.Start(2);
        Equal(Forwarded, FixtureKey(0, WM_KEYDOWN, VK_LWIN, 0));
        FixtureState(SW_SHOWNORMAL, 1);
        Equal(Forwarded, FixtureKey(0, WM_KEYDOWN, 0x31, 0));
        Equal(Forwarded, FixtureKey(0, WM_KEYDOWN, VK_UP, 0));
        FixtureState(SW_SHOWMAXIMIZED, 1);
        PollResults(observer);
        FixtureState(SW_SHOWMAXIMIZED, 0);
        Equal(Forwarded, FixtureKey(0, KeyUp, VK_UP, 0));
        Equal(Forwarded, FixtureKey(0, KeyUp, VK_LWIN, 0));
        Equal(1, candidates.Count);
        Equal(true, System.Text.Json.JsonSerializer.Serialize(candidates[0]).Contains("win-up"));

        FixtureEvent(EVENT_SYSTEM_FOREGROUND, Root, WindowObject, Self);
        FixtureEvent(EVENT_SYSTEM_MINIMIZESTART, Root, WindowObject, Self);
        FixtureEvent(EVENT_OBJECT_DESTROY, Root, WindowObject, 1);
        FixtureEvent(EVENT_OBJECT_DESTROY, Root, WindowObject, Self);
        Equal(Forwarded, FixtureMouse(0, WM_LBUTTONDOWN, 0));
        Noted(reasons, WindowDiagnosticReason.TargetMissing);
        Equal(Forwarded, FixtureKey(0, KeyUp, VK_UP, LLKHF_INJECTED));
        Equal(1, candidates.Count);
    }

    private static void InactiveCaptionCancellation()
    {
        var executable = Path.ChangeExtension(typeof(Program).Assembly.Location, ".exe");
        using var target =
            Process.Start(
                new ProcessStartInfo(executable, "--fixture-process")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardInput = true,
                }
            ) ?? throw new InvalidOperationException("The fixture target did not start.");
        try
        {
            FixtureProcess((uint)target.Id);
            AssertInactiveCaptionCancellation();
        }
        finally
        {
            FixtureProcess(0);
            target.StandardInput.Close();
            if (!target.WaitForExit(5000))
            {
                target.Kill();
                throw new InvalidOperationException("The fixture target did not exit.");
            }
        }
    }

    private static void AssertInactiveCaptionCancellation()
    {
        var reasons = new List<WindowDiagnosticReason>();
        var candidates = new List<object>();
        using var observer = new Observer(candidates.Add, windowDiagnostic: reasons.Add);
        FixtureState(SW_SHOWNORMAL, 0);
        FixtureTargets(Other, Root, Root);
        FixtureHit(ClientHit, HTCAPTION, 0, 0);
        observer.Start(3);
        Equal(Forwarded, FixtureMouse(0, WM_LBUTTONDOWN, 0));
        Noted(reasons, WindowDiagnosticReason.CaptionStartAccepted);
        FixtureTargets(Root, Root, Root);
        FixtureEvent(EVENT_SYSTEM_FOREGROUND, Root, WindowObject, Self);
        PollResults(observer);
        FixtureEvent(EVENT_SYSTEM_MOVESIZESTART, Root, WindowObject, Self);
        Equal(Forwarded, FixtureMouse(0, WM_LBUTTONUP, 0));
        Equal(0, candidates.Count);
    }

    private static void PollResults(Observer observer)
    {
        // Invoke only the Observer timer callback. Pumping the Windows message queue
        // would also schedule unrelated UI Automation work and couple tests to time.
        var callback =
            typeof(Observer).GetMethod(
                "PollMaximize",
                BindingFlags.Instance | BindingFlags.NonPublic
            ) ?? throw new InvalidOperationException("Missing Observer polling callback.");
        callback.Invoke(observer, null);
    }

    private static void Noted(
        List<WindowDiagnosticReason> actual,
        params WindowDiagnosticReason[] expected
    )
    {
        foreach (var reason in expected)
            if (!actual.Contains(reason))
                throw new InvalidOperationException(
                    $"Missing {reason}: {string.Join(", ", actual)}"
                );
        actual.Clear();
    }

    private static void Equal<T>(T expected, T actual)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new InvalidOperationException($"Expected {expected}, received {actual}.");
    }
}
