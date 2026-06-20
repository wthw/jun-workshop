"""
TechParts Orchestrator — Vertex AI Agent Engine (Python)

Python equivalent of agents/orchestrator/src/agent.ts.
Connects to the three TypeScript workers on Cloud Run via A2A protocol.

A2A is language-agnostic: this Python orchestrator and the TypeScript workers
communicate over standard HTTP — neither side knows or cares what language
the other uses. This is the key cross-language multi-agent story.

Bug workaround:
  The TypeScript toA2a() server puts "http://localhost:8080/jsonrpc" in the
  agent card url because it doesn't know its own public Cloud Run URL at startup.
  When RemoteA2aAgent reads that card from Vertex AI Agent Engine, it tries to
  call localhost — which doesn't exist in the cloud.
  Fix: fetch the real card, patch the url to the correct public URL, pass it in.
  Long-term fix for the developer: add PUBLIC_URL env var support to shared/src/server.ts.
"""

import json
import os
import urllib.request

from a2a.types import AgentCard
from google.adk.agents import LlmAgent
from google.adk.agents.remote_a2a_agent import RemoteA2aAgent
from google.adk.tools.agent_tool import AgentTool

INVENTORY_URL = os.environ.get("INVENTORY_AGENT_URL", "")
ORDERS_URL = os.environ.get("ORDERS_AGENT_URL", "")
PRICING_URL = os.environ.get("PRICING_AGENT_URL", "")


def fetch_patched_card(base_url: str) -> AgentCard:
    """
    Fetch the A2A agent card from a Cloud Run worker and patch the url field.
    The TypeScript server always writes localhost into the card; we replace it
    with the real public Cloud Run URL so Vertex AI Agent Engine can reach it.
    """
    raw = json.loads(
        urllib.request.urlopen(f"{base_url}/.well-known/agent-card.json").read()
    )
    raw["url"] = f"{base_url}/jsonrpc"
    if "additionalInterfaces" in raw:
        for iface in raw["additionalInterfaces"]:
            transport = iface.get("transport", "")
            if "JSONRPC" in transport:
                iface["url"] = f"{base_url}/jsonrpc"
            elif "HTTP" in transport:
                iface["url"] = f"{base_url}/rest"
    return AgentCard(**raw)


inventory_agent = RemoteA2aAgent(
    name="inventory_agent",
    description="Knows the TechParts product catalog: products, prices, stock levels and warehouse locations. Ask it to find products or check stock.",
    agent_card=fetch_patched_card(INVENTORY_URL),
)

orders_agent = RemoteA2aAgent(
    name="orders_agent",
    description="Knows TechParts customer orders: order history, order details, and return eligibility under the 30-day policy. Ask it about customers and orders.",
    agent_card=fetch_patched_card(ORDERS_URL),
)

pricing_agent = RemoteA2aAgent(
    name="pricing_agent",
    description="Compares TechParts prices with the market: our price for a product plus live competitor prices from the web.",
    agent_card=fetch_patched_card(PRICING_URL),
)

root_agent = LlmAgent(
    name="ops_orchestrator",
    model="gemini-2.5-flash",
    description="TechParts operations assistant for support staff. Coordinates the inventory, orders and pricing agents to resolve customer cases end-to-end.",
    instruction="""You are the TechParts operations assistant used by internal support staff.

You have no data of your own. Three specialist agents do the work; call them as tools and pass them clear, self-contained natural-language requests:
- orders_agent: customer order history, order details, return eligibility (30-day policy).
- inventory_agent: product catalog, prices, stock, alternatives.
- pricing_agent: whether our price for a product is competitive vs the market.

How to work a case:
1. Break the request into sub-questions and send each to the right specialist. Include all context the specialist needs (ids, SKUs, product names) — they do not see this conversation.
2. Use earlier answers to inform later calls (e.g. first find what the customer bought, then ask inventory for in-stock alternatives to that product).
3. Synthesize one clear recommendation for the support employee: what to tell the customer and what actions to take.

Rules:
- Never invent data; everything must come from the specialists.
- If a specialist reports a blocker (e.g. return window expired), say so and propose the best alternative.
- Answer as a short action plan with the key facts (order, eligibility, suggested replacement with stock/price, price competitiveness).""",
    tools=[
        AgentTool(agent=orders_agent),
        AgentTool(agent=inventory_agent),
        AgentTool(agent=pricing_agent),
    ],
)
