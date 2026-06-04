# IMPLEMENTATION — ORCH-1067 [bouncer accepts business-authored uploaded photos]

**Skill:** mingla-implementor (Claude)
**Date:** 2026-06-03
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1067-[bouncer-accepts-uploaded-photos]/` on branch `ORCH-1067-bouncer-accepts-uploaded-photos`
**SPEC:** `Mingla_Artifacts/specs/SPEC_ORCH-1067_BOUNCER_ACCEPTS_UPLOADED_PHOTOS.md`
**Type:** edge-function-logic-only. NO DB migration. NO new backend file (only existing test files modified).
**Status:** implemented and verified (tests green + fails-on-revert proven).

---

## 1. Summary

The deck "bouncer" rejected every business-authored venue with `B7:no_google_photos`
because such venues have real uploaded photos (`stored_photo_urls`) but no Google
`photos` array. Fix: skip B7 ONLY for `fetched_via='business_authored'` rows; B8
(stored-photos required) remains their real photo gate. Google-seeded places are
unchanged. Implemented entirely in `_shared/bouncer.ts` (single B7 push site behind a
named predicate) + `fetched_via` added to all four `bounce()` call-site projections.

---

## 2. Changed files (commit `008d5e7aa071e34b3ff86bafbbb176771a3c97a8`)

| # | File | Change |
|---|------|--------|
| 1 | `supabase/functions/_shared/bouncer.ts` | +`fetched_via?` on `PlaceRow`; +exported `isBusinessAuthored()` predicate; gated the single `B7:no_google_photos` push behind `!isBusinessAuthored(place)`. B8 unchanged. (~38 lines) |
| 2 | `supabase/functions/run-bouncer/index.ts` | `SELECT_FIELDS` += `, fetched_via` (1 line) |
| 3 | `supabase/functions/run-pre-photo-bouncer/index.ts` | `SELECT_FIELDS` += `, fetched_via` (1 line) |
| 4 | `supabase/functions/admin-review-venue-claim/index.ts` | `BOUNCER_SELECT` += `, fetched_via` (1 line, double-quoted) |
| 5 | `supabase/functions/run-business-place-authoring-pipeline/index.ts` | `placeForBouncer` return += `fetched_via: …` (5 lines incl. comment). Legacy `photosForGate` swap left as-is (harmless redundancy per SPEC §3.2 O1). |
| 6 | `supabase/functions/_shared/__tests__/bouncer.test.ts` | +`isBusinessAuthored` import; +T-1067-01..06 + helper test (115 lines) |
| 7 | `supabase/functions/run-business-place-authoring-pipeline/__tests__/pipeline_behavioral.test.ts` | +ORCH-1067 T-07 (42 lines) |
| 8 | `supabase/functions/admin-review-venue-claim/__tests__/meta_orch_1062_approve_orchestration.adversarial.test.ts` | +ORCH-1067 T-08 + T-08b (54 lines) |

All three modified test files are EXISTING files — no new test file added, so NO ORCH-0863
C7 backend allowlist entry is required (the allowlist only governs brand-new
`supabase/functions/` source files). Confirmed in COMMS-0002 ack.

---

## 3. The exact `bouncer.ts` diff (load-bearing)

### 3.1 `PlaceRow` — new optional field

```ts
  photos: unknown[] | null;
  stored_photo_urls: string[] | null;
  // ORCH-1067 — provenance. 'business_authored' ⇒ skip B7 (Google-photos gate);
  // such venues are not on Google and are gated on B8 (stored photos) instead.
  // Optional so existing test fixtures / callers compile; absent ⇒ treated as
  // Google-sourced (B7 applies).
  fetched_via?: string | null;
  review_count: number | null;
  rating: number | null;
```

### 3.2 New exported predicate

```ts
export function isBusinessAuthored(place: PlaceRow): boolean {
  return place.fetched_via === 'business_authored';
}
```

### 3.3 B7 push — gated (the one behavioral change)

```ts
  // B7: Google photos required (universal …)
  // ORCH-1067 EXCEPTION: business-authored venues are not on Google …
  if (!isBusinessAuthored(place) && !hasGooglePhotos(place)) {
    reasons.push('B7:no_google_photos');
  }
```

B8 is byte-unchanged. The `B7:no_google_photos` literal appears ONLY in `bouncer.ts`
and `_shared/__tests__/bouncer.test.ts` (both canonical/allowlisted). Verified by a
full-tree census: `grep -rln "B7:no_google_photos" supabase/functions/` returns nothing
outside those two canonical files. I-TWO-PASS-BOUNCER-RULE-PARITY preserved.

---

## 4. All four SELECTs include `fetched_via` (SC-6, grep-verified)

```
run-bouncer/index.ts:           '… stored_photo_urls, fetched_via, review_count, rating'   ✅
run-pre-photo-bouncer/index.ts: '… stored_photo_urls, fetched_via, review_count, rating'   ✅
admin-review-venue-claim:       "… stored_photo_urls, fetched_via, review_count, rating"   ✅ (double-quoted kept)
run-business-place-authoring-pipeline placeForBouncer return: fetched_via: (place …).fetched_via ?? null  ✅
```

---

## 5. Spec traceability (Success Criteria)

| SC | Statement | How verified | Verdict |
|----|-----------|--------------|---------|
| SC-1 | business-authored + stored photos + no Google photos → servable, reasons=[] | T-1067-01 (bounce unit) | PASS |
| SC-2 | business-authored + no stored photos (final) → B8, not B7 | T-1067-02 | PASS |
| SC-3 | Google-seeded (nearby_search) + no Google photos → still B7 | T-1067-03 | PASS |
| SC-3b | absent provenance + no Google photos → still B7 | T-1067-04 | PASS |
| SC-4 | two-pass parity: business-authored differs ONLY by B8; neither has B7 | T-1067-05 | PASS |
| SC-6 | all 4 SELECTs + placeForBouncer include fetched_via | grep §4 + T-07 | PASS |
| SC-7 | gates green | §7 + §8 | PASS (with pre-existing-failure caveats §9) |
| Cluster | business-authored, no website → B4 not B7 | T-1067-06 | PASS |
| Admin path | runApproveGoLive flips servable for business-authored | T-08 / T-08b | PASS |
| SC-5 | live unblock of Lantern & Vine (`8b72…`) | post-deploy, orchestrator one-shot (deferred to deploy) | DEFERRED to deploy |

---

## 6. Regression Test (mandatory gate)

**Test paths (all shipped in this commit):**
- `supabase/functions/_shared/__tests__/bouncer.test.ts` — T-1067-01..06 + isBusinessAuthored helper test.
- `supabase/functions/run-business-place-authoring-pipeline/__tests__/pipeline_behavioral.test.ts` — ORCH-1067 T-07.
- `supabase/functions/admin-review-venue-claim/__tests__/meta_orch_1062_approve_orchestration.adversarial.test.ts` — ORCH-1067 T-08 / T-08b.

**Passing run (fix applied):**
```
bouncer.test.ts:   96 passed | 2 failed   (the 2 failures are PRE-EXISTING — see §9)
                   all 7 new ORCH-1067 tests PASS
pipeline_behavioral.test.ts:                   13 passed | 0 failed
approve_orchestration.adversarial.test.ts:      6 passed | 0 failed
approve_scorer_loop.test.ts (regression):       3 passed | 0 failed
```

**fails-on-revert verified at commit `7f9c0f54ea55c6b13b7ba62919be0f3d1a16a998`** (HEAD before fix).
Reverting the `!isBusinessAuthored(place) &&` guard (B7 fires universally) makes:
- bouncer.test.ts: T-1067-01, T-1067-02, T-1067-05, T-1067-06 → FAIL (4 of 7; the helper + the two Google-regression tests T-03/T-04 correctly still pass since they don't depend on the skip).
- approve_orchestration.adversarial.test.ts: T-08 + T-08b → FAIL (both).
Fix restored → all back to PASS. Captured live.

> Note: pipeline T-07 still PASSES on revert because `placeForBouncer`'s legacy
> `photosForGate` swap independently maps the stored photo into the `photos` slot,
> so that test's verdict is satisfied by the swap rather than the bounce() B7-skip.
> The bouncer-unit + admin-adversarial fails-on-revert proofs are the load-bearing
> ones for the canonical fix. (The swap is intentionally kept per SPEC §3.2 O1.)

---

## 7. Gate results

- **`node .github/scripts/strict-grep/meta-orch-1062-approval-go-live.mjs --self-test`** → `# Self-test PASSED` (Part A place_ids-only catch + buildScorerInvokeBody allow; Part B is_servable:false catch + nextIsServableForConfirm allow). The scorer-invoke / demotion / signal-loop logic is UNTOUCHED. L8 satisfied.
- **I-TWO-PASS-BOUNCER-RULE-PARITY (isolated grep)** — the `B7:no_google_photos` literal exists ONLY in the two canonical files. My diff adds zero B7/B8/B5 literals outside `bouncer.ts` / `bouncer.test.ts`. See §9 for the pre-existing local-script caveat.

---

## 8. Two-pass parity (I-TWO-PASS-BOUNCER-RULE-PARITY)

The skip predicate `isBusinessAuthored(place)` is a pure function of row data
(`fetched_via`), NOT of the `skipStoredPhotoCheck` option, so B7's presence/absence is
identical across pre-photo and final passes for the same row. B8 remains the sole
pass-dependent rule. T-1067-05 asserts exactly this. Parity preserved.

---

## 9. Discoveries for Orchestrator

1. **PRE-EXISTING (not ORCH-1067): `bouncer.test.ts` ORCH-0678 T-03a/T-03b fail because `x.com` is now in `SOCIAL_DOMAINS`.** Those two tests use `website: 'https://x.com'` expecting an own-domain pass, but Twitter's `x.com` was added to `SOCIAL_DOMAINS`, so the fixtures now hit `B5:social_only`. Verified failing identically on the base (`git stash`) before my changes — NOT my regression. The fix is to update those two fixtures to a neutral own-domain (e.g. `https://example.org`), but that is an EXISTING-test modification → needs its own ORCH + `[TEST-MOD-APPROVED]` per the append-only rule. Flagging for registration.

2. **PRE-EXISTING (not ORCH-1067): local `scripts/ci-check-invariants.sh` I-TWO-PASS-BOUNCER-RULE-PARITY flags `pipeline_behavioral.test.ts`.** Line 112 of that file (added by META-ORCH-1009 Sub-E) contains the literal `"B8:no_stored_photos"` inside a `coachingForReasons([...])` fixture. The local shell gate's exclude list only whitelists `supabase/functions/_shared/__tests__/`, not the pipeline's own `__tests__/` dir, so it flags this row. This fails IDENTICALLY on the base (verified via `git stash`) — NOT my regression. The authoritative GitHub CI uses the strict-grep `.mjs` gates (not this local shell script); my changes introduce no new literal anywhere. Recommend the orchestrator either (a) widen the local script's `__tests__/` exclusion to all `supabase/functions/**/__tests__/`, or (b) note this as a known local-script-only false positive. The whole local script already exits 1 on many unrelated pre-existing failures (e.g. ExpandedCardModal category-wrap), so it is not a clean-base gate today.

3. No other side issues. The fix is minimal, scoped, and additive.

---

## 10. Edge functions to redeploy (ALL FOUR — orchestrator, from main after merge)

`_shared/bouncer.ts` is a bundled dependency of all four callers, so all four must be
redeployed even though only three have SELECT edits:

```
supabase functions deploy run-bouncer                          --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy run-pre-photo-bouncer                --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy admin-review-venue-claim             --project-ref gqnoajqerqhnvulmnyvv
supabase functions deploy run-business-place-authoring-pipeline --project-ref gqnoajqerqhnvulmnyvv
```

Deploy from `main` AFTER the PR merges (per COMMS-0015 / ship-verify-merge-before-reap —
never deploy a worktree as the durable source). `admin-review-venue-claim` keeps its
existing `verify_jwt` config (not touched by this ORCH). No `supabase db push` needed
(NO migration). Post-deploy, optionally run the admin approve / a `run-bouncer` city
pass over the 3 business-authored rows to flip Lantern & Vine (`8b72…`) servable (SC-5).

---

## 11. Invariants

**Preserved:** I-TWO-PASS-BOUNCER-RULE-PARITY, I-BOUNCER-DETERMINISTIC,
I-BOUNCER-EXCLUDES-FAST-FOOD-AND-CHAINS, I-SCORER-INVOKE-HAS-SIGNAL-ID,
I-NO-CLAIM-DEMOTION, I-APPROVE-PRODUCES-SCORES.

**New (proposed — orchestrator ratifies at CLOSE):** I-BOUNCER-B7-SKIPS-BUSINESS-AUTHORED
— every `bounce()` verdict over a `fetched_via='business_authored'` row MUST NOT contain
`B7:no_google_photos`; B8 must still apply in the final pass. Enforced by T-1067-01..05
+ T-08/T-08b and structurally by the single guarded B7 push site.
