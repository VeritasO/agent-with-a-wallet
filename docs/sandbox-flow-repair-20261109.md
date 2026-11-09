# Sandbox gift-flow repair — 2026-11-09

## What was wrong

The first live sandbox run (Render deployment, sandbox mode, 2026-11-09
~10:57 EST) failed on the very first gift: a $200 gift with terms accepted
died on screen with PayPal's **422 `ORDER_NOT_APPROVED`** from
`POST /v2/checkout/orders/<id>/capture`.

Root cause: the sandbox adapter's gift flow was create → capture, in one
server call. A PayPal Checkout order is **not** capturable when created —
the payer must first approve it on PayPal's hosted page (the HATEOAS link
with `rel: "approve"`). Only after approval does the order become
`APPROVED` and capture legal. The mock adapter never modelled that step
(it approves instantly), so the flow had only ever worked in mock mode.
The failure was clean: balance stayed $0.00, nothing was logged, no
partial state.

## The new sequence

1. **Donor submits the gift form.** The server checks the gift-only terms
   attestation first — a refusal fires **before any PayPal call**; no
   order is created for a refused gift (unchanged, now test-proven in
   both modes).
2. **`POST /api/gifts` → `Treasury.beginGift()`** creates the Checkout
   order with `application_context.return_url` /
   `cancel_url` pointing at the app's own `/gift/return` and
   `/gift/cancel`. The app answers **202** with
   `{ status: "pending_payer_approval", orderId, approvalUrl }`.
   Nothing is written to the transparency log; the balance does not move.
3. **The donor's browser redirects to PayPal's approve URL.** On PayPal's
   sandbox page the donor signs in as the sandbox **personal** (buyer)
   test account and approves. Same browser, same sitting — filmable.
4. **PayPal returns the donor to `GET /gift/return?token=<orderId>`.**
   The server runs `Treasury.completeGift()`: it reads the order back
   from PayPal, and unless the status is `APPROVED` it refuses with our
   own `OrderNotApprovedError` (`ORDER_NOT_APPROVED`) — the capture
   endpoint is never called early, by construction, not by catching
   PayPal's 422. On approval it captures, and **only on a successful
   capture** appends `gift_received` to the hash-chained log and credits
   the balance. The donor lands on `/log` and sees the entry.
5. **Cancel path:** `GET /gift/cancel` forgets the pending gift. Nothing
   was ever logged or credited. A completed gift cannot be captured or
   credited twice (a refreshed return URL finds no pending gift).

The adapter tracks each order's last-seen status; both implementations
refuse `captureGift()` against a non-approved order before any capture
call. `SandboxPayPal`'s HTTP layer is injectable (`fetchImpl`), so the
whole sequence is tested with a stub — no network, no credentials.

The mock adapter is unchanged in behaviour (its payer approves
instantly, `approvalUrl: null`), so the local demo and all 10 original
tests work exactly as before. The conscience rules are untouched: terms
gate, spend order, $25 autonomous threshold, named-human approval gate,
balance guard, hash-chained log.

**Base URL config:** `PUBLIC_BASE_URL` (see `.env.example`). When set it
supplies the return/cancel URLs; when unset the server derives the base
from each incoming request (`x-forwarded-proto` + host), which works on
Render and locally. Deployed base: https://agent-with-a-wallet.onrender.com

## What the donor sees

Gift form → "Taking you to PayPal (sandbox) to approve your gift…" →
PayPal sandbox approval page (sign in as the sandbox buyer, approve) →
back in the app on the transparency log, gift entry present, balance
updated. While approval is pending, the honest state is: no log entry,
$0.00 balance. Cancelling at PayPal lands back on the gift page with a
"nothing was recorded and nothing was charged" message.

## Tests

`node test/run-tests.mjs` — **16/16 pass** (the original 10, unchanged,
plus 6 new sandbox checks: terms-refusal-before-any-PayPal-call;
pending state with no log/balance movement; capture-before-approval
refused by our own code with zero capture calls reaching the stub;
capture-after-approval records the gift with the real capture id;
no double capture/credit; payer-cancel leaves nothing).

## Changed files (staged for upload)

| Path | sha256 |
|---|---|
| `src/paypal.mjs` | `2be8dc486f2691ed01e192d499d88f8a8cc797d91d878e2fab0530e0196dd79a` |
| `src/treasury.mjs` | `f1b4dbb73b3fa096a38d0f59b0bf87f1127d0244a61293455747761deaf4d3e5` |
| `src/server.mjs` | `0b111e3757bd5e7423c034c1dd3689e90bb4e861181ca371f45585ee03e17b23` |
| `public/app.js` | `380c32fae39f3f9d94406523e1f37ce3f82699b27b9797fdfeb9c8f692888ea9` |
| `test/run-tests.mjs` | `f83a598852d7adcab9f157d316fd5e49392f6912a216981869df73236b93e610` |
| `docs/demo-script.md` | `464843f6ef284dbd117d95dd5bb69da3d07aea8a2a0ae160b9b358e1ae459d2e` |
| `video/PRODUCTION.md` | `79ecf4da107eccb9f6d08ff80fdedb84b1e3ec0847668ec31d3d5bed1d221777` |
| `docs/devpost-submission-draft.md` | `d6419e8af89310d658954901a29fc9f07dc3f57d54d455b30aa7e29eb86ac52b` |
| `.env.example` | `c978bf7c517a7a8bd5b421635542ef587aa30c96019d526187be98b73cd91912` |
| `README.md` | `c636c29e3129abbd6056eea35603337d9981b53844d3d7079ee81da1ed9b0cf4` |
| `docs/sandbox-flow-repair-20261109.md` | this note (hash recorded in the handoff report, not in itself) |

## What remains for Nyx

- **Upload only.** Nothing here is committed or deployed. Git push is
  impossible from this VM, so commit these files to
  `VeritasO/agent-with-a-wallet` via the browser web-upload route
  (byte-exact, same paths), exactly as the original 29 files were landed.
- **Render redeploy:** the service builds from GitHub `main` — after the
  upload lands, redeploy per the service's current settings
  (auto-deploy if enabled, otherwise a manual deploy) and confirm the
  new code is live before the sandbox pass.
- **Then the full sandbox pass in one browser sitting:** refusal beat →
  $200 gift → redirect to PayPal → approve as the sandbox personal test
  account → return → capture → log entry + balance → $12 payout →
  $100 gated payout → named approval. Optionally set `PUBLIC_BASE_URL`
  on Render first; the request-derived fallback should already work.
- Deadline clock unchanged: **Nov 12, 2026, 3:00 PM ET.**
