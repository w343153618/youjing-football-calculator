const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

let shieldMounted = false;
let fusedTriggered = false;
let cachedHwFp: string | null = null;
let currentSessionIdGetter: () => string | null = () => null;

export function registerShieldSessionGetter(fn: () => string | null) {
  currentSessionIdGetter = fn;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * 提取跨浏览器/跨 Profile 物理硬件特征指纹（GPU 渲染器型号 + 显存纹理上限 + 物理屏幕尺寸色深 + CPU 核心数 + 时区）
 * 在同一台电脑上切换无痕窗口、新建 Chrome Profile 或换用 Edge/Brave 均保持一致
 */
export async function getCrossBrowserHardwareFingerprint(): Promise<string> {
  if (cachedHwFp) return cachedHwFp;
  if (typeof window === 'undefined') return '0'.repeat(64);

  let gpuSig = 'no-webgl';
  try {
    const canvas = document.createElement('canvas');
    const gl =
      (canvas.getContext('webgl') as WebGLRenderingContext | null) ||
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const vendor = dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : '';
      const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      const maxTex = String(gl.getParameter(gl.MAX_TEXTURE_SIZE));
      const maxRb = String(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
      const maxVp = Array.from((gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array) || []).join(
        'x'
      );
      gpuSig = `${vendor}|${renderer}|${maxTex}|${maxRb}|${maxVp}`;
    }
  } catch {
    // ignore webgl errors
  }

  const scr = typeof window.screen !== 'undefined' ? window.screen : { width: 0, height: 0, colorDepth: 24 };
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const rawTrait = [
    navigator.platform || 'unk',
    `${scr.width}x${scr.height}x${scr.colorDepth}`,
    String(navigator.hardwareConcurrency || 4),
    String(navigator.maxTouchPoints || 0),
    tz,
    gpuSig,
  ].join('||');

  try {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(rawTrait) as BufferSource
    );
    cachedHwFp = bytesToHex(new Uint8Array(digest));
    return cachedHwFp;
  } catch {
    // fallback simple deterministic hex if subtle unavailable
    let h = 2166136261;
    for (let i = 0; i < rawTrait.length; i++) {
      h ^= rawTrait.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    cachedHwFp = Math.abs(h).toString(16).padStart(32, '0').repeat(2);
    return cachedHwFp;
  }
}

function renderMeltdownDom(unlockAtMs: number) {
  if (typeof document === 'undefined' || !document.body) return;
  const rem = Math.max(60_000, unlockAtMs - Date.now());
  const hrs = Math.floor(rem / 3_600_000);
  const mins = Math.ceil((rem % 3_600_000) / 60_000) % 60;
  const timeText = hrs > 0 ? `${hrs} 小时 ${mins} 分钟` : `${Math.ceil(rem / 60_000)} 分钟`;

  document.title = '访问阻断 · 熔断天平 48 小时整机锁定中';
  document.body.innerHTML = `
    <div style="position:fixed;inset:0;z-index:999999;background:#070a12;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;user-select:none;">
      <div style="max-width:450px;padding:30px 26px;border-radius:22px;background:rgba(15,23,42,0.88);border:1px solid rgba(239,68,68,0.5);box-shadow:0 28px 70px rgba(0,0,0,0.75);">
        <div style="font-size:34px;margin-bottom:10px;">⚖️</div>
        <h2 style="margin:0 0 10px;font-size:18px;font-weight:700;color:#f87171;">安全熔断天平已触发 · 整机全浏览器封禁 48 小时</h2>
        <div style="display:inline-block;margin:6px 0 14px;padding:5px 14px;border-radius:99px;background:rgba(239,68,68,0.16);color:#fca5a5;font-size:12.5px;font-weight:600;border:1px solid rgba(239,68,68,0.32);">
          剩余锁定时长：${timeText}
        </div>
        <p style="margin:0;font-size:12.5px;line-height:1.68;color:#94a3b8;">
          系统检测到开发者调试工具探测、抓包重放或异常抓取行为，已同步锁定当前电脑硬件设备指纹、网络出口与全部浏览器会话，切换浏览器、新建 Profile 或无痕窗口均无法解除。
        </p>
      </div>
    </div>
  `;
}

/**
 * 立即触发 48 小时整机熔断天平：通知服务端封禁硬件指纹 + 网络 IP + 会话，并清空前端 DOM
 */
export function triggerSecurityMeltdown(reason: string, serverUnlockAt?: number) {
  if (fusedTriggered || typeof window === 'undefined') return;
  fusedTriggered = true;

  const unlockAt =
    serverUnlockAt && serverUnlockAt > Date.now()
      ? serverUnlockAt
      : Date.now() + FORTY_EIGHT_HOURS_MS;

  try {
    if (window.self !== window.top) {
      window.top?.postMessage({ cmd: 'yj-security-meltdown', unlockAt }, window.location.origin);
    }
  } catch {
    // ignore
  }

  const alreadyFusedOnServer =
    reason === 'bootstrap-fused' ||
    reason === 'api-fused' ||
    reason === 'qa-violation-lock' ||
    reason === 'child-frame-meltdown';

  if (!alreadyFusedOnServer) {
    void (async () => {
      try {
        const hwFp = await getCrossBrowserHardwareFingerprint();
        const metaEnv = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
        const base = metaEnv?.BASE_URL || '/';
        const sid = currentSessionIdGetter();
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-YJ-Hw': hwFp,
        };
        if (sid) headers['X-YJ-Sid'] = sid;
        await fetch(`${base}api/security/fuse`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ t: Date.now(), hwFp }),
          keepalive: true,
        });
      } catch {
        // ignore network error during meltdown
      }
    })();
  }

  try {
    window.sessionStorage.clear();
  } catch {
    // ignore
  }

  renderMeltdownDom(unlockAt);
}

function isHeadlessOrAutomationEnv(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (
    /HeadlessChrome|PhantomJS|SlimerJS|Nightmare|CasperJS|Scrapy|HTTrack|Bytespider|Doubao|Jina|Firecrawl/i.test(
      ua
    )
  ) {
    return true;
  }
  const uaData = (navigator as unknown as { userAgentData?: { brands?: Array<{ brand: string }> } })
    .userAgentData;
  if (uaData?.brands?.some((b) => /Headless/i.test(b.brand))) {
    return true;
  }
  const w = window as unknown as Record<string, unknown>;
  if (w._phantom || w.__nightmare || w.callPhantom || w._selenium || w.__webdriver_script_fn) {
    return true;
  }
  return false;
}

/**
 * 挂载高压防逆向与 48 小时整机熔断天平护盾
 */
export function initHighPressureAntiReverseShield(embedded = false) {
  if (shieldMounted || typeof window === 'undefined' || typeof document === 'undefined') return;
  shieldMounted = true;

  // Warm hardware fingerprint immediately (authoritative 48h lock resides in server security-bans.json so SSH unban works cleanly!)
  void getCrossBrowserHardwareFingerprint();

  if (isHeadlessOrAutomationEnv()) {
    triggerSecurityMeltdown('headless-signature');
    return;
  }

  window.addEventListener('message', (ev) => {
    if (ev.origin === window.location.origin && ev.data?.cmd === 'yj-security-meltdown') {
      triggerSecurityMeltdown('child-frame-meltdown', ev.data.unlockAt);
    }
  });

  const style = document.createElement('style');
  style.textContent = `
    body, .jz-root, .manual-dialog {
      -webkit-user-select: none !important;
      user-select: none !important;
      -webkit-touch-callout: none !important;
    }
    input, textarea {
      -webkit-user-select: text !important;
      user-select: text !important;
    }
  `;
  document.head.appendChild(style);

  document.addEventListener(
    'contextmenu',
    (e) => {
      e.preventDefault();
    },
    { capture: true }
  );

  document.addEventListener(
    'dragstart',
    (e) => {
      e.preventDefault();
    },
    { capture: true }
  );

  const blockClipboard = (e: ClipboardEvent) => {
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    e.clipboardData?.setData('text/plain', '受保护内部内容禁止复制');
  };
  document.addEventListener('copy', blockClipboard, { capture: true });
  document.addEventListener('cut', blockClipboard, { capture: true });

  window.addEventListener(
    'keydown',
    (e) => {
      const key = e.key?.toUpperCase() || '';
      const isF12 = key === 'F12' || e.keyCode === 123;
      const isWinDevTools = e.ctrlKey && e.shiftKey && ['I', 'J', 'C', 'K'].includes(key);
      const isMacDevTools = e.metaKey && e.altKey && ['I', 'J', 'C', 'K'].includes(key);
      const isViewSource = (e.ctrlKey && key === 'U') || (e.metaKey && e.altKey && key === 'U');
      const isSavePage = (e.ctrlKey || e.metaKey) && key === 'S';

      if (isSavePage || isViewSource) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (isF12 || isWinDevTools || isMacDevTools) {
        e.preventDefault();
        e.stopPropagation();
        triggerSecurityMeltdown('devtools-shortcut');
      }
    },
    { capture: true }
  );

  if (embedded) return;

  const isCoarsePointer =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  if (isCoarsePointer) return;

  let consecutiveLongPauses = 0;
  const probeTimer = window.setInterval(() => {
    if (fusedTriggered) {
      window.clearInterval(probeTimer);
      return;
    }
    if (document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus())) {
      consecutiveLongPauses = 0;
      return;
    }
    const t0 = performance.now();
    try {
      new Function('debugger')();
    } catch {
      // ignore
    }
    const elapsed = performance.now() - t0;
    const stillFocused = !document.hidden && (!document.hasFocus || document.hasFocus());
    if (stillFocused && elapsed > 180) {
      consecutiveLongPauses += 1;
      if (consecutiveLongPauses >= 3) {
        window.clearInterval(probeTimer);
        triggerSecurityMeltdown('debugger-timing');
      }
    } else {
      consecutiveLongPauses = 0;
    }
  }, 1500);
}
