import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { openDb } from '@techparts/shared';

interface ProductRow {
  sku: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  warehouse: string;
}

export function searchProducts(input: { query?: string; category?: string; maxPrice?: number }): {
  products: ProductRow[];
} {
  const db = openDb();
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (input.category) {
    where.push('category = ? COLLATE NOCASE');
    params.push(input.category);
  }
  if (typeof input.maxPrice === 'number') {
    where.push('price <= ?');
    params.push(input.maxPrice);
  }
  // Free text: every word must match somewhere (name/sku/category), so a query
  // like "sony headphones" narrows results instead of widening them.
  if (input.query) {
    for (const token of input.query.split(/\s+/).filter(Boolean)) {
      where.push('(name LIKE ? OR sku LIKE ? OR category LIKE ?)');
      const like = `%${token}%`;
      params.push(like, like, like);
    }
  }

  const sql =
    'SELECT sku, name, category, price, stock, warehouse FROM products' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY price ASC';
  const products = db.prepare(sql).all(...params) as unknown as ProductRow[];
  db.close();
  return { products };
}

export function getStock(input: { sku: string }) {
  const db = openDb();
  const row = db
    .prepare('SELECT sku, name, stock, warehouse FROM products WHERE sku = ? COLLATE NOCASE')
    .get(input.sku) as unknown as Pick<ProductRow, 'sku' | 'name' | 'stock' | 'warehouse'> | undefined;
  db.close();
  if (!row) return { error: `No product found with SKU '${input.sku}'.` };
  return { sku: row.sku, name: row.name, stock: row.stock, warehouse: row.warehouse };
}

export const searchProductsTool = new FunctionTool({
  name: 'search_products',
  description:
    'Search the TechParts catalog for products by free-text name, category and/or maximum price. ' +
    'Returns a list of matching products (sku, name, category, price, stock, warehouse); empty if none match.',
  parameters: z.object({
    query: z.string().describe('Free-text words to match against product name/SKU, e.g. "sony headphones".').optional(),
    category: z
      .string()
      .describe('Exact category, e.g. headphones, earbuds, keyboards, monitors, storage, charging, audio.')
      .optional(),
    maxPrice: z.number().describe('Only return products at or below this price (USD).').optional(),
  }),
  execute: searchProducts,
});

export const getStockTool = new FunctionTool({
  name: 'get_stock',
  description: 'Get the current stock level and warehouse for a single product by its SKU.',
  parameters: z.object({
    sku: z.string().describe('Product SKU, e.g. SONY-WH1000XM5 (case-insensitive).'),
  }),
  execute: getStock,
});
