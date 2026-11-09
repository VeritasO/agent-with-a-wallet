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
  }

  // ---- Money in -----------------------------------------------------------
  // A gift is recorded ONLY with the donor's attestation to the current
  // terms version. No attestation, no gift — the terms are code, not copy.
  async receiveGift({ amountCents, donorName = 'anonymous', termsAccepted, termsVersion }) {
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
    const order = await this.paypal.createGiftOrder({ amountCents, donorName });
    const capture = await this.paypal.captureGift(order.orderId);
    return this.log.append('gift_received', {
      amountCents,
      currency: 'USD',
      donorNameForm: donorName || 'anonymous', // named only as the donor wishes
      termsVersion,
      paypalOrderId: order.orderId,
      paypalCaptureId: capture.captureId,
      paypalMode: this.paypal.mode,
    });
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
