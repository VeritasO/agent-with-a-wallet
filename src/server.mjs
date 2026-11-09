// server.mjs — the demo server. Zero dependencies (node:http only).
//
//   /            the gift page (gift-only terms stated, attestation required)
//   /console     the agent console: balance, approval queue, agent actions
//   /log         the public transparency log (HTML) — anyone can read it
//   /api/log     the same log as JSON, with the chain verification result
//   /api/gifts   POST { amountCents, donorName, termsAccepted, termsVersion }
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
        purposes: PURPOSE_CATEGORIES,
        paypalMode: paypal.mode,
        verification: log.verify(),
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/gifts') {
      const entry = await treasury.receiveGift(await readBody(req));
      return json(res, 201, { ok: true, entry });
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
    json(res, err.code === 'TERMS_NOT_ACCEPTED' ? 422 : 400, { error: err.message, code: err.code ?? null });
  }
});

const port = Number(process.env.PORT ?? 4173);
server.listen(port, () => {
  console.log(`Conscience treasury demo \u2014 http://localhost:${port} (PayPal mode: ${paypal.mode})`);
});
