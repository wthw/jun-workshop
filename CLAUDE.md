# CLAUDE.md

TechParts — a Google ADK (TypeScript) multi-agent workshop. Three worker agents
(inventory, orders, pricing) each run as their own service; an orchestrator
connects to them over the **A2A protocol** to resolve support cases end-to-end.

## Commands

```bash
npm install
cp .env.example .env        # paste your GEMINI_API_KEY
npm run seed                # (re)creates shared/data/techparts.db

npm run dev:inventory       # :8001   one terminal per agent
npm run dev:orders          # :8002
npm run dev:pricing         # :8003
npm run dev:orchestrator    # :8004   (needs the other three running)

npm test                    # vitest — deterministic, NO model calls, no API key needed
npm run typecheck           # tsc --noEmit
```

Run a single test file: `npx vitest run agents/orders/test/tools.test.ts`.

Each running agent serves a **debug console** at `/`, an analytics **dashboard**
at `/dashboard`, and A2A routes (`/.well-known/agent-card.json`, `/rest`, `/jsonrpc`).

## Architecture

npm workspaces: `shared` + `agents/*`. Every agent is three files with the same shape:

- `src/tools.ts` — `FunctionTool`s with **zod** `parameters`; tool logic reads SQLite via `openDb()` from `@techparts/shared`. Tool names are `snake_case`; TS fields are `camelCase`.
- `src/agent.ts` — exports `rootAgent` (an `LlmAgent`) wiring instruction + tools.
- `src/server.ts` — one call to `startAgentServer({ agent, port, title })`.

`shared/src/server.ts` is the harness all agents share. One change there hits every
agent: it builds the `Runner` (with `InMemorySessionService` + `InMemoryMemoryService`),
hosts the console + `/api/chat` SSE stream + `/dashboard` + `/api/analytics`, and mounts
A2A via `toA2a()`. After each finished `/api/chat` case it ingests the session into
memory (`addSessionToMemory`) so a later session can recall it via `load_memory`.

The **orchestrator** (`agents/orchestrator`) has no data of its own: three
`RemoteA2AAgent`s wrapped as `AgentTool`s + a `LoadMemoryTool`. It finds the workers
via `INVENTORY_AGENT_URL` / `ORDERS_AGENT_URL` / `PRICING_AGENT_URL` (default to the
local ports above).

## Conventions & gotchas

- **ESM + `.ts` import specifiers** (`import { openDb } from './db.ts'`). Strict TS, `noEmit`, run via `tsx`. Node >= 24 (uses built-in `node:sqlite`).
- **Model** is `gemini-2.5-flash`, overridable with `GEMINI_MODEL`. Free-tier keys rate-limit hard; the orchestrator makes 10+ calls per case.
- **The DB is reseeded at every startup** (and is git-ignored). The 30-day return-window demo depends on dates relative to *now* — never bake a static DB into the image.
- **Workers are stateless toward the orchestrator**: a worker sees only the single request the orchestrator sends, not the conversation. The orchestrator instruction must restate all context (ids, SKUs, product names) in each delegated call.
- **`GOOGLE_SEARCH` can't share a `tools` array with function tools** — the pricing agent puts it on its own sub-`LlmAgent` exposed via `AgentTool` (see `agents/pricing/src/agent.ts`).
- SQLite text matching uses `COLLATE NOCASE`; tool functions return plain objects, returning `{ error }` for not-found rather than throwing.
- Tests pin tool *output shapes* against the seeded data and never invoke the model — keep them that way so they stay deterministic.

## Deployment

Workers → Cloud Run (one shared image; `AGENT=inventory|orders|pricing` selects which
starts). Orchestrator → Vertex AI Agent Engine as a separate **Python** agent
(`deploy/agent_engine/agent.py`). Full guide in `DEPLOYMENT.md`; scripts in `deploy/`.
The `cloudorbit` project was the shared workshop project and is no longer a deploy
target — use your own GCP project.

## Branches

- `main` — workshop starting point (scaffolding + TODOs).
- `mz` — working branch (all four agents implemented; orders complete; custom analytics/dashboard added in the shared harness).

(The README mentions a `solution` reference branch, but it doesn't exist in this repo.)
