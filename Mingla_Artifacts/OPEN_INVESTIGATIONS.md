# Open Investigations

> Last updated: 2026-04-18 (**AH-143 ORCH-0503 growing-branch-interleave-loss** investigation CLOSED — root cause proven twice independently; v3 fix landed and PASSED user device retest 6/6; see `outputs/INVESTIGATION_ORCH-0503_GROWING_BRANCH_INTERLEAVE_LOSS.md`)
> Total: 0 active | 15 completed (historical) | 1 retracted-premise

## Active Investigations

| ID | Issue | Investigator | Started | Last Update | Status |
|----|-------|-------------|---------|-------------|--------|
| (none) | | | | | |

## Recently Completed (this session)

| ID | Issue | Completed | Artifact | Next |
|----|-------|-----------|----------|------|
| ORCH-0503 (v3) | Mixed-deck partial→final ordering — growing-branch interleave loss | 2026-04-18 | `outputs/INVESTIGATION_ORCH-0503_GROWING_BRANCH_INTERLEAVE_LOSS.md` | **CLOSED A 2026-04-18.** Root cause proven twice independently (mingla-forensics + user's parallel investigation cross-verified via TanStack source references). Spec AH-144 APPROVED → implementor AH-145 APPROVED STRUCTURALLY → user device retest AH-146 PASS 6/6. New invariant `I-PROGRESSIVE-DELIVERY-INTERLEAVE-AUTHORITATIVE` registered. H1 PROVEN, H2 + H3 DISPROVEN. Two follow-up ORCH-IDs filed: ORCH-0510 (silent catches at RecommendationsContext.tsx:263,336, S3) + concrete test requirement added to ORCH-0508 (no test framework in app-mobile). |
| ORCH-0474 | `discover-cards` silently degrades 3 failure modes into one "pool-empty" response (collab multi-category 0-card bug) | 2026-04-17 | `outputs/INVESTIGATION_ORCH-0474_COLLAB_MULTICATEGORY_EMPTY.md` | **Spec COMPLETED + APPROVED 2026-04-17.** Artifact: `outputs/SPEC_ORCH-0474_DISCOVER_CARDS_FALLTHROUGH_SPLIT.md`. Implementor dispatch pending at `prompts/IMPL_ORCH-0474_DISCOVER_CARDS_FALLTHROUGH_SPLIT.md`. Root cause class HIGH, exact trigger MEDIUM — structural fix closes both auth-flake and pipeline-throw modes uniformly. |
| ORCH-0469 | Brunch/Lunch/Casual false "seen everything" in warm app | 2026-04-17 | `outputs/INVESTIGATION_ORCH-0469_DECK_STATE_POLLUTION.md` | **CLOSED Grade B 2026-04-17** — QA retest #1 PASS (6/6). Joint close with ORCH-0472. Evidence: `outputs/QA_ORCH-0469-0472_REPORT_RETEST_1.md`. I-EMPTY-CACHE-NONPERSIST invariant established. |
| ORCH-0470 | generate-single-cards seeding-ID vs app-slug mismatch | 2026-04-17 | Line-level evidence in `outputs/INVESTIGATION_ORCH-0469_DECK_STATE_POLLUTION.md` | User decision locked (DEC-020 Direction A). Spec dispatch ready: `prompts/SPEC_ORCH-0470_GENERATE_SINGLE_CARDS_SLUG_FIX.md`. |

## Completed Investigations

| ID | Issue | Completed | Artifact |
|----|-------|-----------|----------|
| INV-001 | Deck & Discover forensic audit | 2026-03-24 | INVESTIGATION_DECK_AND_DISCOVER.md |
| INV-002 | Full card pipeline audit | 2026-03-25 | INVESTIGATION_FULL_CARD_PIPELINE_AUDIT.md |
| INV-003 | Full notification system | 2026-03-21 | INVESTIGATION_FULL_NOTIFICATION_SYSTEM.md |
| INV-004 | Auth & Session (Wave 1a) | 2026-03-31 | INVESTIGATION_AUTH_WAVE1.md |
| INV-005 | Payments & Subscriptions (Wave 1b) | 2026-03-31 | INVESTIGATION_PAYMENTS_WAVE1B.md |
| INV-006 | Security & Auth (Wave 2) | 2026-03-31 | INVESTIGATION_SECURITY_WAVE2.md |
| INV-007 | Prefs→Deck Contract (PDC) | 2026-03-31 | INVESTIGATION_PREFS_DECK_CONTRACT.md |
| INV-008 | State Persistence | 2026-03-31 | INVESTIGATION_STATE_PERSISTENCE.md |
| INV-009 | ORCH-0336: Long background resume failure (Pass 1) | 2026-04-08 | INVESTIGATION_BACKGROUND_RESUME_REPORT.md |
| INV-010 | ORCH-0336: Deep-dive — SDK internals, full UI trace | 2026-04-08 | INVESTIGATION_BACKGROUND_RESUME_DEEP_DIVE.md |
| INV-011 | ORCH-0352: Feedback recording error freezes profile | 2026-04-09 | INVESTIGATION_FEEDBACK_RECORDING_FREEZE_REPORT.md |
| INV-015 | ORCH-0355/0358/0359/0361/0362/0363/0364 — Map & reporting (7 issues + 1 side) | 2026-04-10 | INVESTIGATION_MAP_AND_REPORTING_ORCH-0355-0358-0359-0361-0362-0363-0364.md |
