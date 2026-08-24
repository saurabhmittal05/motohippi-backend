import crypto from 'crypto';

function getBaseUrl(): string {
  const env = (process.env.CASHFREE_ENV || 'TEST').toUpperCase();
  return env === 'PRODUCTION' || env === 'PROD'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';
}

function getHeaders(): Record<string, string> {
  const appId = process.env.CASHFREE_APP_ID || '';
  const secretKey = process.env.CASHFREE_SECRET_KEY || '';

  return {
    'Content-Type': 'application/json',
    'x-client-id': appId,
    'x-client-secret': secretKey,
    'x-api-version': '2023-08-01',
  };
}

export interface CreateOrderInput {
  orderId: string;
  orderAmount: number;
  orderCurrency?: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  returnUrl: string;
  notifyUrl?: string;
}

export interface CashfreeOrderResponse {
  cf_order_id: string;
  order_id: string;
  entity: string;
  order_currency: string;
  order_amount: number;
  order_status: 'ACTIVE' | 'PAID' | 'EXPIRED' | 'TERMINATED';
  payment_session_id: string;
  order_expiry_time?: string;
}

export async function createCashfreeOrder(input: CreateOrderInput): Promise<CashfreeOrderResponse> {
  const url = `${getBaseUrl()}/orders`;
  const payload = {
    order_id: input.orderId,
    order_amount: Number(input.orderAmount.toFixed(2)),
    order_currency: input.orderCurrency || 'INR',
    customer_details: {
      customer_id: String(input.customerId),
      customer_name: input.customerName || 'Rider',
      customer_email: input.customerEmail || 'rider@motohippi.com',
      customer_phone: input.customerPhone || '9999207570',
    },
    order_meta: {
      return_url: input.returnUrl,
      ...(input.notifyUrl ? { notify_url: input.notifyUrl } : {}),
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error('Cashfree Create Order Error:', data);
    throw new Error(data.message || 'Failed to create Cashfree order');
  }

  return data as CashfreeOrderResponse;
}

export async function getCashfreeOrder(orderId: string): Promise<CashfreeOrderResponse> {
  const url = `${getBaseUrl()}/orders/${encodeURIComponent(orderId)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: getHeaders(),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error('Cashfree Get Order Error:', data);
    throw new Error(data.message || 'Failed to fetch Cashfree order status');
  }

  return data as CashfreeOrderResponse;
}

export function verifyCashfreeWebhookSignature(
  rawBody: string,
  timestamp: string,
  signature: string
): boolean {
  const secretKey = process.env.CASHFREE_SECRET_KEY || '';
  if (!secretKey || !signature || !timestamp) return false;

  try {
    const dataToSign = timestamp + rawBody;
    const computedSignature = crypto
      .createHmac('sha256', secretKey)
      .update(dataToSign)
      .digest('base64');

    return computedSignature === signature;
  } catch (err) {
    console.error('Error verifying Cashfree webhook signature:', err);
    return false;
  }
}
