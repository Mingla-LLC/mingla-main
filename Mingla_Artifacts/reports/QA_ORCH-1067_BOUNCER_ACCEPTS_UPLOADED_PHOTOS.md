# QA — ORCH-1067 [bouncer accepts business-authored uploaded photos]

**Skill:** mingla-tester (TEST mode, Claude)
**Date:** 2026-06-03
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1067-[bouncer-accepts-uploaded-photos]/` on branch `ORCH-1067-bouncer-accepts-uploaded-photos`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1067_BOUNCER_ACCEPTS_UPLOADED_PHOTOS.md`
**Implementation report:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1067_BOUNCER_ACCEPTS_UPLOADED_PHOTOS.md`
**Type:** edge-function-logic-only (backend). NO migration, NO new edge-fn source. **Sim gate EXEMPT** — backend/pure-logic change, no UI/runtime surface (SPEC §6 confirms no client UI touched; effect is data-driven via `place_pool.is_servable`).

---

## VERDICT: PASS

The fix is correct, scoped exactly to `fetched_via === 'business_authored'`, B8 still gates business-authored, no Google-place regression, and two-pass parity holds. One **P1 CI blocker** (missing C7 backend allowlist entry — the PR would have been blocked at merge) was **found and FIXED by the tester in this commit**, restoring the gate to green. With that fix, zero open P0/P1 remain.

- P0: 0 | P1: 0 open (1 found + fixed) | P2: 0 | P3: 1 | P4: 1
- Sim evidence: **EXEMPT — backend pure-logic** (no UI/runtime surface; SPEC §6).
- Regression tests: implementor = `supabase/functions/_shared/__tests__/bouncer.test.ts` (T-1067-01..06 + helper) + pipeline T-07 + admin T-08/T-08b — ✅ fails-on-revert reproduced by tester @ guard-removal. tester = `supabase/functions/_shared/__tests__/bouncer_orch1067_adversarial.test.ts` (ADV-01..05) — ✅ adversarial (exact-string-leak angle), fails-on-revert proven.

---

## Contract-verification table (file:line)

| # | Contract (SPEC) | Evidence (file:line) | Verdict |
|---|---|---|---|
| L1 | `PlaceRow.fetched_via?: string \| null` added | `_shared/bouncer.ts:52-56` | PASS |
| L2 | B7 push gated behind `!isBusinessAuthored(place)`; B8 unchanged | `_shared/bouncer.ts:366-368` (B7), `:373-375` (B8 unchanged) | PASS |
| L2/L3 | predicate is exact `fetched_via === 'business_authored'` (narrowest) | `_shared/bouncer.ts:266-268` | PASS |
| L4a | `run-bouncer` SELECT includes `fetched_via` | `run-bouncer/index.ts:38` | PASS |
| L4b | `run-pre-photo-bouncer` SELECT includes `fetched_via` | `run-pre-photo-bouncer/index.ts:45` | PASS |
| L4c | `admin-review-venue-claim` BOUNCER_SELECT includes `fetched_via` (double-quoted) | `admin-review-venue-claim/index.ts:59` | PASS |
| L4d | `placeForBouncer` return includes `fetched_via` | `run-business-place-authoring-pipeline/index.ts:364` | PASS |
| L5 | `B7:no_google_photos` literal ONLY in `bouncer.ts` (+ tests / ci-check grep) | census: `bouncer.ts`, `_shared/__tests__/bouncer.test.ts`, `_shared/__tests__/bouncer_orch1067_adversarial.test.ts` (tester-added, under allowlisted `__tests__/`), and `scripts/ci-check-invariants.sh` (the grep itself). No hand-rolled copy in any non-canonical source. | PASS |
| L6 | No DB migration, no new non-test backend source | `git diff origin/main...HEAD --name-only` shows zero `supabase/migrations/`; only `bouncer.ts` + 4 index.ts + 3 test files under `supabase/functions/` | PASS |
| L7 | `bounce()` stays pure (zero IO); `fetched_via` is plain row data | `_shared/bouncer.ts:266-268` (predicate is a pure field compare) | PASS |
| L8 | META-ORCH-1062 gate green (scorer-invoke/demotion/signal-loop untouched) | `meta-orch-1062-approval-go-live.mjs --self-test` → `# Self-test PASSED` | PASS |

---

## VERIFY 1 — B7 skip scoped to ONLY business_authored; no Google-place regression

- **Skip is scoped:** `bounce()` pushes `B7:no_google_photos` iff `!isBusinessAuthored(place) && !hasGooglePhotos(place)` (`bouncer.ts:366`). `isBusinessAuthored` is exact-string `fetched_via === 'business_authored'` (`:267`).
- **No regression (Google-seeded):** a `fetched_via='nearby_search'` place with empty `photos` STILL gets `B7:no_google_photos` — proven by T-1067-03 (green) and helper test (`nearby_search`/`detail_refresh`/`text_search`/null/absent all return `isBusinessAuthored=false`).
- **No leak to near-misses (tester-added):** ADV-01 proves `'business-authored'` (hyphen), `'businessauthored'`, `'BUSINESS_AUTHORED'`, `' business_authored '` (whitespace), `'claim_existing'`, and suffix/prefix variants ALL still fire B7. Only the exact literal skips (ADV-02 control). Locks SPEC §7 L3.
- **B7 literal census:** the string `B7:no_google_photos` appears outside `bouncer.ts` only in the two `_shared/__tests__/` test files (canonical/allowlisted) and inside `scripts/ci-check-invariants.sh` (the grep pattern). I-TWO-PASS-BOUNCER-RULE-PARITY preserved.

## VERIFY 2 — B8 still gates business-authored; two-pass parity holds

- **B8 still gates:** T-1067-02 (green) — `business_authored` + empty `photos` + empty `stored_photo_urls` (final pass) → `is_servable=false`, `reasons` ⊇ `['B8:no_stored_photos']`, ⊉ `B7`. Confirmed at the admin layer too (T-08b green: business-authored, no stored photos → stays off-deck on B8).
- **Two-pass parity:** the skip predicate is a pure function of `fetched_via`, independent of `skipStoredPhotoCheck`, so B7's presence is identical across passes. T-1067-05 (green) + tester ADV-05 (green) both assert the two passes differ ONLY by `B8:no_stored_photos`; symmetric-difference check in ADV-05 confirms `onlyInFinal=['B8:no_stored_photos']`, `onlyInPre=[]`.

## VERIFY 3 — All 4 SELECTs include `fetched_via`

Grep-verified (see contract table L4a-L4d). All four projections carry `fetched_via`, so the predicate sees real data at runtime (not always-undefined).

## VERIFY 4 — Test runs + fails-on-revert + pre-existing failures

**Captured final run (all 4 test files, `deno test --no-check --allow-read --allow-env --allow-net`):**
```
120 passed | 2 failed (278ms)
```
- All ORCH-1067 tests green: bouncer T-1067-01..06 + helper (7), tester adversarial ADV-01..05 (5), pipeline T-07 (1), admin T-08/T-08b (2).
- The **2 failures are PRE-EXISTING**: `ORCH-0678 T-03a` + `T-03b` use fixture `website: 'https://x.com'` (with a now-stale comment "not in SOCIAL_DOMAINS — own-domain"); `x.com` was later added to `SOCIAL_DOMAINS` (`bouncer.ts:224`), so they now hit `B5:social_only`. **Confirmed identical on origin/main** via a throwaway worktree at `4385f57d4`: base shows `89 passed | 2 failed` with the SAME two tests failing (89 = 96 with-ORCH-1067 minus the 7 ORCH-1067 tests not yet present on base). NOT an ORCH-1067 regression. (Cleanup of those fixtures needs its own ORCH per the append-only test rule — Discovery #1.)

**fails-on-revert (tester-reproduced):** reverting the guard to `if (!hasGooglePhotos(place))`:
- `bouncer.test.ts` → T-1067-01/02/05/06 FAIL (4 of 7); T-03/T-04/helper correctly stay green (Google-path tests). Matches implementor's claim exactly.
- `admin-review .adversarial` → T-08 + T-08b FAIL (both).
- tester `bouncer_orch1067_adversarial.test.ts` → ADV-02 (exact-string control) + ADV-04 (revert anchor) FAIL; ADV-01/03/05 stay green (near-miss anchors, by design).
- `bouncer.ts` restored byte-clean after each revert (verified `git diff --stat` empty).

**Other gate confirmations:**
- `meta-orch-1062-approval-go-live.mjs --self-test` → `# Self-test PASSED`.
- `deno check supabase/functions/_shared/bouncer.ts` → exit 0; `deno check` on tester adversarial test → clean.
- Pre-existing local-script note (Discovery #2): `scripts/ci-check-invariants.sh` I-TWO-PASS parity grep flags `pipeline_behavioral.test.ts:112` (`B8:no_stored_photos` in a META-ORCH-1009 Sub-E coaching fixture). Confirmed the literal is on origin/main (1 occurrence) and NOT in the ORCH-1067 diff (0) → pre-existing local-shell false positive; authoritative GitHub `.mjs` gates are green.

## VERIFY 5 — Tester adversarial test (STEP 0.5)

- **Path:** `supabase/functions/_shared/__tests__/bouncer_orch1067_adversarial.test.ts` (NEW file).
- **Different angle:** the implementor's tests cover the happy path + the exact-string positive and the `nearby_search`/absent negatives. The tester suite attacks **predicate exactness / leak** — near-miss & typo provenance strings (hyphen, no-separator, case, whitespace, real `claim_existing`, suffix/prefix) must STILL fire B7 through the full `bounce()` path; **double-effect** (business_authored + Google photos behaves identically, no double-count); and a **cross-pass leak probe** on a near-miss row (full unmodified two-pass treatment).
- **Result:** ADV-01..05 all PASS (5/5).
- **fails-on-revert:** ADV-02 + ADV-04 fail on guard removal (proven above).
- **Allowlist:** because it is a NEW file under `supabase/functions/`, added to the ORCH-0863 C7 backend allowlist (`ORCH_1067_BACKEND_ALLOWLIST`) in the SAME commit.

---

## Defects (severity-ranked)

### P1 (FOUND + FIXED in this commit) — C7 backend allowlist missing `bouncer.ts` + `bouncer.test.ts` → PR merge would be BLOCKED
The implementation report (§2 / §36-38) claimed "no new test file added, so NO ORCH-0863 C7 backend allowlist entry is required." This is **incorrect for the C7 gate**: `checkNoNewBackendFiles()` (`orch-0863-marketing-hub-phase-b.mjs:219-243`) diffs `git diff --name-only origin/main...HEAD` and flags ANY path under `supabase/functions/` (new OR modified) that is not in the aggregated ALLOWLIST. The workflow `strict-grep-mingla-business.yml` runs on every `pull_request` to `main` touching `supabase/functions/**`, so it WOULD run against the ORCH-1067 PR. Running the gate reproduced the failure:
```
FAIL [C7: no-new-backend-files] offenders:
  supabase/functions/_shared/__tests__/bouncer.test.ts
  supabase/functions/_shared/bouncer.ts
```
(The other 5 touched `supabase/functions/` files — the 4 index.ts + 2 of the 3 test files — are already allowlisted under prior ORCH-0100/0101/META-ORCH-1009/1062/1064 blocks, which is why only these 2 surfaced.)
**Fix applied (tester):** added `ORCH_1067_BACKEND_ALLOWLIST` (`bouncer.ts` + `bouncer.test.ts` + the new tester adversarial test) and spread it into `ALLOWLIST`. Re-ran the gate → `OK [C7: no-new-backend-files]` + `# All checks PASS`. Without this fix the verdict would have been CONDITIONAL/FAIL (merge-blocked).

### P3 — stale comment on the x.com fixtures (pre-existing, not ORCH-1067)
`bouncer.test.ts` T-03a/T-03b carry `website: 'https://x.com', // not in SOCIAL_DOMAINS — own-domain`, but `x.com` IS now in `SOCIAL_DOMAINS`. Causes the 2 pre-existing failures. Needs its own ORCH + `[TEST-MOD-APPROVED]` to retarget the fixtures to a neutral own-domain. Flagged for orchestrator (matches implementor Discovery #1).

### P4 (praise) — minimal, single-site, named-predicate fix
The behavioral change is a single guarded push site behind a pure named predicate `isBusinessAuthored`, with the B7 literal kept inside `bouncer.ts`. Exactly the narrowest correct shape; no broadening to `google_place_id IS NULL`. Clean.

---

## Discoveries for orchestrator

1. **C7 allowlist gap fixed by tester** (P1 above). The implementor's "no allowlist needed for modified test files" reasoning does not hold for the ORCH-0863 C7 gate, which catches modifications, not just new files. The orchestrator should be aware this gate is broader than the report assumed; the fix is already in the ORCH-1067 commit.
2. **Pre-existing x.com fixture rot** (P3) — separate ORCH needed.
3. **Pre-existing local ci-check-invariants.sh false positive** on `pipeline_behavioral.test.ts` (Discovery #2 in impl report) — confirmed pre-existing; authoritative `.mjs` CI is green. Optional: widen the local shell exclude to `supabase/functions/**/__tests__/`.
4. SC-5 (live unblock of Lantern & Vine `8b72…`) is correctly DEFERRED to post-merge deploy (orchestrator one-shot) — out of code-level QA scope.

---

## Completion condition (machine-verified)

1. Every independent test green — ✅ (120 passed; the only 2 fails are pre-existing x.com, proven identical on origin/main).
2. `deno check` on touched source + tester test clean — ✅ (the pre-existing TS2322 on `bouncer.test.ts:304` `photos: pick(photos)` is on origin/main, NOT in the ORCH-1067 diff; CI runs Deno tests with `--no-check`).
3. Both regression tests in `git diff origin/main...HEAD --name-only`; tester test attacks a different angle (exact-string leak); implementor fails-on-revert reproduced — ✅.
4. UI/runtime legs — N/A (backend pure-logic, sim-exempt).
5. Zero open P0/P1 — ✅ (the 1 P1 found was fixed in-commit).
