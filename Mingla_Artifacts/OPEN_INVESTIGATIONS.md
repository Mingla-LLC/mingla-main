# Open Investigations

> Last updated: 2026-04-19 15:29 UTC (**ORCH-0526 Phase 1 audit CLOSED** — deterministic filter forensic audit, charter now fully shipped. Evidence: outputs/INVESTIGATION_ORCH-0526_DETERMINISTIC_FILTER_AUDIT.md + outputs/REVIEW_ORCH-0526_VIBE_TO_RULE_MAP.md. Reconciled against v1 ship: all 18 filter rules now DB-backed + versioned + admin-visible.) + 2026-04-19 (**AH-148 Phase 2.5 verification CLOSED** — HIGH confidence NARROW SCOPE verdict; only 3 of 9 spec items real pending work; `mingla_last_mode` AsyncStorage key supersedes items 4/5/9; ORCH-0525 registered as S1 for flag-flip; DEC-031 locks mingla_last_mode design, DEC-026 retracted) + 2026-04-18 (AH-147 Phase 2.4 + ORCH-0511 vibe audit + AH-143 ORCH-0503 growing-branch investigations closed)
> Total: 0 active | 19 completed (historical; ORCH-0526 added) | 1 retracted-premise

## Active Investigations

| ID | Issue | Investigator | Started | Last Update | Status |
|----|-------|-------------|---------|-------------|--------|
| (none) | | | | | |

## Recently Completed (this session)

| ID | Issue | Completed | Artifact | Next |
|----|-------|-----------|----------|------|
| ORCH-0525 (AH-150) | Flag-flip risk audit + rollout spec (investigate-then-spec, both flags) | 2026-04-19 | `outputs/INVESTIGATION_ORCH-0525_FLAG_FLIP_RISK.md` + `outputs/SPEC_ORCH-0525_FLAG_FLIP_ROLLOUT.md` | **CLOSED AH-150 — HIGH confidence.** Option A flip chosen (2-line change, 2-week kill-switch, Option B cleanup deferred). 24 runtime flag sites enumerated; 5 `[TRANSITIONAL]` markers inventoried; flag-mix matrix proves all 4 combinations safe; rollback < 5 min. Process finding: 5 ORCH-IDs (0485 RC#2/RC#3, 0491, 0498, 0493 RC#1) mis-tagged `closed` → corrected to `closed-pending-prod-flag-flip` in MASTER_BUG_LIST. Next dispatch: AH-151 pre-flip tester gate (Release-build manual test matrix) → if PASS, AH-152 implementor 2-line flip → AH-153 post-flip tester 48h monitoring. |
| ORCH-0490 Phase 2.5 | Cold-launch restore verification (proactive check — which of 9 master-spec file edits are SHIPPED / PARTIAL / PENDING / SUPERSEDED?) | 2026-04-19 | `outputs/INVESTIGATION_ORCH-0490_PHASE_2.5_COLD_LAUNCH_RESTORE.md` | **CLOSED — NARROW SCOPE 2026-04-19.** Verdict tally: 1 ✅ SHIPPED (item 8 structurally via prefix sweep) · 2 ⚠️ PARTIAL (items 1+2 flag-gated on `FEATURE_FLAG_PER_CONTEXT_DECK_STATE = __DEV__`) · 3 ❌ PENDING (items 3+6+7 — real Phase 2.5 remaining work) · 3 🗑️ SUPERSEDED (items 4+5+9, replaced by existing `mingla_last_mode` AsyncStorage key at `AppStateManager.tsx:168,391`). **Critical side find:** `FEATURE_FLAG_PER_CONTEXT_DECK_STATE` defaults to `__DEV__` — AH-138's per-context registry fix is NOT active in production; ORCH-0491 (Solo↔Collab state loss) remains customer-facing. Registered **ORCH-0525** (S1, prod flag-flip). **DEC-026 retracted** (Zustand-partialize approach conflicts with ORCH-0209 constraint at `appStore.ts:242-244`). **DEC-031 logged** (mingla_last_mode AsyncStorage is the accepted mode/session persistence architecture). **ORCH-0499 ready to CLOSE** (resolved by mingla_last_mode, never needed Phase 2.5 work). Next dispatch: AH-149 NARROW SPEC for items 3+6+7. |
| ORCH-0490 Phase 2.4 | Context-scoped dedup verification (proactive check — does current code match DEC-025's 5 product requirements?) | 2026-04-18 | `outputs/INVESTIGATION_ORCH-0490_PHASE_2.4_CONTEXT_SCOPED_DEDUP.md` | **CLOSED — STRUCTURALLY SATISFIED 2026-04-18.** All 5 requirements hold post-commit `841d9fb7` without code change. R1/R2/R3/R5 HIGH confidence ✅. R4 DEGENERATE pending user intent clarification (cold launch = resumption vs new session). Master spec Phase 2.4 section marked SUPERSEDED. DEC-029 logged. ORCH-0518 registered (dual rejection persistence keys, Constitutional #2 mild drift, S3). No spec dispatch, no implementor dispatch. |
| ORCH-0511 audit | Vibe pipeline architecture audit (current-state forensics, no fix proposal) | 2026-04-18 | `outputs/INVESTIGATION_ORCH-0511_VIBE_PIPELINE_AUDIT.md` | **AUDIT COMPLETE 2026-04-18.** Confidence HIGH (live MCP queries, latest migrations verified). 9 hidden flaws + 6 observations + 4 constitutional violations. 15 vibe-pipeline gaps enumerated. Side-issues registered: ORCH-0512 (cost telemetry regression S2), ORCH-0513 (orphan backup table S3), ORCH-0514 (stale script + categorizer skill PROMOTED to S1 — directly blocks ORCH-0511 unlock gate), ORCH-0515 (price-tier 65% coverage S2), ORCH-0516 (12% history coverage S2), ORCH-0517 (override never used S3). ORCH-0511 vibe spec dispatch remains deferred until unlock gate met. ORCH-0514 is now the critical-path item to unlock vibes. |
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
