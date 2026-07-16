# QA RETEST — ISSUE-866 WP3 [Creative Library + Validator] after REWORK

**Verdict: PASS — 0 × P0 · 0 × P1 · 0 × P2 · 0 open P3 (F-4 REGISTERED-deferred by orchestrator ruling) · 3 × P4 (praise)**
**Routing: CLOSE (orchestrator). Retest cycle 1 of 2.**

- **Tester:** mingla-tester+claude · **Date:** 2026-07-15
- **Under retest:** rework commit `4cbc811f0` + report commit `53d1f3993` on `issue-866-creative-library` (prior QA `3afeb451d`, FAIL: F-1 P1 / F-2 P2 / F-3 P3 / F-4 P3)
- **Suite-integrity precondition:** `git diff 3afeb451d..HEAD -- issue866_wp3_tester_adversarial.test.ts` → **ZERO lines** (my adversarial suite untouched, as dispatched).
- **Hard guards honored:** raw-Docker local DB only (containers rebuilt, both REAL migrations re-applied verbatim, zero errors; linked prod `gqnoajqerqhnvulmnyvv` never touched); no deploys; no push; zero live platform writes; append-only tests (all 5 test files `A` in `git diff origin/main...HEAD`).

---

## 1. Verdict summary (layman)

All three fixed findings are genuinely fixed, and I proved it at the highest fidelity yet: REAL supabase-js (the same import the edge functions use) talking to REAL PostgREST on the REAL migrated Postgres, driving the REAL resolver and the REAL new lock-acquisition SQL. Two simultaneous ad-creates now produce exactly ONE platform upload and both callers walk away holding the SAME platform reference — three-way races too, and even when racing a stale-bytes takeover. A crashed uploader no longer bricks a creative forever: a lock older than 15 minutes is taken over and completed, while a fresh lock is still never stolen. And a corrupt video no longer pretends to know it's silent — it honestly says "unknown," and unknown still hard-blocks the audio-mandatory channels before anything touches a platform. I also deleted the fix and watched the original bug come back live (uploads=2, then uploads=3 in a three-way) before restoring it — the regression tests bite.

---

## 2. Focused-leg matrix (all runtime, real stack)

| Leg | Verdict | Evidence |
|---|---|---|
| 0. Tester suite untouched | **PASS** | zero-line diff since `3afeb451d`; suite runs unmodified inside the 206 battery |
| 1a. T5 re-run — 2-way race, REAL `createSupabaseCreativeRefDb` | **PASS** | `RT-1a RACE: uploads=1 r1=retest_upload_1 r2=retest_upload_1 rows=[{"status":"ready","external_ref":"retest_upload_1","content_hash":"7d86…aaaa"}]` — one upload, one row, SAME ref both callers. Barrier held both racers' FIRST real SELECT open (the exact QA T5 window); every read/write was a genuine PostgREST call (INSERT…ON CONFLICT DO NOTHING via `ignoreDuplicates` + the guarded `or=(status.in.(pending,failed),and(status.eq.uploading,updated_at.lt…),and(status.eq.ready,content_hash.neq…))` PATCH — the real wire syntax parsed and enforced by real PostgREST) |
| 1b. 3-way variant | **PASS** | `RT-1b 3-WAY: uploads=1 refs=["retest_upload_1"] rows=1` — all three converge |
| 1c. Hash-mismatch takeover raced (A1-1 under concurrency) | **PASS** | stale-bytes `ready` row + 2 racers → `uploads=1`, both callers get the NEW ref, row re-snapshots the live hash |
| 2a. Stale takeover (>15 min) | **PASS** | parked `uploading` row at `now()−16min` → taken over, completed (`uploads=1`, status `ready`), `updated_at` re-stamped by the trigger |
| 2b. Fresh lock never stolen | **PASS** | fresh `uploading` row → typed retryable `CreativeRefLockedError`, ZERO uploads, row untouched (still `uploading`) |
| 2c. Boundary | **PASS** | 14-min-old lock (inside the bound) still retryable-throws, zero uploads; `STALE_LOCK_TAKEOVER_MS === 15*60_000` pinned |
| 3. Truncated/moov-less MP4 fail-safe | **PASS** | 40-byte cut of the REAL ffmpeg MP4 → probe `hasAudio=null` (dims/duration also null — no fabrication); a `has_audio:null` TikTok-clean video row → `CreativeValidationError` on the `failSafe:true` `not_evaluable` audio row, **zero ref rows created, zero adapter calls** (blocked BEFORE lock acquisition); control: identical row with `has_audio:true` resolves through the real acquisition (no overblock) |
| 4. Full battery at final state | **PASS** | 866 battery **206/206** (probe 25 + matrix 39 + adCreative 59 + tester 50 unmodified + rework 15, incl. cross-import re-registration) · WP1 **75/75** · `deno check` clean (3 shared modules + edge fn + rework suite) · gates: `issue-866-creative-guards` self-test+run PASS, `issue-862-ad-token-env-server-only` PASS (16 names, 7 trees), `issue-862-reddit-configured-status` PASS (armed) · workflow YAML valid (17 jobs) |

## 3. Fails-on-revert — independently re-derived (implementor's claim verified)

- **Deletion performed:** true line-deletion of the checked-acquisition branch in `resolveCreativeRef` (the `if (db.tryAcquireRefLock) {…} else {…}` guard), leaving the unchecked `upsertRefUploading` — the exact pre-fix code path, matching the rework report §3.
- **Suite result under revert:** **T-RW1, T-RW2, T-RW3 FAIL** (as claimed).
- **LIVE result under revert (beyond the claim):** my real-stack harness reproduced the original QA T5 defect exactly — `RT-1a RACE: uploads=2 r1=retest_upload_2 r2=retest_upload_1` (divergent refs, one orphaned) and `RT-1b 3-WAY: uploads=3 refs=[retest_upload_1, retest_upload_2, retest_upload_3]`.
- **Restore:** `git checkout --` → rework suite green, full battery 206/206. `fails-on-revert re-derived at 4cbc811f0`.

## 4. Fix-quality review (source-level, on top of the runtime proof)

- The acquisition is atomic in each of its two statements and correct as a state machine: insert-win short-circuits; on conflict the guarded UPDATE's predicate is re-evaluated on the latest committed row version under row lock, so exactly one racer matches — proven observably by RT-1a/b/c. Losers route into the waiter and converge on the winner's ref.
- Client-side (`refLockIsStale`) and SQL-side (`updated_at.lt`) staleness stay in lockstep; unknown-age locks read as fresh (never silently stolen). `content_hash` is NOT NULL by schema, so the `neq` arm cannot hit the known Supabase NULL-`neq` dropout.
- `failSafe` is applied structurally in `emit()` options and consumed in ONE place in the resolver — unknown audio blocks exactly like a reject, with the blocking check carried in the thrown `CreativeValidationError.result` (RT-3 evidence shows the exact check).
- My original committed suite (fake-db seam, no `tryAcquireRefLock`) remains valid via the documented legacy fallback — no test weakened, none modified.
- **Operational note (by design, recorded):** concurrent callers of an upload longer than the waiter budget (5 × 1.5 s) receive a RETRYABLE `CreativeRefLockedError` while the winner finishes; the takeover only fires at the 15-minute stale bound. My first harness run tripped exactly this with an artificially short injected sleep — behavior is as documented in the rework report §5.

## 5. Prior-findings disposition

| Finding | Status |
|---|---|
| F-1 (P1, double upload) | **FIXED — runtime-proven** (RT-1a/b/c) + regression-guarded (T-RW1/2/3, fails-on-revert re-derived live) |
| F-2 (P2, permanent lock) | **FIXED — runtime-proven** (RT-2a/b/c) |
| F-3 (P3, fabricated hasAudio) | **FIXED — runtime-proven, fail-safe direction preserved** (RT-3) |
| F-4 (P3, Meta per-placement minimums) | **REGISTERED — deferred by orchestrator ruling to the matrix-hardening follow-up; not a blocker** (implementor correctly did not silently widen scope) |
| D-QA-1…D-QA-5 discoveries | remain with the orchestrator (unchanged) |

## 6. Constitution / parity deltas since the FAIL report

Rule 2 (one owner per truth): the note from the prior report is cleared — the lock now has exactly one winner (PASS clean). All other rows unchanged from `QA_ISSUE-866_WP3.md` §6/§7 (backend-only exemption stands; nothing deployed anywhere — correct, deploy is from merged main).

## 7. P4 (praise)

1. The two-statement acquisition (insert-win / guarded-update-win) is the cheapest correct shape available through PostgREST — no RPC, no advisory locks, provably one winner on the real wire.
2. T-RW1/2/3's barrier design reproduces the exact QA race window deterministically in CI — this defect class cannot silently return.
3. The `failSafe` marker turns "unknown" into a first-class blocking state instead of a fabricated boolean — honest data AND fail-safe behavior at once.

## 8. Commits

- Under retest: `4cbc811f0` (fix) · `53d1f3993` (rework report)
- Prior QA: `3afeb451d` · This retest report commit follows (report-only).
- Harnesses (session-local scratchpad): `retest_leg1_2_3.ts` (real supabase-js → PostgREST → Postgres), containers `qa866-pg`/`qa866-postgrest` torn down after the run.
