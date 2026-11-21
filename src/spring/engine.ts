/* =========================================================
   240Hz Fixed-Substep Damped Harmonic Oscillator Spring Engine
   ========================================================= */

import {
  STUDIO_SKIN_OPTIONS,
  type SkinPresetDef,
} from "../mobile/cabins/cabinViewModels.ts";

export type SkinDef = SkinPresetDef;
export const SKINS: SkinDef[] = STUDIO_SKIN_OPTIONS;

let TIME_SCALE = 1;
export function setGlobalTimeScale(scale: number) {
  TIME_SCALE = Math.max(0.05, Math.min(2, scale));
}
export function getGlobalTimeScale(): number {
  return TIME_SCALE;
}

const ACTIVE = new Set<Spring>();
let rafId: number | null = null;
let lastT = 0;

export class Spring {
  x: number;
  v = 0;
  to: number;
  k: number;
  c: number;
  eps: number;
  onUpdate: ((val: number) => void) | null;
  onRest: (() => void) | null = null;

  constructor(
    value: number,
    opts: {
      k?: number;
      c?: number;
      eps?: number;
      onUpdate?: (val: number) => void;
    } = {}
  ) {
    this.x = value;
    this.to = value;
    this.k = opts.k ?? 420;
    this.c = opts.c ?? 26;
    this.eps = opts.eps ?? 0.001;
    this.onUpdate = opts.onUpdate ?? null;
  }

  config(k: number, c: number): this {
    this.k = k;
    this.c = c;
    return this;
  }

  set(to: number): this {
    this.to = to;
    wake(this);
    return this;
  }

  jump(val: number): this {
    this.x = val;
    this.to = val;
    this.v = 0;
    ACTIVE.delete(this);
    this.onUpdate?.(val);
    return this;
  }

  kick(vel: number): this {
    this.v += vel;
    wake(this);
    return this;
  }

  stop(): void {
    ACTIVE.delete(this);
  }
}

function wake(s: Spring) {
  ACTIVE.add(s);
  if (rafId === null) {
    lastT = performance.now();
    rafId = requestAnimationFrame(tick);
  }
}

function tick(now: number) {
  const dt = Math.min((now - lastT) / 1000, 0.1) * TIME_SCALE;
  lastT = now;
  for (const s of [...ACTIVE]) {
    let t = dt;
    while (t > 0) {
      const h = Math.min(1 / 240, t);
      const a = -s.k * (s.x - s.to) - s.c * s.v;
      s.v += a * h;
      s.x += s.v * h;
      t -= h;
    }
    s.onUpdate?.(s.x);
    if (Math.abs(s.x - s.to) < s.eps && Math.abs(s.v) < s.eps * 10) {
      s.x = s.to;
      s.v = 0;
      s.onUpdate?.(s.x);
      ACTIVE.delete(s);
      const r = s.onRest;
      s.onRest = null;
      r?.();
    }
  }
  rafId = ACTIVE.size > 0 ? requestAnimationFrame(tick) : null;
}

export let PRESS_CFG: [number, number] = [1100, 52];
export let RELEASE_CFG: [number, number] = [480, 13];

export function readSpringTokens() {
  const cs = getComputedStyle(document.documentElement);
  const p = cs
    .getPropertyValue("--spring-press")
    .trim()
    .split(/\s+/)
    .map(Number);
  const r = cs
    .getPropertyValue("--spring-release")
    .trim()
    .split(/\s+/)
    .map(Number);
  if (p.length === 2 && p.every(Number.isFinite)) PRESS_CFG = [p[0], p[1]];
  if (r.length === 2 && r.every(Number.isFinite)) RELEASE_CFG = [r[0], r[1]];
}

import {
  currentSkinProfile,
  playTactileCue,
  spawnPointerShockwave,
  vibratePattern,
} from "./tactileSymphony";

export function haptic(ms = 8) {
  vibratePattern([ms]);
}

interface ElementFX {
  s: number;
  sx: number;
  sy: number;
  x: number;
  y: number;
  scale: Spring;
  scaleX: Spring;
  scaleY: Spring;
  tx: Spring;
  ty: Spring;
}

const FX = new WeakMap<HTMLElement, ElementFX>();

export function fxOf(el: HTMLElement): ElementFX {
  let f = FX.get(el);
  if (!f) {
    const state = { s: 1, sx: 1, sy: 1, x: 0, y: 0 } as ElementFX;
    const apply = () => {
      const fxX = state.s * state.sx;
      const fxY = state.s * state.sy;
      el.style.transform = `translate3d(${state.x}px,${state.y}px,0) scale3d(${fxX},${fxY},1)`;
    };
    state.scale = new Spring(1, {
      k: RELEASE_CFG[0],
      c: RELEASE_CFG[1],
      onUpdate: (v) => {
        state.s = v;
        apply();
      },
    });
    state.scaleX = new Spring(1, {
      k: 540,
      c: 15,
      onUpdate: (v) => {
        state.sx = v;
        apply();
      },
    });
    state.scaleY = new Spring(1, {
      k: 460,
      c: 13,
      onUpdate: (v) => {
        state.sy = v;
        apply();
      },
    });
    state.ty = new Spring(0, {
      k: 380,
      c: 26,
      eps: 0.05,
      onUpdate: (v) => {
        state.y = v;
        apply();
      },
    });
    state.tx = new Spring(0, {
      k: 380,
      c: 30,
      eps: 0.05,
      onUpdate: (v) => {
        state.x = v;
        apply();
      },
    });
    FX.set(el, state);
    f = state;
  }
  return f;
}

/** Staggered vertical entrance for `.enter` children */
export function enterStagger(container: HTMLElement | null, step = 34) {
  if (!container) return;
  const items = [...container.querySelectorAll<HTMLElement>(":scope > .enter")];
  items.forEach((el, i) => {
    const f = fxOf(el);
    const base = f.ty.onUpdate;
    el.style.opacity = "0";
    f.ty.jump(18);
    f.ty.onUpdate = (v) => {
      base?.(v);
      el.style.opacity = String(Math.max(0, Math.min(1, 1 - v / 18)));
    };
    window.setTimeout(
      () => {
        f.ty.config(340, 23).set(0);
        f.ty.onRest = () => {
          f.ty.onUpdate = base;
          el.style.opacity = "";
        };
      },
      (i * step) / TIME_SCALE
    );
  });
}

/** Pop-scale stagger for grid cells in sheets */
export function popStagger(container: HTMLElement | null, step = 12) {
  if (!container) return;
  [...container.children].forEach((node, i) => {
    const el = node as HTMLElement;
    const f = fxOf(el);
    f.scale.jump(0.55);
    el.style.opacity = "0";
    window.setTimeout(
      () => {
        el.style.opacity = "";
        f.scale.config(520, 16).set(1);
      },
      (i * step) / TIME_SCALE
    );
  });
}

const NUMS = new WeakMap<HTMLElement, Spring>();
export function animateNumber(
  el: HTMLElement | null,
  from: number,
  to: number,
  fmt: (v: number) => string
) {
  if (!el) return;
  let s = NUMS.get(el);
  if (!s) {
    s = new Spring(from, { k: 170, c: 26, eps: 0.02 });
    NUMS.set(el, s);
  }
  s.onUpdate = (v) => {
    el.textContent = fmt(v);
  };
  s.set(to);
}

/** 3D Perspective Tilt + Holographic Specular Glare (Pointer + Mobile Gyroscope) */
const TILT_CLEANUP = new WeakMap<HTMLElement, () => void>();

export function bindTilt(el: HTMLElement | null): () => void {
  if (!el) return () => {};
  TILT_CLEANUP.get(el)?.();

  const rx = new Spring(0, { k: 260, c: 16, eps: 0.01, onUpdate: apply });
  const ry = new Spring(0, { k: 260, c: 16, eps: 0.01, onUpdate: apply });

  function apply() {
    if (!el) return;
    el.style.transform = `perspective(720px) rotateX(${rx.x}deg) rotateY(${ry.x}deg)`;
    const gx = 50 + ry.x * 3.2;
    const gy = 50 - rx.x * 3.2;
    el.style.setProperty("--glare-x", `${gx.toFixed(1)}%`);
    el.style.setProperty("--glare-y", `${gy.toFixed(1)}%`);
  }

  const onMove = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    ry.set(((e.clientX - r.left) / r.width - 0.5) * 16);
    rx.set(-((e.clientY - r.top) / r.height - 0.5) * 16);
    el.style.setProperty("--glare-o", "0.26");
  };

  const onLeave = () => {
    rx.set(0);
    ry.set(0);
    el.style.setProperty("--glare-o", "0.12");
  };

  const onOrient = (ev: DeviceOrientationEvent) => {
    if (ev.gamma === null || ev.beta === null) return;
    const clampedX = Math.max(-14, Math.min(14, ev.gamma * 0.42));
    const clampedY = Math.max(-14, Math.min(14, (ev.beta - 45) * 0.38));
    ry.set(clampedX);
    rx.set(-clampedY);
    el.style.setProperty("--glare-o", "0.24");
  };

  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerleave", onLeave);
  window.addEventListener("deviceorientation", onOrient, { passive: true });

  const cleanup = () => {
    rx.stop();
    ry.stop();
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerleave", onLeave);
    window.removeEventListener("deviceorientation", onOrient);
    TILT_CLEANUP.delete(el);
  };
  TILT_CLEANUP.set(el, cleanup);
  return cleanup;
}

/** Spring Toast Notification (XSS-safe textContent) */
export function showSpringToast(layer: HTMLElement | null, msg: string) {
  if (!layer) return;
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12.5 10 17.5 19 7"/></svg>`;
  const textSpan = document.createElement("span");
  textSpan.textContent = msg;
  t.appendChild(textSpan);
  layer.appendChild(t);
  const st = { s: 0.6, y: -18 };
  let leaving = false;
  const apply = () => {
    t.style.transform = `translate3d(-50%,${st.y}px,0) scale(${st.s})`;
  };
  const s = new Spring(0.6, {
    k: 520,
    c: 17,
    onUpdate: (v) => {
      st.s = v;
      apply();
      if (!leaving)
        t.style.opacity = String(Math.min(1, Math.max(0, (v - 0.6) / 0.3)));
    },
  });
  const y = new Spring(-18, {
    k: 420,
    c: 21,
    eps: 0.05,
    onUpdate: (v) => {
      st.y = v;
      apply();
    },
  });
  s.set(1);
  y.set(0);
  window.setTimeout(() => {
    leaving = true;
    t.style.transition = "opacity 0.22s";
    t.style.opacity = "0";
    s.config(500, 40).set(0.85);
    y.config(500, 40).set(-22);
    y.onRest = () => t.remove();
  }, 1500 / TIME_SCALE);
}

/** Bind global tactile press/release listener once with Anisotropic Jelly Squash + Shockwave */
let globalBound = false;
export function ensureGlobalTactileListener(
  onSwitchPress?: (swId: string, down: boolean) => void
) {
  if (globalBound) return;
  globalBound = true;

  let pressed: HTMLElement | null = null;
  let pressedSwId: string | null = null;

  document.addEventListener("pointerdown", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const sw = target.closest<HTMLElement>(".switch[data-sw]");
    if (sw?.dataset.sw) {
      pressedSwId = sw.dataset.sw;
      onSwitchPress?.(pressedSwId, true);
    }
    const el = target.closest<HTMLElement>("[data-spring]");
    if (!el) return;
    pressed = el;
    el.classList.add("down");

    spawnPointerShockwave(e.clientX, e.clientY);
    playTactileCue("press");

    const ratio = parseFloat(el.dataset.spring || "0.92") || 0.92;
    const prof = currentSkinProfile();
    const fx = fxOf(el);
    fx.scale.config(PRESS_CFG[0], PRESS_CFG[1]).set(ratio);
    fx.scaleX
      .config(PRESS_CFG[0] * 0.85, PRESS_CFG[1] * 0.62)
      .set(prof.squashX);
    fx.scaleY
      .config(PRESS_CFG[0] * 0.85, PRESS_CFG[1] * 0.62)
      .set(prof.squashY);
  });

  const release = () => {
    if (pressedSwId) {
      onSwitchPress?.(pressedSwId, false);
      pressedSwId = null;
    }
    if (!pressed) return;
    const el = pressed;
    pressed = null;
    el.classList.remove("down");
    const fx = fxOf(el);
    fx.scale.config(RELEASE_CFG[0], RELEASE_CFG[1]).set(1);
    fx.scaleX.config(RELEASE_CFG[0] * 1.08, RELEASE_CFG[1]).set(1);
    fx.scaleY
      .config(RELEASE_CFG[0] * 0.92, Math.max(10, RELEASE_CFG[1] - 2))
      .set(1);
  };

  document.addEventListener("pointerup", release);
  document.addEventListener("pointercancel", release);
}
