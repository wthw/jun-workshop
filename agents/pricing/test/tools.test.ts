import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analyticsSnapshot, seed } from '@techparts/shared';
import { getOurPrice, recordCompetitorPrices } from '../src/tools.ts';

beforeAll(() => {
  process.env.TECHPARTS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'techparts-')), 'test.db');
  seed();
});

describe('getOurPrice', () => {
  it('returns our price and name by exact SKU', () => {
    const result = getOurPrice({ skuOrName: 'SONY-WH1000XM5' });
    expect(result).toMatchObject({ sku: 'SONY-WH1000XM5', ourPrice: 349.99 });
  });

  it('falls back to name search when no SKU matches', () => {
    const result = getOurPrice({ skuOrName: 'WH-1000XM5' });
    expect(result).toMatchObject({ sku: 'SONY-WH1000XM5' });
  });

  it('reports unknown products clearly', () => {
    expect(getOurPrice({ skuOrName: 'flux capacitor' })).toHaveProperty('error');
  });
});

describe('recordCompetitorPrices', () => {
  it('persists competitor findings against the product SKU', () => {
    const result = recordCompetitorPrices({
      sku: 'SONY-WH1000XM5',
      findings: [{ competitor: 'Amazon', url: 'https://amazon.com/dp/xm5', price: 328 }],
    });
    expect(result).toMatchObject({ saved: 1, sku: 'SONY-WH1000XM5' });

    const rows = analyticsSnapshot().competitorPrices.filter((r) => r.url === 'https://amazon.com/dp/xm5');
    expect(rows[0]).toMatchObject({ sku: 'SONY-WH1000XM5', competitor: 'Amazon', price: 328 });
  });
});
