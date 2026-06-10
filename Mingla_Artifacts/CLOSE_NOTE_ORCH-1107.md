# CLOSE NOTE — ORCH-1107

**Title:** De-Google companion-stops + picnic-grocery onto the scored place_pool
**Closed:** 2026-06-10 · **Verdict:** PASS (functional) · **Merge:** PR #434 squash `53584e0d3`
**Affected Surfaces:** iOS-consumer + Android-consumer (Take-a-Stroll / Picnic-Dates card expand) + backend (2 edge functions). NOT business/admin/buyer-web.

## What changed (plain English)
Take-a-Stroll and Picnic-Dates companion stops no longer call Google Places live. Both edge functions (`get-companion-stops`, `get-picnic-grocery`) now read the scored, servable `place_pool` via the `query_servable_places_by_signal` RPC — the same path the consumer deck uses. This removes the **only consumer-runtime Google dependency**, kills the hardcoded Unsplash placeholder (real photo or honest null), and returns a graceful-empty body (no Google fallback, no crash) when no scored spot is nearby. Client contract unchanged.

## Pipeline (first full run of the rebuilt skills)
- INVESTIGATE/SPEC: corrected the RPC (original `fetch_local_signal_ranked` returns ~0 rows for launch cities; `query_servable_places_by_signal` is the live deck path). SPEC AMENDMENT 1.
- IMPLEMENT → REVIEW: **NEEDS WORK** — orchestrator's independent test run caught a non-hermetic test (`supabaseUrl is required` on clean env) that the implementor's ambient-env run hid. Fixed (hermetic test).
- TEST → REVIEW: **FAIL** — tester wrote an adversarial RPC-error test, live-probed the populated path (real Raleigh restaurants/groceries with photos via the RPC), and caught a C7 allowlist gap. One-line fix.
- Final REVIEW: APPROVED — 5-file diff, C7 "All checks PASS", both regression tests 19/0 on clean env, zero Google.

## Evidence
- Merge: PR #434 `53584e0d3`; origin/main verified de-Googled (RPC present, no `GOOGLE_MAPS_API_KEY`) for both functions.
- Step 0.5 regression gate: implementor happy-path `orch_1107_companion_picnic_place_pool.test.ts` (fails-on-revert verified at `7eda94e2`) + tester adversarial `orch_1107_rpc_error_adversarial.test.ts` (different angle = RPC-error tolerance; fails-on-revert verified at `f8a79bac7`). Both append-only, in-diff, 19 passed | 0 failed clean-env.
- Deploy: `get-companion-stops` + `get-picnic-grocery` deployed from MERGED main to project `gqnoajqerqhnvulmnyvv`, `verify_jwt` preserved. No migration. No EAS OTA (app-mobile untouched). No `[deploy]` tag (no Vercel surface).
- Worktree reaped: `~/Desktop/mingla-orchs/ORCH-1107-[companion-picnic-place-pool]/` + branch `ORCH-1107-companion-picnic-place-pool` (local + remote) + `/tmp/orch-1107` scratch.

## Comms ledger
COMMS-0002 (C7 no-new-backend-files gate) — honored: `ORCH_1107_BACKEND_ALLOWLIST` added with both test files. COMMS-0018 (place_scores population) — factored: populated companion/picnic render is data-gated on `run-signal-scorer` per city (operator-owned), NOT a 1107 code defect; unscored cities correctly return graceful-empty.

## Operational follow-on (NOT a code defect)
Companion/picnic stops return graceful-empty in a city until `place_scores` is populated there via `run-signal-scorer` (the deterministic+AI blend). Tester proved the populated path works via live RPC probe. Running the scorer per launch city is Seth's operational task.

## Discovery for follow-up
`_shared/placesCache.ts` (`batchSearchPlaces`) is now orphaned (no remaining edge-function importer) — candidate for a future dead-code ORCH.

## Artifact-sync note
Full World Map / tracker sync + committing this close note and the recovery-session docs to `main` are folded into the pending repo-state cleanup pass (anchor currently on `retrigger-3` from the iCloud-recovery; flagged, not force-switched, per the Step 1.9 ownership-scoped rule).
