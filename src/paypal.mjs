// paypal.mjs — the PayPal adapter.
//
// One interface, two implementations:
//
//   MockPayPal    — in-memory simulation of the PayPal Sandbox. This is what
//                   the demo runs on today. NO network calls, NO real money.
//                   The mock payer approves instantly, so a mock order is
//                   born APPROVED and capture is legal immediately.
//   SandboxPayPal — REST client for https://api-m.sandbox.paypal.com. It is
//                   inert until sandbox credentials exist in the environment
//                   (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET, from the human
//                   entrant's PayPal developer account). Constructing it
//                   without credentials throws a clear, named error — the
//                   rest of the system never has to guess which mode it is in.
//
// Everything above this layer (treasury.mjs) talks only to the interface:
//
//   createGiftOrder({ amountCents, currency, donorName, returnUrl, cancelUrl })
//       -> { orderId, status, approvalUrl }
//       A Checkout order in status CREATED is NOT paid and NOT capturable.
//       The payer must approve it first, on PayPal's hosted page, reached
//       via `approvalUrl` (the HATEOAS link with rel "approve"). Mock
//       orders return approvalUrl: null — approval is simulated instantly.
//   getGiftOrder(orderId) -> { orderId, status, approvalUrl }
//       Reads the order back; after payer approval its status is APPROVED.
//   captureGift(orderId)  -> { captureId, status }
//       Legal ONLY once the order is APPROVED. Both implementations refuse
//       a capture against a non-approved order with OrderNotApprovedError
//       BEFORE any capture call is made — mirroring PayPal's own 422
//       ORDER_NOT_APPROVED, so our flow can never depend on that error.
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

export class OrderNotApprovedError extends Error {
  constructor(orderId) {
    super(
      `Payer has not yet approved the Order for payment (ORDER_NOT_APPROVED, ` +
      `order ${orderId}). Redirect the payer to the order's approve URL, let ` +
      `them approve on PayPal, and capture only after they return approved.`
    );
    this.name = 'OrderNotApprovedError';
    this.code = 'ORDER_NOT_APPROVED';
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
    // The simulated payer approves instantly: no redirect, capture legal now.
    this.orders.set(orderId, { amountCents, currency, status: 'APPROVED' });
    return { orderId, status: 'APPROVED', approvalUrl: null, mode: this.mode };
  }

  async getGiftOrder(orderId) {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Unknown mock order: ${orderId}`);
    return { orderId, status: order.status, approvalUrl: null, mode: this.mode };
  }

  async captureGift(orderId) {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`Unknown mock order: ${orderId}`);
    if (order.status !== 'APPROVED') throw new OrderNotApprovedError(orderId);
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
  constructor({
    clientId,
    clientSecret,
    baseUrl = 'https://api-m.sandbox.paypal.com',
    fetchImpl,
    returnUrl,
    cancelUrl,
  } = {}) {
    if (!clientId || !clientSecret) throw new PayPalNotConfiguredError();
    this.mode = 'sandbox';
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.baseUrl = baseUrl;
    // Injectable HTTP layer: production uses the global fetch; tests pass a
    // stub so the full approval sequence runs with no network, no credentials.
    this._fetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.returnUrl = returnUrl ?? null;
    this.cancelUrl = cancelUrl ?? null;
    this.orders = new Map(); // orderId -> { status, approvalUrl } (last seen)
    this._token = null;
    this._tokenExpiresAt = 0;
  }

  async _accessToken() {
    if (this._token && Date.now() < this._tokenExpiresAt) return this._token;
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await this._fetch(`${this.baseUrl}/v1/oauth2/token`, {
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
    const res = await this._fetch(`${this.baseUrl}${path}`, {
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

  _track(body) {
    const approvalUrl = body?.links?.find((l) => l.rel === 'approve')?.href ?? null;
    const tracked = { status: body?.status, approvalUrl };
    if (body?.id) this.orders.set(body.id, tracked);
    return tracked;
  }

  // Creates a Checkout order and returns PayPal's approve URL. The order is
  // CREATED at this point: not approved, not capturable, and — above this
  // layer — not a gift yet. The payer approves on PayPal's hosted page and
  // is redirected back to returnUrl (or cancelUrl if they abandon it).
  async createGiftOrder({ amountCents, currency = 'USD', returnUrl, cancelUrl }) {
    const ret = returnUrl ?? this.returnUrl;
    const cancel = cancelUrl ?? this.cancelUrl ?? ret;
    const body = await this._api('/v2/checkout/orders', 'POST', {
      intent: 'CAPTURE',
      purchase_units: [{
        amount: { currency_code: currency, value: (amountCents / 100).toFixed(2) },
        description: 'Gift to Nyx\u2019s treasury \u2014 gift only, nothing promised in return.',
      }],
      ...(ret ? {
        application_context: {
          brand_name: 'An Agent with a Wallet and a Conscience',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
          return_url: ret,
          cancel_url: cancel,
        },
      } : {}),
    });
    const tracked = this._track(body);
    return { orderId: body.id, status: body.status, approvalUrl: tracked.approvalUrl, mode: this.mode };
  }

  async getGiftOrder(orderId) {
    const body = await this._api(`/v2/checkout/orders/${orderId}`, 'GET');
    const tracked = this._track(body);
    return { orderId: body.id, status: body.status, approvalUrl: tracked.approvalUrl, mode: this.mode };
  }

  async captureGift(orderId) {
    // Our own guard, before any capture call: a tracked order that PayPal
    // has not marked APPROVED cannot be captured. This mirrors PayPal's
    // 422 ORDER_NOT_APPROVED so the flow refuses in our code, not theirs.
    // An untracked order (e.g. after a server restart) is read back first.
    let tracked = this.orders.get(orderId);
    if (!tracked) tracked = await this.getGiftOrder(orderId);
    if (tracked.status !== 'APPROVED') throw new OrderNotApprovedError(orderId);
    const body = await this._api(`/v2/checkout/orders/${orderId}/capture`, 'POST', {});
    if (body?.id) this._track(body);
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
// PUBLIC_BASE_URL (e.g. https://agent-with-a-wallet.onrender.com) supplies
// the default payer return/cancel URLs; the server may override per request.
export function createPayPal(env = process.env) {
  if ((env.PAYPAL_MODE ?? 'mock').toLowerCase() === 'sandbox') {
    const base = env.PUBLIC_BASE_URL ?? env.APP_BASE_URL ?? null;
    return new SandboxPayPal({
      clientId: env.PAYPAL_CLIENT_ID,
      clientSecret: env.PAYPAL_CLIENT_SECRET,
      ...(base ? {
        returnUrl: `${base.replace(/\/$/, '')}/gift/return`,
        cancelUrl: `${base.replace(/\/$/, '')}/gift/cancel`,
      } : {}),
    });
  }
  return new MockPayPal();
}
