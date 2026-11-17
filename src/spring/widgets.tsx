import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import {
  Spring,
  fxOf,
  getGlobalTimeScale,
  haptic,
  popStagger,
} from './engine';

/* ---------- Heraldic Team Crest Badge ---------- */
const TEAM_PALETTES: Record<string, [string, string]> = {
  中国: ['#C8102E', '#FFDE00'],
  巴林: ['#CE1126', '#FFFFFF'],
  日本: ['#002366', '#FFFFFF'],
  巴拉圭: ['#D52B1E', '#0038A8'],
  波黑: ['#002395', '#FECB00'],
  罗马尼亚: ['#FCD116', '#002B7F'],
  波兰: ['#DC143C', '#FFFFFF'],
  瑞典: ['#006AA7', '#FECC02'],
  丹麦: ['#C60C30', '#FFFFFF'],
  挪威: ['#BA0C2F', '#00205B'],
  威尔士: ['#D30731', '#00AB39'],
  葡萄牙: ['#046A38', '#DA291C'],
  匈牙利: ['#CD2A3E', '#436F4D'],
  北爱尔兰: ['#006A4E', '#FFFFFF'],
  爱尔兰: ['#169B62', '#FF883E'],
  科索沃: ['#244AA5', '#D0A650'],
  智利: ['#D52B1E', '#0039A6'],
  哥伦比亚: ['#FCD116', '#003893'],
};

function hashColors(name: string): [string, string] {
  if (TEAM_PALETTES[name]) return TEAM_PALETTES[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return [`hsl(${hue}, 64%, 42%)`, `hsl(${(hue + 42) % 360}, 78%, 88%)`];
}

export function TeamCrest({ name, size = 22 }: { name: string; size?: number }) {
  const [c1, c2] = hashColors(name);
  const ch = name.slice(0, 1);
  return (
    <span className="crest" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill={c1} />
        <path d="M12 1 A11 11 0 0 1 23 12 L12 12 Z" fill={c2} fillOpacity="0.28" />
        <circle cx="12" cy="12" r="10.2" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="0.9" />
        <text
          x="12"
          y="16.1"
          textAnchor="middle"
          fill="#FFFFFF"
          fontSize="11"
          fontWeight="700"
          fontFamily="-apple-system, PingFang SC, sans-serif"
        >
          {ch}
        </text>
      </svg>
    </span>
  );
}

/* ---------- Velocity-Stretched Segmented Control ---------- */
interface SpringSegmentedProps<T extends string> {
  options: Array<[T, string]>;
  value: T;
  onChange: (val: T) => void;
  small?: boolean;
  skinKey?: string;
}

export function SpringSegmented<T extends string>({
  options,
  value,
  onChange,
  small,
  skinKey,
}: SpringSegmentedProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const springsRef = useRef<{ x: Spring; w: Spring } | null>(null);
  const firstMount = useRef(true);

  if (!springsRef.current) {
    const apply = () => {
      const thumb = thumbRef.current;
      const st = springsRef.current;
      if (!thumb || !st) return;
      const stretch = 1 + Math.min(Math.abs(st.x.v) / 3200, 0.16);
      thumb.style.width = `${st.w.x}px`;
      thumb.style.transform = `translate3d(${st.x.x}px,0,0) scaleX(${stretch})`;
    };
    springsRef.current = {
      x: new Spring(0, { k: 520, c: 27, eps: 0.05, onUpdate: apply }),
      w: new Spring(0, { k: 520, c: 27, eps: 0.05, onUpdate: apply }),
    };
  }

  const syncPosition = (animate: boolean) => {
    const root = trackRef.current;
    const st = springsRef.current;
    if (!root || !st) return;
    const btn = root.querySelector<HTMLElement>(`[data-val="${value}"]`);
    if (!btn) return;
    const x = btn.offsetLeft;
    const w = btn.offsetWidth;
    if (animate) {
      st.x.set(x);
      st.w.set(w);
    } else {
      st.x.jump(x);
      st.w.jump(w);
    }
  };

  useLayoutEffect(() => {
    syncPosition(!firstMount.current);
    firstMount.current = false;
  }, [value, options.length]);

  useEffect(() => {
    const id = requestAnimationFrame(() => syncPosition(false));
    return () => cancelAnimationFrame(id);
  }, [skinKey]);

  return (
    <div
      ref={trackRef}
      className={`seg-track ${small ? 'sm' : ''}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      <div ref={thumbRef} className="seg-thumb" />
      {options.map(([k, label]) => (
        <button
          key={k}
          type="button"
          data-val={k}
          data-spring="0.93"
          onClick={() => {
            if (k !== value) {
              haptic(6);
              onChange(k);
            }
          }}
          className={`seg-btn ${k === value ? 'on' : ''}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Elastic Knob Switch ---------- */
interface SpringSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
}

export function SpringSwitch({ checked, onChange }: SpringSwitchProps) {
  const knobRef = useRef<HTMLElement>(null);
  const sprRef = useRef<{ p: Spring; w: Spring } | null>(null);
  const mounted = useRef(false);

  if (!sprRef.current) {
    const apply = () => {
      const el = knobRef.current;
      const o = sprRef.current;
      if (!el || !o) return;
      const w = o.w.x;
      const p = Math.max(-0.05, Math.min(1.05, o.p.x));
      el.style.width = `${w}px`;
      el.style.transform = `translate3d(${p * (48 - 4 - w)}px,0,0)`;
    };
    sprRef.current = {
      p: new Spring(checked ? 1 : 0, { k: 520, c: 25, onUpdate: apply }),
      w: new Spring(24, { k: 620, c: 30, eps: 0.05, onUpdate: apply }),
    };
  }

  useLayoutEffect(() => {
    const o = sprRef.current!;
    if (!mounted.current) {
      mounted.current = true;
      o.w.jump(24);
      o.p.jump(checked ? 1 : 0);
    } else {
      o.p.set(checked ? 1 : 0);
    }
  }, [checked]);

  return (
    <button
      type="button"
      className={`switch ${checked ? 'on' : ''}`}
      onPointerDown={() => sprRef.current?.w.set(30)}
      onPointerUp={() => sprRef.current?.w.set(24)}
      onPointerCancel={() => sprRef.current?.w.set(24)}
      onClick={() => {
        haptic(8);
        onChange(!checked);
      }}
    >
      <i ref={knobRef} className="knob" />
    </button>
  );
}

/* ---------- Spring + Pointer-Drag-to-Dismiss Bottom Sheet ---------- */
interface SpringSheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  onAfterOpen?: (sheetEl: HTMLElement) => void;
}

export function SpringSheet({ open, onClose, children, onAfterOpen }: SpringSheetProps) {
  const maskRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const ySpringRef = useRef<Spring | null>(null);
  const closingRef = useRef(false);

  const triggerClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    const sh = sheetRef.current;
    const mask = maskRef.current;
    const y = ySpringRef.current;
    if (!sh || !y) {
      onClose();
      return;
    }
    if (mask) mask.style.pointerEvents = 'none';
    const H = sh.offsetHeight || 520;
    y.config(420, 38).set(H + 40);
    y.onRest = () => {
      closingRef.current = false;
      onClose();
    };
  };

  useLayoutEffect(() => {
    if (!open) return;
    closingRef.current = false;
    const sh = sheetRef.current;
    const mask = maskRef.current;
    if (!sh || !mask) return;

    const H = sh.offsetHeight || 520;
    const y = new Spring(H, {
      k: 400,
      c: 29,
      eps: 0.05,
      onUpdate: (v) => {
        sh.style.transform = `translate3d(0,${v < 0 ? v * 0.3 : v}px,0)`;
        mask.style.opacity = String(Math.max(0, Math.min(1, 1 - v / H)));
      },
    });
    ySpringRef.current = y;
    y.jump(H);
    y.set(0);
    haptic(6);

    // Pop stagger any `.pop` grids inside the sheet
    let d = 0;
    sh.querySelectorAll<HTMLElement>('.pop').forEach((c) => {
      window.setTimeout(() => popStagger(c, 12), d / getGlobalTimeScale());
      d += 65;
    });

    onAfterOpen?.(sh);

    return () => {
      y.stop();
    };
  }, [open]);

  // Pointer drag on `.grabber` or `[data-drag]`
  const dragRef = useRef({ active: false, sy: 0, sv: 0, ly: 0, lt: 0, vel: 0 });

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const y = ySpringRef.current;
    if (!y) return;
    dragRef.current = {
      active: true,
      sy: e.clientY,
      sv: y.x,
      ly: e.clientY,
      lt: performance.now(),
      vel: 0,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    y.stop();
    y.v = 0;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const dr = dragRef.current;
    const y = ySpringRef.current;
    if (!dr.active || !y) return;
    const ny = dr.sv + (e.clientY - dr.sy);
    y.x = ny;
    y.to = ny;
    y.onUpdate?.(ny);
    const now = performance.now();
    dr.vel = (e.clientY - dr.ly) / Math.max((now - dr.lt) / 1000, 0.001);
    dr.ly = e.clientY;
    dr.lt = now;
  };

  const handlePointerUp = () => {
    const dr = dragRef.current;
    const y = ySpringRef.current;
    const sh = sheetRef.current;
    if (!dr.active || !y || !sh) return;
    dr.active = false;
    y.v = dr.vel;
    const H = sh.offsetHeight || 500;
    if (y.x > H * 0.28 || dr.vel > 880) {
      triggerClose();
    } else {
      y.config(420, 28).set(0);
    }
  };

  if (!open) return null;

  return (
    <>
      <div ref={maskRef} className="mask" onClick={triggerClose} />
      <div ref={sheetRef} className="sheet">
        <div
          className="grabber"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <i />
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </>
  );
}

/* ---------- Spring Probability Bar (3 segments springing from 0 -> %) ---------- */
export function SpringProbBar({ probs }: { probs: [number, number, number] }) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const segs = [...el.querySelectorAll<HTMLElement>('i')];
    const springs = segs.map(
      (seg) =>
        new Spring(0, {
          k: 160,
          c: 17,
          eps: 0.05,
          onUpdate: (v) => {
            seg.style.width = `${Math.max(0, v)}%`;
          },
        })
    );
    springs.forEach((s, idx) => {
      window.setTimeout(
        () => s.set(probs[idx]),
        (100 + idx * 85) / getGlobalTimeScale()
      );
    });
    return () => springs.forEach((s) => s.stop());
  }, [probs[0], probs[1], probs[2]]);

  return (
    <>
      <div ref={barRef} className="prob">
        <i />
        <i />
        <i />
      </div>
      <div className="prob-l num">
        <span>主胜 {probs[0].toFixed(0)}%</span>
        <span>平局 {probs[1].toFixed(0)}%</span>
        <span>客胜 {probs[2].toFixed(0)}%</span>
      </div>
    </>
  );
}

/** Kick helper when clicking a button */
export function kickElement(el: HTMLElement | null, velocity = 2.6) {
  if (!el) return;
  fxOf(el).scale.kick(velocity);
}
