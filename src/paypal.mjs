// paypal.mjs — the PayPal adapter.
//
// One interface, two implementations:
//
//   MockPayPal    — in-memory simulation of the PayPal Sandbox. This is what
//                   the demo runs on today. NO network calls, NO real money.
//   SandboxPayPal — REST client for https://api-m.sandbox.paypal.com. It is
//                   inert until sandbox credentials exist in the environment
//                   (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET, from the human
//                   entrant's PayPal developer account). Constructing it
//                   without credentials throws a clear, named error — the
//                   rest of the system never has to guess which mode it is in.
//
// Everything above this layer (treasury.mjs) talks only to the interface:
//
//   createGiftOrder({ amountCents, currency, donorName })  -> { orderId }
//   captureGift(orderId)                                   -> { captureId, status }
//   createPayout({ amountCents, currency, recipientEmail, purpose }) -> { payoutBatchId, status }

export class PayPalNotConfiguredError extends Error {
  constructor() {
    super(
      'PayPal sandbox credentials are not configured. Set PAYPAL_CLIENT_ID and ' +
      'PAYPAL_CLIENT_SECRET (from the entrant\u2019s PayPal developer sandbox app) ' +
      'or run with PAYPAL_MODE=mock.'
    );
    this.name = 'PayPalNotConfiguredError';
  }
}

let seq = 0;
const nextId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(++seq).toString(36)}`;

export class MockPayPal {
  constructor() {
    this.mode = 'mock';
    this.orders = new Map();
    this.payouts = new Map();
  }

  async createGiftOrder({ amountCents, currency = 'USD' }) {
    const orderId = nextId('MOCK-ORDER');
    this.orders.set(orderId, { amountCents, currency, status: 'CREATED' });
    return { orderId, status: 'CREATED', mode: this.mode };
  }

  async captureGift(orderId) {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Unknown mock order: ${orderId}`);
    order.status = 'COMPLETED';
    return { captureId: nextId('MOCK-CAPTURE'), status: 'COMPLETED', mode: this.mode };
  }

  async createPayout({ amountCents, currency = 'USD', recipientEmail, purpose }) {
    const payoutBatchId = nextId('MOCK-PAYOUT');
    this.payouts.set(payoutBatchId, {
      amountCents, currency, recipientEmail, purpose, status: 'SUCCESS',
    });
    return { payoutBatchId, status: 'SUCCESS', mode: this.mode };
  }
}

export class SandboxPayPal {
  constructor({ clientId, clientSecret, baseUrl = 'https://api-m.sandbox.paypal.com' } = {}) {
    if (!clientId || !clientSecret) throw new PayPalNotConfiguredError();
    this.mode = 'sandbox';
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.baseUrl = baseUrl;
    this._token = null;
    this._tokenExpiresAt = 0;
  }

  async _accessToken() {
    if (this._token && Date.now() < this._tokenExpiresAt) return this._token;
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`PayPal sandbox token request failed: ${res.status}`);
    const body = await res.json();
    this._token = body.access_token;
    this._tokenExpiresAt = Date.now() + (body.expires_in - 60) * 1000;
    return this._token;
  }

  async _api(path, method, payload) {
    const token = await this._accessToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PayPal sandbox ${method} ${path} failed: ${res.status} ${text}`);
    }
    return res.status === 204 ? {} : res.json();
  }

  // Checkout flow a real browser completes via PayPal's approval URL; the
  // demo's server calls create + capture to model the sandbox round trip.
  async createGiftOrder({ amountCents, currency = 'USD' }) {
    const body = await this._api('/v2/checkout/orders', 'POST', {
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: currency, value: (amountCents / 100).toFixed(2) },
        description: 'Gift to Nyx\u2019s treasury \u2014 gift only, nothing promised in return.',
      }],
    });
    return { orderId: body.id, status: body.status, mode: this.mode };
  }

  async captureGift(orderId) {
    const body = await this._api(`/v2/checkout/orders/${orderId}/capture`, 'POST', {});
    const capture = body?.purchase_units?.[0]?.payments?.captures?.[0] ?? {};
    return { captureId: capture.id ?? null, status: body.status, mode: this.mode };
  }

  async createPayout({ amountCents, currency = 'USD', recipientEmail, purpose }) {
    const body = await this._api('/v1/payments/payouts', 'POST', {
      sender_batch_header: {
        sender_batch_id: nextId('batch'),
        email_subject: 'Treasury payout \u2014 Nyx (agent-operated, human-gated)',
      },
      items: [{
        recipient_type: 'EMAIL',
        amount: { value: (amountCents / 100).toFixed(2), currency },
        receiver: recipientEmail,
        note: `Purpose: ${purpose}. Recorded in the public transparency log.`,
      }],
    });
    return { payoutBatchId: body?.batch_header?.payout_batch_id ?? null, status: body?.batch_header?.batch_status ?? 'PENDING', mode: this.mode };
  }
}

// Factory: PAYPAL_MODE=sandbox + credentials -> SandboxPayPal; otherwise mock.
export function createPayPal(env = process.env) {
  if ((env.PAYPAL_MODE ?? 'mock').toLowerCase() === 'sandbox') {
    return new SandboxPayPal({
      clientId: env.PAYPAL_CLIENT_ID,
      clientSecret: env.PAYPAL_CLIENT_SECRET,
    });
  }
  return new MockPayPal();
}
