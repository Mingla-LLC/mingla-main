# REWORK — ISSUE-866 WP3 [Creative Library] — QA FAIL findings F-1/F-2/F-3

**QA input:** `Mingla_Artifacts/reports/QA_ISSUE-866_WP3.md` (tester commit `3afeb451d`) — verdict FAIL, 1×P1 + 1×P2 + 2×P3.
**Scope discipline:** ONLY the failing findings fixed (F-1 mandatory, F-2 mandatory, F-3 optional-taken). F-4 (P3, Meta per-placement minimums) is a flag-don't-improvise spec-amendment item per the QA report itself — NOT touched (recorded again in §5).
**Worktree:** `~/Desktop/mingla-orchs/issue-866-creative-library` on `issue-866-creative-library`.
**Author:** mingla-implementor+claude · **Date:** 2026-07-15.

---

## 1. Rework — what failed and what changed

### F-1 · P1 — concurrent double upload (QA T5: `uploads=2`, divergent refs) → FIXED
**What failed:** `resolveCreativeRef` upserted the `status='uploading'` lock row but never checked whether it WON it — two concurrent resolves both proceeded to upload; the cache recorded the last writer and the callers held two different platform refs (one orphaned; on Google a stranded immutable asset).
**What changed (`supabase/functions/_shared/adCreative.ts`):**
- `CreativeRefDb` gains **`tryAcquireRefLock(row, staleBefore): Promise<boolean>`** — the atomic, CHECKED acquisition. Returns true ⇔ THIS caller won. Optional in the interface ONLY for legacy single-writer in-memory fakes (the tester's committed suite implements the old seam and is untouched per dispatch); the seam doc states every real implementation MUST provide it, and the real one does.
- **`createSupabaseCreativeRefDb.tryAcquireRefLock`** implements it in two atomic statements: (1) `INSERT … ON CONFLICT DO NOTHING` (upsert + `ignoreDuplicates: true`) with RETURNING — a returned row ⇒ we created the lock ⇒ won; (2) on conflict, a **guarded `UPDATE … RETURNING`** keyed on the UNIQUE idempotency key with the acquirable-state predicate `status IN (pending,failed) OR (status='uploading' AND updated_at < staleBefore) OR (status='ready' AND content_hash <> :hash)`. Postgres re-evaluates the predicate on the latest committed row version under row lock (READ COMMITTED update re-check), so of N racers exactly one matches; losers get zero rows.
- **The resolver loop is reworked** into a single read → (cache-hit return | wait | acquire) loop: a fresh `uploading` ref waits; acquirable states go through `tryAcquireRefLock`; **losers route into the waiter and return the winner's ref**. Result: two concurrent resolves ⇒ exactly ONE platform upload, both callers the SAME `external_ref` (AC-4 / I-PROPOSED-CREATIVE-IDEMPOTENT-UPLOAD restored under concurrency).

### F-2 · P2 — crashed holder bricks the creative forever → FIXED
**What changed:** the stale-takeover arm is folded into the same conditional acquire. **`STALE_LOCK_TAKEOVER_MS = 15 minutes`**, documented on the constant: the longest legitimate holder is the chunked Snap path (up to 1 GB fetch + 32 ADD chunks × 3 retries + FINALIZE + a 120 s READY poll), and Supabase edge functions carry a hard wall-clock cap (~400 s) — any legitimate holder is finished or dead well inside the bound; `updated_at` is stamped once at acquisition (no heartbeat), so the bound exceeds a WHOLE upload, not an interval. Client-side (`refLockIsStale`) and SQL-side (`updated_at.lt."staleBefore"`) checks stay in lockstep; a lock of UNKNOWN age (no `updated_at` — legacy fakes) reads as fresh, never silently stolen. `CreativeRefRow` gains optional `updated_at`.

### F-3 · P3 — moov-less MP4 fabricated `hasAudio=false` → FIXED (fail-safe direction preserved)
**What changed:** `adCreativeProbe.ts` — `hasAudio` is now a POSITIVE claim: when NO trak of either kind was parsed (moov absent/truncated), the probe returns **`null`** (unknown); a genuinely parsed silent file still returns `false`. To keep the fail-safe direction the QA mandated, `adCreativeMatrix.ts`'s `CreativeCheck` gains a **`failSafe`** marker set on the audio-required `not_evaluable` emissions (TikTok + Snap), and `resolveCreativeRef` **blocks `failSafe` checks exactly like rejects** — unknown audio still hard-blocks audio-mandatory channels before any platform call; it no longer *claims* the file is silent.

## 2. Files changed (rework commit `4cbc811f0`)

| File | Δ (git numstat) |
|---|---|
| `supabase/functions/_shared/adCreative.ts` | +170/−52 (interface + resolver loop + supabase acquisition) |
| `supabase/functions/_shared/adCreativeMatrix.ts` | +25/−3 (failSafe marker + audio emissions) |
| `supabase/functions/_shared/adCreativeProbe.ts` | +7/−1 (hasAudio null honesty) |
| `supabase/functions/_shared/__tests__/issue866_wp3_rework.test.ts` | +584 (NEW — 15 tests) |
| `.github/workflows/supabase-migrations-and-stripe-deno.yml` | +9 (rework suite registered) |

No migration change. No edge-fn change. `issue866_wp3_tester_adversarial.test.ts` NOT touched (dispatch hard rule); no existing test modified anywhere.

## 3. Regression tests (append-only) + fails-on-revert

- **`issue866_wp3_rework.test.ts` — 15 tests:**
  - T-RW1/2/3 (F-1): **controlled interleaving on the DB seam** — a barrier holds ALL initial `getRef` reads open until every racer has read (the exact QA T5 window), the in-memory DB's acquisition is single-step-synchronous (truly atomic under JS concurrency, mirroring the guarded-UPDATE semantics); asserts `uploads === 1`, **both/all callers receive the SAME `external_ref`**, exactly one lock win, zero legacy-path calls; T-RW3 races the A1-1 hash-mismatch takeover.
  - T-RW4/5/6 (F-2): stale `uploading` (bound + 60 s old) is taken over and completes; a FRESH lock is never stolen (waiter → retryable `CreativeRefLockedError`, zero uploads, zero wins); the 15-minute constant pinned.
  - T-RW7/8/9: the supabase acquisition wire shape — `ignoreDuplicates:true` + the exact `onConflict` key, insert-win short-circuits the update, the guarded predicate carries all three acquirable arms verbatim, zero-row update ⇒ lost.
  - T-RW10/10b/11/12/13 (F-3): moov-less ⇒ `hasAudio:null`; parsed-silent ⇒ `false`; `failSafe:true` on both platforms' audio `not_evaluable`; the resolver blocks a `has_audio:null` TikTok video BEFORE lock acquisition; a `has_audio:true` video still resolves (no overblock).
- **fails-on-revert verified at `4cbc811f0`** — true LINE DELETION of the checked-acquisition branch in `resolveCreativeRef` (deleting the `tryAcquireRefLock` call + fallback guard, leaving the unchecked `upsertRefUploading` — the exact pre-fix code path) → **T-RW1, T-RW2, T-RW3 FAIL** (uploads=2/3, divergent refs — the QA T5 defect reproduced); restore → **206/206 PASS**.

## 4. Suite results at `4cbc811f0`

- ISSUE-866 battery (probe 25 + matrix 39 + adCreative 59 + tester 50 **unmodified** + rework 15, minus shared-module dedupe): **206/206 PASS**
- WP1 suites: **75/75 PASS**
- `deno check`: clean (3 shared modules + edge fn + new test file)
- Strict-grep gates: `issue-866-creative-guards` PASS · `issue-862-ad-token-env-server-only` PASS · `issue-862-reddit-configured-status` PASS (armed)
- Workflow YAML re-validated after the `DENO_TEST_FILES` append.
- Hard guards: local only, no deploy, no push, no live platform call, no migration application.

## 5. Known issues / deferred (unchanged from QA)

- **F-4 (P3):** Meta per-placement image minimums (FB Feed 600×750 etc.) remain un-encoded — the QA report itself routes this as "flag, don't improvise" (spec-amendment note or #884/#862 ad-create ownership). Awaiting orchestrator ruling; not silently widened here.
- QA D-QA-1…D-QA-5 discoveries remain with the orchestrator (duplicate migration prefixes hygiene ORCH, cross-creative dedupe product decision, `container:null` at resolve-time re-validation, Snap chunked path unmeasured in real edge, usemingla.com robots/favicon 404s).
- Operational note recorded by QA and preserved by design: the waiter budget (5 × 1.5 s) is shorter than long uploads — concurrent callers of a long-running upload get a RETRYABLE `CreativeRefLockedError` while the winner finishes; the takeover only fires at the 15-minute stale bound.

## 6. Retest pointer (for the tester)

- Re-run the Leg-3 **T5** race harness against the migrated local DB + real `createSupabaseCreativeRefDb` → expect `uploads=1`, one ref row, both callers the same `external_ref`.
- Re-run **T7/T7b** with a parked `uploading` row: `updated_at` older than 15 min ⇒ taken over and completed; fresh ⇒ still `CreativeRefLockedError` (by design).
- F-3: probe the 40-byte truncated real MP4 ⇒ `hasAudio: null`; resolve it for TikTok ⇒ `CreativeValidationError` (fail-safe), zero platform calls.

---
*Rework commit: `4cbc811f0` · fails-on-revert verified at `4cbc811f0` · report commit follows.*
