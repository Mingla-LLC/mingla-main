# ORCH-1120 — Close Status (PASS, merge HELD)

**ORCH-1120** [published-trip Settings → editable refund tiers + booking deadline + bookings-closed, sales-gated; single standard Save button]

## Verdict: PASS (device-verified 2026-06-12)

- **Device runtime proof (Seth, physical iPhone, clean dev-channel OTA group `26ae97b5`):** the Settings tab is editable with a SINGLE bottom Save button (no in-section save/reason control); real saves persist; the buyer-protection gate fires — favorable edits (higher refund %, later deadline) save, unfavorable edits (lower refund %, earlier deadline) are blocked with the "Refund first" dialog. This satisfies the prior CONDITIONAL-PASS condition (controls fire + persist).
- **Automated:** implementor happy-path regression (fails-on-revert `1b2e9a74a`; recompose marker test fails-on-revert `c219d012`); tester adversarial live-SQL gate proof on a local Postgres stack (11 spec scenarios + 12 edge cases). JS suite 27/27, strict-grep gate PASS.

## Production state
- Migration `20260929000000` (recomposed off the live-prod 1119-inclusive body) was applied to PROD (`gqnoajqerqhnvulmnyvv`) via the Management API on 2026-06-12 (CLI was drift-wedged). Live-function introspection confirms BOTH features coexist: 3 ORCH-1119 markers + day-media logic preserved AND ORCH-1120 refund/deadline handling + 3 gate reject reasons present (fn len 20630 → 27931).
- `schema_migrations` NOT yet stamped for `20260929000000` (function is live; bookkeeping reconciles at final CLOSE once history un-wedges).

## MERGE HOLD (do not merge until cleared)
- **Blocked on ORCH-1119 merging to origin/main.** 1119's migrations (`20260928000000/000001`) are PROD-APPLIED-BUT-UNMERGED; ORCH-1120's migration re-emits `biz_update_live_trip` with 1119's body grafted in, referencing `trip_days.media` columns that are NOT yet in git. Merging 1120 first would put a git function ahead of the schema that defines its columns. See **COMMS-0029**.
- **On 1119 merge:** rebase onto origin/main (incl. 1119), confirm the function body still matches, open PR, full pre-merge gate (all required checks green), merge, then run post-merge CLOSE (reap worktree, stamp schema_migrations, flip the 2 DRAFT invariants ACTIVE, sync 7 artifacts). NO new OTA needed for prod (the prod function is already live; app JS ships via the normal close OTA).

## Evidence
- `Mingla_Artifacts/specs/SPEC_ORCH-1120_TRIP_SETTINGS_REFUND_DEADLINE.md`
- `Mingla_Artifacts/reports/UI_UX_ORCH-1120_TRIP_SETTINGS_REFUND_DEADLINE_EDITABLE.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1120_TRIP_SETTINGS_REFUND_DEADLINE.md`
- `Mingla_Artifacts/reports/TEST_ORCH-1120_TRIP_SETTINGS_REFUND_DEADLINE.md`
- `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1120_TRIP_SETTINGS_REFUND_DEADLINE_READONLY.md`
- `Mingla_Artifacts/investigations/ENUMERATE_REFUND_BUYER_PROTECTION_RULES.md`
