import { randomUUID } from 'node:crypto';
import { openDb } from './db.ts';

/**
 * Operational analytics for the workshop agents. Two concerns:
 *  (a) token accounting — every user prompt (verbatim) gets an id, and every
 *      LLM call made while answering it records its token counts against that id;
 *  (b) competitor research — structured {competitor, url, price} findings the
 *      pricing agent reports after a real Google Search.
 *
 * These tables are operational logs, not seed data: they are created lazily with
 * CREATE TABLE IF NOT EXISTS so `npm run seed` (which drops products/customers/
 * orders) never wipes them.
 */
export function ensureAnalyticsTables(db = openDb(), closeWhenDone = true): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_prompts (
      id TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      prompt TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS llm_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uprompt_id TEXT NOT NULL REFERENCES user_prompts(id),
      agent TEXT NOT NULL,
      model TEXT,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS competitor_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uprompt_id TEXT REFERENCES user_prompts(id),
      sku TEXT NOT NULL,
      competitor TEXT,
      url TEXT NOT NULL,
      price REAL,
      created_at TEXT NOT NULL
    );
  `);
  if (closeWhenDone) db.close();
}

/** Saves a verbatim user prompt and returns its generated id (the upromptid). */
export function recordUserPrompt(input: { agent: string; prompt: string }): string {
  const id = randomUUID();
  const db = openDb();
  ensureAnalyticsTables(db, false);
  db.prepare('INSERT INTO user_prompts (id, agent, prompt, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    input.agent,
    input.prompt,
    new Date().toISOString(),
  );
  db.close();
  return id;
}

/** Records the token counts of one LLM call against the user prompt that triggered it. */
export function recordLlmCall(input: {
  upromptId: string;
  agent: string;
  model?: string;
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}): void {
  const db = openDb();
  ensureAnalyticsTables(db, false);
  db.prepare(
    `INSERT INTO llm_calls (uprompt_id, agent, model, prompt_tokens, output_tokens, total_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.upromptId,
    input.agent,
    input.model ?? null,
    input.promptTokens ?? 0,
    input.outputTokens ?? 0,
    input.totalTokens ?? 0,
    new Date().toISOString(),
  );
  db.close();
}

export interface CompetitorFinding {
  competitor?: string;
  url: string;
  price?: number;
}

/** Records the competitor price findings for a product. Returns how many rows were saved. */
export function recordCompetitorPrices(input: {
  sku: string;
  findings: CompetitorFinding[];
  upromptId?: string;
}): number {
  const db = openDb();
  ensureAnalyticsTables(db, false);
  const now = new Date().toISOString();
  const ins = db.prepare(
    `INSERT INTO competitor_prices (uprompt_id, sku, competitor, url, price, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let saved = 0;
  for (const f of input.findings) {
    if (!f?.url) continue;
    ins.run(input.upromptId ?? null, input.sku, f.competitor ?? null, f.url, f.price ?? null, now);
    saved++;
  }
  db.close();
  return saved;
}

// ---- read helpers (used by the dashboard) ----------------------------------

export interface AnalyticsSnapshot {
  prompts: Array<{ id: string; agent: string; prompt: string; created_at: string }>;
  llmCalls: Array<{
    id: number;
    uprompt_id: string;
    agent: string;
    model: string | null;
    prompt_tokens: number;
    output_tokens: number;
    total_tokens: number;
    created_at: string;
  }>;
  competitorPrices: Array<{
    id: number;
    uprompt_id: string | null;
    sku: string;
    competitor: string | null;
    url: string;
    price: number | null;
    created_at: string;
  }>;
}

export function analyticsSnapshot(limit = 100): AnalyticsSnapshot {
  const db = openDb();
  ensureAnalyticsTables(db, false);
  const prompts = db
    .prepare('SELECT id, agent, prompt, created_at FROM user_prompts ORDER BY created_at DESC LIMIT ?')
    .all(limit) as AnalyticsSnapshot['prompts'];
  const llmCalls = db
    .prepare(
      `SELECT id, uprompt_id, agent, model, prompt_tokens, output_tokens, total_tokens, created_at
       FROM llm_calls ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as AnalyticsSnapshot['llmCalls'];
  const competitorPrices = db
    .prepare(
      `SELECT id, uprompt_id, sku, competitor, url, price, created_at
       FROM competitor_prices ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as AnalyticsSnapshot['competitorPrices'];
  db.close();
  return { prompts, llmCalls, competitorPrices };
}
