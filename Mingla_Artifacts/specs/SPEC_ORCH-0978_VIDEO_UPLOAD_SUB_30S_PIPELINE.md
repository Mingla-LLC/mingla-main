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

**File:** `supabase/functions/event-cover-video-upload-intent/index.ts` line 48 (the `requireUserId(req)` call)

**Change:** wrap or inline-expand `requireUserId` to log WHICH auth check failed when it returns a 401 Response. The diagnostic must distinguish:
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

**Two-constant change.** Per `feedback_external_api_docs_verified.md`, both citations are inline.

- **File:** `mingla-business/src/components/ui/CoverPicker.tsx` line 422
  - Change: `videoMaxDuration: 30,` → `videoMaxDuration: 29,`
  - Cite: https://docs.expo.dev/versions/latest/sdk/imagepicker/#imagepickeroptions — `videoMaxDuration` accepts seconds, integer, iOS-best-effort + Android-best-effort.

- **File:** `mingla-business/src/services/eventCoverVideoProcessingService.ts` line 17
  - Change: `export const EVENT_COVER_MAX_VIDEO_DURATION_MS = 30_000;` → `export const EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000;`

- **File:** `mingla-business/src/components/ui/CoverPicker.tsx` line 435
  - Change toast copy: `"Please trim to 30 seconds first."` → `"Please trim to 29 seconds first."`

- **File:** `mingla-business/src/services/eventCoverVideoProcessingService.ts` line 21
  - Change: `"Use your phone's trim screen to keep video covers to 30 seconds. ..."` → `"Use your phone's trim screen to keep video covers to 29 seconds. ..."`

**Tolerance UNCHANGED:** the existing `+ 250` rejection guard at `CoverPicker.tsx:434` stays. Effective rejection ceiling becomes 29,250 ms. iOS keyframe overshoot typically 100-800 ms (per save-bug investigation citations), comfortable headroom.

**AMENDMENT 1 supersession statement:** AMENDMENT 1's "single 30s cap via native trim" is hereby superseded by 29s. AMENDMENT 1 stays in this document as historical record. AMENDMENT 1 invariants and CI gates referring to `30000` ms or the `videoMaxDuration: 30` literal MUST be updated to `29000` / `videoMaxDuration: 29` per Item 6 below.

**SC-AMENDMENT-4-CAP-4:** Picker config line literally reads `videoMaxDuration: 29`; constant literally reads `29_000`; toast copy literally reads `29 seconds`.

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

**I-PROPOSED-VIDEO-CAP-CONSISTENCY-29S:** Picker `videoMaxDuration`, client constant `EVENT_COVER_MAX_VIDEO_DURATION_MS`, edge function `EFFECTIVE_TRIM_CEILING_MS` validation, and DB CHECK constraints on `event_cover_video_jobs` MUST all agree at 29000 ms (with `+250ms` tolerance at picker reject + edge reject = 29250). Any layer deviating from this contract is a P0 invariant violation.

**Supersedes:** I-PROPOSED-VIDEO-INPUT-CAP-AT-PICKER (AMENDMENT 1 §6) — that invariant referenced `videoMaxDuration: 30`. Update its target literal to `29` or replace with the new invariant.

### F — CI gates

**New strict-grep registry file:** `.github/scripts/strict-grep/orch-0978-video-cap-29s.mjs` (NEW)

Three checks:
1. **C1 — Client cap is 29:** assert `mingla-business/src/components/ui/CoverPicker.tsx` contains `videoMaxDuration: 29` exactly once. Fail if `videoMaxDuration: 30` appears anywhere.
2. **C2 — Constant is 29_000:** assert `mingla-business/src/services/eventCoverVideoProcessingService.ts` contains `EVENT_COVER_MAX_VIDEO_DURATION_MS = 29_000`. Fail if `= 30_000` appears in this constant.
3. **C3 — DB constraint is 29000:** assert the migration `20260730000000_orch_0978_video_cap_29s_constraints.sql` exists AND contains the literal `29000` in BOTH `_trim_max_duration` and `_processed_max_duration` ADD CONSTRAINT statements.

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

### K — Confidence — HIGH

Every code touchpoint cited has been read in this Phase 0 with line ranges captured. Live DB constraint probe independently confirms Codex's finding. Migration timestamp scan across all worktrees confirms no collision. Operator decisions captured from chat. Diagnostic-first rule for Item 2 preserves engineering rigor against the temptation to blindly pick a fix path. No open questions.

---

