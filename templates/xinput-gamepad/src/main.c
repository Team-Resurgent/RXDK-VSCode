// XInput hardware test — gamepad (port 0), debug keyboard, and debug mouse on devkit.
#include <xtl.h>

#define ANALOG_BUTTON_THRESHOLD 0x20

/* One OutputDebugStringA per logical line (VS Code splits multiple ODS calls). */
static void DbgTraceLine(const char* msg)
{
    char buf[128];
    int n = 0;
    const char* prefix = "xinput-hw: ";
    for (; prefix[n] != '\0' && n + 2 < (int)sizeof(buf); ++n) {
        buf[n] = prefix[n];
    }
    if (msg) {
        for (; *msg != '\0' && n + 2 < (int)sizeof(buf); ++msg, ++n) {
            buf[n] = *msg;
        }
    }
    buf[n++] = '\n';
    buf[n] = '\0';
    OutputDebugStringA(buf);
}

static void DbgTraceLine2(const char* a, const char* b)
{
    char buf[128];
    int n = 0;
    const char* prefix = "xinput-hw: ";
    for (; prefix[n] != '\0' && n + 2 < (int)sizeof(buf); ++n) {
        buf[n] = prefix[n];
    }
    if (a) {
        for (; *a != '\0' && n + 2 < (int)sizeof(buf); ++a, ++n) {
            buf[n] = *a;
        }
    }
    if (b) {
        for (; *b != '\0' && n + 2 < (int)sizeof(buf); ++b, ++n) {
            buf[n] = *b;
        }
    }
    buf[n++] = '\n';
    buf[n] = '\0';
    OutputDebugStringA(buf);
}

static void DbgTraceU(const char* label, unsigned v)
{
    char buf[96];
    int n = 0;
    const char* prefix = "xinput-hw: ";
    for (; prefix[n] != '\0' && n + 1 < (int)sizeof(buf); ++n) {
        buf[n] = prefix[n];
    }
    if (label) {
        for (; *label != '\0' && n + 1 < (int)sizeof(buf); ++label, ++n) {
            buf[n] = *label;
        }
    }
    if (n + 16 < (int)sizeof(buf)) {
        char digits[10];
        int d = 0;
        unsigned t = v;

        buf[n++] = ' ';
        buf[n++] = 'n';
        buf[n++] = '=';
        do {
            digits[d++] = (char)('0' + t % 10u);
            t /= 10u;
        } while (t != 0u && d < (int)sizeof(digits));
        while (d > 0 && n + 1 < (int)sizeof(buf)) {
            buf[n++] = digits[--d];
        }
        buf[n++] = '\n';
        buf[n] = '\0';
        OutputDebugStringA(buf);
    }
}

static void HangForever(void)
{
    for (;;) {
        Sleep(1000);
    }
}

typedef struct ButtonLabel {
    const char* name;
    BYTE analogIndex;
    WORD digitalMask;
} ButtonLabel;

static const ButtonLabel g_buttons[] = {
    { "A",              XINPUT_GAMEPAD_A,             0 },
    { "B",              XINPUT_GAMEPAD_B,             0 },
    { "X",              XINPUT_GAMEPAD_X,             0 },
    { "Y",              XINPUT_GAMEPAD_Y,             0 },
    { "Black",          XINPUT_GAMEPAD_BLACK,         0 },
    { "White",          XINPUT_GAMEPAD_WHITE,         0 },
    { "D-Pad Up",       0xFF, XINPUT_GAMEPAD_DPAD_UP },
    { "D-Pad Down",     0xFF, XINPUT_GAMEPAD_DPAD_DOWN },
    { "D-Pad Left",     0xFF, XINPUT_GAMEPAD_DPAD_LEFT },
    { "D-Pad Right",    0xFF, XINPUT_GAMEPAD_DPAD_RIGHT },
    { "Start",          0xFF, XINPUT_GAMEPAD_START },
    { "Back",           0xFF, XINPUT_GAMEPAD_BACK },
    { "Left Stick",     0xFF, XINPUT_GAMEPAD_LEFT_THUMB },
    { "Right Stick",    0xFF, XINPUT_GAMEPAD_RIGHT_THUMB },
};

#define BUTTON_COUNT (sizeof(g_buttons) / sizeof(g_buttons[0]))

static BOOL IsButtonDown(const XINPUT_GAMEPAD* gp, const ButtonLabel* btn)
{
    if (btn->analogIndex != 0xFF) {
        return gp->bAnalogButtons[btn->analogIndex] > ANALOG_BUTTON_THRESHOLD;
    }
    return (gp->wButtons & btn->digitalMask) != 0;
}

static BOOL DeviceMaskHasTopPort(DWORD deviceMask, unsigned port)
{
    return (deviceMask & (1u << port)) != 0;
}

static BOOL DeviceMaskHasAny(DWORD deviceMask)
{
    unsigned port;
    if ((deviceMask & 0xFu) != 0) {
        return TRUE;
    }
    for (port = 0; port < 4; ++port) {
        if (deviceMask & (1u << (port + 16))) {
            return TRUE;
        }
    }
    return FALSE;
}

static BOOL WaitForDeviceType(PXPP_DEVICE_TYPE deviceType, const char* label, DWORD timeoutMs)
{
    const DWORD start = GetTickCount();
    DWORD devices = XGetDevices(deviceType);

    if (DeviceMaskHasAny(devices)) {
        DbgTraceLine2(label, " already connected");
        return TRUE;
    }

    DbgTraceLine2("waiting for ", label);

    for (;;) {
        DWORD insertions = 0;
        DWORD removals = 0;

        if (XGetDeviceChanges(deviceType, &insertions, &removals)) {
            devices = (devices & ~removals) | insertions;
            if (DeviceMaskHasAny(devices)) {
                DbgTraceLine2(label, " connected");
                return TRUE;
            }
        }

        if (timeoutMs != INFINITE) {
            if (GetTickCount() - start >= timeoutMs) {
                DbgTraceLine2("SKIP no ", label);
                return FALSE;
            }
        }

        Sleep(50);
    }
}

static BOOL WaitForPacketAdvance(HANDLE device, DWORD timeoutMs)
{
    XINPUT_STATE state;
    DWORD err;
    DWORD firstPacket;
    const DWORD start = GetTickCount();

    ZeroMemory(&state, sizeof(state));
    err = XInputGetState(device, &state);
    if (err != ERROR_SUCCESS) {
        DbgTraceU("FAIL XInputGetState initial", (unsigned)err);
        return FALSE;
    }

    firstPacket = state.dwPacketNumber;
    DbgTraceU("initial packet", (unsigned)firstPacket);

    for (;;) {
        err = XInputPoll(device);
        if (err != ERROR_SUCCESS) {
            DbgTraceU("FAIL XInputPoll", (unsigned)err);
            return FALSE;
        }

        ZeroMemory(&state, sizeof(state));
        err = XInputGetState(device, &state);
        if (err != ERROR_SUCCESS) {
            DbgTraceU("FAIL XInputGetState poll", (unsigned)err);
            return FALSE;
        }

        if (state.dwPacketNumber != firstPacket) {
            DbgTraceU("packet advanced", (unsigned)state.dwPacketNumber);
            return TRUE;
        }

        if (GetTickCount() - start >= timeoutMs) {
            DbgTraceLine("FAIL packet number did not advance");
            return FALSE;
        }
        Sleep(16);
    }
}

static BOOL RunButtonLabelLoop(HANDLE device)
{
    XINPUT_STATE state;
    DWORD err;
    BOOL wasDown[BUTTON_COUNT];
    unsigned i;

    for (i = 0; i < BUTTON_COUNT; ++i) {
        wasDown[i] = FALSE;
    }

    DbgTraceLine("press gamepad buttons (Back to finish)");

    for (;;) {
        ZeroMemory(&state, sizeof(state));

        err = XInputPoll(device);
        if (err != ERROR_SUCCESS) {
            DbgTraceU("FAIL XInputPoll", (unsigned)err);
            return FALSE;
        }

        err = XInputGetState(device, &state);
        if (err != ERROR_SUCCESS) {
            DbgTraceU("FAIL XInputGetState", (unsigned)err);
            return FALSE;
        }

        for (i = 0; i < BUTTON_COUNT; ++i) {
            const BOOL down = IsButtonDown(&state.Gamepad, &g_buttons[i]);
            if (down && !wasDown[i]) {
                DbgTraceLine2("pressed ", g_buttons[i].name);
                if (g_buttons[i].digitalMask == XINPUT_GAMEPAD_BACK) {
                    return TRUE;
                }
            }
            wasDown[i] = down;
        }

        Sleep(16);
    }
}

static BOOL WaitForFeedbackComplete(PXINPUT_FEEDBACK feedback, DWORD submitErr, DWORD timeoutMs)
{
    if (!feedback) {
        return FALSE;
    }

    if (submitErr == ERROR_SUCCESS) {
        return TRUE;
    }

    if (submitErr != ERROR_IO_PENDING) {
        DbgTraceU("FAIL XInputSetState", (unsigned)submitErr);
        return FALSE;
    }

    if (feedback->Header.hEvent != NULL) {
        const DWORD wait = WaitForSingleObject(feedback->Header.hEvent, timeoutMs);
        if (wait != WAIT_OBJECT_0) {
            DbgTraceU("FAIL rumble wait", (unsigned)wait);
            return FALSE;
        }
    } else {
        const DWORD start = GetTickCount();
        while (feedback->Header.dwStatus == ERROR_IO_PENDING) {
            if (GetTickCount() - start >= timeoutMs) {
                DbgTraceLine("FAIL rumble timeout");
                return FALSE;
            }
            Sleep(1);
        }
    }

    if (feedback->Header.dwStatus != ERROR_SUCCESS) {
        DbgTraceU("FAIL rumble status", (unsigned)feedback->Header.dwStatus);
        return FALSE;
    }

    return TRUE;
}

static BOOL SendFeedbackAndWait(HANDLE device, PXINPUT_FEEDBACK feedback, DWORD timeoutMs)
{
    HANDLE event;

    if (!feedback) {
        return FALSE;
    }

    event = CreateEventA(NULL, FALSE, FALSE, NULL);
    if (!event) {
        DbgTraceU("FAIL CreateEvent rumble", (unsigned)GetLastError());
        return FALSE;
    }

    feedback->Header.dwStatus = 0;
    feedback->Header.hEvent = event;

    const DWORD err = XInputSetState(device, feedback);
    const BOOL ok = WaitForFeedbackComplete(feedback, err, timeoutMs);

    feedback->Header.hEvent = NULL;
    CloseHandle(event);
    return ok;
}

static BOOL TestRumble(HANDLE device)
{
    XINPUT_FEEDBACK feedback;

    ZeroMemory(&feedback, sizeof(feedback));
    feedback.Rumble.wLeftMotorSpeed = 0x8000;
    feedback.Rumble.wRightMotorSpeed = 0x4000;
    if (!SendFeedbackAndWait(device, &feedback, 1000)) {
        return FALSE;
    }

    Sleep(250);

    ZeroMemory(&feedback, sizeof(feedback));
    if (!SendFeedbackAndWait(device, &feedback, 1000)) {
        return FALSE;
    }

    DbgTraceLine("rumble pulse ok");
    return TRUE;
}

static BOOL RunGamepadTests(void)
{
    HANDLE device;
    XINPUT_CAPABILITIES caps;
    DWORD capsErr;

    DbgTraceLine("gamepad tests (port 0)");

    if (!WaitForDeviceType(XDEVICE_TYPE_GAMEPAD, "gamepad", 60000)) {
        return FALSE;
    }

    device = XInputOpen(XDEVICE_TYPE_GAMEPAD, XDEVICE_PORT0, XDEVICE_NO_SLOT, NULL);
    if (device == NULL) {
        DbgTraceU("FAIL XInputOpen gamepad", (unsigned)GetLastError());
        return FALSE;
    }
    DbgTraceLine("XInputOpen gamepad ok");

    ZeroMemory(&caps, sizeof(caps));
    capsErr = XInputGetCapabilities(device, &caps);
    if (capsErr != ERROR_SUCCESS) {
        DbgTraceU("FAIL XInputGetCapabilities", (unsigned)capsErr);
        XInputClose(device);
        return FALSE;
    }
    DbgTraceU("gamepad subtype", (unsigned)caps.SubType);

    if (!WaitForPacketAdvance(device, 5000)) {
        XInputClose(device);
        return FALSE;
    }

    if (!RunButtonLabelLoop(device)) {
        XInputClose(device);
        return FALSE;
    }

    if (!TestRumble(device)) {
        XInputClose(device);
        return FALSE;
    }

    XInputClose(device);
    DbgTraceLine("gamepad tests passed");
    return TRUE;
}

#ifdef DEBUG_KEYBOARD

static void DbgTraceKeystroke(const XINPUT_DEBUG_KEYSTROKE* key)
{
    char buf[96];
    int n = 0;
    const char* prefix = "xinput-hw: key ";
    unsigned vk;
    char asc;

    if (!key) {
        return;
    }

    vk = (unsigned)key->VirtualKey;
    asc = key->Ascii;

    for (; prefix[n] != '\0' && n + 1 < (int)sizeof(buf); ++n) {
        buf[n] = prefix[n];
    }
    if (n + 16 < (int)sizeof(buf)) {
        buf[n++] = 'v';
        buf[n++] = 'k';
        buf[n++] = '=';
        if (vk >= 100u) {
            buf[n++] = (char)('0' + (vk / 100u) % 10u);
        }
        if (vk >= 10u) {
            buf[n++] = (char)('0' + (vk / 10u) % 10u);
        }
        buf[n++] = (char)('0' + vk % 10u);
        buf[n++] = ' ';
        buf[n++] = 'a';
        buf[n++] = 's';
        buf[n++] = 'c';
        buf[n++] = '=';
        if (asc >= 32 && asc < 127) {
            buf[n++] = '\'';
            buf[n++] = asc;
            buf[n++] = '\'';
        } else {
            buf[n++] = '-';
        }
        buf[n++] = '\n';
        buf[n] = '\0';
        OutputDebugStringA(buf);
    }
}

static HANDLE OpenDebugKeyboard(DWORD deviceMask, DWORD* openErr)
{
    unsigned port;
    static const struct {
        DWORD slot;
        unsigned maskShift;
    } slotTries[] = {
        { XDEVICE_NO_SLOT, 0 },
        { XDEVICE_BOTTOM_SLOT, 16 },
    };
    unsigned s;

    if (openErr) {
        *openErr = ERROR_SUCCESS;
    }

    for (port = 0; port < 4; ++port) {
        for (s = 0; s < sizeof(slotTries) / sizeof(slotTries[0]); ++s) {
            HANDLE device;
            const DWORD slot = slotTries[s].slot;
            const unsigned maskShift = slotTries[s].maskShift;

            if ((deviceMask & (1u << (port + maskShift))) == 0) {
                continue;
            }

            SetLastError(ERROR_SUCCESS);
            device = XInputOpen(XDEVICE_TYPE_DEBUG_KEYBOARD, port, slot, NULL);
            if (device != NULL) {
                DbgTraceU("keyboard open port", port);
                DbgTraceU("keyboard open slot", (unsigned)slot);
                return device;
            }

            if (openErr) {
                *openErr = GetLastError();
            }
            DbgTraceU("keyboard open fail port", port);
            DbgTraceU("keyboard open slot", (unsigned)slot);
            DbgTraceU("keyboard open err", (unsigned)GetLastError());
        }
    }

    return NULL;
}

static BOOL RunKeyboardTests(void)
{
    HANDLE device = NULL;
    DWORD devices;
    DWORD openErr = ERROR_SUCCESS;
    DWORD err;
    unsigned keyCount = 0;

    DbgTraceLine("keyboard tests");

    if (!WaitForDeviceType(XDEVICE_TYPE_DEBUG_KEYBOARD, "debug keyboard", 5000)) {
        return TRUE;
    }

    devices = XGetDevices(XDEVICE_TYPE_DEBUG_KEYBOARD);
    DbgTraceU("keyboard device mask", (unsigned)devices);

    if (!DeviceMaskHasAny(devices)) {
        DbgTraceLine("SKIP debug keyboard");
        return TRUE;
    }

    err = XInputDebugInitKeyboardQueue(NULL);
    if (err != ERROR_SUCCESS) {
        DbgTraceU("FAIL XInputDebugInitKeyboardQueue", (unsigned)err);
        return FALSE;
    }
    DbgTraceLine("XInputDebugInitKeyboardQueue ok");

    device = OpenDebugKeyboard(devices, &openErr);
    if (device == NULL) {
        DbgTraceU("SKIP keyboard open err", (unsigned)openErr);
        DbgTraceLine("SKIP debug keyboard (open failed)");
        return TRUE;
    }
    DbgTraceLine("XInputOpen keyboard ok");
    DbgTraceLine("type keys (Escape to finish keyboard test)");

    for (;;) {
        XINPUT_DEBUG_KEYSTROKE key;

        err = XInputPoll(device);
        if (err != ERROR_SUCCESS) {
            DbgTraceU("FAIL XInputPoll keyboard", (unsigned)err);
            XInputClose(device);
            return FALSE;
        }

        ZeroMemory(&key, sizeof(key));
        err = XInputDebugGetKeystroke(&key);
        if (err == ERROR_HANDLE_EOF) {
            Sleep(16);
            continue;
        }
        if (err != ERROR_SUCCESS) {
            DbgTraceU("FAIL XInputDebugGetKeystroke", (unsigned)err);
            XInputClose(device);
            return FALSE;
        }

        if ((key.Flags & XINPUT_DEBUG_KEYSTROKE_FLAG_KEYUP) == 0) {
            DbgTraceKeystroke(&key);
            ++keyCount;
            if (key.VirtualKey == VK_ESCAPE) {
                break;
            }
        }
    }

    XInputClose(device);

    if (keyCount == 0) {
        DbgTraceLine("FAIL keyboard saw no keydown events");
        return FALSE;
    }

    DbgTraceLine("keyboard tests passed");
    return TRUE;
}

#else

static BOOL RunKeyboardTests(void)
{
    DbgTraceLine("SKIP keyboard (build without DEBUG_KEYBOARD)");
    return TRUE;
}

#endif

#ifdef DEBUG_MOUSE

typedef struct MouseButtonLabel {
    BYTE mask;
    const char* name;
} MouseButtonLabel;

static const MouseButtonLabel g_mouseButtons[] = {
    { XINPUT_DEBUG_MOUSE_LEFT_BUTTON,   "Left" },
    { XINPUT_DEBUG_MOUSE_RIGHT_BUTTON,  "Right" },
    { XINPUT_DEBUG_MOUSE_MIDDLE_BUTTON, "Middle" },
    { XINPUT_DEBUG_MOUSE_XBUTTON1,      "X1" },
    { XINPUT_DEBUG_MOUSE_XBUTTON2,      "X2" },
};

#define MOUSE_BUTTON_COUNT (sizeof(g_mouseButtons) / sizeof(g_mouseButtons[0]))

static void DbgTraceMouseMotion(signed char dx, signed char dy, signed char wheel)
{
    char buf[80];
    int n = 0;
    const char* prefix = "xinput-hw: mouse move";
    int vals[3];
    int sign[3];
    unsigned mag[3];
    unsigned i;

    vals[0] = (int)dx;
    vals[1] = (int)dy;
    vals[2] = (int)wheel;

    for (; prefix[n] != '\0' && n + 1 < (int)sizeof(buf); ++n) {
        buf[n] = prefix[n];
    }

    for (i = 0; i < 3; ++i) {
        const char* labels[3] = { " dx=", " dy=", " wh=" };
        unsigned v;
        int j;

        sign[i] = (vals[i] < 0) ? -1 : 1;
        mag[i] = (unsigned)(sign[i] < 0 ? -vals[i] : vals[i]);

        for (j = 0; labels[i][j] != '\0' && n + 1 < (int)sizeof(buf); ++j, ++n) {
            buf[n] = labels[i][j];
        }
        if (sign[i] < 0 && n + 1 < (int)sizeof(buf)) {
            buf[n++] = '-';
        }
        v = mag[i];
        if (v >= 100u && n + 1 < (int)sizeof(buf)) {
            buf[n++] = (char)('0' + (v / 100u) % 10u);
        }
        if (v >= 10u && n + 1 < (int)sizeof(buf)) {
            buf[n++] = (char)('0' + (v / 10u) % 10u);
        }
        if (n + 1 < (int)sizeof(buf)) {
            buf[n++] = (char)('0' + v % 10u);
        }
    }

    if (n + 1 < (int)sizeof(buf)) {
        buf[n++] = '\n';
        buf[n] = '\0';
        OutputDebugStringA(buf);
    }
}

static HANDLE OpenDebugMouse(DWORD deviceMask, DWORD* openErr)
{
    unsigned port;
    static const struct {
        DWORD slot;
        unsigned maskShift;
    } slotTries[] = {
        { XDEVICE_NO_SLOT, 0 },
        { XDEVICE_BOTTOM_SLOT, 16 },
    };
    unsigned s;

    if (openErr) {
        *openErr = ERROR_SUCCESS;
    }

    for (port = 0; port < 4; ++port) {
        for (s = 0; s < sizeof(slotTries) / sizeof(slotTries[0]); ++s) {
            HANDLE device;
            const DWORD slot = slotTries[s].slot;
            const unsigned maskShift = slotTries[s].maskShift;

            if ((deviceMask & (1u << (port + maskShift))) == 0) {
                continue;
            }

            SetLastError(ERROR_SUCCESS);
            device = XInputOpen(XDEVICE_TYPE_DEBUG_MOUSE, port, slot, NULL);
            if (device != NULL) {
                DbgTraceU("mouse open port", port);
                DbgTraceU("mouse open slot", (unsigned)slot);
                return device;
            }

            if (openErr) {
                *openErr = GetLastError();
            }
            DbgTraceU("mouse open fail port", port);
            DbgTraceU("mouse open slot", (unsigned)slot);
            DbgTraceU("mouse open err", (unsigned)GetLastError());
        }
    }

    return NULL;
}

static BOOL RunMouseTests(void)
{
    HANDLE device = NULL;
    DWORD devices;
    DWORD openErr = ERROR_SUCCESS;
    XINPUT_STATE state;
    BYTE prevButtons = 0;
    BOOL sawMotion = FALSE;
    BOOL sawButton = FALSE;
    unsigned i;

    DbgTraceLine("mouse tests");

    if (!WaitForDeviceType(XDEVICE_TYPE_DEBUG_MOUSE, "debug mouse", 5000)) {
        return TRUE;
    }

    devices = XGetDevices(XDEVICE_TYPE_DEBUG_MOUSE);
    DbgTraceU("mouse device mask", (unsigned)devices);

    if (!DeviceMaskHasAny(devices)) {
        DbgTraceLine("SKIP debug mouse");
        return TRUE;
    }

    device = OpenDebugMouse(devices, &openErr);
    if (device == NULL) {
        DbgTraceU("SKIP mouse open err", (unsigned)openErr);
        DbgTraceLine("SKIP debug mouse (USB HID mouse on top slot)");
        return TRUE;
    }
    DbgTraceLine("XInputOpen mouse ok");

    if (!WaitForPacketAdvance(device, 5000)) {
        XInputClose(device);
        return FALSE;
    }

    DbgTraceLine("move mouse and click buttons (right button to finish)");

    ZeroMemory(&state, sizeof(state));
    if (XInputGetState(device, &state) == ERROR_SUCCESS) {
        prevButtons = state.DebugMouse.bButtons;
    }

    for (;;) {
        DWORD err;

        err = XInputPoll(device);
        if (err != ERROR_SUCCESS) {
            DbgTraceU("FAIL XInputPoll mouse", (unsigned)err);
            XInputClose(device);
            return FALSE;
        }

        ZeroMemory(&state, sizeof(state));
        err = XInputGetState(device, &state);
        if (err != ERROR_SUCCESS) {
            DbgTraceU("FAIL XInputGetState mouse", (unsigned)err);
            XInputClose(device);
            return FALSE;
        }

        if (state.DebugMouse.cMickeysX != 0
            || state.DebugMouse.cMickeysY != 0
            || state.DebugMouse.cWheel != 0) {
            DbgTraceMouseMotion(
                state.DebugMouse.cMickeysX,
                state.DebugMouse.cMickeysY,
                state.DebugMouse.cWheel);
            sawMotion = TRUE;
        }

        for (i = 0; i < MOUSE_BUTTON_COUNT; ++i) {
            const BYTE mask = g_mouseButtons[i].mask;
            const BOOL down = (state.DebugMouse.bButtons & mask) != 0;
            const BOOL wasDown = (prevButtons & mask) != 0;
            if (down && !wasDown) {
                DbgTraceLine2("mouse pressed ", g_mouseButtons[i].name);
                sawButton = TRUE;
                if (mask == XINPUT_DEBUG_MOUSE_RIGHT_BUTTON) {
                    XInputClose(device);
                    if (!sawMotion && !sawButton) {
                        DbgTraceLine("FAIL mouse saw no input");
                        return FALSE;
                    }
                    DbgTraceLine("mouse tests passed");
                    return TRUE;
                }
            }
        }

        prevButtons = state.DebugMouse.bButtons;
        Sleep(16);
    }
}

#else

static BOOL RunMouseTests(void)
{
    DbgTraceLine("SKIP mouse (build without DEBUG_MOUSE)");
    return TRUE;
}

#endif

void __cdecl main(void)
{
    DbgTraceLine("starting");

    XInitDevices(0, NULL);
    DbgTraceLine("XInitDevices ok");

    if (!RunGamepadTests()) {
        HangForever();
    }

    if (!RunKeyboardTests()) {
        HangForever();
    }

    if (!RunMouseTests()) {
        HangForever();
    }

    DbgTraceLine("all tests passed");
    HangForever();
}
