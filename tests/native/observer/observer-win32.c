// Test-only Win32 ABI for the Observer. Every hook and window handle is synthetic.
#include <stdint.h>
#include <stddef.h>
#include <wchar.h>

#define EXPORT __declspec(dllexport)

typedef intptr_t Handle;
typedef struct { int x, y; } Point;
typedef struct { int left, top, right, bottom; } Rect;
typedef struct { unsigned size, flags, show; Point min, max; Rect normal; } Placement;
typedef struct { unsigned size; Rect monitor, work; unsigned flags; } MonitorInfo;
typedef struct { unsigned size; Rect bar; unsigned state[6]; Rect bounds[6]; } TitleInfo;
typedef struct { Point point; unsigned data, flags, time; uintptr_t extra; } MouseData;
typedef struct { unsigned key, scan, flags, time; uintptr_t extra; } KeyData;
typedef Handle (*InputHook)(int, Handle, void *);
typedef void (*EventHook)(Handle, unsigned, Handle, int, int, unsigned, unsigned);
typedef int (*WindowCallback)(Handle, Handle);
typedef int (*MonitorCallback)(Handle, Handle, Rect *, Handle);

enum { root = 101, child = 102, other = 103, next_hook = 73 };
enum { hit_test = 0x84, title_info = 0x33f, client_hit = 1, caption_hit = 2 };

static Handle foreground = root, logical = root, physical = root;
// Casting this ID to a managed int gives -1, which never selects a real process.
static unsigned target_pid = UINT32_MAX;
static unsigned show = 1;
static int root_hit = client_hit, child_hit = caption_hit;
static int win_pressed, root_title_fails, child_reparents;
static InputHook mouse_hook, key_hook;
static EventHook event_hook;
static unsigned tick;
extern char __ImageBase;

EXPORT void FixtureTargets(Handle front, Handle logical_hit, Handle physical_hit) {
    foreground = front;
    logical = logical_hit;
    physical = physical_hit;
}

EXPORT void FixtureProcess(unsigned pid) { target_pid = pid ? pid : UINT32_MAX; }

EXPORT void FixtureHit(int root_value, int child_value, int title_fails, int reparent) {
    root_hit = root_value;
    child_hit = child_value;
    root_title_fails = title_fails;
    child_reparents = reparent;
}

EXPORT void FixtureState(unsigned window_state, int win) {
    show = window_state;
    win_pressed = win;
}

EXPORT Handle FixtureMouse(int code, Handle message, unsigned flags) {
    MouseData data = { { 10, 10 }, 0, flags, ++tick, 0 };
    return mouse_hook(code, message, &data);
}

EXPORT Handle FixtureKey(int code, Handle message, unsigned key, unsigned flags) {
    KeyData data = { key, 0, flags, ++tick, 0 };
    return key_hook(code, message, &data);
}

EXPORT void FixtureEvent(unsigned kind, Handle window, int object, int component) {
    event_hook(1, kind, window, object, component, 1, ++tick);
}

#pragma comment(linker, "/export:GetModuleHandleW=FixtureGetModuleHandle")
#pragma comment(linker, "/export:OpenProcess=FixtureOpenProcess")
#pragma comment(linker, "/export:CloseHandle=FixtureCloseHandle")
Handle FixtureGetModuleHandle(const wchar_t *name) { return (Handle)&__ImageBase; }
EXPORT int IsWindowArranged(Handle window) { return 0; }
EXPORT int GetSystemMetrics(int index) { return 0; }
EXPORT Handle SetThreadDpiAwarenessContext(Handle context) { return -4; }
EXPORT int SystemParametersInfoW(unsigned action, unsigned param, int *out, unsigned flags) {
    *out = 8;
    return 1;
}

EXPORT int EnumWindows(WindowCallback callback, Handle data) {
    return callback(root, data) && callback(other, data);
}

EXPORT Handle SetWindowsHookExW(int kind, InputHook callback, Handle module, unsigned thread) {
    if (kind == 14) mouse_hook = callback;
    if (kind == 13) key_hook = callback;
    return kind;
}

EXPORT int UnhookWindowsHookEx(Handle hook) { return 1; }
EXPORT Handle CallNextHookEx(Handle hook, int code, Handle message, void *data) { return next_hook; }
EXPORT int UnhookWinEvent(Handle hook) { return 1; }

EXPORT Handle SetWinEventHook(unsigned min, unsigned max, Handle module, EventHook callback,
                             unsigned pid, unsigned thread, unsigned flags) {
    event_hook = callback;
    return min;
}

EXPORT Handle GetAncestor(Handle window, unsigned flags) {
    return window == child ? (child_reparents == 2 ? other : root) : window;
}

EXPORT Handle GetForegroundWindow(void) { return foreground; }
EXPORT Handle GetDesktopWindow(void) { return 1; }
EXPORT Handle GetShellWindow(void) { return 2; }
EXPORT Handle GetWindow(Handle window, unsigned command) { return 0; }
EXPORT Handle FindWindowW(const wchar_t *class_name, const wchar_t *name) { return 2; }
EXPORT Handle WindowFromPoint(Point point) { return logical; }
EXPORT Handle WindowFromPhysicalPoint(Point point) { return physical; }
EXPORT int IsWindowVisible(Handle window) { return window == root || window == other; }
EXPORT int IsWindow(Handle window) { return window == child || IsWindowVisible(window); }
EXPORT int IsWindowEnabled(Handle window) { return IsWindow(window); }
EXPORT int IsIconic(Handle window) { return show == 2; }
EXPORT int IsZoomed(Handle window) { return show == 3; }
EXPORT uint32_t GetDpiForWindow(Handle window) { return 96; }
EXPORT uint32_t GetDoubleClickTime(void) { return 500; }
EXPORT short GetAsyncKeyState(int key) { return key == 0x5b && win_pressed ? (short)0x8000 : 0; }

EXPORT int GetPhysicalCursorPos(Point *point) {
    *point = (Point){ 10, 10 };
    return 1;
}

EXPORT unsigned GetWindowThreadProcessId(Handle window, unsigned *pid) {
    *pid = IsWindow(window) ? target_pid : 0;
    return *pid ? 1 : 0;
}

EXPORT Handle GetWindowLongPtrW(Handle window, int index) {
    return index == -16 ? 0x00c00000 : 0;
}

EXPORT int GetClassNameW(Handle window, wchar_t *name, int maximum) {
    const wchar_t value[] = L"ObserverFixture";
    const int length = (int)(sizeof(value) / sizeof(value[0]));
    if (maximum < length) return 0;
    for (int i = 0; i < length; i++) name[i] = value[i];
    return length - 1;
}

EXPORT int GetWindowRect(Handle window, Rect *rect) {
    *rect = (Rect){ 0, 0, 800, 600 };
    return IsWindow(window);
}

EXPORT int GetWindowPlacement(Handle window, Placement *placement) {
    placement->show = show;
    return GetWindowRect(window, &placement->normal);
}

EXPORT int DwmGetWindowAttribute(Handle window, unsigned attribute, void *value, unsigned size) {
    if (attribute == 14 && size == sizeof(int)) {
        *(int *)value = 0;
        return 0;
    }
    if (attribute != 9 || size != sizeof(Rect)) return -1;
    return GetWindowRect(window, (Rect *)value) ? 0 : -1;
}

Handle FixtureOpenProcess(unsigned access, int inherit, unsigned pid) { return pid == target_pid; }
int FixtureCloseHandle(Handle handle) { return 1; }

EXPORT int OpenProcessToken(Handle process_handle, unsigned access, Handle *token) {
    *token = process_handle;
    return process_handle != 0;
}

EXPORT int GetTokenInformation(Handle token, int kind, int *value, unsigned length, unsigned *size) {
    *value = 0;
    *size = sizeof(int);
    return 1;
}

EXPORT Handle MonitorFromWindow(Handle window, unsigned flags) { return IsWindow(window); }
EXPORT Handle MonitorFromPoint(Point point, unsigned flags) { return 1; }

EXPORT int GetMonitorInfoW(Handle monitor, MonitorInfo *info) {
    info->monitor = (Rect){ 0, 0, 1920, 1080 };
    info->work = (Rect){ 0, 0, 1920, 1040 };
    info->flags = 1;
    return monitor == 1;
}

EXPORT int EnumDisplayMonitors(Handle dc, Handle bounds, MonitorCallback callback, Handle data) {
    Rect rect = { 0, 0, 1920, 1080 };
    return callback(1, 0, &rect, data);
}

EXPORT int GetScaleFactorForMonitor(Handle monitor, int *scale) {
    *scale = 100;
    return 0;
}

static Handle QueryHit(Handle window, uintptr_t *result) {
    int hit = window == child ? child_hit : root_hit;
    if (window == child && child_reparents == 1) child_reparents = 2;
    if (hit == -1) return 0;
    *result = (uintptr_t)hit;
    return 1;
}

static Handle QueryTitle(Handle window, TitleInfo *title) {
    if (window == root && root_title_fails) return 0;
    title->bar = (Rect){ 0, 0, 800, 40 };
    title->bounds[2] = (Rect){ 680, 0, 720, 40 };
    title->bounds[3] = (Rect){ 720, 0, 760, 40 };
    title->bounds[5] = (Rect){ 760, 0, 800, 40 };
    return 1;
}

EXPORT Handle SendMessageTimeoutW(Handle window, unsigned message, Handle wp, Handle lp,
                                  unsigned flags, unsigned timeout, uintptr_t *result) {
    if (message == hit_test) return QueryHit(window, result);
    if (message == title_info) return QueryTitle(window, (TitleInfo *)lp);
    return 0;
}
