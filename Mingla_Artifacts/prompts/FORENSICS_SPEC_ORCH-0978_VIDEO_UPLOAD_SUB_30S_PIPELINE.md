# FORENSICS DISPATCH — ORCH-0978 SPEC MODE — sub-30s Cloudinary video upload + perfect cross-surface render

**Target skill:** Claude `mingla-forensics`
**Mode:** SPEC (Phase 3 — define every layer with binding contracts and success criteria)
**Working tree:** `~/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/` on branch `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`
**Metro port:** 8090
**Affected Surfaces (write):** business-iOS, business-Android, business-web-preview, `supabase/functions/` edge layer (one new helper or extension to existing `_shared/eventCoverVideo.ts`).
**Affected Surfaces (read):** buyer-web (cover render only), iOS-consumer (cover render), Android-consumer (cover render).
**Surfaces explicitly NOT in scope:** admin-web (no admin cover authoring), checkout (cover-media-neutral).
**Preceded by:** APPROVED RESEARCH report at `Mingla_Artifacts/reports/RESEARCH_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` (commit `bf7bd8db2`) + orchestrator REVIEW at `Mingla_Artifacts/reports/REVIEW_ORCH-0978_RESEARCH_SUB_30S_PIPELINE.md`.

---

## SPEC scope (one sentence)

Codify the research-recommended architecture into a binding contract that an implementor can build without judgment calls: **client-side video compression via `react-native-compressor` on RN, signed `eager_async=true` Cloudinary upload with `eager_notification_url`, direct MP4 derivative (no HLS), `expo-video` muted-autoplay + tap-anywhere-to-unmute render contract, three-stage progress UX with cancel-during-upload, and optimistic-local-preview as the perceived-30s safety net.**

---

## SPEC non-goals (explicit out-of-scope)

- Workstream A (video-everywhere inventory across ALL media-picker surfaces) — separate broader-investigation prompt covers this.
- Workstream C (Cloudinary lifecycle / cost-control / orphan cleanup / reconciliation function) — separate broader-investigation prompt covers this. EXCEPTION: cancel-during-upload MUST destroy the in-flight Cloudinary asset on abort (interaction surface with C).
- Migration of any non-cover video surface to the new pipeline (defer to broader investigation).
- Reskinning the picker affordance copy/iconography ("Photo / GIF / Video" friendly label) — defer to broader UX polish workstream B.
- Any change to the buyer-anonymous routes or checkout-payment paths.
- Admin-web changes (no admin authoring exists).

---

## Phase 0 mandatory ingest (5 files max — research-mode discipline carries over)

1. The RESEARCH report at `Mingla_Artifacts/reports/RESEARCH_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md` — read in full; the §3 latency table and §6 per-surface render contract are direct inputs to this SPEC.
2. The orchestrator REVIEW at `Mingla_Artifacts/reports/REVIEW_ORCH-0978_RESEARCH_SUB_30S_PIPELINE.md` — the "What the SPEC must produce" section lists the binding clauses you need to satisfy.
3. **`app-mobile/package.json` AND `mingla-business/package.json`** — read both to determine current `expo` SDK version. If either is on SDK ≤54, the SPEC must include an `expo-av` → `expo-video` migration pre-step. If both are on SDK ≥55, the migration is already done (verify via grep for `from "expo-av"` across both repos).
4. The current edge fn + service layer (already read in RESEARCH Phase 0): `supabase/functions/event-cover-video-upload-intent/index.ts`, `supabase/functions/event-cover-video-webhook/index.ts`, `mingla-business/src/services/eventCoverVideoProcessingService.ts`. **Do not re-read in full** — Phase 0 of the RESEARCH already documented the current behaviour; consult the report.
5. `supabase/functions/_shared/eventCoverVideo.ts` — read in full this time (RESEARCH skipped it). The constants (`MAX_DURATION_MS = 15000`, `MAX_SOURCE_VIDEO_BYTES = 500 MB`, `MAX_SOURCE_VIDEO_DURATION_MS = 5 min`), the `verifyCloudinaryNotificationSignature` helper, and the `assertProcessedDerivative` validator are all SPEC inputs.

**Do not read anything else from the codebase.** Time spent re-reading is time stolen from spec precision.

---

## Phase 2.5 — Cross-Surface Impact Declaration (MANDATORY, per orchestrator skill 2026-05-15)

Spec MUST include a Cross-Surface Impact section enumerating all 5 primary + 2 adjacent surfaces with explicit coverage statements. For surfaces in scope, list per-surface user-visible behaviour, file paths the SPEC touches, and whether parity is automatic (shared code) or manual (separate code paths — each gets its own SC-N-<surface> success criterion). For surfaces NOT in scope, one-phrase justification.

Per-surface coverage matrix to include:

| Surface | Coverage | Notes |
|---|---|---|
| Business iOS (write) | IN SCOPE | Picker → react-native-compressor → upload-intent → Cloudinary → progress UX → render |
| Business Android (write) | IN SCOPE | Same path; SPEC must address #268 cross-playability bug |
| Business web preview (write) | IN SCOPE | Picker → chunked raw upload (no compression) → same Cloudinary pipeline → render |
| Buyer-web (read) | IN SCOPE | Render contract only: `<video muted playsInline autoplay loop poster onClick={toggleMute}>` |
| iOS consumer (read) | IN SCOPE | Render contract: `expo-video` `useVideoPlayer` + `onFirstFrameRender` |
| Android consumer (read) | IN SCOPE | Same `expo-video` contract; SPEC validates no rendering regression from #39962 |
| Admin web (adjacent) | NOT IN SCOPE | No admin cover authoring path exists |

---

## Phase 3 — Layered specification

Required layers (skip if genuinely untouched, but err toward inclusion):

### Database layer

- `event_cover_video_jobs` schema — confirm whether any new columns are needed (e.g., `client_compressed_bytes` for telemetry, `cancel_reason` for analytics). RECOMMEND minimal change — most state is already captured.
- RLS policies — no expected changes (writes already gated by `requireEventManager`).
- **Migration filename** — pick the next free `supabase/migrations/<timestamp>_orch_0978_<name>.sql` BUT first check `~/Desktop/mingla-orchs/*/supabase/migrations/` for later or equal prefixes across parallel ORCHs (per orchestrator backstop 2026-05-24).

### Edge function layer

- `event-cover-video-upload-intent/index.ts` — no functional change expected; the existing signed `eager_async` + `eager_notification_url` flow is correct. SPEC may want to ADD a `clientCompressedBytes` field to the request body for analytics (optional).
- `event-cover-video-webhook/index.ts` — no functional change expected; current HMAC-SHA1 signature verify is correct. SPEC may consider migrating to Cloudinary's EdDSA v2 (`auth_scheme: eddsa_v2`) for forward-compatibility — decide explicitly.
- `event-cover-video-cancel/index.ts` (already exists) — confirm the SPEC adds a Cloudinary destroy API call so that abort cleans up the in-flight asset rather than orphaning it. Cite the Cloudinary Admin API destroy endpoint URL inline (COMMS-0003 binding).
- New shared helper in `_shared/eventCoverVideo.ts` for Cloudinary destroy (signature signing reuse).

### Service layer

- `mingla-business/src/services/eventCoverVideoProcessingService.ts` — ADD:
  - New function: `compressVideoLocally(uri, onProgress) → Promise<{ uri, bytes, durationMs }>` wrapping `react-native-compressor`'s `Video.compress(uri, { compressionMethod: 'auto' }, progress)`.
  - Web-platform branch: `if (Platform.OS === 'web') return { uri, bytes: originalBytes, durationMs: originalDurationMs };` (skip compression on web, hand raw bytes to Cloudinary).
  - Modify `uploadEventCoverVideoSource` to support chunked-upload fallback when `bytes > 50 MB` (per RESEARCH §Q2 recommendation): emit chunks with `X-Unique-Upload-Id` (job id is a perfect choice) + `Content-Range: bytes <start>-<end>/<total>`, 10 MB chunk size.
  - Modify cancel path to call `xhr.abort()` / `task.cancelAsync()` on the active upload before invoking `cancelEventCoverVideoJob` (per RESEARCH §Q5 gap).
  - Reduce `waitForEventCoverVideoReady` default `pollIntervalMs` from 2500 to 1500.
  - Return progress callback type `{ stage: 'compressing' | 'uploading' | 'processing' | 'ready', percent: number }` so consumers can drive the three-stage UI.

### Hook layer (React Query)

- New hook: `useEventCoverVideoUpload(eventId, brandId)` returning `{ start(file), cancel(), progress, status, processedUrl, error }`. Wraps the service-layer compress + upload + poll pipeline into a single declarative call.
- Query key factory addition: `eventCoverVideoQueryKeys.job(jobId)` for the polling status query.
- Cache invalidation: on `status === 'applied'`, invalidate the parent event's `cover_media_url` cache (existing `eventQueryKeys.detail(eventId)`).

### Component layer

#### `VideoCoverPicker` (new or refactor of existing picker component)

- States: idle | picking | compressing | uploading | processing | ready | error
- Props: `eventId, brandId, applyMode, currentCoverUrl, onChange(newUrl)`
- All five states have explicit copy:
  - `picking`: system picker open (no UI change)
  - `compressing`: "Compressing on your phone — Xs left" with linear bar 0–15%
  - `uploading`: "Uploading — Xs left" with linear bar 15–90%
  - `processing`: "Almost ready..." with indeterminate spinner 90–100%
  - `ready`: hidden; the player takes over
  - `error`: "Couldn't process this video. Try a different clip." + Retry button
- Cancel button visible in compressing | uploading | processing states.
- **Optimistic local preview rendered IMMEDIATELY** in compressing/uploading/processing states via `expo-video` with `useVideoPlayer(localUri)` so the user sees playback within 1–2s; swap source to `processedUrl` on `status === 'ready'`.

#### `VideoCoverRenderer` (the shared render component)

Per the RESEARCH §6 contract, EXACT prop interfaces:

```ts
interface VideoCoverRendererProps {
  uri: string;                    // Cloudinary processed MP4 URL
  posterUri?: string;             // Cloudinary .jpg first-frame derivative
  aspectRatio?: '16:9' | '9:16' | 'auto';
  startMuted?: boolean;           // default true
  loop?: boolean;                 // default true
  onMuteChange?: (muted: boolean) => void;
}
```

Web build target: native `<video>` with `muted playsInline autoplay loop preload="metadata" controls={false}` + click handler.
RN build target: `expo-video` `VideoView` with `useVideoPlayer` + `onFirstFrameRender` poster hide + `Pressable` wrapper for tap-to-unmute.
Both surfaces: bottom-right speaker icon overlay reflecting current `muted` state.

### Realtime (not applicable)

Cover upload is request/response; no realtime channel.

---

## Phase 4 — Success criteria (numbered, observable, testable)

Each criterion is per-surface where parity is manual:

**SC-1** Picker → first-frame visible in player ≤ 3 seconds on any device (perceived-30s anchor).
- SC-1-iOS-consumer: holds on iPhone 13 / iPhone 16 Pro
- SC-1-Android-consumer: holds on Pixel 6 / Galaxy S22
- SC-1-Web: holds on Chrome desktop + Safari iOS

**SC-2** Cloud URL ready (DB `cover_media_url` set + status='applied') ≤ 30 seconds for a 15s 1080p input on 10 Mbps network. ≤ 60 seconds on 5 Mbps cellular. Documented in QA report with actual measured times per surface.

**SC-3** Player autoplays muted on initial mount on all 5 surfaces without user interaction. Cross-platform parity verified.

**SC-4** Tapping anywhere on the video toggles mute. Visual speaker icon reflects new state. Unmute attempt without user gesture (programmatic in test) on iOS Safari pauses playback per WebKit policy — test confirms expected pause behaviour.

**SC-5** Cancel button during upload (a) aborts the in-flight upload task (XHR / FileSystem) within 500 ms, (b) flips `event_cover_video_jobs.status = 'cancelled'`, (c) calls Cloudinary destroy on any uploaded portion so no orphan asset remains.

**SC-6** Three-stage progress UI: visible "Compressing", "Uploading", "Almost ready" labels with monotonically-increasing progress 0→100%. No regression to a single ambiguous spinner.

**SC-7** Optimistic-local-preview swap to Cloudinary URL is visually seamless: no flash of black frame, no audio glitch beyond a single-frame imperceptible discontinuity.

**SC-8** Cross-surface render parity: same source video uploaded once renders pixel-identically on web `<video>`, iOS `expo-video`, Android `expo-video` (modulo HDR-to-SDR loss, which is acceptable and uniform).

**SC-9** Webhook retry safety: if the Mingla webhook endpoint is down at first delivery, Cloudinary's 3/6/9-minute retry policy delivers the notification; job eventually reaches `applied` state within ≤ 20 minutes of upload completion.

**SC-10** Status-poll timeout: client poll loop exits cleanly with a "still processing — try again later" message at 120s if status doesn't reach terminal — does not hang the UI.

---

## Phase 5 — Invariants

PRESERVE:
- I-COMMS-LEDGER-ENTRY-STANZA (orchestrator skill 2026-05-24).
- I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED (DRAFT — every Cloudinary URL inline cited).
- All 14 constitutional principles, especially #3 (no silent failures — every cancel/abort path surfaces error or success), #9 (no fabricated data — progress percentages reflect actual bytes/time, not made-up smoothing).
- Existing race-handling: prior in-flight job is cancelled when a new upload-intent fires (current code at upload-intent/index.ts:179-198 — do not regress).

INTRODUCE (DRAFT → ACTIVE on CLOSE):
- **`I-PROPOSED-VIDEO-UPLOAD-OPTIMISTIC-PREVIEW`** — every video upload UI MUST render the user's local file URI in a player within 3 seconds of file pick, regardless of upload/transcode state. Backed by a CI gate that strict-greps for `<VideoView` or `<video` mounts in any picker component without a preceding `localUri` state.
- **`I-PROPOSED-VIDEO-CANCEL-ABORTS-UPLOAD`** — every video upload cancel handler MUST call `xhr.abort()` / `task.cancelAsync()` BEFORE calling the cancel edge fn. Backed by a CI gate.
- **`I-PROPOSED-VIDEO-AUTOPLAY-MUTED-CONTRACT`** — all video cover renderers MUST set `muted` default to true and require a user-gesture handler for unmute. CI gate strict-greps for `<video` and `useVideoPlayer` without `muted` true default.

---

## Phase 6 — Test cases

Minimum coverage per success criterion. Include real-device matrix coverage explicitly:

| Test | Scenario | Input | Expected | Layer | Per-platform |
|---|---|---|---|---|---|
| T-01 | Happy path 15s 1080p | iPhone 13 4K HEVC clip | Local preview ≤2s, cloud URL ≤30s, player autoplays muted | full stack | iOS+Android+Web |
| T-02 | Cellular slow network | Same clip on throttled 5 Mbps | Local preview ≤2s, cloud URL ≤60s, swap seamless | full stack | iOS+Android |
| T-03 | Cancel mid-compression | Tap Cancel during react-native-compressor run | Compression aborts, no upload starts, no DB row left active | Component+Service | iOS+Android |
| T-04 | Cancel mid-upload | Tap Cancel after compression, during XHR | XHR aborts, job row → cancelled, Cloudinary destroy called, no orphan | Full stack | iOS+Android+Web |
| T-05 | Cancel mid-processing | Tap Cancel after upload bytes done, during transcode | Late webhook ignored, job row → cancelled, Cloudinary destroy called | Edge+Service | iOS+Android+Web |
| T-06 | Webhook delivery failure → retry | Take Supabase webhook endpoint down for 5 min | Cloudinary retries at +3 min; job reaches applied | Edge+Cloudinary | backend |
| T-07 | Race: new upload while previous in-flight | User uploads cover B while A is transcoding | A cancelled+destroyed; B proceeds normally | Edge+Cloudinary | iOS+Android+Web |
| T-08 | Cross-surface render parity | Upload one clip; load it on web, iOS, Android consumer | Identical visual frame at t=0.5s | Render | iOS+Android+Web |
| T-09 | Mute/unmute persistence | Tap to unmute; navigate away; return | Mute state default-resets to true (cover videos default muted) | Component | iOS+Android+Web |
| T-10 | iOS Safari autoplay policy | Programmatic unmute without user gesture | Player pauses per WebKit policy | Web | Web |
| T-11 | react-native-compressor #268 regression | Upload Android-compressed; play on iOS consumer | Plays correctly; no codec-mismatch failure | Cross-platform | iOS playback of Android-compressed |
| T-12 | First-frame-black bug #39962 | Mount VideoView on Android emu cold load | Either first frame paints OR poster overlay covers; never blank | Render | Android |

**Empirical PoC clause (per REVIEW non-blocking concern #1):** before IMPLEMENT begins, run an isolated 30-minute hands-on benchmark of `react-native-compressor`'s `auto` preset on iPhone 13, iPhone 16 Pro, Pixel 6, Galaxy S22 with our typical inputs (15s + 30s 1080p HEVC / H.264 clips). Record output bytes + time-to-compress + visual quality. If any device exceeds the 15s compression budget OR produces output that fails T-08 cross-surface parity, the SPEC's fallback recommendation activates: per-platform native module (AVAssetExportSession iOS, MediaCodec Android).

---

## Phase 7 — Implementation order

1. **Phase 0 — Expo SDK verification.** Confirm `expo-av` is not imported anywhere (grep across both monorepo apps). If it is, register a follow-up cleanup ORCH or include the migration in this SPEC's scope. Decide BEFORE coding.
2. **Phase 0.5 — Empirical compression PoC** (above). Lock the §3 latency budget numbers based on actual measurements.
3. **DB migration** (if any column added). File first since migration order matters for parallel ORCHs.
4. **Edge fn changes** — extend `event-cover-video-cancel` to call Cloudinary destroy; add shared destroy helper in `_shared/eventCoverVideo.ts`.
5. **Service layer** — new `compressVideoLocally`, modified `uploadEventCoverVideoSource` (chunked fallback + abort), modified `cancelEventCoverVideoJob` (XHR abort before edge call), modified `waitForEventCoverVideoReady` (1.5s poll).
6. **Hook layer** — new `useEventCoverVideoUpload`.
7. **Component layer** — new/refactored `VideoCoverPicker` + new `VideoCoverRenderer` shared between web + RN via platform-conditional code OR two separate files (`VideoCoverRenderer.tsx` for RN + `VideoCoverRenderer.web.tsx` for web, per existing Mingla pattern).
8. **CI gates** — three strict-grep files for the new invariants. Add to `.github/workflows/strict-grep-mingla-business.yml`.
9. **Regression tests** (Step 0.5 CLOSE gate): implementor-written happy-path test (T-01) with `fails-on-revert verified at <hash>` + tester-written adversarial test (T-05 cancel-mid-processing race).

---

## Phase 8 — Regression prevention

- Class of bug: silent upload failures on cellular due to oversized raw inputs hitting NAT timeout. Structural safeguard: client-side compression is mandatory on RN platforms; CI gate strict-greps for any new upload path that skips it.
- Class of bug: orphaned Cloudinary assets from incomplete cancel. Structural safeguard: I-PROPOSED-VIDEO-CANCEL-ABORTS-UPLOAD invariant + CI gate.
- Class of bug: blank-frame autoplay UX. Structural safeguard: I-PROPOSED-VIDEO-UPLOAD-OPTIMISTIC-PREVIEW invariant + CI gate.

---

## Hard guards for SPEC phase

- **No code, no migrations, no edge deploy.** This is SPEC only.
- **No re-research.** The RESEARCH report is the source of truth for all external claims. If a new question surfaces, cite it as an Open Question for the implementor to resolve at IMPLEMENT time — do not re-fetch URLs.
- **Inline Cloudinary docs URLs** for every parameter and webhook field introduced or modified (COMMS-0003).
- **Brutal honesty.** If a SPEC decision is contested or has two equally-valid choices, present both with tradeoffs and let the REVIEW pick. Do not paper over disagreement.
- **No scope expansion to workstreams A or C.** Cancel-destroy is the ONLY workstream-C interaction surface — everything else stays out.

---

## Expected output

File: `Mingla_Artifacts/specs/SPEC_ORCH-0978_VIDEO_UPLOAD_SUB_30S_PIPELINE.md`

Sections in this order:
1. Executive summary (≤10 sentences plain English)
2. Scope + Non-goals
3. Cross-Surface Impact Declaration (mandatory)
4. Layered spec (DB / Edge / Service / Hook / Component)
5. Success criteria (SC-1 through SC-10+ with per-surface where manual)
6. Invariants (preserved + introduced)
7. Test cases (T-01 through T-12+)
8. Implementation order
9. Regression prevention
10. Open questions (any decisions deferred to REVIEW + IMPLEMENT)

---

## Downstream routing

After SPEC returns:
1. Orchestrator REVIEWs the SPEC (APPROVED / NEEDS WORK / REJECTED).
2. If APPROVED, operator gates IMPLEMENT dispatch — IMPLEMENT may begin only AFTER ORCH-0964 [Public-page theme customization] PR merges to main, to avoid collision on `mingla-business/src/components/brand/` + `packages/event-rendering/` + the new `packages/brand-rendering/`.
3. IMPLEMENT default: Codex `implementor-mingla` (or Claude `mingla-implementor` if operator redirects).
4. Orchestrator-owned edge-function deploy after IMPLEMENT (verify-first-call per `feedback_supabase_edge_deploy_verify_first_call.md`).
5. TEST (Claude `mingla-tester` or `mingla-forensics` TEST mode).
6. CLOSE.

---

## Operator awareness flags

- ORCH-0964 collision deferral applies to IMPLEMENT only — SPEC can be written now.
- The empirical PoC clause in Phase 6 is mandatory before IMPLEMENT — operator may run it themselves or ask forensics to script it.
- If `expo-av` is found in active imports during Phase 0, decide BEFORE SPEC body: in-scope migration vs separate ORCH.
