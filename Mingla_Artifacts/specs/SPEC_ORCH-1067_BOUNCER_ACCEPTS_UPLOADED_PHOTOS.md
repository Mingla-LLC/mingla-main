# SPEC — ORCH-1067 [bouncer accepts business-authored uploaded photos]

**Skill:** mingla-forensics (SPEC)
**Date:** 2026-06-03
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1067-[bouncer-accepts-uploaded-photos]/` on branch `ORCH-1067-bouncer-accepts-uploaded-photos`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1067_BOUNCER_ACCEPTS_UPLOADED_PHOTOS.md`
**Type:** edge-function-logic-only. **No DB migration. No new backend file.**
**Predicate (locked):** `fetched_via === 'business_authored'`

---

## 0. Problem in one paragraph

The deck "bouncer" rule **B7** (`B7:no_google_photos`) in `supabase/functions/_shared/bouncer.ts` requires a non-empty Google `photos` array universally. A business-authored venue has real uploaded photos in `stored_photo_urls` but an empty Google `photos` array (it is not on Google), so B7 fires and the venue fails the bouncer at admin approval (`runApproveGoLive` records `bouncer_reason='B7:no_google_photos'`, `is_servable` stays false). Every business-authored venue is permanently blocked from the consumer deck. **Fix:** skip B7 inside `bounce()` when `fetched_via='business_authored'`, keeping B8 (`stored_photo_urls`) as that venue's real photo gate. Google-seeded places are unchanged.

---

## 1. Scope / Non-goals / Assumptions

**Scope (LOCKED):**
1. Add a `fetched_via` field to the `PlaceRow` interface in `_shared/bouncer.ts`.
2. In `bounce()`, skip the B7 push when `place.fetched_via === 'business_authored'`. B8 still applies (and still respects `skipStoredPhotoCheck` in the pre-photo pass).
3. Add `fetched_via` to the SELECT in the THREE callers whose projection lacks it: `run-bouncer`, `run-pre-photo-bouncer`, `admin-review-venue-claim`.
4. Add Deno unit tests covering the new behavior (happy + adversarial) in the existing `_shared/__tests__/bouncer.test.ts` and the pipeline behavioral test.
5. Redeploy all four `bounce()`-calling edge functions.

**Non-goals (LOCKED):**
- NO DB migration (`fetched_via` already exists on `place_pool`).
- NO change to the scorer-invoke path, the demotion logic, or the gallery gate (META-ORCH-1062 / Sub-E territory; their CI gate must stay green).
- NOT required to remove the pipeline's now-redundant `placeForBouncer` photo-swap (lines 332-348). The implementor MAY simplify it (OPEN), but the spec does not require it; if simplified, the pipeline behavioral test must still pass.
- NOT in scope to retroactively re-bounce existing live rows (orchestrator may run a one-shot post-deploy; see §11).
- NO UI surface touched — this is a backend-logic ORCH. (Phase 2.5 / 3.6 visual contract is N/A; see §6.)

**Assumptions:**
- `fetched_via` is a text column; current distinct values: `nearby_search`, `detail_refresh`, `business_authored`, `text_search` (verified live). The string `'business_authored'` is the exact literal the pipeline writes (`run-business-place-authoring-pipeline/index.ts:576`).
- `bouncer.ts` remains pure (zero IO) — `fetched_via` is plain data on the row.

---

## 2. The exact `bouncer.ts` change

### 2.1 `PlaceRow` interface — add `fetched_via` (LOCKED)

In `supabase/functions/_shared/bouncer.ts`, the `PlaceRow` interface (currently lines 41-54) gains one optional field. Add it after `stored_photo_urls`:

```ts
export interface PlaceRow {
  id: string;
  name: string | null;
  lat: number | null;
  lng: number | null;
  types: string[] | null;
  business_status: string | null;
  website: string | null;
  opening_hours: unknown;
  photos: unknown[] | null;
  stored_photo_urls: string[] | null;
  // ORCH-1067 — provenance. 'business_authored' ⇒ skip B7 (Google-photos gate);
  // such venues are not on Google and are gated on B8 (stored photos) instead.
  // Optional so existing test fixtures / callers compile; absent ⇒ treated as
  // Google-sourced (B7 applies).
  fetched_via?: string | null;
  review_count: number | null;
  rating: number | null;
}
```

### 2.2 A typed predicate helper (LOCKED)

Add a small exported pure helper next to `hasGooglePhotos` / `hasStoredPhotos` (after line 249):

```ts
/**
 * ORCH-1067 — a business-AUTHORED venue is not on Google, so it can never have
 * Google `photos` and must not be gated on B7. Its photo gate is B8
 * (stored_photo_urls — the operator's own uploads). Narrowest correct predicate:
 * the explicit provenance marker the authoring pipeline writes on insert
 * (run-business-place-authoring-pipeline sets fetched_via='business_authored').
 * NOT broadened to `google_place_id IS NULL` — provenance, not an incidental id,
 * is the intent. Google-seeded rows (nearby_search/detail_refresh/text_search)
 * keep B7 unchanged.
 */
function isBusinessAuthored(place: PlaceRow): boolean {
  return place.fetched_via === 'business_authored';
}
```

### 2.3 B7 — gate the push behind the predicate (LOCKED)

Replace the current B7 block (lines 335-338) with:

```ts
  // B7: Google photos required (universal — applies to all clusters including
  // Natural). Always checked, including in pre-photo pass — no point queueing
  // zero-photo-metadata rows for download.
  //
  // ORCH-1067 EXCEPTION: business-authored venues are not on Google and cannot
  // have a Google `photos` array; their photo gate is B8 (stored_photo_urls,
  // which they have). Skipping B7 for them — and ONLY them — lets a self-listed
  // venue with real uploaded photos reach the deck while keeping the Google
  // photo requirement intact for every Google-seeded place. A business-authored
  // venue with NO stored photos still fails (B8 below). The skip is photo-pass
  // INDEPENDENT and fires identically in both passes → I-TWO-PASS-BOUNCER-RULE-
  // PARITY preserved (the only allowed cross-pass difference remains B8).
  if (!isBusinessAuthored(place) && !hasGooglePhotos(place)) {
    reasons.push('B7:no_google_photos');
  }
```

**B8 is unchanged** (lines 343-345). Business-authored venues still run B8 in the final pass; the pre-photo pass still suppresses B8 via `skipStoredPhotoCheck` exactly as today. No other rule changes.

**HARD GUARD (LOCKED):** Do NOT hand-roll the string `B7:no_google_photos` anywhere outside `_shared/bouncer.ts` — the `I-TWO-PASS-BOUNCER-RULE-PARITY` CI gate (`scripts/ci-check-invariants.sh:554`) greps for it and FAILS if it appears in any non-canonical file (admin-review and the pipeline are NOT on its allowlist). Keep all B7 logic inside `bounce()`.

---

## 3. The FULL list of `bounce()` call sites + the `fetched_via` SELECT additions each needs

There are exactly **four** files that call `bounce()` (census proven by grep + read; `claim-search-pool`, `backfill-place-photos`, `run-signal-scorer` reference "bouncer" only in comments/column names and do NOT call `bounce()`).

| # | File | Current SELECT | Edit required | Why |
|---|------|----------------|---------------|-----|
| C1 | `supabase/functions/run-bouncer/index.ts` | `SELECT_FIELDS` (line 37-38): `'id, name, lat, lng, types, business_status, website, opening_hours, photos, stored_photo_urls, review_count, rating'` | **Append `, fetched_via`** to the string. | Final-pass runner scans `place_pool` by city/`is_active`; a business-authored row in a seeded city could be swept here, so it must read `fetched_via` to skip B7 consistently. |
| C2 | `supabase/functions/run-pre-photo-bouncer/index.ts` | `SELECT_FIELDS` (line 44-45): identical string to C1 | **Append `, fetched_via`** to the string. | Pre-photo pass — same uniformity requirement; B7 fires in this pass too (per the comment at bouncer.ts), so the skip must be data-available here as well (two-pass parity). |
| C3 | `supabase/functions/admin-review-venue-claim/index.ts` | `BOUNCER_SELECT` (line 58-59): identical string to C1, then `bounce(ppRow as PlaceRow)` at line 119 | **Append `, fetched_via`** to the string. | THE proven blocking path (`runApproveGoLive`). Without `fetched_via` in the projection, the raw `bounce(ppRow)` re-bounce B7-rejects every business-authored venue at approval. This is the load-bearing fix. |
| C4 | `supabase/functions/run-business-place-authoring-pipeline/index.ts` | loads place via `.select("*")` (lines 1153, 1338, 1450); builds the PlaceRow via `placeForBouncer()` (lines 327-363) | **No SELECT edit needed** (`*` already includes `fetched_via`; `placeForBouncer` already reads it at line 335). **MUST** add `fetched_via` to the object `placeForBouncer` returns (lines 349-362) so the new `bounce()` predicate sees it. | The pipeline already partially compensates via its photo-swap, but to align with the canonical fix and make the swap redundant, `placeForBouncer` must pass `fetched_via` through to `bounce()`. |

### 3.1 Exact edit for C1, C2, C3 (string append)

Change each `SELECT_FIELDS` / `BOUNCER_SELECT` constant from:
```
'id, name, lat, lng, types, business_status, website, opening_hours, photos, stored_photo_urls, review_count, rating'
```
to:
```
'id, name, lat, lng, types, business_status, website, opening_hours, photos, stored_photo_urls, fetched_via, review_count, rating'
```
(C3 uses double quotes — keep them.)

### 3.2 Exact edit for C4 (`placeForBouncer` return object)

In `run-business-place-authoring-pipeline/index.ts`, add one line to the object returned by `placeForBouncer` (after `stored_photo_urls: storedPhotos,` at line 359):
```ts
    fetched_via: (place as { fetched_via?: string | null }).fetched_via ?? null,
```
The existing `isBusinessAuthored`/`photosForGate` logic (lines 332-348) MAY be left as-is (harmless redundancy — it produces a passing verdict either way). Removing it is OPEN (see §8), but if removed the pipeline behavioral test must still pass.

---

## 4. Two-pass parity analysis (I-TWO-PASS-BOUNCER-RULE-PARITY)

**Invariant rule:** the only allowed difference between `bounce(place)` (final) and `bounce(place, {skipStoredPhotoCheck:true})` (pre-photo) is whether **B8** appears in `reasons`. No other rule may differ across passes.

**Does the B7 skip break parity?** No.
- The skip predicate is `isBusinessAuthored(place)` — a function of the row's `fetched_via` data, NOT of the `skipStoredPhotoCheck` option. It evaluates identically in both passes. So B7's presence/absence is the same in pre-photo and final for the same row. Parity holds.
- B8 remains the sole pass-dependent rule (suppressed in pre-photo via `skipStoredPhotoCheck`, applied in final). Unchanged.

**Do business-authored venues even traverse the two-pass cycle?** Generally no — they bypass the Google seed→download→re-bounce loop. Proven live: all 3 `business_authored` rows have `passes_pre_photo_check=NULL` (never pre-bounced). Their path is: pipeline (`bounce` via `placeForBouncer`) → admin approval (`runApproveGoLive`). HOWEVER, `run-pre-photo-bouncer` and `run-bouncer` select `is_active=true` rows by city WITHOUT filtering `fetched_via`, so a business-authored row that lives in a seeded city CAN be swept by either pass. **This is exactly why the fix lives in `bounce()` and `fetched_via` is added to BOTH runners' SELECTs** — so that wherever a business-authored row is bounced (pipeline, admin-review, pre-photo runner, or final runner), B7 is skipped consistently and parity is guaranteed. A row swept by both passes gets the same B7 outcome in each.

**Conclusion:** the skip is consistent across pre-photo + final + admin + pipeline. Parity preserved. No new cross-pass divergence introduced.

---

## 5. Live probe — B7 is the SOLE blocker for Lantern & Vine

Supabase MCP read-only probe (2026-06-03/04), place_pool `8b720912-a0bf-405a-88f8-773eca6f3f33`:

```
name="Lantern & Vine"  fetched_via="business_authored"  google_place_id=NULL
google_photo_count=0   stored_photo_count=7
business_status="OPERATIONAL"  website="https://www.deathandcompany.com"  has_hours=true
types=["restaurant","food","point_of_interest"]  (cluster = A_COMMERCIAL)
rating=NULL  review_count=0
is_servable=false  is_active=true
bouncer_reason="B7:no_google_photos"   ← SINGLE reason
```

Hand-trace of `bounce()` on this row confirms B7 is the only firing rule:
- B1 cluster A_COMMERCIAL (not EXCLUDED) → pass
- B2 OPERATIONAL → pass
- B3 name+lat+lng present → pass
- B9 child-venue / B10 fast-food-type / B11 fast-food-name / B12 casual-chain → no match
- **B7 → FIRES** (Google `photos` empty)
- B8 → pass (7 stored photos)
- B4/B5 own-domain → pass (`deathandcompany.com` not a social/aggregator domain)
- B6 opening_hours → pass (populated)
- A_COMMERCIAL requires NO rating/review_count, so `rating=NULL`/`review_count=0` do not block.

**Cluster-rule check:** A_COMMERCIAL gates only on website (B4/B5) + hours (B6) beyond the universal photo rules. Both satisfied. No cluster rule blocks. → After the B7 skip, `reasons=[]` → `is_servable=true`. **This fix alone unblocks Lantern & Vine.** Verified the partition holds across all 3 business-authored rows (Lumen passes after fix; Tuscanny still correctly fails B4:no_website until it adds a website).

---

## 6. Cross-Surface Impact (Phase 2.5)

This is a backend / edge-function-logic ORCH. No client UI code is touched.

| Surface | Covered? | Behavior / why-not |
|---------|----------|--------------------|
| Consumer iOS (`app-mobile/` iOS) | Indirect | Business-authored venues become servable → eligible to appear on the deck. No client code changes; effect is data-driven via `place_pool.is_servable`. No per-surface success criterion needed (shared backend). |
| Consumer Android | Indirect | Same as iOS — shared backend; automatic parity. |
| Buyer/anonymous Web | N/A | Deck eligibility is consumer-app only; buyer-anon web routes don't render the bouncer-gated deck. |
| Business iOS / Android | N/A | Authoring/approval triggers the bouncer but the business app doesn't render the deck; the fix changes the approve outcome, not business UI. |
| Admin Web | Indirect | `runApproveGoLive` now flips `is_servable=true` for business-authored venues with stored photos; the admin sees the venue go live instead of stuck on a B7 reason. No admin code change. |
| Business Web preview | N/A | No preview surface renders the bouncer. |

No manual cross-surface parity to enforce — all consumers read the same shared `bouncer.ts` + `place_pool` columns. **Visual/UX granularity contract (Phase 3.6) is N/A — no visible surface introduced or modified.**

---

## 7. 🔒 LOCKED requirements

- L1. `PlaceRow.fetched_via?: string | null` added exactly as in §2.1.
- L2. B7 push gated behind `!isBusinessAuthored(place)` exactly as in §2.3; B8 unchanged.
- L3. The predicate is `fetched_via === 'business_authored'` — narrowest correct (NOT `google_place_id IS NULL`, NOT "any non-google source").
- L4. `fetched_via` added to the SELECT in `run-bouncer`, `run-pre-photo-bouncer`, `admin-review-venue-claim` (§3.1) and to the `placeForBouncer` return object (§3.2).
- L5. The literal `B7:no_google_photos` appears ONLY in `_shared/bouncer.ts` (+ its tests). No hand-rolled copy elsewhere (I-TWO-PASS-BOUNCER-RULE-PARITY gate).
- L6. No DB migration. No new backend source file other than (optionally) test files.
- L7. `bounce()` stays pure (zero IO) and deterministic (I-BOUNCER-DETERMINISTIC) — `fetched_via` is plain row data, no AI/keyword judgment.
- L8. The META-ORCH-1062 gate (`meta-orch-1062-approval-go-live.mjs`) stays green — do not alter the scorer-invoke, demotion, or signal-loop logic.

## 8. 🎨 OPEN (implementor's craft)

- O1. Whether to remove the now-redundant `placeForBouncer` photo-swap (lines 332-348). Allowed but not required; if removed, keep the pipeline behavioral test green.
- O2. Exact placement/wording of the `isBusinessAuthored` helper and comments (keep them clear and cite ORCH-1067).
- O3. Whether `isBusinessAuthored` is module-private or exported for direct unit testing (exporting is fine and makes a tighter test).
- O4. Additional defensive test cases beyond the required set in §10.

---

## 9. Success criteria

1. **SC-1 (happy):** `bounce()` over a place with `fetched_via='business_authored'`, empty Google `photos`, ≥1 `stored_photo_urls`, A_COMMERCIAL with website+hours → `is_servable=true`, `reasons=[]` (no `B7:no_google_photos`, no `B8:no_stored_photos`).
2. **SC-2 (adversarial B8):** `bounce()` over `fetched_via='business_authored'` with empty Google `photos` AND empty/null `stored_photo_urls` (final pass) → `is_servable=false`, `reasons` includes `B8:no_stored_photos` and does NOT include `B7:no_google_photos`.
3. **SC-3 (no regression):** `bounce()` over a Google-seeded place (`fetched_via='nearby_search'` or `fetched_via` absent) with empty Google `photos` → `reasons` includes `B7:no_google_photos` (unchanged behavior).
4. **SC-4 (two-pass parity):** for the same `fetched_via='business_authored'` row, `bounce(row)` and `bounce(row, {skipStoredPhotoCheck:true})` differ ONLY in whether `B8:no_stored_photos` is present — B7 absent in both.
5. **SC-5 (live unblock):** after deploy, a re-bounce / re-approve of place_pool `8b72…` (Lantern & Vine) yields `is_servable=true`, `bouncer_reason=NULL`. (Verifiable via the admin approve path or a `run-bouncer` city pass that includes it.)
6. **SC-6 (SELECT coverage):** `run-bouncer`, `run-pre-photo-bouncer`, `admin-review-venue-claim` SELECT strings include `fetched_via`; `placeForBouncer` return includes `fetched_via`. (Grep-verifiable.)
7. **SC-7 (gates green):** `deno test` on the bouncer + pipeline tests, `scripts/ci-check-invariants.sh` (I-TWO-PASS-BOUNCER-RULE-PARITY), and `meta-orch-1062-approval-go-live.mjs --self-test` all pass.

---

## 10. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 (happy) | business-authored w/ stored photos, no Google photos | `fetched_via='business_authored'`, `photos:[]`, `stored_photo_urls:['u']`, website+hours, types `['restaurant']` | `is_servable=true`, `reasons=[]` | `bounce()` unit (`bouncer.test.ts`) |
| T-02 (adversarial B8) | business-authored, NO stored photos | `fetched_via='business_authored'`, `photos:[]`, `stored_photo_urls:[]` (final pass, no `skipStoredPhotoCheck`) | `is_servable=false`, `reasons` ⊇ `['B8:no_stored_photos']`, `reasons` ⊉ `B7:no_google_photos` | `bounce()` unit |
| T-03 (regression) | Google-seeded, no Google photos | `fetched_via='nearby_search'`, `photos:[]`, `stored_photo_urls:['u']` | `reasons` ⊇ `['B7:no_google_photos']` | `bounce()` unit |
| T-04 (regression, absent provenance) | `fetched_via` undefined, no Google photos | omit `fetched_via`, `photos:[]` | `reasons` ⊇ `['B7:no_google_photos']` (absent ⇒ Google-treated) | `bounce()` unit |
| T-05 (parity) | business-authored across both passes | same row as T-01 but `stored_photo_urls:[]`; run `bounce(r)` and `bounce(r,{skipStoredPhotoCheck:true})` | final has `B8`, pre-photo does not; NEITHER has `B7` | `bounce()` unit |
| T-06 (cluster-rule still applies) | business-authored, no website | `fetched_via='business_authored'`, `photos:[]`, `stored_photo_urls:['u']`, `website:null`, A_COMMERCIAL | `reasons` ⊇ `['B4:no_website']`, ⊉ `B7` (mirrors The Tuscanny Place) | `bounce()` unit |
| T-07 (pipeline integration) | `placeForBouncer` passes `fetched_via` through | business-authored place object | resulting `bounce()` verdict servable; `placeForBouncer` output has `fetched_via='business_authored'` | pipeline behavioral test |
| T-08 (admin approve, mechanism) | re-bounce in `runApproveGoLive` over a business-authored projection incl. `fetched_via` | injected fake admin client returning the business-authored row | `runApproveGoLive` flips `is_servable=true` (no B7) and proceeds to scoring | admin-review adversarial test (extend existing `meta_orch_1062_approve_orchestration.adversarial.test.ts` OR a focused new case) |

> If a brand-new `__tests__/*.test.ts` file is added under any `supabase/functions/` dir, add it to the ORCH-0863 C7 backend allowlist in the SAME commit (`.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`). Modifying EXISTING test files needs no allowlist entry.

---

## 11. Implementation order

1. `_shared/bouncer.ts` — add `fetched_via` to `PlaceRow`; add `isBusinessAuthored`; gate B7 (§2). 
2. `run-bouncer/index.ts`, `run-pre-photo-bouncer/index.ts`, `admin-review-venue-claim/index.ts` — append `fetched_via` to the SELECT string (§3.1).
3. `run-business-place-authoring-pipeline/index.ts` — add `fetched_via` to `placeForBouncer` return (§3.2).
4. Tests — add T-01…T-06 to `_shared/__tests__/bouncer.test.ts`; T-07 to the pipeline behavioral test; T-08 to the admin-review adversarial test (§10).
5. Run gates: `deno test` (bouncer + pipeline + admin-review), `bash scripts/ci-check-invariants.sh`, `node .github/scripts/strict-grep/meta-orch-1062-approval-go-live.mjs --self-test`.
6. **Redeploy edge functions (all four `bounce()` callers — see §12).**
7. (Orchestrator, post-deploy, optional) one-shot normalize: run the admin approve (or a `run-bouncer` city pass) over the 3 business-authored rows so Lantern & Vine flips servable and Lumen's state is reconfirmed (F-3).

---

## 12. Edge functions to redeploy (ALL FOUR)

Because `_shared/bouncer.ts` is a bundled dependency of every caller, ALL FOUR must be redeployed even though only three have SELECT edits:

1. `run-bouncer`
2. `run-pre-photo-bouncer`
3. `admin-review-venue-claim`
4. `run-business-place-authoring-pipeline`

Deploy from `main` after the PR merges (per COMMS-0015 / `ship-verify-merge-before-reap` — never deploy a worktree as the durable source). `admin-review-venue-claim` must preserve `verify_jwt` behavior already configured; the other three are service-role/internal.

---

## 13. Invariants

**Preserved:**
- **I-TWO-PASS-BOUNCER-RULE-PARITY** — B7 skip is photo-pass-independent → fires identically in both passes; B8 remains the only cross-pass difference. B7 string stays inside `bouncer.ts` (CI gate green).
- **I-BOUNCER-DETERMINISTIC** — `fetched_via` is plain row data; no AI/keyword judgment added.
- **I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS** — B10/B11/B12 unchanged.
- **I-SCORER-INVOKE-HAS-SIGNAL-ID / I-NO-CLAIM-DEMOTION / I-APPROVE-PRODUCES-SCORES** (META-ORCH-1062) — untouched; gate stays green.

**New (proposed — orchestrator ratifies at CLOSE):**
- **I-BOUNCER-B7-SKIPS-BUSINESS-AUTHORED** — every `bounce()` verdict over a row with `fetched_via='business_authored'` MUST NOT contain `B7:no_google_photos`; B8 (stored-photo gate) MUST still apply in the final pass. Enforced by T-01…T-05 (Deno) and structurally by the `isBusinessAuthored` predicate guarding the single B7 push site. Severity if violated: S2 (re-introduces the universal-block; every business-authored venue stranded off-deck).

---

## 14. Regression prevention

- The B7 skip lives at the SINGLE B7 push site inside `bounce()` behind a named predicate — no duplicated/hand-rolled B7 check can drift (and the parity CI gate forbids the string elsewhere).
- Tests T-03/T-04 lock the no-regression behavior for Google-seeded + absent-provenance rows; T-02/T-06 lock that business-authored venues without stored photos / without website still fail. A future change that broadens the skip (e.g. to all `google_place_id IS NULL`) would not be caught by these tests but is explicitly LOCKED out in §7 L3 with the rationale inline.
- Protective comment at the B7 site (§2.3) explains WHY the skip exists and that it is the ONLY photo-pass-independent exception.
