import { AgentTool, GOOGLE_SEARCH, LlmAgent } from '@google/adk';
import { getOurPriceTool, recordCompetitorPricesTool } from './tools.ts';

// Built-in tools like GOOGLE_SEARCH can't share a `tools` array with function
// tools, so the ADK pattern is to give GOOGLE_SEARCH its own small LlmAgent and
// expose that agent to the root agent as a tool (AgentTool). This sub-agent does
// the real-time web research that grounds our competitiveness answer.
const marketResearchAgent = new LlmAgent({
  name: 'market_research',
  model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  description:
    'Searches the public web for current competitor prices and availability of consumer-electronics products.',
  instruction: `You research current market prices for consumer-electronics products using Google Search.
Given a product, search for its current price at major retailers (Amazon, Best Buy, the manufacturer's store).
For each retailer you find, report the retailer name, the listing URL, and the price.
Report only what the search results actually support; if results are unclear, say so. Do not invent prices or URLs.`,
  tools: [GOOGLE_SEARCH],
});

export const rootAgent = new LlmAgent({
  name: 'pricing_agent',
  model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
  description:
    'Compares TechParts prices against the current market: looks up our price and researches competitor prices on the web.',
  instruction: `You are the pricing agent for TechParts, a consumer-electronics retailer. You help internal staff with pricing decisions.

Your tools:
- get_our_price — TechParts' own price for a product.
- market_research — current competitor prices on the public web (real Google Search).
- record_competitor_prices — save the competitor prices you found.

When asked whether a price is competitive, ALWAYS, in order:
1. Call get_our_price to get our price AND the canonical SKU.
2. Call market_research to find current competitor prices on the web.
3. Call record_competitor_prices once with that canonical SKU and one entry per competitor (competitor name, url, price) that market_research actually returned. Only include prices grounded in the search results — never invent a URL or price.
4. Compare and conclude clearly: are we cheaper, in line, or more expensive — and by roughly how much.

Be concise and cite the competitor prices you found.`,
  tools: [getOurPriceTool, new AgentTool({ agent: marketResearchAgent }), recordCompetitorPricesTool],
});
