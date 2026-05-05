# Signal Lab — INDEX

**Owner:** orchestrator (mirrors DECISION_LOG / INVARIANT_REGISTRY discipline)
**Established:** 2026-05-05 (post-ORCH-0713 Phase 0.5 calibration)
**Scope:** taxonomy authority for Mingla's signals + vibes + anti-signals — what's live, what's proposed, what's been calibrated, what's been rejected.

---

## When to read what

| Question | Read |
|---|---|
| "What signals are live right now? What are their cutoffs?" | [SIGNAL_TAXONOMY.md](SIGNAL_TAXONOMY.md) |
| "What's been proposed but not yet shipped?" | [PROPOSALS.md](PROPOSALS.md) |
| "What was rejected and why?" | [PROPOSALS.md](PROPOSALS.md) (filtered by status=`REJECTED`) |
| "When did we change the cutoff for signal X?" | [CALIBRATION_LOG.md](CALIBRATION_LOG.md) |
| "Why did we add `lgbtq_safe_space` instead of `inclusive_accessibility`?" | [PROPOSALS.md](PROPOSALS.md) decision rationale |

---

## What this folder is NOT

- **Not the implementation layer.** Actual signal config lives in DB rows: `signal_definitions` + `signal_definition_versions` + `place_pool.claude_signal_evaluations` JSONB.
- **Not the scoring rubric.** Rubric lives in [`run-place-intelligence-trial/index.ts`](../../supabase/functions/run-place-intelligence-trial/index.ts) `buildSystemPrompt`.
- **Not a duplicate of DECISION_LOG.** This folder REFERENCES DEC entries (DEC-098, DEC-099, DEC-100). When taxonomy decisions are codified architecturally, they go in DECISION_LOG; the human-readable taxonomy state goes here.
- **Not a duplicate of INVARIANT_REGISTRY.** Invariants like `I-CLAUDE-EVAL-RERANK-NOT-GATE` stay in INVARIANT_REGISTRY.md.

---

## Cross-references

- [`Mingla_Artifacts/DECISION_LOG.md`](../DECISION_LOG.md) — DEC-098 (3-phase ORCH-0713 architecture) · DEC-099 (drop photo_aesthetic + signal_anchors; JSONB column on place_pool)
- [`Mingla_Artifacts/INVARIANT_REGISTRY.md`](../INVARIANT_REGISTRY.md) — I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING · I-PHOTO-AESTHETIC-DATA-SOLE-OWNER · upcoming I-CLAUDE-EVAL-RERANK-NOT-GATE + I-CLAUDE-SIGNAL-EVAL-COLUMN-OWNERSHIP
- [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0713_PIPELINE_AUDIT.md`](../reports/INVESTIGATION_ORCH-0713_PIPELINE_AUDIT.md) — Phase 0 pipeline audit
- [`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0713_TRIAL_GAP_FILL_REPORT.md`](../reports/IMPLEMENTATION_ORCH-0713_TRIAL_GAP_FILL_REPORT.md) — Phase 0.5 calibration sprint
- Live trial table: `place_intelligence_trial_runs` (research-only per I-TRIAL-OUTPUT-NEVER-FEEDS-RANKING)
- Live signal definitions: `signal_definitions` + `signal_definition_versions` (run scorer reads from here)

---

## Convention

- All cutoffs are integers 0-100 matching the `score_0_to_100` rubric in the trial pipeline system prompt.
- All signal IDs are lowercase snake_case.
- Proposal IDs follow `PROP-{SIG|VIBE|ANTI}-{NNN}` format (zero-padded to 3 digits).
- Status enum: `DRAFT` · `UNDER_REVIEW` · `ACCEPTED-PHASE2` · `ACCEPTED-PHASE3` · `LIVE` · `REJECTED` · `DEFERRED`.
