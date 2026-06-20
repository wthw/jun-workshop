import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { seed } from '@techparts/shared';
import { getCustomerOrders, getOrderDetails, checkReturnEligibility } from '../src/tools.ts';

beforeAll(() => {
  process.env.TECHPARTS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'techparts-')), 'test.db');
  seed();
});

describe('getCustomerOrders', () => {
  it('lists all orders for customer 1042 with product names', () => {
    const result = getCustomerOrders({ customerId: 1042 });
    expect(result.customer?.name).toBe('Alex Morgan');
    expect(result.orders.length).toBe(3);
    expect(result.orders.find((o) => o.id === 88231)?.productName).toContain('WH-1000XM5');
  });

  it('reports unknown customers clearly', () => {
    expect(getCustomerOrders({ customerId: 9999 })).toHaveProperty('error');
  });
});

describe('getOrderDetails', () => {
  it('returns full details for an order', () => {
    const result = getOrderDetails({ orderId: 88231 });
    expect(result).toMatchObject({ id: 88231, customerId: 1042, sku: 'SONY-WH1000XM5', status: 'delivered' });
  });

  it('reports unknown orders clearly', () => {
    expect(getOrderDetails({ orderId: 1 })).toHaveProperty('error');
  });
});

describe('checkReturnEligibility (30-day policy from delivery date)', () => {
  it('order 88231 (delivered 21 days ago) is eligible with ~9 days left', () => {
    const result = checkReturnEligibility({ orderId: 88231 });
    expect(result.eligible).toBe(true);
    expect(result.daysLeft).toBeGreaterThanOrEqual(8);
    expect(result.daysLeft).toBeLessThanOrEqual(9);
  });

  it('order 88133 (delivered 31 days ago) is past the window', () => {
    const result = checkReturnEligibility({ orderId: 88133 });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/window|30/i);
  });

  it('undelivered orders are not eligible', () => {
    const result = checkReturnEligibility({ orderId: 88240 }); // status: shipped
    expect(result.eligible).toBe(false);
  });

  it('already-returned orders are not eligible', () => {
    const result = checkReturnEligibility({ orderId: 88150 });
    expect(result.eligible).toBe(false);
  });
});
