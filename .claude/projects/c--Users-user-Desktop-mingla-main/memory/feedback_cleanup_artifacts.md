---
name: Clean up artifacts after each pass
description: Delete all PROMPT_, SPEC_, INVESTIGATION_, TEST_REPORT_, IMPLEMENTATION_, BUG_REPORT_ files from outputs/ after committing and locking in the README for each pass
type: feedback
---

After every pass commit + README lock-in, delete all working artifacts from `outputs/`:
- `PROMPT_*.md` (investigation, spec, implement, test, fix prompts)
- `SPEC_*.md` (spec documents)
- `INVESTIGATION_*.md` (investigation reports)
- `TEST_REPORT_*.md` (test reports)
- `IMPLEMENTATION_*.md` (implementation reports)
- `BUG_REPORT_*.md` (bug reports)

**Why:** These are pipeline artifacts — the results are captured in committed code, README, and tracker. Keeping them clutters the outputs/ directory and creates confusion about what's current.

**How to apply:** After the final commit of each pass (the README lock-in + tracker update commit), add a cleanup step: delete all artifact files for that pass, keep only `MASTER_BUG_LIST.md` and `LAUNCH_READINESS_TRACKER.md`.

**What to keep permanently:**
- `outputs/MASTER_BUG_LIST.md` — full bug inventory
- `outputs/LAUNCH_READINESS_TRACKER.md` — live status tracker
