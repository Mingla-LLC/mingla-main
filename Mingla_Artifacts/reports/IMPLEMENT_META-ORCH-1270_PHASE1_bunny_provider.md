# IMPLEMENTATION — META-ORCH-1270 PHASE 1 — Bunny provider branch

Date: 2026-07-03 · Implementor: mingla-implementor (Claude)
Worktree: `~/Desktop/mingla-orchs/META-ORCH-1270-[bunny-migration]/` · Branch: `META-ORCH-1270-bunny-migration`
Contract: `Mingla_Artifacts/specs/SPEC_META-ORCH-1270_bunny_migration.md` §3 (Phase 1 only)

Status: **implemented and verified** (server-side, via Deno unit tests + fails-on-revert).
Client TUS transport is **implemented, partially verified** (source-structural + fails-on-revert; runtime
base64/TUS handshake needs a live Bunny library — see §11).

---

## 1. Summary (plain English)

Added Bunny Stream as a second cover-video host BEHIND the existing provider seam. With
`EVENT_COVER_VIDEO_PROVIDER=bunny`, a business user picks → uploads → the cover appears end-to-end on
Bunny using the SAME job lifecycle, state machine, and progress UI. With the env unset/`cloudinary`,
every path is byte-for-byte the pre-1270 Cloudinary flow (retirement is Phase 4). This phase ADDS a
branch; it removes/alters no Cloudinary behavior. Nothing was deployed, no secrets set, the provider
flag was NOT flipped, and no PR was opened.

## 2. SPEC success-criteria coverage (Phase 1)

| SC | Criterion (spec §3) | Status | Where |
|----|---------------------|--------|-------|
| SC-1 | New `_shared/bunnyStream.ts` — create/presign/get/delete + URL builders + status map + webhook verify, each verified vs cited docs | ✓ | `supabase/functions/_shared/bunnyStream.ts` |
| SC-2 | `EVENT_COVER_VIDEO_PROVIDER` boolean → real `cloudinary\|bunny` dispatch + `destroyCoverVideoAsset` | ✓ | `_shared/eventCoverVideo.ts` |
| SC-3 | upload-intent: bunny creates video + returns TUS descriptor, stores guid in `source_asset_id`; Cloudinary branch unchanged | ✓ | `event-cover-video-upload-intent/index.ts` |
| SC-4 | source-uploaded: bunny reads truth from Bunny, enforces real source byte cap | ✓ | `event-cover-video-source-uploaded/index.ts` |
| SC-5 | webhook: library-level Bunny webhook (lookup by guid, HMAC verify, Finished→ready via reused core) | ✓ | `event-cover-video-webhook/index.ts` |
| SC-6 | client TUS leg (C1+C7 provider-branched, C2–C6 Cloudinary-only) + `platformFileSystem` BINARY_CONTENT patch | ✓ | `eventCoverVideoProcessingService.ts`, `platformFileSystem.native.ts`, `.ts` |
| SC-7 | poster derivation returns Bunny thumbnail for Bunny covers; `so_0` kept for Cloudinary | ✓ | `packages/offering-rendering/coverMediaPresentation.ts` |
| SC-8 | migration: extend provider CHECK to allow `bunny` + index on `source_asset_id` | ✓ | `supabase/migrations/20261205000000_meta_orch_1270_bunny_provider.sql` |
| SC-9 | Reuse provider-agnostic core (`assertProcessedDerivative`, `eventCoverVideoReadyUpdate`, `mapEventCoverVideoStatus`) unchanged | ✓ | verified in webhook bunny test |

Commit hash satisfying all SCs: see §12 (single Phase-1 commit).

## 3. Files created / changed

New:
- `supabase/functions/_shared/bunnyStream.ts` — all Bunny HTTP + signing.
- `supabase/functions/_shared/bunnyStream.test.ts` — unit tests (recipe/status/verify/URLs).
- `supabase/functions/event-cover-video-upload-intent/__tests__/bunny-provider.test.ts`
- `supabase/functions/event-cover-video-webhook/__tests__/bunny-webhook.test.ts`
- `mingla-business/src/services/__tests__/eventCoverVideoProcessingService.bunnyTus.test.ts`
- `packages/offering-rendering/__tests__/meta_orch_1270_bunny_poster.test.ts`
- `supabase/migrations/20261205000000_meta_orch_1270_bunny_provider.sql`

Modified (line deltas from `git diff --stat`):
- `supabase/functions/_shared/eventCoverVideo.ts` (+45)
- `supabase/functions/event-cover-video-upload-intent/index.ts` (+83/−~6)
- `supabase/functions/event-cover-video-source-uploaded/index.ts` (+120/−~4)
- `supabase/functions/event-cover-video-webhook/index.ts` (+273)
- `mingla-business/src/services/eventCoverVideoProcessingService.ts` (+283)
- `mingla-business/src/utils/platformFileSystem.native.ts` (+30)
- `mingla-business/src/utils/platformFileSystem.ts` (+12)
- `packages/offering-rendering/coverMediaPresentation.ts` (+9)

## 4. Data-model changes (authored, NOT applied)

Migration `20261205000000_meta_orch_1270_bunny_provider.sql`:
- `DROP CONSTRAINT IF EXISTS event_cover_video_jobs_provider_check` then re-add
  `CHECK (provider IN ('cloudinary','transloadit','bunny'))` (the ORCH-0770 inline anonymous CHECK's
  canonical Postgres name). Idempotent, self-documenting `COMMENT`.
- `CREATE INDEX IF NOT EXISTS idx_event_cover_video_jobs_source_asset ON …(source_asset_id) WHERE
  source_asset_id IS NOT NULL` (library-webhook lookup by guid).
- No column adds (`source_asset_id` already exists since ORCH-0770), no data migration, no row rewrites.
- Prefix `20261205000000` is strictly greater than the max local prefix (`20261202000000`) AND every
  sibling worktree prefix (max sibling `20261204000002` in `1271-[admin-authz-foundation]`).

## 5. Edge functions touched (deploy list — orchestrator/operator, from MERGED main)

| Function | `verify_jwt` to preserve | Change |
|----------|--------------------------|--------|
| `event-cover-video-upload-intent` | (user-auth via `requireUserId`; keep current config) | added Bunny branch |
| `event-cover-video-source-uploaded` | same | refactored to DI handler + Bunny branch |
| `event-cover-video-webhook` | webhook (no user JWT) — keep current | added Bunny library-webhook branch |
| `_shared/bunnyStream.ts`, `_shared/eventCoverVideo.ts` | n/a (shared, redeploy with the above) | new / dispatch |

Bunny branches are DARK until the operator sets the secrets (§11) and flips
`EVENT_COVER_VIDEO_PROVIDER=bunny` — do NOT flip in this phase.

## 6. Regression tests + fails-on-revert

All tests are append-only (no existing test modified/deleted). Deno via `/Users/sethogieva/.deno/bin/deno`.

| Test file | Runner | Result | Fails-on-revert (true line-deletion) |
|-----------|--------|--------|--------------------------------------|
| `_shared/bunnyStream.test.ts` | `deno test --allow-env --allow-net --no-check` | 4 passed | deleted `mapBunnyStatus case 3 → ready` → 1 failed; restored → 4 passed |
| `…upload-intent/__tests__/bunny-provider.test.ts` | `deno test …` | 1 passed | deleted `protocol:"tus"` line → `expected upload.protocol tus, got undefined` FAIL; restored → pass |
| `…webhook/__tests__/bunny-webhook.test.ts` | `deno test …` | 2 passed | deleted the `coverVideoProvider()==="bunny"` webhook dispatch → 2 failed; restored → pass |
| `packages/offering-rendering/__tests__/meta_orch_1270_bunny_poster.test.ts` | `jest --roots ../packages/offering-rendering` | 3 passed | deleted the `/play_\d+p.mp4` branch → Bunny case FAIL (Cloudinary case still PASS); restored → pass |
| `mingla-business/src/services/__tests__/…bunnyTus.test.ts` | `jest` | 6 passed | deleted the `input.upload.protocol==="tus"` dispatch → C7 FAIL; restored → pass |

`fails-on-revert verified` for all five at the Phase-1 commit (§12). Every revert was a TRUE line
deletion (not a comment-out); restore returned each to green.

Client test is SOURCE-STRUCTURAL (readFileSync) — mirrors the established repo pattern for
RN/expo-heavy modules (`orch_1209_no_eager_video_preload.test.ts`). Reason: importing the service
pulls `react-native` + `expo-file-system`, which under this worktree's ts-jest resolve to the platform
web stub and hard-fail type-check (see §10 — this ALSO fails on pristine HEAD, i.e. it is a
pre-existing env artifact, not a regression).

## 7. Old → New receipts

### `_shared/eventCoverVideo.ts`
- Before: `providerConfigured()` = a boolean gate keyed on `EVENT_COVER_VIDEO_PROVIDER==="cloudinary"` + 3 Cloudinary secrets.
- Now: `coverVideoProvider()` returns `cloudinary|bunny`; `providerConfigured()` dispatches to `cloudinaryConfigured()` (byte-identical to old) or `bunnyConfigured()`; added `destroyCoverVideoAsset(job)` routing bunny→`bunnyDeleteVideo`, else→`cloudinaryDestroy` (unchanged path).
- Why: SC-2 real provider dispatch. Cloudinary readiness/behavior unchanged.

### `event-cover-video-upload-intent/index.ts`
- Before: always signed a Cloudinary direct-upload; job row stamped literal `provider:"cloudinary"`.
- Now: job row stamped `provider: coverVideoProvider()`. When bunny → create Bunny video (`deps.bunnyCreateVideo(job.id)`), persist guid to `source_asset_id` + `provider_payload.bunny`, return TUS descriptor (`protocol:"tus"`, presigned `AuthorizationSignature/Expire/LibraryId/VideoId`, metadata). On create failure → job `failed(provider_create_failed)` + 500. Cloudinary branch untouched (no `protocol` field; client `else` covers absent).
- Why: SC-3.

### `event-cover-video-source-uploaded/index.ts`
- Before: raw `serve()`; read the client-declared Cloudinary `providerUploadResponse`, advanced to `source_uploaded`.
- Now: exported DI handler `handleEventCoverVideoSourceUploaded`. Bunny branch IGNORES the client payload, calls `deps.bunnyGetVideo(source_asset_id)`; if not-registered-yet → keep `source_uploading`; enforces the REAL source cap vs Bunny `storageSize` (>cap → `destroyCoverVideoAsset` + `failed(source_over_cap)` + 413); else records `storageSize/length/bunny_status` and advances. Cloudinary branch unchanged.
- Why: SC-4 (Vector-C source cap on real bytes).

### `event-cover-video-webhook/index.ts`
- Before: Cloudinary `eager_notification_url` webhook (sha1 sig, recover job_id from public_id/context).
- Now: dispatch at top — `coverVideoProvider()==="bunny"` → `handleBunnyWebhook`. Bunny path: HMAC-SHA256 verify (or fetch-fallback if unsigned), lookup job by `source_asset_id=VideoGuid` (idempotent 200 `unknown_guid` on no match), honor `cancelled/applied` terminal guards, `mapBunnyStatus` (processing/failed→destroy+fail/ignore/ready). Finished → `bunnyBestMp4` (fail-closed if none), HEAD the MP4 (≤3× @2s), reuse `assertProcessedDerivative` + `eventCoverVideoReadyUpdate` unchanged, poster via `bunnyThumbnailUrl`, event draft_auto auto-apply via extracted `autoApplyEventCover` (same writes as the Cloudinary inline block). Cloudinary branch byte-for-byte unchanged.
- Why: SC-5, SC-9.

### `eventCoverVideoProcessingService.ts` (client)
- Before: `UploadIntentResponse.provider:"cloudinary"`; single Cloudinary multipart/XHR/chunked upload leg.
- Now: C1 widened `provider?:"cloudinary"|"bunny"`; added `EventCoverVideoUploadDescriptor` (protocol/videoId/metadata) threaded through the intent return; C7 dispatch — `upload.protocol==="tus"` → new `uploadEventCoverVideoSourceViaTus` (TUS create → single-shot PATCH: native via `createBinaryUploadTask` BINARY_CONTENT, web via XHR `application/offset+octet-stream`; portable `toBase64`/`tusMetadata`). C2–C6 Cloudinary path untouched.
- Why: SC-6.

### `platformFileSystem.native.ts` / `.ts`
- Added `createBinaryUploadTask` (native: `FileSystemUploadType.BINARY_CONTENT`, PATCH, raw body; no new native module → OTA-safe) + a symmetric web stub. Existing `createMultipartUploadTask` unchanged.

### `coverMediaPresentation.ts`
- `deriveCoverPosterUrl` now detects a Bunny `/play_{H}p.mp4` URL → `/thumbnail.jpg` FIRST, then the unchanged Cloudinary `so_0` branch (kept until Phase 4).

## 8. Cross-surface impact

| Surface | Affected? | Detail |
|---------|-----------|--------|
| Consumer iOS/Android | poster only (auto) | `deriveCoverPosterUrl` now maps Bunny covers → thumbnail.jpg (shared `packages/offering-rendering`, automatic parity). No video-byte behavior change here (that is Phase 3). |
| Buyer/anonymous Web | poster only (auto) | same shared package. |
| Business iOS/Android | yes | new TUS upload transport when provider=bunny; Cloudinary unchanged. Native BINARY_CONTENT is OTA-safe (no native module). |
| Business Web preview | yes | TUS web XHR PATCH leg. |
| Admin Web | no | no cover-video authoring. |

Parity is AUTOMATIC (shared package + shared edge functions). No manual parity gap.

## 9. Verification gates (real output)

- `deno check` (5 files: bunnyStream, eventCoverVideo, upload-intent, source-uploaded, webhook): **clean, no errors.**
- Deno tests (bunnyStream + shared + upload-intent + webhook + apply-adversarial): **38 passed | 0 failed.**
  Existing Cloudinary tests (duration-cap, job-id-recovery, duration-fallback) ran AFTER the Bunny tests
  in the same invocation and stayed green → Bunny tests do not leak `EVENT_COVER_VIDEO_PROVIDER` env
  (each wraps env in set/restore).
- Jest: bunny poster (3 passed), client structural (6 passed), existing `orch_1209` poster (5 passed —
  Cloudinary `so_0` path unchanged).

## 10. Known issues / deferred

- **Client ts-jest platform-split noise (PRE-EXISTING, not introduced):** importing
  `eventCoverVideoProcessingService.ts` under this worktree's ts-jest resolves `../utils/platformFileSystem`
  to the web stub → `TS2554 Expected 0 arguments` on the (existing) `createMultipartUploadTask` call, so
  `eventCoverVideoProcessingService.test.ts` fails to type-check HERE. Verified identical on pristine HEAD
  (git-stashed my 3 client files → same failure). Root cause: the worktree shares the anchor's
  `node_modules`, resolving `expo-file-system` to its TS source. My client test avoids this by being
  source-structural. Fixing the pre-existing breakage (aligning the web-stub signatures) is OUT of Phase-1
  scope — flagged for the orchestrator.
- **Bunny TUS runtime handshake / base64:** the exact TUS create→PATCH round-trip and `Upload-Metadata`
  base64 are verified structurally + by the server contract, not against a live Bunny library. Needs the
  §11 creds for the tester's live-fire.
- **Spec deviation — `bunnyPresignTusUpload` is async:** the spec declared it synchronous, but the TUS
  signature is `SHA256(...)` and WebCrypto `crypto.subtle.digest` is async, so a synchronous signature is
  not achievable. Made it `async` (callers already `await`). Signature bytes + recipe are exactly per spec.
- **Spec deviation — Cloudinary `protocol` field:** spec §3.1 suggested adding `protocol:"cloudinary"` to
  BOTH branches. The task's HARD GUARD requires the Cloudinary branch byte-for-byte unchanged, and the
  client dispatches on `protocol==="tus"` (treating absent/any-other as Cloudinary), so I left the
  Cloudinary response untouched (no `protocol` field). Behaviorally unambiguous; documented here.
- **413 source-over-cap client copy:** the bunny source-uploaded 413 returns `error:"source_over_cap"`;
  the client surfaces it as a generic error toast (no bespoke copy mapping added — not required in Phase 1;
  Phase 2 adds the circuit-breaker copy `media_unavailable`).
- **Bunny `recordApiCall("bunny", …)`:** the Layer-C observer now logs a `bunny` service key
  (fire-and-forget, swallows all errors). The `api_health_services` `bunny` seed is Phase 2 — until then
  the observation insert may be a no-op/ignored row; it never throws into the host path.

## 11. Operator action required (do NOT do in this phase)

Migration (author-only here — apply from the worktree when the orchestrator schedules it):
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/META-ORCH-1270-[bunny-migration]" && /Users/sethogieva/bin/supabase db push --linked
```
NOTE: `supabase migration list --linked` was NOT runnable in this worktree ("Cannot find project ref" —
the worktree lacks the linked `.temp`). Re-run the Pre-Flight monotonicity/drift check from a linked
checkout before `db push`.

Before live testing (Bunny console + Supabase secrets on LIVE prod `gqnoajqerqhnvulmnyvv`) — per spec §7:
`BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_CDN_HOSTNAME`, `BUNNY_STREAM_WEBHOOK_KEY`;
enable MP4 Fallback (≤720p); set the library webhook URL to the `event-cover-video-webhook` function; and
ONLY at cutover flip `EVENT_COVER_VIDEO_PROVIDER=bunny` + redeploy the four edge fns. Phase 2 guardrails
must land BEFORE the flip (spec §8).

## 12. Discoveries for Orchestrator

1. **Two stale strict-grep gates fail on pristine HEAD** (NOT regressions, NOT CI-registered):
   `orch-0770-event-cover-video-processing.mjs` greps for the literal `EVENT_COVER_FINAL_MAX_BYTES = 25 *
   1024 * 1024` (exists nowhere in the tree — the code uses `?? "26214400"`); `orch-0776a-video-upload-
   progress-honesty.mjs` also fails on HEAD. Neither is referenced by any `.github/workflows/` file
   (only by `package.json test:orch-*` scripts). They should be retired or repaired independently.
2. **Pre-existing client type-debt** (see §10) — the `platformFileSystem` web/native stub signature
   mismatch makes `eventCoverVideoProcessingService.test.ts` un-runnable under plain `npx jest` in a
   shared-node_modules worktree. A tiny fix (web stubs accept the same args) would restore it.
3. Commit: single Phase-1 commit on `META-ORCH-1270-bunny-migration` (hash recorded at commit time).
