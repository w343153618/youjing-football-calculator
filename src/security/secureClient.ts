import type {
  LedgerOutcomeStatus,
  LedgerSettlementDetail,
  LedgerTicketSnapshot,
  MatchItem,
  QuantWorkspaceParams,
  QuantWorkspaceResponse,
  SelectedPick,
} from "../prototype/quantTypes";
import type { ManualSectionId } from "../manual/UserManualModal";
import {
  getCrossBrowserHardwareFingerprint,
  registerShieldSessionGetter,
  triggerSecurityMeltdown,
} from "./antiReverseShield.ts";

interface EncryptedEnvelope {
  iv: string;
  d: string;
}

interface SessionState {
  sid: string;
  aesKey: CryptoKey;
  hmacKey: CryptoKey;
}

export interface BoundDeviceRecord {
  hwFp: string;
  label: string;
  boundAt: number;
  lastSeenAt: number;
  lastIp: string;
}

export interface PublicAccountUser {
  id: string;
  username: string;
  note: string;
  role: "superadmin" | "member";
  status: "active" | "disabled" | "expired" | "locked_violation";
  lockedReason: string | null;
  createdAt: number;
  durationHours: number | null;
  firstLoginAt: number | null;
  expiresAt: number | null;
  remainingMs: number | null;
  maxDevices: number;
  boundDevicesCount: number;
  boundDevices: BoundDeviceRecord[];
  aiEnabled: boolean;
  dailyAiLimit: number;
  aiUsedToday: number;
  violationCount: number;
  failedLoginCount: number;
  loginLockedUntil: number | null;
}

export interface LedgerEntry {
  id: string;
  kind: "live" | "paper";
  title: string;
  modeLabel: string;
  betCount: number;
  cost: number;
  paperRefCost: number;
  minPayout: number;
  maxPayout: number;
  status: LedgerOutcomeStatus;
  settledReturn: number;
  netProfit: number;
  manualOverride?: boolean;
  autoSettled?: boolean;
  snapshot?: LedgerTicketSnapshot;
  settlementDetail?: LedgerSettlementDetail;
  createdAt: number;
  settledAt: number | null;
}

export interface LedgerStats {
  liveSettledCount: number;
  liveWonCount: number;
  livePartialCount?: number;
  liveWinRatePct: number;
  liveTotalStaked: number;
  liveNetProfit: number;
  liveRoiPct: number;
  paperCount: number;
  paperLostCount?: number;
  paperPartialCount?: number;
  paperWonCount?: number;
  paperSavedAmount: number;
}

export interface UserLedgerSnapshot {
  dailyLimit: number;
  usageDate: string;
  dailyLiveSpent: number;
  dailyLockedLossSpent?: number;
  dailyRemaining: number;
  entries: LedgerEntry[];
  stats: LedgerStats;
}

export type LedgerMutatePayload =
  | { action: "set-daily-limit"; dailyLimit: number }
  | {
      action: "add-entry";
      kind: "live" | "paper";
      title: string;
      modeLabel: string;
      betCount: number;
      cost: number;
      paperRefCost?: number;
      minPayout: number;
      maxPayout: number;
      snapshot?: LedgerTicketSnapshot;
      workspaceParams?: QuantWorkspaceParams;
      forceConfirmed?: boolean;
    }
  | {
      action: "settle-entry";
      entryId: string;
      status: LedgerOutcomeStatus;
      settledReturn?: number;
    }
  | { action: "delete-entry"; entryId: string }
  | { action: "clear-settled-paper" }
  | { action: "restore-entry"; undoToken?: string }
  | { action: "auto-settle"; forceRefresh?: boolean };

export type LedgerMutateResponse =
  | {
      ok: true;
      entry?: LedgerEntry;
      deletedId?: string;
      undoToken?: string;
      lockedStopLossStake?: number;
      clearedCount?: number;
      restoredCount?: number;
      newlySettledCount?: number;
      newlySettledTitles?: string[];
      ledger: UserLedgerSnapshot;
    }
  | {
      ok: false;
      code: "STOP_LOSS_EXCEEDED";
      dailyRemaining: number;
      dailyLimit: number;
      overBy: number;
      ledger: UserLedgerSnapshot;
    };

export interface AuthenticatedWorkspaceBundle {
  authenticated: true;
  user: PublicAccountUser;
  authToken: string;
  matches: MatchItem[];
  syncNote: string;
  initialPicks: SelectedPick[];
  workspace: QuantWorkspaceResponse;
  ledger?: UserLedgerSnapshot;
  newlySettledCount?: number;
}

export type BootstrapResult =
  | {
      authenticated: false;
      authCode?: string;
      authError?: string | null;
    }
  | AuthenticatedWorkspaceBundle;

export interface ManualAskResponse {
  ok: boolean;
  source: "local-kb" | "grounded-ai" | "iron-cage-guard" | "local-fallback";
  matchedTitle?: string;
  jumpSection?: ManualSectionId;
  warningStrike?: number;
  maxStrikes?: number;
  remainingQuota?: number;
  answer: string;
}

export interface AdminAuditLogEntry {
  id: string;
  ts: number;
  type: string;
  username: string;
  note?: string;
  ip?: string;
  detail: string;
}

export interface AdminOverviewResponse {
  accounts: PublicAccountUser[];
  auditLogs: AdminAuditLogEntry[];
  fusedIpsCount: number;
  fusedHwCount: number;
}

export class AuthLoginError extends Error {
  lockedRemainingSec: number;
  statusCode: number;
  constructor(message: string, statusCode = 401, lockedRemainingSec = 0) {
    super(message);
    this.statusCode = statusCode;
    this.lockedRemainingSec = lockedRemainingSec;
  }
}

const WECHAT_AUTH_STORAGE_KEY = "yj_wechat_auth_v1";
const LEDGER_CACHE_PREFIX = "yj_ledger_cache_v1_";

interface PersistedWechatAuth {
  authToken: string;
  cachedUser: PublicAccountUser;
  savedAt: number;
}

function resolveLocalStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    const desc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    if (desc && "value" in desc && desc.value) {
      return desc.value as Storage;
    }
  } catch {
    // ignore storage restriction
  }
  return null;
}

let activeSession: SessionState | null = null;
let pendingBootstrap: Promise<BootstrapResult> | null = null;
let authRevokedHandler: ((reason: string) => void) | null = null;

registerShieldSessionGetter(() => activeSession?.sid ?? null);

export function registerAuthRevokedHandler(
  fn: ((reason: string) => void) | null
): void {
  authRevokedHandler = fn;
}

export function readPersistedWechatAuth(): PersistedWechatAuth | null {
  try {
    const store = resolveLocalStorage();
    const raw = store?.getItem(WECHAT_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedWechatAuth;
    if (
      parsed &&
      typeof parsed.authToken === "string" &&
      parsed.cachedUser?.id
    ) {
      return parsed;
    }
  } catch {
    // ignore storage restriction
  }
  return null;
}

export function writePersistedWechatAuth(
  authToken: string,
  user: PublicAccountUser
): void {
  try {
    const store = resolveLocalStorage();
    if (!store) return;
    const payload: PersistedWechatAuth = {
      authToken,
      cachedUser: user,
      savedAt: Date.now(),
    };
    store.setItem(WECHAT_AUTH_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function clearPersistedWechatAuth(): void {
  try {
    resolveLocalStorage()?.removeItem(WECHAT_AUTH_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function createEmptyLedgerSnapshot(
  dailyLimit = 300
): UserLedgerSnapshot {
  const bjDate = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  return {
    dailyLimit,
    usageDate: bjDate,
    dailyLiveSpent: 0,
    dailyRemaining: dailyLimit,
    entries: [],
    stats: {
      liveSettledCount: 0,
      liveWonCount: 0,
      liveWinRatePct: 0,
      liveTotalStaked: 0,
      liveNetProfit: 0,
      liveRoiPct: 0,
      paperCount: 0,
      paperLostCount: 0,
      paperWonCount: 0,
      paperSavedAmount: 0,
    },
  };
}

export function readCachedUserLedger(
  userId: string
): UserLedgerSnapshot | null {
  try {
    const cleanId = String(userId || "").trim();
    if (!cleanId) return null;
    const raw = resolveLocalStorage()?.getItem(
      `${LEDGER_CACHE_PREFIX}${cleanId}`
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserLedgerSnapshot;
    if (
      parsed &&
      typeof parsed.dailyLimit === "number" &&
      Array.isArray(parsed.entries) &&
      parsed.stats &&
      typeof parsed.stats === "object"
    ) {
      return parsed;
    }
  } catch {
    // ignore storage restriction
  }
  return null;
}

export function writeCachedUserLedger(
  userId: string,
  snapshot: UserLedgerSnapshot
): void {
  try {
    const cleanId = String(userId || "").trim();
    const store = resolveLocalStorage();
    if (!cleanId || !store || !snapshot) return;
    store.setItem(`${LEDGER_CACHE_PREFIX}${cleanId}`, JSON.stringify(snapshot));
  } catch {
    // ignore
  }
}

function detectReadableDeviceLabel(): string {
  if (typeof navigator === "undefined") return "Web 终端";
  const ua = navigator.userAgent || "";
  if (/iPhone/i.test(ua)) return "iPhone 手机端";
  if (/iPad/i.test(ua)) return "iPad 平板端";
  if (/Android/i.test(ua)) return "Android 手机端";
  if (/Macintosh/i.test(ua)) return "Mac 电脑端";
  if (/Windows/i.test(ua)) return "Windows 电脑端";
  return "浏览器终端";
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function getBaseUrl(): string {
  const metaEnv = (import.meta as unknown as { env?: { BASE_URL?: string } })
    .env;
  return metaEnv?.BASE_URL || "/";
}

async function deriveSubkeyBuffer(
  masterBytes: Uint8Array,
  label: string
): Promise<ArrayBuffer> {
  const suffix = new TextEncoder().encode(label);
  const combined = new Uint8Array(masterBytes.length + suffix.length);
  combined.set(masterBytes, 0);
  combined.set(suffix, masterBytes.length);
  return crypto.subtle.digest("SHA-256", combined as BufferSource);
}

async function importSessionKeys(
  sid: string,
  keyB64: string
): Promise<SessionState> {
  const masterBytes = base64ToBytes(keyB64);
  const [aesRaw, hmacRaw] = await Promise.all([
    deriveSubkeyBuffer(masterBytes, ":aes-256-gcm"),
    deriveSubkeyBuffer(masterBytes, ":hmac-sha256"),
  ]);
  const [aesKey, hmacKey] = await Promise.all([
    crypto.subtle.importKey("raw", aesRaw, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]),
    crypto.subtle.importKey(
      "raw",
      hmacRaw,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    ),
  ]);
  return { sid, aesKey, hmacKey };
}

async function sealPayload(
  sess: SessionState,
  endpoint: string,
  data: unknown
): Promise<{
  envelope: EncryptedEnvelope;
  headers: Record<string, string>;
}> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = bytesToHex(nonceBytes);
  const ts = String(Date.now());

  const plainBytes = new TextEncoder().encode(JSON.stringify(data));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    sess.aesKey,
    plainBytes
  );
  const ivB64 = bytesToBase64(iv);
  const dB64 = bytesToBase64(new Uint8Array(cipherBuf));

  const sigMsg = new TextEncoder().encode(
    `${sess.sid}.${endpoint}.${ts}.${nonce}.${ivB64}.${dB64}`
  );
  const sigBuf = await crypto.subtle.sign("HMAC", sess.hmacKey, sigMsg);
  const sigHex = bytesToHex(new Uint8Array(sigBuf));

  const persisted = readPersistedWechatAuth();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-YJ-Sid": sess.sid,
    "X-YJ-Ts": ts,
    "X-YJ-Nonce": nonce,
    "X-YJ-Sig": sigHex,
  };
  if (persisted?.authToken) {
    headers["X-YJ-Auth"] = persisted.authToken;
  }

  return {
    envelope: { iv: ivB64, d: dB64 },
    headers,
  };
}

async function unsealPayload<T>(
  sess: SessionState,
  env: EncryptedEnvelope
): Promise<T> {
  const iv = base64ToBytes(env.iv);
  const cipherBytes = base64ToBytes(env.d);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    sess.aesKey,
    cipherBytes as BufferSource
  );
  const jsonText = new TextDecoder().decode(plainBuf);
  return JSON.parse(jsonText) as T;
}

export async function bootstrapSecureWorkspace(
  forceReset = false
): Promise<BootstrapResult> {
  if (forceReset) activeSession = null;
  if (pendingBootstrap) return pendingBootstrap;

  const task = (async () => {
    const hwFp = await getCrossBrowserHardwareFingerprint();
    const persisted = readPersistedWechatAuth();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-YJ-Hw": hwFp,
    };
    if (persisted?.authToken) {
      headers["X-YJ-Auth"] = persisted.authToken;
    }

    const res = await fetch(`${getBaseUrl()}api/security/bootstrap`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        v: 1,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
        hwFp,
      }),
    });

    const json = await res.json();
    if (res.status === 403 && json?.fused) {
      triggerSecurityMeltdown("bootstrap-fused", json.unlockAt);
      throw new Error("Fused");
    }
    if (!res.ok || !json?.ok || !json?.sid || !json?.k || !json?.payload) {
      // Transient 5xx/429 does NOT clear persisted WeChat login!
      throw new Error(json?.error || "安全通道握手失败");
    }

    const sess = await importSessionKeys(json.sid, json.k);
    activeSession = sess;
    const unsealed = await unsealPayload<BootstrapResult>(
      sess,
      json.payload as EncryptedEnvelope
    );

    if (unsealed.authenticated) {
      writePersistedWechatAuth(unsealed.authToken, unsealed.user);
      if (unsealed.ledger) {
        writeCachedUserLedger(unsealed.user.id, unsealed.ledger);
      }
    } else if (persisted?.authToken && unsealed.authCode) {
      // Server explicitly confirmed the old token is expired/disabled/revoked/locked
      clearPersistedWechatAuth();
    }
    return unsealed;
  })();

  pendingBootstrap = task;
  try {
    return await task;
  } finally {
    pendingBootstrap = null;
  }
}

export async function postEncryptedApi<T>(
  pathAfterApi: string,
  bodyObj: unknown,
  retried = false
): Promise<T> {
  if (!activeSession) {
    await bootstrapSecureWorkspace(false);
  }
  const sess = activeSession!;
  const { envelope, headers } = await sealPayload(sess, pathAfterApi, bodyObj);
  const hwFp = await getCrossBrowserHardwareFingerprint();
  headers["X-YJ-Hw"] = hwFp;

  const res = await fetch(`${getBaseUrl()}api/${pathAfterApi}`, {
    method: "POST",
    headers,
    body: JSON.stringify(envelope),
  });

  const json = await res.json();

  // >4 QA violations auto-locked account & fused machine
  if (res.status === 403 && json?.accountLocked) {
    clearPersistedWechatAuth();
    if (json?.fused) {
      triggerSecurityMeltdown("qa-violation-lock", json.unlockAt);
    }
    authRevokedHandler?.(json?.error || "账号因违规操作已被系统自动锁死");
    throw new Error(json?.error || "账号已被系统自动锁死");
  }

  if (res.status === 403 && json?.fused) {
    triggerSecurityMeltdown("api-fused", json.unlockAt);
    throw new Error("Fused");
  }

  // Ephemeral AES session expired -> silently re-bootstrap once with stored WeChat token!
  if (res.status === 401 && json?.sessionExpired && !retried) {
    await bootstrapSecureWorkspace(true);
    return postEncryptedApi<T>(pathAfterApi, bodyObj, true);
  }

  // Explicit account revocation / expiration / admin disable (not a network blip!)
  if (json?.authRequired && pathAfterApi !== "auth/login") {
    clearPersistedWechatAuth();
    authRevokedHandler?.(json?.error || "登录授权已到期或变更，请重新登录");
    throw new Error(json?.error || "登录已失效");
  }

  if (pathAfterApi === "auth/login" && (!res.ok || !json?.ok)) {
    throw new AuthLoginError(
      json?.error || "账号或密码不正确",
      res.status,
      Number(json?.lockedRemainingSec || 0)
    );
  }

  if (!res.ok || !json?.ok || !json?.payload) {
    throw new Error(json?.error || "安全接口响应异常");
  }
  return unsealPayload<T>(sess, json.payload as EncryptedEnvelope);
}

export async function loginWithPassword(
  username: string,
  password: string
): Promise<AuthenticatedWorkspaceBundle> {
  const hwFp = await getCrossBrowserHardwareFingerprint();
  const bundle = await postEncryptedApi<AuthenticatedWorkspaceBundle>(
    "auth/login",
    {
      username: username.trim(),
      password,
      hwFp,
      deviceLabel: detectReadableDeviceLabel(),
    }
  );
  writePersistedWechatAuth(bundle.authToken, bundle.user);
  if (bundle.ledger) {
    writeCachedUserLedger(bundle.user.id, bundle.ledger);
  }
  return bundle;
}

export async function mutateServerLedger(
  payload: LedgerMutatePayload
): Promise<LedgerMutateResponse> {
  const res = await postEncryptedApi<LedgerMutateResponse>(
    "ledger/mutate",
    payload
  );
  const uid = readPersistedWechatAuth()?.cachedUser?.id;
  if (uid && res?.ledger) {
    writeCachedUserLedger(uid, res.ledger);
  }
  return res;
}

export async function logoutSession(): Promise<void> {
  try {
    await postEncryptedApi<{ loggedOut: boolean }>("auth/logout", {});
  } catch {
    // ignore network error on logout
  } finally {
    clearPersistedWechatAuth();
  }
}

export async function askManualAssistant(
  question: string
): Promise<ManualAskResponse> {
  return postEncryptedApi<ManualAskResponse>("manual/ask", { question });
}

export async function adminFetchOverview(): Promise<AdminOverviewResponse> {
  return postEncryptedApi<AdminOverviewResponse>("admin/overview", {});
}

export async function adminCreateUser(params: {
  username: string;
  password?: string;
  note?: string;
  durationHours: number | null;
  maxDevices: number;
  aiEnabled: boolean;
  dailyAiLimit: number;
}): Promise<{ user: PublicAccountUser; plainPassword: string }> {
  return postEncryptedApi<{ user: PublicAccountUser; plainPassword: string }>(
    "admin/create-user",
    params
  );
}

export async function adminUpdateUser(
  payload: Record<string, unknown>
): Promise<{
  user: PublicAccountUser;
  newPassword?: string;
  selfAuthToken?: string;
}> {
  const res = await postEncryptedApi<{
    user: PublicAccountUser;
    newPassword?: string;
    selfAuthToken?: string;
  }>("admin/update-user", payload);
  if (res.selfAuthToken) {
    writePersistedWechatAuth(res.selfAuthToken, res.user);
  }
  return res;
}

export async function adminDeleteUser(
  userId: string
): Promise<{ ok: boolean }> {
  return postEncryptedApi<{ ok: boolean }>("admin/delete-user", { userId });
}

export async function requestServerQuantCompute(
  params: QuantWorkspaceParams
): Promise<QuantWorkspaceResponse> {
  return postEncryptedApi<QuantWorkspaceResponse>("quant/compute", params);
}

export async function requestServerMatchesSync(
  workspaceParams: QuantWorkspaceParams
): Promise<{
  matches: MatchItem[];
  syncNote: string;
  workspace: QuantWorkspaceResponse;
  ledger?: UserLedgerSnapshot;
  newlySettledCount?: number;
}> {
  return postEncryptedApi<{
    matches: MatchItem[];
    syncNote: string;
    workspace: QuantWorkspaceResponse;
    ledger?: UserLedgerSnapshot;
    newlySettledCount?: number;
  }>("quant/sync", { workspaceParams });
}

export interface XiaoGaoAlert {
  level: "high" | "medium";
  tag: string;
  summary: string;
  priceInStatus: string;
  source: string;
  suggestedDelta?: string;
}

export interface XiaoGaoComboPerMatch {
  matchId: string;
  matchTitle: string;
  tag: string;
  note: string;
  priceInStatus: string;
  poolImpact?: string;
}

export interface XiaoGaoComboReport {
  level: "high" | "medium" | "low";
  planContextBadge?: string;
  comboTag: string;
  summary: string;
  actuarySynergy?: string;
  residualRisks?: string | string[];
  weakestLeg: string;
  structureAdvice: string;
  priceInVerdict: string;
  perMatch: XiaoGaoComboPerMatch[];
  matchCount: number;
  source: string;
}

export async function requestXiaoGaoDiagnosis(
  matchId: string,
  userNote?: string
): Promise<{ alert: XiaoGaoAlert; aiRemaining?: number }> {
  return postEncryptedApi<{ alert: XiaoGaoAlert; aiRemaining?: number }>(
    "xiaogao/analyze",
    {
      matchId,
      userNote,
    }
  );
}

export async function requestXiaoGaoComboDiagnosis(
  params: Partial<QuantWorkspaceParams> & {
    sourceMode: "picked" | "custom";
    matchIds: string[];
    picks: SelectedPick[];
    userNote?: string;
  }
): Promise<{ comboReport: XiaoGaoComboReport; aiRemaining?: number }> {
  return postEncryptedApi<{
    comboReport: XiaoGaoComboReport;
    aiRemaining?: number;
  }>("xiaogao/analyze-combo", params);
}
