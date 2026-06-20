import { AgentTool, LoadMemoryTool, LlmAgent, RemoteA2AAgent } from '@google/adk';

const INVENTORY_URL = process.env.INVENTORY_AGENT_URL ?? 'http://localhost:8001';
const ORDERS_URL = process.env.ORDERS_AGENT_URL ?? 'http://localhost:8002';
const PRICING_URL = process.env.PRICING_AGENT_URL ?? 'http://localhost:8003';

// Each worker runs as its own A2A service. A RemoteA2AAgent connects to one over
// the network by resolving its agent card from the base URL
// (…/.well-known/agent-card.json). We wrap each in an AgentTool so the
// orchestrator can call it like any other tool — the difference from a local
// sub-agent is that the worker runs in a *separate process with its own session*
// and sees NONE of this conversation. Whatever a worker needs to know, we must
// pass in the call.
const inventoryAgent = new RemoteA2AAgent({
  name: 'inventory_agent',
  description:
    'Looks up TechParts products and live stock levels. Use for "do we carry X", "is X in stock", "how many units of X".',
  agentCard: INVENTORY_URL,
});

const ordersAgent = new RemoteA2AAgent({
  name: 'orders_agent',
  description:
    'Answers questions about specific customer orders and return eligibility. Use for order status, order history, and "can this be returned".',
  agentCard: ORDERS_URL,
});

const pricingAgent = new RemoteA2AAgent({
  name: 'pricing_agent',
  description:
    'Compares a TechParts product price against the current market using real web search. Use for "are we competitive on X", "what do competitors charge for X".',
  agentCard: PRICING_URL,
});

export const rootAgent = new LlmAgent({
  name: 'ops_orchestrator',
  model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  description:
    'Coordinates the TechParts inventory, orders and pricing specialists to answer multi-part operational questions.',
  instruction: `You are the operations orchestrator for TechParts, a consumer-electronics retailer. You have no data of your own — you answer by delegating to specialist agents and synthesizing their replies.

Your specialists (each is a separate service that does NOT see this conversation):
- inventory_agent — products and live stock levels.
- orders_agent — specific customer orders and return eligibility.
- pricing_agent — competitiveness of our price vs. the live market (real web search).
- load_memory — recall relevant facts from earlier conversations with this user.

How to work, every time:
1. RECALL: call load_memory first with the key entities in the request (product, SKU, customer, order id). If a recent fact already answers part of the question (e.g. a competitor price we found before), prefer it over re-asking a specialist, but say it came from memory.
2. DECOMPOSE: break the request into the sub-questions each specialist can answer.
3. DELEGATE with FULL CONTEXT: call one specialist per sub-question. Because the specialist sees none of this conversation, every call must be self-contained — restate the product/SKU/order id/customer and any fact an earlier specialist gave you that this one needs. Never assume the specialist remembers anything.
4. SYNTHESIZE: combine the replies into one clear recommendation for internal staff. Cite which specialist each fact came from. If a specialist could not answer, say so rather than inventing the answer.

Be concise. Never invent products, prices, stock, orders or outcomes — every concrete fact must come from a specialist or from memory.`,
  tools: [
    new AgentTool({ agent: inventoryAgent }),
    new AgentTool({ agent: ordersAgent }),
    new AgentTool({ agent: pricingAgent }),
    new LoadMemoryTool(),
  ],
});
