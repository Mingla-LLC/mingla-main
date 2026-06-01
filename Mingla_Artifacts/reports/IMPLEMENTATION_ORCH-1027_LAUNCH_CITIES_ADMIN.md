# IMPLEMENTATION — ORCH-1027 [Launch Cities admin control]

**Skill:** mingla-implementor (Claude parity side).
**Date:** 2026-05-31.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1027-[launch-cities-admin]/` on branch `ORCH-1027-launch-cities-admin`.
**Inputs:** `SPEC_ORCH-1027_LAUNCH_CITIES_ADMIN.md` (§A–§C, SC-1..SC-13), `DESIGN_ORCH-1027_LAUNCH_CITIES_TAB.md` (all 9 states).
**Status:** implemented and verified (local gates green; DB push + edge deploy deferred to orchestrator CLOSE per autonomy posture).

---

## Comms ledger acks (on entry)

- **COMMS-0002** (WARN, ALL — strict-grep C7 blocks backend PRs): **ACKED + handled.** Added `ORCH_1027_BACKEND_ALLOWLIST` to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` listing the migration, the edge fn, and its Deno test, and wired it into the aggregated `ALLOWLIST` spread — in the SAME commit as the migration + edge fn.
- **COMMS-0003** (WARN, ALL — external-API docs cited inline): **ACKED + handled.** The only external-API touch is the admin boundary action, which reuses the existing `admin-seed-places {action:'geocode_city'}` edge call (Google Geocoding). Google Geocoding docs URLs are cited inline in `LaunchCitiesPage.jsx`'s `handleGeocode`. `check-launch-city` calls NO third-party API (pure DB read) — noted in its header comment.
- Other active rows (COMMS-0001/0004/0012/0013/0014/0015/0016) reviewed — none target ORCH-1027 or change this work.

---

## Live-DB pre-flight probe (read-only, per implementor protocol 9b)

Single read-only query via Supabase MCP `execute_sql` against `gqnoajqerqhnvulmnyvv`:
- `seeding_cities.is_live_for_consumers` does NOT exist yet (flag_exists=0) → `ADD COLUMN IF NOT EXISTS` is safe.
- 17 seeding cities (matches SPEC §0.1).
- `place_pool` has `is_servable`, `is_active`, `city_id` columns (RPC aggregation is valid).
- `admin_set_city_live` + `admin_launch_city_list` do NOT exist yet → `CREATE OR REPLACE` safe.
- `check_city_bbox_overlap` exists (overlap pre-check reuse valid).
The migration has NO `RAISE EXCEPTION` guards / backfills / destructive predicates — it only adds a column (default false), a partial index, and two RPCs. No remote-data abort risk.

---

## Files changed (commit hash: see git log on `ORCH-1027-launch-cities-admin`)

All changes landed in a single commit so the COMMS-0002 allowlist rides with the migration + edge fn.

### 1. `supabase/migrations/20260810000000_orch_1027_launch_cities.sql` (NEW)
**Before:** no consumer-launch flag; no launch-list / toggle RPCs.
**Now:** adds `seeding_cities.is_live_for_consumers boolean NOT NULL DEFAULT false` + column COMMENT documenting orthogonality to `status`; partial btree index `seeding_cities_live_for_consumers_idx ... WHERE is_live_for_consumers`; `admin_launch_city_list()` (SECURITY DEFINER, STABLE, EXECUTE granted to `authenticated` only, REVOKED from PUBLIC/anon) returning the launch-tab columns incl. `has_bbox` + servable/active counts from a `LEFT JOIN place_pool`; `admin_set_city_live(p_city_id uuid, p_live boolean)` (SECURITY INVOKER — gated by the existing `admin_write_seeding_cities` RLS WITH CHECK) writing ONLY the flag + `updated_at`.
**Why:** SC-1, SC-2, SC-3, SC-4; I-LC-STATUS-ORTHOGONAL, I-LC-DEFAULT-FALSE. `admin_city_picker_data` left UNTOUCHED (DEC-LC-1).
**Lines:** ~110.

### 2. `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (MODIFIED)
**Before:** C7 `no-new-backend-files` had no ORCH-1027 allowlist → would block the PR.
**Now:** added `ORCH_1027_BACKEND_ALLOWLIST` (migration + edge fn index.ts + edge fn test) and spread it into the aggregated `ALLOWLIST`.
**Why:** SC-13, COMMS-0002, I-COMMS-0002-BACKEND-ALLOWLIST.
**Lines:** ~14.

### 3. `supabase/functions/check-launch-city/index.ts` (NEW)
**Before:** did not exist.
**Now:** public POST edge fn. OPTIONS→CORS; non-POST→405 `{error:"Method not allowed"}`; invalid/malformed/out-of-range lat/lng→400 `{error:"lat and lng are required finite numbers in range"}`; reads the live subset via the service-role client (`SELECT id,name,center_lat,center_lng,bbox_* FROM seeding_cities WHERE is_live_for_consumers=true ORDER BY name`); computes `inLaunchCity` + nearest-center `matchedCity` + full `liveCities` in TS (Option 1, SPEC §C.5); DB/unexpected error→500 `{error:"Internal error"}` (no leak). Pure functions `isInsideBbox`, `resolveLaunchCity`, and the `handler` are exported for unit testing; `serve(handler)` runs only under `import.meta.main`.
**Why:** SC-8..SC-12; I-LC-CONTRACT-STABLE, I-LC-PUBLIC-NO-PII. Frozen contract for ORCH-1028.
**Lines:** ~190.

### 4. `supabase/functions/check-launch-city/__tests__/check_launch_city.test.ts` (NEW)
15 Deno tests: behavioral (point-in-bbox inclusive bounds; inside/outside/none-live; deterministic overlap nearest-center tiebreak; matchedCity exposes only id/name/center), handler-level (real Request/Response: GET→405, OPTIONS→CORS, 5 invalid bodies→400, malformed JSON→400), and source-contract (405/400/500-no-leak/live-subset-only/verify_jwt=false). See Regression Test below.
**Lines:** ~210.

### 5. `supabase/config.toml` (MODIFIED)
**Now:** added `[functions.check-launch-city] verify_jwt = false` after `waitlist-signup` with a rationale comment.
**Why:** SC-12 (pre-auth callable); I-LC-PUBLIC-NO-PII.

### 6. `mingla-admin/src/lib/constants.js` (MODIFIED)
**Now:** `{ id:"launch-cities", label:"Launch Cities", icon:"Rocket" }` inserted after `placepool` in `NAV_GROUPS[0].items`.
**Why:** SC-6. `Rocket` already in `Sidebar.jsx` ICON_MAP → no Sidebar edit.

### 7. `mingla-admin/src/App.jsx` (MODIFIED)
**Now:** import `LaunchCitiesPage` + `"launch-cities": LaunchCitiesPage` in `PAGES` → `#/launch-cities` resolves via `getTabFromHash`.
**Why:** SC-6.

### 8. `mingla-admin/src/pages/LaunchCitiesPage.jsx` (NEW)
**Now:** the Launch Cities tab per DESIGN — header + live-count pill, two summary chips (`SummaryChip` local helper), All/Live-only segmented filter, `DataTable` (City / Country / Servable / Boundary / Live / boundary-action) with live-row tint + server live-first sort, optimistic live toggle with VISIBLE rollback + manual-dismiss red error toast (near-copy of `UserManagementPage.handleBetaToggle`), and a bbox-only `BoundaryModal` (geocode→Leaflet preview gray-current/orange-proposed→persist center+bbox+updated_at; drops `generate_tiles` / `tile_radius_m` / `status`). All 9 states (loading skeletons, empty w/ link to Place Pool, populated, submitting spinner, rollback, load-error AlertCard+Retry, first-time info banner, returning, per-row degraded warnings). `mountedRef` guard on all post-await setState.
**Why:** SC-3..SC-7; DESIGN §3–§12; Constitution rules 3 (no silent failure), 9 (real counts only).
**Lines:** ~430.

### 9. `mingla-admin/src/__tests__/orch1027_launch_cities.test.js` (NEW)
10 node:test source-inspect tests (admin convention): nav wiring, optimistic-before-await, visible-rollback+error-toast, in-flight disable, real-counts-only, bbox-only persist (asserts the boundary payload does NOT write `is_live_for_consumers`/`status`/`tile_radius_m`/`generate_tiles`), geocode_city reuse.
**Lines:** ~120.

### 10. Spec/design inputs (NEW — committed as part of the ORCH record)
`Mingla_Artifacts/specs/SPEC_ORCH-1027_LAUNCH_CITIES_ADMIN.md`, `…/DESIGN_ORCH-1027_LAUNCH_CITIES_TAB.md` (were untracked in the worktree).

---

## Regression Test (Step-0.5 / ORCH-0840 hard gate)

**Primary (behavioral, fails-on-revert):** `supabase/functions/check-launch-city/__tests__/check_launch_city.test.ts`.

Passing run (`deno test --allow-read`): **15 passed | 0 failed**. The behavioral tests import the real `isInsideBbox`/`resolveLaunchCity`/`handler` and assert computed values (matchedCity = nearest center, none-live → `liveCities:[]`, inclusive bbox edges, deterministic overlap tiebreak, 405/400 from the real handler).

**Fails-on-revert proof (verified at `<hash>` = INTAKE HEAD `5cf059fe9`, the commit before this fix lands):** with the `isInsideBbox` point-in-bbox predicate inverted (`<=`/`>=` flipped to `>`/`<` — i.e. the determination fix reverted), `deno test --allow-read` reports **FAILED — 11 passed | 4 failed** (the `isInsideBbox` inclusive-bounds test, the inside-city resolve test, the overlap nearest-center tiebreak test, and the PII-shape test all fail because the determination logic is broken). Restoring the correct predicate returns **15 passed | 0 failed**. The test exercises the behavior — it does not pass regardless of the fix.

**Secondary (admin):** `mingla-admin/src/__tests__/orch1027_launch_cities.test.js` — **10 passed | 0 failed** (`node --test`). Reverting the optimistic-rollback catch block or the bbox-only guard flips the matching assertions to fail.

---

## Verification matrix (SC-1..SC-13)

| SC | How verified | Verdict |
|----|-------------|---------|
| SC-1 column default-false | Migration `ADD COLUMN ... NOT NULL DEFAULT false`; live probe confirms column absent pre-migration (17 rows will read false). | PASS (code) / applies on db push |
| SC-2 partial index | `CREATE INDEX ... WHERE is_live_for_consumers` in migration. | PASS (code) |
| SC-3 list RPC + picker untouched | RPC returns flag/has_bbox/servable counts; `admin_city_picker_data` not in diff. | PASS (code) |
| SC-4 toggle persists | `admin_set_city_live` UPDATE + optimistic UI; reload re-reads RPC. | PASS (code) / runtime on db push |
| SC-5 toggle failure rollback | `handleToggleLive` catch restores `prev` + manual-dismiss error toast; admin test asserts it. | PASS |
| SC-6 nav + route | constants.js item + App.jsx PAGES; admin test + vite build pass; PlacePool untouched. | PASS |
| SC-7 boundary action bbox-only | `BoundaryModal` persists center+bbox+updated_at only; admin test asserts no status/flag/tile write. | PASS |
| SC-8 edge inside | `resolveLaunchCity` test: matchedCity set, liveCities full. | PASS |
| SC-9 edge outside | test: inLaunchCity false, matchedCity null, liveCities full. | PASS |
| SC-10 edge none-live | test: `{inLaunchCity:false, matchedCity:null, liveCities:[]}`. | PASS |
| SC-11 edge validation | handler test: 5 invalid bodies→400 exact body; GET→405; 500 no-leak (source). | PASS |
| SC-12 edge pre-auth | `config.toml verify_jwt=false`; test asserts it. | PASS (config) / runtime on deploy |
| SC-13 gates | `ORCH_1027_BACKEND_ALLOWLIST` in same commit; Google docs cited; gate syntax-checks; vite build + eslint clean. | PASS |

---

## Gates run (captured)

- `deno check supabase/functions/check-launch-city/index.ts` → clean.
- `deno test --allow-read .../check_launch_city.test.ts` → 15 passed | 0 failed.
- `node --test mingla-admin/src/__tests__/orch1027_launch_cities.test.js` → 10 passed | 0 failed.
- `npx eslint` on `LaunchCitiesPage.jsx` → clean (0 problems). (Pre-existing repo-wide `no-unused-vars` false-positive on `motion` in `App.jsx` is NOT introduced by this ORCH — confirmed it also fires on `git show HEAD:App.jsx`.)
- `npm run build` (vite) → built OK (2941 modules).
- `node --check` strict-grep gate → syntax OK; allowlist contains all 3 ORCH-1027 backend paths + the spread.

---

## Constitution / invariant check

- Rule 3 (no silent failures): live toggle rolls back visibly + red manual-dismiss toast; boundary errors surface in-modal; edge 500 logs server-side. PASS.
- Rule 9 (no fabricated data): servable/active counts are render-only from `admin_launch_city_list()`. PASS.
- I-LC-STATUS-ORTHOGONAL: toggle + boundary writes never touch `status`; admin test enforces. PASS.
- I-LC-DEFAULT-FALSE: `DEFAULT false NOT NULL`. PASS.
- I-LC-CONTRACT-STABLE: response shape frozen + asserted in Deno tests. PASS.
- I-LC-PUBLIC-NO-PII: edge SELECT lists only geometry columns; test asserts no PII/auth columns. PASS.

## Cross-surface impact (Step 3.5)

Built UI = Admin Web (#6) only — single code path, no parity split. The `check-launch-city` edge fn is shared backend consumed later by Consumer iOS/Android (#1/#2) via ORCH-1028; parity automatic (one JSON contract). No business surface analog.

---

## Deploy commands FOR ORCHESTRATOR (NOT run here — CLOSE owns deploy)

NO `supabase db push` and NO edge deploy were performed. After the PR merges to `main`:

1. Apply the migration (operator):
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-1027-[launch-cities-admin]" && /Users/sethogieva/bin/supabase db push --linked
   ```
   (Run `/Users/sethogieva/bin/supabase migration list --linked` first to confirm no remote-only versions; the migration is additive/idempotent, no `--include-all` needed — `20260810000000` is strictly greater than the current head `20260809000300`.)

2. Deploy the edge fn (orchestrator, from main after merge):
   ```bash
   supabase functions deploy check-launch-city --project-ref gqnoajqerqhnvulmnyvv
   ```
   Then verify-first-call (verify_jwt=false): a POST with a valid `{lat,lng}` should return HTTP 200 (non-404), and NO auth header should still return 200.

---

## Deviations from SPEC / DESIGN

- **None material.** Resolved SPEC §C.5 OPEN to Option 1 (service-role client + TS point-in-bbox) as the spec's recommended path — no new anon-granted RPC. Resolved SPEC §A.1 OPEN (toggle as RPC vs `.update()`) to the `admin_set_city_live` RPC. Resolved the optional in-function admin guard on the list RPC to NOT add it (EXECUTE is already gated to `authenticated`, matching the existing admin app auth model; SPEC marked it OPEN). DESIGN OPENs resolved exactly as the DESIGN doc resolved them (modal boundary, Leaflet preview, "Live only" filter, first-time info banner only while liveCount===0 && totalCount>0).
- Added one small lint-quirk guard (`{Icon && <Icon.../>}`) in `SummaryChip` to match the proven `Card.jsx` pattern and keep the new file eslint-clean.

## Discoveries for orchestrator

- Pre-existing repo-wide eslint `no-unused-vars` false-positive on `motion` in `mingla-admin/src/App.jsx` (fires on the unmodified HEAD version too). Not in ORCH-1027 scope; flagged for a future lint-config cleanup ORCH.
