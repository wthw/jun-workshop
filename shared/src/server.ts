import express from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import {
  type BaseAgent,
  InMemorySessionService,
  Runner,
  getFunctionCalls,
  getFunctionResponses,
  isFinalResponse,
  stringifyContent,
  toA2a,
} from '@google/adk';
import { analyticsSnapshot, recordLlmCall, recordUserPrompt } from './analytics.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONSOLE_HTML = readFileSync(path.join(HERE, 'console.html'), 'utf8');
const DASHBOARD_HTML = readFileSync(path.join(HERE, 'dashboard.html'), 'utf8');

export interface AgentServerOptions {
  agent: BaseAgent;
  port: number;
  title: string;
}

/**
 * Starts an Express server that hosts:
 *  - GET  /          the debug console (prebuilt HTML chat UI)
 *  - POST /api/chat  SSE stream of agent events for the console
 *  - A2A routes mounted by ADK's toA2a(): /.well-known/agent-card.json, /rest, /jsonrpc
 */
export async function startAgentServer({ agent, port, title }: AgentServerOptions): Promise<Server> {
  const app = express();
  app.use(express.json());

  const sessionService = new InMemorySessionService();
  const runner = new Runner({ appName: agent.name, agent, sessionService });

  app.get('/', (_req, res) => {
    res.type('html').send(CONSOLE_HTML.replaceAll('{{TITLE}}', title));
  });

  // Operational dashboard: verbatim prompts, per-call token usage, competitor findings.
  app.get('/dashboard', (_req, res) => {
    res.type('html').send(DASHBOARD_HTML.replaceAll('{{TITLE}}', title));
  });
  app.get('/api/analytics', (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
    res.json(analyticsSnapshot(limit));
  });

  app.post('/api/chat', async (req, res) => {
    const { sessionId, message } = req.body as { sessionId?: string; message?: string };
    if (!sessionId || !message) {
      res.status(400).json({ error: 'sessionId and message are required' });
      return;
    }

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      // (a) token accounting: save the verbatim prompt, then attribute each LLM
      // call's token counts to the id we hand back to the console.
      const upromptId = recordUserPrompt({ agent: agent.name, prompt: message });
      send('uprompt', { upromptId });

      await sessionService.getOrCreateSession({ appName: agent.name, userId: 'console', sessionId });
      for await (const event of runner.runAsync({
        userId: 'console',
        sessionId,
        newMessage: { role: 'user', parts: [{ text: message }] },
      })) {
        const usage = event.usageMetadata;
        if (usage) {
          recordLlmCall({
            upromptId,
            agent: event.author ?? agent.name,
            model: typeof (agent as { model?: unknown }).model === 'string' ? ((agent as { model?: unknown }).model as string) : undefined,
            promptTokens: usage.promptTokenCount,
            outputTokens: usage.candidatesTokenCount,
            totalTokens: usage.totalTokenCount,
          });
          send('usage', {
            agent: event.author,
            promptTokens: usage.promptTokenCount,
            outputTokens: usage.candidatesTokenCount,
            totalTokens: usage.totalTokenCount,
          });
        }
        for (const call of getFunctionCalls(event)) {
          send('tool_call', { agent: event.author, name: call.name, args: call.args });
        }
        for (const result of getFunctionResponses(event)) {
          send('tool_result', { agent: event.author, name: result.name, response: result.response });
        }
        if (event.errorMessage) {
          send('error', { agent: event.author, message: `${event.errorCode ?? 'error'}: ${event.errorMessage}` });
        }
        if (isFinalResponse(event)) {
          const text = stringifyContent(event);
          if (text) send('text', { agent: event.author, text });
        }
      }
      send('done', {});
    } catch (err) {
      send('error', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      res.end();
    }
  });

  await toA2a(agent, { app, port });

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`[${agent.name}] console:  http://localhost:${port}/`);
      console.log(`[${agent.name}] A2A card: http://localhost:${port}/.well-known/agent-card.json`);
      resolve(server);
    });
  });
}
