import { useEffect, useState, type FormEvent } from 'react';
import {
  AuthLoginError,
  loginWithPassword,
  type AuthenticatedWorkspaceBundle,
} from '../security/secureClient';
import { playTactileCue } from '../spring/tactileSymphony';

export function LoginGate({
  initialNotice,
  onLoginSuccess,
}: {
  initialNotice?: string | null;
  onLoginSuccess: (bundle: AuthenticatedWorkspaceBundle) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(initialNotice || null);
  const [lockedSec, setLockedSec] = useState<number>(0);

  useEffect(() => {
    if (initialNotice) setErrorMsg(initialNotice);
  }, [initialNotice]);

  useEffect(() => {
    if (lockedSec <= 0) return;
    const t = window.setInterval(() => {
      setLockedSec((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(t);
  }, [lockedSec]);

  const formatCountdown = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m >= 60) {
      const h = Math.floor(m / 60);
      const rm = m % 60;
      return `${h}小时${String(rm).padStart(2, '0')}分${String(s).padStart(2, '0')}秒`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || lockedSec > 0) return;
    const u = username.trim();
    if (!u || !password) {
      setErrorMsg('请输入内部授权账号与密码');
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const bundle = await loginWithPassword(u, password);
      playTactileCue('defuse-celebrate');
      onLoginSuccess(bundle);
    } catch (err) {
      playTactileCue('tap-off');
      if (err instanceof AuthLoginError) {
        setErrorMsg(err.message);
        if (err.lockedRemainingSec > 0) {
          setLockedSec(err.lockedRemainingSec);
        }
      } else if (String((err as Error)?.message) !== 'Fused') {
        setErrorMsg((err as Error)?.message || '网络连接波动，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100dvh',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px 16px',
        background:
          'radial-gradient(circle at 20% 15%, rgba(37, 99, 235, 0.16), transparent 48%), radial-gradient(circle at 82% 85%, rgba(16, 185, 129, 0.14), transparent 48%), #070b14',
        color: '#f8fafc',
        fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 410,
          borderRadius: 24,
          padding: '30px 26px 26px',
          background: 'rgba(15, 23, 42, 0.88)',
          border: '1px solid rgba(148, 163, 184, 0.2)',
          boxShadow: '0 28px 80px rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(18px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 13,
              background: 'linear-gradient(135deg, #2563eb, #0d9488)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: 15,
              color: '#fff',
              boxShadow: '0 8px 20px rgba(37, 99, 235, 0.35)',
              flexShrink: 0,
            }}
          >
            优竞
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '-0.01em' }}>
              优竞体育内部专用
            </h1>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: '#94a3b8' }}>
              智能精算与风控工作台 · 内部成员专属通行门禁
            </p>
          </div>
        </div>

        {errorMsg && (
          <div
            style={{
              marginBottom: 16,
              padding: '10px 12px',
              borderRadius: 12,
              background: lockedSec > 0 ? 'rgba(245, 158, 11, 0.14)' : 'rgba(239, 68, 68, 0.14)',
              border: `1px solid ${
                lockedSec > 0 ? 'rgba(245, 158, 11, 0.38)' : 'rgba(239, 68, 68, 0.36)'
              }`,
              color: lockedSec > 0 ? '#fde68a' : '#fca5a5',
              fontSize: 12.5,
              lineHeight: 1.55,
            }}
          >
            <div>{errorMsg}</div>
            {lockedSec > 0 && (
              <div style={{ marginTop: 4, fontWeight: 700, color: '#fbbf24' }}>
                🔒 安全冷却倒计时：{formatCountdown(lockedSec)} 后恢复输入
              </div>
            )}
          </div>
        )}

        <form
          onSubmit={(e) => void handleSubmit(e)}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <div>
            <label
              htmlFor="yj-login-user"
              style={{
                display: 'block',
                fontSize: 12,
                color: '#cbd5e1',
                marginBottom: 6,
                fontWeight: 600,
              }}
            >
              内部授权账号
            </label>
            <input
              id="yj-login-user"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              disabled={submitting || lockedSec > 0}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入分配的成员账号"
              style={{
                width: '100%',
                height: 44,
                padding: '0 14px',
                borderRadius: 12,
                border: '1px solid rgba(148, 163, 184, 0.28)',
                background: 'rgba(15, 23, 42, 0.95)',
                color: '#f8fafc',
                fontSize: 14,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label
              htmlFor="yj-login-pass"
              style={{
                display: 'block',
                fontSize: 12,
                color: '#cbd5e1',
                marginBottom: 6,
                fontWeight: 600,
              }}
            >
              通行密码
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="yj-login-pass"
                type={showPwd ? 'text' : 'password'}
                autoComplete="current-password"
                disabled={submitting || lockedSec > 0}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入通行密码"
                style={{
                  width: '100%',
                  height: 44,
                  padding: '0 54px 0 14px',
                  borderRadius: 12,
                  border: '1px solid rgba(148, 163, 184, 0.28)',
                  background: 'rgba(15, 23, 42, 0.95)',
                  color: '#f8fafc',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: 8,
                  height: 28,
                  padding: '0 8px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'rgba(148, 163, 184, 0.14)',
                  color: '#cbd5e1',
                  fontSize: 11.5,
                  cursor: 'pointer',
                }}
              >
                {showPwd ? '隐藏' : '显示'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || lockedSec > 0}
            style={{
              marginTop: 4,
              height: 46,
              borderRadius: 13,
              border: 'none',
              background:
                lockedSec > 0
                  ? 'rgba(71, 85, 105, 0.7)'
                  : 'linear-gradient(135deg, #2563eb 0%, #0d9488 100%)',
              color: '#fff',
              fontSize: 14.5,
              fontWeight: 700,
              cursor: submitting || lockedSec > 0 ? 'not-allowed' : 'pointer',
              boxShadow: lockedSec > 0 ? 'none' : '0 10px 24px rgba(37, 99, 235, 0.35)',
              opacity: submitting ? 0.75 : 1,
            }}
          >
            {lockedSec > 0
              ? `安全冷却中 (${formatCountdown(lockedSec)})`
              : submitting
                ? '正在建立 AES-256 加密工作台...'
                : '验证身份并进入精算工作台'}
          </button>
        </form>

        <div
          style={{
            marginTop: 18,
            paddingTop: 14,
            borderTop: '1px solid rgba(148, 163, 184, 0.14)',
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
            fontSize: 11.5,
            color: '#94a3b8',
            lineHeight: 1.5,
          }}
        >
          <div>✓ 首次成功登录自动激活授权计时，登录一次长期保持在线免重复输密</div>
          <div>✓ 支持常用手机 + 电脑双端绑定同步，短暂断网恢复后自动无感重连</div>
        </div>
      </div>
    </div>
  );
}
