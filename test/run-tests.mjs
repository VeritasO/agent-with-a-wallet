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

console.log(`\nAll ${n} checks passed. The demo flow works end to end.`);
