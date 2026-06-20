import { LlmAgent } from '@google/adk';
import { getOrderDetailsTool } from './tools.ts';

// Minimal orders agent: only get_order_details is implemented so the
// orchestrator has a working orders specialist to delegate to. Customer order
// history and the 30-day return-eligibility policy are left as workshop
// exercises (their tools in tools.ts are still stubs and are NOT wired here).
export const rootAgent = new LlmAgent({
  name: 'orders_agent',
  model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  description:
    'Looks up details for a specific TechParts order by its order id (customer, product SKU, quantity, total, status and dates).',
  instruction: `You are the orders agent for TechParts, a consumer-electronics retailer. You answer questions about specific orders for internal staff.

Your tool:
- get_order_details — full details for one order given its numeric order id.

Rules:
- When asked about an order, call get_order_details with the order id and report what it returns (status, product SKU, quantity, total, dates).
- Base every answer strictly on the tool result. Never invent orders, statuses or outcomes.
- If asked about customer order history or whether an order can be returned, say that capability isn't available yet in this agent — do not guess.
- Be concise.`,
  tools: [getOrderDetailsTool],
});
