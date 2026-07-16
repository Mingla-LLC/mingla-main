# IMPLEMENTATION — ISSUE-866 WP3 [Full Rooms Ad Engine — Creative Library + Creative Validator]

**Issue:** GitHub #866 (child of #852) · **WP:** 3 of the ad-engine build order
**SPEC (binding):** `Mingla_Artifacts/specs/SPEC_ISSUE-866_CREATIVE_LIBRARY.md` body + **Amendment A1 (A1-1…A1-10)**, constants from `Mingla_Artifacts/research/ad-pipeline-2026-07-15/PIPELINE_BLUEPRINT.md` §2, seams from merged WP1 (`_shared/adChannel.ts` + `_shared/meta.ts`, SPEC-862 A4)
**Worktree:** `~/Desktop/mingla-orchs/issue-866-creative-library/` on branch `issue-866-creative-library` (rebased onto origin/main carrying merged WP1 before any work)
**Author:** mingla-implementor+claude · **Date:** 2026-07-15
**Status:** implemented and verified (everything unit/contract-level; live platform legs are the tester's by dispatch design — NO live platform call was made)

---

## 1. Summary

The Creative Library backbone now exists in code: two new tables (`ad_creatives` + `ad_creative_platform_refs`), a pure-TypeScript **byte-probe** that derives every piece of media metadata from the actual bytes (dimensions, duration, audio-track presence, sha256 content hash — admin-supplied numbers are never trusted), the **per-channel validation matrix** encoded verbatim from blueprint §2 with the A1-6b tier posture (hard-reject only [SPEC]/[OFFICIAL] rows; [3P] rows warn; un-probeable rules surface as typed `not_evaluable`; deterministic-fix gaps as typed `needs_transcode` — no half-transcoder), the **content-hash-keyed resolver** `resolveCreativeRef` (upload once per platform/lane/account, cached forever, cache valid only on hash match, fail-close everywhere), **five upload paths** (Meta image/video incl. the A1-10 poll + thumbnail; TikTok UPLOAD_BY_URL with dual-id capture and name-collision suffixing; Snapchat per-call token mint + multipart bytes + chunked >32 MB branch + envelope double-assert; Google bytes-only pre-cropped images with unique auto-suffixed names + the A1-4 resumable YouTube video upload; Reddit fail-close stub), the **COMMS-0102 crawler-permissiveness check** (robots.txt + facebookexternalhit-UA fetch — the proven Meta hard-fail is now enforced before a creative is ever recorded), and the admin-gated **`admin-ad-creative-upload`** edge function (record + validate actions). 123 new Deno tests, a new self-testing strict-grep CI gate, and CI job registrations ship in the same branch. All 5 merged WP1 suites stay green (75/75).

## 2. Dispatch-scope coverage table

| # | Dispatch item | Status | Commit |
|---|---|---|---|
| a | Migrations: `ad_creatives` + `ad_creative_platform_refs` per spec+A1 (content_hash NOT NULL, refs keyed on content hash, poster CHECK, ai_generated), timestamp-versioned, NOT applied | ✓ | `0c95268d7` |
| b | `_shared/adCreative.ts` byte-probe validator (PNG/JPEG/WebP/GIF header parsing; MP4/MOV box parsing for duration/dims/audio presence), §2 matrix with tiers, typed `needs_transcode` where Deno can't transcode | ✓ (split into 3 sibling modules — see §10 note 1) | `61f1d783e` |
| c | `uploadToMeta` / `uploadToGoogle` / `uploadToSnap` / `uploadToTikTok` per A1; `uploadToReddit` fail-close stub | ✓ | `61f1d783e` |
| d | `admin-ad-creative-upload` validate/record edge fn, fail-close, admin-gated like WP1 | ✓ | `07f7eab42` |
| e | Tests (append-only): header fixtures, matrix tiers, content-hash cache keying, Snap double-assert, unique-name suffixing, crawler-UA check, fails-on-revert on audio-required; CI wiring | ✓ | `a984ab5fb` |

**SPEC AC coverage (of the ACs this WP owns):**

| AC | Verdict | Evidence |
|---|---|---|
| AC-1 upload/store (edge validation mirrors DB CHECKs; image/video source rules; 422s) | ✓ implemented, verified at contract level | edge fn + migration CHECKs; deno check green |
| AC-2 venue tag = existing entity, 422 `venue_not_found` | ✓ (record path; the separate `admin-creative-tag` fn is NOT in WP3's dispatch scope — deferred, §10 note 2) | edge fn place_pool/brands probes |
| AC-4 idempotent per-platform upload (cached ready ⇒ ZERO uploads; UNIQUE key) | ✓ verified | `adCreative.test.ts` cache-keying tests + migration UNIQUE |
| AC-5 fail-close, no orphan (upload throw ⇒ ref `failed` + typed re-throw) | ✓ verified | resolver failure-leg tests |
| AC-7 authz + RLS | ✓ implemented (RLS in migration — NOT applied; edge admin gate identical to WP1). RLS negative-case live check = tester leg | migration §4 + edge fn gate |
| AC-8 no token leak | ✓ verified | `scrubCreativeSecrets` tests; issue-862 token gate green; error columns scrubbed before write |
| AC-9 adapter interface total; unprovisioned lanes typed fail-close | ✓ verified | `CREATIVE_UPLOAD_ADAPTERS` registry + Reddit stub test |
| AC-3 (list/select fns), AC-6 (Meta live-fire) | NOT in WP3 dispatch scope — see §10 | — |

## 3. Files changed

| File | Δ |
|---|---|
| `supabase/migrations/20261231000866_issue_866_creative_library.sql` | +185 (new) |
| `supabase/functions/_shared/adCreativeProbe.ts` | +387 (new) |
| `supabase/functions/_shared/adCreativeMatrix.ts` | +577 (new) |
| `supabase/functions/_shared/adCreative.ts` | +1674 (new) |
| `supabase/functions/admin-ad-creative-upload/index.ts` | +333 (new) |
| `supabase/config.toml` | +9 (one `[functions.admin-ad-creative-upload]` block) |
| `supabase/functions/_shared/__tests__/adCreativeProbe.test.ts` | +312 (new) |
| `supabase/functions/_shared/__tests__/adCreativeMatrix.test.ts` | +434 (new) |
| `supabase/functions/_shared/__tests__/adCreative.test.ts` | +1101 (new) |
| `.github/scripts/strict-grep/issue-866-creative-guards.mjs` | +159 (new) |
| `.github/workflows/strict-grep-mingla-business.yml` | +14 (job append) |
| `.github/workflows/supabase-migrations-and-stripe-deno.yml` | +57 (job append) |
| `COMMS_LEDGER.md` | 3 ack appends (COMMS-0100/0101/0102) |

DO-NOT-TOUCH honored: `_shared/meta.ts` and `_shared/adChannel.ts` imported only, zero edits; #864 bucket untouched; no consumer/business/app-config file touched.

## 4. Data-model changes (written, NOT applied)

- **`public.ad_creatives`** — canonical asset. §4.2 shape + the full A1 delta: `content_hash text NOT NULL` (probe-derived), `has_audio boolean NULL`, `ai_generated boolean NOT NULL DEFAULT false`, `mp4_master_url text NULL` (A1-3 byte source), `variants jsonb NOT NULL DEFAULT '{}'` (A1-6c per-ratio slots `4:5|1:1|9:16|1.91:1`), probe-populated `width/height/aspect_ratio/duration_seconds/mime_type`, **`byte_size bigint NULL`** (see §10 note 3), image CHECK (`source_url` required) + video CHECK (`bunny_video_id` + `poster_url` required — OD-4/A1-8c), FKs → `place_pool(id)` / `brands(id)` / `auth.users(id)`.
- **`public.ad_creative_platform_refs`** — ref cache. Platform CHECK `('meta','tiktok','snapchat','google','reddit')` (A1-1 — never the bare 4-letter literal), `content_hash text NOT NULL` snapshot, `UNIQUE (creative_id, platform, lane, external_account_id)` idempotency/lock key, status `pending|uploading|ready|failed`, `error` (scrubbed).
- **`public.ads`** — `ADD CONSTRAINT ads_creative_id_fkey FOREIGN KEY (creative_id) REFERENCES public.ad_creatives(id) ON DELETE SET NULL` — the exact constraint the WP1 migration comment promised. **Read-only prod probe pasted:** `ads_total=0, ads_with_creative_id=0, wp3_tables_present=0, remote_head_version=20261230000000` — the FK add cannot abort on existing rows, and the WP3 prefix is strictly greater than the live remote head.
- Indexes (place/brand/kind-status/creative/platform-lane/ads.creative_id), `updated_at` triggers reusing WP1's `tg_ad_engine_set_updated_at`, RLS admin-SELECT via `is_admin_user()` + service-role-only writes, GRANTs mirroring WP1.

## 5. Edge functions touched

| Function | State | `verify_jwt` to preserve |
|---|---|---|
| `admin-ad-creative-upload` | NEW — do not deploy from this worktree; deploy from MERGED main (orchestrator/operator-owned) | `true` (config.toml block added) |

No existing function modified. `admin-meta-create-campaign`/`admin-ad-create-campaign` deliberately untouched (§10 note 2).

## 6. Regression tests added (append-only; all in the closing diff)

- `supabase/functions/_shared/__tests__/adCreativeProbe.test.ts` — 25 tests
- `supabase/functions/_shared/__tests__/adCreativeMatrix.test.ts` — 39 tests
- `supabase/functions/_shared/__tests__/adCreative.test.ts` — 59 tests
- **Suite results:** 123/123 pass (`deno test --allow-env --allow-read --no-check`, deno 2.7.14). All five merged WP1 suites re-run green: **75/75** (`adChannel`, `meta`, `issue862_wp1_tester_adversarial`, `issue862_wp1_rework`, `issue862_wp1_retest_adversarial`).
- **fails-on-revert verified at `a984ab5fb`** — true LINE DELETION of the audio-required hard-reject blocks (TikTok + Snapchat) in `adCreativeMatrix.ts` → **4 tests FAIL** ("TikTok: silent video HARD-REJECTS", "Snapchat: silent video HARD-REJECTS as missing_audio", "audio UNPROBEABLE surfaced as not_evaluable", and the resolver's "matrix gate blocks a silent video BEFORE any upload"); restore → 123/123 PASS.
- No existing test file modified or deleted (`tests-append-only` safe; closing diff shows only `A` statuses for tests).

## 7. Old → New receipts

### `supabase/migrations/20261231000866_issue_866_creative_library.sql` (new)
**Before:** the ad engine had no creative storage; `ads.creative_id` was a dangling column. **Now:** the two-table library with content addressing, the ref cache with the idempotency UNIQUE key, and the promised `ads` FK. **Why:** SPEC §4.2 + A1 schema delta. ~185 lines.

### `supabase/functions/_shared/adCreativeProbe.ts` (new)
**Before:** #866 as originally specced was transport-only — dimensions were admin-supplied, nullable, never checked (the "ship a square image into a 9:16 placement" failure class). **Now:** pure-TS byte probing — PNG/JPEG/GIF/WebP dimensions, ISO-BMFF (MP4/MOV) duration/dims/audio-presence/codec-fourcc, sha256 content hash; unknown bytes are refused fail-close. **Why:** A1-6a / GR-22. ~387 lines.

### `supabase/functions/_shared/adCreativeMatrix.ts` (new)
**Before:** zero per-channel constants existed in code. **Now:** blueprint §2.1–2.5 encoded with the tier engine; the [SPEC]/[OFFICIAL]-only reject rule is applied centrally in `emit()` so no row can bypass it (structurally tested); the §1.5 operator messages carried verbatim; A1-7 DO-NOT-BUILD absences pinned by tests. **Why:** A1-6b/c. ~577 lines.

### `supabase/functions/_shared/adCreative.ts` (new)
**Before:** no resolver, no upload paths; the original spec's Snap `upload_from_url` flow referenced an endpoint that does not exist and a static token that will never exist. **Now:** `resolveCreativeRef` (connection → creative → matrix gate → hash-keyed cache → locked upload → ready/failed), `CREATIVE_UPLOAD_ADAPTERS` for all five channels per A1-2/3/4/5/9/10, the COMMS-0102 crawler check, typed error taxonomy, token scrubbing, a structural `SupabaseLike` DB seam (no supabase-js import in the shared module), and injectable fetch/sleep so no test touches the network. **Why:** §4.3 + A1. ~1674 lines.

### `supabase/functions/admin-ad-creative-upload/index.ts` (new)
**Before:** no intake surface. **Now:** admin-gated record/validate endpoint that probes the actual bytes (and every variant slot), runs the matrix per requested channel, runs the crawler check (strict for Meta-bound images), enforces existing-entity venue/brand tags (422), and inserts only probe-derived metadata. **Why:** §4.4a as amended by A1-6 + COMMS-0102. ~333 lines.

### CI (`issue-866-creative-guards.mjs` + two workflow appends)
**Before:** nothing stopped a future session from re-introducing the never-exists static Snap token name or a bare `'snap'` platform literal, and the new suites ran nowhere. **Now:** a self-testing gate (G1 repo-wide token-name absence; G2 ad-engine-scoped enum literal) + registered jobs for the gate and the three Deno suites. **Why:** A1-2's explicit gate mandate + house CI pattern. ~230 lines.

## 8. Cross-surface impact

| Surface | Affected | Notes |
|---|---|---|
| Consumer iOS / Android | No | back-office engine only |
| Buyer/anonymous Web | No | creatives depict venues; no public page changes |
| Business iOS / Android / Web preview | No | untouched |
| Admin Web | **Not in this WP** | the library UI/picker (§4.5/4.6) is a later WP; no `mingla-admin` file touched |
| Backend (`supabase/`) | **Yes — the whole WP** | migration + 3 shared modules + 1 edge fn + config; parity n/a (server-authoritative single surface) |

## 9. Smoke / verification runs (real output captured in-session)

- `deno check` clean on all 4 new source files + 3 test files.
- New suites: `ok | 123 passed | 0 failed`. WP1 suites: `ok | 75 passed | 0 failed`.
- Gates: `issue-866-creative-guards` self-test PASS + run PASS (it caught two of my own doc-comments naming the forbidden token during development — the gate demonstrably bites); `issue-862-ad-token-env-server-only` PASS (16 names, 7 trees clean); `issue-862-reddit-configured-status` PASS (armed).
- Both edited workflows YAML-validated (`js-yaml`).
- Read-only prod probe (§4) for the FK-add safety + remote head version.
- fails-on-revert: deletion → 4 FAIL, restore → 123 PASS (at `a984ab5fb`).

## 10. Known issues / deferred / FLAGGED AMBIGUITIES (A1-3 stop-and-amend posture: flagged, not improvised)

1. **Module naming/split:** the dispatch named `_shared/adCreative.ts` "(or per-spec naming)". I shipped it as a 3-file family (`adCreative.ts` hub + `adCreativeProbe.ts` + `adCreativeMatrix.ts`) matching the WP1 `adChannel.ts`/`meta.ts` idiom — one concern per module, each independently testable. Flagged in case the orchestrator wants the single-file literal reading.
2. **WP3 scope vs full SPEC:** `admin-creative-list` / `-tag` / `-select`, the mingla-admin library UI + `CreativePicker`, and the §4.4e `creative_id` amendment to the campaign-create fn are **NOT in the WP3 dispatch letters (a)–(e)** and were not built. The `object_story_spec.video_data` consumer is #862's (A1-10) — `uploadToMeta` produces exactly its inputs (`video_id` + `thumbnail_image_hash` in `external_ref_extra`).
3. **`byte_size bigint` column:** not in A1's explicit schema-delta list, but required so the matrix byte-cap rows ([OFFICIAL] Snap 5 MB / Google 5,120 KB / TikTok 500 MB / Meta 30 MB) can be re-evaluated at resolve time from the persisted row without re-fetching bytes. Probe-derived, same spirit as A1-6a. Flagged for the spec amendment record.
4. **Deno-runtime feasibility limits (the dispatch's explicit ask):**
   - **No transcode/crop/re-encode of any kind** (no ffmpeg/ImageMagick/canvas in the edge runtime) → the entire AUTO-FIX tier surfaces as typed `needs_transcode` outcomes + the `variants` pre-cropped-slot contract. Cropping must happen upstream (the ad-production pipeline or a future media service).
   - **Black-bar (edge-row luma) and watermark detection need frame decoding** → typed `not_evaluable` checks with the §1.5 messages; these two blueprint HARD-REJECT rows cannot bite from a byte probe. If the orchestrator wants them enforced, that is a non-edge media service — spec amendment territory.
   - **Audio loudness (Snap −16 LUFS) and exact fps** are not probeable; audio PRESENCE is (and is the hard gate).
   - **Whole-buffer memory guard:** `CREATIVE_FETCH_MAX_BYTES = 64 MB` for probe/upload fetches (crypto.subtle needs a full buffer; edge memory is bounded). Larger videos fail typed (`byte_source_too_large`), except the Snap chunked branch which is allowed up to 1 GB by contract but **has NOT been measured against real edge memory/time limits** (A1-3 step 6 says measure — that requires a deployed function, which WP3 is barred from; recorded here for the tester/orchestrator).
   - **Non-MP4/MOV containers** (TikTok also accepts mpeg/3gp/avi) can't be parsed → refused fail-close at probe.
5. **Probe byte-source rule (consequence of `content_hash NOT NULL`):** every VIDEO creative needs an MP4 byte source at create (`mp4_master_url` or a direct-`.mp4` `source_url`) — Bunny HLS alone cannot be hashed. Enforced as 422 `video_mp4_source_required`. This is the only reading consistent with A1-1's "sha256 of the canonical bytes, never client-supplied" + A1-3's HLS finding; flagged since the SPEC body only requires the MP4 source for Snap/Google-bound videos at resolve time.
6. **`ai_generated` default when omitted:** the edge fn defaults to `true` (A1-8: our pipeline is AI-generative; under-disclosure is the exposure, over-disclosure is safe). The DB default stays `false` per the A1 schema line. Flagged: if human-shot photography becomes the dominant intake, flip the edge default.
7. **TikTok `file/name/check/` endpoint shape** is doc-derived and could not be live-verified (no live calls). The implementation suffixes defensively on ANY ambiguous check result, so a wrong shape degrades to always-suffixing (harmless). A1-9's flagged pre-build check (can TikTok's fetcher reach Bunny?) also remains unverified — typed error text points the operator at the MP4-master fallback. Both belong to #863's live leg.
8. **Snap `multipart-upload-v2` INIT/ADD/FINALIZE parameter casing** is doc-derived (A1-3's contract), envelope-asserted, not live-verified — #867's live leg.
9. **Crawler check semantics:** robots.txt evaluation is a minimal longest-match parser (specific-UA group overrides `*`, allow wins ties) — deliberately conservative; Meta's private parser may differ at edges. Non-Meta channels get warn-tier because only the Meta image download is live-proven (subcode 3858258).
10. **`Deno.env.get("SUPABASE_URL")`-style worktree drift check:** `supabase migration list --linked` fails in this worktree (not linked). Compensated with the MCP read-only probe (§4: remote head `20261230000000`). Run the linked list from the anchor before push if you want the CLI's own view.

## 11. Operator action required (orchestrator/Seth — NOT executed by this WP)

1. **Migration push (after merge, from a linked checkout):**
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/issue-866-creative-library" && /Users/sethogieva/bin/supabase db push --linked
   ```
   (Worktree is not currently linked — if pushing from the anchor after merge: `cd "/Users/sethogieva/Desktop/mingla-main" && /Users/sethogieva/bin/supabase db push --linked`.) Probe already pasted in §4: the `ads` FK add is safe (0 rows), prefix monotonic vs the live remote head.
2. **Edge deploy from MERGED main:** `admin-ad-creative-upload` with `verify_jwt = true`.
3. **Ledger acks:** COMMS-0100/0101/0102 ack appends ride this branch (`COMMS_LEDGER.md`) — prefer origin/main on any conflict at merge.

## 12. Discoveries for Orchestrator

- **D-1:** The WP1 `admin-ad-connect` stores `extra.page_id` — `resolveCreativeRef` reads it for the Meta lane context. If a connection row predates WP1's extra-shape, the Meta video path still works (falls back to env config via `resolveMetaClient`), but worth knowing the coupling exists.
- **D-2 (test-first for the tester):** the priority adversarial angles are (1) resolver concurrency — two simultaneous resolves racing the `uploading` upsert (the UNIQUE key serializes the DB, but the SELECT-then-upsert window is spec-designed, §4.3 step 3–4); (2) the crawler check against a live Cloudinary URL + a robots-blocked host (reproducing the QA_ISSUE-862 D-1 evidence end-to-end); (3) a real small MP4 through `admin-ad-creative-upload` validate action.
- **D-3:** blueprint §2.3's Snap image row conflict with #864's 30 MB bucket cap is now *visible* (the matrix warns in the reject message) but the bucket policy itself is #864-owned — no change made.

---
*Commits: `0c95268d7` (migration) · `61f1d783e` (shared modules) · `07f7eab42` (edge fn + config) · `a984ab5fb` (tests + CI) · report+ledger commit follows.*
