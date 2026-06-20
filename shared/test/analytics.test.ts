import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  analyticsSnapshot,
  recordCompetitorPrices,
  recordLlmCall,
  recordUserPrompt,
} from '../src/index.ts';

beforeAll(() => {
  // Fresh empty DB file — analytics tables are created lazily (no seed needed).
  process.env.TECHPARTS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'techparts-analytics-')), 'test.db');
});

describe('token accounting', () => {
  it('saves a verbatim prompt and attributes LLM calls to its id', () => {
    const upromptId = recordUserPrompt({ agent: 'pricing_agent', prompt: 'Are we competitive on the Sony WH-1000XM5?' });
    expect(upromptId).toMatch(/[0-9a-f-]{36}/);

    recordLlmCall({ upromptId, agent: 'pricing_agent', model: 'gemini-2.5-flash', promptTokens: 120, outputTokens: 30, totalTokens: 150 });
    recordLlmCall({ upromptId, agent: 'market_research', model: 'gemini-2.5-flash', promptTokens: 200, outputTokens: 80, totalTokens: 280 });

    const snap = analyticsSnapshot();
    const prompt = snap.prompts.find((p) => p.id === upromptId);
    expect(prompt?.prompt).toBe('Are we competitive on the Sony WH-1000XM5?');

    const calls = snap.llmCalls.filter((c) => c.uprompt_id === upromptId);
    expect(calls).toHaveLength(2);
    expect(calls.reduce((sum, c) => sum + c.total_tokens, 0)).toBe(430);
  });
});

describe('competitor prices', () => {
  it('saves one row per finding with sku, url and price', () => {
    const saved = recordCompetitorPrices({
      sku: 'SONY-WH1000XM5',
      findings: [
        { competitor: 'Amazon', url: 'https://amazon.com/xm5', price: 328 },
        { competitor: 'Best Buy', url: 'https://bestbuy.com/xm5', price: 349.99 },
        { competitor: 'no url — skipped', url: '' },
      ],
    });
    expect(saved).toBe(2);

    const rows = analyticsSnapshot().competitorPrices.filter((r) => r.sku === 'SONY-WH1000XM5');
    expect(rows.map((r) => r.url).sort()).toEqual(['https://amazon.com/xm5', 'https://bestbuy.com/xm5']);
    expect(rows.find((r) => r.competitor === 'Amazon')?.price).toBe(328);
  });
});
