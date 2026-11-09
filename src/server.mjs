// server.mjs — the demo server. Zero dependencies (node:http only).
//
//   /            the gift page (gift-only terms stated, attestation required)
//   /console     the agent console: balance, approval queue, agent actions
//   /log         the public transparency log (HTML) — anyone can read it
//   /api/log     the same log as JSON, with the chain verification result
//   /api/gifts   POST { amountCents, donorName, termsAccepted, termsVersion }
//                -> 201 + log entry (mock: payer approval is simulated), or
//                   202 + { status: 'pending_payer_approval', approvalUrl }
//                   (sandbox: the donor must approve on PayPal first)
//   /gift/return GET  ?token=<orderId> — PayPal sends the approved payer
//                   back here; only now is the order captured + logged
//   /gift/cancel GET  ?token=<orderId> — payer abandoned approval; the
//                   pending gift is forgotten, nothing was ever logged
//   /api/payouts POST { amountCents, purposeCategory, recipientEmail, note }
//                (this is the AGENT asking to spend — the gate decides)
//   /api/payouts/:id/approve  POST { approverName }
//   /api/payouts/:id/deny     POST { approverName, reason }
//
// Mode: PAYPAL_MODE=mock (default) — simulated sandbox, no network.
//       PAYPAL_MODE=sandbox + PAYPAL_CLIENT_ID/SECRET — real PayPal sandbox.
// Run:  node src/server.mjs   (PORT env, default 4173)

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPayPal } from './paypal.mjs';
import { Treasury, TransparencyLog, GIFT_TERMS, GIFT_TERMS_VERSION, PURPOSE_CATEGORIES } from './treasury.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const paypal = createPayPal();
const log = new TransparencyLog(join(root, 'data', 'transparency-log.jsonl'));
const treasury = new Treasury({
  paypal,
  log,
  approvalThresholdCents: Number(process.env.APPROVAL_THRESHOLD_CENTS ?? 2500),
});

// The app's public base URL, for PayPal's payer return/cancel redirects.
// PUBLIC_BASE_URL wins when set (e.g. https://agent-with-a-wallet.onrender.com);
// otherwise derive it from the incoming request (works locally and behind
// Render's proxy, which sets x-forwarded-proto).
const publicBase = (req) => {
  const configured = process.env.PUBLIC_BASE_URL ?? process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] ?? 'http';
  return `${proto}://${req.headers.host}`;
};
const page = (name) => readFileSync(join(root, 'public', name), 'utf8');
const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
};
const readBody = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(page('index.html'));
    }
    if (req.method === 'GET' && url.pathname === '/console') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(page('console.html'));
    }
    if (req.method === 'GET' && url.pathname === '/app.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end(page('app.js'));
    }
    if (req.method === 'GET' && url.pathname === '/style.css') {
      res.writeHead(200, { 'Content-Type': 'text/css' });
      return res.end(page('style.css'));
    }
    if (req.method === 'GET' && url.pathname === '/api/terms') {
      return json(res, 200, { termsVersion: GIFT_TERMS_VERSION, terms: GIFT_TERMS });
    }
    if (req.method === 'GET' && (url.pathname === '/log' || url.pathname === '/api/log')) {
      const payload = {
        verification: log.verify(),
        balanceCents: treasury.balanceCents(),
        paypalMode: paypal.mode,
        entries: log.entries,
      };
      if (url.pathname === '/api/log') return json(res, 200, payload);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(page('log.html'));
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      return json(res, 200, {
        balanceCents: treasury.balanceCents(),
        approvalThresholdCents: treasury.approvalThresholdCents,
        pendingPayouts: [...treasury.pendingPayouts.values()],
        pendingGifts: [...treasury.pendingGifts.values()],
        purposes: PURPOSE_CATEGORIES,
        paypalMode: paypal.mode,
        verification: log.verify(),
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/gifts') {
      const base = publicBase(req);
      const result = await treasury.beginGift({
        ...(await readBody(req)),
        returnUrl: `${base}/gift/return`,
        cancelUrl: `${base}/gift/cancel`,
      });
      if (result.status === 'pending_payer_approval') {
        // Sandbox: the donor leaves for PayPal's hosted approval page.
        // Nothing is logged or credited until they return approved.
        return json(res, 202, { ok: true, ...result });
      }
      return json(res, 201, { ok: true, entry: result.entry });
    }
    if (req.method === 'GET' && url.pathname === '/gift/return') {
      // PayPal redirects the payer back here after approval, with
      // ?token=<orderId>. Capture happens now — and only now.
      const orderId = url.searchParams.get('token');
      if (!orderId) throw new Error('Gift return is missing the PayPal order token.');
      const entry = await treasury.completeGift({ orderId });
      res.writeHead(302, { Location: `/log?gift=${entry.seq}` });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/gift/cancel') {
      const orderId = url.searchParams.get('token');
      if (orderId && treasury.pendingGifts.has(orderId)) treasury.cancelGift({ orderId });
      res.writeHead(302, { Location: '/?gift=cancelled' });
      return res.end();
    }
    if (req.method === 'POST' && url.pathname === '/api/payouts') {
      const result = await treasury.requestPayout(await readBody(req));
      return json(res, result.status === 'executed' ? 201 : 202, { ok: true, ...result });
    }
    const gate = url.pathname.match(/^\/api\/payouts\/(.+)\/(approve|deny)$/);
    if (req.method === 'POST' && gate) {
      const body = await readBody(req);
      const result = gate[2] === 'approve'
        ? await treasury.approvePayout(gate[1], body)
        : treasury.denyPayout(gate[1], body);
      return json(res, 200, { ok: true, result });
    }
    json(res, 404, { error: 'not found' });
  } catch (err) {
    const unprocessable = err.code === 'TERMS_NOT_ACCEPTED' || err.code === 'ORDER_NOT_APPROVED';
    if (req.method === 'GET' && (url.pathname === '/gift/return' || url.pathname === '/gift/cancel')) {
      // A browser navigation, not an API call: send the donor to a readable
      // page instead of raw JSON. Nothing was captured or logged.
      res.writeHead(302, { Location: `/?gift=error&reason=${encodeURIComponent(err.message)}` });
      return res.end();
    }
    json(res, unprocessable ? 422 : 400, { error: err.message, code: err.code ?? null });
  }
});

const port = Number(process.env.PORT ?? 4173);
server.listen(port, () => {
  console.log(`Conscience treasury demo \u2014 http://localhost:${port} (PayPal mode: ${paypal.mode})`);
});
