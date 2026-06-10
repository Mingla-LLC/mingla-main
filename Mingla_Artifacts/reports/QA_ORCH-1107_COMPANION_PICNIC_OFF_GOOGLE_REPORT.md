# QA — ORCH-1107: Companion-stops + Picnic-grocery off Google onto scored place_pool

**Date:** 2026-06-10 · **Skill:** mingla-tester (Claude) · **Mode:** TARGETED + SPEC-COMPLIANCE
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1107-[companion-picnic-place-pool]/` · **Branch:** `ORCH-1107-companion-picnic-place-pool`
**Implementor commit under test:** `7eda94e2521c20f977c9180a31fcb7f299f488c7`
**Tester adversarial-test commit:** `f8a79bac7` (appended on-branch)
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1107_COMPANION_PICNIC_OFF_GOOGLE_ONTO_PLACE_POOL.md` (binding, with SPEC AMENDMENT 1)

---

## 1. Verdict

# FAIL — P0: 0 · P1: 1 · P2: 0 · P3: 1 · P4: 2

The product code change is **correct and complete** — every functional success criterion (de-Google,
RPC re-source, `imageUrl=stored_photo_urls[0]`, kill Unsplash, graceful-empty on 0-rows AND on
RPC-error, client untouched) is independently proven, including live RPC-probe runtime evidence and an
adversarial RPC-error-path test that fails-on-revert. **The single blocker is a CI-gate completeness
defect (P1):** the implementor's `ORCH_1107_BACKEND_ALLOWLIST` (added at `7eda94e2`) allowlisted only
its own happy-path test, NOT the tester's mandatory adversarial test under `supabase/functions/__tests__/`.
As required by the pipeline, that adversarial test is now committed on-branch and in-diff — and the C7
`no-new-backend-files` gate therefore goes **RED** on the closing diff (gate exit 1, offender =
`orch_1107_rpc_error_adversarial.test.ts`). The tester cannot edit the gate (it is config/product code,
append-only applies to test files only). This is a one-line REWORK for the implementor.

Routing: **FAIL → REWORK (implementor)**. Single required fix in §3 (P1). Re-test is mechanical
(re-run the C7 gate → expect exit 0).

---

## 2. SC-by-SC matrix

SC numbering follows the implementation report's table (which tracks SPEC §"Success criteria" + AMENDMENT 1).

| SC | Criterion | Status | Independent evidence |
|----|-----------|--------|----------------------|
| SC-1 | `grep GOOGLE_MAPS_API_KEY` over both fns → zero | **PASS** | Read full diff `git show 7eda94e25` — `const GOOGLE_API_KEY = …` line DELETED from both; no `GOOGLE_MAPS_API_KEY` anywhere in either `index.ts`. |
| SC-2 | No `googleapis.com` ref in either fn | **PASS** | `batchSearchPlaces` import (the only googleapis path) removed from both; no `googleapis` token in either file. |
| SC-3 | Both call `query_servable_places_by_signal` | **PASS** | companion `index.ts:172`, picnic `index.ts` `findGroceryStore` — both `supabaseAdmin.rpc("query_servable_places_by_signal", …)`. RPC signature verified live (§5). |
| SC-4 | companion: `casual_food`, filter 120, radius=maxDistance(500), limit 10, sort signal_score desc, top 1 | **PASS** | `COMPANION_SIGNAL_ID="casual_food"`, `COMPANION_FILTER_MIN=120`, `COMPANION_RPC_LIMIT=10`, `p_radius_m:maxDistance`; sort `Number(b.signal_score)-Number(a.signal_score)` then `.slice(0,1)`. Test CP-01/02; my read of the diff. |
| SC-5 | picnic: `groceries`, same geo/limit pattern | **PASS** | `GROCERY_SIGNAL_ID="groceries"`, filter 120, limit 10, `p_radius_m:maxDistance`; closest-then-rating preference among already-gated rows. Test GR-01. |
| SC-6 | Row → existing client shape (id,name,location,address,rating,reviewCount,imageUrl,placeId,type[,types,distance]) | **PASS** | `mapServableRowToCompanionStop` / `mapServableRowToGroceryStore` read in full; field-by-field correct. Test CP-03/GR-02. |
| SC-7 | `imageUrl = stored_photo_urls[0]`; Unsplash placeholder deleted | **PASS** | `imageUrl: storedPhotos[0] ?? null` in both mappers; no `unsplash` token in either file. fails-on-revert proven (§4). |
| SC-8 | Removed key read + 500 guard + `batchSearchPlaces` import from both | **PASS** | The `if (!GOOGLE_API_KEY) … 500 "Google Maps API key is not configured"` block DELETED from both; import line gone. |
| SC-9 | Graceful empty on 0 rows (`strollData:null`/`picnicData:null`), no Google fallback, no throw | **PASS (proven)** | Source: `if (error){return []/null}` + outer `try/catch{return []/null}` + handler `if(!len){strollData:null}` / `if(!store){picnicData:null}`. Runtime: my adversarial test ADV-01..04 drives the RPC-error path end-to-end → graceful 200 + null body + zero Google request (§4). 0-row data condition proven live (§5: unscored-ocean probe → 0 rows). |
| SC-10 | Client untouched (`stopReplacementService`, `ExpandedCardModal`, `CompanionStopsSection`) | **PASS** | `git diff --name-only origin/main...HEAD` = backend-only; zero `app-mobile/` files. |
| SC-11 | Happy-path test green + fails-on-revert (hermetic) | **PASS (independently re-run)** | `14 passed \| 0 failed`, zero uncaught, on a clean `env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_ANON_KEY` shell. fails-on-revert re-proven by me (§4). |
| SC-12 | `deno check` clean | **PASS** | `deno check` clean on the adversarial test; implementor reported clean on both `index.ts` (consistent — `deno test` compiled both with no type error). |
| SC-13 | C7 no-new-backend-files gate passes (allowlist same commit) | **FAIL** | At `7eda94e2` (4 files) the gate passes. But the pipeline REQUIRES the tester adversarial test in-diff; once it is committed (mandatory), C7 goes RED — the allowlist omits it. Gate exit 1, offender `orch_1107_rpc_error_adversarial.test.ts`. See P1 finding §3. |

**Parity note (SC-1..SC-10 apply to Consumer iOS + Consumer Android):** both surfaces consume the SAME two
edge functions with the client untouched → parity is automatic. Device render of the expand card is
**operator/data-gated** (requires `place_scores` for the test city via `run-signal-scorer`), correctly
attributed below as NOT an ORCH-1107 code defect. The data PATH is runtime-proven via the live RPC probe (§5).

---

## 3. Findings

### P1-1 — C7 gate omits the tester's mandatory adversarial test → closing PR CI goes RED

- **Evidence:** `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` `ORCH_1107_BACKEND_ALLOWLIST`
  (added by the implementor at `7eda94e2`, lines ~1577-1583) lists exactly:
  `get-companion-stops/index.ts`, `get-picnic-grocery/index.ts`,
  `__tests__/orch_1107_companion_picnic_place_pool.test.ts`. It does NOT include the tester's adversarial
  test. The gate computes offenders via `git diff --name-only origin/main...HEAD` (script line ~222).
  After the required tester test is committed (`f8a79bac7`), running the gate:
  ```
  FAIL [C7: no-new-backend-files] … offenders:
    supabase/functions/__tests__/orch_1107_rpc_error_adversarial.test.ts
  # 1 failure(s)
  ```
  gate exit = 1. The workflow `strict-grep-mingla-business.yml` triggers on `supabase/functions/**`
  (verified `on.pull_request.paths`) and runs `orch-0863-marketing-hub-phase-b` (verified job, line 1684),
  so this is a RED required check on the closing PR, not a local-only artifact.
- **Why the tester cannot self-fix:** the gate is config/product code. The tester's append-only license
  covers NEW test files only; editing the allowlist is implementor/product work, and the dispatch's HARD
  GUARD is "if you find a defect, write a P0/P1 finding and return for REWORK — do not fix product code."
- **Impact:** the merge is blocked by a RED required CI check. The functional change is correct; this is a
  gate-completeness gap the implementor left when it allowlisted only its own test and not the
  pipeline-mandatory tester test.
- **Required fix (implementor, REWORK):** add
  `"supabase/functions/__tests__/orch_1107_rpc_error_adversarial.test.ts"` to `ORCH_1107_BACKEND_ALLOWLIST`
  in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (same const, one line). Per
  COMMS-0002 this lands in the backend change set.
- **Retest:** `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` → exit 0,
  `# All checks PASS` over the 5-file diff.

### P3-1 — `_shared/placesCache.ts` (`batchSearchPlaces`) is now orphaned

- **Evidence:** after this change no edge function imports `batchSearchPlaces`; only its own definition +
  the implementor test's negative-grep string reference it.
- **Impact:** dead shared code (no runtime cost). The SPEC explicitly says do NOT delete the shared helper,
  so leaving it is correct for this ORCH.
- **Required fix:** none in 1107. Candidate for a future dead-code-removal ORCH once confirmed
  program-wide-dead. (Implementor already flagged this in Discoveries — agreed.)
- **Retest:** n/a.

### P4-1 (praise) — Error tolerance is genuinely two-layered and correct

The de-Google re-source keeps BOTH an `if (error) return []/null` guard AND an outer `try/catch` returning
the empty value — so neither a PostgREST `{error}` nor a thrown fetch can surface a 500 or trigger a Google
fallback. My adversarial RPC-error test proves this end-to-end. Clean.

### P4-2 (praise) — Constitution Rule 9 win

The hardcoded Unsplash placeholder (fabricated imagery) is fully removed; `imageUrl` is now a real
`stored_photo_urls[0]` or honest `null`. This is exactly the "missing is hidden, never faked" principle.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof (hashes cited)

**Checked out / ran on:** worktree HEAD `7eda94e2521c20f977c9180a31fcb7f299f488c7` (product files), test file
`orch_1107_companion_picnic_place_pool.test.ts` at that commit.

1. **Baseline (clean env), implementor happy-path test, re-run by me:**
   `env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_ANON_KEY deno test --allow-all <happy-path>`
   → **`ok | 14 passed | 0 failed (8ms)`**, ZERO uncaught. (The REWORK hermeticity fix holds — no
   `supabaseUrl is required` throw.)
2. **Revert applied by me** (true line-edit, product file): in `get-companion-stops/index.ts`
   `mapServableRowToCompanionStop`, `imageUrl: storedPhotos[0] ?? null` → `…?? "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&q=80"`.
   Re-run → **`FAILED | 12 passed | 2 failed`**: **CP-04** ("no-stored-photos yields null imageUrl, no
   fabricated placeholder") and **NG-01** ("companion-stops has ZERO Google references" — the source-grep
   catches the `unsplash` token) FAIL. Matches the implementor's claim exactly.
3. **Restored** from backup → `git diff --quiet` confirms byte-identical to HEAD → re-run → **`14 passed | 0 failed`**.

Implementor fails-on-revert: **independently confirmed at `7eda94e2`.**

---

## 5. Adversarial test added (tester-owned, RPC-ERROR angle)

- **Path:** `supabase/functions/__tests__/orch_1107_rpc_error_adversarial.test.ts`
- **Commit:** `f8a79bac7` (appended on `ORCH-1107-companion-picnic-place-pool`; in
  `git diff --name-only origin/main...HEAD`).
- **Different angle (vs implementor's param-building + row-mapping + 0-row source-grep):** the **RPC-ERROR
  path**. It stands up a local HTTP mock, points `SUPABASE_URL` at it BEFORE the SUT dynamic-imports, and
  replies with a PostgREST-shaped HTTP 500 so the REAL `@supabase/supabase-js` client resolves
  `.rpc()` to `{ data: null, error: {...} }`. The exported `handleRequest` is then driven with a valid
  anchor/picnic, exercising each edge function's `if (error)` branch **end-to-end over a real (mocked)
  network round-trip** — not a re-implementation. It records every request path the SUT makes to prove no
  Google fallback fires.
- **Assertions (5 tests, all green — `5 passed | 0 failed`, also `19 passed | 0 failed` combined with the
  implementor suite, clean env):**
  - ADV-01/02: companion/picnic RPC-error → HTTP **200** (NOT a thrown 500), body `strollData:null` /
    `picnicData:null`, **zero** `googleapis|maps|searchNearby` request, and the RPC WAS attempted.
  - ADV-03/04: error-path body carries the empty marker and leaks no `unsplash` / `googleapis` artifact.
- **Hermetic:** sets its own dummy `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`ORCH_TEST_NO_SERVE` and
  dynamic-imports; passes under `env -u SUPABASE_URL -u SUPABASE_SERVICE_ROLE_KEY -u SUPABASE_ANON_KEY`.
  `deno check` clean. NOT a renamed copy of the implementor's test.
- **fails-on-revert verified at `7eda94e2` product base:** I removed the companion error-tolerance (replaced
  `if (error){…return []}` with `throw new Error(error.message)` and the outer catch's `return []` with
  `throw error`). Re-run → **`FAILED | 3 passed | 2 failed`**: **ADV-01** (now gets a 500, not graceful 200)
  and **ADV-03** FAIL. Restored → `git diff --quiet` clean → **`5 passed | 0 failed`**. The test is
  load-bearing on the exact error-tolerance contract.

**Both regression tests appear in the closing diff** (`git diff --name-only origin/main...HEAD`):
`…/orch_1107_companion_picnic_place_pool.test.ts` AND `…/orch_1107_rpc_error_adversarial.test.ts`.

---

## 6. Live RPC-probe runtime evidence (populated data path) + graceful-empty proof

Read-only via `mcp__supabase__execute_sql` against prod `gqnoajqerqhnvulmnyvv`.

**RPC signature (verified, matches SPEC AMENDMENT 1):**
`query_servable_places_by_signal(p_signal_id text, p_filter_min numeric, p_lat double precision, p_lng double precision, p_radius_m double precision, p_exclude_place_ids uuid[], p_limit integer)`.

**Coverage of scored, servable, photo'd rows (`score>=120`, `is_servable`, `is_active`, photos>0):**
- `casual_food`: **5,245** rows (21,099 scored total) — far more than the dispatch's "~32"; densest tile
  Raleigh NC (35.78,-78.64) = 31, matching the dispatch reference.
- `groceries`: **240** rows (16,307 scored total) — present but much sparser.

**Companion path probe** — `query_servable_places_by_signal('casual_food', 120, 35.7777, -78.6396, 1500, '{}', 10)`
→ **10 rows**, ALL with non-empty real `stored_photo_urls` (5 each, `…/storage/v1/object/public/place-photos/…`,
NOT Unsplash), sorted by `signal_score` desc (top: Sam Jones BBQ 194 / A Place at the Table 194 / Benchwarmers Bagels 194).
→ proves `findCompanionStops` returns mappable rows; `mapServableRowToCompanionStop(row[0])` →
`{name:"Sam Jones BBQ", imageUrl:"https://gqnoajqerqhnvulmnyvv.supabase.co/.../0.jpg", rating:4.4, …}`.

**Picnic path probe** — `query_servable_places_by_signal('groceries', 120, 35.7365, -78.7803, 5000, '{}', 10)`
→ **10 rows** (Trader Joe's 194, Whole Foods 194, Harris Teeter ×5, Walmart, Grand Asia Market, Lowes Foods),
ALL with non-empty real `stored_photo_urls` (5 each), `signal_score`-ordered. → proves
`mapServableRowToGroceryStore` returns the picnic shape with real `imageUrl` + numeric distance.

**Graceful-empty data condition proven live** — same RPC at an unscored coordinate (0.0, -30.0 mid-ocean):
`casual_food` → **0 rows**, `groceries` → **0 rows**. → in an unscored city the RPC returns 0 → companion
`return []` → `strollData:null`; picnic `return null` → `picnicData:null`. **Graceful-empty path is sound.**

**Populated DEVICE render — correctly attributed to operator data population, NOT a 1107 code defect.**
A populated Take-a-Stroll / Picnic expand-card RENDER on a real device requires `place_scores` populated for
the test city via `run-signal-scorer` (operator / COMMS-0018-owned; overlaps META-ORCH-1062's scorer-invoke
fix). In unscored cities the CORRECT behavior is graceful-empty (proven above). I did NOT fake a populated
render; the data PATH is runtime-proven by the two live probes (real rows with real photos exist and the
mappers consume them correctly). Per SPEC AMENDMENT 1 operational note, 1107 ships correct code; data
population is separate.

---

## 7. Constitution 14-rule matrix (re-checked against the diff independently)

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | N/A | No UI change; client untouched (SC-10). |
| 2 | One owner per truth | PASS | place_pool/place_scores remain the single source; these fns are read-only consumers of the RPC. |
| 3 | No silent failures | PASS | RPC error logs `console.error` and returns the DELIBERATE graceful-empty product contract (SC-9) — not a swallowed error masquerading as user success; the contract IS "no stop available → null body", a designed UX, not a hidden failure. |
| 4 | One query key per entity | N/A | Backend edge fns; no React Query keys. |
| 5 | Server state stays server-side | PASS | No Zustand/client-state touched. |
| 6 | Logout clears everything | N/A | No auth/session state. |
| 7 | Label `[TRANSITIONAL]` + exit | PASS | No transitional code. `ORCH_TEST_NO_SERVE` is a permanent, production-inert test seam (never set in prod), not transitional debt. |
| 8 | Subtract before adding | PASS | Google path fully removed (key/guard/import/Unsplash) as part of the change, not layered on top. |
| 9 | No fabricated data | PASS (headline) | Unsplash placeholder DELETED; `imageUrl = stored_photo_urls[0] ?? null` — real photo or honest null. fails-on-revert enforces it. |
| 10 | Currency-aware | N/A | No price/currency rendering added (grep `+.*GBP/currency/priceGbp` → none). |
| 11 | One auth instance | PASS | Reuses the single module-level `supabaseAdmin` service-role client; no new auth instance; `verify_jwt` posture unchanged (deployed v290/v288 both `verify_jwt=true`). |
| 12 | Validate at the right time | N/A | No datetime logic. |
| 13 | Exclusion consistency | PASS | RPC's `p_exclude_place_ids` defaulted `'{}'`; gating (is_servable/score/photos/radius) is enforced uniformly inside the RPC, identical to discover-cards. |
| 14 | Persisted-state startup gate | N/A | No persisted client state. |

No constitutional violation. (The C7 gate failure in §3 is a CI-completeness defect, not one of the 14
engineering principles.)

---

## 8. Device / parity matrix

| Surface | Status | Detail |
|---------|--------|--------|
| Consumer iOS | PASS (code+data-path proven; device render data-gated) | Shared edge fns; client untouched. Data path runtime-proven via live RPC probe (§6). Populated on-device render requires scorer-populated city (operator-owned) — correctly out of 1107 code scope. |
| Consumer Android | PASS (automatic parity) | Same shared backend, client untouched. No platform-specific code. |
| Buyer/anonymous Web | N/A | Consumer deck-expand path only; not a buyer-web route. |
| Business iOS | N/A | Not a business surface. |
| Business Android | N/A | Not a business surface. |
| Admin Web (adjacent) | N/A | No admin code touched. |
| Business Web preview (adjacent) | N/A | No business code touched. |

**Physical-iPhone HITL:** not requested for this backend-only re-source; a populated expand-card render is
data-gated on `run-signal-scorer` for the test city (operator-owned), so a HITL render now would correctly
show graceful-empty in an unscored city and would not exercise the new mapping. Deferred to post-merge +
post-scorer; not a blocker for this code change.

**Live deploy state (read-only):** `get-companion-stops` v290, `get-picnic-grocery` v288 — both ACTIVE,
`verify_jwt=true`. These are the PRE-merge Google-era versions; the new RPC code is NOT yet deployed
(correct — deploy is operator-owned from MERGED main post-merge, per impl report §11 + COMMS-0018).

---

## 9. Comms ledger (read on entry)

Read `COMMS_LEDGER.md`. Relevant rows are both **WARN** (not BLOCK), factored:
- **COMMS-0002** (C7 `no-new-backend-files` gate blocks backend PRs unless allowlisted) — directly
  materialized here as **P1-1**: the gate fails on the new test file. Factored.
- **COMMS-0018** (place_scores population / scorer-invoke is operator/data-owned; deploy only from merged
  main) — confirms the graceful-empty-in-unscored-cities framing and that the populated device render is a
  data-population task, NOT a 1107 code defect. Factored.

No new cross-ORCH discovery beyond what COMMS-0002/0018 already cover → no new COMMS entry written.

---

## 10. Discoveries for Orchestrator

1. **C7 allowlist must include the tester's adversarial test** (the P1). General pattern: when an ORCH that
   touches `supabase/functions/**` will receive a tester adversarial test under `__tests__/`, the
   `*_BACKEND_ALLOWLIST` must anticipate BOTH the implementor test AND the tester test — otherwise the
   tester's mandatory, in-diff test predictably RED-lights C7. Recommend the implementor add the tester
   test path proactively, or the orchestrator pre-allowlists the known tester filename at spec time.
2. **`_shared/placesCache.ts` is now orphaned** (no edge-function importer). Candidate for a future
   dead-code-removal ORCH (impl flagged it too; SPEC said keep the shared helper, so untouched here).
3. **Scorer coverage is far broader than the spec assumed** — `casual_food` has 5,245 servable/scored/photo'd
   rows (densest in Raleigh NC, not NYC), `groceries` 240. So Take-a-Stroll will already return real stops in
   well-scored metros (Raleigh, etc.) on first deploy; Picnic will be sparser. Informational for the
   operator's post-merge `run-signal-scorer` planning.

---

## 11. Accepted conditions

None (verdict is FAIL, not CONDITIONAL PASS). The single P1 is a mechanical, well-understood REWORK; the
functional change is otherwise fully verified.

---

## Handoff

Route to **mingla-orchestrator** → **REWORK (implementor)** for the single P1: add
`"supabase/functions/__tests__/orch_1107_rpc_error_adversarial.test.ts"` to `ORCH_1107_BACKEND_ALLOWLIST` in
`.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (one line, COMMS-0002), then re-run the C7
gate (expect exit 0). All functional success criteria, both regression tests (with independent
fails-on-revert), the live RPC populated-path probe, and the graceful-empty path are already PROVEN — the
re-test after the allowlist fix is purely the gate. Working tree:
`~/Desktop/mingla-orchs/ORCH-1107-[companion-picnic-place-pool]/` on branch
`ORCH-1107-companion-picnic-place-pool` (tester test at `f8a79bac7`, product code at `7eda94e2`).
