import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAiReaderOrScraperRequest } from '../server/securityShield.mjs';
import { dispatchAndroidOrWebVibration } from '../src/spring/nativeHapticBridge.ts';

describe('Spec 0004: Android Companion APK WebView Compatibility & Native Linear Motor Bridge', () => {
  it('allows Android Companion APK WebView requests (including subresource */* fetches) while still blocking curl/scrapers', () => {
    const androidNavReq = {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 YouJingAndroid/2.0.0',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'x-requested-with': 'io.yjty.jisuanqi',
      },
    };
    assert.equal(isAiReaderOrScraperRequest(androidNavReq), false);

    // Older Android WebView subresource request with accept: '*/*' and no sec-fetch-mode
    const androidSubReq = {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Linux; Android 10; HUAWEI; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Mobile Safari/537.36 YouJingAndroid/2.0.0',
        accept: '*/*',
        'x-requested-with': 'io.yjty.jisuanqi',
      },
    };
    assert.equal(isAiReaderOrScraperRequest(androidSubReq), false);

    // Spoofed curl pretending to add x-requested-with still gets blocked by curl UA!
    const spoofedCurl = {
      headers: {
        'user-agent': 'curl/8.7.1',
        accept: '*/*',
        'x-requested-with': 'io.yjty.jisuanqi',
      },
    };
    assert.equal(isAiReaderOrScraperRequest(spoofedCurl), true);
  });

  it('routes scaled vibration waveforms to YJAndroidNative.vibrateWaveform with calibrated amplitude when inside Android APK, falling back to navigator.vibrate', () => {
    const nativeCalls: Array<{ csv: string; amp: number }> = [];
    let webVibrateCalled = false;

    const usedNative = dispatchAndroidOrWebVibration([14, 22, 28], 'hyper', {
      androidBridge: {
        vibrateWaveform(csv: string, amp: number) {
          nativeCalls.push({ csv, amp });
        },
      },
      webVibrate: () => {
        webVibrateCalled = true;
        return true;
      },
    });

    assert.equal(usedNative, true);
    assert.equal(webVibrateCalled, false);
    assert.deepEqual(nativeCalls, [{ csv: '14,22,28', amp: 255 }]);

    // Fallback on standard mobile browser when androidBridge is absent
    const webPayloads: number[][] = [];
    const usedNativeFallback = dispatchAndroidOrWebVibration([10, 18], 'standard', {
      androidBridge: undefined,
      webVibrate: (pat: number[]) => {
        webPayloads.push(pat);
        return true;
      },
    });
    assert.equal(usedNativeFallback, false);
    assert.deepEqual(webPayloads, [[10, 18]]);
  });
});
