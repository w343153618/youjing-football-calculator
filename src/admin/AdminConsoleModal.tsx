import { useEffect, useState, type FormEvent } from 'react';
import {
  adminCreateUser,
  adminDeleteUser,
  adminFetchOverview,
  adminUpdateUser,
  type AdminAuditLogEntry,
  type PublicAccountUser,
} from '../security/secureClient';
import { playTactileCue } from '../spring/tactileSymphony';

const DURATION_PRESETS: Array<{ label: string; hours: number | null }> = [
  { label: '2小时体验', hours: 2 },
  { label: '24小时日卡', hours: 24 },
  { label: '3天周末卡', hours: 72 },
  { label: '7天周卡', hours: 168 },
  { label: '30天月卡', hours: 720 },
  { label: '永久授权', hours: null },
];

function formatRemainBadge(u: PublicAccountUser): string {
  if (u.role === 'superadmin' || (u.durationHours === null && u.expiresAt === null)) {
    return '永久有效';
  }
  if (u.firstLoginAt === null) {
    return `待首登激活 (${u.durationHours}h)`;
  }
  if (u.remainingMs !== null) {
    if (u.remainingMs <= 0) return '已到期';
    const hrs = u.remainingMs / 3_600_000;
    if (hrs < 1) return `剩 ${Math.max(1, Math.ceil(u.remainingMs / 60_000))} 分钟`;
    if (hrs < 48) return `剩 ${hrs.toFixed(1)} 小时`;
    return `剩 ${(hrs / 24).toFixed(1)} 天`;
  }
  return '正常';
}

export function AdminConsoleModal({
  open,
  currentUser,
  onClose,
}: {
  open: boolean;
  currentUser: PublicAccountUser;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'users' | 'audit'>('users');
  const [loading, setLoading] = useState(false);
  const [accounts, setAccounts] = useState<PublicAccountUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogEntry[]>([]);
  const [fusedStats, setFusedStats] = useState({ ips: 0, hws: 0 });
  const [search, setSearch] = useState('');
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);
  const [issuedCardText, setIssuedCardText] = useState<string | null>(null);

  // Create form state
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newNote, setNewNote] = useState('');
  const [durationPreset, setDurationPreset] = useState<number | null | 'custom'>(24);
  const [customHours, setCustomHours] = useState('48');
  const [maxDevices, setMaxDevices] = useState('2');
  const [aiEnabled, setAiEnabled] = useState(true);
  const [dailyAiLimit, setDailyAiLimit] = useState('20');

  // Self password change
  const [selfNewPass, setSelfNewPass] = useState('');

  const refreshOverview = async () => {
    setLoading(true);
    try {
      const res = await adminFetchOverview();
      setAccounts(res.accounts);
      setAuditLogs(res.auditLogs);
      setFusedStats({ ips: res.fusedIpsCount, hws: res.fusedHwCount });
    } catch (err) {
      setBannerMsg((err as Error)?.message || '加载总控台数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && currentUser.role === 'superadmin') {
      void refreshOverview();
    }
  }, [open, currentUser.role]);

  if (!open || currentUser.role !== 'superadmin') return null;

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setBannerMsg(null);
    const resolvedHours =
      durationPreset === 'custom' ? Math.max(0.5, Number(customHours) || 24) : durationPreset;
    try {
      const res = await adminCreateUser({
        username: newUsername,
        password: newPassword || undefined,
        note: newNote,
        durationHours: resolvedHours,
        maxDevices: Math.max(1, Number(maxDevices) || 2),
        aiEnabled,
        dailyAiLimit: Math.max(0, Number(dailyAiLimit) || 20),
      });
      const durText = resolvedHours === null ? '永久有效' : `首次登录起算 ${resolvedHours} 小时`;
      const card = [
        `【优竞体育内部专用 · 成员通行卡】`,
        `🔗 入口：${window.location.origin}`,
        `👤 账号：${res.user.username}`,
        `🔑 密码：${res.plainPassword}`,
        `⏱️ 有效期：${durText}（登录一次长期保持在线）`,
        `📱 设备限额：最多绑定 ${res.user.maxDevices} 台常用设备`,
      ].join('\n');
      setIssuedCardText(card);
      setNewUsername('');
      setNewPassword('');
      setNewNote('');
      playTactileCue('defuse-celebrate');
      await refreshOverview();
    } catch (err) {
      setBannerMsg((err as Error)?.message || '创建账号失败');
    }
  };

  const runAction = async (userId: string, payload: Record<string, unknown>, tip?: string) => {
    setBannerMsg(null);
    try {
      const res = await adminUpdateUser({ userId, ...payload });
      if (res.newPassword) {
        const card = `【密码已重置】\n账号：${res.user.username}\n新密码：${res.newPassword}\n入口：${window.location.origin}`;
        setIssuedCardText(card);
      } else if (tip) {
        setBannerMsg(tip);
      }
      playTactileCue('tap-on');
      await refreshOverview();
    } catch (err) {
      setBannerMsg((err as Error)?.message || '操作失败');
    }
  };

  const handleDelete = async (u: PublicAccountUser) => {
    if (!window.confirm(`确定永久删除账号「${u.username}」吗？`)) return;
    try {
      await adminDeleteUser(u.id);
      setBannerMsg(`已删除账号 ${u.username}`);
      await refreshOverview();
    } catch (err) {
      setBannerMsg((err as Error)?.message || '删除失败');
    }
  };

  const copyCard = async (txt: string) => {
    try {
      await navigator.clipboard.writeText(txt);
      setBannerMsg('✅ 已复制发卡口令到剪贴板，可直接粘贴发给微信好友');
      playTactileCue('optimize-arpeggio');
    } catch {
      setBannerMsg('请手动长按复制上方发卡文本');
    }
  };

  const filteredAccounts = search.trim()
    ? accounts.filter(
        (a) =>
          a.username.includes(search.trim().toLowerCase()) ||
          a.note.toLowerCase().includes(search.trim().toLowerCase())
      )
    : accounts;

  return (
    <div className="manual-backdrop" onClick={onClose}>
      <div
        className="manual-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="超级管理员总控台"
      >
        <div className="manual-head">
          <div className="manual-head-title">
            <span className="manual-pill">👑 超级管理员总控台</span>
            <div>
              <h2>优竞体育内部专用 · 隐形总控后台</h2>
              <p>
                统一管控全员账号、首次激活计时、双机限绑、每日诊盘配额与违规探底日志（普通成员完全不可见）
              </p>
            </div>
          </div>
          <button type="button" className="round-key" onClick={onClose} title="关闭总控台">
            ✕
          </button>
        </div>

        <div className="manual-toolbar" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div className="manual-tabs">
            <button
              type="button"
              onClick={() => setTab('users')}
              className={`manual-tab ${tab === 'users' ? 'on' : ''}`}
            >
              👥 账号与权限总控 ({accounts.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('audit')}
              className={`manual-tab ${tab === 'audit' ? 'on' : ''}`}
            >
              🛡️ 风控与违规提问日志 ({auditLogs.length})
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <span className="qpill warn">
              48h熔断设备 {fusedStats.hws} 台 / IP {fusedStats.ips} 个
            </span>
            <button type="button" className="key mini" onClick={() => void refreshOverview()}>
              {loading ? '刷新中...' : '↻ 刷新'}
            </button>
          </div>
        </div>

        <div className="manual-body">
          {bannerMsg && (
            <div className="manual-callout good" style={{ marginBottom: 12 }}>
              <b>{bannerMsg}</b>
            </div>
          )}

          {issuedCardText && (
            <div className="manual-callout warn" style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <b>🎫 最新生成通行卡口令（可直接发微信）</b>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="key mini dark"
                    onClick={() => void copyCard(issuedCardText)}
                  >
                    📋 一键复制口令
                  </button>
                  <button
                    type="button"
                    className="key mini"
                    onClick={() => setIssuedCardText(null)}
                  >
                    收起
                  </button>
                </div>
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'rgba(15,23,42,0.08)',
                  fontSize: 12,
                  whiteSpace: 'pre-wrap',
                  userSelect: 'text',
                }}
              >
                {issuedCardText}
              </pre>
            </div>
          )}

          {tab === 'users' ? (
            <div className="manual-section">
              {/* Quick Create Member Form */}
              <form onSubmit={(e) => void handleCreate(e)} className="manual-card" style={{ marginBottom: 14 }}>
                <h4 style={{ marginTop: 0 }}>➕ 快速开通新成员账号（首次登录才开始算倒计时）</h4>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))',
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  <div>
                    <small style={{ display: 'block', marginBottom: 4, opacity: 0.75 }}>
                      登录账号 (3~32位字母数字) *
                    </small>
                    <input
                      type="text"
                      required
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      placeholder="例如 vip888"
                      style={{
                        width: '100%',
                        height: 34,
                        padding: '0 10px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        fontSize: 12.5,
                      }}
                    />
                  </div>
                  <div>
                    <small style={{ display: 'block', marginBottom: 4, opacity: 0.75 }}>
                      初始密码 (留空自动生成随机码)
                    </small>
                    <input
                      type="text"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="留空自动生成 8 位密码"
                      style={{
                        width: '100%',
                        height: 34,
                        padding: '0 10px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        fontSize: 12.5,
                      }}
                    />
                  </div>
                  <div>
                    <small style={{ display: 'block', marginBottom: 4, opacity: 0.75 }}>
                      成员备注 (微信昵称/渠道)
                    </small>
                    <input
                      type="text"
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="例如 老张·包月客户"
                      style={{
                        width: '100%',
                        height: 34,
                        padding: '0 10px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        fontSize: 12.5,
                      }}
                    />
                  </div>
                  <div>
                    <small style={{ display: 'block', marginBottom: 4, opacity: 0.75 }}>
                      设备限绑台数 / 每日AI上限
                    </small>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={maxDevices}
                        onChange={(e) => setMaxDevices(e.target.value)}
                        title="最多绑定设备数"
                        style={{
                          width: '48%',
                          height: 34,
                          padding: '0 8px',
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          fontSize: 12.5,
                        }}
                      />
                      <input
                        type="number"
                        min={0}
                        max={999}
                        value={dailyAiLimit}
                        onChange={(e) => setDailyAiLimit(e.target.value)}
                        title="每日小高诊盘与问答上限"
                        style={{
                          width: '52%',
                          height: 34,
                          padding: '0 8px',
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          fontSize: 12.5,
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>授权可用时长：</span>
                  {DURATION_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setDurationPreset(p.hours)}
                      className={`key mini ${durationPreset === p.hours ? 'on' : ''}`}
                    >
                      {p.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setDurationPreset('custom')}
                    className={`key mini ${durationPreset === 'custom' ? 'on' : ''}`}
                  >
                    自定义小时
                  </button>
                  {durationPreset === 'custom' && (
                    <input
                      type="number"
                      min={1}
                      value={customHours}
                      onChange={(e) => setCustomHours(e.target.value)}
                      style={{ width: 72, height: 28, padding: '0 6px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12 }}
                    />
                  )}
                  <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={aiEnabled}
                      onChange={(e) => setAiEnabled(e.target.checked)}
                    />
                    开通小高排雷 & 智能问答
                  </label>
                </div>

                <button type="submit" className="key dark sm">
                  ✨ 立即创建账号并生成发卡口令
                </button>
              </form>

              {/* Search Bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 }}>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索账号名或微信备注..."
                  style={{
                    flex: 1,
                    height: 34,
                    padding: '0 12px',
                    borderRadius: 9,
                    border: '1px solid #cbd5e1',
                    fontSize: 12.5,
                  }}
                />
              </div>

              {/* Accounts Table / Cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filteredAccounts.map((u) => {
                  const isLocked =
                    u.status === 'locked_violation' || Boolean(u.loginLockedUntil);
                  return (
                    <div key={u.id} className="manual-card" style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                        <div>
                          <b style={{ fontSize: 14 }}>
                            {u.role === 'superadmin' ? '👑 ' : '👤 '}
                            {u.username}
                          </b>
                          {u.note && (
                            <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.78 }}>
                              ({u.note})
                            </span>
                          )}
                          <div style={{ fontSize: 11.5, marginTop: 4, opacity: 0.82 }}>
                            状态：
                            <b
                              style={{
                                color:
                                  u.status === 'active'
                                    ? '#059669'
                                    : u.status === 'locked_violation'
                                      ? '#dc2626'
                                      : '#d97706',
                              }}
                            >
                              {u.status === 'active'
                                ? '正常启用'
                                : u.status === 'locked_violation'
                                  ? `🚨 违规锁死 (${u.lockedReason || ''})`
                                  : u.status === 'expired'
                                    ? '⏰ 已到期'
                                    : '⛔ 已停用'}
                            </b>
                            {u.loginLockedUntil && (
                              <span style={{ color: '#d97706', marginLeft: 6 }}>
                                [输错密码冷却中]
                              </span>
                            )}
                            {' · '}时长：<b>{formatRemainBadge(u)}</b>
                            {' · '}设备：
                            <b>
                              {u.boundDevicesCount}/{u.maxDevices >= 99 ? '∞' : u.maxDevices} 台
                            </b>
                            {' · '}今日智能额度：
                            <b>
                              {u.aiEnabled ? `${u.aiUsedToday}/${u.dailyAiLimit}` : '已关闭'}
                            </b>
                            {u.violationCount > 0 && (
                              <span style={{ color: '#e11d48', marginLeft: 6 }}>
                                · 违规警告 {u.violationCount}/4
                              </span>
                            )}
                          </div>
                        </div>

                        {u.role === 'superadmin' ? (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <input
                              type="password"
                              value={selfNewPass}
                              onChange={(e) => setSelfNewPass(e.target.value)}
                              placeholder="输入新超管密码"
                              style={{
                                width: 130,
                                height: 28,
                                padding: '0 8px',
                                borderRadius: 6,
                                border: '1px solid #cbd5e1',
                                fontSize: 12,
                              }}
                            />
                            <button
                              type="button"
                              className="key mini dark"
                              onClick={() => {
                                if (selfNewPass.trim().length < 6) {
                                  setBannerMsg('超管新密码建议至少 6 位');
                                  return;
                                }
                                void runAction(
                                  u.id,
                                  { action: 'reset-password', newPassword: selfNewPass.trim() },
                                  '✅ 超管密码已更新并自动续接当前登录态'
                                );
                                setSelfNewPass('');
                              }}
                            >
                              修改超管密码
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                            <button
                              type="button"
                              className="key mini"
                              onClick={() =>
                                void runAction(u.id, { action: 'add-hours', hours: 24 }, `已为 ${u.username} +24小时`)
                              }
                            >
                              +24h
                            </button>
                            <button
                              type="button"
                              className="key mini"
                              onClick={() =>
                                void runAction(u.id, { action: 'add-hours', hours: 168 }, `已为 ${u.username} +7天`)
                              }
                            >
                              +7天
                            </button>
                            <button
                              type="button"
                              className="key mini"
                              onClick={() =>
                                void runAction(u.id, { action: 'set-permanent' }, `已将 ${u.username} 设为永久`)
                              }
                            >
                              转永久
                            </button>
                            {u.boundDevicesCount > 0 && (
                              <button
                                type="button"
                                className="key mini"
                                onClick={() =>
                                  void runAction(
                                    u.id,
                                    { action: 'clear-devices' },
                                    `已清空 ${u.username} 已绑设备，可重新换机登录`
                                  )
                                }
                              >
                                解绑设备({u.boundDevicesCount})
                              </button>
                            )}
                            {isLocked && (
                              <button
                                type="button"
                                className="key mini dark"
                                onClick={() =>
                                  void runAction(
                                    u.id,
                                    { action: 'unlock-login' },
                                    `已解除 ${u.username} 的锁定状态`
                                  )
                                }
                              >
                                🔓 解除锁定
                              </button>
                            )}
                            <button
                              type="button"
                              className="key mini"
                              onClick={() =>
                                void runAction(
                                  u.id,
                                  { action: 'update-perms', maxDevices: u.maxDevices + 1 },
                                  `已将 ${u.username} 设备上限增至 ${u.maxDevices + 1} 台`
                                )
                              }
                            >
                              设备+1
                            </button>
                            <button
                              type="button"
                              className="key mini"
                              onClick={() =>
                                void runAction(
                                  u.id,
                                  { action: 'update-perms', dailyAiLimit: u.dailyAiLimit + 20 },
                                  `已将 ${u.username} 每日AI上限提至 ${u.dailyAiLimit + 20} 次`
                                )
                              }
                            >
                              AI+20
                            </button>
                            <button
                              type="button"
                              className="key mini"
                              onClick={() =>
                                void runAction(
                                  u.id,
                                  { action: 'update-perms', aiEnabled: !u.aiEnabled },
                                  `已${!u.aiEnabled ? '开启' : '关闭'} ${u.username} 的智能权限`
                                )
                              }
                            >
                              {u.aiEnabled ? '关AI' : '开AI'}
                            </button>
                            <button
                              type="button"
                              className="key mini"
                              onClick={() => void runAction(u.id, { action: 'reset-password' })}
                            >
                              重置密码
                            </button>
                            <button
                              type="button"
                              className="key mini"
                              onClick={() =>
                                void runAction(
                                  u.id,
                                  { action: 'toggle-status' },
                                  `已切换 ${u.username} 启停状态`
                                )
                              }
                            >
                              {u.status === 'active' ? '停用' : '启用'}
                            </button>
                            <button
                              type="button"
                              className="key mini"
                              style={{ color: '#e11d48' }}
                              onClick={() => void handleDelete(u)}
                            >
                              删除
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="manual-section">
              <div className="manual-callout warn" style={{ marginBottom: 12 }}>
                <b>🛡️ 自动防套底与防爆破审计中心</b>
                <p>
                  凡是在说明书问答中试探“你背后是什么大模型/源码/提示词”、发送超纲问题（超过 4 次自动封号并触发 48 小时整机硬件封禁），或连续输错密码、超额换机登录的行为，均实时记录于下方。
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {auditLogs.length === 0 ? (
                  <div className="manual-card">暂无安全风控记录</div>
                ) : (
                  auditLogs.map((log) => (
                    <div key={log.id} className="manual-card" style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, opacity: 0.75 }}>
                        <span>
                          <b>[{log.type}]</b> 账号：{log.username} {log.note ? `(${log.note})` : ''}
                        </span>
                        <span>
                          IP: {log.ip || '-'} · {new Date(log.ts).toLocaleString('zh-CN')}
                        </span>
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12.5, fontWeight: 600 }}>
                        {log.detail}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
