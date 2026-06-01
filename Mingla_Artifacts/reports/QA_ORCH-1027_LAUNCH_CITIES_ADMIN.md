# QA — ORCH-1027 [Launch Cities admin control]

**Skill:** mingla-tester (TARGETED + SPEC-COMPLIANCE).
**Date:** 2026-05-31.
**Tested commit:** `9fa8ad195` (implementor) on branch `ORCH-1027-launch-cities-admin`. QA hardening committed at `5fa78aa79`.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1027-[launch-cities-admin]/`.
**Inputs:** `SPEC_ORCH-1027_LAUNCH_CITIES_ADMIN.md` (SC-1..SC-13), `DESIGN_ORCH-1027_LAUNCH_CITIES_TAB.md`, `IMPLEMENTATION_ORCH-1027_LAUNCH_CITIES_ADMIN.md`.

---

## VERDICT: CONDITIONAL PASS

CONDITIONAL only because **DB push + edge-fn deploy are orchestrator-deferred to CLOSE** (per dispatch + autonomy posture). Every clause testable pre-deploy is **PASS** with captured evidence. No open P0/P1. One P2 latent defect was **found by the tester adversarial suite and fixed** in this QA pass (NULL-bbox → matched Null Island). The deferred SCs require a short orchestrator post-deploy smoke (listed at the bottom).

- **P0:** 0 | **P1:** 0 | **P2:** 1 (FOUND + FIXED this pass) | **P3:** 1 | **P4:** 2
- **Report:** this file.
- **Sim evidence:** Admin Web only (per SPEC §2.5 — the sole built UI is `mingla-admin`; consumer/business surfaces render nothing this ORCH). iOS/Android legs SKIPPED — surface does not ship there. Web leg: vite build + dev server (HTTP 200) + module/primitive/prop contract verification (authenticated live render deferred to post-deploy smoke — RPCs don't exist pre-deploy and admin login is operator-gated).
- **Regression tests:** implementor happy-path = `supabase/functions/check-launch-city/__tests__/check_launch_city.test.ts` (15 pass, fails-on-revert verified) + `mingla-admin/src/__tests__/orch1027_launch_cities.test.js` (10 pass) · tester adversarial = `supabase/functions/check-launch-city/__tests__/check_launch_city_adversarial.test.ts` (6 pass, fails-on-revert verified, DIFFERENT angle).

---

## Comms ledger acks (on entry)

- **COMMS-0002** (WARN, ALL — strict-grep C7 blocks new backend files): **ACKED.** This ORCH adds a migration + edge fn + 2 edge tests; all four backend paths (incl. my new adversarial test) are in `ORCH_1027_BACKEND_ALLOWLIST` and spread into `ALLOWLIST`. Gate syntax-checks. Verified §SC-13.
- **COMMS-0003** (WARN, ALL — external-API docs cited inline): **ACKED.** `check-launch-city` calls NO third-party API (pure DB read — noted in its header). The only external touch is the admin boundary action reusing `admin-seed-places {geocode_city}`; Google Geocoding docs URLs are cited inline in `LaunchCitiesPage.jsx handleGeocode`. Compliant.
- COMMS-0004 / COMMS-0012 / COMMS-0015 (orchestration/process, FYI) — read, no action for this QA.

---

## 1. Re-ran the implementor's tests (independent)

| Suite | Command | Result |
|-------|---------|--------|
| Edge (Deno) | `deno test --allow-read .../check_launch_city.test.ts` | **15 passed / 0 failed** |
| Admin (node) | `node --test .../orch1027_launch_cities.test.js` | **10 passed / 0 failed** |

**Fails-on-revert (implementor) — VERIFIED.** Inverted the `isInsideBbox` predicate (`<=`/`>=` → `>`/`<`) and re-ran: **11 passed / 4 failed** (inclusive-bounds, inside-resolve, overlap-tiebreak, PII-shape all drop). Restored → 15/15. The suite exercises behavior, not source text.

## 2. Migration SQL review + live-DB read-only verification

`supabase/migrations/20260810000000_orch_1027_launch_cities.sql`:

- **Column:** `is_live_for_consumers boolean NOT NULL DEFAULT false` + `COMMENT` documenting orthogonality to `status`. `ADD COLUMN IF NOT EXISTS` → idempotent. ✓ (SC-1)
- **Partial index:** `seeding_cities_live_for_consumers_idx ON (is_live_for_consumers) WHERE is_live_for_consumers`. `IF NOT EXISTS`. ✓ (SC-2)
- **`admin_launch_city_list()`** — SECURITY DEFINER, STABLE, `SET search_path TO 'public'`, `REVOKE ALL FROM PUBLIC` + `FROM anon`, `GRANT EXECUTE TO authenticated`. Returns flag/has_bbox/servable+active counts via `LEFT JOIN place_pool`, ordered live-first then name-asc. DEFINER + EXECUTE-gate is sound for the place_pool aggregation. ✓ (SC-3)
- **`admin_set_city_live(uuid, boolean)`** — SECURITY **INVOKER**, writes ONLY `is_live_for_consumers` + `updated_at`. Authorization is the existing `admin_write_seeding_cities` RLS WITH CHECK (`EXISTS admin_users WHERE email=auth.email() AND status='active'`), verified live. A non-admin authenticated caller writes nothing (RLS denies). The flag is NEVER coupled to `status` (I-LC-STATUS-ORTHOGONAL). ✓ (SC-4)
- **`admin_city_picker_data` UNCHANGED** — only a SQL comment references it; no DDL. ✓ (SC-3)

**Live DB (read-only, project `gqnoajqerqhnvulmnyvv`, Supabase Management API — NO mutation):**

| Check | Result | Means |
|-------|--------|-------|
| `is_live_for_consumers` column exists | **0** | absent today → `ADD COLUMN` applies clean |
| `seeding_cities` rows | **17** | matches SPEC §0.1 |
| rows with NULL bbox | **0** | all bbox NOT NULL today → P2 below is latent, not live |
| distinct `status` | **seeded** | proves orthogonality (0 launched, but operator wants live control) |
| `admin_launch_city_list` exists | **0** | new RPC won't collide |
| `admin_set_city_live` exists | **0** | new RPC won't collide |
| `seeding_cities_live_for_consumers_idx` exists | **0** | new index won't collide |
| `check_city_bbox_overlap` exists | **1** | boundary overlap-check dependency present |
| `admin_city_picker_data` exists | **1** | untouched dependency present |
| `place_pool` has is_servable/is_active/city_id | **3** | RPC aggregation valid |
| RLS on `seeding_cities` | enabled + 3 policies (`admin_write_*`, `authenticated_read_*`, `service_role_all_*`) | matches SPEC §0.3; toggle gating sound |

**Conclusion: the migration will apply cleanly to the live schema.** No collision, no destructive predicate, no backfill, additive only.

## 3. `check-launch-city` edge fn review

`supabase/functions/check-launch-city/index.ts`:

- **Point-in-bbox** inclusive (`<=`/`>=`) — correct (SC-8/9). **Boundary inclusivity** asserted (SW + NE corners inside). ✓
- **Response contract** `{inLaunchCity, matchedCity|null, liveCities:[…]}` — exact §C.3. `matchedCity` exposes only `{id,name,center_lat,center_lng}` (no bbox/PII — I-LC-PUBLIC-NO-PII). `liveCities` always full set, name-asc, bbox included. Empty case → `liveCities:[]` HTTP 200. ✓ (SC-8/9/10)
- **Overlap tiebreak** — nearest squared-center distance, id-asc on equal distance. Deterministic + order-independent. ✓
- **Validation** — `typeof===number` + `Number.isFinite` + range `[-90,90]`/`[-180,180]`, `<=`/`>=` so ±90/±180 corners PASS. Invalid → 400 exact frozen body; malformed JSON → 400; wrong method → 405; DB error → 500 `{error:"Internal error"}` (logs server-side, never leaks `error.message`). ✓ (SC-11)
- **`verify_jwt = false`** present in `config.toml` at `[functions.check-launch-city]`. ✓ (SC-12)
- **No external API** — pure DB read via service-role client over the partial-indexed live subset. ✓

**Edge cases checked (dispatch-mandated):**
- Boundary inclusivity → PASS.
- Antimeridian / inverted bbox (sw_lng > ne_lng) → reports a genuinely-inside point as OUTSIDE. **KNOWN limitation** (P4) — SPEC §2 non-goals: bbox is rectangular; none of the 17 launch cities cross 180°. Pinned by adversarial A-4 so it's a conscious contract.
- Degenerate point-bbox (sw==ne) → matches its exact point only. PASS (adversarial A-2).
- Multiple overlapping live cities → deterministic match (adversarial A-3 equidistant id-asc).
- **NULL bbox on a live city → P2 DEFECT FOUND (see §5).**

## 4. `LaunchCitiesPage.jsx` vs DESIGN review

Reviewed against `DESIGN_ORCH-1027_LAUNCH_CITIES_TAB.md`. All 9 states implemented: loading (skeleton pill + chips + DataTable spinner), empty (Rocket + "Add a city in Place Pool" link to `#/placepool`), populated (live-first sort + success-tint rows), submitting (per-row `togglingIds` Set + disabled Toggle + Spinner), rollback (visible flip-back + manual-dismiss red error toast), load-error (AlertCard + Retry), first-time info banner (`liveCount===0 && totalCount>0`), returning, per-row degraded (warning Boundary chip + "0 servable" badge).

- **Optimistic toggle w/ VISIBLE rollback + red manual-dismiss toast** — `handleToggleLive` flips before await, `catch` restores `prev` AND fires `variant:"error"` toast. No silent success (Constitution rule 3). ✓ (SC-5)
- **Real counts only** — `is_servable_places`/`total_active_places` render straight from the RPC; no placeholders (Constitution rule 9). ✓
- **bbox-only boundary modal** — persists ONLY center+bbox+updated_at; never `is_live_for_consumers`/`status`/`tile_radius_m`/`generate_tiles`. Reuses `admin-seed-places {geocode_city}` (no new edge fn). Google docs cited inline. ✓ (SC-7)
- **Nav** — `{id:"launch-cities", label:"Launch Cities", icon:"Rocket"}` in constants; `"launch-cities":LaunchCitiesPage` in App.jsx PAGES; `Rocket` already in Sidebar ICON_MAP. ✓ (SC-6)
- **`mountedRef` guard** on all post-await setState. ✓

**Build / lint (captured):**
- `npm run build` (vite) → **built OK** (2941 modules, `✓ built in 1.97s`).
- Admin dev server (`npm run dev`) → **HTTP 200**, no module-eval crash.
- `npx eslint LaunchCitiesPage.jsx constants.js` → **clean**.
- `npx eslint App.jsx` → 1 error = the **pre-existing `motion` false-positive** (out of scope; verified it fires on `origin/main:App.jsx` too — PR only added the import+PAGES entry, did NOT touch the motion line).
- **All 11 imported primitives exist** and every prop contract matches (`Toggle({checked,onChange,disabled})`, `DataTable` emptyIcon/emptyMessage/emptyAction/getRowId/rowClassName/striped/loading, `Modal({size})`, `Badge({variant,dot})` incl. outline/success/warning, `Button` ghost/link/icon/size, `AlertCard({variant,action})` incl. error/info/warning, `logAdminAction(action,targetType,targetId,metadata)`, `supabase` named export). No runtime-error path at render.

**P3 (a11y, non-blocking):** DESIGN §11 specifies a per-instance `aria-label` on the live `<Toggle>` (e.g. "Live for consumers — Lagos"); the implementation omits it (the boundary button has its `aria-label`). The column header "LIVE" gives the switch an accessible name via the table, but a screen reader won't announce the city per switch. Minor; suggest adding the `aria-label` in a polish pass — not a blocker.

## 5. STEP 0.5 GATE — tester adversarial regression (+ P2 found & fixed)

**Path:** `supabase/functions/check-launch-city/__tests__/check_launch_city_adversarial.test.ts` (6 tests, **6 passed / 0 failed**).

**Different angle vs implementor** (whose fixtures were all well-formed): malformed / degenerate / boundary inputs the production table can actually produce —
- **A-1 NULL-bbox live city must match NOTHING** — *this caught a latent defect.*
- A-2 degenerate point-bbox matches exact point only.
- A-3 equidistant overlapping bboxes → id-asc tiebreak (the branch the implementor's unequal-distance test never hit).
- A-4 antimeridian inverted bbox → documented OUTSIDE (known rectangular limitation; canary for a future Pacific city).
- A-5 ±90/±180 planet corners PASS validation at the handler.
- A-6 non-matching point still returns the FULL live set (matched/list decoupling).

**P2 DEFECT FOUND + FIXED.** An all-NULL-bbox live city matched the point **(0°, 0°)** — because JS coerces `null` to `0` in numeric comparison, so `null <= 0 && null >= 0` is `true`. (0,0) is "Null Island," the classic GPS-failure / default-coordinate value a real device can send, so an unguarded NULL-bbox live row would wrongly return `inLaunchCity:true` for those devices. Today bbox columns are `NOT NULL` (0 null rows live), so **no live impact** — but it is a defense-in-depth gap against a future nullable migration or a hand-edited row.
**Fix (this QA pass, `5fa78aa79`):** added a `Number.isFinite` guard at the top of `isInsideBbox` → a malformed live row now matches NOTHING. Implementor suite still 15/15 (non-regressive); adversarial 6/6.

**Fails-on-revert (adversarial) — VERIFIED.** Inverting the point-in-bbox predicate → adversarial drops to **3 passed / 3 failed** (A-1 good-city match, A-2, A-3). Restored → 6/6.

**Regression-test gate (ORCH-0840):** all three hold — (1) tester adversarial committed + green + different angle; (2) implementor happy-path green + fails-on-revert at `9fa8ad195`; (3) all three test files appear in `git diff origin/main...HEAD --name-only`.

## 6. Constitution

| Rule | Verdict |
|------|---------|
| 3 No silent failures | PASS — toggle rolls back visibly + red manual-dismiss toast; boundary errors in-modal; edge 500 logs only |
| 9 No fabricated data | PASS — counts render-only from `admin_launch_city_list()` |
| Others (1,2,4,5,6,7,8,10,11,12,13,14) | N/A or PASS — no dead taps, single owner (server state), no fabricated currency, no persisted-state hydration concern (server-state-driven) |

---

## SC-by-SC coverage (verified-now vs deferred-to-post-deploy-smoke)

| SC | Verdict | When |
|----|---------|------|
| SC-1 column NOT NULL DEFAULT false | PASS (code + live-schema applies-clean) | column write **deferred** to db push |
| SC-2 partial index | PASS (code + live-schema applies-clean) | index creation **deferred** to db push |
| SC-3 list RPC shape/counts + picker untouched | PASS (code review; picker byte-unchanged) | RPC live result **deferred** to db push |
| SC-4 toggle persists | PASS (code: RPC + optimistic re-read) | DB persistence + reload **deferred** to db push |
| SC-5 toggle failure rollback | **PASS now** (admin test + code) | — fully verified |
| SC-6 nav + route | **PASS now** (constants+App.jsx+build+test; PlacePool untouched) | — fully verified |
| SC-7 boundary bbox-only | **PASS now** (admin test asserts no status/flag/tile write) | live geocode round-trip **deferred** to post-deploy smoke |
| SC-8 edge inside | PASS (resolver test) | live HTTP **deferred** to edge deploy |
| SC-9 edge outside | PASS (resolver test) | live HTTP **deferred** to edge deploy |
| SC-10 edge none-live | PASS (resolver test) | live HTTP **deferred** to edge deploy |
| SC-11 edge validation | PASS (handler test: 400/405/malformed; 500-no-leak source) | live HTTP **deferred** to edge deploy |
| SC-12 edge pre-auth | PASS (config.toml verify_jwt=false + test) | live no-auth call **deferred** to edge deploy |
| SC-13 gates | **PASS now** (allowlist in same commit; gate syntax OK; Google docs cited; build+lint clean) | — fully verified |

**Fully verified now (no deploy needed):** SC-5, SC-6, SC-13 + all code/contract correctness for SC-1..SC-4, SC-7..SC-12.
**Deferred to orchestrator post-deploy live smoke at CLOSE:** SC-1, SC-2, SC-3, SC-4 (db push); SC-7 (live geocode round-trip), SC-8, SC-9, SC-10, SC-11, SC-12 (edge deploy).

---

## Orchestrator post-deploy smoke checklist (run at CLOSE, after db push + edge deploy)

1. **SC-1/SC-2:** `SELECT is_live_for_consumers,count(*) FROM seeding_cities GROUP BY 1;` → all 17 `false`. `\d seeding_cities` shows the partial index.
2. **SC-3:** `SELECT * FROM admin_launch_city_list();` → 17 rows, `has_bbox=true` all, servable counts match a manual `place_pool` count.
3. **SC-4:** toggle a city ON in the Launch Cities tab → `SELECT is_live_for_consumers FROM seeding_cities WHERE id=…` true; reload tab shows it ON; toggle OFF reverses.
4. **SC-7:** run "map/refresh boundary" on a city → center+bbox update; `status`/`is_live_for_consumers`/`tile_radius_m` unchanged.
5. **SC-8/9/10:** `POST check-launch-city {lat,lng}` for an interior point of a live city → `inLaunchCity:true` + matchedCity; an exterior point → false + full liveCities; with zero live → `liveCities:[]`.
6. **SC-11/SC-12:** POST with NO auth header → 200 (verify_jwt=false); bad lat/lng → 400 exact body; GET → 405.

---

## Discoveries for orchestrator

- **P2 (fixed this pass):** NULL-bbox live city matched Null Island (0,0). Guarded in `isInsideBbox`; no live impact (bbox NOT NULL today). Committed `5fa78aa79`.
- **P3:** live `<Toggle>` missing per-instance `aria-label` (DESIGN §11) — minor a11y polish.
- **P4:** antimeridian rectangular-bbox limitation (documented + pinned, acceptable per SPEC non-goals).
- **P4 (pre-existing, not this ORCH):** repo-wide eslint `no-unused-vars` false-positive on `motion` in `mingla-admin/src/App.jsx` — fires on unmodified HEAD; candidate for a future lint-config cleanup ORCH.
