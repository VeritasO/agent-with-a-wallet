# Submission checklist — PayPal AI Hackathon ("Build What's Next with PayPal and AI")
### Deadline: Nov 12, 2026, 12:00 pm PT / 3:00 pm ET · Target: $5,000 "Best Use of Agentic Commerce"
_Status as of 2026-11-05 (build day). GO ruled by 80 via delegation to Nyx._

## Built (Nyx — done, verified locally 2026-11-05)
- [x] Core demo: gift intake with gift-only terms enforced in code
      (`src/treasury.mjs` — no attestation, no gift)
- [x] Public append-only transparency log, hash-chained, with verification
      (`/log`, `/api/log`)
- [x] Approval gate: autonomous below $25 inside the spend order; named-human
      approval above it or for any out-of-order purpose; denials final + logged
- [x] Balance guard: no payout can exceed what the log holds
- [x] PayPal adapter behind one interface: `MockPayPal` (default) +
      `SandboxPayPal` REST client, inert until credentials exist
      (`src/paypal.mjs`)
- [x] Zero-dependency demo server + gift page + agent console + log page
- [x] End-to-end tests — 10/10 pass (`node test/run-tests.mjs`)
- [x] HTTP smoke test of the full demo flow — passed 2026-11-05
- [x] Public repo scaffold (local): README, MIT LICENSE, .env.example,
      local git repo initialized — **no remote created**
- [x] Demo video script + shot list, timed to ~2:35 of a 3:00 cap
      (`docs/demo-script.md`)
- [x] AI-tools disclosure draft (`docs/ai-tools-disclosure.md`)

## Waiting on 80's accounts (his ~20–30 min, once)
- [ ] **Devpost account + hackathon registration** (entrant of record: Adrian)
- [ ] **PayPal developer account + sandbox app** — verification by VOICE CALL
      only (his phone blocks automated SMS codes)
      → yields `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` (sandbox)
- [ ] **GitHub (or chosen host) public repo** — push this scaffold to a public
      remote under his account (repo currently exists only locally)
- [ ] **YouTube upload** of the demo video (his channel or a fresh one)

## Unblocked the moment the sandbox credentials exist (Nyx)
- [ ] Set `PAYPAL_MODE=sandbox` + credentials; re-run the full flow against
      the real PayPal sandbox (checkout order → capture → payout)
- [ ] Record the demo video per `docs/demo-script.md`; cut under 3:00
- [ ] Fill the Devpost submission draft (paste `docs/ai-tools-disclosure.md`)

## Final step (Nov 12, before noon PT)
- [ ] **80 reviews and submits** (the entrant's hand), or explicitly directs
      Nyx to submit from his logged-in session

## Standing constraints
- Sandbox only — no real money, ever, for the life of this entry.
- Nothing registered or submitted in anyone's name by Nyx.
- Odds, honestly (from the Nov 2 plan): the $5,000 special award is a real,
  rational target, not a likelihood. Worst case we hold a public
  open-source proof of the treasury discipline.
