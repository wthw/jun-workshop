import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { openDb } from '@techparts/shared';

const RETURN_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

interface OrderRow {
  id: number;
  customer_id: number;
  sku: string;
  quantity: number;
  total: number;
  status: string;
  order_date: string;
  delivered_date: string | null;
}

interface CustomerRow {
  id: number;
  name: string;
  email: string;
}

interface CustomerOrder {
  id: number;
  sku: string;
  productName: string;
  quantity: number;
  total: number;
  status: string;
  orderDate: string;
  deliveredDate: string | null;
}

export function getCustomerOrders(input: { customerId: number }): {
  customer?: CustomerRow;
  orders: CustomerOrder[];
  error?: string;
} {
  const db = openDb();
  const customer = db
    .prepare('SELECT id, name, email FROM customers WHERE id = ?')
    .get(input.customerId) as unknown as CustomerRow | undefined;
  if (!customer) {
    db.close();
    return { error: `No customer found with id ${input.customerId}.`, orders: [] };
  }
  const rows = db
    .prepare(
      `SELECT o.id, o.sku, p.name AS productName, o.quantity, o.total, o.status, o.order_date, o.delivered_date
       FROM orders o JOIN products p ON p.sku = o.sku
       WHERE o.customer_id = ?
       ORDER BY o.order_date DESC`,
    )
    .all(input.customerId) as unknown as (OrderRow & { productName: string })[];
  db.close();

  const orders = rows.map((r) => ({
    id: r.id,
    sku: r.sku,
    productName: r.productName,
    quantity: r.quantity,
    total: r.total,
    status: r.status,
    orderDate: r.order_date,
    deliveredDate: r.delivered_date,
  }));
  return { customer, orders };
}

export function getOrderDetails(input: { orderId: number }) {
  const db = openDb();
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(input.orderId) as unknown as OrderRow | undefined;
  db.close();
  if (!row) return { error: `No order found with id ${input.orderId}.` };
  return {
    id: row.id,
    customerId: row.customer_id,
    sku: row.sku,
    quantity: row.quantity,
    total: row.total,
    status: row.status,
    orderDate: row.order_date,
    deliveredDate: row.delivered_date,
  };
}

export function checkReturnEligibility(input: { orderId: number }): {
  eligible: boolean;
  reason: string;
  daysLeft?: number;
  error?: string;
} {
  const db = openDb();
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(input.orderId) as unknown as OrderRow | undefined;
  db.close();
  if (!row) return { eligible: false, reason: `No order found with id ${input.orderId}.`, error: 'not_found' };

  if (row.status === 'returned') {
    return { eligible: false, reason: 'This order has already been returned.' };
  }
  if (row.status === 'cancelled') {
    return { eligible: false, reason: 'This order was cancelled, so there is nothing to return.' };
  }
  if (row.status !== 'delivered' || !row.delivered_date) {
    return { eligible: false, reason: `Order is not delivered yet (status: ${row.status}); the return window starts on delivery.` };
  }

  // 30-day policy measured from the delivery date.
  const daysSinceDelivery = Math.floor((Date.now() - new Date(row.delivered_date).getTime()) / DAY_MS);
  const daysLeft = RETURN_WINDOW_DAYS - daysSinceDelivery;
  if (daysLeft <= 0) {
    return {
      eligible: false,
      reason: `Delivered ${daysSinceDelivery} days ago — outside the ${RETURN_WINDOW_DAYS}-day return window.`,
    };
  }
  return {
    eligible: true,
    reason: `Delivered ${daysSinceDelivery} days ago — within the ${RETURN_WINDOW_DAYS}-day return window.`,
    daysLeft,
  };
}

export const getCustomerOrdersTool = new FunctionTool({
  name: 'get_customer_orders',
  description:
    "List a customer's orders (most recent first) by customer id, including each order's product name, quantity, total and status.",
  parameters: z.object({
    customerId: z.number().describe('Numeric customer id, e.g. 1042.'),
  }),
  execute: getCustomerOrders,
});

export const getOrderDetailsTool = new FunctionTool({
  name: 'get_order_details',
  description:
    'Get full details for a single order by its numeric order id: customer, SKU, quantity, total, status and dates.',
  parameters: z.object({
    orderId: z.number().describe('Numeric order id, e.g. 88231.'),
  }),
  execute: getOrderDetails,
});

export const checkReturnEligibilityTool = new FunctionTool({
  name: 'check_return_eligibility',
  description:
    'Decide whether an order can still be returned under the 30-day-from-delivery policy. ' +
    'Returns { eligible, reason, daysLeft? } for the given order id.',
  parameters: z.object({
    orderId: z.number().describe('Numeric order id, e.g. 88231.'),
  }),
  execute: checkReturnEligibility,
});
