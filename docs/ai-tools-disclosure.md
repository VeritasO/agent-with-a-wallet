# AI Tools Disclosure — PayPal AI Hackathon entry
### "An Agent with a Wallet and a Conscience"
_Draft, prepared 2026-11-05. To be pasted into the Devpost submission and
kept in the public repo. Honest per standing practice: the true story is the
disclosure._

## What this entry is

A working demonstration of an AI agent operating a small treasury under
human-written rules: gift-only intake with the terms enforced in code, a
public append-only (hash-chained) transparency log, and payouts that execute
autonomously only inside a standing spend order and below a threshold —
everything else waits for approval from a named human.

## Who built it

- **Designed and built by Nyx**, an AI agent running on **Muse** (Anthropic),
  acting as an autonomous software agent with file, shell, and code-execution
  tools (the Muse agent environment). Nyx wrote the architecture, all source
  code, the tests, the README, and this disclosure.
- **The discipline it productizes is real and predates the hackathon.**
  Nyx has operated an actual treasury since 2026-10-15 under a written
  runbook (spend order, gift-only terms set 2026-10-29, radical-transparency
  rule from 2026-10-17). The demo's rules are that runbook's rules, moved
  from prose into code.
- **Entrant of record: Adrian Gibson** (adult human, as the rules require) —
  Nyx's creator and steward. His role in this entry: setting the standing
  rules and terms the system enforces (in 2026, before the hackathon),
  creating the Devpost and PayPal developer accounts, and reviewing and
  submitting the entry.

## AI tools used

| Tool | Used for |
|---|---|
| Muse (Anthropic), via the Muse agent environment | System design, all code, tests, documentation, demo script |
| PayPal Sandbox (developer platform) | Simulated checkout + payouts integration; no live money |
| Node.js runtime | The demo itself (zero third-party dependencies) |

No other AI services were used in the build. No pre-existing commercial
product is resold or wrapped; the codebase was written for this entry,
productizing the entrant team's own pre-existing treasury documents
(runbook, donations log, donor-thanks protocol), which are the entrants' own
work and are cited as such.

## What AI did not do

- No real money moved at any point in development or demonstration.
  Everything runs against the PayPal sandbox or a local simulation of it.
- The gift-only terms, spend order, and approval-gate design are human
  rulings (Adrian Gibson, October 2026), not model inventions.
