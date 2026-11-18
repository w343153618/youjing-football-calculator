let shieldMounted = false;
let fusedTriggered = false;
let currentSessionIdGetter: () => string | null = () => null;

export function registerShieldSessionGetter(fn: () => string | null) {
  currentSessionIdGetter = fn;
}

/**
 * 立即触发高压熔断保护：通知服务端封禁当前会话令牌（15分钟冷却），并彻底销毁前端 DOM
 */
export function triggerSecurityMeltdown(_reason: string) {
  if (fusedTriggered || typeof window === 'undefined') return;
  fusedTriggered = true;

  try {
    if (window.self !== window.top) {
      window.top?.postMessage({ cmd: 'yj-security-meltdown' }, window.location.origin);
    }
  } catch {
    // ignore cross-frame error
  }

  try {
    const metaEnv = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
    const base = metaEnv?.BASE_URL || '/';
    const sid = currentSessionIdGetter();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (sid) headers['X-YJ-Sid'] = sid;
    void fetch(`${base}api/security/fuse`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ t: Date.now() }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore network error during meltdown
  }

  try {
    window.sessionStorage.clear();
  } catch {
    // ignore
  }

  if (typeof document !== 'undefined' && document.body) {
    document.title = '安全熔断保护中';
    document.body.innerHTML = `
      <div style="position:fixed;inset:0;z-index:999999;background:#090d16;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;user-select:none;">
        <div style="max-width:430px;padding:28px 24px;border-radius:20px;background:rgba(30,41,59,0.82);border:1px solid rgba(239,68,68,0.45);box-shadow:0 24px 60px rgba(0,0,0,0.65);">
          <div style="font-size:28px;margin-bottom:10px;">🛡️</div>
          <h2 style="margin:0 0 10px;font-size:17px;font-weight:700;color:#f87171;">安全防护已触发 · 会话已熔断锁定</h2>
          <p style="margin:0;font-size:13px;line-height:1.65;color:#94a3b8;">
            系统检测到开发者调试工具、抓包重放或异常抓取环境，已自动清空精算工作台并临时封禁当前会话（15 分钟后自动解除）。
          </p>
        </div>
      </div>
    `;
  }
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
 * 挂载高压防逆向与防扒取护盾（零误伤移动端软键盘与浏览器书签栏）
 */
export function initHighPressureAntiReverseShield(embedded = false) {
  if (shieldMounted || typeof window === 'undefined' || typeof document === 'undefined') return;
  shieldMounted = true;

  if (isHeadlessOrAutomationEnv()) {
    triggerSecurityMeltdown('headless-signature');
    return;
  }

  window.addEventListener('message', (ev) => {
    if (ev.origin === window.location.origin && ev.data?.cmd === 'yj-security-meltdown') {
      triggerSecurityMeltdown('child-frame-meltdown');
    }
  });

  // Global CSS user-select protection (allow <input>/<textarea> typing)
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

  // High-Pressure DevTools & View-Source Shortcut Interceptor
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
        if (isViewSource) triggerSecurityMeltdown('view-source-shortcut');
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

  // Multi-consecutive Debugger Breakpoint Pause Probe (desktop fine-pointer only; zero false-positives on CPU/background spikes)
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
