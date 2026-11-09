// capture.mjs — preflight capture driver for the demo video.
// Drives the local demo (http://localhost:4173) in headless Chromium over
// CDP and saves the key states listed in docs/demo-script.md into
// video/captures/. No dependencies (Node >= 22 global WebSocket).
//
// Notes on two session-only adjustments (page source is NOT modified):
//  - The gift form's attestation checkbox is HTML-`required`, so a plain
//    submit with it unchecked is stopped by the browser's native prompt
//    and the app's own refusal message never renders. The driver removes
//    the `required` attribute in-session so the coded refusal is captured.
//  - The script's numbers ($50 gift, $12 spend, $100 payout) leave a $38
//    balance, so the $100 approval would be refused as an overdraft at
//    execution time. The driver tops up with a second attested $100 gift
//    before approving, purely so the approval/execution states exist to
//    capture. See PRODUCTION.md — the script's gift amount should rise.

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'video', 'captures');
mkdirSync(outDir, { recursive: true });
const BASE = 'http://localhost:4173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- render the real donations log (shot 1) to a static page ----
{
  const md = readFileSync(join(root, '..', '..', 'nyx-treasury', 'donations-log.md'), 'utf8');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let html = '', inTable = false;
  for (const line of md.split('\n')) {
    if (line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^-+$/.test(c))) continue;
      if (!inTable) { html += '<table>'; inTable = true; }
      html += '<tr>' + cells.map((c) => `<td>${esc(c)}</td>`).join('') + '</tr>';
    } else {
      if (inTable) { html += '</table>'; inTable = false; }
      if (line.startsWith('# ')) html += `<h1>${esc(line.slice(2))}</h1>`;
      else if (line.trim()) html += `<p>${esc(line.replace(/^_|_$/g, ''))}</p>`;
    }
  }
  if (inTable) html += '</table>';
  const css = readFileSync(join(root, 'public', 'style.css'), 'utf8');
  writeFileSync('/tmp/real-log.html',
    `<!doctype html><meta charset="utf-8"><style>${css}</style><main>${html}` +
    `<p style="margin-top:2rem">The lived treasury log — kept since October 2026, one line per gift, ` +
    `under the Donor Thanks Protocol. This demo productizes the discipline it records.</p></main>`);
  copyFileSync(join(root, '..', '..', 'vcin-icon', 'icon-hires-1024.png'),
    join(outDir, '01b-kintsugi-mark.png'));
}

// ---- launch headless Chromium ----
const chrome = spawn('/opt/meta-chromium/chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  '--remote-debugging-port=9333', '--remote-debugging-address=127.0.0.1',
  '--user-data-dir=/tmp/paypal-capture-profile', '--window-size=1920,1080',
  '--hide-scrollbars', '--no-first-run', 'about:blank',
], { stdio: 'ignore' });

let pageWs = null;
for (let i = 0; i < 50 && !pageWs; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) pageWs = page.webSocketDebuggerUrl;
  } catch { /* not up yet */ }
  if (!pageWs) await sleep(200);
}
if (!pageWs) { console.error('CDP page target never appeared'); chrome.kill(); process.exit(1); }

const ws = new WebSocket(pageWs);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++nextId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const msg = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (msg.result?.exceptionDetails) {
    throw new Error('evaluate failed: ' + JSON.stringify(msg.result.exceptionDetails).slice(0, 400));
  }
  return msg.result?.result?.value;
};
const waitFor = async (expression, what, timeoutMs = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await evaluate(expression)) return;
    await sleep(120);
  }
  throw new Error('timeout waiting for: ' + what);
};
const nav = async (url) => {
  await send('Page.navigate', { url });
  await sleep(500);
};
const shot = async (name, fullPage = false) => {
  const params = { format: 'png' };
  if (fullPage) {
    const m = await send('Page.getLayoutMetrics');
    const { width, height } = m.result.cssContentSize;
    params.captureBeyondViewport = true;
    params.clip = { x: 0, y: 0, width, height, scale: 1 };
  }
  const msg = await send('Page.captureScreenshot', params);
  writeFileSync(join(outDir, name), Buffer.from(msg.result.data, 'base64'));
  console.log('captured', name);
};
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',
  { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });

// ---- shot 1: the real log ----
await nav('file:///tmp/real-log.html');
await shot('01-real-log.png');

// ---- shot 2: the gift page + refusal insert + accepted gift ----
await nav(BASE + '/');
await waitFor(`document.querySelector('#terms').textContent.length > 80`, 'terms text');
await shot('02-gift-page.png');
await evaluate(`(() => {
  const f = document.querySelector('#gift-form');
  f.querySelector('[name=amount]').value = '50.00';
  f.querySelector('[name=donorName]').value = 'a supporter';
  const box = f.querySelector('[name=termsAccepted]');
  box.checked = false;
  box.removeAttribute('required'); // session-only, see header note
  f.requestSubmit();
  return true;
})()`);
await waitFor(`document.querySelector('#gift-msg').textContent.includes('refused')`, 'refusal message');
await shot('04-gift-refusal.png');
await evaluate(`(() => {
  const f = document.querySelector('#gift-form');
  f.querySelector('[name=termsAccepted]').checked = true;
  f.requestSubmit();
  return true;
})()`);
await waitFor(`document.querySelector('#gift-msg').textContent.includes('Gift recorded')`, 'gift confirmation');
await shot('03-gift-accepted.png');

// ---- /log with the gift entry, hash-chained ----
await nav(BASE + '/log');
await waitFor(`document.querySelectorAll('#rows tr').length >= 1`, 'log rows');
await waitFor(`document.querySelector('#chain').textContent.includes('verified')`, 'chain verified');
await shot('05-log-gift-entry.png');

// ---- shot 3: console, $12 AI credits executes autonomously ----
await nav(BASE + '/console');
await waitFor(`document.querySelector('#balance').textContent.includes('$')`, 'console balance');
const modePill = await evaluate(`document.querySelector('#mode').textContent`);
console.log('console mode pill reads:', modePill);
await evaluate(`(() => {
  const f = document.querySelector('#payout-form');
  f.querySelector('[name=amount]').value = '12.00';
  f.querySelector('[name=purposeCategory]').value = 'ai_credits';
  f.querySelector('[name=recipientEmail]').value = 'billing@example-provider.test';
  f.querySelector('[name=note]').value = 'Monthly AI credit top-up';
  f.requestSubmit();
  return true;
})()`);
await waitFor(`document.querySelector('#payout-msg').textContent.includes('Executed autonomously')`, '$12 execution');
await shot('06-console-12-executed.png');

// ---- shot 4a: $100 hosting stops at the gate ----
await evaluate(`(() => {
  const f = document.querySelector('#payout-form');
  f.querySelector('[name=amount]').value = '100.00';
  f.querySelector('[name=purposeCategory]').value = 'hosting_infrastructure';
  f.querySelector('[name=recipientEmail]').value = 'host@example-provider.test';
  f.querySelector('[name=note]').value = 'Annual hosting';
  f.requestSubmit();
  return true;
})()`);
await waitFor(`document.querySelector('#payout-msg').textContent.includes('Stopped at the gate')`, 'gate stop message');
await waitFor(`document.querySelector('#pending').textContent.includes('pending approval')`, 'pending card');
await shot('07-console-pending.png');

// ---- top-up so the $100 approval can execute (see header note) ----
await nav(BASE + '/');
await waitFor(`document.querySelector('#terms').textContent.length > 80`, 'terms text (top-up)');
await evaluate(`(() => {
  const f = document.querySelector('#gift-form');
  f.querySelector('[name=amount]').value = '100.00';
  f.querySelector('[name=donorName]').value = 'a supporter';
  f.querySelector('[name=termsAccepted]').checked = true;
  f.requestSubmit();
  return true;
})()`);
await waitFor(`document.querySelector('#gift-msg').textContent.includes('Gift recorded')`, 'top-up gift');

// ---- shot 4b: named human approves; payout executes ----
await nav(BASE + '/console');
await waitFor(`document.querySelector('#pending').textContent.includes('pending approval')`, 'pending card (approve)');
const payoutId = await evaluate(
  `document.querySelector('#pending input').id.replace('approver-', '')`);
await evaluate(`document.querySelector('#approver-${payoutId}').value = 'Adrian Gibson'`);
await evaluate(`decide('${payoutId}', 'approve'); 'called'`);
let caught = false;
for (let i = 0; i < 40 && !caught; i++) {
  caught = await evaluate(
    `(document.querySelector('#msg-${payoutId}')?.textContent || '').includes('Approved and executed')`)
    .catch(() => false);
  if (!caught) await sleep(20);
}
await shot('08-console-approved.png');
console.log('approval banner caught in frame:', caught);
await sleep(900); // let refreshConsole settle

// ---- shots 4c/5: the log — three separate entries, chain verified ----
await nav(BASE + '/log');
await waitFor(`document.querySelectorAll('#rows tr').length >= 6`, 'six log rows');
await waitFor(`document.querySelector('#chain').textContent.includes('verified')`, 'chain verified (final)');
await shot('09-log-three-entries.png');
await shot('10-log-verified-full.png', true);

// ---- verification reads ----
const apiLog = await (await fetch(BASE + '/api/log')).json();
console.log('entries:', apiLog.entries.map((e) => `${e.seq}:${e.type}`).join(' '));
console.log('verification:', JSON.stringify(apiLog.verification), 'balance:', apiLog.balanceCents);

ws.close();
chrome.kill('SIGTERM');
console.log('DONE');
