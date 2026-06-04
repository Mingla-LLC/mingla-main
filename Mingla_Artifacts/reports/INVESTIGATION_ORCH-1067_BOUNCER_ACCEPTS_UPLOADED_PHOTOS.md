# INVESTIGATION — ORCH-1067 [bouncer accepts business-authored uploaded photos]

**Skill:** mingla-forensics (INVESTIGATE)
**Date:** 2026-06-03
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1067-[bouncer-accepts-uploaded-photos]/` on branch `ORCH-1067-bouncer-accepts-uploaded-photos`
**Confidence:** root cause **proven** (live DB probe + full code trace of every `bounce()` caller)
**Comms:** read `COMMS_LEDGER.md` on entry. **COMMS-0018** (WARN → META-ORCH-1009) factored: the deployed `admin-review-venue-claim` WS7 go-live path (`runApproveGoLive`) is the exact code that B7-rejects business-authored venues; this ORCH fixes the photo gate inside that path. No BLOCK rows target this skill/ORCH.

---

## 1. Symptom (expected vs actual)

**Expected (program goal):** A business authors/claims a venue, uploads its own hero + gallery photos, the admin approves it, and it appears on the consumer deck — "existing venues onboard frictionlessly → appear on the deck."

**Actual (proven live):** EVERY business-authored venue is permanently blocked from the deck at admin approval. The deck "bouncer" rule **B7** (`B7:no_google_photos`) requires a non-empty Google `photos` array. A business-authored venue is not on Google, so its `photos` column is empty/`[]` even though it has real uploaded photos in `stored_photo_urls`. B7 fires, the bouncer returns `is_servable=false`, and `runApproveGoLive` records `bouncer_reason='B7:no_google_photos'` without flipping `is_servable` → the venue never reaches the deck.

**Live reproducer (place_pool `8b720912-a0bf-405a-88f8-773eca6f3f33`, "Lantern & Vine"):**
`fetched_via='business_authored'`, `google_place_id=NULL`, Google `photos` count `0`, `stored_photo_urls` count `7`, `business_status='OPERATIONAL'`, website `https://www.deathandcompany.com` (own domain), `opening_hours` populated, types `['restaurant','food','point_of_interest']` (cluster A_COMMERCIAL). Current DB state: `is_servable=false`, **`bouncer_reason='B7:no_google_photos'` (single reason)**, `bouncer_validated_at=2026-06-04 01:47:57+00`.

---

## 2. Investigation manifest (every file read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `COMMS_LEDGER.md` | mandatory entry scan; COMMS-0018 relevance |
| 2 | `supabase/functions/_shared/bouncer.ts` | the `bounce()` pure logic + B7 (line 335-338) — root cause site |
| 3 | `supabase/functions/_shared/bouncerBatch.ts` | shared batch loop; how the two passes call `bounce()` |
| 4 | `supabase/functions/run-bouncer/index.ts` | caller #1 (final pass) — `SELECT_FIELDS` + PlaceRow build |
| 5 | `supabase/functions/run-pre-photo-bouncer/index.ts` | caller #2 (pre-photo pass) — `SELECT_FIELDS` |
| 6 | `supabase/functions/admin-review-venue-claim/index.ts` | caller #3 (`runApproveGoLive`) — `BOUNCER_SELECT` + raw `bounce(ppRow)` — the proven blocking path |
| 7 | `supabase/functions/run-business-place-authoring-pipeline/index.ts` | caller #4 (3 sites) — `placeForBouncer()` already work-arounds B7 at pipeline level |
| 8 | `claim-search-pool/index.ts`, `backfill-place-photos/index.ts`, `run-signal-scorer/index.ts` | DISPROVED as callers — reference "bouncer" only in comments/columns, never `bounce()` |
| 9 | `_shared/__tests__/bouncer.test.ts` | existing B7/two-pass tests; `basePlace()` helper for new test cases |
| 10 | `.github/scripts/strict-grep/meta-orch-1062-approval-go-live.mjs` | confirm fix doesn't trip the scorer/demotion gate |
| 11 | `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | confirm C7 no-new-backend-files (no new file → no allowlist needed) |
| 12 | `scripts/ci-check-invariants.sh` (lines 547-570) | `I-TWO-PASS-BOUNCER-RULE-PARITY` keyword gate — fix must keep B7 string in `bouncer.ts` only |
| 13 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` | I-TWO-PASS-BOUNCER-RULE-PARITY + I-BOUNCER-DETERMINISTIC text |

---

## 3. Findings

### 🔴 F-1 (ROOT CAUSE) — B7 is universal in `bounce()`; business-authored venues can never have Google photos

| Field | Evidence |
|-------|----------|
| **File + line** | `supabase/functions/_shared/bouncer.ts:335-338` |
| **Exact code** | `// B7: Google photos required (universal …).`<br>`if (!hasGooglePhotos(place)) reasons.push('B7:no_google_photos');` where `hasGooglePhotos = Array.isArray(place.photos) && place.photos.length > 0` (line 243-245) |
| **What it does** | Pushes `B7:no_google_photos` whenever the Google `photos` array is empty/null, for ALL places regardless of provenance. There is no `fetched_via` field on `PlaceRow` (lines 41-54), so `bounce()` cannot distinguish a business-authored venue from a Google-seeded one. |
| **What it should do** | Skip B7 when the place is business-authored (`fetched_via='business_authored'`). Business-authored venues are gated on B8 (`stored_photo_urls`), which they have. Google-seeded places (`nearby_search`/`detail_refresh`/`text_search`) are unchanged — still require B7. |
| **Causal chain** | brand authors venue → pipeline writes `stored_photo_urls` (7 photos) but no Google `photos` → admin approves → `runApproveGoLive` runs `bounce(ppRow as PlaceRow)` with the raw `photos` column (empty) → `hasGooglePhotos=false` → B7 pushed → `reasons=['B7:no_google_photos']` → `is_servable=false` → go-live flip skipped → venue stays off-deck forever. |
| **Verification step** | Live DB: place_pool `8b72…` shows `bouncer_reason='B7:no_google_photos'` (single reason), `is_servable=false`, `stored_photo_count=7`, `google_photo_count=0`, `fetched_via='business_authored'`. Tracing `bounce()` by hand on this row: B1 (cluster A_COMMERCIAL, not EXCLUDED) pass; B2 OPERATIONAL pass; B3 name+lat+lng present pass; B9/B10/B11/B12 no match; **B7 fires** (photos empty); B8 pass (7 stored); B4/B5 own-domain pass; B6 hours present pass. Only B7 is in `reasons`. ∎ |

### 🟠 F-2 (CONTRIBUTING) — `admin-review-venue-claim` uses a raw `bounce()` with no photo-swap workaround, unlike the pipeline

The business pipeline already has a B7 workaround at the **caller** level: `run-business-place-authoring-pipeline/index.ts → placeForBouncer()` (lines 327-363) maps `stored_photo_urls` into the `photos` slot for business-authored rows before calling `bounce()` (operator decision, META-ORCH-1009 Sub-E, 2026-06-01). All three pipeline `bounce()` sites (lines 1264, 1363, 1463) therefore PASS B7 for business-authored venues. But `admin-review-venue-claim/runApproveGoLive` (the actual go-live path) calls `bounce(ppRow as PlaceRow)` (line 119) over a raw `BOUNCER_SELECT` projection (lines 58-59) that does NOT swap photos — so the pipeline says "deck_eligible" yet the approve re-bounce B7-rejects the same venue. This caller-level inconsistency is exactly the divergence I-TWO-PASS-BOUNCER-RULE-PARITY warns about, re-expressed across the pipeline-vs-approval boundary. **Fixing inside `bounce()` (not in callers) collapses this divergence**: the photo-swap in `placeForBouncer` becomes redundant (harmless, can be left or removed by the implementor), and every caller behaves identically.

### 🟡 F-3 (HIDDEN FLAW) — `Lumen Wine Bar` is `is_servable=true` with zero Google photos and only 1 stored photo — incoherent live state

Live probe: business-authored `Lumen Wine Bar` (`3b10d972-…`) has `is_servable=true`, `bouncer_reason=NULL`, `google_photo_count=0`, `stored_photo_count=1`. Under the CURRENT (broken) `bounce()`, a raw re-bounce would B7-fail it — yet it is live. This is residue of the COMMS-0018 deployed-v92 admin path that flipped servability inconsistently. It is NOT caused by this ORCH and NOT fixed by it, but it confirms the bug class and means a future re-bounce of already-live business-authored rows must not regress them. After this ORCH's fix, a re-bounce of Lumen correctly keeps it servable (B7 skipped, B8 satisfied by its 1 stored photo). Registered for orchestrator awareness; no action required in this ORCH.

### 🔵 F-4 (OBSERVATION) — only 4 files call `bounce()`; 3 already carry `fetched_via`, 1 does not

Complete `bounce()` caller census (grep `bounce(` across `supabase/functions/`, each verified by reading):
1. `run-bouncer/index.ts` — `SELECT_FIELDS` (line 37-38). **No `fetched_via`.**
2. `run-pre-photo-bouncer/index.ts` — `SELECT_FIELDS` (line 44-45). **No `fetched_via`.**
3. `admin-review-venue-claim/index.ts` — `BOUNCER_SELECT` (line 58-59), `bounce(ppRow)` at line 119. **No `fetched_via`.**
4. `run-business-place-authoring-pipeline/index.ts` — 3 sites (lines 1264, 1363, 1463), each builds the place via `placeForBouncer()` from a `.select("*")` row (lines 1153, 1338, 1450). **`fetched_via` already present (line 335 reads it).**

So three SELECTs must add `fetched_via`; the pipeline's `select("*")` already includes it.

---

## 4. Five-layer cross-check

| Layer | Finding |
|-------|---------|
| **Docs** | Program goal (memory: existing venues onboard frictionlessly → deck) + META-ORCH-1009 Sub-E operator decision (pipeline comment lines 336-342: "let stored_photo_urls satisfy the photo gate for business-authored rows") say business-authored uploaded photos ARE the venue's visual. Doc layer says they should pass. |
| **Schema** | `place_pool.fetched_via` is a real column; live values: `nearby_search` (80,265), `detail_refresh` (8,133), `business_authored` (3), `text_search` (1). `business_authored` rows are EXACTLY the 3 with `google_place_id IS NULL` AND `google_photo_count=0` AND `stored_photo_count>0`. No constraint blocks the fix; **no migration needed** (pure edge-fn logic). |
| **Code** | `bounce()` line 338 fires B7 universally; `PlaceRow` has no `fetched_via`. Pipeline works around it at caller level; admin-review does not. Contradiction with doc layer. |
| **Runtime** | `runApproveGoLive` re-bounces, gets `B7:no_google_photos`, records the reason, skips the `is_servable=true` flip (lines 119-137). Venue stays off-deck. |
| **Data** | Lantern & Vine: `bouncer_reason='B7:no_google_photos'`, `is_servable=false`. The single-reason value proves B7 is the SOLE blocker. |

**Contradiction = the bug:** Doc + schema say business-authored uploaded photos suffice; code (B7 universal) says they don't. Code is wrong.

---

## 5. Outcome & journey step-back

- **User goal:** A real venue owner lists their venue, uploads their own photos, and shows up where customers swipe — without being on Google.
- **Journey:** author venue → pipeline (writes stored photos, bounces via placeForBouncer → "deck_eligible") → admin reviews → admin approves → **go-live re-bounce** → flip `is_servable=true` → signal scorer runs → venue ranks on deck.
- **Divergence point:** the go-live re-bounce (`runApproveGoLive`, admin-review line 119) — the ONE place that bounces over the raw `photos` column. It B7-rejects, the flip is skipped, the journey dead-ends.
- **Does fixing B7 deliver the outcome?** YES, and it is necessary AND sufficient for Lantern & Vine: B7 is its only reason; after skip it satisfies B1/B2/B3/B4/B5/B6/B8 and is_servable becomes true → scorer runs (COMMS-0018 keystone signal_id fix already on this branch's base) → deck. No other node in the journey blocks this venue. (Caveat: The Tuscanny Place still correctly fails on B4:no_website until it adds a website — the fix is narrow, not a blanket pass.)

---

## 6. Blast radius

- **Edge functions:** 4 `bounce()` callers (above). `bouncer.ts` is shared; both two-pass runners + admin-review + pipeline all consume the new behavior. All four must be redeployed (3 because their SELECT changes; pipeline because `_shared/bouncer.ts` changes its bundled dependency).
- **Consumer deck:** business-authored venues become servable → eligible to appear. Google-seeded deck unchanged.
- **Admin:** the approve flow now flips `is_servable=true` for business-authored venues with stored photos.
- **DB:** no schema change. No migration.
- **CI gates:** `meta-orch-1062-approval-go-live.mjs` (unaffected — no scorer/demotion change). `I-TWO-PASS-BOUNCER-RULE-PARITY` in `ci-check-invariants.sh` (preserved — B7 string stays inside `bouncer.ts`; DO NOT hand-roll it elsewhere). `orch-0863` C7 no-new-backend-files (no new file unless a brand-new test file is added → then allowlist it).
- **Invariants:** I-TWO-PASS-BOUNCER-RULE-PARITY (the skip is photo-pass-independent → fires identically in both passes → parity preserved). I-BOUNCER-DETERMINISTIC (still pure type/data logic; `fetched_via` is a data field, not AI/keyword). New invariant proposed: I-BOUNCER-B7-SKIPS-BUSINESS-AUTHORED.

---

## 7. Predicate decision (narrowest correct)

**Chosen predicate: `fetched_via === 'business_authored'`.**

Rationale:
- It is the explicit provenance marker the pipeline already sets on insert (line 576) and already reads in `placeForBouncer` (line 335) — perfectly aligned, zero new semantics.
- Live data: all 3 `business_authored` rows have `google_place_id IS NULL` and `google_photo_count=0`; all 80,399 Google-sourced rows (`nearby_search`/`detail_refresh`/`text_search`) have `google_place_id` set and ~100% Google photos. The predicate cleanly partitions the population.
- **Rejected broader predicate** `google_place_id IS NULL` (or "any non-google source"): broader than needed, and risks admitting a malformed Google row that lost its `google_place_id`. `fetched_via` is the intent-bearing field; `google_place_id` is incidental. If a business-authored venue is later matched to a Google place, the claim flow updates `fetched_via` accordingly, and B7 re-applies — the correct behavior.

---

## 8. Confidence & gaps

**Confidence: PROVEN.** Root cause has all six fields; ≥2 candidate predicates considered with the broader one disproven by data; live DB confirms B7 is Lantern & Vine's sole blocker and that the population partitions cleanly. Pure backend/edge-fn logic — no simulator repro required (Prime Directive 7 backend exemption). No web access gaps (no third-party API behavior in scope — Google photos are already-persisted data, not a live call).

---

## 9. Discoveries for orchestrator

- **F-3 (Lumen Wine Bar incoherent live state):** `is_servable=true` with 0 Google + 1 stored photo, residue of COMMS-0018 deployed-v92. Not fixed here; not regressed by this ORCH. Consider a one-shot re-bounce of all 3 business-authored rows post-deploy to normalize state.
- The pipeline's `placeForBouncer` photo-swap workaround (lines 332-348) becomes redundant once B7 is fixed in `bounce()`. Leaving it is harmless (still produces a passing verdict); the implementor MAY simplify it but that is OUT of this ORCH's required scope.
