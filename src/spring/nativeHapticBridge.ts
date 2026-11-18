export type NativeHapticLevel = 'mute' | 'soft' | 'standard' | 'hyper';

export interface AndroidNativeHapticBridge {
  vibrateWaveform: (patternCsv: string, amplitude: number) => void;
}

export interface VibrationHostSeams {
  androidBridge?: AndroidNativeHapticBridge;
  webVibrate?: (pattern: number[]) => boolean;
}

function amplitudeForLevel(level: NativeHapticLevel): number {
  if (level === 'soft') return 95;
  if (level === 'standard') return 175;
  if (level === 'hyper') return 255;
  return 0;
}

/**
 * 优先调用安卓原生伴侣端注入的 YJAndroidNative.vibrateWaveform 驱动线性马达；
 * 若运行于普通浏览器则平滑回退至标准 navigator.vibrate。
 */
export function dispatchAndroidOrWebVibration(
  scaledPattern: number[],
  intensity: NativeHapticLevel,
  seams?: VibrationHostSeams
): boolean {
  if (intensity === 'mute' || scaledPattern.length === 0) return false;

  const bridge =
    seams && 'androidBridge' in seams
      ? seams.androidBridge
      : typeof window !== 'undefined'
        ? (window as unknown as { YJAndroidNative?: AndroidNativeHapticBridge }).YJAndroidNative
        : undefined;

  if (bridge && typeof bridge.vibrateWaveform === 'function') {
    try {
      bridge.vibrateWaveform(scaledPattern.join(','), amplitudeForLevel(intensity));
      return true;
    } catch {
      // fall through to web vibrate
    }
  }

  const webVib =
    seams && 'webVibrate' in seams
      ? seams.webVibrate
      : typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
        ? (p: number[]) => navigator.vibrate(p)
        : undefined;

  if (webVib) {
    try {
      webVib(scaledPattern);
    } catch {
      // ignore
    }
  }
  return false;
}
