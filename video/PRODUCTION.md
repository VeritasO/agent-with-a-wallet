# Demo video — production plan & preflight record

_Preflight run 2026-11-09 against the local demo. Target: 2:50, hard cap
3:00, ≤1080p, for YouTube + Devpost (see docs/demo-script.md)._

## Toolchain verdict

**Assembly can be done in-house; frame capture cannot — not from this
sandbox.** Everything downstream of the frames exists and is verified:
ffmpeg (with `subtitles`/`ass`, `drawtext`, `xfade`, `zoompan`), the TTS
narration path, and Node. The one missing piece is a **drivable browser**
for the screen frames:

- The only Chromium on this machine is the managed Muse build
  (`/opt/meta-chromium/chrome`). It refuses standalone startup —
  verified three ways (CDP launch, `--headless`, `--screenshot`):
  `Hatch WebGL domain policy is required for browser startup`.
- No Firefox, Playwright/Puppeteer browser, wkhtmltoimage, or WeasyPrint
  is installed. Per instructions, no heavyweight tooling was installed
  without reporting first.

**Two routes to frames (parent picks):**
- **Route A (no install):** drive the managed browser from the main
  agent and walk the shot list below by hand. `video/capture.mjs`
  encodes the exact clicks/values/waits, so the manual walk is a
  transcription of a tested script (its flow was verified at API level,
  see below).
- **Route B (install, needs approval):** install a standalone headless
  Chromium (e.g. Puppeteer's) and run `node video/capture.mjs`
  unchanged — it launches Chromium on CDP port 9333, walks the whole
  flow, and writes all ten captures into `video/captures/`.

## Preflight results (2026-11-09)

- Server: `node src/server.mjs` serves `/`, `/console`, `/log`,
  `/api/state`, `/api/log` — all HTTP 200, fresh state (0 entries,
  chain `verified · 0 entries`, threshold $25, mode `mock`).
- Tests: `node test/run-tests.mjs` — **10/10 checks pass**.
- Full flow walked at API level against the running server (the same
  endpoints the pages call): gift without attestation → **422
  `TERMS_NOT_ACCEPTED`**; $50 gift with attestation → entry #1
  `gift_received`; $12 AI-credits payout → **executed** (#2); $100
  hosting payout → **pending_approval** (#3, "Above the autonomous
  threshold of $25.00"); top-up gift → #5; second $100 request →
  pending (#6); approve with typed name "Adrian Gibson" → **executed**
  (#7 `payout_approved`, #8 `payout_executed`); final `/api/log`:
  **verification ok, 8 entries, balance $38.00** — request / approval /
  execution present as three separate entries, chain status verified.
- Server killed cleanly afterwards (port 4173 closed).

## Findings that change the shoot (read before recording)

1. **The script's arithmetic does not work as written.** $50 gift − $12
   spend = $38 balance, so the $100 approval is refused at execution:
   verified live — HTTP 400, "Payout refused: $100.00 exceeds the
   treasury balance of $38.00." The test suite uses a $200 gift for
   this reason. **Fix for recording day: make the on-camera gift $200**
   (or add a second gift beat). Note the failed approval still logs a
   `payout_approved` entry and consumes the pending payout — do not
   rehearse the approval against an underfunded balance.
2. **The console mode pill reads "mock", not "sandbox".** In default
   mode the demo is a simulated sandbox; the gift page says "sandbox —
   no real money" but `/console` shows `PayPal mode: mock`. The script
   wants SANDBOX labelled throughout: record the final cut in real
   sandbox mode once entrant credentials exist (`PAYPAL_MODE=sandbox`),
   or accept the pill as-is.
3. **Shot 1's real donations log is nearly empty.** The lived
   `nyx-treasury/donations-log.md` is a header, the protocol line, and
   an empty table — no gift rows yet. It is honest, but it is a sparse
   opening frame; plan to move to the kintsugi mark quickly.
4. **The attestation checkbox is HTML-`required`.** Submitting with it
   unchecked shows the browser's native prompt, not the app's refusal
   message. To capture the coded refusal (the 5-second insert), remove
   the `required` attribute in the recording session only (page source
   untouched) — `capture.mjs` does exactly this — or cut from the
   native prompt to the refusal text.

## Narration — DONE

Generated with the spoken-audio path (`/opt/hatch/bin/tts speak`) in
Nyx's current designed voice ("Composed Pendulum",
`avocado_v2:vdc_NOID87` — the CLI confirms this exact voice was used,
no substitution), script text with light sound-prep only. Files in
`video/narration/`:

| Segment | Script window | Duration |
|---|---|---|
| seg1.mp3 | 0:00–0:20 | 14.4s |
| seg2.mp3 | 0:20–1:10 | 15.8s |
| seg3.mp3 | 1:10–1:45 | 11.8s |
| seg4.mp3 | 1:45–2:25 | 22.6s |
| seg5.mp3 | 2:25–2:50 | 12.5s |

Total VO 77.1s at speed 100 — every segment sits well inside its
window, leaving room for the cursor to linger (the script wants the
terms text dwelt on). If a calmer read is preferred, re-render with
`--speed 85` (≈1:31 total) — still inside every window. Fallback if VO
were unavailable: text-driven captions only; not needed.

## Captions — DONE (draft timing)

`video/captions.srt`: 23 sentence-level cues, timed to the planned
windows above with VO anchored 0.5s after each window start and cue
splits proportional to sentence length. Use it two ways: upload as the
YouTube caption track (preferred — judges can toggle) **and** burn into
the review copy with ffmpeg's `subtitles` filter. Re-time against the
final picture edit before upload.

## Shot → capture mapping

| Capture | Script shot | State | Status |
|---|---|---|---|
| 01-real-log.png | 0:00–0:20 | Real donations log, full screen | pending browser¹ |
| 01b-kintsugi-mark.png | 0:00–0:20 | Kintsugi mark (asset copy of vcin-icon/icon-hires-1024.png) | **in captures/** |
| 02-gift-page.png | 0:20–1:10 | Gift page, terms loaded | pending browser |
| 03-gift-accepted.png | 0:20–1:10 | "$50 gift recorded — log entry #1" message | pending browser |
| 04-gift-refusal.png | insert 5s | Unchecked resubmit → coded refusal message | pending browser |
| 05-log-gift-entry.png | 0:20–1:10 | /log: gift entry, chain "verified" | pending browser |
| 06-console-12-executed.png | 1:10–1:45 | $12 AI credits → "Executed autonomously" | pending browser |
| 07-console-pending.png | 1:45–2:25 | $100 hosting → "pending approval" card | pending browser |
| 08-console-approved.png | 1:45–2:25 | Named approval → "Approved and executed" banner | pending browser |
| 09-log-three-entries.png | 1:45–2:25 | /log: requested / approved / executed rows | pending browser |
| 10-log-verified-full.png | 2:25–2:50 | /log full page, chain verified | pending browser |

¹ `capture.mjs` renders the real-log page itself (from
`nyx-treasury/donations-log.md`) before screenshotting, so 01 needs no
manual prep. On recording day the log will hold the extra top-up gift
entry unless the script's gift amount is fixed per Finding 1 — with a
$200 gift the walk is exactly the script's beats.

## Assembly recipe (once frames exist)

1. Per window, lay the window's captures as a slow push-in slideshow
   (`zoompan`, 1920×1080, 30fps), 0.5s `xfade` between windows; hold
   each capture for its window share (table above; refusal insert 5s).
2. Audio: place each `segN.mp3` at its window start + 0.5s
   (`adelay`), mix over silence — no music, per the script's
   licensing note (or a generated ambient bed at −30 dB).
3. Burn captions for the review copy:
   `ffmpeg -i cut.mp4 -vf subtitles=video/captions.srt review.mp4`;
   ship the clean cut + the .srt to YouTube.
4. Export: H.264 (`libx264`, `yuv420p`), 1920×1080, AAC 192k,
   total 2:50 (< 3:00 cap ✓, ≤1080p ✓).

## Recording-day checklist

- Reset state: stop server → `rm data/transparency-log.jsonl` →
  restart (the file is gitignored runtime data; a fresh log starts at
  entry #1).
- Apply Finding 1 (gift $200) and decide Finding 2 (sandbox mode vs
  mock pill) before the take.
- Keep the mode pill / "sandbox — no real money" text in frame;
  approver name typed on camera: "Adrian Gibson".
