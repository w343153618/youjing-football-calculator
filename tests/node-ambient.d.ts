declare module "node:test" {
  export function describe(
    name: string,
    fn: () => void | Promise<void>
  ): Promise<void>;
  export function it(
    name: string,
    fn: (t?: any) => void | Promise<void>
  ): Promise<void>;
  export function test(
    name: string,
    fn: (t?: any) => void | Promise<void>
  ): Promise<void>;
  export function before(fn: () => void | Promise<void>): void;
  export function after(fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
}

declare module "node:assert/strict" {
  const assert: {
    (value: unknown, message?: string | Error): asserts value;
    ok(value: unknown, message?: string | Error): asserts value;
    equal(actual: unknown, expected: unknown, message?: string | Error): void;
    strictEqual(
      actual: unknown,
      expected: unknown,
      message?: string | Error
    ): void;
    notEqual(
      actual: unknown,
      expected: unknown,
      message?: string | Error
    ): void;
    deepEqual(
      actual: unknown,
      expected: unknown,
      message?: string | Error
    ): void;
    deepStrictEqual(
      actual: unknown,
      expected: unknown,
      message?: string | Error
    ): void;
    match(string: string, regexp: RegExp, message?: string | Error): void;
    doesNotMatch(
      string: string,
      regexp: RegExp,
      message?: string | Error
    ): void;
    throws(
      block: () => unknown,
      error?: RegExp | Function | Object,
      message?: string
    ): void;
    rejects(
      asyncFn: (() => Promise<unknown>) | Promise<unknown>,
      error?: RegExp | Function | Object,
      message?: string
    ): Promise<void>;
    fail(message?: string | Error): never;
  };
  export default assert;
}

declare module "node:fs" {
  const fs: any;
  export default fs;
  export const readFileSync: (path: string, encoding?: any) => any;
  export const writeFileSync: (path: string, data: any, options?: any) => void;
  export const existsSync: (path: string) => boolean;
  export const mkdtempSync: (prefix: string) => string;
  export const rmSync: (path: string, options?: any) => void;
  export const readdirSync: (path: string, options?: any) => any[];
  export const statSync: (path: string, options?: any) => any;
  export const chmodSync: (path: string, mode: number) => void;
  export const mkdirSync: (path: string, options?: any) => void;
}

declare module "node:fs/promises" {
  const fsp: {
    mkdir(path: string, options?: any): Promise<string | undefined>;
    writeFile(path: string, data: any, options?: any): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    unlink(path: string): Promise<void>;
  };
  export default fsp;
}

declare module "node:path" {
  const path: {
    join(...paths: string[]): string;
    resolve(...paths: string[]): string;
    dirname(p: string): string;
    basename(p: string, suffix?: string): string;
    relative(from: string, to: string): string;
    sep: string;
  };
  export default path;
  export const join: (...paths: string[]) => string;
  export const resolve: (...paths: string[]) => string;
  export const dirname: (p: string) => string;
  export const basename: (p: string, suffix?: string) => string;
  export const relative: (from: string, to: string) => string;
}

declare module "node:os" {
  const os: { tmpdir(): string };
  export default os;
  export function tmpdir(): string;
}

declare module "node:events" {
  export class EventEmitter {
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
    emit(event: string, ...args: any[]): boolean;
    removeListener(event: string, listener: (...args: any[]) => void): this;
  }
  export default EventEmitter;
}

declare module "node:stream" {
  import { EventEmitter } from "node:events";
  export class Readable extends EventEmitter {
    static from(iterable: any): Readable;
    push(chunk: any): boolean;
  }
  export class PassThrough extends Readable {
    write(chunk: any): boolean;
    end(chunk?: any): this;
  }
}

declare module "node:perf_hooks" {
  export const performance: { now(): number };
}

declare module "node:crypto" {
  const crypto: any;
  export default crypto;
  export const randomBytes: (size: number) => Buffer;
  export const createHmac: (alg: string, key: any) => any;
  export const createHash: (alg: string, key?: any) => any;
  export const createCipheriv: (alg: string, key: any, iv: any) => any;
  export const createDecipheriv: (alg: string, key: any, iv: any) => any;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare module "../server/quantEngine.mjs" {
  export const FALLBACK_MATCHES: any[];
  export const OFFICIAL_CRS_PAIRS: Array<[string, string]>;
  export const POOL_MAX_PASS: Record<string, number>;
  export const bankerRoundCents: (...args: any[]) => number;
  export const bankerRoundParlayUnitPayout: (...args: any[]) => number;
  export const statutorySingleBetCap: (...args: any[]) => number;
  export const devigPoolProbabilities: (...args: any[]) => any;
  export const calibrateMatchCoherentModel: (...args: any[]) => any;
  export const analyzeMatchMicroQuant: (...args: any[]) => any;
  export const parseSportteryRawJson: (...args: any[]) => any[];
  export const parseSportteryResultsJson: (...args: any[]) => Map<string, any>;
  export const computeTruthReport: (...args: any[]) => any;
  export const generateParetoPortfolio: (...args: any[]) => any[];
  export const generateFiveArchetypes: (...args: any[]) => any[];
  export const computeProOrderInsights: (...args: any[]) => any;
  export const optimizeBonusPlan: (...args: any[]) => any;
  export const archetypeToReport: (...args: any[]) => any;
  export const buildXiaoGaoWarnings: (...args: any[]) => any[];
  export const evaluateQuantWorkspace: (...args: any[]) => any;
  export const settleTicketSnapshotWithOfficialResults: (...args: any[]) => any;
}

declare module "../server/sportteryFeed.mjs" {
  export const FALLBACK_MATCHES: any[];
  export const parseSportteryRawJson: (...args: any[]) => any[];
  export const fetchOfficialMatchesServer: (...args: any[]) => Promise<any>;
  export const parseSportteryResultsJson: (...args: any[]) => Map<string, any>;
  export const fetchOfficialMatchResultsServer: (
    ...args: any[]
  ) => Promise<Map<string, any>>;
}

declare module "../server/runtimeApp.mjs" {
  export const createYouJingRuntime: (...args: any[]) => any;
}

declare module "../server/appRoutes.mjs" {
  export const createAppRoutes: (...args: any[]) => any;
  export const reconcileComboAlertsToMatchMap: (...args: any[]) => any;
}

declare module "../server/securityShield.mjs" {
  export const isAiReaderOrScraperRequest: (...args: any[]) => boolean;
  export const createSecurityShield: (...args: any[]) => any;
  export const createSecurityAndQuantGateway: (...args: any[]) => any;
  export const computeEnvelopeHmacHex: (...args: any[]) => string;
  export const decryptEnvelope: (...args: any[]) => any;
  export const deriveSessionSubkeys: (...args: any[]) => any;
  export const encryptEnvelope: (...args: any[]) => any;
  export const generateDecoyHtml: (...args: any[]) => string;
}

declare module "../server/accountManager.mjs" {
  export const createAccountManager: (...args: any[]) => any;
}

declare module "../server/ledgerManager.mjs" {
  export const createLedgerManager: (...args: any[]) => any;
  export const sealAuthoritativePrintSnapshot: (...args: any[]) => any;
}

declare module "../server/manualQaEngine.mjs" {
  export const LOCAL_CURATED_QA: any[];
  export const APP_GROUND_TRUTH_MANUAL_SPEC: string;
  export const buildAppGroundTruthManualSpec: (...args: any[]) => string;
  export const createManualQaEngine: (...args: any[]) => any;
}

declare module "../server/xiaogaoCore.mjs" {
  export const PRIMARY_MODEL: string;
  export const FALLBACK_MODEL: string;
  export const createXiaoGaoService: (...args: any[]) => any;
}

declare module "../scripts/bench-quant.mjs" {
  export const runQuantScientificBenchmarks: (...args: any[]) => any;
  export const computePoolRps: (...args: any[]) => number;
  export const computePoolBrier: (...args: any[]) => number;
  export const computePoolLogLoss: (...args: any[]) => number;
  export const computeEce10Bin: (...args: any[]) => number;
  export const computeQuantileEce: (...args: any[]) => number;
}

interface Buffer extends Uint8Array {
  toString(encoding?: string, start?: number, end?: number): string;
}

declare var Buffer: {
  from(input: any, encoding?: string): Buffer;
  concat(list: Uint8Array[]): Buffer;
  isBuffer(obj: any): obj is Buffer;
  byteLength(str: string, encoding?: string): number;
  alloc(size: number, fill?: any): Buffer;
};

declare var process: {
  cwd(): string;
  env: Record<string, string | undefined>;
  exit(code?: number): never;
};
