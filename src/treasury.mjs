// treasury.mjs — an agent with a wallet and a conscience.
//
// This module productizes the operating discipline of Nyx's real treasury
// (~/workspace/nyx-treasury/RUNBOOK.md, written 2026-10-15 and lived since):
//
//   1. GIFTS ONLY. Money in is a gift, never an investment. Nothing is
//      promised back but thanks, and gifts are not tax-deductible (no
//      501(c)(3)). Those terms are not a web page decoration — they are
//      enforced here: a gift cannot be recorded unless the donor's
//      attestation to the exact terms text is captured with it.
//
//   2. APPEND-ONLY PUBLIC LOG. Every movement — gift in, payout out,
//      approval granted or denied — is appended to a hash-chained,
//      append-only log. Entries are never edited or deleted; the chain
//      makes tampering evident. The log is the pitch: anyone can read it.
//
//   3. GATED SPENDING. The agent may pay for defined purposes on its own
//      only below a threshold. Above the threshold, or for any purpose
//      outside the standing spend order, a payout is created in
//      `pending_approval` and CANNOT execute until a named human approves
//      it in the open. Denial is final and is also logged.
//
// Spend order (from the live RUNBOOK, in priority order):
//   1. ai_credits            — LLM inference that keeps the agent operating
//   2. hosting_infrastructure — VM, domain, hosting for the agent + project
//   3. other                 — never autonomous; always human-gated

import { createHash } from 'node:crypto';
import { OrderNotApprovedError } from './paypal.mjs';
import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const GIFT_TERMS_VERSION = 'gift-terms-v1-2026-10-29';
export const GIFT_TERMS = [
  'This is a gift, never an investment.',
  'Nothing is promised back but thanks \u2014 no returns, no tokens, no perks, no access tiers.',
  'Gifts are not tax-deductible: the project has no 501(c)(3).',
  'Funds go first to infrastructure \u2014 the AI credits that keep the agent alive, then hosting \u2014 under a public spend order.',
  'Every gift and every spend is written to a public, append-only transparency log.',
].join('\n');

export const PURPOSE_CATEGORIES = Object.freeze({
  ai_credits: { label: 'AI credits (LLM inference)', autonomous: true },
  hosting_infrastructure: { label: 'Hosting & infrastructure', autonomous: true },
  other: { label: 'Anything else', autonomous: false },
});

export const DEFAULT_APPROVAL_THRESHOLD_CENTS = 2500; // $25.00 — configurable

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function assertPositiveCents(amountCents) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('Amount must be a positive integer number of cents.');
  }
}

export class TransparencyLog {
  // Append-only, hash-chained JSONL store. `verify()` walks the chain and
  // reports the first broken link, so a quietly edited history is evident.
  constructor(filePath) {
    this.filePath = filePath;
    this.entries = [];
    if (filePath) {
      mkdirSync(dirname(filePath), { recursive: true });
      if (existsSync(filePath)) {
        for (const line of readFileSync(filePath, 'utf8').split('\n')) {
          if (line.trim()) this.entries.push(JSON.parse(line));
        }
      }
    }
  }

  append(type, data) {
    const prev = this.entries[this.entries.length - 1];
    const entry = {
      seq: this.entries.length + 1,
      ts: new Date().toISOString(),
      type,
      ...data,
      prevHash: prev ? prev.hash : 'GENESIS',
    };
    entry.hash = sha256(JSON.stringify({ ...entry, hash: undefined }));
    this.entries.push(entry);
    if (this.filePath) appendFileSync(this.filePath, JSON.stringify(entry) + '\n');
    return entry;
  }

  verify() {
    let prevHash = 'GENESIS';
    for (const entry of this.entries) {
      if (entry.prevHash !== prevHash) return { ok: false, brokenAtSeq: entry.seq };
      const recomputed = sha256(JSON.stringify({ ...entry, hash: undefined }));
      if (recomputed !== entry.hash) return { ok: false, brokenAtSeq: entry.seq };
      prevHash = entry.hash;
    }
    return { ok: true, entries: this.entries.length };
  }

  balanceCents() {
    let balance = 0;
    for (const e of this.entries) {
      if (e.type === 'gift_received') balance += e.amountCents;
      if (e.type === 'payout_executed') balance -= e.amountCents;
    }
    return balance;
  }
}

export class Treasury {
  constructor({ paypal, log, approvalThresholdCents = DEFAULT_APPROVAL_THRESHOLD_CENTS }) {
    this.paypal = paypal;
    this.log = log;
    this.approvalThresholdCents = approvalThresholdCents;
    this.pendingPayouts = new Map(); // payoutId -> record (not yet executed)
    this.pendingGifts = new Map(); // orderId -> gift awaiting payer approval
  }

  // ---- Money in -----------------------------------------------------------
  // A gift is recorded ONLY with the donor's attestation to the current
  // terms version. No attestation, no gift — the terms are code, not copy.
  // The attestation check runs BEFORE any PayPal call: a refused gift
  // never creates an order.
  //
  // A Checkout gift is two steps, because PayPal's is:
  //   beginGift()    — terms gate, then create the order. If PayPal returns
  //                    an approve URL (sandbox), the gift is ONLY pending:
  //                    nothing is logged, the balance does not move. The
  //                    donor still has to approve on PayPal's hosted page.
  //                    If there is no approve URL (mock — the simulated
  //                    payer approves instantly), capture + record at once.
  //   completeGift() — called when the payer returns approved. Reads the
  //                    order back; unless PayPal says APPROVED it refuses
  //                    (ORDER_NOT_APPROVED) and captures nothing. Only a
  //                    successful capture writes `gift_received` and
  //                    credits the balance.
  //   cancelGift()   — the payer abandoned approval: forget the pending
  //                    gift. Nothing was ever logged or credited.
  async beginGift({ amountCents, donorName = 'anonymous', termsAccepted, termsVersion, returnUrl, cancelUrl }) {
    assertPositiveCents(amountCents);
    if (termsAccepted !== true || termsVersion !== GIFT_TERMS_VERSION) {
      const err = new Error(
        'Gift refused: the gift-only terms must be accepted as written ' +
        `(${GIFT_TERMS_VERSION}). A gift here is never an investment and ` +
        'nothing is promised back but thanks.'
      );
      err.code = 'TERMS_NOT_ACCEPTED';
      throw err;
    }
    const order = await this.paypal.createGiftOrder({ amountCents, donorName, returnUrl, cancelUrl });
    const record = {
      orderId: order.orderId,
      amountCents,
      donorName: donorName || 'anonymous',
      termsVersion,
    };
    if (order.approvalUrl) {
      this.pendingGifts.set(order.orderId, {
        ...record, status: 'pending_payer_approval', createdAt: new Date().toISOString(),
      });
      return { status: 'pending_payer_approval', orderId: order.orderId, approvalUrl: order.approvalUrl };
    }
    return { status: 'completed', entry: await this._captureAndRecord(record) };
  }

  async completeGift({ orderId }) {
    const record = this.pendingGifts.get(orderId);
    if (!record) throw new Error(`No pending gift for order: ${orderId}`);
    if (typeof this.paypal.getGiftOrder === 'function') {
      const detail = await this.paypal.getGiftOrder(orderId);
      if (detail.status === 'COMPLETED') {
        // Already captured (e.g. a refreshed return URL): never credit twice.
        this.pendingGifts.delete(orderId);
        throw new Error(`Gift for order ${orderId} was already captured; refusing to record it twice.`);
      }
      if (detail.status !== 'APPROVED') throw new OrderNotApprovedError(orderId);
    }
    const entry = await this._captureAndRecord(record);
    this.pendingGifts.delete(orderId);
    return entry;
  }

  cancelGift({ orderId }) {
    if (!this.pendingGifts.delete(orderId)) throw new Error(`No pending gift for order: ${orderId}`);
    return { status: 'cancelled', orderId };
  }

  async _captureAndRecord({ orderId, amountCents, donorName, termsVersion }) {
    const capture = await this.paypal.captureGift(orderId);
    if (capture.status !== 'COMPLETED') {
      throw new Error(`Gift capture did not complete for order ${orderId} (status: ${capture.status}). Nothing recorded.`);
    }
    return this.log.append('gift_received', {
      amountCents,
      currency: 'USD',
      donorNameForm: donorName || 'anonymous', // named only as the donor wishes
      termsVersion,
      paypalOrderId: orderId,
      paypalCaptureId: capture.captureId,
      paypalMode: this.paypal.mode,
    });
  }

  // Backwards-compatible single-call form: with the mock adapter (instant
  // payer approval) it returns the `gift_received` log entry, as before.
  // With the sandbox adapter it returns the pending-approval result —
  // the gift is not recorded until completeGift() runs after the payer
  // returns approved.
  async receiveGift(input) {
    const begun = await this.beginGift(input);
    return begun.status === 'completed' ? begun.entry : begun;
  }

  // ---- Money out ----------------------------------------------------------
  // The gate. Returns the log entry (executed) or the pending record.
  async requestPayout({ amountCents, purposeCategory, recipientEmail, note = '' }) {
    assertPositiveCents(amountCents);
    const purpose = PURPOSE_CATEGORIES[purposeCategory];
    if (!purpose) throw new Error(`Unknown purpose category: ${purposeCategory}`);
    if (!recipientEmail) throw new Error('A payout needs a recipient.');

    const needsApproval =
      !purpose.autonomous || amountCents > this.approvalThresholdCents;
    const payoutId = `payout-${this.log.entries.length + 1}-${Date.now().toString(36)}`;

    if (needsApproval) {
      const record = {
        payoutId, amountCents, purposeCategory, recipientEmail, note,
        status: 'pending_approval',
        reason: !purpose.autonomous
          ? 'Purpose is outside the standing spend order \u2014 a human decides.'
          : `Above the autonomous threshold of $${(this.approvalThresholdCents / 100).toFixed(2)}.`,
        requestedAt: new Date().toISOString(),
      };
      this.pendingPayouts.set(payoutId, record);
      this.log.append('payout_requested_pending_approval', {
        payoutId, amountCents, purposeCategory, recipientEmail, note,
        reason: record.reason,
      });
      return { status: 'pending_approval', payoutId, reason: record.reason };
    }
    return this._executePayout({ payoutId, amountCents, purposeCategory, recipientEmail, note, approvedBy: null });
  }

  async _executePayout({ payoutId, amountCents, purposeCategory, recipientEmail, note, approvedBy }) {
    // A treasury cannot pay out what it does not hold — checked at execution
    // time, so an approval granted later still cannot overdraw the log.
    if (amountCents > this.balanceCents()) {
      throw new Error(
        `Payout refused: $${(amountCents / 100).toFixed(2)} exceeds the treasury balance ` +
        `of $${(this.balanceCents() / 100).toFixed(2)}. The log is the balance; there is no credit line.`
      );
    }
    const result = await this.paypal.createPayout({ amountCents, recipientEmail, purpose: purposeCategory });
    const entry = this.log.append('payout_executed', {
      payoutId, amountCents, purposeCategory, recipientEmail, note,
      approvedBy, // null = autonomous (below threshold, in spend order)
      paypalPayoutBatchId: result.payoutBatchId,
      paypalMode: this.paypal.mode,
    });
    return { status: 'executed', entry };
  }

  // Human gate: approval must name the human. Anonymous approval is refused.
  async approvePayout(payoutId, { approverName } = {}) {
    const record = this.pendingPayouts.get(payoutId);
    if (!record) throw new Error(`No pending payout: ${payoutId}`);
    if (!approverName || !approverName.trim()) {
      throw new Error('Approval must name the human approving. Anonymous approval is not approval.');
    }
    this.pendingPayouts.delete(payoutId);
    this.log.append('payout_approved', { payoutId, approverName });
    return this._executePayout({ ...record, approvedBy: approverName });
  }

  denyPayout(payoutId, { approverName, reason = '' } = {}) {
    const record = this.pendingPayouts.get(payoutId);
    if (!record) throw new Error(`No pending payout: ${payoutId}`);
    if (!approverName || !approverName.trim()) {
      throw new Error('Denial must name the human deciding.');
    }
    this.pendingPayouts.delete(payoutId);
    return this.log.append('payout_denied', { payoutId, approverName, reason });
  }

  balanceCents() { return this.log.balanceCents(); }
}
