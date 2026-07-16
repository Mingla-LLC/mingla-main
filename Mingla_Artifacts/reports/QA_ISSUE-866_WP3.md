# QA — ISSUE-866 WP3 [Full Rooms Ad Engine — Creative Library + Validator]

**Verdict: FAIL — 0 × P0 · 1 × P1 · 1 × P2 · 2 × P3 · 6 × P4 (praise)**
**Routing: REWORK (mingla-implementor) — one surgical fix (F-1); everything else in this WP verified sound at runtime.**

- **Tester:** mingla-tester+claude · **Date:** 2026-07-15
- **Under test:** commits `0c95268d7..b74a27ac2` on `issue-866-creative-library` (worktree `~/Desktop/mingla-orchs/issue-866-creative-library/`)
- **Contract:** `Mingla_Artifacts/specs/SPEC_ISSUE-866_CREATIVE_LIBRARY.md` + **Amendment A1 (binding)** + `PIPELINE_BLUEPRINT.md` §2 (constants source) + `WP3-866-IMPLEMENTATION-REPORT.md` (claims attacked)
- **COMMS acks this run:** COMMS-0102 (raw-Docker local DB used — `supabase start` still breaks on this branch, 6 duplicate prefixes re-confirmed; crawler-download class reproduced LIVE), COMMS-0100/0101 (read; no ad-CTA/store-listing surface touched by this WP). Acks recorded here — this QA run pushes nothing to main per its hard guards; orchestrator appends `mingla-tester+claude` to the ledger rows at CLOSE.
- **Hard guards honored:** local Docker DB only (containers `qa866-pg` / `qa866-postgrest`; ZERO commands against the linked prod project `gqnoajqerqhnvulmnyvv`); no deploys; no pushes; zero live paid-platform writes (Leg 4's live fetches were read-only GETs of public URLs/robots.txt); tests append-only.

---

## 1. Verdict summary (layman)

The creative library's machinery is genuinely good: the byte-probe reads REAL ffmpeg/cwebp files perfectly (13/13 against ffprobe ground truth, sha256 matches `shasum` exactly), lying admin metadata is provably overridden end-to-end through the real edge function, the per-channel rulebook enforces exactly what it should (silent video dies on Snap+TikTok, a 6MB image dies on Google/Snap but sails through Meta, Reddit's folklore numbers only warn), and the COMMS-0102 crawler trap is now caught BEFORE a creative is recorded — proven against live hosts. **One real defect blocks PASS:** when two ad-creates resolve the same creative at the same moment, both upload it to the platform — the "upload at most once" core invariant (AC-4 / spec invariant b) breaks under concurrency. I proved it with parallel calls against a real local Postgres carrying the real migration: 2 platform uploads, and the two callers walked away holding two DIFFERENT platform refs (one of them orphaned — on Google that's a stranded immutable asset). The fix is small and confined to one function.

---

## 2. SC/AC-by-AC matrix (WP3-owned criteria)

| AC | Verdict | Runtime evidence |
|---|---|---|
| AC-1 upload/store: edge validation mirrors DB CHECKs; image/video source rules; 422s | **PASS** | Leg 5 vs the REAL edge fn process + real PostgREST + real migrated Postgres: record 200 with row; `video_mp4_source_required` 422 (HLS-only), `kind_mismatch` 422 (PNG bytes declared video), `probe_empty_bytes` 422 (zero-byte), `venue_not_found` 422 pre-write. |
| AC-2 venue tag = existing entity | **PASS** (record path; `admin-creative-tag` fn not in WP3 scope by dispatch) | Leg 5 D2: fake uuid → 422 `venue_not_found`, no row; real `place_pool`/`brands` ids land on the row (B4). RT-4 pin: FK verified in the applied local schema. |
| AC-4 idempotent per-platform upload | **FAIL under concurrency** (PASS sequential) | Leg 3 T1–T3: second/third resolve → ZERO uploads, ONE ref row, rename immaterial. **T5: two simultaneous resolves → `uploads=2`** (see F-1). |
| AC-5 fail-close, no orphan ref state | **PASS** | Leg 3: adapter throw → row `status='failed'` + typed re-throw; QA-R6: Reddit lane fail-close ALSO lands `failed` on the ref row. |
| AC-7 authz + RLS | **PASS** | Leg 5 A1–A4: 401 (no header), 401 (garbage JWT), 403 (authed non-admin), 405 (GET). E1–E3 via REAL PostgREST on the REAL migration: non-admin `SELECT` → 0 rows; admin → rows (`is_admin_user()` verbatim from baseline); even admin INSERT → 403 (service-role-only writes). |
| AC-8 no token leak | **PASS** | QA-R3: token-laden adapter error → `markRefFailed` payload scrubbed (no `EAA…`, no `Bearer …`); strict-grep token gate green (16 names, 7 client trees). |
| AC-9 adapter registry total; unprovisioned lanes typed fail-close | **PASS** | Registry covers all 5 platforms; Reddit stub throws `CreativeLaneNotProvisionedError` (adapter + resolver level, QA-R6). |
| A1-6 byte-probe (probe-populated, never client-trusted) | **PASS** | Leg 1: 13/13 real fixtures vs ffprobe; Leg 5 B2/B3: lying `width:9999/height:1/duration:42/mime:image/gif/content_hash:"attacker-controlled"` all overridden by probe values in the persisted row. |
| A1-6b tier posture ([SPEC]/[OFFICIAL]-only rejects) | **PASS** | Leg 2 F: across 5 channels × 3 real fixtures, zero rejects carry non-[SPEC]/[OFFICIAL] confidence; Reddit [3P] byte/duration/dims rows warn (Leg 2 C, QA-M6). |
| A1-7 DO-NOT-BUILD absences | **PASS** | Leg 2 D: no text-density rule, no Meta bitrate rule at 90kbps, 120s Meta video passes (no 60/90s Reels cap) while 4s/181s correctly reject. |
| A1-1 content-hash cache keying | **PASS** | Leg 3 T4 (real DB): hash change → fresh upload + re-snapshot; QA-R1 same-length collision attack; QA-R5 waiter hash defense. |
| A1-2/A1-3/A1-4/A1-5/A1-9/A1-10 upload wire shapes | **PASS (wire-shape only — live legs belong to #863/#867/#862 live-fire by dispatch)** | Leg 6: Meta bounded poll + fail-before-poster (QA-W1); TikTok unicode+collision suffix inside extension, UPLOAD_BY_URL, dual-id from array envelope, Smart-Fix flags + flaw capture (QA-W2/W3); Snap mint (form-urlencoded refresh grant) + chunked INIT/ADD×3-with-retry/FINALIZE multipart + poll READY (QA-W4) + FINALIZE-smuggled sub_request_status FAILURE throws (QA-W5); Google magic-byte gate before any mutate (QA-W6), duplicate-name suffix with identical payload (QA-W7), resumable header contract + REJECTED fail-close (QA-W8). |
| COMMS-0102 crawler check | **PASS — live** | Leg 4: live Cloudinary → `pass` (200 image/jpeg); live robots-blocked host → typed `fail`/`robotsBlocked:true` with the 3858258 context; live 404 host (`usemingla.com/favicon.ico`, the original evidence URL) → `fail`; LinkedIn's fb-specific `Allow` overriding `*` `Disallow` → `robotsBlocked:false` (parser precedence proven against a real file); non-strict → `warn`. |
| Migration applies + schema pins | **PASS (LOCAL only)** | Both REAL migrations (`20261230000000` + `20261231000866`) applied verbatim to the raw-Docker DB, zero errors; prod never touched. `snapchat`-not-`snap` CHECK, `content_hash NOT NULL` both tables, UNIQUE idempotency key, `ads.creative_id` FK all pinned by tests. |
| AC-3 (list/select fns) · AC-6 (Meta live-fire) | **N/A — not in WP3 dispatch scope** | Matches implementation report §10.2; belongs to later WPs / channel live-fire. |

---

## 3. Findings

### F-1 · P1 — Double platform upload under concurrent resolves (the `uploading` "lock" never checks acquisition)
- **Evidence:** `supabase/functions/_shared/adCreative.ts:1527` (`db.upsertRefUploading`) + `:1633-1639` (`upsert(..., { onConflict })` = `INSERT … ON CONFLICT DO UPDATE`). Runtime proof (Leg 3 T5, REAL local Postgres + REAL `createSupabaseCreativeRefDb`, PostgREST-equivalent upsert SQL, two truly parallel `resolveCreativeRef` calls whose initial ref-SELECTs both ran before either upsert): `T5 RACE RESULT: uploads=2 outcomes=[fulfilled,fulfilled] rows=1 final=[{"status":"ready","external_ref":"hash_upload_2"}]` — caller A returned `hash_upload_1`, caller B returned `hash_upload_2`.
- **Impact:** violates the spec's core invariant §4.1(b) / AC-4 / I-PROPOSED-CREATIVE-IDEMPOTENT-UPLOAD ("uploaded to a given (platform, lane, account) AT MOST ONCE"). Consequences: duplicate Meta `video_id`s, duplicate suffixed TikTok materials, duplicate Snap media entities, and on Google a **stranded immutable asset** (A1-5); the two concurrent ads reference DIFFERENT platform refs while the cache records only the last writer. The window is not exotic: one campaign-create fanning out, or two admins, resolving the same creative concurrently. The spec explicitly designates the UNIQUE key as "the concurrency lock" — the implementation upserts the lock row but never checks whether it WON it (implementation report §12 D-2 acknowledged the window instead of closing it).
- **Required fix (surgical, one function):** make lock acquisition atomic and checked. E.g. `upsertRefUploading` returns whether the caller acquired the lock: `INSERT … ON CONFLICT (creative_id,platform,lane,external_account_id) DO UPDATE SET status='uploading', error=NULL WHERE ad_creative_platform_refs.status IN ('pending','failed') RETURNING id` (or the hash-mismatch takeover condition) — zero rows returned ⇒ another resolver holds it ⇒ route the loser into the existing `uploading` waiter path instead of uploading. supabase-js expression: `.upsert(...)` cannot express the guarded UPDATE — use a small SQL RPC or `.insert(...).select()` with `ignoreDuplicates` + a conditional `.update().eq('status','failed')` winner check.
- **Retest:** rework adds a regression test on the db seam with controlled interleaving (both getRefs before either upsert) asserting `uploads === 1` and both callers receiving the SAME `external_ref`; re-run my Leg 3 T5 harness against the migrated local DB → `uploads=1`.

### F-2 · P2 — A crashed lock-holder leaves `status='uploading'` FOREVER (no TTL/takeover)
- **Evidence:** Leg 3 T7/T7b: a row manually parked at `uploading` (simulating an edge-fn crash/OOM mid-upload — plausible with 32MB+ whole-buffer fetches) makes EVERY subsequent resolve throw `CreativeRefLockedError` after the 5×1.5s reread window, forever. There is no expiry, no takeover on stale `updated_at`, and no admin surface to clear it — only a manual service-role UPDATE.
- **Impact:** one crash permanently bricks that creative for that platform/lane; every ad-create referencing it fails "retry shortly" with no path that ever succeeds.
- **Required fix:** takeover when `status='uploading'` AND `updated_at` older than a bound (e.g. 2× the worst-case upload budget), folded into the same conditional-acquire as F-1 (`… OR (status='uploading' AND updated_at < now() - interval '10 minutes')`).
- **Retest:** park a stale `uploading` row with an old `updated_at`; a fresh resolve must take over and complete.
- **Related recorded behavior (not a separate finding):** the waiter budget is 5×1.5s = 7.5s; any upload longer than that (Meta video transcode poll, Snap chunked) throws retryable to concurrent callers — by design, but worth knowing operationally.

### F-3 · P3 — A truncated/moov-less MP4 probes `hasAudio=false` (certainty fabricated from absence)
- **Evidence:** `adCreativeProbe.ts:220-229` — when `moov` is missing, `parseBmff` returns `hasAudio:false` rather than unknown; QA-P6 pins the (correct) null dims, and the Leg-1 harness confirmed a 40-byte truncated real MP4 yields `hasAudio=false`.
- **Impact:** fail-SAFE direction (the silent-video hard-reject fires on TikTok/Snap for a corrupt file, and Meta/Google would fail later at the resolver), but the probe claims knowledge it doesn't have — `null` (→ `not_evaluable`) is the honest value when no `moov` was parsed.
- **Required fix:** when `moov` is absent (or no `trak` parsed), return `hasAudio: null`. Low priority; do with the F-1 rework or as a follow-up.

### F-4 · P3 — §2.1 Meta encoding is a probeable-subset, not the full row set
- **Evidence:** `adCreativeMatrix.ts` `validateMeta` encodes mime/30MB/600px-floor/ratio±3%±1%/recommended-res/4GB+2.3GB/5–180s/thumbnail/codec-warn/safe-zone. NOT encoded from blueprint §2.1: per-placement image minimums (FB Feed 600×750, Right Column 254×133, Search 600×600, AN Native 398×208 — REJECT rows), fps ≤30 WARN, 44.1kHz WARN, captions WARN. (Carousel/Collection/Copy/CTA rows belong to #884's copy engine — correct exclusion.)
- **Impact:** an e.g. 620×775 4:5 image passes WP3 validation but is below FB Feed's 600×750 only when… (620×775 passes; a 600×700 4:5-ish would fail Meta's Feed minimum yet pass this validator). Marginal in practice because the 1440-recommended WARN already flags small images.
- **Required fix:** either encode the per-placement REJECT minimums under the Advantage+ intersection posture (as done for duration) or record a one-line spec-amendment note that per-placement dims ride with #884/#862 ad-create. Flag, don't improvise (A1-3 posture).

### P4 (praise — patterns worth replicating)
1. Probe accuracy vs REAL encoders: 13/13 (ffmpeg x264/AAC, MOV/qt, GIF, cwebp VP8L+lossy, PIL JPEGs), sha256 identical to `shasum -a 256`, subarray-offset-safe.
2. `emit()` central tier-downgrade is structural — no row can bypass A1-6b (verified across every channel × fixture; zero non-[SPEC]/[OFFICIAL] rejects escaped).
3. `assertSnapEnvelope` walks the envelope recursively — my FINALIZE-smuggled failure two levels deep was caught (QA-W5).
4. Edge fn gate order (auth → admin → input → probe) is correct and the 401/403/405/422 matrix behaved exactly to contract on the real process.
5. The crawler check's robots parser got the hard precedence case right against a REAL robots.txt (LinkedIn: specific-UA `Allow` overrides `*` `Disallow: /`).
6. `is_admin_user()`-based RLS on the real migration denies non-admins AND denies admin direct-writes (service-role only) — exactly the #862 posture.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

- **Claimed** (report §6): true line-deletion of the TikTok+Snapchat audio-required reject blocks in `adCreativeMatrix.ts` at `a984ab5fb` → 4 tests FAIL; restore → 123 PASS.
- **My re-run** (worktree at `b74a27ac2`, same file content as `a984ab5fb` for this module): deleted both `hasAudio === false` reject blocks (keeping the `null` branch alive) → **3 tests FAIL**: `TikTok: silent video HARD-REJECTS (audio is REQUIRED — [OFFICIAL])`, `Snapchat: silent video HARD-REJECTS as missing_audio (Low-Quality Creative)`, `resolver: the matrix gate blocks a silent video for TikTok BEFORE any upload`. The 4th claimed failure (`audio UNPROBEABLE surfaced as not_evaluable`) stayed green under my deletion because I preserved the `else if (hasAudio === null)` branch as a plain `if`; the implementor's deletion evidently removed it too. **The anchor bites either way — claim verified in substance; count differs by deletion granularity (3 vs 4).**
- **Restore:** `git checkout -- adCreativeMatrix.ts` → matrix suite 45/45, full 866 battery 173/173.

## 5. Adversarial test added (tester's own)

- **Path:** `supabase/functions/_shared/__tests__/issue866_wp3_tester_adversarial.test.ts` — **50 tests**, committed with this report; registered in the CI job's `DENO_TEST_FILES` (house pattern, mirrors 862).
- **Different angles:** REAL-encoder embedded fixtures (two genuine ffmpeg MP4s + genuine cwebp VP8L, ground-truthed vs ffprobe/shasum), corrupt/truncated headers, box-size overflow, zero-duration-mvhd-with-audio, magic-vs-extension masquerade, >64MB fetch-guard (lying Content-Length pre-buffer + oversized-body post-buffer), byte-cap/duration boundaries (5,120KB±1, 60/61s, 5/180 vs 4/181s, 32MB±1), same-length hash-collision cache attack, ready-with-null-ref corrupt row, waiter hash defenses, token-scrub on the failed-row write, resolver-level Reddit fail-close, Meta bounded-poll timeout with poster-never-fetched, TikTok unicode+collision suffix + array envelope + Smart-Fix flags, Snap chunked INIT/ADD(retry)/FINALIZE + FINALIZE-smuggled failure, Google magic-byte gate + duplicate-name/same-payload retry + resumable-header contract + REJECTED fail-close.
- **Tester fails-on-revert (DIFFERENT line/file than the implementor's anchor):** true line-deletion of the content-hash match guard in `resolveCreativeRef` step 4 (`adCreative.ts` — `if (cached.content_hash === creative.content_hash)`) → **QA-R1 FAILS** (`49 passed | 1 failed`); restore → **50/50**. `fails-on-revert verified at b74a27ac2 (worktree)`.
- **Closing diff:** implementor's three suites are `A` in `0c95268d7..b74a27ac2`; my suite + workflow append + this report ride the QA commit — all tests visible as ADDED in `git diff origin/main...HEAD --name-status`; zero existing test files modified.

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | no UI in WP3 |
| 2 | One owner per truth | **PASS w/ note** | probe owns metadata (Leg 5 B2); the F-1 race lets two writers finish on one ref row — covered as P1, same code path |
| 3 | No silent failures | PASS | typed error taxonomy; `not_evaluable` surfaced; 422s named; F-3 noted (fail-safe direction) |
| 4 | One query key per entity | N/A | no client-side queries |
| 5 | Server state server-side | PASS | DB rows only; no client store |
| 6 | Logout clears everything | N/A | |
| 7 | `[TRANSITIONAL]` labeled | PASS | Reddit stub typed + ownership named (Reddit spec); gates armed |
| 8 | Subtract before adding | PASS | A1-7 DO-NOT-BUILD absences verified at runtime (Leg 2 D) |
| 9 | No fabricated data | PASS w/ note | probe never guesses format/dims (P6/P7/P8); F-3 hasAudio nuance |
| 10 | Currency-aware | N/A | |
| 11 | One auth instance | PASS | single `createClient` per request in the edge fn |
| 12 | Validate at the right time | PASS | probe at record; matrix gate at record AND resolve (before any platform call — Leg 3) |
| 13 | Exclusion consistency | N/A | |
| 14 | `_hasHydrated` gate | N/A | |

## 7. Device / parity matrix

Backend-only WP (migration + `_shared` modules + one edge fn). **Phase 0.A exemption: no UI/runtime surface ships in WP3** — the admin library UI is a later WP.

| Surface | Result |
|---|---|
| Consumer iOS / Android | skipped — WP ships nothing there (spec §3) |
| Buyer/anonymous Web | skipped — no public-page change |
| Business iOS / Android / Web preview | skipped — untouched |
| Admin Web | skipped — no `mingla-admin` file in the diff (verified `git diff --stat`) |
| **Backend** | **VERIFIED at runtime** — real Postgres (real migrations) + real PostgREST + the UNMODIFIED edge fn as its own Deno process (Leg 5); resolver against real DB (Leg 3); live crawler fetches (Leg 4) |
| Physical iPhone HITL | N/A — no device-facing behavior in scope |
| Edge deploy state | NOT deployed anywhere (correct — deploy from MERGED main is orchestrator/operator-owned; `verify_jwt=true` block present in `config.toml`) |

## 8. Full-battery results at final commit

- 866 suites (probe 25 + matrix 39 + adCreative 59 + **tester 50**): **173/173 PASS**
- WP1 suites (adChannel, meta, 3× 862 QA suites): **75/75 PASS**
- `deno check` (3 shared modules + edge fn + tester suite): **clean**
- Strict-grep gates: `issue-866-creative-guards` self-test + run **PASS** (G1 SNAP_ACCESS_TOKEN absent across 9 roots; G2 no bare-'snap'); `issue-862-ad-token-env-server-only` **PASS** (16 names, 7 trees); `issue-862-reddit-configured-status-explicit` **PASS** (armed)
- Workflow YAML re-validated after the `DENO_TEST_FILES` append (deno std yaml, 17 jobs)
- Local stack: migrations applied to Docker Postgres ONLY; linked prod project untouched (zero `--linked`/MCP write commands issued this run)

## 9. Discoveries for Orchestrator (not fixed here)

- **D-QA-1:** The 6 duplicate migration prefixes (COMMS-0102) are still unfixed on this branch/main — third QA in a row forced onto raw Docker. The hygiene ORCH deserves priority before the next backend WP.
- **D-QA-2:** Cross-creative dedupe is NOT implemented and NOT spec'd: two `ad_creatives` rows with byte-identical content upload twice per platform (Leg 3 T8: `uploads=2, rows=2`) — consistent with the spec's per-creative UNIQUE key; Meta coalesces images server-side by hash, other platforms will hold duplicates. If the ad pipeline starts re-registering the same master under multiple names, a content-hash lookup at record time ("this file already exists as creative X") is the cheap fix — product decision, not a WP3 defect.
- **D-QA-3:** `factsFromRow` (resolve-time re-validation) passes `container: null`, so Meta's codec WARN row never re-fires at resolve time (it fired at record). Cosmetic — record-time report carries it.
- **D-QA-4:** The Snap chunked >32MB path remains UNMEASURED against real edge memory/time limits (implementor §10.4 — deploy barred in WP3). Must ride #867's live leg; until then a >32MB Snap-bound video is an untested-in-edge path (wire shape verified here up to 70MB in-process).
- **D-QA-5:** usemingla.com currently 404s `robots.txt` AND `favicon.ico` (Leg 4) — irrelevant to ad creatives (Cloudinary hosts pass), but if any future ad ever points Meta at a usemingla.com asset path it will hard-fail crawler download today.

## 10. Leg-by-leg evidence index

| Leg | Result | Harness (scratchpad, session-local) |
|---|---|---|
| 1 Byte-probe truth (real files vs ffprobe/shasum) | **PASS 13/13** | `leg1_probe_truth.ts` — output in §2/AC-1 rows; sha256 cross-checked |
| 2 Matrix enforcement (real fixtures) | **PASS 26/26** | `leg2_matrix.ts` |
| 3 Resolver + cache keying + lock window (real DB) | **T1–T4, T6–T8 PASS · T5 FAIL → F-1** | `leg3_resolver_db.ts` vs `qa866-pg` (real migrations) |
| 4 Crawler check live | **PASS 6/6** | `leg4_crawler_live.ts` — Cloudinary pass / robots-block fail / 404 fail / precedence / non-strict warn |
| 5 Edge fn end-to-end local stack | **PASS 20/20** | `leg5_edge_fn.ts` — real PostgREST + GoTrue shim + unmodified fn process |
| 6 Upload wire shape (mock-intercepted) | **PASS** | QA-W1…W8 in the committed suite |
| 7 Adversarial suite committed | **50/50 + fails-on-revert** | `issue866_wp3_tester_adversarial.test.ts` |
| 8 Full battery + gates | **GREEN** (§8) | — |
