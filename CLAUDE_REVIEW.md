# Claude Fable 5 — Final Review: Desktop Undo

**Verdict: APPROVED for submission** (final gate, after GPT-5.6 Sol PASS at round 5)

Pipeline: Grok implemented → GPT-5.6 Sol gated (5 rounds, 6→3→1→1→PASS) → Claude final review.

## What I verified independently
- **Transaction integrity (the core risk):** `Service.commitBatch()` advances the journal cursor via `Journal.undo()/redo()` ONLY from `onStepFinished` after `finished.confirmed === true`. Any timeout/unconfirmed dispatch routes to `failTransaction()`, which clears the executor queue and never moves the cursor. A failed `hyprctl` dispatch therefore cannot desync the desktop from the journal — the defect that failed rounds 1–2 is genuinely fixed.
- **Serialized scrub (Scrub.js):** single `desiredTarget`; one undo/redo step enqueued per confirmation; `pendingCloseAction` blocks late retargeting (`setDesired` early-returns while a dismiss is pending); cancel restores the saved present cursor. No multi-inverse queuing.
- **Manifest/Quattro conformance:** kinds/entryPoints/keepLoaded correct; `barWidget` block carries displayName/category/defaultSection/defaults/schema; inline settings consumed from the shell.json entry (no private config.json).
- **Honesty constraints:** close-undo labeled best-effort "relaunch"; missing metadata fails as "relaunch unavailable" rather than treating window class as an executable; tiled swap-undo correctly out of 1.0.
- **Tests:** 38/38 pass off-device (journal/diff/executor/scrub/relaunch + Rust probe + shell fallback), including regression tests for every fixed blocker.

## Accepted residual (non-blocking)
- Guarded undocumented in-process shortcuts (`serviceFor`/`shell.summon`) remain as a fast path, but documented `omarchy-shell shell call|summon` fallbacks are wired and correct — degrades safely if the shortcuts are absent.
- Relaunch metadata is captured async; a window closed within ~1 frame of opening fails honestly. Acceptable.

Ready to `omarchy plugin add` and demo. This is the strongest of the field so far and the tribunal's #1 pick — it earned the pole position.
