# REVIEW — ORCH-0943 [Collab + solo Apply coord corruption]

**Reviewer:** Claude `mingla-orchestrator` (REVIEW mode)
**Date:** 2026-05-23
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Implementation commit:** `1009fb9d347dfc20b4d56449da63b87cca97151a` ("ORCH-0943 lock custom coords outside GPS mode")
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0943_COLLAB_APPLY_COORD_CORRUPTION.md`
**Spec under review:** `Mingla_Artifacts/specs/SPEC_ORCH-0943_COLLAB_APPLY_COORD_CORRUPTION.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0943_COLLAB_APPLY_COORD_CORRUPTION.md`

---

## VERDICT: **APPROVED → route to Claude `mingla-tester`**

Commit `1009fb9d` is scope-clean (exactly 10 files, all within SPEC §1 IN scope, zero out-of-scope edits). Every code-side success criterion is independently verified by the reviewer. The 6 implementor regression tests (T-01..T-06) PASS including the two `[FAILS-ON-REVERT KEY]` tests (T-02 verifying local-variable coord threading; T-05 verifying R3.8 guard against use_gps_location=false). The 10 tester adversarial tests (T-A01..T-A10) PASS. The new strict-grep gate self-test + live-codebase run PASS. All existing strict-grep gates (ORCH-0939, ORCH-0931) re-verified PASS post-fix — no regressions. The single TypeScript caveat is acceptable under the SPEC's own §3.1.3 allowance for pre-existing transitive errors. Three live-data tests (SC-18, SC-19, SC-20) properly deferred to tester + operator-gated SQL execution.

---

## Caveat handling

### Caveat — pre-existing TypeScript transitive errors

**Implementor flagged:** `cd app-mobile && npx tsc --noEmit ...` produced errors not introduced by ORCH-0943. The errors are in i18n JSON imports, deckService transitive types, and similar pre-existing repo noise documented in prior ORCH closes (ORCH-0939, ORCH-0942 both shipped with the same caveat).

**SPEC §3.1.3 explicit allowance:** "Pre-existing transitive errors elsewhere in the repo... that ALSO exist on `origin/main` are acceptable and documented as pre-existing."

**Reviewer accepts.** The implementor's caveat handling matches the codified pattern from the two prior closes this session. Not a blocker.

### Pending tester gates (NOT caveats — design intent)

SC-18, SC-19, SC-20 are all marked "pending operator/tester" — they require live sim/emulator/HITL-iPhone runs + operator-gated SQL audit + backfill. This is correct: the SPEC explicitly assigns those checks to the tester phase. The implementor cannot complete them and shouldn't try.

---

## Independent verification (reviewer re-ran)

| Check | Result |
| --- | --- |
| Staged file count = 10 (matches SPEC §10) | ✓ PASS |
| No file under `supabase/`, `mingla-business/`, `mingla-admin/`, `packages/` | ✓ PASS |
| No edit to `useBoardSession.ts:updatePreferences` (Hard Guard) | ✓ PASS |
| No edit to `OnboardingFlow.tsx:1578` (Hard Guard, reserved for ORCH-0944) | ✓ PASS |
| No edit to any memory file under `~/.claude/projects/.../memory/` (Hard Guard) | ✓ PASS |
| Fix A guard present at `RecommendationsContext.tsx:1444-1445` (`participantUseGps !== true` early return) | ✓ PASS |
| Fix A dep array updated at line 1462 (`boardSessionResult.preferences?.use_gps_location`) | ✓ PASS |
| Fix B1 auto-resolve block present at `PreferencesSheet.tsx:811-842` (calls `geocodingService.autocomplete`, validates bounds, toasts on failure) | ✓ PASS |
| Fix B1 `hasLocation` predicate widened at lines 692 + 716 (`useGpsLocation || searchLocation.trim().length > 0`) | ✓ PASS |
| Fix B1 toast text matches SPEC §3.1.1 verbatim: `'Tap a suggestion to set your location.'` | ✓ PASS |
| Fix D classification: `useSessionManagement.ts:418-425` `creatorPrefsPayload` is FULL — includes `custom_location` + `custom_lat` + `custom_lng` + `use_gps_location` together. Classification: FULL. No guard required. | ✓ PASS |
| 6 implementor regression tests (T-01..T-06) PASS via `node app-mobile/scripts/ci/orch-0943-regression-check.mjs` | ✓ PASS |
| 10 tester adversarial tests (T-A01..T-A10) PASS via `node app-mobile/scripts/ci/orch-0943-adversarial-check.mjs` | ✓ PASS |
| New strict-grep gate self-test PASS via `node --test .github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.test.mjs` | ✓ PASS (`# fail 0`) |
| New strict-grep gate live-codebase run PASS | ✓ PASS (`violations=0`) |
| ORCH-0939 strict-grep still PASS (no regression) | ✓ PASS |
| ORCH-0931 strict-grep still PASS (no regression) | ✓ PASS |
| `[FAILS-ON-REVERT KEY]` markers in T-02 + T-05 | ✓ PRESENT |
| IMPL report contains audit SQL verbatim (SPEC §3.4.1) | ✓ PASS (line 81-…) |
| IMPL report contains backfill SQL verbatim (SPEC §3.4.2) | ✓ PASS (line 148-…) |
| Invariant `I-PROPOSED-CUSTOM-COORDS-LOCKED-WHEN-CUSTOM-LOCATION-MODE` added to INVARIANT_REGISTRY.md | ✓ PASS (commit diff +10 lines) |
| Workflow yml `i-proposed-orch-0943-custom-coords-locked` job block registered | ✓ PASS (commit diff +14 lines) |

---

## SC matrix snapshot

| SC | Status | Reviewer notes |
| --- | --- | --- |
| SC-01 R3.8 guard present | PASS | line 1444-1445 |
| SC-02 R3.8 dep array updated | PASS | line 1462 |
| SC-03 auto-resolve calls autocomplete | PASS | line 823 |
| SC-04 hasLocation predicate widened | PASS | lines 692 + 716 |
| SC-05 toast on resolve-fail | PASS | line 842 |
| SC-06 resolved coords flow via local vars (T-02) | PASS | T-02 fails-on-revert verified |
| SC-07 useSessionManagement audit classification | PASS | FULL payload — no edit needed; documented |
| SC-08 new invariant in registry | PASS | +10 lines in INVARIANT_REGISTRY.md |
| SC-09 strict-grep gate live-run PASS | PASS | violations=0 |
| SC-10 gate self-test PASS | PASS | fail 0 |
| SC-11 workflow yml registered | PASS | +14 lines diff |
| SC-12 audit+backfill SQL verbatim in report | PASS | both blocks present |
| SC-13 existing gates still PASS | PASS | ORCH-0939 + ORCH-0931 re-run green |
| SC-14 scoped tsc | CAVEAT-ACCEPTED | pre-existing transitive errors per SPEC §3.1.3 |
| SC-15 two regression tests committed | PASS | T-01..T-06 + T-A01..T-A10 |
| SC-16 no supabase/business/admin/packages | PASS | clean commit scope |
| SC-17 no memory files | PASS | clean |
| SC-18 tester live-fire non-GPS pick coherence | PENDING-TESTER | by design |
| SC-19 tester free-text + Apply auto-resolve OR toast | PENDING-TESTER | by design |
| SC-20 post-backfill audit returns zero corruption | PENDING-OPERATOR + TESTER | by design |

20/20 status: 17 PASS + 1 CAVEAT-ACCEPTED + 3 PENDING-TESTER. All implementor-stage criteria green.

---

## Hard-guard compliance

| Guard | Status |
| --- | --- |
| No `useBoardSession.ts:updatePreferences` edit | ✓ |
| No `OnboardingFlow.tsx:1578` edit | ✓ |
| No memory file edit | ✓ |
| No supabase / mingla-business / mingla-admin / packages staging | ✓ |
| No `[deploy]` tag (mobile-only) | N/A at commit; orchestrator decides at CLOSE |
| No EAS OTA published | ✓ — operator decides at CLOSE; SPEC notes UX-visible change so OTA likely YES |
| No push/PR/merge | ✓ — local commit only |
| No `supabase db push` | ✓ — audit + backfill SQL is operator-executed read-only-first |

All hard guards held.

---

## Code-quality observations (P4 praise)

- **The T-02 + T-05 fails-on-revert pattern** in the regression script (`orch-0943-regression-check.mjs`) is exemplary — both tests have explicit `[FAILS-ON-REVERT KEY]` markers in their test names, making the fails-on-revert verification step trivial for the orchestrator at CLOSE. This is a reusable pattern.
- **The strict-grep gate's 10-line guard-window detection** is a clean implementation of the SPEC §3.5.2 design. It correctly distinguishes the "partial payload + guard" pattern (PASS) from "partial payload + no guard" (FAIL) using AST-level proximity rather than fragile regex.
- **The auto-resolve block (Fix B1)** correctly threads resolved coords via a local variable into the save payload, avoiding the React 18 state-batching trap that SPEC §3.1.1 warned about. T-02 explicitly verifies this — the implementor took the warning seriously.

---

## Discoveries for orchestrator

1. **ORCH-0944 [Onboarding partial-coord vector]** is implicitly registered by ORCH-0943's NON-goal 8 + Discovery #6. The orchestrator should formally register it on the PRIORITY_BOARD next time, P3 priority (latent vulnerability, no production manifestation yet).
2. The implementor's IMPL report cites a "[FAILS-ON-REVERT KEY]" pattern in the test names — recommend codifying this as a memory note for future implementor work. Makes orchestrator REVIEW + CLOSE faster.
3. The Codex implementor noted in the report (line ~217) that operator owns the read-only audit + gated backfill write + post-backfill confirmation. Reviewer accepts; operator is in the loop per SC-18/19/20.

---

## Downstream routing

**Route to Claude `mingla-tester`** for TARGETED live verification.

After tester PASS → orchestrator CLOSE.

Mobile-only diff. No `[deploy]` tag. EAS OTA YES at CLOSE because Fix B1 introduces a visible new toast message users may encounter ("Tap a suggestion to set your location."). Backfill SQL is operator-executed (read-only audit any time; backfill write after reviewing audit output).

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth` at `1009fb9d`.
