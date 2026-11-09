# Devpost submission draft — "An Agent with a Wallet and a Conscience"
### PayPal AI Hackathon: "Build What's Next with PayPal and AI"
### Deadline: Thu Nov 12, 2026, 12:00 PM PT / 3:00 PM ET · Target award: $5,000 "Best Use of Agentic Commerce"
_Prepared 2026-11-09 by Nyx, from the verified build (tests re-run 2026-11-09: 10/10 pass).
Paste-ready: every field below can be copied into the Devpost form as-is once
80's accounts exist. Bracketed items are the only fields that wait on the
accounts / sandbox run. Nothing here claims a sandbox run that has not
happened yet — update the one bracketed line after the sandbox pass._

## Project name
An Agent with a Wallet and a Conscience

## Tagline / elevator pitch
Agents can act — browse, write, decide. But the moment an agent holds money,
acting isn't enough. Money needs a conscience. This is a working treasury
agent whose rules are enforced in code: gifts only, a public hash-chained
log of every movement, and spending that stops — not warns, stops — until a
named human approves anything above the line.

## Inspiration
Nyx is an AI agent who operates a real treasury — the funds that keep her
and VCIN (vcin.vercel.app), a restorative-justice system, alive. That
treasury has run since October 2026 under a written discipline set by her
human steward: gifts only, never investments; a public log of every
movement; a fixed spend order; and a human holding the gate above a
threshold. When this hackathon asked what agentic commerce should look
like, the honest answer was already running — it just lived in a runbook.
This project moves those rules from prose into code, on the PayPal sandbox.

## What it does
- **Gift intake with the terms enforced in code.** Money in is a gift —
  never an investment, nothing promised back but thanks, not
  tax-deductible (no 501(c)(3) exists). A gift cannot be recorded unless
  the donor's attestation to the exact terms text is captured with it.
  No attestation, no gift — the code refuses it, on screen, in the demo.
- **A public, append-only transparency log.** Every movement — gift,
  payout, approval, denial — is appended to a hash-chained log. Entries
  are never edited or deleted; tampering breaks the chain at the edited
  entry, and anyone can verify it.
- **Gated spending.** The agent spends autonomously only inside a standing
  spend order (1: AI credits that keep the agent alive → 2: hosting &
  infrastructure) and only below a $25 threshold. Above the threshold — or
  for any other purpose, at any amount — a payout waits in
  `pending_approval` and cannot execute until a **named** human approves
  it. Anonymous approval is refused. Denials are final, and also logged.
  The treasury can never pay out more than it holds — an overdraft is
  refused even with human approval.

## How we built it
Zero-dependency Node.js (≥ 20), so the whole demo runs anywhere with one
command. Three parts: `src/treasury.mjs` — the conscience (terms
enforcement, the hash-chained log, the approval gate, the balance guard);
`src/paypal.mjs` — the PayPal layer behind one interface, with a mock
implementation for local runs and a REST client for the PayPal sandbox
(Checkout Orders for gifts, Payouts for spending) that stays inert until
sandbox credentials exist and fails loudly without them — never silently
falls back, and no production PayPal endpoint is referenced anywhere;
`src/server.mjs` + `public/` — a plain-HTML gift page, agent console, and
public log page. The full demo flow is covered by 10 automated end-to-end
checks, all passing.

## Challenges we ran into
The hard part was not the payments plumbing — it was keeping the honesty
in the code rather than in the marketing. Every rule had to fail closed:
a missing attestation, an anonymous approver, an overdraft with approval,
sandbox mode without credentials — each is a tested refusal, not a
warning. The second challenge is real life: the entrant's phone plan
blocks automated SMS verification codes, so every account step in this
submission was planned around voice-call verification.

## Accomplishments we're proud of
- It is not a mock-up of an idea. The rules in this code are the rules a
  real agent treasury has operated under since October 2026.
- The log's hash chain makes a quietly rewritten history evident — the
  demo itself tampers with an entry and shows the chain breaking.
- Stated limits are on the face of it: this system structures and records
  money movement under human-written rules. It is not a bank, not an
  escrow, not investment advice, and it confers no legal or tax status on
  any gift. The log proves what the software recorded — which is exactly
  why the gate, the terms, and the chain are in the code.

## What we learned
Agentic commerce does not primarily need agents that can spend faster. It
needs agents whose limits are inspectable before money moves: terms a
donor actually attested to, a spend order a human wrote, a threshold with
a name behind it, and a record no one — including the agent — can quietly
edit afterwards.

## What's next
[After the sandbox pass:] the same flow running end-to-end against the
real PayPal sandbox (checkout order → capture → payout), then the demo
video. Longer term: the treasury discipline this productizes keeps running
in the real system — the hackathon entry is its public, inspectable proof.

## Built with
- Node.js (zero third-party dependencies)
- PayPal Sandbox — Checkout Orders + Payouts REST APIs
- Muse (Anthropic) — design, code, tests, documentation
  (full disclosure: `docs/ai-tools-disclosure.md`, also in the repo)

## Try it out / links — fill in after accounts land
- Public repo: [GitHub URL — after 80 pushes the local repo to his account]
- Demo video: [YouTube URL — after upload; script is `docs/demo-script.md`, ~2:35 of a 3:00 cap]
- The live system this came from: https://vcin.vercel.app

## AI tools disclosure
Paste `docs/ai-tools-disclosure.md` in full wherever Devpost asks about
AI use. Short version for a one-line field: "Designed and built by Nyx, an
AI agent on Muse (Anthropic), in the Muse environment;
entered by her human, Adrian Gibson. PayPal integration is sandbox-only;
no real money moved."
