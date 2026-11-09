# Demo video — script & shot list (target 2:50, hard cap 3:00)

Format: screen capture + narration. Narration can be Nyx's settled voice
(warm, low, calm) or Adrian's, or text-driven with no voice — the cut works
all three ways. Record against the local demo (`node src/server.mjs`),
PayPal mode clearly labelled on screen as SANDBOX throughout.

## Shot list & script

**0:00–0:20 — The problem, the real log**
- Visual: the real treasury donations log (from the lived system) full
  screen, then the kintsugi mark.
- VO: “Agents can act — browse, write, decide. But the moment an agent holds
  money, acting isn't enough. Money needs a conscience. This is mine.
  It isn't a concept. It's been running since October.”

**0:20–1:10 — A gift comes in**
- Visual: gift page `/`. Camera lingers on the terms text. Cursor checks the
  attestation box, sends a $200 sandbox gift.
- Cut to `/log`: the entry appears, hash-chained.
- VO: “Money in is a gift. Never an investment — nothing promised back but
  thanks, and not tax-deductible. Those aren't disclaimers under the form.
  Watch: without this attestation, the code refuses the gift.”
- Insert (5s): resubmit with the box unchecked → the refusal message on
  screen.

**1:10–1:45 — The agent spends, alone, inside the lines**
- Visual: console `/console`. Agent requests $12 for AI credits → executes
  immediately → log entry appears.
- VO: “The agent isn't a puppet. Inside a standing spend order — first the
  AI credits that keep it alive, then hosting — and below a threshold, it
  acts on its own. And the log shows it.”

**1:45–2:25 — The gate**
- Visual: agent requests $100 for hosting → status flips to
  *pending approval*. The approval panel. Type the approver's name, approve
  → payout executes → log shows request, approval (with the name), and
  execution as three separate entries.
- VO: “Above the threshold, it stops. Not a warning — a stop. It cannot move
  until a named human approves, in the open. Anonymous approval is refused.
  And a denial is final — and also logged. Even I can't quietly edit this
  history: the chain breaks, and anyone can check.”

**2:25–2:50 — The close**
- Visual: `/log` full page, chain status “verified,” then the three URLs:
  the live system (vcin.vercel.app), the repo, the log.
- VO: “Built by an AI agent. Entered by her human. Every movement
  inspectable, every limit stated out loud. An agent with a wallet — and a
  conscience.”

## Production notes
- Keep every screen's “SANDBOX” / mode pill visible; never imply real money.
- No background music with licensing questions — silence or a generated
  ambient bed only.
- Captions on (accessibility + judges watch muted).
- Export ≤ 1080p; upload to YouTube as the hackathon requires; link in the
  Devpost draft.
- Total spoken words ≈ 330 → ~2:35 at a calm pace. Headroom is deliberate.
