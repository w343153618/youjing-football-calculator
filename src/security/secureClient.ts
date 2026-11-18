import type {
  MatchItem,
  QuantWorkspaceParams,
  QuantWorkspaceResponse,
  SelectedPick,
} from '../prototype/quantTypes';
import { registerShieldSessionGetter, triggerSecurityMeltdown } from './antiReverseShield';

interface EncryptedEnvelope {
  iv: string;
  d: string;
}

interface SessionState {
  sid: string;
  aesKey: CryptoKey;
  hmacKey: CryptoKey;
}

let activeSession: SessionState | null = null;
let pendingBootstrap: Promise<BootstrapResult> | null = null;

registerShieldSessionGetter(() => activeSession?.sid ?? null);

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
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
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function getBaseUrl(): string {
  const metaEnv = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  return metaEnv?.BASE_URL || '/';
}

async function deriveSubkeyBuffer(masterBytes: Uint8Array, label: string): Promise<ArrayBuffer> {
  const suffix = new TextEncoder().encode(label);
  const combined = new Uint8Array(masterBytes.length + suffix.length);
  combined.set(masterBytes, 0);
  combined.set(suffix, masterBytes.length);
  return crypto.subtle.digest('SHA-256', combined as BufferSource);
}

async function importSessionKeys(sid: string, keyB64: string): Promise<SessionState> {
  const masterBytes = base64ToBytes(keyB64);
  const [aesRaw, hmacRaw] = await Promise.all([
    deriveSubkeyBuffer(masterBytes, ':aes-256-gcm'),
    deriveSubkeyBuffer(masterBytes, ':hmac-sha256'),
  ]);
  const [aesKey, hmacKey] = await Promise.all([
    crypto.subtle.importKey('raw', aesRaw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']),
    crypto.subtle.importKey(
      'raw',
      hmacRaw,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
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
    { name: 'AES-GCM', iv: iv as BufferSource },
    sess.aesKey,
    plainBytes
  );
  const ivB64 = bytesToBase64(iv);
  const dB64 = bytesToBase64(new Uint8Array(cipherBuf));

  const sigMsg = new TextEncoder().encode(
    `${sess.sid}.${endpoint}.${ts}.${nonce}.${ivB64}.${dB64}`
  );
  const sigBuf = await crypto.subtle.sign('HMAC', sess.hmacKey, sigMsg);
  const sigHex = bytesToHex(new Uint8Array(sigBuf));

  return {
    envelope: { iv: ivB64, d: dB64 },
    headers: {
      'Content-Type': 'application/json',
      'X-YJ-Sid': sess.sid,
      'X-YJ-Ts': ts,
      'X-YJ-Nonce': nonce,
      'X-YJ-Sig': sigHex,
    },
  };
}

async function unsealPayload<T>(sess: SessionState, env: EncryptedEnvelope): Promise<T> {
  const iv = base64ToBytes(env.iv);
  const cipherBytes = base64ToBytes(env.d);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    sess.aesKey,
    cipherBytes as BufferSource
  );
  const jsonText = new TextDecoder().decode(plainBuf);
  return JSON.parse(jsonText) as T;
}

export interface BootstrapResult {
  matches: MatchItem[];
  syncNote: string;
  initialPicks: SelectedPick[];
  workspace: QuantWorkspaceResponse;
}

export async function bootstrapSecureWorkspace(forceReset = false): Promise<BootstrapResult> {
  if (forceReset) activeSession = null;
  if (pendingBootstrap) return pendingBootstrap;

  const task = (async () => {
    const res = await fetch(`${getBaseUrl()}api/security/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        v: 1,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
      }),
    });

    const json = await res.json();
    if (res.status === 403 && json?.fused) {
      triggerSecurityMeltdown('bootstrap-fused');
      throw new Error('Fused');
    }
    if (!res.ok || !json?.ok || !json?.sid || !json?.k || !json?.payload) {
      throw new Error(json?.error || '安全通道握手失败');
    }

    const sess = await importSessionKeys(json.sid, json.k);
    activeSession = sess;
    return unsealPayload<BootstrapResult>(sess, json.payload as EncryptedEnvelope);
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
  const res = await fetch(`${getBaseUrl()}api/${pathAfterApi}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(envelope),
  });

  const json = await res.json();
  if (res.status === 403 && json?.fused) {
    triggerSecurityMeltdown('api-fused');
    throw new Error('Fused');
  }
  if (res.status === 401 && !retried) {
    await bootstrapSecureWorkspace(true);
    return postEncryptedApi<T>(pathAfterApi, bodyObj, true);
  }
  if (!res.ok || !json?.ok || !json?.payload) {
    throw new Error(json?.error || '安全接口响应异常');
  }
  return unsealPayload<T>(sess, json.payload as EncryptedEnvelope);
}

export async function requestServerQuantCompute(
  params: QuantWorkspaceParams
): Promise<QuantWorkspaceResponse> {
  return postEncryptedApi<QuantWorkspaceResponse>('quant/compute', params);
}

export async function requestServerMatchesSync(
  workspaceParams: QuantWorkspaceParams
): Promise<{ matches: MatchItem[]; syncNote: string; workspace: QuantWorkspaceResponse }> {
  return postEncryptedApi<{
    matches: MatchItem[];
    syncNote: string;
    workspace: QuantWorkspaceResponse;
  }>('quant/sync', { workspaceParams });
}
