import type { IncomingMessage, ServerResponse } from 'node:http';
import { createXiaoGaoService } from './xiaogaoCore.mjs';

export interface XiaoGaoAnalyzeRequest {
  matchNumStr: string;
  league: string;
  kickoff: string;
  home: string;
  away: string;
  hadOdds: string;
  hhadOdds: string;
  vigSummary: string;
  xgSummary: string;
  oneGoalSharePct: number;
  droppingTrends: string;
  userNote?: string;
}

export interface XiaoGaoAnalyzeResult {
  level: 'high' | 'medium';
  tag: string;
  summary: string;
  priceInStatus: string;
  suggestedDelta: string;
  source: string;
}

function readJsonBody(req: IncomingMessage, maxBytes = 120_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = '';
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      raw += String(chunk);
      if (raw.length > maxBytes) {
        settled = true;
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

export function createXiaoGaoMiddleware(apiKey: string) {
  const service = createXiaoGaoService();

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url || '';
    if (url.startsWith('/api/xiaogao/status') && req.method === 'GET') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(service.getPublicStatus(Boolean(apiKey))));
      return;
    }

    if (url.startsWith('/api/xiaogao/analyze') && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (!apiKey) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: '服务端尚未配置诊盘凭证' }));
        return;
      }
      try {
        const body = (await readJsonBody(req)) as unknown as XiaoGaoAnalyzeRequest;
        const alert = await service.analyzeMatch(apiKey, body);
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, alert }));
      } catch (err) {
        console.error('[xiaogao-dev] analyze error:', err);
        res.statusCode = 502;
        res.end(JSON.stringify({ ok: false, error: '扫地僧小高诊盘通道繁忙，请稍后再试' }));
      }
      return;
    }

    next();
  };
}
