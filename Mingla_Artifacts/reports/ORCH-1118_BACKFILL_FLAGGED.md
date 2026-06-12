# ORCH-1118 — Backfill flagged rows (manual review)

Generated: implementor DRY-RUN (gate logic verified via fixtures; live network run is OPERATOR-GATED) · mode=DRY-RUN

These trip rows had free-typed departure/destination text that did NOT pass
the confidence gate (ambiguous / low-confidence / no-match). Coordinates are
LEFT NULL. They display their text as before (no regression) and will be fixed
when the planner next re-edits the trip (now gated by the Mapbox picker).

## Status

The backfill script (`scripts/orch-1118-backfill-trip-coords.ts`) was
dry-run-validated by the implementor against fixtures — the confidence gate
(settlement feature_type + match_code exact/high + >25km tie-break) and the
idempotency skip are proven (9/9 in
`mingla-business/src/components/trip/__tests__/orch1118Backfill.dryrun.test.ts`).

The LIVE network dry-run (which reads the production rows and prints the actual
WOULD-WRITE vs FLAGGED split) requires `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, and `MAPBOX_ACCESS_TOKEN` — secrets not present in
the implementor session. The operator runs it (dry-run first, then `--live`),
and the script REWRITES this table with the real flagged rows.

Expected candidate rows at investigation time (F-5; all 5 have null coords):
`Raleigh, NC, USA` (draft), `Tulum, Quintana Roo, Mexico` (scheduled ×2),
`Washington DC, USA` (scheduled), `Brussels, Belgium` (draft) — all are real
city strings expected to PASS the gate, leaving few or zero flagged. The script
overwrites this file with the authoritative result on the operator's dry-run.

| event id | status | side | text | reason |
|----------|--------|------|------|--------|

_No flagged rows recorded yet — awaiting the operator's live dry-run._
