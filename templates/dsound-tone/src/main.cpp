// DirectSound hardware smoke test - steady tone via DirectSoundCreateBuffer.
//
// Follows the XDK Sound samples (ManualPanning / testds CreateToneBuffer):
//   DirectSoundCreate -> XAudioDownloadEffectsImage (dsstdfx) -> CreateBuffer
//   -> Lock/Unlock PCM -> PlayEx looping.
//
// dsstdfx.bin must be embedded in the XBE (section "dsstdfx") or present at
// d:\media\dsstdfx.bin on the console. Without it, MCPX mix output stays dead
// after the voice-start click.

#include <xtl.h>
#include <dsound.h>
#include <dsstdfx.h>
#include <math.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define SAMPLE_RATE     48000
// 500 Hz divides 48 kHz evenly (96 samples/period); Microsoft testds CreateToneBuffer pattern.
#define TONE_HZ         500
#define PLAY_MS         3000
#define POLL_MS         16
#define TONE_AMP           8000

// One ODS per logical line — the VS Code Xbox debug view splits each OutputDebugStringA call.
static void DbgTraceHw(const char* msg)
{
    char buf[256];
    int n = 0;
    const char* p;

    for (p = "dsound-hw: "; *p && n + 2 < (int)sizeof(buf); ++p) {
        buf[n++] = *p;
    }
    for (p = msg; *p && n + 2 < (int)sizeof(buf); ++p) {
        buf[n++] = *p;
    }
    buf[n++] = '\n';
    buf[n] = '\0';
    OutputDebugStringA(buf);
}

static void DbgTraceU(const char* label, unsigned v)
{
    char msg[80];
    int n = 0;
    const char* p;

    for (p = label; *p && n + 12 < (int)sizeof(msg); ++p) {
        msg[n++] = *p;
    }
    if (n + 12 < (int)sizeof(msg)) {
        msg[n++] = ' ';
        if (v >= 100u) {
            msg[n++] = (char)('0' + (v / 100u) % 10u);
        }
        if (v >= 10u) {
            msg[n++] = (char)('0' + (v / 10u) % 10u);
        }
        msg[n++] = (char)('0' + v % 10u);
        msg[n] = '\0';
        DbgTraceHw(msg);
    }
}

static void DbgTraceHr(const char* step, HRESULT hr)
{
    char msg[96];
    unsigned uhr;
    int n = 0;
    const char* p;

    for (p = step; *p && n + 12 < (int)sizeof(msg); ++p) {
        msg[n++] = *p;
    }
    if (n + 12 < (int)sizeof(msg)) {
        static const char hex[] = "0123456789ABCDEF";
        int i;

        msg[n++] = ' ';
        msg[n++] = 'h';
        msg[n++] = 'r';
        msg[n++] = '=';
        msg[n++] = '0';
        msg[n++] = 'x';
        uhr = (unsigned)hr;
        for (i = 7; i >= 0; --i) {
            msg[n++] = hex[(uhr >> (i * 4)) & 0xFu];
        }
        msg[n] = '\0';
        DbgTraceHw(msg);
    }
}

static void FillToneBuffer(short* samples, DWORD sampleCount)
{
    const double phaseScale = 2.0 * M_PI * (double)TONE_HZ / (double)SAMPLE_RATE;
    const double ampScale = (double)TONE_AMP;
    DWORD i;

    for (i = 0; i < sampleCount; ++i) {
        samples[i] = (short)(sin((double)i * phaseScale) * ampScale);
    }
}

static HRESULT DisableEnvelope(LPDIRECTSOUNDBUFFER buffer, DWORD dwEg)
{
    DSENVELOPEDESC eg;

    ZeroMemory(&eg, sizeof(eg));
    eg.dwEG = dwEg;
    eg.dwMode = DSEG_MODE_DISABLE;
    return IDirectSoundBuffer_SetEG(buffer, &eg);
}

static HRESULT InitDirectSound(LPDIRECTSOUND* ppDs)
{
    DSEFFECTIMAGELOC effectLoc;
    HRESULT hr;

    DbgTraceHw("step: DirectSoundCreate (see dsound: lines in debug output)");
    hr = DirectSoundCreate(NULL, ppDs, NULL);
    if (FAILED(hr)) {
        DbgTraceHr("DirectSoundCreate failed", hr);
        return hr;
    }
    DbgTraceHw("DirectSoundCreate ok");

    effectLoc.dwI3DL2ReverbIndex = GraphI3DL2_I3DL2Reverb;
    effectLoc.dwCrosstalkIndex = GraphXTalk_XTalk;

    DbgTraceHw("step: XAudioDownloadEffectsImage (XBE section dsstdfx)");
    hr = XAudioDownloadEffectsImage(
        "dsstdfx", &effectLoc, XAUDIO_DOWNLOADFX_XBESECTION, NULL);
    if (FAILED(hr)) {
        DbgTraceHr("XAudioDownloadEffectsImage XBE failed", hr);
        DbgTraceHw("step: XAudioDownloadEffectsImage (d:\\media\\dsstdfx.bin)");
        hr = XAudioDownloadEffectsImage(
            "d:\\media\\dsstdfx.bin",
            &effectLoc,
            XAUDIO_DOWNLOADFX_EXTERNFILE,
            NULL);
    }
    if (FAILED(hr)) {
        DbgTraceHr("XAudioDownloadEffectsImage failed", hr);
        DbgTraceHw("hint: embed dsstdfx.bin (XBE section dsstdfx) or copy to d:\\media");
        return hr;
    }
    DbgTraceHw("effects image loaded");
    return S_OK;
}

static HRESULT PlayToneTest(void)
{
    WAVEFORMATEX wfx;
    DSBUFFERDESC dsbd;
    DSMIXBINVOLUMEPAIR mixPairs[2];
    DSMIXBINS mixBins;
    LPDIRECTSOUND pDs = NULL;
    LPDIRECTSOUNDBUFFER buffer = NULL;
    LPVOID lockPtr = NULL;
    DWORD lockBytes = 0;
    DWORD bufferBytes;
    DWORD sampleCount;
    DWORD elapsed = 0;
    HRESULT hr;

    DbgTraceHw("step: InitDirectSound");
    hr = InitDirectSound(&pDs);
    if (FAILED(hr)) {
        return hr;
    }

    DbgTraceHw("step: XAudioCreatePcmFormat");
    XAudioCreatePcmFormat(1, SAMPLE_RATE, 16, &wfx);
    bufferBytes = (SAMPLE_RATE / TONE_HZ) * sizeof(short);
    sampleCount = bufferBytes / sizeof(short);
    DbgTraceU("buffer bytes", bufferBytes);

    mixPairs[0].dwMixBin = DSMIXBIN_FRONT_LEFT;
    mixPairs[0].lVolume = DSBVOLUME_MAX;
    mixPairs[1].dwMixBin = DSMIXBIN_FRONT_RIGHT;
    mixPairs[1].lVolume = DSBVOLUME_MAX;
    mixBins.dwMixBinCount = 2;
    mixBins.lpMixBinVolumePairs = mixPairs;

    ZeroMemory(&dsbd, sizeof(dsbd));
    dsbd.dwSize = sizeof(dsbd);
    dsbd.dwBufferBytes = bufferBytes;
    dsbd.lpwfxFormat = &wfx;
    dsbd.lpMixBins = &mixBins;

    DbgTraceHw("step: DirectSoundCreateBuffer");
    hr = DirectSoundCreateBuffer(&dsbd, &buffer);
    if (FAILED(hr)) {
        DbgTraceHr("DirectSoundCreateBuffer failed", hr);
        return hr;
    }
    DbgTraceHw("DirectSoundCreateBuffer ok");

    DbgTraceHw("step: IDirectSoundBuffer_Lock");
    hr = IDirectSoundBuffer_Lock(
        buffer, 0, bufferBytes, &lockPtr, &lockBytes, NULL, NULL, 0);
    if (FAILED(hr)) {
        DbgTraceHr("Lock failed", hr);
        return hr;
    }
    if (lockBytes < bufferBytes) {
        DbgTraceU("Lock short bytes", lockBytes);
        return E_FAIL;
    }
    DbgTraceHw("step: FillToneBuffer (sin loop)");
    FillToneBuffer((short*)lockPtr, sampleCount);
    DbgTraceHw("FillToneBuffer ok");

    hr = IDirectSoundBuffer_Unlock(buffer, lockPtr, lockBytes, NULL, 0);
    if (FAILED(hr)) {
        DbgTraceHr("Unlock failed", hr);
        return hr;
    }
    DbgTraceHw("Unlock ok");

    DbgTraceHw("step: SetEG amplitude disable");
    hr = DisableEnvelope(buffer, DSEG_AMPLITUDE);
    if (FAILED(hr)) {
        DbgTraceHr("SetEG amplitude failed", hr);
        return hr;
    }
    DbgTraceHw("step: SetEG multi disable");
    hr = DisableEnvelope(buffer, DSEG_MULTI);
    if (FAILED(hr)) {
        DbgTraceHr("SetEG multi failed", hr);
        return hr;
    }
    DbgTraceHw("SetEG ok");

    DbgTraceHw("step: SetLoopRegion");
    hr = IDirectSoundBuffer_SetLoopRegion(buffer, 0, bufferBytes);
    if (FAILED(hr)) {
        DbgTraceHr("SetLoopRegion failed", hr);
        return hr;
    }

    DbgTraceHw("step: SetCurrentPosition");
    hr = IDirectSoundBuffer_SetCurrentPosition(buffer, 0);
    if (FAILED(hr)) {
        DbgTraceHr("SetCurrentPosition failed", hr);
        return hr;
    }

    DbgTraceHw("step: SetVolume");
    hr = IDirectSoundBuffer_SetVolume(buffer, DSBVOLUME_MAX);
    if (FAILED(hr)) {
        DbgTraceHr("SetVolume failed", hr);
        return hr;
    }

    DbgTraceHw("step: DirectSoundDoWork + PlayEx");
    DirectSoundDoWork();
    hr = IDirectSoundBuffer_PlayEx(buffer, 0, DSBPLAY_LOOPING);
    if (FAILED(hr)) {
        DbgTraceHr("PlayEx failed", hr);
        return hr;
    }
    DbgTraceHw("playing 500 Hz tone (96 sample loop, 3 s)");

    while (elapsed < PLAY_MS) {
        DWORD status = 0;

        DirectSoundDoWork();
        hr = IDirectSoundBuffer_GetStatus(buffer, &status);
        if (FAILED(hr)) {
            DbgTraceHr("GetStatus failed", hr);
            return hr;
        }
        if (!(status & DSBSTATUS_PLAYING)) {
            DbgTraceU("stopped early ms", elapsed);
            DbgTraceU("status flags", status);
            return E_FAIL;
        }
        if (elapsed == 0) {
            DbgTraceU("poll status playing", status);
        }
        Sleep(POLL_MS);
        elapsed += POLL_MS;
    }

    DbgTraceHw("tone played for requested duration");
    return S_OK;
}

int main(void)
{
    HRESULT hr;

    DbgTraceHw("starting DirectSound tone test");
    hr = PlayToneTest();
    if (FAILED(hr)) {
        DbgTraceHr("test failed", hr);
        for (;;) {
            Sleep(1000);
        }
    }

    DbgTraceHw("all tests passed");
    for (;;) {
        DirectSoundDoWork();
        Sleep(POLL_MS);
    }
    return 0;
}
