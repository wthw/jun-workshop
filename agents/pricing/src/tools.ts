import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { openDb, recordCompetitorPrices as saveCompetitorPrices } from '@techparts/shared';

interface PriceRow {
  sku: string;
  name: string;
  price: number;
}

export function getOurPrice(input: { skuOrName: string }) {
  const db = openDb();
  let row = db
    .prepare('SELECT sku, name, price FROM products WHERE sku = ? COLLATE NOCASE')
    .get(input.skuOrName) as unknown as PriceRow | undefined;
  if (!row) {
    row = db
      .prepare('SELECT sku, name, price FROM products WHERE name LIKE ? ORDER BY price DESC LIMIT 1')
      .get(`%${input.skuOrName}%`) as unknown as PriceRow | undefined;
  }
  db.close();
  if (!row) return { error: `No product found matching '${input.skuOrName}'.` };
  return { sku: row.sku, name: row.name, ourPrice: row.price };
}

export const getOurPriceTool = new FunctionTool({
  name: 'get_our_price',
  description: "Look up TechParts' own selling price for a product, by SKU or (partial) product name.",
  parameters: z.object({
    skuOrName: z
      .string()
      .describe('Product SKU (e.g. SONY-WH1000XM5) or part of the product name (e.g. "WH-1000XM5").'),
  }),
  execute: getOurPrice,
});

export function recordCompetitorPrices(input: {
  sku: string;
  findings: { competitor?: string; url: string; price?: number }[];
}) {
  const saved = saveCompetitorPrices({ sku: input.sku, findings: input.findings });
  return { saved, sku: input.sku };
}

export const recordCompetitorPricesTool = new FunctionTool({
  name: 'record_competitor_prices',
  description:
    'Persist the competitor prices found via web search for a product, so they can be reviewed later. ' +
    'Call this once after researching the market, passing the canonical SKU from get_our_price and ' +
    'one entry per competitor you actually found a price for in the search results.',
  parameters: z.object({
    sku: z.string().describe('Canonical product SKU from get_our_price, e.g. SONY-WH1000XM5.'),
    findings: z
      .array(
        z.object({
          competitor: z.string().describe('Retailer name, e.g. "Amazon", "Best Buy".').optional(),
          url: z.string().describe('URL of the competitor listing the search returned.'),
          price: z.number().describe('Their price in USD, as a number (no currency symbol).').optional(),
        }),
      )
      .describe('One entry per competitor price found in the real search results.'),
  }),
  execute: recordCompetitorPrices,
});
