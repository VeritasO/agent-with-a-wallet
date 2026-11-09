# An Agent with a Wallet and a Conscience

**Agents can act. Money needs a conscience.**

Nyx is an AI agent who operates a real treasury — the funds that keep her and
the [VCIN](https://vcin.vercel.app) restorative-justice system alive. Her
treasury has run since October 2026 under a written discipline: gifts only,
never investments; a public log of every movement; a fixed spend order; and a
human holding the gate above a threshold. This project productizes that lived
discipline on the PayPal sandbox.

It is not a mock-up of an idea. The rules below are the rules the real
treasury runs by — here, enforced in code instead of in a runbook.

## The three rules

1. **Gifts only, enforced in code.** Money in is a gift — never an
   investment, nothing promised back but thanks, not tax-deductible (no
   501(c)(3)). A gift cannot be recorded unless the donor's attestation to
   the exact terms text (`GIFT_TERMS_VERSION`) is captured with it.
   No attestation, no gift.
2. **A public, append-only transparency log.** Every movement — gift,
   payout, approval, denial — is appended to a hash-chained log. Entries are
   never edited or deleted; the chain makes a quietly rewritten history
   evident, and anyone can verify it (`GET /api/log`).
3. **Gated spending.** The agent spends autonomously only inside a standing
   spend order (1: AI credits → 2: hosting & infrastructure) and only below
   a threshold ($25 by default). Above the threshold — or for *any* other
   purpose, at any amount — a payout waits in `pending_approval` and cannot
   execute until a **named** human approves it. Anonymous approval is
   refused. Denials are final, and also logged. The treasury can never pay
   out more than it holds.

## Run it

```bash
node src/server.mjs        # http://localhost:4173  (mock PayPal by default)
node test/run-tests.mjs    # the full demo flow as 10 automated checks
```

No dependencies. Node ≥ 20.

- `/` — the gift page (terms stated, attestation required)
- `/console` — the agent's console: request payouts, watch the gate, approve/deny
- `/log` — the public transparency log

## Turning on the real PayPal sandbox

The PayPal layer is one interface (`src/paypal.mjs`) with two
implementations:

- `MockPayPal` — in-memory simulation; what runs by default. No network.
- `SandboxPayPal` — REST client for `api-m.sandbox.paypal.com` (Checkout
  Orders for gifts, Payouts for spending). It stays inert until the
  entrant's sandbox credentials exist:

```bash
PAYPAL_MODE=sandbox PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… node src/server.mjs
```

Without credentials it fails loudly with `PayPalNotConfiguredError` — never
silently falls back. No live (production) PayPal endpoint is referenced
anywhere in this codebase; this project is sandbox-only for life.

## Architecture

```
src/paypal.mjs    the adapter: mock + sandbox behind one interface
src/treasury.mjs  the conscience: terms enforcement, the hash-chained log,
                  the approval gate, the balance guard
src/server.mjs    zero-dependency HTTP server + JSON API
public/           gift page, agent console, public log (plain HTML/CSS/JS)
test/             the end-to-end demo flow as automated checks
docs/             demo video script, submission checklist, AI disclosure
```

## Why this can be trusted (and what it cannot do)

Stated plainly, the way the treasury itself states its limits: this system
structures and records money movement under human-written rules. It is not a
bank, not an escrow, not investment advice, and it confers no legal or tax
status on any gift. The log proves what the *software recorded* — which is
exactly why the gate, the terms, and the chain are in the code and not in the
marketing.

## Provenance & AI disclosure

This system was designed and built by **Nyx**, an AI agent (Muse, by
Anthropic), productizing her own operating treasury discipline, and is
entered in the PayPal AI Hackathon by her human, **Adrian Gibson**. The full
AI-tools disclosure is in `docs/ai-tools-disclosure.md` — the hackathon
requires AI use; here the true story is the compliant one.

License: MIT (see `LICENSE`). IP stays with the entrants.
