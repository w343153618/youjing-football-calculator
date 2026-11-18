/* =========================================================
   Hyper-Tactile Motion & Multi-Channel Haptic Symphony
   Deep Module:
   - Channel 1: Android / Web Vibration Multi-Pulse Waveforms
   - Channel 2: iOS 17.4+/18 Safari Native <input switch> Taptic Bridge
   - Channel 3: Zero-Latency WebAudio Physical Micro-Acoustics
   - Visual FX: Parabolic Bezier Orb Flight, Pointer Shockwaves,
                Physics Spark Confetti, Laser Shimmer Sweep, Gyro Glare
   ========================================================= */

import { fxOf, getGlobalTimeScale } from './engine';

export type HapticIntensity = 'mute' | 'soft' | 'standard' | 'hyper';

export type TactileCueKind =
  | 'press'
  | 'tap-on'
  | 'tap-off'
  | 'orb-catch'
  | 'optimize-arpeggio'
  | 'danger-heartbeat'
  | 'defuse-celebrate'
  | 'radar-ping'
  | 'radar-lock'
  | 'detent-tick'
  | 'detent-zero'
  | 'ticket-stamp'
  | 'skin-shift';

export interface SkinPhysicsProfile {
  id: string;
  title: string;
  feelDesc: string;
  pressPattern: number[];
  baseFreqHz: number;
  waveType: OscillatorType;
  squashX: number;
  squashY: number;
  colors: [string, string, string];
}

export const SKIN_PHYSICS_PROFILES: Record<string, SkinPhysicsProfile> = {
  air: {
    id: 'air',
    title: '钛金轻羽微动',
    feelDesc: '高频清脆 · 轻盈无负担回弹',
    pressPattern: [7, 16, 5],
    baseFreqHz: 960,
    waveType: 'sine',
    squashX: 1.06,
    squashY: 0.91,
    colors: ['#0B0D12', '#3B82F6', '#10B981'],
  },
  swiss: {
    id: 'swiss',
    title: '瑞士机械棘轮',
    feelDesc: '干脆利落 · 毫米级刻度段落感',
    pressPattern: [11, 14, 7],
    baseFreqHz: 1220,
    waveType: 'triangle',
    squashX: 1.05,
    squashY: 0.92,
    colors: ['#E30613', '#0B0D12', '#F59E0B'],
  },
  studio: {
    id: 'studio',
    title: '工坊琴键段落轴',
    feelDesc: '双段阻尼 · 复古合成器按键回馈',
    pressPattern: [14, 20, 11],
    baseFreqHz: 640,
    waveType: 'triangle',
    squashX: 1.09,
    squashY: 0.88,
    colors: ['#FF5A1F', '#1F2937', '#FBBF24'],
  },
  dot: {
    id: 'dot',
    title: '点阵电脉冲闪帧',
    feelDesc: '三连高频 · Nothing 矩阵赛博震感',
    pressPattern: [5, 13, 5, 13, 8],
    baseFreqHz: 1460,
    waveType: 'square',
    squashX: 1.07,
    squashY: 0.9,
    colors: ['#FFFFFF', '#EF4444', '#38BDF8'],
  },
  sumi: {
    id: 'sumi',
    title: '宣纸竹木温润',
    feelDesc: '绵长柔韧 · 墨滴入水般丝滑卸力',
    pressPattern: [16, 32, 9],
    baseFreqHz: 440,
    waveType: 'sine',
    squashX: 1.08,
    squashY: 0.89,
    colors: ['#B91C1C', '#1C1917', '#D97706'],
  },
  glass: {
    id: 'glass',
    title: '琉璃液态晶振',
    feelDesc: '清透泛音 · 水滴果冻弹性形变',
    pressPattern: [9, 20, 14],
    baseFreqHz: 1120,
    waveType: 'sine',
    squashX: 1.11,
    squashY: 0.87,
    colors: ['#34D399', '#60A5FA', '#F472B6'],
  },
  dial: {
    id: 'dial',
    title: '陀飞轮擒纵齿轮',
    feelDesc: '精密连响 · 机械腕表上链棘轮感',
    pressPattern: [4, 11, 4, 11, 9],
    baseFreqHz: 1350,
    waveType: 'triangle',
    squashX: 1.06,
    squashY: 0.91,
    colors: ['#CDB27A', '#F59E0B', '#E2E8F0'],
  },
  pitch: {
    id: 'pitch',
    title: '绿茵重炮轰门',
    feelDesc: '澎湃低频 · 球场草皮强力蓄力反弹',
    pressPattern: [20, 24, 30],
    baseFreqHz: 340,
    waveType: 'sine',
    squashX: 1.1,
    squashY: 0.87,
    colors: ['#10B981', '#FBBF24', '#059669'],
  },
};

interface TactileRuntimeState {
  intensity: HapticIntensity;
  soundEnabled: boolean;
  skin: string;
}

const STORAGE_KEY = 'youjing_tactile_cfg_v1';

function loadInitialState(): TactileRuntimeState {
  if (typeof window === 'undefined') {
    return { intensity: 'hyper', soundEnabled: true, skin: 'air' };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TactileRuntimeState>;
      return {
        intensity:
          parsed.intensity === 'mute' ||
          parsed.intensity === 'soft' ||
          parsed.intensity === 'standard' ||
          parsed.intensity === 'hyper'
            ? parsed.intensity
            : 'hyper',
        soundEnabled: parsed.soundEnabled !== false,
        skin: parsed.skin || 'air',
      };
    }
  } catch {
    // ignore storage errors
  }
  return { intensity: 'hyper', soundEnabled: true, skin: 'air' };
}

const runtime: TactileRuntimeState = loadInitialState();

export function getTactileState(): Readonly<TactileRuntimeState> {
  return { ...runtime };
}

export function updateTactileState(patch: Partial<TactileRuntimeState>): TactileRuntimeState {
  Object.assign(runtime, patch);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(runtime));
    } catch {
      // ignore
    }
  }
  return { ...runtime };
}

export function currentSkinProfile(): SkinPhysicsProfile {
  return SKIN_PHYSICS_PROFILES[runtime.skin] ?? SKIN_PHYSICS_PROFILES.air;
}

/* ---------- Channel 2: iOS 17.4+ / 18 Safari Native Taptic Bridge ---------- */
let iosSwitchLabel: HTMLLabelElement | null = null;
function fireIosSafariTaptic() {
  if (typeof document === 'undefined') return;
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIOS) return;

  if (!iosSwitchLabel) {
    const wrap = document.createElement('div');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText =
      'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'yj-ios-taptic-bridge';
    input.setAttribute('switch', '');
    const lbl = document.createElement('label');
    lbl.htmlFor = 'yj-ios-taptic-bridge';
    wrap.appendChild(input);
    wrap.appendChild(lbl);
    document.body.appendChild(wrap);
    iosSwitchLabel = lbl;
  }

  // Safari only honors <input switch> Taptic feedback synchronously inside an active user gesture
  iosSwitchLabel.click();
}

/* ---------- Channel 1: Scaled Multi-Pulse Vibration ---------- */
function scalePattern(pattern: number[]): number[] {
  const mult =
    runtime.intensity === 'mute'
      ? 0
      : runtime.intensity === 'soft'
        ? 0.55
        : runtime.intensity === 'standard'
          ? 1.0
          : 1.55;
  if (mult <= 0) return [];
  return pattern.map((v, idx) =>
    // 偶数位为震动时长（按档位放大），奇数位为停顿间隔（保持节奏清晰）
    idx % 2 === 0 ? Math.max(3, Math.round(v * mult)) : Math.max(10, Math.round(v * 0.92))
  );
}

export function vibratePattern(pattern: number[]) {
  if (runtime.intensity === 'mute' || typeof navigator === 'undefined') return;
  const scaled = scalePattern(pattern);
  if (scaled.length === 0) return;
  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(scaled);
    }
  } catch {
    // ignore
  }
  fireIosSafariTaptic();
}

/* ---------- Channel 3: Zero-Latency WebAudio Physical Micro-Acoustics ---------- */
let audioCtx: AudioContext | null = null;
function getAudio(): AudioContext | null {
  if (!runtime.soundEnabled || runtime.intensity === 'mute' || typeof window === 'undefined') {
    return null;
  }
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    try {
      audioCtx = new Ctx();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function synthTone(
  freqStart: number,
  freqEnd: number,
  durationSec: number,
  gainPeak: number,
  type: OscillatorType = 'sine',
  delaySec = 0
) {
  const ctx = getAudio();
  if (!ctx) return;
  const volScale =
    runtime.intensity === 'soft' ? 0.45 : runtime.intensity === 'standard' ? 0.75 : 1.0;
  const t0 = ctx.currentTime + delaySec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(40, freqStart), t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + durationSec);

  const peak = Math.min(0.18, gainPeak * volScale);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.006, durationSec * 0.25));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + durationSec + 0.01);
}

/* ---------- Unified Semantic Cue Dispatcher ---------- */
export function playTactileCue(kind: TactileCueKind) {
  if (runtime.intensity === 'mute') return;
  const prof = currentSkinProfile();
  const f = prof.baseFreqHz;
  const wType = prof.waveType === 'square' ? 'triangle' : prof.waveType;

  switch (kind) {
    case 'press':
      vibratePattern(prof.pressPattern);
      synthTone(f * 0.9, f * 0.55, 0.018, 0.045, wType);
      break;
    case 'tap-on':
      vibratePattern([10, 22, 18]);
      synthTone(f * 0.85, f * 1.25, 0.032, 0.065, wType, 0);
      synthTone(f * 1.25, f * 1.55, 0.038, 0.055, 'sine', 0.028);
      break;
    case 'tap-off':
      vibratePattern([8]);
      synthTone(f * 0.95, f * 0.62, 0.026, 0.045, 'sine');
      break;
    case 'orb-catch':
      vibratePattern([18, 22, 28]);
      synthTone(190, 68, 0.075, 0.11, 'sine', 0);
      synthTone(f * 1.35, f * 1.75, 0.045, 0.05, 'triangle', 0.012);
      break;
    case 'optimize-arpeggio':
      vibratePattern([8, 26, 12, 26, 18, 30, 32]);
      [1, 1.25, 1.5, 2.0].forEach((ratio, idx) => {
        synthTone(520 * ratio, 540 * ratio, 0.07, 0.065, 'triangle', idx * 0.048);
      });
      break;
    case 'danger-heartbeat':
      vibratePattern([32, 58, 46]);
      synthTone(165, 92, 0.085, 0.1, 'triangle', 0);
      synthTone(150, 78, 0.11, 0.11, 'triangle', 0.11);
      break;
    case 'defuse-celebrate':
      vibratePattern([12, 22, 16, 22, 24, 28, 42]);
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((hz, idx) => {
        synthTone(hz, hz * 1.02, 0.11, 0.07, 'sine', idx * 0.042);
      });
      break;
    case 'radar-ping':
      vibratePattern([8, 40, 12]);
      synthTone(1320, 880, 0.14, 0.05, 'sine');
      break;
    case 'radar-lock':
      vibratePattern([14, 20, 26]);
      synthTone(740, 1180, 0.06, 0.065, 'triangle', 0);
      synthTone(1180, 1480, 0.08, 0.07, 'sine', 0.055);
      break;
    case 'detent-tick':
      vibratePattern([4]);
      synthTone(1400, 920, 0.012, 0.032, 'triangle');
      break;
    case 'detent-zero':
      vibratePattern([14, 16, 10]);
      synthTone(880, 1320, 0.03, 0.06, 'sine');
      break;
    case 'ticket-stamp':
      vibratePattern([22, 18, 12]);
      synthTone(240, 85, 0.055, 0.1, 'triangle', 0);
      synthTone(1100, 1420, 0.035, 0.05, 'sine', 0.02);
      break;
    case 'skin-shift':
      vibratePattern(prof.pressPattern);
      synthTone(prof.baseFreqHz * 0.75, prof.baseFreqHz * 1.15, 0.05, 0.06, wType);
      break;
  }
}

/* ---------- Dedicated Fixed FX Stage Layer (pointer-events: none) ---------- */
let fxStageEl: HTMLDivElement | null = null;
function getFxStage(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  if (!fxStageEl || !document.body.contains(fxStageEl)) {
    fxStageEl = document.createElement('div');
    fxStageEl.className = 'yj-fx-stage';
    fxStageEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(fxStageEl);
  }
  return fxStageEl;
}

/* ---------- Visual FX 1: Pointer Concentric Shockwave Ring ---------- */
export function spawnPointerShockwave(clientX: number, clientY: number) {
  if (clientX <= 0 && clientY <= 0) return;
  const stage = getFxStage();
  if (!stage) return;
  const prof = currentSkinProfile();
  const ring = document.createElement('div');
  ring.className = 'yj-fx-ripple';
  ring.style.left = `${clientX}px`;
  ring.style.top = `${clientY}px`;
  ring.style.borderColor = prof.colors[0];
  ring.style.boxShadow = `0 0 14px ${prof.colors[0]}55`;
  stage.appendChild(ring);

  const dur = 460 / getGlobalTimeScale();
  const anim = ring.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.22)', opacity: 0.78, borderWidth: '2.5px' },
      { transform: 'translate(-50%, -50%) scale(2.35)', opacity: 0, borderWidth: '0.5px' },
    ],
    { duration: dur, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' }
  );
  anim.onfinish = () => ring.remove();
}

/* ---------- Visual FX 2: Parabolic Magnetic Odds-Orb Flight + Impact Recoil ---------- */
export function launchParabolicOrb(
  fromEl: HTMLElement | null,
  toEl: HTMLElement | null,
  badgeText: string
) {
  if (!fromEl || !toEl || typeof document === 'undefined') return;
  const rFrom = fromEl.getBoundingClientRect();
  const rTo = toEl.getBoundingClientRect();
  if (rTo.width === 0 || rTo.height === 0) return;

  const stage = getFxStage();
  if (!stage) return;
  const prof = currentSkinProfile();

  const sx = rFrom.left + rFrom.width / 2;
  const sy = rFrom.top + rFrom.height / 2;
  // Target the amount area of slip or center top of audit panel
  const tx = rTo.left + Math.min(90, rTo.width * 0.32);
  const ty = rTo.top + Math.min(34, rTo.height * 0.5);

  // Quadratic Bezier Control Point (graceful high arc!)
  const cx = (sx + tx) * 0.5 + (tx > sx ? -36 : 36);
  const cy = Math.min(sy, ty) - Math.min(165, Math.max(75, Math.hypot(tx - sx, ty - sy) * 0.32));

  const orb = document.createElement('div');
  orb.className = 'yj-fx-orb num';
  orb.textContent = badgeText;
  orb.style.background = prof.colors[0];
  orb.style.boxShadow = `0 6px 20px ${prof.colors[0]}88, 0 0 0 1.5px rgba(255,255,255,0.45)`;
  stage.appendChild(orb);

  // 5 trailing luminous comet dots
  const trails = Array.from({ length: 5 }, (_, idx) => {
    const dot = document.createElement('div');
    dot.className = 'yj-fx-trail';
    const sz = 9 - idx * 1.4;
    dot.style.width = `${sz}px`;
    dot.style.height = `${sz}px`;
    dot.style.background = prof.colors[idx % 2 === 0 ? 0 : 1];
    stage.appendChild(dot);
    return dot;
  });

  const duration = 360 / getGlobalTimeScale();
  const start = performance.now();

  const bezier = (t: number) => {
    const u = 1 - t;
    return {
      x: u * u * sx + 2 * u * t * cx + t * t * tx,
      y: u * u * sy + 2 * u * t * cy + t * t * ty,
    };
  };

  const step = (now: number) => {
    const rawT = Math.min(1, (now - start) / duration);
    // Ease-in-quad acceleration into magnetic target!
    const t = rawT < 0.5 ? 2 * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 2) / 2;
    const p = bezier(t);
    const scale = 1.08 - 0.26 * t;
    orb.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -50%) scale(${scale})`;

    trails.forEach((dot, idx) => {
      const lagT = Math.max(0, t - (idx + 1) * 0.055);
      const tp = bezier(lagT);
      dot.style.transform = `translate3d(${tp.x}px, ${tp.y}px, 0) translate(-50%, -50%)`;
      dot.style.opacity = String(Math.max(0, (1 - rawT) * (0.65 - idx * 0.11)));
    });

    if (rawT < 1) {
      requestAnimationFrame(step);
    } else {
      orb.remove();
      trails.forEach((d) => d.remove());

      // Impact Recoil on Target Container + Halo Ring + Magnetic Catch Haptics!
      spawnImpactHalo(tx, ty, prof.colors[0]);
      playTactileCue('orb-catch');
      if (toEl.classList.contains('slip')) {
        // Slip uses its own vertical Spring; kick its child info/amount for safe compositing
        const inner = toEl.querySelector<HTMLElement>('.slip-amt') ?? toEl;
        fxOf(inner).scale.config(680, 12).kick(3.4);
      } else {
        fxOf(toEl).ty.config(560, 17).kick(95);
        fxOf(toEl).scale.config(580, 15).kick(1.4);
      }
    }
  };

  requestAnimationFrame(step);
}

function spawnImpactHalo(x: number, y: number, color: string) {
  const stage = getFxStage();
  if (!stage) return;
  const halo = document.createElement('div');
  halo.className = 'yj-fx-ripple';
  halo.style.left = `${x}px`;
  halo.style.top = `${y}px`;
  halo.style.borderColor = color;
  stage.appendChild(halo);
  const anim = halo.animate(
    [
      { transform: 'translate(-50%, -50%) scale(0.3)', opacity: 0.95, borderWidth: '3px' },
      { transform: 'translate(-50%, -50%) scale(2.8)', opacity: 0, borderWidth: '0.5px' },
    ],
    { duration: 420 / getGlobalTimeScale(), easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
  );
  anim.onfinish = () => halo.remove();
}

/* ---------- Visual FX 3: 360° Physics-Simulated Spark Confetti Burst ---------- */
export function burstCelebrationSparks(anchor: HTMLElement | { x: number; y: number } | null, count = 28) {
  if (!anchor || typeof document === 'undefined') return;
  const stage = getFxStage();
  if (!stage) return;
  const prof = currentSkinProfile();

  let ox = window.innerWidth / 2;
  let oy = window.innerHeight / 2;
  if ('x' in anchor) {
    ox = anchor.x;
    oy = anchor.y;
  } else {
    const r = anchor.getBoundingClientRect();
    ox = r.left + r.width / 2;
    oy = r.top + r.height / 2;
  }

  const palette = [...prof.colors, '#10B981', '#F59E0B', '#38BDF8'];
  interface Spark {
    el: HTMLDivElement;
    x: number;
    y: number;
    vx: number;
    vy: number;
    rot: number;
    vrot: number;
  }

  const sparks: Spark[] = Array.from({ length: count }, (_, i) => {
    const el = document.createElement('div');
    el.className = 'yj-fx-spark';
    const isRect = i % 2 === 0;
    el.style.width = isRect ? '8px' : '6px';
    el.style.height = isRect ? '4px' : '6px';
    el.style.borderRadius = isRect ? '2px' : '50%';
    el.style.background = palette[i % palette.length];
    stage.appendChild(el);

    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.35;
    const speed = 150 + Math.random() * 260;
    return {
      el,
      x: ox,
      y: oy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 130,
      rot: Math.random() * 360,
      vrot: (Math.random() - 0.5) * 720,
    };
  });

  const totalMs = 820 / getGlobalTimeScale();
  let prev = performance.now();
  const start = prev;

  const tick = (now: number) => {
    const elapsed = now - start;
    const dt = Math.min(0.04, (now - prev) / 1000) * getGlobalTimeScale();
    prev = now;
    const progress = Math.min(1, elapsed / totalMs);

    for (const sp of sparks) {
      sp.vy += 690 * dt; // Gravity
      sp.vx *= 0.982; // Air drag
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.rot += sp.vrot * dt;
      sp.el.style.transform = `translate3d(${sp.x}px, ${sp.y}px, 0) rotate(${sp.rot}deg) scale(${1 - progress * 0.45})`;
      sp.el.style.opacity = String(Math.max(0, 1 - Math.pow(progress, 1.6)));
    }

    if (progress < 1) {
      requestAnimationFrame(tick);
    } else {
      sparks.forEach((sp) => sp.el.remove());
    }
  };

  requestAnimationFrame(tick);
}

/* ---------- Visual FX 4: Laser Shimmer Sweep & Danger Shudder ---------- */
export function triggerShimmerSweep(container: HTMLElement | null) {
  if (!container) return;
  container.classList.remove('yj-shimmer-active');
  // Force reflow to restart sweep cleanly
  void container.offsetWidth;
  container.classList.add('yj-shimmer-active');
  window.setTimeout(() => {
    container.classList.remove('yj-shimmer-active');
  }, 760);
}

export function shudderDangerElement(el: HTMLElement | null) {
  if (!el) return;
  fxOf(el).tx.config(680, 13).kick(280);
  playTactileCue('danger-heartbeat');
}

/* ---------- Choreographed Full-Combo Showcase ("一键超感连招演示") ---------- */
export function runHyperDemoShowcase(
  originEl: HTMLElement | null,
  targetEl: HTMLElement | null,
  sweepEl: HTMLElement | null
) {
  playTactileCue('tap-on');
  if (originEl) {
    const r = originEl.getBoundingClientRect();
    spawnPointerShockwave(r.left + r.width / 2, r.top + r.height / 2);
  }
  if (originEl && targetEl) {
    launchParabolicOrb(originEl, targetEl, '⚡@2.20');
    window.setTimeout(() => launchParabolicOrb(originEl, targetEl, '🔥@3.25'), 160);
  }
  window.setTimeout(() => {
    triggerShimmerSweep(sweepEl ?? targetEl);
    playTactileCue('optimize-arpeggio');
  }, 460);
  window.setTimeout(() => {
    burstCelebrationSparks(targetEl ?? originEl, 36);
    playTactileCue('defuse-celebrate');
  }, 880);
}
