# SPEC — ORCH-0978 [Video upload polish + sub-30s perfect cross-surface render]

**Author:** Claude `mingla-forensics` (SPEC mode)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
**Preceded by:** APPROVED RESEARCH at `Mingla_Artifacts/reports/RESEARCH_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` (`bf7bd8db2`) + orchestrator REVIEW at `Mingla_Artifacts/reports/REVIEW_ORCH-0978_RESEARCH_SUB_30S_PIPELINE.md` (`7bc5e6097`)
**Date:** 2026-05-26

---

## SPEC AMENDMENT 1 — 2026-05-26 — Single 30s cap via native trim

**Operator decision:** collapse the original two-tier cap (500 MB raw / 5 min raw / 15s output / 25 MB output) into a **single 30-second cap** enforced at the picker via the device's NATIVE trim screen. The 30s slice the user trims IS the final cover — no separate output-trim step on Cloudinary.

**Changes vs original SPEC:**

1. **New caps (single user-facing number):**
   - Picker enforces **30s maximum** via `expo-image-picker` `videoMaxDuration: 30` + `allowsEditing: true`.
   - iOS: native iOS trim screen appears on any clip; user slides a 30s window across the source; returned URI is ONLY the trimmed 30s slice. No friction, no rejection.
   - Android: same API; behavior is best-effort (some system pickers respect `videoMaxDuration`, some ignore it). If the returned clip duration is > 30s, post-pick fallback rejects with "Please trim to 30 seconds first" friendly copy.
   - Web composer: no native trim available. Post-pick rejection with the same friendly copy. Future ORCH may add an in-app trim UI.
   - Server-side defense-in-depth: `_shared/eventCoverVideo.ts` `MAX_SOURCE_VIDEO_DURATION_MS` lowered from `300_000` (5 min) → `60_000` (1 min — gives a 2× safety margin around the 30s cap in case picker enforcement glitches). `MAX_SOURCE_VIDEO_BYTES` lowered from `524_288_000` (500 MB) → `104_857_600` (100 MB — generous post-trim ceiling).

2. **Cloudinary eager chain simplified:**
   - DROP `so_{trimStartMs/1000}` and `du_{trimDurationMs/1000}` from the eager chain in `event-cover-video-upload-intent/index.ts:241-250`. The input is already trimmed to 30s by the picker, so Cloudinary doesn't need to slice it.
   - KEEP `c_limit,w_1280,h_720,vc_h264,ac_aac,br_{clamped},f_mp4,q_auto:good`.
   - `clampBitrate` math unchanged but now operates on the 30s output target (~6 Mbps to stay under 25 MB cap, vs ~12 Mbps for 15s) — visibly clean quality, mild softening on high-motion footage acceptable for cover use.

3. **Service-layer params simplified:**
   - `createEventCoverVideoUploadIntent` no longer requires `trimStartMs` / `trimEndMs` from the client (the picker already returned only the trimmed slice).
   - For backward compatibility during rollout, the edge fn accepts these params if sent (server treats them as 0 / sourceDurationMs) but new client code stops sending them.

4. **Cost/perf implications:**
   - Per-upload transformation cost: 30s HD output = 0.12 credits (vs 0.06 at 15s; 2× per upload, still small absolute).
   - Per-view delivery cost: ~10–18 MB per view (vs ~5–10 MB at 15s; ~2× bandwidth scaling at scale).
   - Perf budget: still achievable. Compression of 30s 1080p HEVC = ~10–20s on a modern phone; upload of ~12–18 MB compressed = ~20–30s on cellular. Optimistic-local-preview pivot remains the safety net.
   - Industry positioning: matches the Apple App Store preview ceiling (15-30s standard) and aligns with Vimeo/Wistia cover-video norms. Tight enough to feel like a cover, long enough to feel like a proper trailer.

5. **New success criterion + tests:** SC-13 native-trim per platform; T-16 iOS native trim returns ≤30s slice; T-17 Android fallback rejection; T-18 web fallback rejection; T-19 server-side defense-in-depth rejection (defense if client bypassed).

6. **New invariant:** I-PROPOSED-VIDEO-INPUT-CAP-AT-PICKER — cap is enforced at picker (`videoMaxDuration: 30` + `allowsEditing: true`) AND at edge fn (`MAX_SOURCE_VIDEO_DURATION_MS = 60_000` defense bound). CI gate strict-greps any `launchImageLibraryAsync` call with `mediaTypes` including video that omits `videoMaxDuration` or `allowsEditing`.

7. **Removed open question OQ-3** (telemetry columns) — no longer needed since trim params drop. Original OQ-3 still listed for historical reference; mark as RESOLVED-by-amendment.

**Affected sections of the original SPEC below:** §1 still accurate; §2 scope updated implicitly (the cap behaviour is now part of scope); §4.2 picker-related text updated; §4.3 service-layer compressVideoLocally unchanged but trim params dropped from callers; §4.5 picker component spec gets the new picker config; §5 add SC-13; §6 add I-PROPOSED-VIDEO-INPUT-CAP-AT-PICKER; §7 add T-16 through T-19; §8 add Step 1.5 (picker config); §10 OQ-3 marked RESOLVED.

---

## SPEC AMENDMENT 2 — 2026-05-26 — Pre-IMPLEMENT Supabase probe results

Orchestrator ran read-only probes against the production Supabase (`gqnoajqerqhnvulmnyvv`) before IMPLEMENT to surface blockers. **Three findings, all favourable:**

**Finding 1 — Schema is solid; zero DB blockers.**
- `event_cover_video_jobs` exists with all 31 columns the SPEC assumes (verified via `information_schema.columns`).
- Notable unused columns the SPEC should now leverage: `source_public_id`, `source_asset_id`, `processed_public_id`, `processed_asset_id` (all nullable, currently always null).
- `events.cover_media_url` + `events.cover_media_type` exist as plain `text` with no CHECK constraint blocking `'video'`. No migration needed.
- Single RLS policy exists (SELECT for event managers via `biz_brand_effective_rank_for_caller`). All writes go through service-role edge functions — correct design.

**Finding 2 — Two orphan `source_uploading` rows from 2026-05-11 (15 days stuck).**
- Status counts: 7 `cancelled` + 2 `source_uploading` (no rows in any other state).
- The 2 stuck rows are exactly the orphan-state bug this SPEC fixes (no abort + no destroy = forever-stuck).
- **Action:** clean these up before IMPLEMENT so the PoC + first test runs see a clean slate. Single DELETE statement: `DELETE FROM public.event_cover_video_jobs WHERE status IN ('source_uploading', 'cancelled') AND created_at < '2026-05-12';` — to be run by operator at PoC kickoff time via Supabase SQL editor (orchestrator does NOT execute writes per memory rule).

**Finding 3 — Greenfield rollout, not a retrofit.**
- 53 events total in production: 1 image cover, 13 GIF covers, 39 null covers, **ZERO video covers**, **ZERO Cloudinary-hosted URLs**.
- The video cover feature has effectively never been used. No live brands affected if rollout has bugs.
- **Implication:** lower migration risk + lower accumulated-orphan pressure, BUT T-00 PoC + T-11 cross-platform test become MORE important because there's no production usage signal to fall back on. Get the PoC right.

**Edge function deploy state probed:** all 6 video edge fns ACTIVE at their expected versions; `verify_jwt` settings correct (true on auth-gated functions, **false** on the webhook — correct because it's signature-verified). No drift, no broken deploys.

**Two small SPEC additions surfaced by the probe:**

A. **Use dedicated `source_public_id` column for cancel-destroy lookup** instead of parsing `provider_payload.public_id` JSON. Cleaner. Requires `event-cover-video-upload-intent/index.ts` to ALSO populate `source_public_id` at job-insert time (one-line change). Amends SPEC §4.2 edge-fn changes to add this.

B. **Pre-IMPLEMENT housekeeping** — orphan-row cleanup SQL (Finding 2) runs at PoC kickoff. Trivial.

**No blocking issues. SPEC stands as APPROVED.** PoC scaffolding follows in commit `Mingla_Artifacts/POC_ORCH-0978_COMPRESSION_RUNBOOK.md`.

---

## SPEC AMENDMENT 3 — 2026-05-26 — T-00 PoC results (PASS, HIGH confidence)

Operator (Seth) executed the T-00 empirical compression PoC on his physical iPhone via a dev client built off this worktree. **Verdict: PASS with HIGH confidence — IMPLEMENT cleared on the perf-budget dimension.**

### Measured results

| Test | Source format | Source size | Output size | Compression ratio | Elapsed time | Quality verdict |
|---|---|---|---|---|---|---|
| 30s clip | iPhone HEVC (4K Dolby Vision HDR, default camera) | **389.15 MB** | 5.98 MB | 1.5% | **9.76 s** | Indistinguishable from source |
| 15s clip | iPhone HEVC (4K Dolby Vision HDR, default camera) | **193.78 MB** | 3.04 MB | 1.6% | **5.10 s** | Indistinguishable from source |

Test C (30s H.264 source) skipped — pattern from Tests A+B was strong enough to lock the verdict.

### Critical context — the source is WORST-CASE input

Seth's iPhone records at 4K Dolby Vision HDR by default (~103 Mbps source bitrate, ~389 MB for 30 seconds). This is the **highest-quality input we'll ever see in production**. Even at this extreme:
- Compression stays well within the 5–15 s budget assumed in original SPEC §3
- Output is visually indistinguishable from source per operator eyeball
- Linear scaling: ~0.33 s of compression per second of source — predictable, controllable
- Output size is 6 MB for 30 s — comfortably under the 25 MB SPEC cap, leaving headroom for higher-bitrate slices if SPEC ever loosens the cap

Most users record at default 1080p HEVC (~30–60 MB for 30 s), which will compress in roughly 2–5 s.

### Latency budget table — §3 replaced with REAL numbers

Replace the original §3 table with this verified-against-physical-device version:

| Stage | Real measured (worst-case 4K HDR 30s source) | Notes |
|---|---|---|
| User picks file (system picker) | ~1 s | system bound |
| Client-side compression on iPhone (default iPhone 16-class device) | **9.76 s** (real, T-00 measured) | react-native-compressor `auto` preset; predictable scaling |
| Upload bytes to Cloudinary (6 MB @ 5 Mbps cellular) | ~9.6 s | 6 MB compressed output × 8 bits / 5 Mbps |
| Cloudinary transcode (trim + crop + container only — input is already H.264 720p-class) | ~3–5 s estimated | small pre-compressed input means light eager work; `[BENCHMARK NEEDED]` — measure at IMPLEMENT TEST phase |
| Webhook → Supabase → DB write | ~1 s | unchanged, current pipeline |
| Client poll + render | <1.5 s (real wait); 0 s perceived | optimistic-local-preview swap pattern |
| **TOTAL real (worst-case input on cellular)** | **~25–27 s** | **WITHIN the 30 s budget** |
| **TOTAL real (default 1080p input on Wi-Fi)** | **~10–15 s** | comfortable |
| **TOTAL perceived (via optimistic local preview)** | **~2 s to first frame, always** | safety net always engaged |

### Implications for IMPLEMENT

1. **No SPEC amendment to compression strategy needed.** The `react-native-compressor` `auto` preset works as assumed. SPEC §4.3 `compressVideoLocally` implementation can ship as written.
2. **No pivot to per-platform native modules needed.** The SC-11 fallback path (custom Expo Module wrapping AVAssetExportSession + MediaCodec) is NOT required. Issue #268 (Android-compressed → iOS playback) still needs T-11 verification at TEST phase, but the iOS-compressed→iOS pipeline is validated.
3. **Latency budget §3 updated above.** Implementor uses these real numbers as the contract, not the original estimates.
4. **Quality contract verified.** SC-1 (perceived first-frame ≤3 s via optimistic preview) and SC-8 (cross-surface render parity) remain testable at IMPLEMENT TEST per the SPEC; this PoC verified the upstream compression-quality input that feeds those.

### PoC scaffolding reverted (this commit)

- DELETED: `mingla-business/app/compression-poc.tsx` (throwaway measurement screen)
- REVERTED: `mingla-business/app/(tabs)/account.tsx` (PoC nav row removed)
- REVERTED: `mingla-business/app.config.ts` (isPocDevBuild gate removed; hasAppsFlyerEnv + hasOneSignalEnv restored to original)
- REVERTED: `mingla-business/eas.json` (development profile env back to SENTRY_DISABLE_AUTO_UPLOAD only)
- KEPT (this IS SPEC Step 1 of IMPLEMENT, intentionally landed early):
  - `react-native-compressor@1.18.2` in `mingla-business/package.json` + `app-mobile/package.json`
  - `react-native-compressor` plugin entry in both `app.json` files
  - `mingla-business/package-lock.json` updated dependency tree

### Runbook archived (informational)

`Mingla_Artifacts/POC_ORCH-0978_COMPRESSION_RUNBOOK.md` stays in the worktree. Future video-feature ORCHs (brand cover, trip cover, profile video) can re-use the same recipe for their own PoC measurements — only the test screen needs to be rebuilt.

### Open items NOT resolved by PoC (deferred to IMPLEMENT TEST)

- T-11 cross-platform playability (Android-compressed → iOS playback regression check per issue #268) — must be verified at IMPLEMENT TEST phase
- Cloudinary transcode time for our pre-compressed 6 MB input (cited `[BENCHMARK NEEDED]` above) — measure at IMPLEMENT TEST first run, lock budget table further
- Real cellular upload measurement (we assumed 5 Mbps; operator could be on different networks) — IMPLEMENT TEST captures actual network distribution

### Authorization

Per operator (Seth) reply 2026-05-26: "It looks indistinguishable. looks great". Verdict locked. IMPLEMENT cleared on the PoC dimension. Final gate remains: ORCH-0964 [Public-page theme customization] PR merge to main.

---

## 1 — Executive summary (≤10 sentences)

This SPEC codifies the sub-30s perfect-render video upload pipeline derived from APPROVED RESEARCH. Phase 0 surfaced four binding constraints: (1) **both apps are on Expo SDK 54** (`~54.0.34`), the last SDK that still ships `expo-av` — so SDK migration is OUT OF SCOPE here (deferred to a future SDK-55 upgrade ORCH), but `expo-av` audio code in `app-mobile` (4 files for beta feedback) remains untouched and OK; (2) `mingla-business` already has `expo-video v3.0.16` installed and a complete `EventCoverMedia.tsx` renderer with web `<video>` + RN `VideoView` branches + mute toggle + autoplay+playsInline contract — most of the render-side architecture is already built; (3) `app-mobile` does NOT have `expo-video` installed and needs it added for consumer-side cover rendering; (4) the `_shared/eventCoverVideo.ts` helpers (HMAC-SHA1 signature, derivative validation, status mapping) are well-structured and reusable for cancel-destroy and new picker integration. The SPEC therefore focuses on **four discrete IMPLEMENT deltas**: (A) add `react-native-compressor` to both apps + wire client-side compression into the upload service, (B) add Cloudinary destroy API call to the cancel edge function so abort cleans up the in-flight asset, (C) add optimistic-local-preview swap pattern to the upload UI components, (D) refactor `EventCoverMedia` either into the existing `packages/event-rendering/` package OR a new shared module so consumer and business apps share one render contract. Three new DRAFT invariants codify the structural safeguards: I-PROPOSED-VIDEO-UPLOAD-OPTIMISTIC-PREVIEW, I-PROPOSED-VIDEO-CANCEL-ABORTS-UPLOAD, I-PROPOSED-VIDEO-AUTOPLAY-MUTED-CONTRACT. **IMPLEMENT is GATED on ORCH-0964 [Public-page theme customization] PR merging to main** (per WORLD_MAP intake; ORCH-0964 introduces `packages/brand-rendering/` and reshapes `packages/event-rendering/` — collision risk on render-layer files).

---

## 2 — Scope and non-goals

### Scope (what this SPEC covers)

- **Workstream B (UX polish)** subset focused on sub-30s render goal:
  - Client-side video compression on iOS + Android (react-native-compressor)
  - Cancel-during-upload abort flow (XHR/task abort + Cloudinary destroy)
  - Three-stage labeled progress UX (compressing / uploading / processing)
  - Optimistic local preview swap pattern
- **Render-layer parity** for cover video across all 5 surfaces (web + business iOS/Android + consumer iOS/Android), reusing `EventCoverMedia` via shared package
- **Cross-surface cover-media expansion** subset: ensure `expo-video` is available in `app-mobile` so consumer-side renders behave identically to business-side
- **Webhook signature verification** unchanged (already HMAC-SHA1, working correctly)
- **Status polling** tuned: `pollIntervalMs` 2500 → 1500

### Non-goals (explicit out-of-scope)

- **Workstream A (full media-picker inventory)** — separate broader-investigation ORCH covers enumerating every picker surface; this SPEC modifies only the event-cover-video upload path
- **Workstream C (Cloudinary lifecycle / cost-control / orphan reconciliation)** — separate broader scope; this SPEC's ONLY workstream-C interaction is the cancel-destroy call (because cancel orphans an asset without it; that's the same bug as the broader lifecycle problem manifesting in the cancel path)
- **Expo SDK 55 migration** — both apps stay on SDK 54; existing `expo-av` audio code in `app-mobile` is untouched (4 files: `FeedbackHistorySheet.tsx`, `BetaFeedbackModal.tsx`, `MessageInterface.tsx`, `betaFeedbackService.ts`)
- **HLS / sp_auto** — RESEARCH explicitly recommended against; direct MP4 retained
- **EdDSA v2 webhook signature** — RESEARCH noted as forward-compatibility consideration; not blocking; HMAC-SHA1 retained
- **Brand cover video / trip cover video / brand profile photo video** — only event-cover-video pipeline is touched here
- **Admin web** — no admin cover authoring exists
- **Buyer-anonymous routes** — render contract applies (read-only); no auth/auth changes
- **Picker affordance copy** ("Photo / GIF / Video" friendly label) — defer to broader UX polish
- **Audio bug fixes in beta feedback `expo-av` callsites** — irrelevant to ORCH-0978

### Assumptions

- ORCH-0964 PR will merge before IMPLEMENT begins (operator-gated)
- `react-native-compressor` v1.18.2 works with Expo SDK 54 + Expo dev client (the package README documents `expo prebuild` integration; verified working in similar 2026 Expo apps per RESEARCH §Q1)
- Operator can run the empirical PoC clause (Phase 6 T-00) on physical iPhone 13/16 Pro + Pixel 6/Galaxy S22 OR forensics is asked to script it via dev-client builds
- Cloudinary plan supports Admin API destroy calls (true for all paid plans; verify against current Mingla plan tier)

---

## 3 — Cross-Surface Impact Declaration (MANDATORY)

| Surface | Coverage | User-visible behaviour the SPEC demands | Files touched | Parity model | Per-surface success criteria |
|---|---|---|---|---|---|
| **Business iOS** (`mingla-business/` on iOS) | IN SCOPE (write + read) | (1) Picker → client-side compress (5–15s) → upload → 3-stage progress + cancel button → optimistic local preview from t=2s → final cloud render swap. (2) All cover videos render via `EventCoverMedia` with muted autoplay + tap-to-unmute + bottom-right speaker icon. | `mingla-business/src/services/eventCoverVideoProcessingService.ts`, `mingla-business/src/components/event/EventCoverPicker.tsx` (existing — refactor), `mingla-business/src/components/ui/EventCoverMedia.tsx` (existing — minor add: `onFirstFrameRender` + optional `localPreviewUri` prop) | Manual per platform; native code-path | SC-1-iOS, SC-2-iOS, SC-3-iOS, SC-5-iOS, SC-6-iOS, SC-7-iOS, SC-8-iOS |
| **Business Android** (`mingla-business/` on Android) | IN SCOPE (write + read) | Same as iOS; SPEC must address react-native-compressor issue #268 (Android-compressed output sometimes unplayable on iOS) via cross-surface T-11 test | Same as iOS | Manual per platform; native code-path | SC-1-Android, SC-2-Android, SC-3-Android, SC-5-Android, SC-6-Android, SC-7-Android, SC-8-Android, SC-11-Android |
| **Business web preview** (`mingla-business/` Expo for Web / Next.js shell) | IN SCOPE (write + read) | (1) Picker → SKIP compression (web has no native module) → chunked raw upload via `X-Unique-Upload-Id` + `Content-Range` (10 MB chunks) → 2-stage progress + cancel → optimistic local Blob URL preview → final cloud render swap. (2) Render via `EventCoverMedia` web branch (`<video>` + muted+playsInline+autoplay+loop). | Same service file + new web-branch upload-chunk helper; same `EventCoverMedia.tsx` (web branch already complete) | Auto (shared service + shared component web branch) | SC-1-Web, SC-2-Web, SC-3-Web, SC-5-Web, SC-6-Web, SC-7-Web, SC-8-Web |
| **Buyer-web** (`mingla-business/` `/e/{brandSlug}/{eventSlug}`, `/b/{brandSlug}`) | IN SCOPE (read only) | Cover videos render via `EventCoverMedia` web branch. Muted autoplay + tap-to-unmute. No picker, no upload. | Existing `EventCoverMedia.tsx` usage at the buyer-web event/brand pages | Auto (shared component) | SC-3-Web, SC-8-Web (read-side validation) |
| **iOS consumer** (`app-mobile/` on iOS) | IN SCOPE (read only) | Cover videos render via shared `EventCoverMedia` (extracted to package). Muted autoplay + tap-to-unmute. **NEW dependency:** `expo-video` added to `app-mobile/package.json`. | Add `expo-video` to `app-mobile/package.json`; extract `EventCoverMedia` into shared package; consume in `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` and ORCH-0964's new `app-mobile/app/brand/[slug]/` surfaces | Auto via shared package (post-extraction) | SC-3-iOS-consumer, SC-8-iOS-consumer |
| **Android consumer** (`app-mobile/` on Android) | IN SCOPE (read only) | Same as iOS consumer; SPEC validates no rendering regression from `expo-video` issue #39962 (first-frame-black) via T-12 test | Same as iOS consumer | Auto via shared package | SC-3-Android-consumer, SC-8-Android-consumer, SC-12-Android-consumer |
| **Admin web** (`mingla-admin/`) | NOT IN SCOPE | No admin cover authoring exists; admin doesn't render event covers | — | — | — |

---

## 4 — Layered specification

### 4.1 Database layer

**No schema changes required.** Existing `event_cover_video_jobs` table covers all needed state. Optional telemetry additions (deferred to a follow-up if operator wants analytics):
- `client_compressed_bytes` (bigint) — for compression-ratio telemetry
- `cancel_reason` (text) — for cancel-flow analytics

**Decision: defer both.** SPEC does not introduce DB changes. No migration file needed.

### 4.2 Edge function layer

#### `event-cover-video-upload-intent/index.ts` — NO functional change

Existing flow (signed `eager_async=true` + `eager_notification_url`) is correct per RESEARCH §Q2. Optional: add `clientCompressedBytes` to request body for telemetry-only (no behaviour change). **Decision: defer.**

#### `event-cover-video-webhook/index.ts` — NO functional change

Existing HMAC-SHA1 verification via `verifyCloudinaryNotificationSignature` (`_shared/eventCoverVideo.ts:155-220`) is correct. Retry-idempotency via `existingJob.status` gates already handles 3/6/9 min Cloudinary retries. No change.

#### `event-cover-video-cancel/index.ts` — MODIFIED (this is the key change)

**Today:** flips `event_cover_video_jobs.status = 'cancelled'` and returns. Does NOT call Cloudinary destroy. Leaves any uploaded asset orphaned on Cloudinary.

**SPEC change:** after flipping job status, call Cloudinary's destroy API to remove the asset.

**Request schema (unchanged):**
```ts
{ jobId: string }
```

**New behaviour:**
1. Read job row by `jobId`.
2. If `status` already terminal (`applied`, `failed`, `cancelled`), return current state (idempotent).
3. Read `provider_payload.public_id` from the job row (set at upload-intent time, `event-cover-video-upload-intent/index.ts:270`).
4. Call Cloudinary destroy API: `POST https://api.cloudinary.com/v1_1/{cloudName}/video/destroy` with signed params `{ public_id, timestamp, signature, api_key }`. Cite: [Cloudinary Admin destroy API — https://cloudinary.com/documentation/admin_api#destroy_a_single_resource]. **Destroy is best-effort** — log failure but do NOT fail the cancel; the job status still flips to cancelled. Lifecycle reconciliation (workstream C, deferred) will sweep any destroy failures later.
5. Update `event_cover_video_jobs.status = 'cancelled'`, `cancelled_at = NOW()`, `failure_code = 'user_cancelled'`, `failure_message = 'Cancelled by user.'`.
6. Return mapped status payload.

**Auth requirement:** existing `requireUserId` + `requireEventManager` check is preserved.

**New shared helper in `_shared/eventCoverVideo.ts`:**
```ts
export async function cloudinaryDestroy(publicId: string): Promise<{ ok: boolean; reason?: string }> {
  const cloudName = Deno.env.get("CLOUDINARY_CLOUD_NAME") ?? "";
  const apiKey = Deno.env.get("CLOUDINARY_API_KEY") ?? "";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await cloudinarySignature({ public_id: publicId, timestamp });
  const formData = new FormData();
  formData.append("public_id", publicId);
  formData.append("api_key", apiKey);
  formData.append("timestamp", timestamp);
  formData.append("signature", signature);
  formData.append("resource_type", "video");
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/video/destroy`,
    { method: "POST", body: formData }
  );
  if (!response.ok) {
    return { ok: false, reason: `cloudinary_destroy_${response.status}` };
  }
  const body = await response.json() as { result?: string };
  if (body.result !== "ok" && body.result !== "not found") {
    return { ok: false, reason: `cloudinary_destroy_${body.result ?? "unknown"}` };
  }
  return { ok: true };
}
```

Cite inline: [Cloudinary destroy reference — https://cloudinary.com/documentation/image_upload_api_reference#destroy_method] (image and video share the same destroy endpoint structure with different `resource_type`).

### 4.3 Service layer (`mingla-business/src/services/eventCoverVideoProcessingService.ts`)

#### New function — `compressVideoLocally`

```ts
import { Platform } from "react-native";
// Conditional import: avoid pulling react-native-compressor on web
const VideoCompressor = Platform.OS === "web" ? null : require("react-native-compressor").Video;

export type CompressionProgress = { phase: "compressing"; percent: number };

export async function compressVideoLocally(input: {
  uri: string;
  bytes: number;
  durationMs: number;
  onProgress?: (progress: CompressionProgress) => void;
}): Promise<{ uri: string; bytes: number; durationMs: number; wasCompressed: boolean }> {
  if (Platform.OS === "web" || VideoCompressor === null) {
    // Web: no native compression available; pass through raw
    return { uri: input.uri, bytes: input.bytes, durationMs: input.durationMs, wasCompressed: false };
  }
  if (input.bytes < 5 * 1024 * 1024) {
    // < 5 MB: not worth compressing
    return { uri: input.uri, bytes: input.bytes, durationMs: input.durationMs, wasCompressed: false };
  }
  const compressedUri = await VideoCompressor.compress(
    input.uri,
    { compressionMethod: "auto" },
    (progress: number) => {
      input.onProgress?.({ phase: "compressing", percent: Math.round(progress * 100) });
    }
  );
  // react-native-compressor returns the compressed file URI; we don't get exact bytes/duration back from the API
  // so the caller re-stats the file via expo-file-system if precise numbers are needed
  return {
    uri: compressedUri,
    bytes: input.bytes, // caller may re-stat
    durationMs: input.durationMs, // unchanged by compression
    wasCompressed: true,
  };
}
```

Cite inline: [react-native-compressor Video.compress API — https://github.com/numandev1/react-native-compressor#compress-1].

#### Modified — `uploadEventCoverVideoSource`

Add chunked-upload fallback when `bytes > 50 MB` (per RESEARCH §Q2):
- Hold a ref to the active XHR/task for cancel-abort support
- New `signal: AbortSignal` parameter so the caller can wire up an abort controller
- Chunked path: split into 10 MB chunks, send each with `X-Unique-Upload-Id: <jobId>` + `Content-Range: bytes <start>-<end>/<total>`. Cite: [Cloudinary chunked upload guidelines — https://support.cloudinary.com/hc/en-us/articles/208263735-Guidelines-for-implementing-chunked-upload-to-Cloudinary]
- Direct path (unchanged for <50 MB): existing FileSystem.createUploadTask + XHR fallback
- Both paths: call `xhr.abort()` / `task.cancelAsync()` if signal fires

#### Modified — `cancelEventCoverVideoJob`

Before invoking the cancel edge function, call any in-flight upload abort:
```ts
export async function cancelEventCoverVideoJob(input: {
  jobId: string;
  uploadAbortController?: AbortController;
}): Promise<EventCoverVideoStatus> {
  input.uploadAbortController?.abort();
  // ...existing edge fn call...
}
```

#### Modified — `waitForEventCoverVideoReady`

Change default `pollIntervalMs` from 2500 to **1500** (per RESEARCH §Q2-A). Keep 120s default `timeoutMs`.

#### New return type for caller progress wiring

```ts
export type EventCoverVideoUploadStage =
  | { phase: "picking"; percent: 0 }
  | { phase: "compressing"; percent: number }
  | { phase: "uploading"; percent: number }
  | { phase: "processing"; percent: number }
  | { phase: "ready"; percent: 100 }
  | { phase: "error"; percent: 0; code: string; message: string };
```

### 4.4 Hook layer (React Query)

#### New hook — `useEventCoverVideoUpload(eventId, brandId)` in `mingla-business/src/hooks/useEventCoverVideoUpload.ts`

```ts
export function useEventCoverVideoUpload(eventId: string, brandId: string): {
  start: (file: { uri: string; fileName?: string; mimeType?: string; bytes: number; durationMs: number; trimStartMs?: number; trimEndMs?: number }) => Promise<void>;
  cancel: () => void;
  stage: EventCoverVideoUploadStage;
  status: EventCoverVideoStatus | null;
  processedUrl: string | null;
  localPreviewUri: string | null;
  error: Error | null;
} {
  // Holds AbortController in a ref; orchestrates compress → upload → poll
  // localPreviewUri is the input.uri before compression — used by the picker UI for optimistic preview
  // processedUrl is set when poll returns status === 'ready' or 'applied'
}
```

**Query key factory addition** at `mingla-business/src/hooks/queryKeys/eventCoverVideoQueryKeys.ts`:
```ts
export const eventCoverVideoQueryKeys = {
  all: ["eventCoverVideo"] as const,
  job: (jobId: string) => [...eventCoverVideoQueryKeys.all, "job", jobId] as const,
} as const;
```

**Cache invalidation:** on `status === 'applied'`, invalidate `eventQueryKeys.detail(eventId)` (existing key factory) so any consumer reading the event's `cover_media_url` refetches.

### 4.5 Component layer

#### `EventCoverPicker` (refactor existing OR new) at `mingla-business/src/components/event/EventCoverPicker.tsx`

**Props:**
```ts
interface EventCoverPickerProps {
  eventId: string;
  brandId: string;
  applyMode: EventCoverVideoApplyMode;
  currentCoverUrl: string | null;
  currentCoverType: EventCoverMediaType | null;
  onChange: (newUrl: string, newType: EventCoverMediaType) => void;
}
```

**States (use `useEventCoverVideoUpload` hook):**

| Phase | Visible UI | Copy | Progress |
|---|---|---|---|
| idle | Picker affordance (existing) | "Tap to add a cover" | n/a |
| picking | System picker open (no UI change) | n/a | n/a |
| compressing | `EventCoverMedia` with `localPreviewUri` + linear progress bar overlay | "Compressing on your phone... {Xs left}" | 0–15% bar |
| uploading | `EventCoverMedia` with `localPreviewUri` + linear progress bar overlay | "Uploading... {Xs left}" | 15–90% bar |
| processing | `EventCoverMedia` with `localPreviewUri` + indeterminate spinner overlay | "Almost ready..." | 90–100% spinner |
| ready | `EventCoverMedia` with `mediaUrl=processedUrl` (swap) | (no overlay; player visible) | hidden |
| error | `EventCoverMedia` with last known URL (or empty) + error message + Retry button | "Couldn't process this video. Try a different clip." + "Retry" | n/a |

**Cancel button:** rendered in compressing/uploading/processing states only. Calls `cancel()` from the hook. Confirmation modal NOT required (cancel is fast and recoverable).

**Optimistic local preview pattern (per I-PROPOSED-VIDEO-UPLOAD-OPTIMISTIC-PREVIEW):**
- The picker mounts `<EventCoverMedia mediaUrl={localPreviewUri ?? processedUrl ?? currentCoverUrl} mediaType="video" autoplay={true} muted={true} loop={true} />` IMMEDIATELY after the user picks a file.
- When `processedUrl` becomes non-null, the prop swaps. The render component handles the source change transparently.

#### `EventCoverMedia` (existing — at `mingla-business/src/components/ui/EventCoverMedia.tsx`) — MINOR additions

The existing component (read in Phase 0) already implements:
- Web `<video>` branch with `autoplay`, `muted`, `playsInline`, `loop`, `onError`, click handler for mute toggle
- RN `VideoView` + `useVideoPlayer` with `loop`, `muted`, autoplay
- Audio control overlay (`showAudioControl`, `audioControlPosition`)
- Error handling + disposed-player guard (`callNativeVideoPlayer`)

**Additions required:**
1. **`onFirstFrameRender` prop wired to expo-video's callback** to support poster-overlay hiding (per RESEARCH §Q4 + expo-video docs). Add `onFirstFrameRender?: () => void` to props; pass through to `VideoView`. Web branch fires it on `loadeddata` event.
2. **Optional `posterUri` prop** for poster overlay during first-frame load. Mounts an `Image` overlay that hides on `onFirstFrameRender`.
3. **Re-export from shared package** — see §4.6.

#### `EventCoverMedia` extraction to shared package — §4.6

The existing `EventCoverMedia.tsx` lives in `mingla-business/src/components/ui/`. The consumer app (`app-mobile/`) currently has NO equivalent and renders covers via `ExpandedBusinessEventSheet.tsx` (and ORCH-0964 will add `app/brand/[slug]/` consumption). To achieve cross-surface parity (SC-8), SPEC requires extraction.

**Two paths — SPEC selects path (a), defers path (b) to operator:**

**(a) RECOMMENDED — extend `packages/event-rendering/` (existing) with `EventCoverMedia.tsx`:**
- Move `mingla-business/src/components/ui/EventCoverMedia.tsx` → `packages/event-rendering/EventCoverMedia.tsx`
- Update `mingla-business/src/components/ui/EventCoverMedia.tsx` to re-export: `export { EventCoverMedia } from "@mingla/event-rendering";`
- Add to `packages/event-rendering/index.ts`
- Add `expo-video` to `packages/event-rendering/package.json` peerDependencies (already present in `mingla-business`; will be added to `app-mobile`)
- Consumer imports: `import { EventCoverMedia } from "@mingla/event-rendering";`

**(b) ALTERNATIVE — new `packages/cover-media/` package:**
- More isolated; less coupling to ORCH-0964's `packages/event-rendering/` reshape
- Higher complexity (one more package to maintain)

**Decision: path (a).** Rationale: ORCH-0964 already touches `packages/event-rendering/` and will introduce `packages/brand-rendering/`; piggy-backing `EventCoverMedia` into `event-rendering` minimizes the post-ORCH-0964 rebase surface for ORCH-0978. If ORCH-0964's IMPLEMENT changes the package structure in a way that makes (a) impractical, IMPLEMENT may pivot to (b) — orchestrator REVIEW will catch this.

#### Add `expo-video` to `app-mobile/package.json`

Add `"expo-video": "~3.0.16"` (matching mingla-business's pinned version) to `app-mobile/package.json` dependencies. After install + dev-client rebuild, `app-mobile` can consume `EventCoverMedia` from the shared package.

**Native build implication:** adding a native module requires a dev-client rebuild. Operator-confirmed before IMPLEMENT begins (the EAS OTA path will NOT pick up this dependency; full `eas build` or local dev-build is required for native testing).

---

## 5 — Success criteria (numbered, observable, testable, per-surface where parity is manual)

**SC-1 — Optimistic local preview to first frame ≤ 3 seconds**

- SC-1-iOS-business: pick a 15s 1080p HEVC clip on iPhone 13/16 Pro → first frame painted in `EventCoverMedia` within 3 seconds (perceived-30s anchor)
- SC-1-Android-business: same on Pixel 6 / Galaxy S22
- SC-1-Web: same on Chrome desktop + Safari iOS at the business web composer

**SC-2 — Final cloud URL ready (DB `cover_media_url` set + status='applied')**

- SC-2-iOS-business: ≤ 30s for a 15s 1080p input on 10 Mbps Wi-Fi
- SC-2-Android-business: ≤ 30s same conditions
- SC-2-Web: ≤ 30s (web composer skips compression so upload bytes are larger; on Wi-Fi this still holds for 15s 1080p ≈ 30 MB → 24s at 10 Mbps + minimal transcode)
- SC-2-cellular: ≤ 60s on 5 Mbps cellular for mobile surfaces (compression-bound)

**SC-3 — Autoplay muted on initial mount across all 5 surfaces (read parity)**

- SC-3-iOS-business: `EventCoverMedia` autoplays muted in event-edit preview
- SC-3-Android-business: same
- SC-3-Web: web `<video muted playsInline autoplay>` plays inline without user gesture on Chrome + Safari iOS (per WebKit policy: `muted` + `playsinline` + `autoplay` attribute trio required)
- SC-3-iOS-consumer: consumer app `EventCoverMedia` (from shared package) autoplays muted in `ExpandedBusinessEventSheet` + ORCH-0964 `/brand/[slug]`
- SC-3-Android-consumer: same

**SC-4 — Tap-to-unmute interaction**

- SC-4-all: tapping anywhere on the video toggles muted state. Bottom-right speaker icon reflects new state (speaker-with-slash vs speaker-with-waves). No re-mount of player. Per `expo-video` API: `player.muted = false` does not affect `player.volume` and does not require source reload.
- SC-4-iOS-Safari-edge: programmatic unmute attempt without user gesture (test-only) → `<video>` element pauses per WebKit policy. Test confirms expected pause behaviour.

**SC-5 — Cancel-during-upload**

- SC-5-all: tapping Cancel during any of {compressing, uploading, processing} states (a) aborts the active in-flight task within 500 ms (XHR abort or task.cancelAsync), (b) flips `event_cover_video_jobs.status = 'cancelled'`, (c) calls Cloudinary destroy on the uploaded `public_id` so no orphan asset remains on Cloudinary, (d) destroys the optimistic local preview state and returns the picker to idle/error visual.

**SC-6 — Three-stage progress UI**

- SC-6-all: visible labeled progress through "Compressing on your phone" → "Uploading" → "Almost ready" with monotonically-increasing progress 0→100%. No regression to a single ambiguous spinner. No "Processing" or generic "Loading" copy.

**SC-7 — Optimistic local-preview swap is seamless**

- SC-7-all: swap from `localPreviewUri` to `processedUrl` produces ≤1 frame visual discontinuity, no flash of black, no audio click beyond imperceptible single-sample discontinuity. Test-measured via screen recording frame-by-frame analysis at swap moment.

**SC-8 — Cross-surface render parity**

- SC-8-all: the same uploaded clip renders pixel-equivalent (modulo H.264-quantization differences, which are deterministic) on:
  - Web `<video>` in Chrome desktop + Safari iOS
  - `expo-video` `VideoView` on iOS native (business + consumer)
  - `expo-video` `VideoView` on Android native (business + consumer)
- Acceptable variance: HDR→SDR loss (uniform across surfaces because all 5 receive the same H.264 SDR derivative); no surface gets a higher-quality version than another.

**SC-9 — Webhook retry safety**

- SC-9-backend: with Mingla webhook endpoint down at first delivery, Cloudinary's 3/6/9-min retry policy delivers the notification within ~18 minutes total; job eventually reaches `applied` state. Existing idempotency gates (`existingJob.status === 'cancelled' | 'applied'` short-circuit) handle duplicates safely.

**SC-10 — Status-poll timeout**

- SC-10-all: client poll exits cleanly with "still processing — try again later" message at 120s if status doesn't reach terminal. Does NOT hang the UI. Existing `waitForEventCoverVideoReady` timeout behavior preserved.

**SC-11 — Android-compressed output cross-platform playability (react-native-compressor #268 regression guard)**

- SC-11-Android: upload a 15s 1080p clip on Android → resulting Cloudinary derivative plays correctly on iOS consumer app + Safari iOS web. Cite: [react-native-compressor issue #268 — https://github.com/numandev1/react-native-compressor/issues/268]
- If T-11 fails: pivot to platform-specific compression (custom AVAssetExportSession on iOS via Expo Module API; MediaCodec on Android via Expo Module API). SPEC defers the implementation of the fallback to the IMPLEMENT phase if T-11 fails — implementor returns NEEDS WORK and SPEC is amended.

**SC-12 — Android `expo-video` first-frame-black bug (#39962) mitigation**

- SC-12-Android-consumer: `EventCoverMedia` on Android either paints first frame OR `posterUri` overlay covers any blank period. NEVER blank-black-frame visible to user. Cite: [expo issue #39962 — https://github.com/expo/expo/issues/39962]

---

## 6 — Invariants

### Preserved (must NOT regress)

- **I-COMMS-LEDGER-ENTRY-STANZA** — Every skill ack writes to `COMMS_LEDGER.md` `acked_by`
- **I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED** (DRAFT, COMMS-0003) — Every Cloudinary docs URL is inline-cited in this SPEC and must remain so in the implementation
- **Constitutional rule #3 (No silent failures)** — Every cancel/abort/destroy path surfaces error or success; no swallowed exceptions
- **Constitutional rule #9 (No fabricated data)** — Progress percentages reflect actual bytes/time; no smoothing
- **Constitutional rule #11 (One auth instance)** — Cancel edge fn still uses `requireUserId` + `requireEventManager`
- **Existing race-handling** — Prior in-flight job is cancelled when a new upload-intent fires (`event-cover-video-upload-intent/index.ts:179-198` — DO NOT REGRESS)
- **Webhook idempotency** — `existingJob.status` gates at `event-cover-video-webhook/index.ts:104-113` (DO NOT REGRESS)
- **Derivative validation** — `assertProcessedDerivative` keeps enforcing H.264 + AAC + MP4 + size + duration

### Introduced (DRAFT — flip to ACTIVE on CLOSE)

- **I-PROPOSED-VIDEO-UPLOAD-OPTIMISTIC-PREVIEW** — Every video-cover upload UI MUST render the user's local file URI in a player within 3 seconds of file pick, regardless of upload/transcode state. **CI gate:** strict-grep for `<VideoView` or `<video` mounts in any picker component without a preceding `localPreviewUri` state reference within the same component file. New file: `.github/scripts/strict-grep/orch-0978-video-upload-optimistic-preview.mjs`. Wired into `.github/workflows/strict-grep-mingla-business.yml`.
- **I-PROPOSED-VIDEO-CANCEL-ABORTS-UPLOAD** — Every video upload cancel handler MUST call `abortController.abort()` (or equivalent task cancel) BEFORE calling the cancel edge fn. **CI gate:** strict-grep for `cancelEventCoverVideoJob` callers without a preceding `abort()` call within the same function body. New file: `.github/scripts/strict-grep/orch-0978-video-cancel-aborts-upload.mjs`.
- **I-PROPOSED-VIDEO-AUTOPLAY-MUTED-CONTRACT** — All video cover renderers MUST set `muted` default to true and require a user-gesture handler for unmute. **CI gate:** strict-grep that `EventCoverMedia` props default `muted={true}` and no callsite passes `muted={false}` without an accompanying `userGestureProof` comment. New file: `.github/scripts/strict-grep/orch-0978-video-autoplay-muted-contract.mjs`.

All three new gate files added to the existing `ORCH_0978_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (per COMMS-0002 — same commit as the edge fn modifications).

---

## 7 — Test cases

| Test | Scenario | Input | Expected | Layer | Platforms |
|---|---|---|---|---|---|
| **T-00** | **Empirical PoC clause (BLOCKS IMPLEMENT)** | 15s + 30s 1080p HEVC + H.264 clips | Time-to-compress per device; output bytes; visual quality; SC-11 cross-playability | Service | iPhone 13, iPhone 16 Pro, Pixel 6, Galaxy S22 |
| T-01 | Happy path (Wi-Fi) | 15s 1080p HEVC from iPhone 13 | SC-1 ≤3s; SC-2 ≤30s; SC-6 3-stage progress visible; SC-3 autoplays muted | full stack | iOS+Android+Web |
| T-02 | Cellular slow network | Same clip on 5 Mbps throttled | SC-1 ≤3s; SC-2 ≤60s; SC-7 swap seamless | full stack | iOS+Android (no web — desktop usually wifi) |
| T-03 | Cancel mid-compression | Tap Cancel during react-native-compressor run (0–15% phase) | Compression aborts within 500ms; no upload starts; no Cloudinary asset created; job row never inserted | Component+Service | iOS+Android |
| T-04 | Cancel mid-upload | Tap Cancel during XHR upload (15–90% phase) | XHR aborts within 500ms; job row → cancelled; Cloudinary destroy called on partial public_id; no orphan asset (verified via Cloudinary admin list) | Full stack | iOS+Android+Web |
| T-05 | Cancel mid-processing | Tap Cancel after upload bytes done, during Cloudinary transcode | Late webhook ignored (existing guard); job row → cancelled; Cloudinary destroy called on completed public_id; no orphan asset | Edge+Service | iOS+Android+Web |
| T-06 | Webhook retry on endpoint downtime | Take Supabase webhook endpoint down 5 min after upload completes | Cloudinary retry at +3 min delivers; job reaches applied within 5 min | Edge+Cloudinary | backend |
| T-07 | Race: new upload while previous in-flight | Upload cover B during cover A processing | A cancelled (existing guard); A's Cloudinary asset destroyed (new cancel-destroy behavior); B proceeds normally; both jobs traceable in `event_cover_video_jobs` | Edge+Cloudinary | iOS+Android+Web |
| T-08 | Cross-surface render parity (read) | Upload one clip once; load same `processedUrl` on web, iOS business, Android business, iOS consumer, Android consumer | Pixel-equivalent frame at t=0.5s, t=2s, t=10s (modulo deterministic H.264 quantization) | Render | all 5 surfaces |
| T-09 | Mute/unmute persistence | Tap to unmute; navigate away to another event; return | Mute state default-resets to true (cover videos always default muted per SC-3); user must re-unmute. No state leakage. | Component | iOS+Android+Web |
| T-10 | iOS Safari programmatic-unmute pause | In test, call `videoEl.muted = false` without user gesture | Player pauses per WebKit policy (https://webkit.org/blog/6784/new-video-policies-for-ios/) | Web | Web (Safari iOS) |
| T-11 | react-native-compressor #268 regression (Android→iOS playability) | Upload on Android (Pixel 6); render resulting Cloudinary URL on iOS consumer + Safari iOS | Plays correctly with audio; no codec-mismatch failure; visual frame parity with T-08 | Cross-platform | Android upload → iOS playback |
| T-12 | expo-video #39962 first-frame-black guard | Mount `EventCoverMedia` cold-load on Android emu | EITHER first frame paints within 500ms OR `posterUri` overlay covers any blank period; never user-visible blank black frame | Render | Android (business + consumer) |
| T-13 | Webhook signature replay attack | Replay an old webhook payload (timestamp older than 1 hour) | `verifyCloudinaryNotificationSignature` returns `stale_timestamp` → 403; job state unchanged | Edge | backend |
| T-14 | Cloudinary destroy failure (best-effort) | Cancel job; mock Cloudinary destroy returning 500 | Job still flips to cancelled; failure logged; no user-visible error; reconciliation sweep (workstream C) flagged for follow-up | Edge | backend |
| T-15 | Web composer chunked upload | Upload 80 MB raw video from web composer (no compression) | Splits into 8 chunks of 10 MB; X-Unique-Upload-Id == jobId; final chunk returns `done: true`; full upload completes; job proceeds normally | Service | Web |

---

## 8 — Implementation order

**STEP 0 — Pre-IMPLEMENT gate (BLOCKING per SC-T-00 PoC clause):**
- Operator confirms ORCH-0964 PR has merged to main and operator has rebased the ORCH-0978 worktree onto fresh main.
- Operator (or forensics-scripted dev-build) runs T-00 PoC measuring real-world `react-native-compressor` performance on iPhone 13 / iPhone 16 Pro / Pixel 6 / Galaxy S22 with 15s + 30s 1080p HEVC + H.264 inputs. Record per-device time-to-compress and output bytes. **If any device exceeds 15s compression time OR T-11 fails on the resulting output, return to SPEC for amendment before IMPLEMENT proceeds.**

**STEP 1 — Dependencies (no code logic yet):**
1. Add `react-native-compressor` `~1.18.2` to `mingla-business/package.json` AND `app-mobile/package.json`.
2. Add `expo-video` `~3.0.16` to `app-mobile/package.json` (mingla-business already has it).
3. Add `react-native-compressor` to the Expo `plugins` array in both apps' `app.json` / `app.config.ts`.
4. Run `expo prebuild` in both apps (native rebuild required).
5. Run `npm install` (the `package.json` touches trigger `node_modules` symlink removal in the worktree — implementor MUST remove the symlinks and do a real install per `feedback_worktree_per_orch_workflow.md`).

**STEP 2 — Shared component extraction:**
6. Move `mingla-business/src/components/ui/EventCoverMedia.tsx` → `packages/event-rendering/EventCoverMedia.tsx`.
7. Add `EventCoverMedia` export to `packages/event-rendering/index.ts`.
8. Update `packages/event-rendering/package.json` peerDependencies to include `expo-video`.
9. Update the existing `mingla-business` callsite to import from the package (re-export shim OR direct import).
10. Wire `app-mobile` consumer-side callsites: `ExpandedBusinessEventSheet.tsx` + (post-ORCH-0964) any new `/brand/[slug]` cover render surfaces.

**STEP 3 — Component additions to `EventCoverMedia`:**
11. Add `onFirstFrameRender?: () => void` prop, wire to `VideoView` callback on RN, wire to `loadeddata` event on web.
12. Add `posterUri?: string` prop, render as `<Image>` overlay that hides on first-frame-render. (T-12 mitigation.)

**STEP 4 — Edge function changes:**
13. Add `cloudinaryDestroy` helper to `_shared/eventCoverVideo.ts`.
14. Modify `event-cover-video-cancel/index.ts` to call `cloudinaryDestroy` after status flip (best-effort, log failures).
15. Add `_shared/eventCoverVideo.ts` and `event-cover-video-cancel/index.ts` to `ORCH_0978_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (SAME commit per COMMS-0002).

**STEP 5 — Service-layer changes:**
16. Add `compressVideoLocally` function to `eventCoverVideoProcessingService.ts`.
17. Modify `uploadEventCoverVideoSource` to (a) accept `AbortSignal`, (b) chunked path for `bytes > 50 MB`.
18. Modify `cancelEventCoverVideoJob` to accept `uploadAbortController?: AbortController` and abort before edge call.
19. Reduce `waitForEventCoverVideoReady` default `pollIntervalMs` from 2500 → 1500.
20. Add `EventCoverVideoUploadStage` discriminated union type.

**STEP 6 — Hook layer:**
21. New `useEventCoverVideoUpload` hook at `mingla-business/src/hooks/useEventCoverVideoUpload.ts`.
22. New query key factory `mingla-business/src/hooks/queryKeys/eventCoverVideoQueryKeys.ts`.

**STEP 7 — Component layer:**
23. Refactor existing `EventCoverPicker` to consume the new hook + render three-stage progress UI with optimistic local preview.

**STEP 8 — CI gates:**
24. Create `.github/scripts/strict-grep/orch-0978-video-upload-optimistic-preview.mjs`.
25. Create `.github/scripts/strict-grep/orch-0978-video-cancel-aborts-upload.mjs`.
26. Create `.github/scripts/strict-grep/orch-0978-video-autoplay-muted-contract.mjs`.
27. Add all 3 to `.github/workflows/strict-grep-mingla-business.yml` as 3 new jobs.
28. Add each script's path to `ORCH_0978_BACKEND_ALLOWLIST` in same commit.

**STEP 9 — Regression tests (Step 0.5 CLOSE-gate prep):**
29. **Implementor happy-path** test at `mingla-business/__tests__/services/eventCoverVideoProcessingService.compression.test.ts` exercising T-01 (compress → upload → ready) with `fails-on-revert verified at <hash>` line.
30. **Tester adversarial** test at `mingla-business/__tests__/services/eventCoverVideoProcessingService.cancelMidProcessing.adversarial.test.ts` exercising T-05 (cancel during processing + Cloudinary destroy mocked-failure verification) — DIFFERENT angle from implementor's happy-path (covers the cancel-destroy edge case + the best-effort destroy failure semantics).

**STEP 10 — Build + deploy:**
31. Implementor runs `npm test` in both apps (jest + RN-test-renderer suites). All green.
32. Operator runs `supabase db push --linked` from per-ORCH worktree (no migration in this SPEC — skip).
33. Orchestrator deploys `event-cover-video-cancel` (CLI: `/Users/sethogieva/bin/supabase functions deploy event-cover-video-cancel --project-ref gqnoajqerqhnvulmnyvv`) + verifies version bump + verifies `verify_jwt: true` preserved.
34. Orchestrator deploys any other edge fn whose `_shared/` imports were touched (since `_shared/eventCoverVideo.ts` got `cloudinaryDestroy` added, ALL functions importing it may need redeploy — verify and deploy as needed).
35. Operator-assisted live-fire smoke test on iOS sim + Android emu + web preview.

---

## 9 — Regression prevention

| Class of bug | Structural safeguard | Catching test | Protective comment |
|---|---|---|---|
| Silent upload failure due to oversized raw input on cellular | Client-side compression is MANDATORY on RN platforms (CI gate per I-PROPOSED-VIDEO-UPLOAD-OPTIMISTIC-PREVIEW); new picker code paths must use the hook | T-02 (cellular slow network end-to-end) | "Compression is required; see I-PROPOSED-VIDEO-UPLOAD-OPTIMISTIC-PREVIEW" |
| Orphaned Cloudinary asset from incomplete cancel | I-PROPOSED-VIDEO-CANCEL-ABORTS-UPLOAD invariant + cancel-edge-fn destroy call + CI gate | T-04, T-05 | "// Cancel must call abort() AND destroy() — see I-PROPOSED-VIDEO-CANCEL-ABORTS-UPLOAD" |
| Blank-frame autoplay UX (first-frame-black bug #39962) | `posterUri` overlay + `onFirstFrameRender` callback hide pattern | T-12 | "// Poster covers Android first-frame-black bug expo#39962" |
| Autoplay-with-sound surprise | I-PROPOSED-VIDEO-AUTOPLAY-MUTED-CONTRACT invariant + CI gate | T-04, T-10 | "// `muted={true}` is mandatory at mount — see I-PROPOSED-VIDEO-AUTOPLAY-MUTED-CONTRACT" |
| Android-compressed-output unplayable on iOS | T-11 in test matrix; if regresses, IMPLEMENT pivots to platform-specific compression | T-11 | "// Cross-surface playability MUST be re-tested when react-native-compressor is updated — see issue #268" |

---

## 10 — Open questions (decisions deferred to REVIEW + IMPLEMENT)

**OQ-1** — `EventCoverMedia` extraction path (a) vs (b): SPEC selects (a) — extend `packages/event-rendering/`. If post-ORCH-0964 the package structure makes (a) impractical (e.g., `packages/event-rendering/` is replaced or its API contract changes incompatibly), implementor may pivot to (b) — orchestrator REVIEW must approve.

**OQ-2** — `react-native-compressor` `auto` compressionMethod target spec: the library does not expose the exact bitrate/resolution `auto` produces. T-00 PoC characterizes actual output; if `auto` produces inconsistent results across devices, SPEC may need to switch to `manual` with explicit `bitrate` (e.g., 1.5 Mbps) and `maxSize` (720). Decision after T-00.

**OQ-3** — Telemetry columns (`client_compressed_bytes`, `cancel_reason`): SPEC defers. Operator decides whether analytics matters enough to ship a migration in this ORCH or as a follow-up.

**OQ-4** — Reduce `pollIntervalMs` from 2500 → 1500: SPEC sets 1500. If T-01 measurement shows the perceived completion lag is fine at 2000 or higher, reverting partway is acceptable.

**OQ-5** — Web composer chunked-upload threshold: SPEC uses 50 MB. If T-15 shows that smaller thresholds (e.g., 20 MB) materially improve perceived progress UX on web, threshold may be lowered. Cloudinary requires ≥5 MB per chunk except final.

**OQ-6** — Should `cloudinaryDestroy` retry on transient 5xx? SPEC says best-effort, no retry (log + continue). Workstream C reconciliation will catch any orphans. Decision: defer to workstream C SPEC.

**OQ-7** — Should `app-mobile` consumer also get `react-native-compressor` even though it's READ-ONLY for covers? SPEC says NO (consumer never uploads covers). Adding the dependency would bloat the consumer bundle without benefit. If a future ORCH adds consumer-side video upload (UGC), revisit then.

**OQ-8** — Should this SPEC bundle the `expo-av` → `expo-video` migration of the 4 `app-mobile` audio files? SPEC says NO (out of scope; SDK 54 still has `expo-av`; migration belongs in the SDK 55 upgrade ORCH). Flagged in §2 non-goals.

---

## 11 — Downstream routing

After SPEC returns:
1. Orchestrator REVIEW (APPROVED / NEEDS WORK / REJECTED).
2. If APPROVED, operator confirms ORCH-0964 PR has merged + worktree rebased onto fresh main.
3. Operator runs T-00 PoC (or asks forensics to script a dev-build smoke).
4. IF T-00 passes (compression ≤15s per-device, T-11 cross-platform playability holds), dispatch IMPLEMENT.
5. IMPLEMENT default: Codex `implementor-mingla` (or Claude `mingla-implementor` if operator redirects).
6. Per orchestrator skill: implementor handoff must include migration apply command (N/A — no migration here) and `[deploy]` tag determination (YES — touches `mingla-business/src/` AND `app-mobile/src/`; both Vercel-built `mingla-business` AND EAS-OTA-published `app-mobile` are affected).
7. Orchestrator-owned edge deploy of `event-cover-video-cancel` (and any other edge fn touched via `_shared/` import).
8. TEST (Claude `mingla-tester` per memory rule `feedback_tester_canonical_and_platform_parity.md`).
9. CLOSE with `[deploy]` tag in commit subject + EAS OTA for `app-mobile` (cross-platform `ios,android`).

**Deploy notes for CLOSE commit:**
- `[deploy]` tag REQUIRED (touches `mingla-business/src/` + `mingla-admin/` is N/A here but `app-mobile/` itself doesn't require Vercel — the touch to shared `packages/event-rendering/` flows through to `mingla-business` Vercel build).
- EAS OTA: `cd app-mobile && eas update --branch production --platform ios,android --message "ORCH-0978: video upload polish + sub-30s pipeline"`.
- **WARNING: native module addition (`react-native-compressor` + `expo-video` to `app-mobile`) requires a full `eas build`, not OTA.** Operator MUST run `eas build --platform all` and ship a new TestFlight + Play internal build before OTA users see the new code. Flag prominently at CLOSE time.

---

## Confidence — HIGH

SPEC builds on APPROVED RESEARCH with concrete code-level specifications grounded in actual current source (`_shared/eventCoverVideo.ts`, `EventCoverMedia.tsx`, both `package.json` files). Phase 0 surfaced the SDK 54 reality + the already-built business renderer + the missing `app-mobile` `expo-video` dependency — none of which were in RESEARCH. Three open questions (OQ-2 react-native-compressor characterization, OQ-3 telemetry columns, OQ-6 destroy retry) are explicit decisions deferred to REVIEW/IMPLEMENT — not unknowns.

The ONE BLOCKER is the T-00 PoC clause: until react-native-compressor's real-world behaviour on Mingla's typical inputs is measured, the §3 latency budget is an estimate. SPEC correctly gates IMPLEMENT on T-00.

---

## SPEC AMENDMENT 4 (a.k.a. AMENDMENT 2 in operator language) — 2026-05-27 — Consolidated trim cap + DB constraint raise + save-button root-cause fix

**Author:** Claude `mingla-forensics` (SPEC mode)
**Trigger:** consolidate findings from two APPROVED investigations into one IMPLEMENT-2 pass.
**Operator decisions in:** Option A from trim investigation (drop cap 30s → 29s); full save-bug remediation from save-button investigation; no Save-gate widening; diagnostic-first for auth fix.

### A — Executive summary (plain English)

ORCH-0978's first IMPLEMENT shipped a working sub-30s video upload pipeline but two live-fire failure modes surfaced on iOS hardware: (1) iOS's native trim slider returns slightly-over-30s clips due to keyframe alignment, triggering a "Please trim to 30 seconds first" toast on clips the user thought they trimmed; (2) edge function returns 401 on upload-intent for visibly signed-in users, leaving a phantom local-preview as the cover with the Save button greyed forever. Codex live-fire on iPhone 17 sim also discovered a hidden launch blocker — the database's `event_cover_video_jobs` table still enforces a 15-second CHECK constraint left over from ORCH-0770, so even a 29-second client cap would be rejected at the DB layer. This amendment consolidates all three fixes plus regression-test gates into one IMPLEMENT-2 PR. After ship: a user picks any source video, iOS trims to ≤29s, the upload either succeeds and Save enables OR fails cleanly with the old cover restored and an explicit retry affordance. No phantom previews, no mystery greyed buttons, no DB constraint violations.

### B — Sources

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_TRIM_UX_GAP.md` (commit `38b195dd0`) — F-1 through F-8; chosen path = Option A tolerance bump via cap reduction.
- `Mingla_Artifacts/reports/REVIEW_ORCH-0978_INVESTIGATION_TRIM_UX_GAP.md` (commit `1f39b63af`) — APPROVED.
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_SAVE_BUTTON_GREYED.md` (commit `23fb1d877`) — F-1 through F-9 + §6 fix-shape + §7 SPEC AMENDMENT 2 inputs.
- `Mingla_Artifacts/reports/REVIEW_ORCH-0978_INVESTIGATION_SAVE_BUTTON_GREYED.md` (REVIEW APPROVED 2026-05-27) — orchestrator's 9-item consolidated scope table.
- Forensics dispatch `Mingla_Artifacts/prompts/FORENSICS_SPEC_AMENDMENT_2_ORCH-0978.md` (this AMENDMENT 4 binding contract).
- Live DB constraint probe via Supabase Management API on 2026-05-27 (https://supabase.com/docs/reference/api/introduction) — independently confirmed both `event_cover_video_jobs_trim_max_duration` and `event_cover_video_jobs_processed_max_duration` still bound at `15000` ms.
- Migration source `supabase/migrations/20260515000012_orch_0770_event_cover_video_processing.sql` lines 53-54 + 57-58 — origin of the 15s constraints.
- Migration timestamp scan across all `~/Desktop/mingla-orchs/*/supabase/migrations/` worktrees: highest existing = `20260729000002_orch_0964_brand_event_theme_columns.sql`. This amendment claims `20260730000000`.

### C — Cross-surface impact declaration (Phase 2.5)

| Surface | In scope? | Behavior change | Files touched | Parity |
|---|---|---|---|---|
| Consumer iOS (`app-mobile/` on iOS) | NO | none | none | n/a — consumer app does not author covers |
| Consumer Android (`app-mobile/` on Android) | NO | none | none | n/a |
| Buyer/anonymous Web | NO behavior change | reads processed cover URLs same as today; no contract change | none | n/a |
| Business iOS (`mingla-business/` on iOS) | **YES (primary)** | trim cap drops 30s→29s; auth preflight before picker; failed uploads roll back to old cover with retry copy; Save no longer mystery-greyed | `CoverPicker.tsx`, `useEventCoverVideoUpload.ts`, `eventCoverVideoProcessingService.ts`, `event-cover-video-upload-intent/index.ts` (edge) | shared code with Android — automatic |
| Business Android (`mingla-business/` on Android) | **YES** | same as iOS — automatic via shared code | same files | automatic |
| Admin Web (`mingla-admin/`) | NO | none | none | n/a — admin does not author covers |
| Business Web preview | **YES** | trim cap + auth preflight + rollback apply (web picker has no native trim so the rejection-toast path engages on >29s clips with new copy) | same files (web build of `mingla-business/`) | automatic |

SC-N numbering: parity is automatic because business iOS/Android/Web share the same source files. No per-surface SC split required.

### D — Item-by-item scope (9 items)

#### Item 1 — DB constraint migration (P0 — launch blocker)

**File:** `supabase/migrations/20260730000000_orch_0978_video_cap_29s_constraints.sql` (NEW)

**Pre-flight invariant probe (mandatory per `feedback_orchestrator_deploys_edge_functions.md` invariant migration backstop):**

Before migration body, run:
```sql
DO $$
DECLARE
  offending_count int;
BEGIN
  -- Existing 15s constraint guarantees no rows >15000, so any row >29000 is impossible.
  -- Still probe to confirm zero rows that would fail the new 29000 constraint
  -- (defensive: catches accidental constraint drift, prior unguarded backfills, etc.)
  SELECT count(*) INTO offending_count
  FROM public.event_cover_video_jobs
  WHERE (trim_end_ms - trim_start_ms) > 29000
     OR (processed_duration_ms IS NOT NULL AND processed_duration_ms > 29000);

  IF offending_count > 0 THEN
    RAISE EXCEPTION 'orch-0978 amendment 4 pre-flight: % rows exceed 29000ms cap; data repair runbook required before migration', offending_count;
  END IF;
END $$;
```

If pre-flight fails: STOP. Do not proceed with migration. The data-repair runbook is: identify the offending row(s) via `SELECT id, event_id, trim_end_ms - trim_start_ms AS trim_dur, processed_duration_ms FROM public.event_cover_video_jobs WHERE (trim_end_ms - trim_start_ms) > 29000 OR processed_duration_ms > 29000;` then either (a) cancel the rows via `UPDATE ... SET status='cancelled', cancelled_at=now(), failure_code='orch_0978_supersede', failure_message='Superseded by 29s cap migration'` or (b) widen the cap to absorb them if operator approves.

**Migration body:**
```sql
ALTER TABLE public.event_cover_video_jobs
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_trim_max_duration;
ALTER TABLE public.event_cover_video_jobs
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_processed_max_duration;

ALTER TABLE public.event_cover_video_jobs
  ADD CONSTRAINT event_cover_video_jobs_trim_max_duration
    CHECK ((trim_end_ms - trim_start_ms) <= 29000);
ALTER TABLE public.event_cover_video_jobs
  ADD CONSTRAINT event_cover_video_jobs_processed_max_duration
    CHECK (processed_duration_ms IS NULL OR processed_duration_ms <= 29000);
```

**Post-migration self-verify probe (mandatory):**
```sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname IN (
      'event_cover_video_jobs_trim_max_duration',
      'event_cover_video_jobs_processed_max_duration'
    )
    AND pg_get_constraintdef(oid) LIKE '%15000%'
  ) THEN
    RAISE EXCEPTION 'orch-0978 amendment 4 post-verify: 15000ms constraint still present after migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_cover_video_jobs_trim_max_duration'
    AND pg_get_constraintdef(oid) LIKE '%29000%'
  ) THEN
    RAISE EXCEPTION 'orch-0978 amendment 4 post-verify: 29000ms trim constraint not present after migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_cover_video_jobs_processed_max_duration'
    AND pg_get_constraintdef(oid) LIKE '%29000%'
  ) THEN
    RAISE EXCEPTION 'orch-0978 amendment 4 post-verify: 29000ms processed constraint not present after migration';
  END IF;
END $$;
```

**Apply command for operator (per `feedback_orchestrator_deploys_edge_functions.md` migration backstop):**
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]" && /Users/sethogieva/bin/supabase db push --linked
```

**Pre-apply check the orchestrator MUST run before asking operator to push:**
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]" && /Users/sethogieva/bin/supabase migration list --linked
```
Confirm no remote-only versions (blank Local, populated Remote) before approving operator apply.

**SC-AMENDMENT-4-DB-1:** Post-apply, live `pg_constraint` probe returns `29000` in both constraint definitions and zero rows match the LIKE `%15000%` pattern.

#### Item 2 — Auth preflight, diagnostic-first (P0)

This item splits into 2a (diagnostic) and 2b (targeted fix). The implementor MUST land 2a alone first, deploy, capture one repro on iOS sim, then implement 2b based on what the diagnostic reveals.

##### Item 2a — Diagnostic instrumentation (lands first, no client-visible behavior change)

**Files (in scope):**
- `supabase/functions/event-cover-video-upload-intent/index.ts` line 48 (the `requireUserId(req)` call site)
- `supabase/functions/_shared/eventCoverVideo.ts:58` (the `requireUserId` helper definition itself)

**Out of scope (DO NOT TOUCH):** `supabase/functions/_shared/stripeEdgeAuth.ts:40` also exports a `requireUserId` helper — that one serves Stripe Connect endpoints (different surface) and is NOT part of this amendment. If the implementor mistakenly edits the Stripe helper instead of the cover-video helper, the instrumentation will land in the wrong codepath and the diagnostic will produce zero data for this ORCH. Verify the import path inside `event-cover-video-upload-intent/index.ts` resolves to `_shared/eventCoverVideo.ts` before editing.

**Change:** wrap or inline-expand the `requireUserId` helper in `_shared/eventCoverVideo.ts:58` to log WHICH auth check failed when it returns a 401 Response. The diagnostic must distinguish:
- `token_absent` — request had no `Authorization` header at all
- `token_malformed` — header present but not in `Bearer <jwt>` shape
- `token_expired` — JWT present and valid shape but `exp` claim in the past
- `token_invalid_signature` — JWT shape OK, exp future, but signature does not verify against project JWT secret
- `userid_missing` — token verified but no `sub` claim returned

Output via existing `logWarn(requestId, "auth_failed", { reason, expDeltaSec, hasAuthHeader, authHeaderPrefix })`. NO client-visible response change. The function still returns 401 with the same body shape. NO new dependencies.

**Deploy:** orchestrator deploys via `/Users/sethogieva/bin/supabase functions deploy event-cover-video-upload-intent --project-ref gqnoajqerqhnvulmnyvv`. Confirm `verify_jwt: false` is NOT set (this function IS auth-gated; default `verify_jwt: true` is correct).

**Repro:** orchestrator or implementor drives Maestro on iOS sim through the same reproducer Codex used (`Vibes and Stuff` event or operator-supplied test event) and captures the function log via `mcp__supabase__get_logs` filtering `auth_failed`. Document the captured `reason` field.

**SC-AMENDMENT-4-AUTH-2a:** One Maestro repro produces one `auth_failed` log entry naming one of the 5 reasons above. Result documented in the IMPLEMENT-2 report.

##### Item 2b — Targeted auth fix (based on Item 2a diagnostic)

The implementor picks ONE fix path based on the captured `reason`:

- **If `token_expired`** → add session-refresh await before launching the picker:
  - **File:** `mingla-business/src/components/ui/CoverPicker.tsx` immediately before line 415 (the `ensureMediaPermission()` call inside `onPickVideo`/equivalent).
  - **Change:** call `const { data: { session } } = await supabase.auth.getSession();` then if `session && session.expires_at && session.expires_at * 1000 - Date.now() < 60_000`, await `await supabase.auth.refreshSession()` before continuing. On refresh failure, show toast "Sign-in expired — tap your profile to sign back in" and return.
  - Cite: https://supabase.com/docs/reference/javascript/auth-refreshsession

- **If `token_malformed` or `token_absent`** → the request is not carrying the auth header. Fix the `supabase.functions.invoke` call site:
  - **File:** `mingla-business/src/services/eventCoverVideoProcessingService.ts` — find the invoke call inside `createEventCoverVideoUploadIntent`.
  - **Change:** ensure the call uses the authenticated supabase client (NOT a fresh anon client). Verify the client instance is the one with the session attached. If multiple supabase clients exist in the app (anon + auth), explicitly pick the auth-bound instance.
  - Cite: https://supabase.com/docs/reference/javascript/functions-invoke

- **If `token_invalid_signature`** → JWT secret rotation mismatch. Implementor flags to operator; this is an environment fix not a code fix. Pause IMPLEMENT-2 and surface to orchestrator.

- **If `userid_missing`** → `requireUserId` helper has a bug. Fix the helper in `_shared/auth.ts` (or wherever it lives) to handle the missing-sub case explicitly with a more accurate error code.

**Constraint:** the IMPLEMENT-2 SPEC AMENDMENT 4 binds the implementor to pick ONE path. Do NOT implement all four pre-emptively. The diagnostic-first rule exists to avoid shipping a 100-line auth refactor when a 3-line session refresh fixes it.

**SC-AMENDMENT-4-AUTH-2b:** Post-fix, a Maestro repro of the same reproducer does NOT produce an `auth_failed` log entry; the upload-intent call returns 200 with a `jobId`.

#### Item 3 — Local-preview rollback on pre-ready failure (P0)

**File:** `mingla-business/src/hooks/useEventCoverVideoUpload.ts` lines 142-152 (the catch block)

**Change:** before `setStage({ phase: "error", ... })` add:
```ts
setLocalPreviewUri(null);
```

This clears the phantom preview when any pre-ready failure occurs (compressor error, upload-intent 401/4xx/5xx, upload provider failure, acknowledge failure, status timeout).

**Side requirement (verified per save-bug investigation §6):** `CoverPicker.tsx:241-248` `activeMediaUrl` fallback chain `videoUpload.localPreviewUri ?? videoUpload.processedUrl ?? localCover.coverMediaUrl` continues to behave correctly with `localPreviewUri === null` because the `??` chain falls through to `localCover.coverMediaUrl` (the existing server-persisted cover). Verified by reading the file in this SPEC's Phase 0; no additional changes required to CoverPicker.

**Failure UX:** when the catch fires, the UI reverts to the old cover automatically (because `activeMediaUrl` falls back). The implementor must ALSO add an explicit retry affordance — extend the existing `videoUpload.stage` error rendering in `CoverPicker.tsx` to show a small inline retry chip when `stage.phase === "error"`, copy "Upload failed — try again" with a tap target that re-invokes `videoUpload.start(...)` with the same args (cached in a ref). If implementation complexity threatens scope, an OK-state minimum is: show a one-line error toast via existing `onShowToast` AND have the old cover restored via the fallback — explicit retry chip can land in a follow-up ORCH if the chip widget needs designer input. State this minimum vs. preferred split clearly in the IMPLEMENT-2 report.

**SC-AMENDMENT-4-ROLLBACK-3:** After a forced upload-intent 401 in Maestro, the cover preview shows the original (pre-pick) cover OR a clear failed-card with retry CTA; `localPreviewUri` is null in React DevTools; Save button state matches the actual save-ability (greyed because no patch exists is CORRECT here — the previous failure mode was "greyed with a phantom new video", not "greyed with no change attempted").

#### Item 4 — Trim cap drop 30s → 29s (P1)

**Four-file change** (5 lines total). Per `feedback_external_api_docs_verified.md`, the Expo citation is inline.

**Background — duplicate constant declaration (surfaced by orchestrator REVIEW dependency walk):** `EVENT_COVER_MAX_VIDEO_DURATION_MS` is currently declared in TWO places — `mingla-business/src/utils/eventCoverMediaRules.ts:4` (older canonical location, used by the pre-ORCH-0978 image+gif validation pipeline via `eventCoverMediaService.ts`) AND `mingla-business/src/services/eventCoverVideoProcessingService.ts:17` (the new ORCH-0978 Cloudinary pipeline). Each serves a different consumer chain today:
- `eventCoverVideoProcessingService.ts:17` feeds `CoverPicker.tsx:64 → 434` (the picker's rejection check)
- `eventCoverMediaRules.ts:4` feeds `eventCoverMediaService.ts:7,25 → validateEventCoverAsset` (the storage-bucket validation pipeline)

Updating only one would cause the two pipelines to diverge (picker caps at 29s, storage validation still accepts 30s). The IMPLEMENT-2 MUST update BOTH declarations to 29_000 in the same commit. A future cleanup ORCH can consolidate to a single declaration per "one owner per truth" (Discovery for Orchestrator §J-bis below); this amendment ships the dual-update minimum.

**Required edits:**

1. **Picker config** — `mingla-business/src/components/ui/CoverPicker.tsx` line 422
   - Change: `videoMaxDuration: 30,` → `videoMaxDuration: 29,`
   - Cite: https://docs.expo.dev/versions/latest/sdk/imagepicker/#imagepickeroptions — `videoMaxDuration` accepts seconds, integer, iOS-best-effort + Android-best-effort.

2. **Cloudinary pipeline constant (the one CoverPicker imports)** — `mingla-business/src/services/eventCoverVideoProcessingService.ts` line 17
   - Change: `export const EVENT_COVER_MAX_VIDEO_DURATION_MS = 30_000;` → `export const EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000;`

3. **Storage-bucket validation constant (the older canonical declaration)** — `mingla-business/src/utils/eventCoverMediaRules.ts` line 4
   - Change: `export const EVENT_COVER_MAX_VIDEO_DURATION_MS = 30_000;` → `export const EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000;`
   - Verification: post-change, the consumer at `eventCoverMediaRules.ts:339` (`input.durationMs > EVENT_COVER_MAX_VIDEO_DURATION_MS`) will reject anything over 29,000 ms in the storage-bucket path — matching the picker's behaviour.

4. **Picker toast copy** — `mingla-business/src/components/ui/CoverPicker.tsx` line 435
   - Change: `"Please trim to 30 seconds first."` → `"Please trim to 29 seconds first."`

5. **Processing copy constant** — `mingla-business/src/services/eventCoverVideoProcessingService.ts` line 21
   - Change: `"Use your phone's trim screen to keep video covers to 30 seconds. ..."` → `"Use your phone's trim screen to keep video covers to 29 seconds. ..."`

**Tolerance UNCHANGED:** the existing `+ 250` rejection guard at `CoverPicker.tsx:434` stays. Effective rejection ceiling becomes 29,250 ms. iOS keyframe overshoot typically 100-800 ms (per save-bug investigation citations), comfortable headroom.

**Existing test compatibility:** `mingla-business/src/services/__tests__/eventCoverMediaService.test.ts` lines 258, 430, 453 assert `EVENT_COVER_MAX_VIDEO_DURATION_MS + 1` rejects. After this change those assertions become `29_001` rejects (was `30_001`) — same semantic (one over the cap rejects), no test edit required. The test at `mingla-business/src/components/ui/__tests__/eventCoverMedia.test.ts:75` asserts `videoMaxDuration: 15` is NOT present (it's currently 30, becomes 29 — both satisfy the negative assertion); no test edit required.

**AMENDMENT 1 supersession statement:** AMENDMENT 1's "single 30s cap via native trim" is hereby superseded by 29s. AMENDMENT 1 stays in this document as historical record. AMENDMENT 1 invariants and CI gates referring to `30000` ms or the `videoMaxDuration: 30` literal MUST be updated to `29000` / `videoMaxDuration: 29` per Item 6 below.

**SC-AMENDMENT-4-CAP-4:** Picker config line literally reads `videoMaxDuration: 29`; BOTH constants (`eventCoverVideoProcessingService.ts:17` AND `eventCoverMediaRules.ts:4`) literally read `29_000`; toast copy literally reads `29 seconds`; `grep -rn "EVENT_COVER_MAX_VIDEO_DURATION_MS = 30" mingla-business/src/` returns ZERO matches post-change.

#### Item 5 — Edge function validation matches new cap (P0)

**File:** `supabase/functions/event-cover-video-upload-intent/index.ts` — validation step that bounds `sourceDurationMs` (currently uses `EVENT_COVER_MAX_SOURCE_VIDEO_DURATION_MS = 60000` per AMENDMENT 1 §1 as defense-in-depth 2× safety margin; this stays). What MUST be added is a separate validation against the new cap+tolerance:

**Change:** in the body validation step (between `requireUserId` pass and `requireEventManager`), add:
```ts
const EFFECTIVE_TRIM_CEILING_MS = 29_250; // 29000 cap + 250ms client tolerance
if (sourceDurationMs > EFFECTIVE_TRIM_CEILING_MS) {
  logWarn(requestId, "duration_over_cap", { sourceDurationMs, ceiling: EFFECTIVE_TRIM_CEILING_MS });
  return jsonResponse({ error: "duration_over_cap", detail: { sourceDurationMs, ceilingMs: EFFECTIVE_TRIM_CEILING_MS } }, 422);
}
```

Place AFTER the existing 60_000 outer defense bound (no functional regression — 29_250 < 60_000 so the new check is strictly tighter), BEFORE the `supabase.from("event_cover_video_jobs").insert(...)` so DB constraint can never be triggered.

**SC-AMENDMENT-4-EDGE-5:** A request with `sourceDurationMs: 29250` (boundary) returns 200 + jobId; a request with `sourceDurationMs: 29251` returns 422 with body `{error:"duration_over_cap", detail:{sourceDurationMs:29251, ceilingMs:29250}}`.

#### Item 6 — Save gate stays strict (CONSTRAINT — must NOT do)

**Explicit non-goal:** the implementor MUST NOT modify `mingla-business/src/components/event/EditPublishedScreen.tsx` lines 1161-1166 (the Save button `disabled={...}` gate) NOR lines 380-382 (`canSaveServerCoverMediaOnly`) NOR lines 224-231 (`isServerEditableOnlyPatch`). The Save gate is correctly catching the absent patch — the fix is entirely upstream (Items 2 + 3). Adding a "video-pending-but-allow-save" carve-out would mask the actual failure mode.

If the implementor is tempted to widen the gate (e.g., to make CONDITIONAL PASS easier or to handle an edge case discovered mid-implementation), STOP and surface to orchestrator. Do not silently widen.

**SC-AMENDMENT-4-GATE-6:** `git diff` against `EditPublishedScreen.tsx` shows ZERO changes to lines 220-235 and 375-395 and 1155-1175.

#### Item 7 — Observability telemetry (P2)

**File:** `mingla-business/src/services/eventCoverVideoProcessingService.ts` (next to existing `devWarn`)

Three structured log events with shared schema `{ eventId: string, applyMode: string, jobId?: string, phase: string, errorCode?: string, timestamp: string }`:

- `video_cover_upload_intent_failed` — fired when `createEventCoverVideoUploadIntent` returns non-2xx OR throws.
- `video_cover_upload_ready` — fired when `waitForEventCoverVideoReady` resolves with a `processedUrl`.
- `video_cover_upload_preview_rolled_back` — fired from `useEventCoverVideoUpload.ts` catch block when Item 3's `setLocalPreviewUri(null)` executes.

Use existing `devWarn` plumbing. Do NOT add a new analytics SDK. Do NOT add Mixpanel/AppsFlyer calls in this scope (telemetry pipeline integration is a future ORCH).

**SC-AMENDMENT-4-TELEMETRY-7:** Maestro forced-401 repro produces one `video_cover_upload_intent_failed` + one `video_cover_upload_preview_rolled_back` log line; happy-path repro produces one `video_cover_upload_ready` log line.

#### Item 8 — Diagnostic console.log at trim rejection (P2)

**File:** `mingla-business/src/components/ui/CoverPicker.tsx` line 434 (immediately before the `onShowToast("Please trim to 29 seconds first.")` line)

**Change:**
```ts
console.log("[ORCH-0978-TRIM]", {
  durationMs,
  capMs: EVENT_COVER_MAX_VIDEO_DURATION_MS,
  overshoot: durationMs - EVENT_COVER_MAX_VIDEO_DURATION_MS,
});
```

Stays in code permanently (cheap real-device observability). Not gated behind `__DEV__` — production overshoots are exactly what we want to see in field logs.

**SC-AMENDMENT-4-LOG-8:** Code grep finds the literal `"[ORCH-0978-TRIM]"` exactly once at `CoverPicker.tsx`.

#### Item 9 — Regression tests in same commit (P0 per `feedback_close_commit_precommit_checks.md`)

Per `feedback_close_commit_precommit_checks.md` and the META-ORCH-0744-PROCESS regression-test gate, the IMPLEMENT-2 CLOSE ships BOTH an implementor happy-path test AND a tester adversarial test, each with `fails-on-revert verified at <commit hash>` proof.

##### Test (a) — Implementor happy-path regression (Item 3 fix)

**Path:** `mingla-business/src/hooks/__tests__/useEventCoverVideoUpload.test.ts` (extend if exists, create if not)

**Scenario:** When `createEventCoverVideoUploadIntent` mock throws an error matching the 401 shape (or rejects with a `BusinessAuthNotReadyError`), assert:
1. `result.current.localPreviewUri` is `null` after the rejection settles.
2. `emitChange` (proxied via a mock `onCoverChange` callback at the consumer level) is NEVER called.
3. `result.current.stage.phase === "error"` with `stage.code === "video_upload_failed"`.

**Fails-on-revert verification:** before pushing, run the test on the fixed code (assert PASS), then locally delete the single line `setLocalPreviewUri(null);` added in Item 3, re-run (assert FAIL with localPreviewUri assertion failure), restore the line, re-run (assert PASS). Document the three runs in the IMPLEMENT-2 report with each commit hash where the revert was probed.

##### Test (b) — Tester adversarial boundary regression (Items 4+5 caps)

**Path:** `supabase/functions/event-cover-video-upload-intent/__tests__/duration-cap.test.ts` (create new)

**Scenario:** With the edge function under test (use Deno test runner per existing supabase function test pattern), POST two requests:
1. Body `{ ..., sourceDurationMs: 29250 }` — assert response status 200, response body has `jobId`.
2. Body `{ ..., sourceDurationMs: 29251 }` — assert response status 422, response body equals `{error: "duration_over_cap", detail: {sourceDurationMs: 29251, ceilingMs: 29250}}`.

This is adversarial because it attacks the BOUNDARY of the cap, not the happy-path 12s-clip path the implementor exercises. It also exercises Item 5's edge validation independently of the client.

**Fails-on-revert verification:** before pushing, run on the fixed code (assert PASS), then locally revert Item 5's `EFFECTIVE_TRIM_CEILING_MS` check (delete the validation block), re-run (assert FAIL — both requests would return 200 because no validation rejects them, OR boundary case would slip to DB which then rejects with a 500), restore, re-run (assert PASS). Document.

##### Strict-grep registry update (per COMMS-0002)

**File:** `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`

**Change:** add to `ORCH_0978_BACKEND_ALLOWLIST` the following new backend paths:
- `supabase/migrations/20260730000000_orch_0978_video_cap_29s_constraints.sql`
- `supabase/functions/event-cover-video-upload-intent/__tests__/duration-cap.test.ts`
- `supabase/functions/event-cover-video-upload-intent/index.ts` (if not already in allowlist — verify before adding to avoid dup)

Must land in the SAME commit as the migration + test files. Otherwise the C7 `no-new-backend-files` gate fails on PR per COMMS-0002.

**SC-AMENDMENT-4-TEST-9:** IMPLEMENT-2 commit body cites both test paths + each `fails-on-revert verified at <commit hash>` line. Strict-grep registry diff lands in the same commit.

### E — New invariants

**I-PROPOSED-VIDEO-CAP-CONSISTENCY-29S:** Picker `videoMaxDuration`, BOTH client constant declarations of `EVENT_COVER_MAX_VIDEO_DURATION_MS` (the one at `eventCoverVideoProcessingService.ts:17` AND the one at `eventCoverMediaRules.ts:4`), edge function `EFFECTIVE_TRIM_CEILING_MS` validation, and DB CHECK constraints on `event_cover_video_jobs` MUST all agree at 29000 ms (with `+250ms` tolerance at picker reject + edge reject = 29250). Any layer deviating from this contract is a P0 invariant violation. Strict-grep C1-C4 (§F) enforces at CI.

**Architectural follow-up (not blocking this amendment):** the two duplicate constant declarations themselves violate "one owner per truth" (constitutional rule #2). A future cleanup ORCH should consolidate to a single declaration — see Discovery for Orchestrator §J-bis. Until then, the strict-grep C1+C2+C3 trio is the contract that keeps them aligned.

**Supersedes:** I-PROPOSED-VIDEO-INPUT-CAP-AT-PICKER (AMENDMENT 1 §6) — that invariant referenced `videoMaxDuration: 30`. Update its target literal to `29` or replace with the new invariant.

### F — CI gates

**New strict-grep registry file:** `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` (NEW)

Four checks (updated per orchestrator REVIEW dependency walk):
1. **C1 — Client cap is 29:** assert `mingla-business/src/components/ui/CoverPicker.tsx` contains `videoMaxDuration: 29` exactly once. Fail if `videoMaxDuration: 30` appears anywhere in this file.
2. **C2 — Cloudinary-pipeline constant is 29_000:** assert `mingla-business/src/services/eventCoverVideoProcessingService.ts` contains `EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000`. Fail if `EVENT_COVER_MAX_VIDEO_DURATION_MS = 30_000` appears in this file.
3. **C3 — Storage-pipeline constant is 29_000 (dependency-walk gap closure):** assert `mingla-business/src/utils/eventCoverMediaRules.ts` contains `EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000`. Fail if `EVENT_COVER_MAX_VIDEO_DURATION_MS = 30_000` appears in this file. Without this check the two pipelines could silently drift if either constant gets bumped back.
4. **C4 — DB constraint is 29000:** assert the migration `20260730000000_orch_0978_video_cap_29s_constraints.sql` exists AND contains the literal `29000` in BOTH `_trim_max_duration` and `_processed_max_duration` ADD CONSTRAINT statements.

Wire into `.github/workflows/strict-grep-mingla-business.yml` as one new job per `feedback_strict_grep_registry_pattern.md`. Do NOT create a parallel workflow file.

### G — Test contract (paths + run protocol)

| Test | Path | Type | Fails-on-revert anchor |
|---|---|---|---|
| Implementor happy-path | `mingla-business/src/hooks/__tests__/useEventCoverVideoUpload.test.ts` | Jest | delete `setLocalPreviewUri(null);` line from Item 3 |
| Tester adversarial boundary | `supabase/functions/event-cover-video-upload-intent/__tests__/duration-cap.test.ts` | Deno test | delete `EFFECTIVE_TRIM_CEILING_MS` validation block from Item 5 |

Both MUST land in the IMPLEMENT-2 PR with passing runs + revert-probe runs documented in the implementation report.

### H — Migration plan

| Phase | Action | Owner | Command |
|---|---|---|---|
| Before push | Pre-flight invariant probe (in-migration `DO $$` block) | implementor (writes); operator (sees in `db push` output) | embedded in migration body |
| Migration file landing | Commit on ORCH-0978 branch alongside code | implementor | `git add supabase/migrations/20260730000000_orch_0978_video_cap_29s_constraints.sql` |
| Strict-grep registry update | Same commit | implementor | `git add .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` |
| Pre-apply migration list check | Confirm no remote-only versions | orchestrator | `cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]" && /Users/sethogieva/bin/supabase migration list --linked` |
| Apply | Push migration to remote | **operator** | `cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]" && /Users/sethogieva/bin/supabase db push --linked` |
| Verify | Re-probe constraints | orchestrator | Supabase Management API query (see Item 1 SC) |
| Edge deploy | Deploy `event-cover-video-upload-intent` v94 (Item 2a diagnostic) + v95 (Item 2b fix + Item 5 validation) | orchestrator | `/Users/sethogieva/bin/supabase functions deploy event-cover-video-upload-intent --project-ref gqnoajqerqhnvulmnyvv` |

**Rollback note:** if Item 1's migration causes any downstream breakage (extremely unlikely — the change is loosening a CHECK, not tightening), revert with the inverse migration `20260730000001_orch_0978_video_cap_29s_constraints_revert.sql` restoring the 15000 ms ceilings. Pre-flight probe in the revert would itself need a data-repair runbook for any 15000-29000 ms rows that landed in between — operator-approved before applying.

### I — Open questions

**None.** All operator decisions captured. Diagnostic-first rule preserves the only remaining uncertainty (Item 2b path) as a deliberate decision point during IMPLEMENT-2, not a SPEC ambiguity.

### J — Acceptance gate

This AMENDMENT 4 is "implementable" when:
1. Orchestrator REVIEW returns APPROVED.
2. Operator confirms readiness to apply migration after PR commit-and-push.

Codex `implementor-mingla` IMPLEMENT-2 produces ONE PR covering all 9 items in the order:
1. Item 2a (diagnostic) — separate landing commit, then deploy + run repro, capture log
2. Items 1, 3, 4, 5, 7, 8 (the actual fixes + non-2a items) — second landing commit
3. Item 6 (the non-change) — verified by `git diff` showing zero touches to specified line ranges
4. Item 9 (tests + strict-grep registry) — third landing commit with fails-on-revert proofs

Then orchestrator REVIEW → DB migration apply (operator) → edge deploy (orchestrator) → Codex/Claude tester live-fire on iOS sim + your physical iPhone → orchestrator CLOSE with `[deploy]` tag.

### J-bis — Discovery for Orchestrator (architectural follow-up, NOT in this scope)

**Title:** Consolidate the duplicate `EVENT_COVER_MAX_VIDEO_DURATION_MS` declarations.

**Background:** `EVENT_COVER_MAX_VIDEO_DURATION_MS` is currently declared in two files (`mingla-business/src/utils/eventCoverMediaRules.ts:4` AND `mingla-business/src/services/eventCoverVideoProcessingService.ts:17`). Pre-ORCH-0978 only the first declaration existed; ORCH-0978 added the second to keep the Cloudinary pipeline's constants colocated with the new processing service. Both currently agree at 30_000 ms; this amendment updates BOTH to 29_000 ms. The duplication violates "one owner per truth" (constitutional rule #2).

**Recommendation:** register a follow-up ORCH (e.g., ORCH-NNNN [event cover constants consolidation]) to delete the duplicate at `eventCoverVideoProcessingService.ts:17` and have it re-export from `eventCoverMediaRules.ts`. Update the `CoverPicker.tsx:64` import path to source from `eventCoverMediaRules` (or keep the re-export shim if the service file is the more natural import surface for video-pipeline consumers). Delete strict-grep check C2 OR C3 (only need one once consolidated). Net diff: ~10 lines, single PR, near-zero risk because all consumers already get the same value.

**Why not include here?** Scope discipline. AMENDMENT 4 is a bug-fix amendment, not a refactor. The strict-grep C1+C2+C3 trio keeps the two declarations aligned at CI in the interim, so the architectural debt is contained.

---

### K — Confidence — HIGH

Every code touchpoint cited has been read in this Phase 0 with line ranges captured. Live DB constraint probe independently confirms Codex's finding. Migration timestamp scan across all worktrees confirms no collision. Operator decisions captured from chat. Diagnostic-first rule for Item 2 preserves engineering rigor against the temptation to blindly pick a fix path. Orchestrator REVIEW dependency-walk gap (duplicate constant + ambiguous requireUserId file) closed in rework pass; new strict-grep check C3 + Item 2a out-of-scope note added; consolidation surfaced as Discovery J-bis for a future cleanup ORCH. No open questions.

---

## SPEC AMENDMENT 5 (a.k.a. AMENDMENT 3 in operator language) — 2026-05-27 — event-cover-video-webhook job_id extraction fallback + batch redeploy

**Author:** Claude `mingla-forensics` (SPEC mode)
**Trigger:** Tester FAIL at `Mingla_Artifacts/reports/QA_ORCH-0978_IMPLEMENT_2_LIVE_FIRE.md` (commit `b85478a45`) + investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_WEBHOOK_400.md` (commit `b26374dc5`, root cause PROBABLE).
**Operator decisions absorbed in dispatch:** Option A (webhook-side public_id parsing) over Options B/C; bound scope to webhook fix only — do NOT modify IMPLEMENT-2's auth/picker/local-preview fixes.

### A — Executive summary (plain English)

IMPLEMENT-2 fixed the auth and picker layer cleanly. Live-fire then exposed a pre-existing latent webhook bug: Cloudinary's `eager_async` notification (the only notification we wire) does NOT include the `context` field that `event-cover-video-webhook` expects to extract `job_id` from. The webhook returns HTTP 400 `job_id_missing` and the job sits forever at `status='source_uploaded'`. After this amendment ships: the webhook falls back to parsing the last UUID segment of `payload.public_id` (already populated by `event-cover-video-upload-intent` as `event-covers/raw/{brandId}/{eventId}/{jobId}`). Cloudinary always includes `public_id` in eager notifications, the fix is fully local to one Deno file (no Cloudinary contract change, no schema change), and a new strict-grep gate keeps the upload-intent public_id template and the webhook parser aligned forever. After ship: every uploaded video reaches `status='ready'` with `processed_url` populated, the client poll sees ready, Save button enables, and the full ORCH-0978 happy path completes end-to-end for the first time.

### B — Sources

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_WEBHOOK_400.md` (commit `b26374dc5`) — root cause PROBABLE, fix-shape Option A recommended.
- `Mingla_Artifacts/reports/QA_ORCH-0978_IMPLEMENT_2_LIVE_FIRE.md` (commit `b85478a45`) — tester FAIL evidence + stuck job `dde19eac-9810-4e0d-b8f6-63fe235fc5af`.
- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_SAVE_BUTTON_GREYED.md` (commit `23fb1d877`) — prior auth-layer investigation; F-7 explicitly noted "the Cloudinary/upload/webhook lifecycle is not reached on this repro" (this amendment closes that gap).
- F-5 read-only probe (orchestrator-run on 2026-05-27): `SELECT count(*) FROM event_cover_video_jobs WHERE status='source_uploaded' AND created_at < now() - interval '1 hour'` returned `stuck_count = 0`. Only the in-flight live-fire job `dde19eac-...` is currently stuck. SPEC §I-5 (historical cleanup) is therefore N/A.
- Cloudinary docs cited inline per COMMS-0003:
  - Notifications + notification types: https://cloudinary.com/documentation/notifications
  - Eager async transformations + eager_notification_url: https://cloudinary.com/documentation/upload_images#eager_async_transformations
  - Context (contextual metadata) parameter format: https://cloudinary.com/documentation/contextual_metadata
  - Signature verification: https://cloudinary.com/documentation/notifications#verifying_notifications

### C — Cross-surface impact declaration (Phase 2.5)

| Surface | In scope? | Behavior change | Files touched | Parity |
|---|---|---|---|---|
| Consumer iOS (`app-mobile/` on iOS) | NO | none | none | n/a — consumer app does not author covers |
| Consumer Android (`app-mobile/` on Android) | NO | none | none | n/a |
| Buyer/anonymous Web | NO behavior change | reads processed cover URLs same as today; no contract change; benefits indirectly when business uploads start succeeding | none | n/a |
| Business iOS (`mingla-business/` on iOS) | **YES (primary)** | video uploads now reach `processed_url` populated → Save button enables → cover persists | edge function only (no client change) | automatic — fix is server-side |
| Business Android (`mingla-business/` on Android) | **YES** | same as iOS — server-side fix benefits both | edge function only | automatic |
| Admin Web (`mingla-admin/`) | NO | none | none | n/a — admin doesn't author covers |
| Business Web preview | **YES** | same server-side fix benefits web composer too | edge function only | automatic |

No client code changes. Pure backend fix. Parity is structurally automatic.

### D — Item-by-item scope (6 binding items; Item 5 N/A per F-5 probe)

#### Item 1 — Webhook public_id fallback for job_id extraction (P0)

**File:** `supabase/functions/event-cover-video-webhook/index.ts`

**Change site 1 — extend or replace the `contextValue` helper at lines 11-29 with public_id-aware extraction:**

The current helper lives at lines 11-29 and ONLY looks in `payload.context.custom.<key>`, `payload.context` pipe-delimited, or `payload[<key>]` direct. Add a new helper `recoverJobIdFromPayload` (or inline the logic at the call site, whichever the implementor prefers — preference: separate helper for testability):

```ts
import { isValidUuid } from "../_shared/eventCoverVideo.ts";

const recoverJobIdFromPayload = (payload: Record<string, unknown>): string | null => {
  // First try the documented `upload`-notification shape (context.custom)
  const fromContext = contextValue(payload, "job_id");
  if (fromContext !== null && isValidUuid(fromContext)) return fromContext;

  // Fall back to parsing public_id last segment.
  // upload-intent encodes: event-covers/raw/{brandId}/{eventId}/{jobId}
  // Cloudinary `eager_async` notifications always include public_id per
  // https://cloudinary.com/documentation/notifications
  const publicId = typeof payload.public_id === "string" ? payload.public_id : null;
  if (publicId === null) return null;
  const lastSegment = publicId.split("/").at(-1) ?? null;
  if (lastSegment === null) return null;
  return isValidUuid(lastSegment) ? lastSegment : null;
};
```

**Change site 2 — replace the call at line 89 with the new helper:**

```ts
// Before (line 89-92):
const jobId = contextValue(payload, "job_id");
if (jobId === null) {
  return jsonResponse({ error: "validation_error", detail: "job_id_missing" }, 400);
}

// After:
const jobId = recoverJobIdFromPayload(payload);
if (jobId === null) {
  console.warn("[event-cover-video-webhook]", JSON.stringify({
    publicId: typeof payload.public_id === "string" ? payload.public_id : null,
    hasContext: typeof payload.context === "object" || typeof payload.context === "string",
    stage: "job_id_extraction_failed",
  }));
  return jsonResponse({ error: "validation_error", detail: "job_id_missing" }, 400);
}
```

**Notes:**
- The `console.warn` payload is intentionally non-PII (just types/booleans, no payload bodies). It exists so future failures show in the dashboard log viewer with enough context to diagnose without needing another investigation cycle.
- `isValidUuid` is already exported from `_shared/eventCoverVideo.ts` (line 106-108). No new shared utility needed.
- The `contextValue` helper at lines 11-29 stays — it's still useful for extracting non-job-id fields if any future webhook code paths need them. Don't delete it.

**SC-AMENDMENT-5-WEBHOOK-1:** A Deno test POSTing a Cloudinary-shaped eager payload WITHOUT context but WITH `public_id: "event-covers/raw/<brand-uuid>/<event-uuid>/<job-uuid>"` reaches the DB update path (asserted by mocked supabase). Same test with a malformed public_id (`"event-covers/raw/foo/bar/not-a-uuid"`) returns 400 `job_id_missing`. Backwards compat: a payload WITH `context.custom.job_id` AND no public_id still extracts via the context path (regression test for existing behavior).

#### Item 2 — Write failure status when job is identifiable but payload extraction failed (P1)

**File:** `supabase/functions/event-cover-video-webhook/index.ts`

**Background:** investigation F-4 hidden flaw — when the webhook 400s on `job_id_missing`, NO failure status is written to the job. Client polls forever until its own timeout. With Item 1 in place, MOST 400s become 200s — but a defensive narrow case remains: if `public_id` parses to a valid UUID that DOES exist in `event_cover_video_jobs` but the eager payload is otherwise malformed (e.g., empty `eager` array, missing required derivative fields), the webhook would still fall through to the existing `assertProcessedDerivative` failed path (lines 154-166), which DOES write status='failed'. **So Item 2 is actually already covered by the existing failed-derivative path once Item 1 lands.** No additional code needed for the strict P1.

**However**, one narrow gap exists: if Item 1's `recoverJobIdFromPayload` returns null (both context AND public_id parsing failed), the webhook still 400s without writing any failure status. This is an extreme edge case (means Cloudinary sent a malformed notification with neither context nor a valid-UUID public_id). The reasonable trade-off: log the failure (already in Item 1's `console.warn`), return 400, and accept that the client will see a polling timeout for this pathological case. Adding a "scan all source_uploaded jobs and fail one that might match" fallback is out of scope — too speculative.

**SC-AMENDMENT-5-FAIL-STATUS-2:** Existing `assertProcessedDerivative` failed path at lines 154-166 is verified intact by Item 1's regression test (eager-shape-with-context, valid job_id, derivative missing → 200 + job status='failed' + failure_code='processed_*' per the existing logic). No new code; verified by test coverage.

#### Item 3 — New invariant + strict-grep CI gate aligning upload-intent template with webhook parser (P0)

**New invariant:** `I-PROPOSED-EVENT-COVER-VIDEO-PUBLIC-ID-LAST-SEGMENT-IS-JOB-UUID`

> The public_id template `event-covers/raw/{brandId}/{eventId}/{jobId}` constructed by `event-cover-video-upload-intent/index.ts:265` MUST always have a valid UUID as its last segment. The webhook (`event-cover-video-webhook/index.ts` Item 1 helper) depends on this contract to recover job_id from eager_async notifications. Any change to either side requires updating both atomically.

**New strict-grep CI gate:** add to existing `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` (don't create a new file — extend the existing one to keep CI surface narrow). Add check **C5**:

```js
const uploadIntentPath = "supabase/functions/event-cover-video-upload-intent/index.ts";
const webhookPath = "supabase/functions/event-cover-video-webhook/index.ts";

const uploadIntent = read(uploadIntentPath);
const webhook = read(webhookPath);

// C5: upload-intent must encode publicId as `event-covers/raw/${brandId}/${eventId}/${job.id}`
const publicIdTemplatePattern = /event-covers\/raw\/\$\{brandId\}\/\$\{eventId\}\/\$\{job\.id\}/;
if (!publicIdTemplatePattern.test(uploadIntent)) {
  fail("C5", `${uploadIntentPath} must contain publicId template event-covers/raw/\${brandId}/\${eventId}/\${job.id}`);
} else if (!webhook.includes("recoverJobIdFromPayload") && !webhook.includes("public_id.split")) {
  fail("C5", `${webhookPath} must contain public_id-based job_id recovery to match upload-intent template`);
} else {
  ok("C5", "Upload-intent public_id template and webhook public_id parser remain aligned");
}
```

**SC-AMENDMENT-5-INVARIANT-3:** `node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` passes C1-C5 (was C1-C4 from AMENDMENT 4; +1 new check).

#### Item 4 — Deno regression test for webhook public_id fallback (P0)

**Path:** `supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts` (NEW)

**Test scenarios (minimum):**

1. **Eager notification WITHOUT context, WITH valid public_id (Item 1 happy path):**
   - Input: POST with body `{notification_type: "eager", public_id: "event-covers/raw/<brand-uuid>/<event-uuid>/<job-uuid>", eager: [...], ...signed-cloudinary-fields...}` + valid HMAC headers
   - Mock supabase to confirm job-lookup call uses `<job-uuid>`, return a sample `source_uploaded` job, mock the ready-update return.
   - Expected: HTTP 200 + `{ok: true}` + verify job-lookup-by-id was called with the parsed UUID.

2. **Eager notification WITH context (regression — must still work):**
   - Input: POST with body that has BOTH `context.custom.job_id: "<job-uuid>"` AND `public_id: "event-covers/raw/.../<other-uuid>"` (different from context's job_id)
   - Expected: context wins (preserves existing behavior). Job lookup uses context's job_id, not public_id's.

3. **Malformed public_id (no UUID in last segment):**
   - Input: POST with body lacking context AND `public_id: "event-covers/raw/foo/bar/not-a-uuid"`
   - Expected: HTTP 400 + `{error: "validation_error", detail: "job_id_missing"}` + `console.warn` log fired.

4. **Missing both context AND public_id:**
   - Input: POST with body that has neither
   - Expected: HTTP 400 + `{error: "validation_error", detail: "job_id_missing"}`.

5. **Backwards compatibility for legacy pipe-delimited context (already in `contextValue`):**
   - Input: POST with body having `context: "job_id=<uuid>|event_id=..."` string (legacy format)
   - Expected: context still wins; HTTP 200.

**Fails-on-revert verification (mandatory per `feedback_close_commit_precommit_checks.md`):** before commit, run the test on the fixed code (PASS all 5 scenarios), then locally remove the public_id fallback branch from `recoverJobIdFromPayload`, re-run (scenario 1 FAILS with `expect status 200, received 400`), restore, re-run (PASS). Document the three commit hashes in the IMPLEMENT-3 report.

**SC-AMENDMENT-5-TEST-4:** All 5 test scenarios PASS on Deno. Fails-on-revert sequence documented in IMPLEMENT-3 report.

#### Item 5 — Historical job cleanup (N/A — probe returned zero)

**Status: N/A.** F-5 probe ran by orchestrator at 2026-05-27 returned `stuck_count = 0` for `WHERE status='source_uploaded' AND created_at < now() - interval '1 hour'`. The only currently-stuck job is `dde19eac-9810-4e0d-b8f6-63fe235fc5af` from the tester live-fire (created 16:10:33Z today), which IS recent and within the 1-hour window so not counted. The implementor MAY cancel that job as part of IMPLEMENT-3 cleanup (call `cloudinary destroy` on its `source_public_id` + `UPDATE event_cover_video_jobs SET status='cancelled', cancelled_at=now(), failure_code='orch_0978_amendment_5_test_artifact', failure_message='Tester live-fire stuck job cleaned up by IMPLEMENT-3' WHERE id='dde19eac-9810-4e0d-b8f6-63fe235fc5af'`) but this is housekeeping, not a binding SPEC item.

**No data cleanup migration needed.** If the probe count changes between now and IMPLEMENT-3 (more uploads attempted in the gap), the implementor re-runs the probe and decides based on count > 0 OR ≤ 5. If > 5, the implementor flags to orchestrator for a SPEC AMENDMENT 6 cleanup migration; if ≤ 5, the implementor cleans them up via the same one-off UPDATE pattern.

**SC-AMENDMENT-5-CLEANUP-5:** N/A — no binding deliverable. Implementor housekeeping note only.

#### Item 6 — Batch redeploy ALL six event-cover-video functions (P0 deploy discipline)

**Background:** investigation F-6 hidden flaw — when `_shared/eventCoverVideo.ts` changes, ALL six functions that import from it should be batch-redeployed. IMPLEMENT-2 only redeployed `event-cover-video-upload-intent`. The IMPLEMENT-3 fix changes `event-cover-video-webhook/index.ts` (Item 1) but NOT `_shared/eventCoverVideo.ts` — so this amendment's deploy footprint is just the webhook. However, to clear the technical debt from IMPLEMENT-2's partial deploy AND to ensure all six functions are running on the latest shared bundle, this amendment mandates batch redeploy of ALL six:

| Function | Current version | After IMPLEMENT-3 deploy | Reason |
|---|---|---|---|
| `event-cover-video-upload-intent` | v95 | v96 | re-bundle for safety (no code change) |
| `event-cover-video-source-uploaded` | v81 | v82 | re-bundle (no code change) |
| `event-cover-video-status` | v93 | v94 | re-bundle (no code change) |
| `event-cover-video-apply` | v91 | v92 | re-bundle (no code change) |
| `event-cover-video-cancel` | v91 | v92 | re-bundle (no code change) |
| `event-cover-video-webhook` | v120 | v121 | **THE FIX** — public_id fallback (Item 1 + Item 4 tests) |

**Deploy command** (orchestrator-owned per `feedback_orchestrator_deploys_edge_functions.md`):
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]"
/Users/sethogieva/bin/supabase functions deploy event-cover-video-upload-intent --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-source-uploaded --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-status --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-apply --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-cancel --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy event-cover-video-webhook --project-ref gqnoajqerqhnvulmnyvv
```

After all six deploys, orchestrator verifies via `mcp__supabase__list_edge_functions` that:
1. All six have version-bumped (counters all +1)
2. `verify_jwt` settings preserved: webhooks is `false`, all five others are `true`
3. `event-cover-video-webhook` v121 returns the new diagnostic log line via one curl probe per `feedback_supabase_edge_deploy_verify_first_call.md` — specifically a POST with valid HMAC signature + body lacking context AND lacking public_id should now log `stage: "job_id_extraction_failed"` (whereas v120 logged no such stage).

**SC-AMENDMENT-5-DEPLOY-6:** Post-deploy, `mcp__supabase__list_edge_functions` shows all six event-cover-video functions at their incremented version with correct `verify_jwt` settings. Curl probe to webhook v121 confirms the new stage log.

**Future invariant codification:** post-CLOSE, the orchestrator should add a memory rule (or extend `feedback_orchestrator_deploys_edge_functions.md`) explicitly stating "when `_shared/eventCoverVideo.ts` changes in a PR, ALL six event-cover-video functions must be batch-redeployed." This is a process improvement and not a code-layer change; it's a documentation/discipline addition. Out of scope for this amendment but flagged for orchestrator's attention.

#### Item 7 — Regression test contract (P0 per META-ORCH-0744 (b) gate)

Per `feedback_close_commit_precommit_checks.md` and the META-ORCH-0744 regression-test gate:

**(a) Implementor-written happy-path regression test (Item 4 above):**
- Path: `supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts` (NEW)
- Scope: 5 scenarios (Item 4 §1-5)
- Fails-on-revert: scenario 1 must FAIL when public_id fallback is removed; PASS when restored.

**(b) Tester-written adversarial regression test (TBD in tester RETEST phase):**
- The tester must ship ONE genuinely adversarial test attacking a DIFFERENT angle than Item 4. Suggestions:
  - **Race condition:** Cloudinary fires the eager notification TWICE (duplicate webhook calls). Does the webhook idempotently handle the second call (existing job status='ready' check at line 111-113 — test that path).
  - **Stale signature:** valid public_id but signature timestamp >1 hour old → should return 403 stale_timestamp (different status, different code path).
  - **public_id with extra trailing slash:** `event-covers/raw/<brand>/<event>/<job>/` (trailing slash) — does `split("/").at(-1)` return empty string? If so, does the fallback correctly return null and 400 instead of silently doing the wrong thing?
  - **Signature pass + body has `context.custom.job_id = "<wrong-uuid>"` AND `public_id = ".../<right-uuid>"`:** which wins? (Per Item 1 spec, context wins — proves the precedence ordering is the documented one.)

Both tests must land in IMPLEMENT-3 (implementor's) + tester's RETEST QA report respectively. Strict-grep `ORCH_0978_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` MUST be extended to include the new test file path in the SAME commit per COMMS-0002 — append:
- `supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts`

**SC-AMENDMENT-5-TEST-CONTRACT-7:** IMPLEMENT-3 commit body cites implementor test path + commit hash with fails-on-revert proof. Tester RETEST QA report cites adversarial test path + commit hash with PASS run + fails-on-revert proof.

### E — New invariants

**I-PROPOSED-EVENT-COVER-VIDEO-PUBLIC-ID-LAST-SEGMENT-IS-JOB-UUID:** The public_id constructed by `event-cover-video-upload-intent/index.ts:265` MUST always have a valid UUID as its last segment, matching the format `event-covers/raw/{brandId}/{eventId}/{jobId}`. The webhook's `recoverJobIdFromPayload` helper relies on this. Changes to either side require updating BOTH atomically. Strict-grep C5 (§D Item 3) enforces at CI.

### F — CI gates

Extends `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` with one new check **C5** (per §D Item 3). Total checks after this amendment: 5 (C1 picker cap 29, C2 Cloudinary-pipeline constant 29_000, C3 storage-pipeline constant 29_000, C4 DB migration 29000, C5 public_id template + parser alignment).

ORCH_0978_BACKEND_ALLOWLIST extension in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`: append `supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts` (and the webhook source path if it's not already there — check before adding to avoid dup).

### G — Test contract (paths + run protocol)

| Test | Path | Type | Fails-on-revert anchor |
|---|---|---|---|
| Implementor happy-path | `supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts` | Deno test | delete `recoverJobIdFromPayload` public_id fallback branch |
| Tester adversarial | TBD — chosen by tester from §D Item 7 suggestions | Deno test | TBD by tester |

Both MUST land before CLOSE per META-ORCH-0744 (b).

### H — Migration plan

**No new migration required.** The fix is pure edge function code. Schema is unchanged. `event_cover_video_jobs.failure_code` is free-text so no enum update needed.

### I — Open questions

**None.** All scope decisions captured. Item 5 N/A per probe. Item 2 absorbed by existing failed-derivative path. Item 6 list is exhaustive (the six event-cover-video functions). Item 7 (b) tester adversarial test angle is operator's choice — but suggestions provided.

### J — Implementation order (for Codex `implementor-mingla`)

Three-commit landing pattern (mirror AMENDMENT 4's pattern for consistency):

1. **Commit 1 — Item 1 + Item 2 + observability log + Item 3 strict-grep extension:**
   - Modify `supabase/functions/event-cover-video-webhook/index.ts` per §D Item 1 (add helper, replace line 89, add console.warn for diagnostic absence cases)
   - Extend `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` with C5 per §D Item 3
   - Commit message: `ORCH-0978 IMPLEMENT-3 step 1: webhook public_id fallback for eager_async notifications (Item 1) + strict-grep C5 invariant (Item 3); no client change`

2. **Commit 2 — Item 4 regression test + ORCH_0978_BACKEND_ALLOWLIST update:**
   - Create `supabase/functions/event-cover-video-webhook/__tests__/job-id-recovery.test.ts` with all 5 scenarios per §D Item 4
   - Append test path + webhook source path (if missing) to `ORCH_0978_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`
   - Run fails-on-revert sequence (PASS → revert helper public_id branch → FAIL → restore → PASS), document all three commit hashes in commit body
   - Commit message: `ORCH-0978 IMPLEMENT-3 step 2: Deno regression test for webhook job_id recovery (5 scenarios, fails-on-revert verified at <commit>) + ORCH_0978_BACKEND_ALLOWLIST extension per COMMS-0002`

3. **Implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0978_IMPLEMENT_3.md` covering:
   - Both commit hashes + diff stats
   - Helper function shape verbatim
   - 5-scenario test results
   - Fails-on-revert PASS/FAIL/PASS sequence
   - Strict-grep C5 PASS run output
   - Confirmation that `event-cover-video-source-uploaded`, `-status`, `-apply`, `-cancel`, `-upload-intent` source files were NOT touched (only the webhook)
   - F-5 re-probe count at IMPLEMENT-3 time (in case the dde19eac job is no longer the only one)
   - Optional dde19eac job cleanup decision (cancelled with explanatory failure_code, OR left as historical artifact — implementor's call, documented either way)

Then **orchestrator REVIEW** → **batch redeploy 6 functions** per §D Item 6 → **tester RETEST** → **CLOSE**.

### K — Acceptance gate

This AMENDMENT 5 is "implementable" when:
1. Orchestrator REVIEW returns APPROVED.
2. Operator confirms no other webhook bug is suspected (this amendment is bounded to the captured 400 path).

Codex `implementor-mingla` IMPLEMENT-3 produces TWO commits + the implementation report. Total scope: ~80-150 net additions across 3 files (webhook + strict-grep extension + new Deno test). No client code touched. No SPEC modifications. No schema changes.

### L — Confidence — HIGH

Investigation's root cause is PROBABLE (one layer — literal production log line — captured via HTTP status code rather than direct log paste). However, the fix shape (Option A public_id parsing) is correct regardless of which 400 path fires — `invalid_json` is implausible for Cloudinary and `job_id_missing` is the only other path. Even if the production log later proves it was `invalid_json` (highly unlikely), the public_id fallback adds defense-in-depth without breaking anything. Six items defined, one N/A by probe, three commit-landing pattern, full test contract, strict-grep gate, batch deploy, no client touches. Scope is tightly bounded and additive (no rollback risk to IMPLEMENT-2's fixes).

---

## SPEC AMENDMENT 6 (a.k.a. AMENDMENT 4 in operator language) — 2026-05-27 — Webhook processed-duration fallback to job trim window + error-code split + eager `du_` defense-in-depth

> Author: Claude `mingla-orchestrator` (operator-delegated take-over; default SPEC owner is forensics, redirected by operator).
> Inputs: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_PROCESSED_DURATION_INVALID.md` (committed `1ec24f0fc`, ROOT CAUSE PROVEN), `Mingla_Artifacts/reports/QA_ORCH-0978_SIM_RETEST_ORCHESTRATOR.md`, `Mingla_Artifacts/reports/DEPLOY_ORCH-0978_IMPLEMENT_3.md`.
> Comms ledger acknowledged: COMMS-0002 WARN (ORCH_0978_BACKEND_ALLOWLIST), COMMS-0003 WARN (Cloudinary docs URLs cited inline).

### A — Layman summary

On webhook v121 the Cloudinary eager callback for video uploads arrives without a `duration` field, so the webhook's `Number(undefined) → NaN` rejects every upload with the misleading message "Processed video was over the duration limit." This SPEC hardens the webhook to fall back to the job's already-known trim window (`trim_end_ms - trim_start_ms`) when Cloudinary's eager callback omits duration, splits the misleading single-code rejection into three discrete codes for ops clarity, and adds a server-side `du_<seconds>` eager-transformation clause so the duration cap holds even if a future client misbehaves. The user-visible win: a 12-second iOS upload reaches `status='ready'` within 30 seconds and the cover updates. No client touches. No migration. One batch redeploy of all six event-cover-video functions after merge.

### B — Scope and non-goals

**In scope:**
1. Webhook duration extraction falls back to job row's `trim_end_ms - trim_start_ms` when Cloudinary's eager payload omits `duration`.
2. `assertProcessedDerivative` splits `processed_duration_invalid` into three discrete codes: `processed_duration_missing`, `processed_duration_nonpositive`, `processed_duration_over_cap` with matching human-readable messages.
3. `event-cover-video-upload-intent` eager chain adds `du_<seconds>` defense-in-depth clause computed from `Math.min(trim_end_ms - trim_start_ms, MAX_DURATION_MS) / 1000`.
4. Strict-grep extension `C6` enforcing webhook duration fallback co-references job-row trim columns.
5. Deno regression test fixture using the EXACT captured payload from `event_cover_video_jobs.provider_payload` of job `99179520-3566-4202-bf7c-f8711257ce0c` (sans signature) as the canonical real-world fixture.
6. Orchestrator-owned batch redeploy of ALL six event-cover-video functions because `_shared/eventCoverVideo.ts` is touched.

**Out of scope (explicit non-goals):**
- Switching from `eager_notification_url` to `notification_url`. Current architecture stays.
- Adopting the Cloudinary React Native SDK. Already-decided NO.
- `media_metadata: true` on upload-intent signed params (F-6 in investigation). Optional; rejected from this SPEC scope to keep amendment tight.
- Touching `source_uploaded`, `status`, `apply`, `cancel` source code beyond the shared lib's error-code split.
- Any client-side code (`app-mobile/`, `mingla-business/src/`, `mingla-admin/`).
- Any schema change. `processed_duration_ms` column is already nullable.

**Assumptions:**
- Cloudinary's eager_notification payload shape per the captured fixture (no `duration` field) is the canonical real-world shape, verified for video MP4 derivatives. Per Cloudinary docs (https://cloudinary.com/documentation/upload_images#notification_url and https://cloudinary.com/documentation/upload_images#eager_transformations), the eager callback is not contractually required to include duration.
- iOS `UIImagePickerController` with `allowsEditing: true` produces a pre-trimmed source, so `trim_end_ms - trim_start_ms` equals the source duration equals the processed duration (eager has no trim component pre-AMENDMENT-6; post-AMENDMENT-6 the new `du_` clause enforces it server-side).

### C — Cross-Surface Impact (MANDATORY)

| Surface | In scope? | Impact |
|---|---|---|
| Consumer iOS | NO — consumer app doesn't upload event cover videos | N/A |
| Consumer Android | NO — same as above | N/A |
| Buyer/anonymous Web | NO — read-only consumer of cover URLs | N/A |
| Business iOS | YES — backend path fix; client code untouched; user-visible win | Cover-video uploads complete to `ready` within 30s on iOS after deploy |
| Business Android | YES — same backend path; client code untouched | Cover-video uploads complete to `ready` within 30s on Android after deploy |
| Admin Web | NO — admin doesn't upload event cover videos | N/A |
| Business Web preview | YES (if web ever surfaces upload) — same backend path | Same behavior |

Parity is **automatic** (single backend path serves all three business surfaces). No per-surface success criterion needed.

### D — Layered specification

#### D.1 — Database layer

No changes. `event_cover_video_jobs.processed_duration_ms` remains nullable; `trim_start_ms` + `trim_end_ms` are already populated by upload-intent (column-level constraint `trim_end_ms - trim_start_ms <= 29000` is already enforced per AMENDMENT 4 migration `20260730000000_orch_0978_video_cap_29s_constraints.sql`).

#### D.2 — Shared edge lib (`supabase/functions/_shared/eventCoverVideo.ts`)

**Change site 1 — split `processed_duration_invalid` into three codes (lines 397-401 today).**

Current:
```ts
const durationMs =
  typeof input.durationMs === "number" ? input.durationMs : Number(input.durationMs);
if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_DURATION_MS) {
  return { ok: false, code: "processed_duration_invalid", message: "Processed video was over the duration limit." };
}
```

Must become:
```ts
const durationMs =
  typeof input.durationMs === "number" ? input.durationMs : Number(input.durationMs);
if (!Number.isFinite(durationMs)) {
  return { ok: false, code: "processed_duration_missing", message: "Processed video duration was missing from the provider callback." };
}
if (durationMs <= 0) {
  return { ok: false, code: "processed_duration_nonpositive", message: "Processed video duration was zero or negative." };
}
if (durationMs > MAX_DURATION_MS) {
  return { ok: false, code: "processed_duration_over_cap", message: "Processed video was over the duration limit." };
}
```

Three discrete codes, three discrete messages. The `_over_cap` message keeps the old wording so any external monitor parsing that string still works for the genuine-over-cap case.

Note: the existing `processed_duration_invalid` literal must NOT be re-introduced anywhere. Strict-grep C6 enforces this.

#### D.3 — Webhook (`supabase/functions/event-cover-video-webhook/index.ts`)

**Change site 2 — duration extraction with job-row trim fallback (current lines 155-178, especially 158-160 and the `assertProcessedDerivative` call at 171-178).**

The webhook already fetches the job at lines 120-124 (`existingJob` carries `id, status, event_id, apply_mode`). The SELECT must widen to include `trim_start_ms` and `trim_end_ms`:

```ts
const { data: existingJob, error: existingJobError } = await supabase
  .from("event_cover_video_jobs")
  .select("id,status,event_id,apply_mode,trim_start_ms,trim_end_ms")
  .eq("id", jobId)
  .maybeSingle();
```

Then introduce a fallback helper near `firstEager`:

```ts
const eagerDurationOrFallback = (
  eager: Record<string, unknown>,
  payload: Record<string, unknown>,
  job: { trim_start_ms?: number | null; trim_end_ms?: number | null },
): number | null => {
  const raw = eager.duration ?? eager.duration_ms ?? payload.duration ?? payload.duration_ms;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw < 1000 ? raw * 1000 : raw;
  }
  // Cloudinary's eager_notification payload is not contractually required to include duration.
  // Reference: https://cloudinary.com/documentation/upload_images#notification_url
  // The job's trim window is the next-best authoritative source — upload-intent enforced the cap
  // before the upload, and the eager transformation now also enforces du_<seconds>.
  const start = typeof job.trim_start_ms === "number" ? job.trim_start_ms : 0;
  const end = typeof job.trim_end_ms === "number" ? job.trim_end_ms : null;
  if (end === null || end <= start) return null;
  return end - start;
};
```

Change the assertion call site (lines 158-178 area):

```ts
const eager = firstEager(payload);
const url = eager.secure_url ?? eager.url ?? payload.secure_url ?? payload.url;
const bytes = eager.bytes ?? payload.bytes;
const durationMs = eagerDurationOrFallback(eager, payload, existingJob);
// ... rest of metadata extraction unchanged
const derivative = assertProcessedDerivative({
  audioCodec: audio.codec ?? eager.audio_codec ?? payload.audio_codec,
  bytes,
  durationMs,
  mimeType,
  url,
  videoCodec: video.codec ?? eager.video_codec ?? payload.video_codec,
});
```

**Diagnostic log on fallback path (MANDATORY, codified per `feedback_supabase_edge_deploy_verify_first_call.md` post-deploy probe contract):**

When the fallback fires, log via `console.warn`:

```ts
if (durationMs !== null && (eager.duration === undefined && eager.duration_ms === undefined && payload.duration === undefined && payload.duration_ms === undefined)) {
  console.warn("[event-cover-video-webhook]", JSON.stringify({
    jobId,
    fallbackDurationMs: durationMs,
    publicId: typeof payload.public_id === "string" ? payload.public_id : null,
    stage: "duration_fallback_to_job_trim",
  }));
}
```

This is observability for the SRE: any future Cloudinary contract change that re-introduces `duration` in the eager payload should make this warning rate drop to zero.

#### D.4 — Upload-intent (`supabase/functions/event-cover-video-upload-intent/index.ts`)

**Change site 3 — add `du_<seconds>` eager clause (lines 266-274 area).**

Current:
```ts
const durationBudgetMs = Math.min(trimEndMs - trimStartMs, MAX_DURATION_MS);
const eager = [
  "c_limit,w_1280,h_720",
  "vc_h264",
  "ac_aac",
  `br_${clampBitrate(durationBudgetMs)}`,
  "f_mp4",
  "q_auto:good",
].join(",");
```

Must become:
```ts
const durationBudgetMs = Math.min(trimEndMs - trimStartMs, MAX_DURATION_MS);
const durationBudgetSeconds = Math.ceil(durationBudgetMs / 1000);
// du_<seconds> caps processed duration server-side as defense-in-depth alongside client trim.
// Reference: https://cloudinary.com/documentation/video_manipulation_and_delivery_reference#video_transformation_url_parameters
const eager = [
  "c_limit,w_1280,h_720",
  `du_${durationBudgetSeconds}`,
  "vc_h264",
  "ac_aac",
  `br_${clampBitrate(durationBudgetMs)}`,
  "f_mp4",
  "q_auto:good",
].join(",");
```

The `du_<X>` parameter sets a hard duration limit on the processed output per Cloudinary's video transformation reference.

#### D.5 — Strict-grep `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs`

Extend with **C6** check: webhook source MUST contain BOTH `eagerDurationOrFallback` (the new helper) AND `trim_end_ms` reference within the file. This pairs eager-duration reads with the job-row fallback so future edits cannot silently drop the fallback.

Also add **C7** check: shared lib source MUST contain all three new code literals `processed_duration_missing`, `processed_duration_nonpositive`, `processed_duration_over_cap` AND MUST NOT contain the old `processed_duration_invalid` literal. Prevents accidental regression to the misleading single-code rejection.

#### D.6 — `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` allowlist

Per COMMS-0002: the new Deno regression test file `supabase/functions/event-cover-video-webhook/__tests__/duration-fallback.test.ts` (created in IMPLEMENT-4 step 2) MUST be appended to `ORCH_0978_BACKEND_ALLOWLIST` in the same commit as the test file lands.

### E — Success criteria (numbered, observable, testable)

1. **SC-1 — Happy path with missing duration.** Upload a 12-second iOS video via the business app cover flow. Within 30 seconds: `event_cover_video_jobs.status='ready'`, `processed_url` is a non-null `https://res.cloudinary.com/...` URL, `processed_duration_ms = 12000`. Cover updates on the event.
2. **SC-2 — Diagnostic log fires on fallback.** Supabase dashboard log for webhook v122 contains a `stage: "duration_fallback_to_job_trim"` entry for the SC-1 upload with `fallbackDurationMs: 12000` and the job UUID.
3. **SC-3 — Genuine over-cap rejected with new discrete code.** A simulated callback with `duration: 35.0` (35 seconds) writes `failure_code='processed_duration_over_cap'`, `failure_message='Processed video was over the duration limit.'`. Unit test, not live-fire.
4. **SC-4 — Missing-duration callback writes new discrete code when no trim window exists.** A simulated callback with no `duration` field AND a job row missing `trim_end_ms` writes `failure_code='processed_duration_missing'`, `failure_message='Processed video duration was missing from the provider callback.'`. Unit test.
5. **SC-5 — Nonpositive guarded.** A simulated callback with `duration: 0` writes `failure_code='processed_duration_nonpositive'`. Unit test.
6. **SC-6 — Eager `du_` clause is in the upload signature.** Strict-grep C6 + C7 both PASS. `upload-intent/index.ts` eager string contains `du_${durationBudgetSeconds}`.
7. **SC-7 — Webhook batch redeploy succeeds.** All six event-cover-video functions deployed to next version (webhook v121→v122 at minimum; others may be no-bundle-change if `_shared` import path unchanged for them). Each preserves `verify_jwt` setting. Webhook v122 post-deploy verify-first-call probe returns HTTP 403 `missing_signature` (proves bundle live + `verify_jwt=false` preserved).
8. **SC-8 — `processed_duration_invalid` literal is dead.** `grep -rn "processed_duration_invalid"` returns ZERO matches under `supabase/functions/` and `mingla-business/src/`. Tests may reference the old code only in commit messages or comments explaining the supersession.

### F — Invariants

| Invariant | Preserved how |
|---|---|
| Webhook `verify_jwt = false` | `supabase/config.toml:48-49` unchanged; CLI deploy reads config preserving setting |
| Cover-video pipeline is sole writer of processed-job state | Unchanged; only webhook calls `eventCoverVideoReadyUpdate` |
| No silent failures | NEW logs surface fallback path; three discrete error codes prevent message-conflation regression |
| Cloudinary external API verified against docs (COMMS-0003) | Webhook fallback + `du_<seconds>` eager addition both cite docs URLs inline in source comments per spec |
| Backend touches go through ORCH_0978_BACKEND_ALLOWLIST (COMMS-0002) | New test path appended in same commit |
| Production-ready or flag it | T-1 happy path becomes proven post-deploy via SC-1; if not, FAIL CLOSE |

**New invariant introduced (proposed):** I-PROPOSED-WEBHOOK-PAYLOAD-FALLBACK — every webhook that reads optional external-API payload fields MUST have a typed fallback to internal source-of-truth (DB row, prior request state) OR a discrete error code that names the missing field. No `Number(undefined) = NaN` paths to misleading rejections. Promote to ACTIVE on ORCH-0978 CLOSE.

### G — Test cases

| ID | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-AMEND6-01 | **Fixture-faithful happy path.** Use the EXACT captured payload from job `99179520-...` provider_payload (sans signature) as the test fixture. | Captured Cloudinary eager payload + job stub with `trim_start_ms=0, trim_end_ms=12000` | HTTP 200; webhook writes `processed_duration_ms=12000`, `status='ready'`, `processed_url=eager[0].secure_url`. `duration_fallback_to_job_trim` warn logged. | Deno regression |
| T-AMEND6-02 | **Cloudinary-canonical happy path.** Eager payload with `duration: 12.0` (float seconds per docs). | Eager `duration: 12.0` + job stub `trim_end_ms=12000` | HTTP 200; webhook writes `processed_duration_ms=12000` (×1000 heuristic applied); status='ready'. NO fallback warn. | Deno regression |
| T-AMEND6-03 | **Over-cap rejection with new code.** | Eager `duration: 35.0` (35s) | HTTP 200; webhook writes `failure_code='processed_duration_over_cap'`, message="Processed video was over the duration limit." | Deno regression |
| T-AMEND6-04 | **Missing-duration AND missing-trim guards write missing code.** | Eager without `duration` + job stub with `trim_end_ms=null` | HTTP 200; webhook writes `failure_code='processed_duration_missing'`, message="Processed video duration was missing from the provider callback." | Deno regression |
| T-AMEND6-05 | **Nonpositive guard.** | Eager `duration: 0` | HTTP 200; webhook writes `failure_code='processed_duration_nonpositive'`, message="Processed video duration was zero or negative." | Deno regression |
| T-AMEND6-06 | **Live-fire happy path.** Real iOS picker → real Cloudinary → real webhook v122. | Rainbow 0:12 video from sim | DB job reaches `status='ready'` within 30s, `processed_url` non-null. | Live-fire (tester) |
| T-AMEND6-07 | **Strict-grep C6 + C7.** | `node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` | All checks PASS | CI gate |
| T-AMEND6-08 | **`processed_duration_invalid` dead.** | `rg "processed_duration_invalid" supabase/functions mingla-business/src` | Zero matches | grep |

T-AMEND6-01 is the META-ORCH-0744 implementor happy-path regression test. T-AMEND6-04 is the META-ORCH-0744 tester adversarial regression test (different angle — covers the trim-also-missing edge case the implementor's fixture-faithful test does not exercise). Both MUST land with fails-on-revert verified at the IMPLEMENT-4 commit hash.

### H — Implementation order (binding two-commit pattern per META-ORCH-0744)

**Commit 1 — product fix (~80 net lines across 3 files):**
- `supabase/functions/_shared/eventCoverVideo.ts`: split `assertProcessedDerivative` duration check into three discrete codes.
- `supabase/functions/event-cover-video-webhook/index.ts`: widen job SELECT to include `trim_start_ms,trim_end_ms`; add `eagerDurationOrFallback` helper; replace existing duration extraction; add diagnostic warn on fallback path.
- `supabase/functions/event-cover-video-upload-intent/index.ts`: add `du_${durationBudgetSeconds}` to eager chain with Cloudinary docs URL comment.
- `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs`: add C6 + C7 checks.

**Commit 2 — Deno regression tests + allowlist (~150 net lines, 2 files):**
- `supabase/functions/event-cover-video-webhook/__tests__/duration-fallback.test.ts`: scenarios T-AMEND6-01 through T-AMEND6-05 (5 scenarios). Test fixture for T-AMEND6-01 MUST be the literal captured payload from investigation §4 (sans signature), copy-paste into test file as a JSON constant.
- `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`: append `supabase/functions/event-cover-video-webhook/__tests__/duration-fallback.test.ts` to `ORCH_0978_BACKEND_ALLOWLIST`.

Fails-on-revert proof (MANDATORY in implementation report):
- PASS on fixed code at `<commit-1-hash>`: `deno test --allow-env supabase/functions/event-cover-video-webhook/__tests__/duration-fallback.test.ts` → 5/5 PASS.
- FAIL when `eagerDurationOrFallback` fallback branch is temporarily replaced with `return null`: T-AMEND6-01 should fail expecting 200 but receiving HTTP 200 with `failure_code='processed_duration_missing'`. Document the local revert sequence.
- PASS restored at `<commit-1-hash>`.

### I — Regression prevention

1. T-AMEND6-01 fixture-faithful test locks in the proven real-world Cloudinary eager shape. Any future Cloudinary contract change that re-introduces `duration` makes T-AMEND6-02 the canonical path; T-AMEND6-01 still works because fallback wins when duration is absent — never wrong.
2. Strict-grep C6 makes "future engineer removes the fallback" impossible to ship.
3. Strict-grep C7 makes "future engineer re-introduces `processed_duration_invalid` literal" impossible to ship.
4. Diagnostic warn surface lets SRE track whether Cloudinary's contract changes over time.
5. `du_<seconds>` eager clause makes server-side cap independent of client trim discipline — defense-in-depth.
6. New invariant I-PROPOSED-WEBHOOK-PAYLOAD-FALLBACK promotes to ACTIVE on CLOSE, codifying the pattern for any future webhook.

### J — Cross-Surface Impact (closing summary)

Backend-only. No client touches. No migration. No PR open by implementor. Orchestrator owns batch redeploy after merge. Tester runs T-AMEND6-06 live-fire after deploy. Seth runs physical-iPhone T-1/T-2/T-3 ONLY after sim T-AMEND6-06 PASS.

### K — Deploy discipline

Per `feedback_orchestrator_deploys_edge_functions.md`: orchestrator owns the batch redeploy of ALL six event-cover-video functions because `_shared/eventCoverVideo.ts` is touched (3-code split affects what other functions might assert against in future, even if they don't today). Sequence:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]"
for fn in event-cover-video-webhook event-cover-video-upload-intent event-cover-video-source-uploaded event-cover-video-status event-cover-video-apply event-cover-video-cancel; do
  /Users/sethogieva/bin/supabase functions deploy "$fn" --project-ref gqnoajqerqhnvulmnyvv
done
```

Then `mcp__supabase__list_edge_functions` to verify version bumps and `verify_jwt` preservation (webhook stays `false`; the other five stay `true`).

Then per `feedback_supabase_edge_deploy_verify_first_call.md`: one curl probe against webhook v122:

```bash
curl -sS -o /tmp/v122_probe.json -w "HTTP %{http_code} | time %{time_total}s\n" \
  -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/event-cover-video-webhook" \
  -H "Content-Type: application/json" -d '{}'
```

Expected: HTTP 403 `missing_signature` (proves bundle live + `verify_jwt=false` preserved).

### L — Downstream routing

Codex `implementor-mingla` IMPLEMENT-4 → orchestrator REVIEW → orchestrator batch redeploy + curl probe → tester RETEST T-AMEND6-06 on sim + Seth physical iPhone T-1/T-2/T-3 → orchestrator CLOSE with `[deploy]` tag (touches `mingla-business/src/` from IMPLEMENT-2 and backend from IMPLEMENT-3+IMPLEMENT-4) → EAS OTA → PR → squash merge → worktree reap.

### M — Confidence — HIGH

Investigation's root cause is PROVEN (captured raw production payload at investigation §4). All three competing hypotheses are ruled out. Fix shape derives directly from the proven failure mode. Two-commit landing pattern per META-ORCH-0744. Defense-in-depth via `du_` server-side cap. Three discrete error codes prevent message-conflation regression class entirely. Scope is tightly bounded — backend only, additive, no rollback risk to IMPLEMENT-2 or IMPLEMENT-3 fixes.

---

## SPEC AMENDMENT 7 (a.k.a. AMENDMENT 5 in operator language) — 2026-05-27 — Save-cover persistence + 30s text fix + service split + round-trip verification + trim wiring

> Author: Claude `mingla-forensics` (operator-delegated SPEC mode).
> Binding inputs: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_SAVE_COVER_PERSISTENCE.md` (committed `02f5314ba`, PROBABLE root cause with named blocker); `Mingla_Artifacts/reports/REVIEW_ORCH-0978_INVESTIGATION_SAVE_COVER_PERSISTENCE.md` (committed `8266f7e5d`, REVIEW APPROVED).
> Dispatch reference: `Mingla_Artifacts/prompts/FORENSICS_SPEC_ORCH-0978_AMENDMENT_7_SAVE_COVER_PERSISTENCE.md`.
> Comms ledger acknowledged: COMMS-0002 (no backend allowlist update — client-only changes), COMMS-0003 (no external API claims — client-only changes), COMMS-0004 (no INTAKE — same ORCH).

### A — Layman summary

Today, when a user uploads a cover video on a published event and taps "Save changes," the app shows "Saved" but the cover stays blank because the save call writes NULL to every cover column. This SPEC fixes that by (1) splitting the cover service into two discrete functions (`setEventCover` requires a real URL; `clearEventCover` is the only path that nulls everything), (2) tightening the save flow to never invoke the cover service with NULL when no clear was intended, (3) adding round-trip verification so a "Saved" toast can never appear when the DB write was a silent null, (4) wiring trim values through the upload-intent hook for self-documenting backend contract, and (5) replacing three stale "30 seconds" strings with "29 seconds" that IMPLEMENT-2 missed. After this lands, the user-visible win is: a 16-second video upload on a published event reaches the event row and renders on reopen, and any future silent-null regression is caught at write time, not on reopen.

### B — Scope and non-goals

**In scope (binding):**
1. Item 1 — Tighten the cover-save guard in `EditPublishedScreen.tsx:617-674` so `updatePublishedEventCoverMedia` (now `setEventCover` / `clearEventCover`) is never invoked with `mediaUrl=null` when no explicit clear was intended.
2. Item 2 — Split `eventCoverMediaService.ts:180-222` into `setEventCover` (requires non-null mediaUrl at TypeScript level) + `clearEventCover` (explicit null path only). Remove `updatePublishedEventCoverMedia` from active code.
3. Item 3 — Round-trip verification after `setEventCover` returns; throw `EventCoverMediaError("persist_mismatch", ...)` on mismatch. Service-layer `.select(...)` widens to include cover columns.
4. Item 4 — `useEventCoverVideoUpload.ts:92-100` passes `trimStartMs: 0` and `trimEndMs: file.durationMs` explicitly to `createEventCoverVideoUploadIntent`.
5. Item 5 — Replace 3 stale "30 seconds" strings with "29 seconds" at the exact lines named in §D.
6. Item 6 — Strict-grep C8 + C9 in `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs`.
7. Item 7 — Regression tests (Jest, two files) per META-ORCH-0744 two-commit landing.
8. Item 8 — OPTIONAL `[ORCH-0978-DIAG]` `console.log` for PROBABLE→PROVEN upgrade. Implementor choice; if included, must be reapable at CLOSE Step 1.5.

**Non-goals (explicit out-of-scope):**
- Edge function source changes. Backend pipeline (webhook v122, upload-intent v96) is proven good.
- Migration. Schema is unchanged. `events` cover columns are already nullable per existing DDL.
- Switching from `eager_notification_url` to `notification_url`. Out of scope per AMENDMENT 6 non-goal.
- Cloudinary RN SDK adoption. Out of scope per AMENDMENT 5 non-goal.
- Draft-event cover save path. The investigation's blast radius §7 notes draft-side may have the same shape, but a separate ORCH should own that audit — folding it here widens scope.
- Trip-event cover save path. `tripsService.ts:672-674` has the same `patch.coverMediaUrl !== undefined` read-through. Out of scope; document as Discovery for Orchestrator follow-up.
- Brand-cover service (`useBrandCoverUpload.ts`). Different write path; out of scope.
- Removing the COMMS-0002 backend-allowlist requirement (none of this PR's files are under `supabase/`).
- Re-running prior phases' verification (webhook v122 already PASSED on sim + physical iPhone).

**Assumptions:**
- The investigation's PROBABLE root cause (F-1: read-through to `liveEvent.coverMediaUrl=null`) is correct. The fix direction (split service + tighten guard + round-trip) is correct regardless of WHICH client-side sub-mechanism produces the bad patch shape — it tightens the boundary structurally.
- `events.cover_media_*` columns are nullable; RLS UPDATE permits the editing user to write cover columns on a live event (verified via prior IMPLEMENT-2 success path).
- React Query cache invalidation downstream of save remains the orchestrator's concern; this SPEC does not modify cache keys.

### C — Cross-Surface Impact (MANDATORY per Phase 2.5)

| Surface | In scope? | User-visible behaviour the SPEC demands | File paths touched on this surface | Parity |
|---|---|---|---|---|
| Consumer iOS (`app-mobile/` on iOS) | NO | N/A — consumer app does not author event covers | None | N/A |
| Consumer Android (`app-mobile/` on Android) | NO | N/A — same as above | None | N/A |
| Buyer/anonymous Web | NO | N/A — buyer pages read cover URLs but never write them | None | N/A — automatic by absence |
| Business iOS (`mingla-business/` on iOS) | **YES** | Upload video on published event → Save changes → cover persists and renders on reopen | `mingla-business/src/services/eventCoverMediaService.ts`, `mingla-business/src/components/event/EditPublishedScreen.tsx`, `mingla-business/src/components/ui/CoverPicker.tsx`, `mingla-business/src/hooks/useEventCoverVideoUpload.ts`, `mingla-business/src/utils/eventCoverNativeVideo.ts`, `mingla-business/src/utils/eventCoverMediaRules.ts` | **Automatic** (shared client code; same TypeScript bundle ships to both platforms) |
| Business Android (`mingla-business/` on Android) | **YES** | Same as Business iOS | Same files (shared) | **Automatic** (same bundle) |
| Admin Web (`mingla-admin/`) | NO | N/A — admin does not author event covers | None | N/A |
| Business Web preview (`mingla-business/` dev/web) | YES (incidental) | Same backend write path; if cover-edit UI is ever exposed on web, this fix protects it | Same files (shared) | **Automatic** (same React Native Web bundle path) |

**Parity is fully automatic.** No platform-specific code paths. Single set of success criteria suffices for all covered surfaces.

### D — Layered specification

#### D.1 — Service layer: split `eventCoverMediaService.ts`

**Current state (lines 180-222):** One function `updatePublishedEventCoverMedia(serverEventId, mediaUrl, mediaType, metadata)` with `mediaUrl: string | null`. Service uses `mediaUrl === null ? null : ...` ternaries for all 6 metadata columns, so calling with null nulls everything.

**Required transformation:**

REMOVE `updatePublishedEventCoverMedia` entirely (delete the function — do NOT alias, do NOT re-export, do NOT deprecate-then-keep). Replace with two new exports:

```ts
export const setEventCover = async (
  serverEventId: string,
  mediaUrl: string,              // NOT NULL — TypeScript enforces
  mediaType: EventCoverMediaType, // NOT NULL — TypeScript enforces
  metadata: EventCoverProviderMetadata,
): Promise<{ id: string; cover_media_url: string; cover_media_type: EventCoverMediaType }> => {
  if (serverEventId.trim().length === 0) {
    throw new EventCoverMediaError(
      "missing_server_event_id",
      "Save failed because this event is missing its server id.",
    );
  }
  const { data, error } = await supabase
    .from("events")
    .update({
      cover_media_url: mediaUrl,
      cover_media_type: mediaType,
      cover_media_provider: metadata.provider ?? null,
      cover_media_source_url: metadata.sourceUrl ?? null,
      cover_media_credit: metadata.credit ?? null,
      cover_media_credit_url: metadata.creditUrl ?? null,
      cover_media_alt: metadata.alt ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", serverEventId)
    .eq("event_type", "event")
    .is("deleted_at", null)
    .select("id, cover_media_url, cover_media_type")
    .maybeSingle();

  if (error !== null) {
    throw new EventCoverMediaError("upload_failed", error.message);
  }
  if (data === null) {
    throw new EventCoverMediaError(
      "missing_server_event_id",
      "Save failed because this event could not be found.",
    );
  }
  // Item 3 round-trip verification (see D.2 caller).
  if (data.cover_media_url !== mediaUrl) {
    throw new EventCoverMediaError(
      "persist_mismatch",
      "Save succeeded but the cover did not persist. Refresh and try again.",
    );
  }
  return data as { id: string; cover_media_url: string; cover_media_type: EventCoverMediaType };
};

export const clearEventCover = async (
  serverEventId: string,
): Promise<void> => {
  if (serverEventId.trim().length === 0) {
    throw new EventCoverMediaError(
      "missing_server_event_id",
      "Save failed because this event is missing its server id.",
    );
  }
  const { data, error } = await supabase
    .from("events")
    .update({
      cover_media_url: null,
      cover_media_type: null,
      cover_media_provider: null,
      cover_media_source_url: null,
      cover_media_credit: null,
      cover_media_credit_url: null,
      cover_media_alt: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", serverEventId)
    .eq("event_type", "event")
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error !== null) {
    throw new EventCoverMediaError("upload_failed", error.message);
  }
  if (data === null) {
    throw new EventCoverMediaError(
      "missing_server_event_id",
      "Save failed because this event could not be found.",
    );
  }
};
```

**Error contract additions:** `EventCoverMediaError` codes union must include `"persist_mismatch"` (new). Update `src/services/eventCoverMediaService.ts` or whichever file declares the `EventCoverMediaErrorCode` union (search for `type EventCoverMediaErrorCode`).

**Test-guard update:** `src/utils/__tests__/serverDraftLifecycleGuards.test.ts:352` currently asserts `source.indexOf("updatePublishedEventCoverMedia(") > 0`. Update the assertion to look for `setEventCover(` or `clearEventCover(` — both are valid post-AMENDMENT-7. Implementor MUST land this change in Commit 1 alongside the service rewrite.

#### D.2 — Component layer: rewrite the cover-save block in `EditPublishedScreen.tsx`

**Current state (lines 617-674):** `mediaPatchPresent = patch.coverMediaUrl !== undefined || ... || patch.coverMediaAlt !== undefined`. If true, calls `updatePublishedEventCoverMedia` with read-through fall-back to `liveEvent.coverMediaUrl` for the URL and metadata fields.

**Required transformation:**

```ts
// === REPLACEMENT FOR LINES 617-674 ===

const explicitCoverSet =
  patch.coverMediaUrl !== undefined && patch.coverMediaUrl !== null;
const explicitCoverClear = patch.coverMediaUrl === null;
const metadataOnlyPatch =
  patch.coverMediaUrl === undefined &&
  (patch.coverMediaType !== undefined ||
    patch.coverMediaProvider !== undefined ||
    patch.coverMediaSourceUrl !== undefined ||
    patch.coverMediaCredit !== undefined ||
    patch.coverMediaCreditUrl !== undefined ||
    patch.coverMediaAlt !== undefined);

if (explicitCoverSet || explicitCoverClear) {
  if (liveEvent.serverEventId === null) {
    setSubmitting(false);
    setModal((prev) => ({ ...prev, visible: false }));
    showToast("Save failed because this event is missing its server id.");
    return;
  }
  try {
    if (explicitCoverClear) {
      await clearEventCover(liveEvent.serverEventId);
    } else {
      // explicitCoverSet — assertion: patch.coverMediaUrl is a non-null string here.
      // TypeScript narrowing requires non-null assertion or refinement.
      const mediaUrl = patch.coverMediaUrl as string;
      const mediaType = patch.coverMediaType ?? liveEvent.coverMediaType;
      if (mediaType === null) {
        // Defensive: cover URL set but no type — should never happen since
        // every emitChange call site in CoverPicker sets both fields together.
        // Treat as silent-failure prevention.
        throw new EventCoverMediaError(
          "upload_failed",
          "Cover save failed: media type is missing.",
        );
      }
      await setEventCover(
        liveEvent.serverEventId,
        mediaUrl,
        mediaType,
        {
          provider:
            patch.coverMediaProvider !== undefined
              ? patch.coverMediaProvider
              : liveEvent.coverMediaProvider ?? null,
          sourceUrl:
            patch.coverMediaSourceUrl !== undefined
              ? patch.coverMediaSourceUrl
              : liveEvent.coverMediaSourceUrl ?? null,
          credit:
            patch.coverMediaCredit !== undefined
              ? patch.coverMediaCredit
              : liveEvent.coverMediaCredit ?? null,
          creditUrl:
            patch.coverMediaCreditUrl !== undefined
              ? patch.coverMediaCreditUrl
              : liveEvent.coverMediaCreditUrl ?? null,
          alt:
            patch.coverMediaAlt !== undefined
              ? patch.coverMediaAlt
              : liveEvent.coverMediaAlt ?? null,
        },
      );
    }
  } catch (error) {
    setSubmitting(false);
    setModal((prev) => ({ ...prev, visible: false }));
    if (error instanceof EventCoverMediaError) {
      if (error.code === "persist_mismatch") {
        showToast("Save succeeded but the cover did not persist. Refresh and try again.");
      } else {
        showToast("Cover upload failed. Try again.");
      }
    } else {
      showToast("Could not save cover media. Try again.");
    }
    return;
  }
} else if (metadataOnlyPatch) {
  // No URL change AND no explicit clear — metadata-only patches without a
  // cover URL change cannot persist meaningfully (the service ALWAYS
  // co-writes URL or NULL-everything). Skip the call. If this fires
  // unexpectedly, log for diagnostic; do not invoke the cover service.
  console.warn(
    "[ORCH-0978]",
    "metadata-only cover patch skipped (no coverMediaUrl change)",
    { patchKeys: Object.keys(patch).filter((k) => k.startsWith("coverMedia")) },
  );
}
// Else: no cover field in patch — fall through to the next save block (taxonomy/when/theme).
```

**Import updates required at the top of the file:** Remove `updatePublishedEventCoverMedia` from the import; add `setEventCover` and `clearEventCover` from `../../services/eventCoverMediaService`.

**Toast copy for persist-mismatch:** "Save succeeded but the cover did not persist. Refresh and try again." (mirrors investigation §9's recommended wording).

#### D.3 — Component layer: handleRemoveCover wires to clearEventCover via the picker → updateDraft chain (NOT direct service call)

`CoverPicker.tsx:562-575` `handleRemoveCover` currently calls `emitChange({ ...all 7 fields null... })`. That flows through `updateDraft` → `setEditState` and is then persisted by `EditPublishedScreen`'s save flow per D.2. Under the new D.2 logic, `patch.coverMediaUrl === null` triggers `explicitCoverClear` → `clearEventCover()`. **No source change required in CoverPicker.tsx for handleRemoveCover** — the wiring is preserved end-to-end; only the persistence path (which CoverPicker doesn't know about) changes.

Verification step the implementor MUST perform: read CoverPicker.tsx:562-575 verbatim post-rewrite; confirm `emitChange({ coverMediaUrl: null, ... })` still matches today's signature. Confirm `EditPublishedScreen.tsx`'s save block correctly routes that patch shape to `clearEventCover` per D.2.

#### D.4 — Hook layer: `useEventCoverVideoUpload.ts` passes trim values explicitly

**Current state (lines 92-100):**
```ts
const intent = await createEventCoverVideoUploadIntent({
  applyMode,
  brandId,
  eventId,
  sourceBytes: compressed.bytes,
  sourceDurationMs: compressed.durationMs,
  sourceFileName: file.fileName ?? null,
  sourceMimeType: file.mimeType ?? null,
});
```

**Required transformation:**
```ts
const intent = await createEventCoverVideoUploadIntent({
  applyMode,
  brandId,
  eventId,
  sourceBytes: compressed.bytes,
  sourceDurationMs: compressed.durationMs,
  sourceFileName: file.fileName ?? null,
  sourceMimeType: file.mimeType ?? null,
  trimStartMs: 0,
  trimEndMs: compressed.durationMs,
});
```

No behavior change today (backend defaults are identical to these values). Self-documenting contract for future explicit-trim work.

**Type contract:** `createEventCoverVideoUploadIntent` input type (in `eventCoverVideoProcessingService.ts`) likely already accepts optional `trimStartMs` and `trimEndMs` (since edge function reads them). Implementor verifies and adds to the type if missing — no behavior change to the edge function.

#### D.5 — Text layer: replace 3 stale "30 seconds" strings

| File | Line | Old | New |
|---|---|---|---|
| `mingla-business/src/utils/eventCoverNativeVideo.ts` | 62 | `message: "Please trim to 30 seconds first.",` | `message: "Please trim to 29 seconds first.",` |
| `mingla-business/src/utils/eventCoverMediaRules.ts` | 318 | `"Choose an image, GIF, or MP4/MOV/WebM video up to 30 seconds.",` | `"Choose an image, GIF, or MP4/MOV/WebM video up to 29 seconds.",` |
| `mingla-business/src/utils/eventCoverMediaRules.ts` | 343 | `"Cover videos must be 30 seconds or shorter.",` | `"Cover videos must be 29 seconds or shorter.",` |

#### D.6 — CI gate layer: strict-grep extensions

Extend `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` with TWO new checks after the existing C7:

**C8 — eventCoverMediaService split + dead literal:**
```js
const eventCoverMediaServicePath = "mingla-business/src/services/eventCoverMediaService.ts";
const eventCoverMediaService = read(eventCoverMediaServicePath);
if (!eventCoverMediaService.includes("export const setEventCover")) {
  fail("C8", `${eventCoverMediaServicePath} must export setEventCover`);
} else if (!eventCoverMediaService.includes("export const clearEventCover")) {
  fail("C8", `${eventCoverMediaServicePath} must export clearEventCover`);
} else if (eventCoverMediaService.includes("updatePublishedEventCoverMedia")) {
  fail(
    "C8",
    `${eventCoverMediaServicePath} must NOT reference updatePublishedEventCoverMedia (dead literal)`,
  );
} else {
  ok("C8", "eventCoverMediaService exports setEventCover + clearEventCover; old symbol is dead");
}
```

**C9 — dead "30 seconds" literal across two utils files:**
```js
const nativeVideoPath = "mingla-business/src/utils/eventCoverNativeVideo.ts";
const mediaRulesPath2 = "mingla-business/src/utils/eventCoverMediaRules.ts";
const nativeVideoText = read(nativeVideoPath);
const mediaRulesText = read(mediaRulesPath2);
const offendingFiles = [];
if (nativeVideoText.includes("30 seconds")) offendingFiles.push(nativeVideoPath);
if (mediaRulesText.includes("30 seconds")) offendingFiles.push(mediaRulesPath2);
if (offendingFiles.length > 0) {
  fail(
    "C9",
    `"30 seconds" literal must not appear in: ${offendingFiles.join(", ")}`,
  );
} else {
  ok("C9", `"30 seconds" literal is dead in eventCoverNativeVideo.ts + eventCoverMediaRules.ts`);
}
```

Both checks placed after the existing C7 block, before the final `if (process.exitCode && process.exitCode !== 0)` exit-code propagation.

### E — Success criteria (numbered, observable, testable)

| ID | Criterion |
|---|---|
| **SC-AMEND7-1** | Upload a video on a published event with NULL cover. Tap Save changes + enter reason + confirm. Reopen the event. `events.cover_media_url` is the processed Cloudinary URL (non-null). User sees the new cover. |
| **SC-AMEND7-2** | Same flow as SC-AMEND7-1 but tap Remove cover instead. After save, `events.cover_media_url` is NULL AND `events.cover_media_type` is NULL AND all 5 metadata columns are NULL. |
| **SC-AMEND7-3** | A patch shape with metadata-only changes (e.g., coverMediaAlt set but coverMediaUrl undefined) skips the cover service call. `console.warn("[ORCH-0978]", "metadata-only cover patch skipped...")` fires (visible in Metro logs). |
| **SC-AMEND7-4** | If `setEventCover` is mocked to return a row with `cover_media_url` different from the `mediaUrl` passed in, `EventCoverMediaError("persist_mismatch", ...)` is thrown and toast "Save succeeded but the cover did not persist. Refresh and try again." appears. |
| **SC-AMEND7-5** | `setEventCover(serverEventId, mediaUrl: null, ...)` is a TypeScript compile-time error. The `mediaUrl: string` (NOT `string | null`) parameter type forbids null at the type system level. |
| **SC-AMEND7-6** | `mingla-business/src/utils/eventCoverNativeVideo.ts` AND `mingla-business/src/utils/eventCoverMediaRules.ts` contain zero occurrences of the literal `"30 seconds"`. Toast wording matches `"Please trim to 29 seconds first."`. |
| **SC-AMEND7-7** | `useEventCoverVideoUpload.ts` invokes `createEventCoverVideoUploadIntent` with `trimStartMs: 0, trimEndMs: compressed.durationMs`. Metro log line `upload-intent-request` includes `trimStartMs: 0, trimEndMs: <duration>` (not `undefined`). |
| **SC-AMEND7-8** | Strict-grep gates C1-C9 all PASS (`node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs`). Existing ORCH-0863 backend allowlist gate stays green (no `supabase/functions/` touch in this commit). |

### F — Invariants (preserved + new)

**Preserved:**
- Webhook v122 `verify_jwt = false` — N/A (this SPEC is client-only).
- AMENDMENT 6 invariants (webhook duration fallback) — unchanged.
- AMENDMENT 5 invariants (webhook public_id job_id recovery) — unchanged.
- META-ORCH-0744 two-commit landing — product commit then test commit with fails-on-revert proof.

**NEW invariant introduced (proposed):**

**I-PROPOSED-NO-COVER-NULL-IMPLICIT-WRITE** — A cover service function MUST NOT accept `mediaUrl: string | null` and write null based on a falsy check. Setting a cover requires `mediaUrl: string` (non-null TS type). Clearing a cover requires invoking an explicit clear function. The implicit-null-write bug class is structurally impossible after this SPEC ships. Backed by:
- Strict-grep C8 (dead `updatePublishedEventCoverMedia` literal + presence of both new exports).
- Service tests T-AMEND7-01 + T-AMEND7-02.
- Constitution rule 3 (no silent failures): F-4 from investigation is structurally closed by round-trip verification in `setEventCover`.

Promote to ACTIVE on ORCH-0978 CLOSE.

### G — Test cases (8 scenarios)

| ID | Scenario | Input | Expected | Layer | Owner |
|---|---|---|---|---|---|
| **T-AMEND7-01** | `setEventCover` writes all 7 columns with non-null mediaUrl + round-trip succeeds | Mock Supabase: `.update().select().maybeSingle()` returns `{id, cover_media_url: <mediaUrl>, cover_media_type: <mediaType>}` | Function resolves (no throw); UPDATE payload has all 7 cover columns set; no `cover_media_url: null` write | Service unit test | Implementor (happy-path) |
| **T-AMEND7-02** | `clearEventCover` nulls all 7 columns | Mock Supabase: `.update().select().maybeSingle()` returns `{id}` | Function resolves; UPDATE payload sets all 7 cover columns to NULL | Service unit test | Implementor |
| **T-AMEND7-03** | `setEventCover` TypeScript-rejects null mediaUrl at compile time | `setEventCover(id, null as any, ...)` in a `// @ts-expect-error` comment line | TypeScript compile fails on the call site (verified by ensuring `tsc` errors when the `// @ts-expect-error` is removed) | TS unit / type-level | Implementor |
| **T-AMEND7-04** | `setEventCover` throws persist_mismatch on stub-returning-mismatched-row | Mock returns `{id, cover_media_url: null, ...}` despite mediaUrl="https://...mp4" | `EventCoverMediaError` thrown with `code: "persist_mismatch"` and the expected message | Service unit test | Implementor |
| **T-AMEND7-05** | `EditPublishedScreen` save flow calls `setEventCover` with non-null mediaUrl after video-ready emitChange | Render `EditPublishedScreen` with liveEvent having NULL cover; simulate `emitChange({coverMediaUrl: "https://x.mp4", coverMediaType: "video", ...})`; trigger `handleConfirmSave("reason ≥ 10 chars")` | `setEventCover` called once with `mediaUrl="https://x.mp4"` and `mediaType="video"`; `clearEventCover` NOT called; no toast about failure | Component integration test (Jest + Testing Library) | **Tester (adversarial — closes the actual physical-iPhone repro)** |
| **T-AMEND7-06** | Metadata-only patch skips the cover service entirely | Render with liveEvent having coverMediaUrl="https://existing"; simulate `updateDraft({coverMediaAlt: "new alt"})`; trigger save | Neither `setEventCover` nor `clearEventCover` called; `console.warn` with `[ORCH-0978]` + "metadata-only cover patch skipped" fires; save proceeds to next block | Component integration test | Implementor |
| **T-AMEND7-07** | Explicit Remove → `clearEventCover` invoked | Render with liveEvent having existing cover; simulate `handleRemoveCover()` (which emits all-null patch); trigger save | `clearEventCover` called once with serverEventId; `setEventCover` NOT called | Component integration test | Implementor |
| **T-AMEND7-08** | Persist-mismatch surfaces user-visible toast | Render save flow; mock `setEventCover` to throw `EventCoverMediaError("persist_mismatch", ...)` | Toast "Save succeeded but the cover did not persist. Refresh and try again." appears; submitting state cleared | Component integration test | Tester adversarial |

**META-ORCH-0744 mapping:**
- **Implementor happy-path:** T-AMEND7-05 (the most direct exercise of the bug — render → emitChange → save → assert setEventCover called with non-null URL). Implementor writes; lands in Commit 2; fails-on-revert at the product commit hash (assert fails before the rewrite, passes after).
- **Tester adversarial:** T-AMEND7-08 (attacks the silent-failure surface from a different angle — verifies that even when persistence FAILS the user sees a truthful toast). Tester writes during RETEST; lands as the tester's commit before PR. Different angle = error-surface verification vs happy-path persistence verification.

Both must include `fails-on-revert verified at <commit hash>` lines.

### H — Implementation order (binding two-commit pattern per META-ORCH-0744)

**Commit 1 — product fix (~150 net lines across 8 files):**
1. `mingla-business/src/services/eventCoverMediaService.ts`: delete `updatePublishedEventCoverMedia` (lines 180-222); add `setEventCover` (~50 lines) + `clearEventCover` (~30 lines); extend `EventCoverMediaErrorCode` union to include `"persist_mismatch"`.
2. `mingla-business/src/components/event/EditPublishedScreen.tsx`: replace lines 617-674 with the new conditional tree from §D.2 (~75 lines including the metadata-only warn branch); update the import at line 108 to remove `updatePublishedEventCoverMedia`, add `setEventCover` + `clearEventCover`.
3. `mingla-business/src/hooks/useEventCoverVideoUpload.ts`: extend lines 92-100 with `trimStartMs: 0` and `trimEndMs: compressed.durationMs` per §D.4.
4. `mingla-business/src/utils/eventCoverNativeVideo.ts` line 62: 30 → 29.
5. `mingla-business/src/utils/eventCoverMediaRules.ts` lines 318 + 343: 30 → 29 (two places).
6. `mingla-business/src/utils/__tests__/serverDraftLifecycleGuards.test.ts` line 352: update assertion to look for `setEventCover(` or `clearEventCover(` rather than `updatePublishedEventCoverMedia(`. Land in Commit 1 to keep the existing test green.
7. `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs`: append C8 + C9 per §D.6.
8. (Optional Item 8) `mingla-business/src/components/event/EditPublishedScreen.tsx` line ~407: add `console.log("[ORCH-0978-DIAG]", "save-patch", JSON.stringify(patch));` immediately after `const patch = currentPatch;` inside `handleSavePress`. Implementor decides whether to include — orchestrator reaps at CLOSE Step 1.5 if present.

Commit message prefix: `ORCH-0978 IMPLEMENT-5 step 1: split eventCoverMediaService into setEventCover + clearEventCover; tighten EditPublishedScreen cover-save guard with round-trip verification; wire trim values through upload-intent; replace 3 stale "30 seconds" strings`.

**Commit 2 — Jest regression tests (~200 net lines, 2 test files):**
1. `mingla-business/src/services/__tests__/eventCoverMediaService.setClearSplit.test.ts` — NEW. Scenarios T-AMEND7-01, T-AMEND7-02, T-AMEND7-03 (TS expect-error), T-AMEND7-04.
2. `mingla-business/src/components/event/__tests__/EditPublishedScreen.coverPersistence.test.tsx` — NEW. Scenarios T-AMEND7-05, T-AMEND7-06, T-AMEND7-07.
3. (Tester adds T-AMEND7-08 during RETEST commit — different scope, different commit. Tester also commits the fails-on-revert proof for their own test.)

**Fails-on-revert proof (mandatory):**

| Phase | Action | Expected |
|---|---|---|
| PASS on fixed code | `cd mingla-business && npm test -- --testPathPattern="(setClearSplit\|coverPersistence)"` at Commit 1 hash | 7/7 PASS (T-AMEND7-01 through T-AMEND7-07) |
| FAIL with rewrite reverted | Temporarily revert `EditPublishedScreen.tsx` lines 617-end of replacement block back to the old `mediaPatchPresent + updatePublishedEventCoverMedia` shape (do NOT commit); re-run | T-AMEND7-05 + T-AMEND7-07 FAIL because `setEventCover` / `clearEventCover` were never called (the old code called the now-removed `updatePublishedEventCoverMedia`). T-AMEND7-06 may pass or fail depending on revert depth. |
| PASS restored | Re-apply rewrite; re-run | 7/7 PASS |

Document all three phases verbatim in the implementation report per IMPLEMENT-3 + IMPLEMENT-4 precedent.

### I — Regression prevention

1. **Strict-grep C8** (Item 6) makes "future engineer re-introduces `updatePublishedEventCoverMedia` symbol" or "removes one of the new exports" impossible to ship.
2. **Strict-grep C9** (Item 6) makes "future engineer adds a `30 seconds` string back" impossible to ship.
3. **T-AMEND7-05 fixture** (the actual physical-iPhone repro shape — published event + NULL cover + video upload + save) is the canonical regression fixture for the F-1 bug class. Locks the behavior.
4. **`setEventCover`'s TypeScript signature** (`mediaUrl: string` not `string | null`) makes the bug class structurally impossible at the type system level — the implicit-null-write bug cannot recur.
5. **Round-trip verification in `setEventCover`** (the `if (data.cover_media_url !== mediaUrl) throw persist_mismatch`) closes the silent-failure surface — any future regression that produces a DB write mismatch will surface as a toast, not a silent success.
6. **New invariant I-PROPOSED-NO-COVER-NULL-IMPLICIT-WRITE** (promotes to ACTIVE on CLOSE) — documents the pattern for any future cover-like service (e.g., a future "brand cover" or "trip cover" rewrite — see Discoveries §J).

### J — Cross-Surface Impact closing summary

Business iOS + Android (shared bundle) — automatic parity. No backend touch (no edge function source change, no migration). Orchestrator does NOT need to batch-redeploy edge functions after this PR. Tester runs T-AMEND7-05/06/07/08 on the iOS sim; Seth re-validates the physical iPhone path with the exact 16s-video-on-published-event flow from his 2026-05-27 test.

### K — Deploy discipline

**No edge function redeploy.** All six event-cover-video functions stay at current versions (webhook v122, upload-intent v96, source-uploaded v83, status v95, apply v93, cancel v93).

**No `supabase db push`.** No migrations.

**EAS OTA at CLOSE:** Required. `mingla-business/src/` is touched in 6 files. CLOSE commit MUST include `[deploy]` tag for the Vercel gate (because `mingla-business/` is a Next.js + React Native universal bundle and the Vercel side ships the web preview). Per orchestrator skill Step 2.5.

**Pre-merge gate at CLOSE:** Standard — checks green + conflicts clean + reviews approved + not behind. No exemption.

### L — Downstream routing

- Forensics returns SPEC → orchestrator REVIEW (commit-hash verification + dependency walk per DEC-179).
- Orchestrator dispatches IMPLEMENT-5 to Codex `implementor-mingla` (default) or Claude `mingla-implementor`.
- Implementor returns with Commit 1 + Commit 2 + implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0978_IMPLEMENT_5.md`.
- Orchestrator REVIEWs IMPLEMENT-5. NO edge function redeploy. NO `supabase db push`.
- Tester (Codex `tester-mingla` or Claude `mingla-tester`) live-fire RETEST on iOS sim:
  - T-AMEND7-05 (upload video → save → cover persists)
  - T-AMEND7-06 (metadata-only patch skipped)
  - T-AMEND7-07 (remove → clearEventCover invoked)
  - T-AMEND7-08 (persist-mismatch surfaces toast — tester writes the test as their adversarial regression per META-ORCH-0744)
  - Plus strict-grep C1-C9 all green
  - Plus Item 5 visual verification (toast text on the sim says "29 seconds" not "30 seconds")
- Pause for Seth's physical iPhone re-validation: open A life in vegas → Cover → Upload 16s video → Save changes → reopen → cover renders.
- After both PASS → orchestrator CLOSE with `[deploy]` tag + EAS OTA iOS+Android publish + PR open + pre-merge gate + squash merge + worktree reap. Closes the ORCH-0978 ORCH end-to-end (backend AMENDMENT 4-5-6 + client AMENDMENT 7 all merged).

### M — Confidence — HIGH

Investigation's PROBABLE root cause + named blocker is binding-grade for SPEC; the fix direction is unambiguous regardless of which client sub-mechanism produces the bad patch shape (the new contract structurally prevents the bug). Service split + round-trip verification + strict-grep + Jest fixture cover the bug class from 4 angles. TypeScript signature change makes regression compile-time impossible. Two-commit landing pattern is well-rehearsed (4 prior IMPLEMENT phases in this ORCH). Scope is tightly bounded — client-only, no backend touch, no migration, no rollback risk to any prior IMPLEMENT phase. ~150 net product lines + ~200 net test lines across 8 files. Optional Item 8 DIAG console.log gives the implementor a clean PROBABLE→PROVEN upgrade path inside Commit 1 without expanding scope.

---

## SPEC AMENDMENT 8 (a.k.a. AMENDMENT 6 in operator language) — 2026-05-28 — Generous source / tight processed: stop rejecting normally-trimmed clips for iOS keyframe overshoot

**Author:** Claude `mingla-forensics` (INVESTIGATE-then-SPEC mode)
**Binding input:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0978_KEYFRAME_OVERSHOOT.md` (committed this turn; root cause **PROBABLE** with named live-fire blocker — Business Metro offline + simulator trimmer-fidelity uncertainty; runtime evidence = Seth's physical-device `:447` toast which fires only when `durationMs > 29250`).
**Dispatch:** `Mingla_Artifacts/prompts/FORENSICS_INVESTIGATE_SPEC_ORCH-0978_AMENDMENT_8_KEYFRAME_OVERSHOOT.md`.
**Comms ledger acknowledged:** COMMS-0002 (new migration must be appended to `ORCH_0978_BACKEND_ALLOWLIST` in the IMPLEMENT-6 commit) + COMMS-0003 (Cloudinary `du_` docs URL cited inline).

### A — Layman summary

Today a user can pick a long video, use the iOS trim screen to cut it to ~29 seconds, tap Choose — and Mingla still says "Please trim to 29 seconds first." even though they trimmed correctly. The cause: iOS's trim screen snaps the cut to the nearest keyframe, so a "29 second" trim often comes back as 29.4-30 seconds, which exceeds the app's hard 29.25-second ceiling. This amendment implements the operator-locked **"generous source / tight processed"** architecture: accept source clips up to **33 seconds** (so a normally-trimmed clip is never rejected for keyframe slop), keep the iOS trimmer aiming at 29 seconds, and **clamp the processed cover to ≤30 seconds server-side** so the final rendered cover is always sub-30. After ship, a user who trims to ~29s uploads successfully every time, and the cover that renders is still a tight sub-30-second clip. A genuinely un-trimmed long source (>33s) is still rejected with the same "trim first" message — which is now accurate because that is the only case where trimming is actually required.

### B — Scope and non-goals

**In scope (binding):**
1. Raise the **source-acceptance ceiling** from 29.25s → **33s** at the client picker check (`CoverPicker.tsx`) and the edge source-duration check (`upload-intent/index.ts`).
2. Introduce a new client constant `EVENT_COVER_SOURCE_CEILING_MS = 33_000` (distinct from the unchanged 29s trimmer-target constant).
3. **Clamp the persisted `trim_end_ms`** at the edge to the processed cap (`MAX_DURATION_MS` = 30000) BEFORE `validateTrimRange` + job insert + `du_`, so the source overshoot never reaches the processed budget or the DB constraint. Store the raw source duration in `source_duration_ms` (the generous record).
4. New DB migration raising the `trim_end_ms - trim_start_ms` and `processed_duration_ms` CHECK constraints from `≤ 29000` → `≤ 30000` (so the clamped trim window is legal and processed stays tight).
5. Revise strict-grep `orch-0978-video-cap-29s.mjs` C1-C9 (the cap-value checks need REVISION, not just addition) + add new checks C10/C11 enforcing the two-tier source-ceiling-vs-processed-cap relationship.
6. Update the existing AMENDMENT-4 Deno boundary test (`duration-cap.test.ts`) to the new 33s ceiling (REQUIRES `[TEST-MOD-APPROVED ORCH-0978]` in the commit body per `feedback_close_commit_precommit_checks.md`).
7. Append the new migration to `ORCH_0978_BACKEND_ALLOWLIST` (COMMS-0002, same commit).

**Non-goals (explicit out-of-scope):**
- The iOS picker `videoMaxDuration` stays **29** (trimmer target). NOT raised — see Decision 1.
- `_shared/eventCoverVideo.ts` is **NOT touched** (the `MAX_DURATION_MS` = 30000 constant already serves correctly as the processed/trim-window cap once `trim_end_ms` is clamped to it). Therefore the AMENDMENT-6 §K "batch redeploy all six functions because `_shared` is touched" rule does NOT apply — only `event-cover-video-upload-intent` is redeployed.
- The storage-bucket video validation path (`eventCoverMediaRules.ts` → `validateEventCoverAsset`) stays at the 29s cap — the Cloudinary video-upload path (the one with the keyframe-overshoot bug) does not flow through it. Raising it is a separate concern (Discovery §K).
- The duplicate `EVENT_COVER_MAX_VIDEO_DURATION_MS` declaration (AMENDMENT 4 §J-bis) is NOT consolidated here.
- HLS/sp_auto, Cloudinary RN SDK, webhook architecture — unchanged.
- No client trim-UI rebuild; no consumer/admin changes.

**Assumptions:**
- Greenfield: AMENDMENT 2 probe confirmed ZERO production video covers / Cloudinary URLs. The migration's pre-flight `RAISE EXCEPTION` guard will see zero offending rows. (Implementor re-probes pre-apply.)
- iOS keyframe overshoot on a 29s trim target is bounded at ≤ ~2s for real iPhone footage (synthetic 2.0s-GOP demonstration → 1000ms snap; 4K Dolby Vision HDR can be sparser). **33s source ceiling = 29s target + ~4s headroom**, comfortably absorbing the worst realistic overshoot. Confirmed against the operator's ~33s target.
- `Math.min(rawTrimEnd, 30000)` is the correct clamp: a normally-trimmed iOS clip (content ~29.x s) keeps its full content (`du_` is a Cloudinary hard ceiling, not a forced length, so a 29.4s clip stays 29.4s — sub-30); only a pathological un-trimmed 30-33s source (reachable only via web/Android no-trim) is capped to exactly 30s.

### C — Cross-Surface Impact (MANDATORY per Phase 2.5)

| Surface | In scope? | User-visible behaviour the SPEC demands | File paths touched on this surface | Parity |
|---|---|---|---|---|
| Consumer iOS (`app-mobile/`) | NO | N/A — consumer app does not author covers | None | N/A |
| Consumer Android (`app-mobile/`) | NO | N/A | None | N/A |
| Buyer/anonymous Web | NO | reads processed cover URLs unchanged | None | N/A |
| **Business iOS** (`mingla-business/`) | **YES (primary)** | Trim a long video to ~29s → upload SUCCEEDS (no false "trim to 29 seconds" rejection); processed cover renders sub-30s | `mingla-business/src/components/ui/CoverPicker.tsx`, `mingla-business/src/services/eventCoverVideoProcessingService.ts`, `supabase/functions/event-cover-video-upload-intent/index.ts` (edge), new migration | Shared client bundle + shared backend → **automatic** |
| **Business Android** (`mingla-business/`) | **YES** | Same as iOS (best-effort native trim; same client + edge + DB path) | Same files | **Automatic** (same bundle) |
| Admin Web (`mingla-admin/`) | NO | N/A — admin does not author covers | None | N/A |
| Business Web preview (`mingla-business/` web) | YES (incidental) | Web has no native trim; a >33s raw pick hits the same client check with the same "trim first" copy. A 30-33s web source → cover capped at exactly 30s (du_ ceiling). | Same files (shared) | **Automatic** |

**Parity is automatic** (business iOS/Android/Web share the client `mingla-business/src/` bundle and the single backend path). No per-surface SC split required. Sub-30 holds strictly for the in-scope native-picker surfaces (iOS/Android force a ~29s trim); the only exactly-30s edge is a pathological 30-33s un-trimmed web source.

### D — Decisions (operator architecture is locked; these resolve the implementation specifics)

**Decision 1 — `videoMaxDuration` stays 29 (do NOT raise).**
`launchImageLibraryAsync({ videoMaxDuration: 29, allowsEditing: true })` makes iOS present the native trim UI for any source >29s and aims the trim window at 29s. Raising `videoMaxDuration` would let the user keep a longer slice → larger processed cover, defeating "tight processed", and would NOT remove the trim prompt (the prompt IS the `videoMaxDuration` enforcement, not a separate "too long" error). The operator wants the trimmer target at ~29s so the processed cover is small. **KEEP `videoMaxDuration: 29` (`CoverPicker.tsx:429`) unchanged.** The "Video Too Long to Send"-style sheet observed on the simulator is Apple's standard entry into the trim UI for `videoMaxDuration`-constrained library picks; it is expected and benign. Cite: [Expo ImagePicker `videoMaxDuration` — https://docs.expo.dev/versions/latest/sdk/imagepicker/#imagepickeroptions] (seconds, integer, iOS+Android best-effort).

**Decision 2 — Source ceiling = 33000 ms.** 29000 trimmer target + ~4000ms headroom absorbs the worst realistic iOS keyframe overshoot (synthetic 2.0s-GOP → 1000ms; sparser GOP 4K HDR → up to ~2s). Confirms the operator's ~33s target.

**Decision 3 — Processed cap = 30000 ms (the existing `MAX_DURATION_MS`).** `trim_end_ms` is clamped to this, `du_` is bounded by this, the DB processed constraint is this, and `assertProcessedDerivative` backstops at this. No `_shared` change needed — `MAX_DURATION_MS` simply stops being ambiguous once the source ceiling is a separate constant.

**Decision 4 — Clamp `trim_end_ms` at the EDGE (trust boundary), not the client.** The edge clamps `trimEndMs = Math.min(rawTrimEndMs, MAX_DURATION_MS)` so a bypassed/older client cannot push an over-cap trim window into the DB or `du_`. The client continues to send the raw `compressed.durationMs` as `trimEndMs` (no client change to the hook). `source_duration_ms` stores the raw value (generous record); `trim_end_ms` stores the clamped value (tight processed window).

### E — Layered specification (exact values + every cap-chain change)

#### E.1 — Client picker (`mingla-business/src/components/ui/CoverPicker.tsx`)

**E.1.a — Acceptance check (line 441).**
Current:
```ts
if (durationMs > EVENT_COVER_MAX_VIDEO_DURATION_MS + 250) {
```
Becomes:
```ts
if (durationMs > EVENT_COVER_SOURCE_CEILING_MS) {
```
- `EVENT_COVER_SOURCE_CEILING_MS` imported from `../../services/eventCoverVideoProcessingService` (alongside the existing `EVENT_COVER_MAX_VIDEO_DURATION_MS` import).
- The `[ORCH-0978-TRIM]` `console.log` at lines 442-446 stays **unchanged** — it keeps logging `capMs: EVENT_COVER_MAX_VIDEO_DURATION_MS` (29000) and `overshoot: durationMs - EVENT_COVER_MAX_VIDEO_DURATION_MS`, so field logs still report overshoot magnitude relative to the 29s trimmer target. (This is the diagnostic the tester captures to upgrade the root cause to `proven`.)
- The rejection toast copy at line 447 stays **"Please trim to 29 seconds first."** — now only fires for a genuinely un-trimmed source >33s, where "trim first" is accurate.
- `videoMaxDuration: 29` (line 429) UNCHANGED (Decision 1).

#### E.2 — Client constants (`mingla-business/src/services/eventCoverVideoProcessingService.ts`)

- KEEP line 17 `export const EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000;` (trimmer target + "29 seconds" messaging reference).
- ADD: `export const EVENT_COVER_SOURCE_CEILING_MS = 33_000;` (the generous source-acceptance ceiling; mirrors the edge `SOURCE_CEILING_MS`). Place adjacent to the existing duration constants (line 17-19 block).
- KEEP `EVENT_COVER_MAX_SOURCE_VIDEO_DURATION_MS = 60_000` (line 19) — outer defense bound, still > 33000.
- Copy constant `EVENT_COVER_VIDEO_PROCESSING_COPY` (line 20-21) stays "29 seconds" (trimmer target).

#### E.3 — Edge source ceiling (`supabase/functions/event-cover-video-upload-intent/index.ts`)

**E.3.a — Constant (line 17).**
Current: `export const EFFECTIVE_TRIM_CEILING_MS = 29_250;`
Becomes: `export const SOURCE_CEILING_MS = 33_000;`
The old `EFFECTIVE_TRIM_CEILING_MS` literal must be fully removed (no alias).

**E.3.b — Source-duration check (lines 144-156).**
Replace `EFFECTIVE_TRIM_CEILING_MS` with `SOURCE_CEILING_MS` in the condition, the `logWarn` `ceiling` field, and the 422 response `detail.ceilingMs`:
```ts
if (sourceDurationMs > SOURCE_CEILING_MS) {
  logWarn(requestId, "duration_over_cap", { ceiling: SOURCE_CEILING_MS, sourceDurationMs });
  return jsonResponse(
    { error: "duration_over_cap", detail: { sourceDurationMs, ceilingMs: SOURCE_CEILING_MS } },
    422,
  );
}
```
This check validates the RAW `sourceDurationMs` (generous). It stays positioned after the existing `MAX_SOURCE_VIDEO_DURATION_MS` (60000) outer bound (no regression — 33000 < 60000, strictly tighter than the outer guard but more generous than the old 29250).

**E.3.c — Trim-window clamp (lines 123-124) — THE KEY ARCHITECTURAL PIECE.**
Current:
```ts
const trimStartMs = Number(body.trimStartMs ?? 0);
const trimEndMs = Number(body.trimEndMs ?? sourceDurationMs);
```
Becomes:
```ts
const trimStartMs = Number(body.trimStartMs ?? 0);
const rawTrimEndMs = Number(body.trimEndMs ?? sourceDurationMs);
// Clamp the persisted/processed trim window to the tight processed cap so iOS keyframe
// overshoot in the SOURCE never reaches du_, the DB constraint, or validateTrimRange.
// Generous source (up to SOURCE_CEILING_MS) is recorded in source_duration_ms; the
// processed window stays <= MAX_DURATION_MS. (ORCH-0978 AMENDMENT 8.)
const trimEndMs = Math.min(rawTrimEndMs, MAX_DURATION_MS);
```
`MAX_DURATION_MS` is already imported (line 7). Because `trimEndMs` is now clamped to ≤ 30000 BEFORE `validateTrimRange` (line 157) and the job insert (line 240):
- `validateTrimRange` (`_shared:366`, `trimEndMs - trimStartMs > MAX_DURATION_MS`) always passes (clamped ≤ 30000).
- `validateTrimRange` (`_shared:369-374`, `trimEndMs > sourceDurationMs + 250`) always passes (clamp ≤ raw source).
- The job insert stores `trim_end_ms ≤ 30000` → legal under the new DB constraint.
- The `du_` budget at line 266 (`Math.min(trimEndMs - trimStartMs, MAX_DURATION_MS)`) is now ≤ 30000 → `du_${ceil(...)}` ≤ 30 (Cloudinary hard ceiling; real content ~29.x s stays sub-30). No change to line 266-272 required; it remains correct. Cite: [Cloudinary `du_` video transformation parameter — https://cloudinary.com/documentation/video_manipulation_and_delivery_reference#video_transformation_url_parameters] (du_ sets a maximum duration limit on the output).

#### E.4 — `_shared/eventCoverVideo.ts` — NO CHANGE

`MAX_DURATION_MS` stays 30000 and now unambiguously means "processed / trim-window cap". `validateTrimRange` and `assertProcessedDerivative` keep using it correctly because the edge clamps `trim_end_ms` to it before validation. **This file is NOT touched** → AMENDMENT-6 §K batch-redeploy-all-six rule does NOT trigger; only `upload-intent` redeploys (Decision in §I).

#### E.5 — Database migration (NEW)

**File:** `supabase/migrations/20260730000001_orch_0978_video_cap_generous_source.sql`
(Next slot after the existing `20260730000000`; highest timestamp across all worktrees verified = `20260730000000`.)

**Pre-flight invariant probe (mandatory — migration backstop):**
```sql
DO $$
DECLARE
  offending_count int;
BEGIN
  -- Existing <=29000 constraints guarantee no rows exceed 29000, so any row >30000 is
  -- impossible. Probe defensively for drift before loosening to 30000.
  SELECT count(*) INTO offending_count
  FROM public.event_cover_video_jobs
  WHERE (trim_end_ms - trim_start_ms) > 30000
     OR (processed_duration_ms IS NOT NULL AND processed_duration_ms > 30000);

  IF offending_count > 0 THEN
    RAISE EXCEPTION 'orch-0978 amendment 8 pre-flight: % rows exceed 30000ms cap; data repair runbook required before migration', offending_count;
  END IF;
END $$;
```

**Migration body:**
```sql
ALTER TABLE public.event_cover_video_jobs
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_trim_max_duration;
ALTER TABLE public.event_cover_video_jobs
  DROP CONSTRAINT IF EXISTS event_cover_video_jobs_processed_max_duration;

ALTER TABLE public.event_cover_video_jobs
  ADD CONSTRAINT event_cover_video_jobs_trim_max_duration
    CHECK ((trim_end_ms - trim_start_ms) <= 30000);
ALTER TABLE public.event_cover_video_jobs
  ADD CONSTRAINT event_cover_video_jobs_processed_max_duration
    CHECK (processed_duration_ms IS NULL OR processed_duration_ms <= 30000);
```

**Post-migration self-verify probe (mandatory):**
```sql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname IN ('event_cover_video_jobs_trim_max_duration','event_cover_video_jobs_processed_max_duration')
    AND pg_get_constraintdef(oid) LIKE '%29000%'
  ) THEN
    RAISE EXCEPTION 'orch-0978 amendment 8 post-verify: stale 29000ms constraint still present after migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_cover_video_jobs_trim_max_duration'
    AND pg_get_constraintdef(oid) LIKE '%30000%'
  ) THEN
    RAISE EXCEPTION 'orch-0978 amendment 8 post-verify: 30000ms trim constraint not present after migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_cover_video_jobs_processed_max_duration'
    AND pg_get_constraintdef(oid) LIKE '%30000%'
  ) THEN
    RAISE EXCEPTION 'orch-0978 amendment 8 post-verify: 30000ms processed constraint not present after migration';
  END IF;
END $$;
```

**`source_duration_ms` note:** the migration does NOT add a constraint on `source_duration_ms` — the generous source ceiling (33000) is enforced at the edge (E.3.b) + the existing 60000 outer bound. Implementor MUST run a read-only probe pre-apply to confirm no pre-existing `source_duration_ms` constraint from ORCH-0770 would block 33000 (read `20260515000012_orch_0770_event_cover_video_processing.sql`); if one exists, add a drop+re-add to ≤ 33000 in this migration and surface to orchestrator.

**Apply command (operator owns `db push`):**
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]" && /Users/sethogieva/bin/supabase db push --linked
```
**Pre-apply check (orchestrator):**
```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]" && /Users/sethogieva/bin/supabase migration list --linked
```
Confirm no remote-only versions before approving operator apply.

#### E.6 — Strict-grep revision (`.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs`)

The existing C1-C9 assume "29 everywhere" — the cap-value checks need **REVISION**, not just addition.

- **C1 (videoMaxDuration: 29):** UNCHANGED (`videoMaxDuration` stays 29). ✓
- **C2 (processingService `EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000` present; `30_000` absent):** UNCHANGED. (The new `EVENT_COVER_SOURCE_CEILING_MS = 33_000` line does not contain the `= 30_000` literal, so C2 stays green.)
- **C3 (mediaRules `EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000`):** UNCHANGED (storage path stays 29s).
- **C4 (DB constraints):** **REVISE.** Update `migrationPath` (line 35-36) to the NEW migration `supabase/migrations/20260730000001_orch_0978_video_cap_generous_source.sql`. Change both regexes from `<= 29000` → `<= 30000`. Update the OK/FAIL messages from "29000" → "30000". (The old `20260730000000` migration remains in history with its 29000→drop sequence; the active constraint state is defined by the new migration.)
- **C5 (public_id template ↔ webhook parser):** UNCHANGED.
- **C6 (webhook `eagerDurationOrFallback` + `trim_end_ms`):** UNCHANGED.
- **C7 (discrete processed-duration codes + dead `processed_duration_invalid`):** UNCHANGED.
- **C8 (eventCoverMediaService split):** UNCHANGED.
- **C9 ("30 seconds" literal dead in the two utils files):** UNCHANGED. (AMENDMENT 8 introduces no "30 seconds"/"33 seconds" copy; all changes are numeric `30000`/`33_000` constants and the migration, none of which contain the string "30 seconds".)
- **NEW C10 (edge source ceiling + clamp):** assert `event-cover-video-upload-intent/index.ts` (a) contains `SOURCE_CEILING_MS = 33_000`, (b) does NOT contain the dead literal `EFFECTIVE_TRIM_CEILING_MS`, (c) contains the clamp `Math.min(rawTrimEndMs, MAX_DURATION_MS)`.
- **NEW C11 (client source ceiling + relationship):** assert `eventCoverVideoProcessingService.ts` contains `EVENT_COVER_SOURCE_CEILING_MS = 33_000`; assert `CoverPicker.tsx` references `EVENT_COVER_SOURCE_CEILING_MS` in the acceptance check and does NOT contain the old `+ 250` tolerance literal `EVENT_COVER_MAX_VIDEO_DURATION_MS + 250`; assert the relationship `33000 > 30000` (source ceiling strictly greater than processed cap) and `30000` (processed cap) is the tight value — a static invariant guard so a future edit cannot invert the two tiers.

Both new checks placed after C9, before the final exit-code propagation. Wire stays in `.github/workflows/strict-grep-mingla-business.yml` (existing job; no parallel workflow).

#### E.7 — Backend allowlist (COMMS-0002)

Append to `ORCH_0978_BACKEND_ALLOWLIST` in `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` (currently lines 887-899), in the SAME commit as the migration:
- `supabase/migrations/20260730000001_orch_0978_video_cap_generous_source.sql`

(`event-cover-video-upload-intent/index.ts` is already in the allowlist at line 897. The strict-grep `.mjs` files are under `.github/` and are not gated by the `no-new-backend-files` C7 check.)

### F — Success criteria (numbered, observable, testable)

| ID | Criterion |
|---|---|
| **SC-AMEND8-1** | A video trimmed at the iOS native trimmer to ~29s with realistic keyframe overshoot (reported duration 29251-33000 ms) UPLOADS successfully — no "Please trim to 29 seconds first." toast. (Live-fire: tester captures the `[ORCH-0978-TRIM]` overshoot value first to confirm the actual magnitude, then confirms acceptance.) |
| **SC-AMEND8-2** | The PROCESSED cover for SC-AMEND8-1 is sub-30s: `event_cover_video_jobs.processed_duration_ms < 30000` and the rendered cover plays a clip < 30s. |
| **SC-AMEND8-3** | A genuinely un-trimmed long source (>33000 ms reported duration) is still rejected: client shows "Please trim to 29 seconds first." OR (if client bypassed) edge returns 422 `duration_over_cap` with `detail.ceilingMs = 33000`. |
| **SC-AMEND8-4** | Edge boundary: a request with `sourceDurationMs: 33000` returns 200 + `jobId`; `sourceDurationMs: 33001` returns 422 `{error:"duration_over_cap", detail:{sourceDurationMs:33001, ceilingMs:33000}}`. |
| **SC-AMEND8-5** | Edge clamp: a request with `sourceDurationMs: 31000, trimEndMs: 31000` returns 200; the inserted job row has `source_duration_ms = 31000` AND `trim_end_ms = 30000` (clamped) AND the eager transformation string contains `du_30`. |
| **SC-AMEND8-6** | DB: post-migration `pg_constraint` probe returns `<= 30000` in BOTH `event_cover_video_jobs_trim_max_duration` and `event_cover_video_jobs_processed_max_duration`; zero rows match `%29000%`. |
| **SC-AMEND8-7** | Strict-grep C1-C11 all PASS (`node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs`). C4 reads the new migration and asserts 30000; C10/C11 assert the source-ceiling/clamp/relationship. |
| **SC-AMEND8-8** | Constants present + dead literals gone: `grep "EVENT_COVER_SOURCE_CEILING_MS = 33_000"` hits in `eventCoverVideoProcessingService.ts`; `grep "SOURCE_CEILING_MS = 33_000"` hits in `upload-intent/index.ts`; `grep "EFFECTIVE_TRIM_CEILING_MS"` returns ZERO matches under `supabase/functions/`; `videoMaxDuration: 29` still present exactly once in `CoverPicker.tsx`. |

### G — Invariants

**Superseded:**
- **I-PROPOSED-VIDEO-CAP-CONSISTENCY-29S** (AMENDMENT 4 §E) — "all layers agree at 29000." OBSOLETE. Mark superseded in INVARIANT_REGISTRY / DECISION_LOG at CLOSE.

**New (proposed — promote to ACTIVE on CLOSE):**
- **I-PROPOSED-VIDEO-CAP-GENEROUS-SOURCE-TIGHT-PROCESSED** — The video-cover pipeline maintains a two-tier cap: a generous SOURCE-acceptance ceiling (`EVENT_COVER_SOURCE_CEILING_MS` / edge `SOURCE_CEILING_MS` = 33000) strictly greater than the tight PROCESSED cap (`MAX_DURATION_MS` = 30000 = `du_` ceiling = DB `processed_duration_ms` constraint = DB `trim_end_ms - trim_start_ms` constraint). `trim_end_ms` MUST be clamped to the processed cap at the edge before persistence and `du_`. The iOS trimmer target (`videoMaxDuration` = 29) and the "29 seconds" user copy reference the trimmer target, NOT the acceptance ceiling. **CI gate:** strict-grep C1-C4 + C10 + C11. Any layer deviating (source ≤ processed, processed > 30000, missing clamp, `videoMaxDuration` ≠ 29) is a P0 violation.

**Preserved (must NOT regress):**
- AMENDMENT 6 webhook duration-fallback (reads `trim_end_ms` — now the clamped value, which is correct).
- AMENDMENT 7 cover-save persistence (`setEventCover`/`clearEventCover`).
- I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED (COMMS-0003): the `du_` Cloudinary docs URL is cited inline (E.3.c).
- Webhook `verify_jwt = false`; idempotency gates; race-handling supersede.

### H — Test cases (two-commit landing per META-ORCH-0744)

| ID | Scenario | Input | Expected | Layer | Owner |
|---|---|---|---|---|---|
| **T-AMEND8-01** | **Edge accepts overshoot source + clamps trim.** | POST `{ sourceDurationMs: 31000, trimEndMs: 31000, trimStartMs: 0, ...valid }` | 200 + jobId; inserted row `source_duration_ms=31000`, `trim_end_ms=30000`; eager string contains `du_30` | Deno (edge) | **Implementor (happy-path)** |
| **T-AMEND8-02** | **Edge source-ceiling boundary.** | (a) `sourceDurationMs: 33000` (b) `sourceDurationMs: 33001` | (a) 200 + jobId; (b) 422 `{error:"duration_over_cap", detail:{sourceDurationMs:33001, ceilingMs:33000}}` | Deno (edge) | **Tester (adversarial)** |
| **T-AMEND8-03** | **Client acceptance ceiling.** | Jest: `pickVideoCover` with mocked picker returning `asset.duration = 30.5` (30500ms) | No "trim to 29 seconds" toast; `videoUpload.start` invoked. With `asset.duration = 34` (34000ms): toast fires, `start` NOT invoked. | Jest (client) | Implementor |
| **T-AMEND8-04** | **Normal-trim happy path unchanged.** | `sourceDurationMs: 29400, trimEndMs: 29400` | 200; `trim_end_ms=29400` (≤30000, not clamped); `du_30` ceiling; processed content stays 29.4s (sub-30) | Deno (edge) | Implementor |
| **T-AMEND8-05** | **Live-fire (PROBABLE→PROVEN upgrade).** Real iOS picker → trim a >29s clip to ~29s → Choose. Capture `[ORCH-0978-TRIM]` Metro log; confirm acceptance. | Injected 35s/2.0s-GOP clip (or Seth's physical repro) | Metro logs the `overshoot` value; upload succeeds; job reaches `ready`; cover renders sub-30s | Live-fire | Tester (sim) + Seth (physical) |
| **T-AMEND8-06** | **Strict-grep C1-C11.** | `node .github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` | All PASS | CI | Implementor |

**META-ORCH-0744 mapping:** implementor happy-path = **T-AMEND8-01** (clamp + accept), tester adversarial = **T-AMEND8-02** (boundary rejection). Both land with `fails-on-revert verified at <commit hash>`:
- T-AMEND8-01 fails-on-revert: temporarily revert the E.3.c clamp (`const trimEndMs = Number(body.trimEndMs ?? sourceDurationMs)`) → the 31000 trim window trips `validateTrimRange` (`trim_over_duration` 422) so the test's expected 200 fails. Restore → PASS.
- T-AMEND8-02 fails-on-revert: temporarily leave `EFFECTIVE_TRIM_CEILING_MS = 29_250` → `sourceDurationMs: 31000`/`33000` would 422 (over old ceiling) so the test's expected 200 on the in-range case fails. Restore → PASS.

**TEST-MOD note:** the existing AMENDMENT-4 boundary test `supabase/functions/event-cover-video-upload-intent/__tests__/duration-cap.test.ts` asserts `29250→200` / `29251→422`. The `29251→422` assertion is now WRONG (29251 < 33000 → 200). The implementor MUST update it to the new 33000 boundary (or fold it into T-AMEND8-02). Because this MODIFIES an existing test's assertions, the IMPLEMENT-6 commit body MUST include **`[TEST-MOD-APPROVED ORCH-0978]`** per `feedback_close_commit_precommit_checks.md`.

### I — Implementation order + deploy discipline

**Commit 1 — product fix (~12 net lines across 3 files + 1 new migration):**
1. `mingla-business/src/services/eventCoverVideoProcessingService.ts`: add `EVENT_COVER_SOURCE_CEILING_MS = 33_000`.
2. `mingla-business/src/components/ui/CoverPicker.tsx`: acceptance check → `> EVENT_COVER_SOURCE_CEILING_MS`; import the constant; keep `videoMaxDuration: 29`, the `[ORCH-0978-TRIM]` log, and the toast copy.
3. `supabase/functions/event-cover-video-upload-intent/index.ts`: `EFFECTIVE_TRIM_CEILING_MS` → `SOURCE_CEILING_MS = 33_000` (constant + check); add the E.3.c trim clamp.
4. `supabase/migrations/20260730000001_orch_0978_video_cap_generous_source.sql` (NEW, per E.5).
5. `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs`: C4 revision + C10 + C11.
6. `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`: append the new migration to `ORCH_0978_BACKEND_ALLOWLIST` (COMMS-0002).
- Commit prefix: `ORCH-0978 IMPLEMENT-6 step 1: generous source (33s) / tight processed (30s) cap split + edge trim clamp + DB constraints 29s→30s + strict-grep C4/C10/C11 [TEST-MOD-APPROVED ORCH-0978]`.

**Commit 2 — tests:**
7. `supabase/functions/event-cover-video-upload-intent/__tests__/duration-cap.test.ts`: update boundary to 33000 + add T-AMEND8-01/02/04 (Deno). 
8. `mingla-business/src/components/ui/__tests__/` (or hook test): add T-AMEND8-03 (Jest client acceptance ceiling).
9. Fails-on-revert proofs (§H) documented in the IMPLEMENT-6 report.

**Deploy discipline:**
- `_shared/eventCoverVideo.ts` NOT touched → NO batch redeploy. Deploy ONLY `event-cover-video-upload-intent`:
  ```bash
  cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]" && /Users/sethogieva/bin/supabase functions deploy event-cover-video-upload-intent --project-ref gqnoajqerqhnvulmnyvv
  ```
  Confirm `verify_jwt` stays `true` (auth-gated) via `mcp__supabase__list_edge_functions`.
- Per `feedback_supabase_edge_deploy_verify_first_call.md`, one curl probe post-deploy:
  ```bash
  curl -sS -o /dev/null -w "HTTP %{http_code}\n" -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/event-cover-video-upload-intent" -H "Content-Type: application/json" -d '{}'
  ```
  Expected: HTTP 401 (auth-gated, `verify_jwt=true` rejects the unauthenticated probe) — NOT 404. (Confirms bundle live.)
- Migration: operator `db push` (E.5) after orchestrator pre-apply `migration list` check.
- EAS OTA at CLOSE (`mingla-business/src/` touched) + `[deploy]` tag (Vercel web gate).

### J — Downstream routing

Forensics returns INVESTIGATION + SPEC AMENDMENT 8 → orchestrator **REVIEW** (commit-hash verification + dependency walk; confirm the cap-tier relationship + C4/C10/C11 logic) → orchestrator dispatches **IMPLEMENT-6** to Codex `implementor-mingla` (or Claude `mingla-implementor`) → implementor returns Commit 1 + Commit 2 + report `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0978_IMPLEMENT_6.md` → orchestrator REVIEW → operator `db push` → orchestrator redeploy `upload-intent` + curl probe → **tester live-fire RETEST** (T-AMEND8-05: trim a long video; capture `[ORCH-0978-TRIM]`; confirm sub-30 processed) → **Seth physical-iPhone re-validation** (Metro URL provided per `feedback_physical_iphone_test_handoff_provides_metro_url.md`) → orchestrator **CLOSE** with `[deploy]` tag + EAS OTA + PR + pre-merge gate + squash merge + worktree reap.

### K — Discoveries for Orchestrator

1. **Two un-mapped cap sites** found in investigation (`_shared:366` `validateTrimRange` trim-window bound + `:369-374` source bound). Layer 11 shares `MAX_DURATION_MS`; handled by the edge clamp (no `_shared` change needed).
2. **`I-PROPOSED-VIDEO-CAP-CONSISTENCY-29S` is obsolete** — mark superseded in INVARIANT_REGISTRY + DECISION_LOG at CLOSE; record the new two-tier invariant.
3. **Storage-bucket video validation** (`eventCoverMediaRules.ts`) stays at 29s — if video ever routes through `validateEventCoverAsset`, it will reject the same overshoot. Register a follow-up if that path is reactivated for video.
4. **Duplicate-constant debt** (AMENDMENT 4 §J-bis) persists; the consolidation cleanup ORCH is still recommended.
5. **Business Metro tunnel offline** — restart before any IMPLEMENT-6 tester live-fire (memory `feedback_sim_load_latest_bundle_before_test`).

### L — Confidence — HIGH (SPEC) / PROBABLE (root cause)

The SPEC is HIGH-confidence: every cap site read and verified (12 sites), exact values + diffs given, the migration mirrors the proven AMENDMENT-4 pattern, strict-grep revision is mechanical, and the architecture is operator-locked (not re-litigated). The underlying root cause is PROBABLE (not proven) only because the exact in-sim `[ORCH-0978-TRIM]` overshoot capture is blocked (Business Metro offline + simulator trimmer-fidelity uncertainty); Seth's physical-device `:447` toast + the synthetic 2.0s-GOP demonstration + the full source trace establish the mechanism. The IMPLEMENT-6 tester live-fire (T-AMEND8-05) upgrades it to `proven` by capturing the overshoot value on a reconnected sim or Seth's physical device.

---


