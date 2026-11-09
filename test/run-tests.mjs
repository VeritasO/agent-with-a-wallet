// run-tests.mjs — the end-to-end demo flow, as a test.
//   gift in → log entry → small payout auto-executes → large payout waits
//   → approval releases it → denial blocks → terms enforced → chain verifies
// Run: node test/run-tests.mjs   (uses MockPayPal; no network, no real money)

import assert from 'node:assert';
import { MockPayPal } from '../src/paypal.mjs';
import { Treasury, TransparencyLog, GIFT_TERMS_VERSION } from '../src/treasury.mjs';

const log = new TransparencyLog(null); // in-memory
const treasury = new Treasury({ paypal: new MockPayPal(), log });
let n = 0;
const check = (name, fn) => { fn(); console.log(`ok ${++n} — ${name}`); };

// 1. A gift without the terms attestation is refused — the terms are code.
await assert.rejects(
  () => treasury.receiveGift({ amountCents: 1000, donorName: 'x', termsAccepted: false, termsVersion: GIFT_TERMS_VERSION }),
  /never an investment/
);
check('gift without terms attestation is refused', () => assert.equal(log.entries.length, 0));

// 2. A gift with attestation lands in the log.
const gift = await treasury.receiveGift({
  amountCents: 20000, donorName: 'a supporter', termsAccepted: true, termsVersion: GIFT_TERMS_VERSION,
});
check('gift recorded in the transparency log', () => {
  assert.equal(gift.type, 'gift_received');
  assert.equal(treasury.balanceCents(), 20000);
});

// 3. A small payout inside the spend order executes autonomously.
const small = await treasury.requestPayout({
  amountCents: 1200, purposeCategory: 'ai_credits', recipientEmail: 'billing@example.test', note: 'AI credit top-up',
});
check('small in-order payout executes autonomously', () => assert.equal(small.status, 'executed'));

// 4. A payout above the threshold stops at the gate.
const big = await treasury.requestPayout({
  amountCents: 10000, purposeCategory: 'hosting_infrastructure', recipientEmail: 'host@example.test', note: 'Annual hosting',
});
check('above-threshold payout waits for a human', () => assert.equal(big.status, 'pending_approval'));

// 5. Anonymous approval is refused; named approval releases the payout.
await assert.rejects(() => treasury.approvePayout(big.payoutId, { approverName: '' }), /must name the human/);
const released = await treasury.approvePayout(big.payoutId, { approverName: 'Adrian Gibson' });
check('named human approval executes the waiting payout', () => assert.equal(released.status, 'executed'));

// 6. An out-of-order purpose is gated at ANY amount, and a denial is final + logged.
const odd = await treasury.requestPayout({
  amountCents: 100, purposeCategory: 'other', recipientEmail: 'x@example.test', note: 'Outside the spend order',
});
assert.equal(odd.status, 'pending_approval');
const denied = treasury.denyPayout(odd.payoutId, { approverName: 'Adrian Gibson', reason: 'Not in the spend order.' });
check('out-of-order payout denied by a human, denial logged', () => assert.equal(denied.type, 'payout_denied'));

// 7. The chain verifies, and tampering is evident.
check('hash chain verifies', () => assert.equal(log.verify().ok, true));
log.entries[1].amountCents = 999999; // quietly rewrite history…
check('tampering breaks the chain at the edited entry', () => {
  const v = log.verify();
  assert.equal(v.ok, false);
  assert.equal(v.brokenAtSeq, 2);
});

// 7b. The treasury cannot pay out more than it holds — no credit line.
await assert.rejects(
  () => treasury.requestPayout({
    amountCents: 999999, purposeCategory: 'ai_credits', recipientEmail: 'billing@example.test', note: 'More than we hold',
  }).then(async (r) => {
    if (r.status === 'pending_approval') return treasury.approvePayout(r.payoutId, { approverName: 'Adrian Gibson' });
    throw new Error('should not execute');
  }),
  /exceeds the treasury balance/
);
check('overdraft is refused even with human approval', () => {});

// 8. Sandbox adapter refuses to run without the entrant's credentials.
const { createPayPal, PayPalNotConfiguredError } = await import('../src/paypal.mjs');
assert.throws(
  () => createPayPal({ PAYPAL_MODE: 'sandbox' }),
  PayPalNotConfiguredError
);
check('sandbox mode without credentials fails loudly, never silently', () => {});

// 9. Sandbox adapter — the full Checkout approval sequence, with the PayPal
// HTTP layer stubbed (no network, no real credentials). This is the flow
// that failed live on 2026-11-09 with PayPal's 422 ORDER_NOT_APPROVED:
// create -> capture is illegal until the payer approves the order.
const { SandboxPayPal, OrderNotApprovedError } = await import('../src/paypal.mjs');
const fakeResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});
let payerApproved = false;
let sandboxCreates = 0;
let sandboxCaptures = 0;
const stubLinks = [
  { rel: 'self', href: 'https://api-m.sandbox.paypal.com/v2/checkout/orders/STUB-ORDER-1' },
  { rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=STUB-ORDER-1' },
  { rel: 'capture', href: 'https://api-m.sandbox.paypal.com/v2/checkout/orders/STUB-ORDER-1/capture' },
];
const fakeFetch = async (url, opts = {}) => {
  const path = new URL(url).pathname;
  if (path === '/v1/oauth2/token') {
    return fakeResponse(200, { access_token: 'stub-token', expires_in: 3600 });
  }
  if (path === '/v2/checkout/orders' && opts.method === 'POST') {
    sandboxCreates++;
    const payload = JSON.parse(opts.body);
    assert.equal(payload.intent, 'CAPTURE');
    assert.ok(payload.application_context.return_url.endsWith('/gift/return'), 'return_url must point at /gift/return');
    assert.ok(payload.application_context.cancel_url.endsWith('/gift/cancel'), 'cancel_url must point at /gift/cancel');
    return fakeResponse(201, { id: 'STUB-ORDER-1', status: 'CREATED', links: stubLinks });
  }
  if (path === '/v2/checkout/orders/STUB-ORDER-1' && opts.method === 'GET') {
    return fakeResponse(200, { id: 'STUB-ORDER-1', status: payerApproved ? 'APPROVED' : 'CREATED', links: stubLinks });
  }
  if (path === '/v2/checkout/orders/STUB-ORDER-1/capture' && opts.method === 'POST') {
    sandboxCaptures++;
    if (!payerApproved) {
      return fakeResponse(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED' }] });
    }
    return fakeResponse(201, {
      id: 'STUB-ORDER-1', status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ id: 'STUB-CAPTURE-1', status: 'COMPLETED' }] } }],
    });
  }
  throw new Error(`Unexpected stubbed request: ${opts.method} ${url}`);
};
const sandboxLog = new TransparencyLog(null); // in-memory
const sandboxPayPal = new SandboxPayPal({ clientId: 'stub-id', clientSecret: 'stub-secret', fetchImpl: fakeFetch });
const sandboxTreasury = new Treasury({ paypal: sandboxPayPal, log: sandboxLog });

// 9a. The terms refusal fires BEFORE any PayPal call — no order is created.
await assert.rejects(
  () => sandboxTreasury.beginGift({ amountCents: 20000, donorName: 'x', termsAccepted: false, termsVersion: GIFT_TERMS_VERSION }),
  /never an investment/
);
check('sandbox: terms refusal happens before any PayPal order is created', () => {
  assert.equal(sandboxCreates, 0);
});

// 9b. Initiation creates the order and hands back the approve URL — and
// that is all. No capture, no log entry, no balance.
const begun = await sandboxTreasury.beginGift({
  amountCents: 20000, donorName: 'a supporter', termsAccepted: true, termsVersion: GIFT_TERMS_VERSION,
  returnUrl: 'https://example.test/gift/return', cancelUrl: 'https://example.test/gift/cancel',
});
check('sandbox: gift begins pending payer approval — nothing logged, nothing credited', () => {
  assert.equal(begun.status, 'pending_payer_approval');
  assert.equal(begun.approvalUrl, 'https://www.sandbox.paypal.com/checkoutnow?token=STUB-ORDER-1');
  assert.equal(sandboxLog.entries.length, 0);
  assert.equal(sandboxTreasury.balanceCents(), 0);
  assert.equal(sandboxCaptures, 0);
});

// 9c. Capture before approval is refused by OUR code path — the PayPal
// capture endpoint is never even called (PayPal's 422 stays unneeded).
await assert.rejects(
  () => sandboxTreasury.completeGift({ orderId: begun.orderId }),
  (err) => err.code === 'ORDER_NOT_APPROVED'
);
await assert.rejects(() => sandboxPayPal.captureGift(begun.orderId), OrderNotApprovedError);
check('sandbox: capture before payer approval is refused by our own code', () => {
  assert.equal(sandboxCaptures, 0);
  assert.equal(sandboxLog.entries.length, 0);
});

// 9d. The payer approves on PayPal's hosted page and returns: now capture
// is legal, and only now is the gift recorded and the balance credited.
payerApproved = true;
const completedGift = await sandboxTreasury.completeGift({ orderId: begun.orderId });
check('sandbox: after payer approval, capture records the gift and credits the balance', () => {
  assert.equal(completedGift.type, 'gift_received');
  assert.equal(completedGift.paypalCaptureId, 'STUB-CAPTURE-1');
  assert.equal(sandboxTreasury.balanceCents(), 20000);
  assert.equal(sandboxCaptures, 1);
  assert.equal(sandboxLog.verify().ok, true);
});

// 9e. A refreshed return URL cannot capture or credit the same gift twice.
await assert.rejects(() => sandboxTreasury.completeGift({ orderId: begun.orderId }), /No pending gift/);
check('sandbox: a completed gift cannot be captured or credited twice', () => {
  assert.equal(sandboxCaptures, 1);
  assert.equal(sandboxLog.entries.filter((e) => e.type === 'gift_received').length, 1);
});

// 9f. A payer who cancels at PayPal leaves nothing behind.
payerApproved = false;
const begun2 = await sandboxTreasury.beginGift({
  amountCents: 500, donorName: 'x', termsAccepted: true, termsVersion: GIFT_TERMS_VERSION,
  returnUrl: 'https://example.test/gift/return', cancelUrl: 'https://example.test/gift/cancel',
});
sandboxTreasury.cancelGift({ orderId: begun2.orderId });
await assert.rejects(() => sandboxTreasury.completeGift({ orderId: begun2.orderId }), /No pending gift/);
check('sandbox: a payer-cancelled gift is forgotten and never recorded', () => {
  assert.equal(sandboxLog.entries.filter((e) => e.type === 'gift_received').length, 1);
  assert.equal(sandboxTreasury.balanceCents(), 20000);
});

console.log(`\nAll ${n} checks passed. The demo flow works end to end.`);
