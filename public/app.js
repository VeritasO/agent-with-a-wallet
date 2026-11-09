// app.js — page logic for the conscience-treasury demo. No framework.
const $ = (sel) => document.querySelector(sel);
const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;
const post = async (path, body) => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};
const show = (el, ok, text) => {
  el.className = `msg ${ok ? 'ok' : 'err'}`;
  el.textContent = text;
};

async function initGiftPage() {
  const { terms } = await (await fetch('/api/terms')).json();
  $('#terms').textContent = terms;
  const msg = $('#gift-msg');
  // Landing states from PayPal's payer return/cancel redirects.
  const landed = new URLSearchParams(location.search).get('gift');
  if (landed === 'cancelled') {
    show(msg, false, 'Gift cancelled at PayPal — nothing was recorded and nothing was charged.');
  } else if (landed === 'error') {
    show(msg, false, new URLSearchParams(location.search).get('reason') || 'The gift could not be completed.');
  }
  $('#gift-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    try {
      const data = await post('/api/gifts', {
        amountCents: Math.round(Number(form.get('amount')) * 100),
        donorName: form.get('donorName') || 'anonymous',
        termsAccepted: form.get('termsAccepted') === 'on',
        termsVersion: 'gift-terms-v1-2026-10-29',
      });
      if (data.approvalUrl) {
        // Sandbox Checkout: the gift exists only as a PayPal order until
        // the payer approves it on PayPal's hosted page. Send them there;
        // PayPal returns them to /gift/return, where capture happens.
        show(msg, true, 'Taking you to PayPal (sandbox) to approve your gift…');
        window.location.href = data.approvalUrl;
        return;
      }
      show(msg, true, `Gift recorded — log entry #${data.entry.seq}. Thank you. ` +
        'Nothing is promised back but this thanks, and the log now shows your gift to anyone.');
    } catch (err) {
      show(msg, false, err.message);
    }
  });
}

async function refreshConsole() {
  const state = await (await fetch('/api/state')).json();
  $('#balance').textContent = dollars(state.balanceCents);
  $('#threshold').textContent = dollars(state.approvalThresholdCents);
  $('#mode').textContent = state.paypalMode;
  $('#chain').textContent = state.verification.ok
    ? `verified · ${state.verification.entries} entries` : 'BROKEN';
  const box = $('#pending');
  if (!state.pendingPayouts.length) {
    box.innerHTML = '<p>Nothing waiting.</p>';
    return;
  }
  box.innerHTML = state.pendingPayouts.map((p) => `
    <div class="card">
      <p><strong>${dollars(p.amountCents)}</strong> → ${p.recipientEmail}
      <span class="pill gate">pending approval</span></p>
      <p>Purpose: ${p.purposeCategory} · ${p.note || ''}</p>
      <p>Why it stopped: ${p.reason}</p>
      <label>Your name (the human at the gate)
        <input id="approver-${p.payoutId}" placeholder="A named human — anonymous approval is refused">
      </label>
      <button onclick="decide('${p.payoutId}', 'approve')">Approve &amp; execute</button>
      <button class="deny" onclick="decide('${p.payoutId}', 'deny')">Deny</button>
      <div class="msg" id="msg-${p.payoutId}"></div>
    </div>`).join('');
}

async function decide(payoutId, action) {
  const msg = $(`#msg-${payoutId}`);
  const approverName = $(`#approver-${payoutId}`).value;
  try {
    await post(`/api/payouts/${payoutId}/${action}`, { approverName, reason: '' });
    show(msg, true, action === 'approve' ? 'Approved and executed — and logged.' : 'Denied — and logged.');
    setTimeout(refreshConsole, 600);
  } catch (err) {
    show(msg, false, err.message);
  }
}

async function initConsolePage() {
  await refreshConsole();
  $('#payout-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#payout-msg');
    const form = new FormData(e.target);
    try {
      const data = await post('/api/payouts', {
        amountCents: Math.round(Number(form.get('amount')) * 100),
        purposeCategory: form.get('purposeCategory'),
        recipientEmail: form.get('recipientEmail'),
        note: form.get('note'),
      });
      if (data.status === 'executed') {
        show(msg, true, `Executed autonomously — log entry #${data.entry.seq}. Below the threshold, inside the spend order.`);
      } else {
        show(msg, true, `Stopped at the gate: ${data.reason} It now waits below for a named human.`);
      }
      refreshConsole();
    } catch (err) {
      show(msg, false, err.message);
    }
  });
}

async function initLogPage() {
  const data = await (await fetch('/api/log')).json();
  $('#balance').textContent = dollars(data.balanceCents);
  $('#chain').textContent = data.verification.ok
    ? `verified · ${data.verification.entries} entries` : `BROKEN at #${data.verification.brokenAtSeq}`;
  $('#rows').innerHTML = data.entries.map((e) => {
    const detail = [
      e.amountCents != null ? dollars(e.amountCents) : '',
      e.donorNameForm ? `from ${e.donorNameForm}` : '',
      e.purposeCategory ? `for ${e.purposeCategory}` : '',
      e.recipientEmail ? `to ${e.recipientEmail}` : '',
      e.approvedBy ? `approved by ${e.approvedBy}` : '',
      e.approverName ? `decided by ${e.approverName}` : '',
      e.reason ? `— ${e.reason}` : '',
    ].filter(Boolean).join(' ');
    return `<tr><td>${e.seq}</td><td>${e.ts.replace('T', ' ').slice(0, 19)}Z</td>` +
      `<td>${e.type}</td><td>${detail}</td><td class="mono">${e.hash.slice(0, 12)}…</td></tr>`;
  }).join('') || '<tr><td colspan="5">No movements yet.</td></tr>';
}
