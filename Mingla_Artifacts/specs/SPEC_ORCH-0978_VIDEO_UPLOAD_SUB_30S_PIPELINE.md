# SPEC — ORCH-0978 [Video upload polish + sub-30s perfect cross-surface render]

**Author:** Claude `mingla-forensics` (SPEC mode)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
**Preceded by:** APPROVED RESEARCH at `Mingla_Artifacts/reports/RESEARCH_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` (`bf7bd8db2`) + orchestrator REVIEW at `Mingla_Artifacts/reports/REVIEW_ORCH-0978_RESEARCH_SUB_30S_PIPELINE.md` (`7bc5e6097`)
**Date:** 2026-05-26

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
