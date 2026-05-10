# Implementation Report: Event Cover Media Pipeline Demolition Fix (ORCH-0766C)

> Date: 2026-05-09
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0766C_EVENT_COVER_MEDIA_PIPELINE_DEMOLITION_FIX.md`
> Status: implemented, partially verified

## 1. Layman Summary

The business app no longer tries to upload event covers through React Native `Blob`, which was the core reason uploads could appear successful while saving broken or zero-byte media. Custom event covers now read actual local file bytes with Expo FileSystem, upload `Uint8Array` bytes to Supabase Storage, validate the uploaded public URL, and only then update the draft.

Step 4 now separates image/GIF picking from video picking. Images/GIFs keep editing off to avoid flattening GIFs. Videos use a video-only native picker with `allowsEditing: true` and `videoMaxDuration: 15`, so organisers get the simple in-app/native trim route required by the amended spec. Render failures now show a persistent inline warning instead of silently looking like a normal hue fallback.

## 2. Request And Context

- **Request:** Fix custom Mingla event-cover upload and add a simple in-app trim path for videos over 15 seconds.
- **Source:** ORCH-0766C forensic/spec/review artifacts and user amendment requiring trim to be part of this fix.
- **Affected surfaces:** Mingla Business event creator Step 4, event-cover renderer, event-cover upload service, media validation rules, focused tests, direct dependency declaration.
- **Related issues/artifacts:** ORCH-0758A, ORCH-0766B, ORCH-0766C.

## 3. Scope

- **In scope:** Event-cover custom upload, media validation, render failure UX, video-only native trim picker, tests, implementation report.
- **Out of scope:** Giphy/Pexels, brand/profile/ticket media, MOV conversion, public share/OG, admin, Stripe, consumer app.
- **Assumptions:** Expo ImagePicker native edit/max-duration is the launch-safe trim path to prove in runtime QA; no heavy trim/transcode dependency is authorized.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0766C_EVENT_COVER_MEDIA_PIPELINE_DEMOLITION_FIX.md` | Binding dispatch | Requires Blob removal, picker normalization, visible render errors, and simple trim route. |
| `Mingla_Artifacts/specs/SPEC_ORCH-0766C_EVENT_COVER_MEDIA_PIPELINE_DEMOLITION_FIX.md` | Binding spec | Defines 15s/30MB limit, ArrayBuffer/Uint8Array upload, native trim proof, and QA matrix. |
| `mingla-business/src/services/eventCoverMediaService.ts` | Upload path | Existing dirty work still used `fetch(uri).blob()`; replaced. |
| `mingla-business/src/utils/eventCoverMediaRules.ts` | Validation source | Existing classification ignored URI, picker type, and bytes; expanded. |
| `mingla-business/src/components/event/CreatorStep4Cover.tsx` | User-facing picker/preview | Existing picker was mixed media with editing off; split image/GIF vs video. |
| `mingla-business/src/components/ui/EventCoverMedia.tsx` | Render fallback | Added caller-visible media error event and dev logging. |
| `mingla-business/package.json` | Dependency surface | Added direct `expo-file-system`, already present transitively in lockfile. |

## 5. Blast Radius

- **Direct changes:** Event cover picker, upload service, validation rules, renderer error callback, tests.
- **Cascade changes:** Draft updates still occur only after upload and public URL verification pass.
- **Parity surfaces:** Published event update service remains unchanged except shared validation/export surface.
- **Cache impact:** No React Query keys or invalidations changed.
- **State boundaries:** Zustand draft state still owns local draft media fields.
- **Auth/RLS/security:** No DB, RLS, edge function, or Supabase policy changes.
- **Deploy path:** Business app code update. Direct `expo-file-system` dependency may require confirming the native runtime already includes the module; it was already installed transitively.

## 6. Old To New Receipts

### `mingla-business/src/services/eventCoverFileReader.ts`

- **Before:** No RN-safe local byte reader existed for event covers.
- **After:** New helper reads picker URI bytes via `new File(uri).arrayBuffer()` and returns `Uint8Array`.
- **Why:** Supabase Storage client warns React Native `Blob/File/FormData` uploads do not work as intended.

### `mingla-business/src/services/eventCoverMediaService.ts`

- **Before:** Upload path used `fetch(input.uri).blob()` and sent `Blob` to Supabase Storage.
- **After:** Upload path reads file bytes, rejects zero/oversized files before upload, normalizes content type, sends `Uint8Array`, and verifies public URL before returning success.
- **Why:** Prevent zero-byte/broken object success and align with React Native-safe upload guidance.

### `mingla-business/src/utils/eventCoverMediaRules.ts`

- **Before:** Classification depended on MIME and filename.
- **After:** Classification/normalization also uses URI extension, picker type, byte sniffing for JPEG/PNG/GIF/WebP/MP4/WebM, generic MIME filtering, and explicit HEIC/MOV rejection.
- **Why:** Expo picker assets may omit MIME/filename; bytes and picker type are needed for real runtime assets.

### `mingla-business/src/components/event/CreatorStep4Cover.tsx`

- **Before:** One mixed picker with editing disabled; render failure only toasted; over-limit video had no trim route.
- **After:** Upload button opens Image/GIF or Video choice. Image/GIF picker keeps editing disabled and quality 1. Video picker is video-only with native editing and `videoMaxDuration: 15`. Render failure shows persistent inline alert while keeping Replace/Remove.
- **Why:** Preserve GIF behavior while providing the simple in-app/native video trim path.

### `mingla-business/src/components/ui/EventCoverMedia.tsx`

- **Before:** Renderer silently fell back to hue on media error.
- **After:** Renderer still falls back visually but emits an error event to creator surfaces and logs dev payload.
- **Why:** Creator/edit surfaces must show actionable failure instead of looking like hue was chosen.

### `mingla-business/package.json` / `package-lock.json`

- **Before:** `expo-file-system` was present transitively, not direct.
- **After:** `expo-file-system` is a direct dependency at `~19.0.21`.
- **Why:** Event-cover upload now directly imports FileSystem.

## 7. Implementation Details

- **Architecture decisions:** Kept event-cover logic local to the existing service/rules/component surfaces. No new media provider, DB, or native video-processing library.
- **Data flow:** Picker asset -> FileSystem bytes -> normalize/validate -> Supabase Storage `Uint8Array` upload -> public URL verification -> draft update.
- **Mutation/query behavior:** No React Query mutation changes.
- **State handling:** Draft media state is mutated only after upload verification passes. Hue selection does not clear media. Remove clears media.
- **Error handling:** Precise typed errors for unsupported type, oversized file, unknown duration, too-long video, upload failure, and display failure.
- **Copy/accessibility:** Upload limit copy is visible; render failure warning uses `accessibilityRole="alert"`.
- **Analytics/notifications/realtime:** Not touched.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Remove Blob upload | `eventCoverMediaService` uploads `Uint8Array` | `eventCoverMediaService.test` body assertion | PASS |
| Read bytes safely in RN | `eventCoverFileReader` uses Expo FileSystem `File.arrayBuffer()` | TypeScript + service tests with mock | PASS |
| Reject zero-byte local files | Byte length guard before upload | `rejects empty local file bytes` test | PASS |
| Normalize missing MIME/fileName | URI, picker type, bytes added | normalize/classify tests | PASS |
| Byte sniff JPEG/PNG/GIF/WebP/MP4/WebM | `sniffEventCoverMimeType` | byte-header tests | PASS |
| Public URL non-zero verification | Existing verifier preserved, body proof uses ArrayBuffer first | verifier tests | PASS |
| Image/GIF editing disabled | Image flow uses `allowsEditing: false`, `quality: 1` | source guard test | PASS |
| Simple video trim route | Video flow uses `allowsEditing: true`, `videoMaxDuration: 15` | source guard test; runtime still pending | PARTIAL |
| Persistent render error | Step 4 stores/display warning | source guard test | PASS |
| Draft/autosave guard preserved | Existing guard tests pass | `test:orch-0763` | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| One owner per truth | Yes | Yes | DB/storage remain persisted truth; Zustand draft updates only after verified upload. |
| No silent failures | Yes | Yes | Upload/display errors surface as typed errors/toasts/inline warning. |
| Truthful UI states | Yes | Yes | Render failure remains visible; Replace/Remove remain available. |
| Scope control | Yes | Yes | No Giphy/Pexels, brand/profile/ticket, Stripe, admin, or consumer changes. |
| Regression tests move with behavior | Yes | Yes | Added byte/upload/trim-source tests. |

## 10. Parity Check

- **Mobile:** Not touched.
- **Business app:** Implemented.
- **Admin:** Not touched.
- **Public/web:** Not touched.
- **Solo/collab:** Not relevant.
- **Gaps:** Native trim UI still needs human/runtime proof on the signed-in Mingla Business build.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** Event-cover upload input now accepts `pickerType`; stored public fields unchanged.
- **AsyncStorage/Zustand impact:** Existing draft media fields preserved.
- **Cold start behavior:** Existing server hydration/autosave guard tests pass.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Focused service test | `/opt/homebrew/bin/npx jest eventCoverMediaService.test --runInBand` | PASS, 17 tests | Includes Uint8Array upload and byte sniffing. |
| UI/source guard + autosave tests | `/opt/homebrew/bin/npx jest eventCoverMedia.test serverDraftAutosaveGuards.test --runInBand` | PASS, 10 tests | Includes split picker/native trim config source guard. |
| ORCH-0758A gate | `/opt/homebrew/bin/npm run test:orch-0758a -- --runInBand` | PASS, 6 suites / 50 tests | Watchman recrawl warning only. |
| ORCH-0763 gate | `/opt/homebrew/bin/npm run test:orch-0763 -- --runInBand` | PASS, 7 suites / 53 tests | Watchman recrawl warning only. |
| TypeScript | `/opt/homebrew/bin/npx tsc --noEmit` | PASS | No output. |
| Targeted ESLint | `/opt/homebrew/bin/npx eslint src/components/event/CreatorStep4Cover.tsx src/components/ui/EventCoverMedia.tsx src/services/eventCoverMediaService.ts src/services/eventCoverFileReader.ts src/utils/eventCoverMediaRules.ts src/services/__tests__/eventCoverMediaService.test.ts src/components/ui/__tests__/eventCoverMedia.test.ts src/utils/__tests__/serverDraftAutosaveGuards.test.ts` | PASS | No output. |
| Diff hygiene | `git diff --check` | PASS | No output. |

## 13. Regression Surface

1. **Image/GIF picker:** Split flow should preserve GIFs, but tester must verify real GIF animation behavior.
2. **Video trim picker:** Native edit UI is platform/runtime behavior; code uses Expo-supported options but runtime proof is required.
3. **Public URL verification:** Still depends on Storage public URL HEAD/Range behavior; verifier has GET fallback.
4. **Historical broken draft URLs:** Existing drafts with previously saved zero-byte URLs may still show the new render warning until replaced.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Native trim proof pending | Code uses native picker trim options, but simulator/device has not been manually exercised in this pass | Tester verifies over-15s video opens trim UI and returns <=15s asset, or records platform limitation | `CreatorStep4Cover.tsx` |
| Direct FileSystem dependency | `expo-file-system` added direct; native runtime must include module | Confirm current dev/native build includes module or rebuild if needed | `package.json` |
| MOV unsupported | MOV/QuickTime still rejects | Future conversion/transcode spec if product wants MOV | `eventCoverMediaRules.ts` |

## 15. Discoveries For Orchestrator

- No new side issue beyond the already-known Watchman recrawl warning and pre-existing npm audit vulnerabilities reported by npm install.

## 16. Deploy Notes

- **Migrations:** None.
- **Edge functions:** None.
- **Mobile OTA/native:** Business app JavaScript changes are OTA-able if the installed native runtime already includes `expo-file-system`; otherwise a business native rebuild is required. No new native video trim dependency was added.
- **Business/admin web:** Business app package files changed; no admin work.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
fix(business): repair event cover uploads and native video trim flow

Resolves: ORCH-0766C
Evidence: test:orch-0758a, test:orch-0763, tsc, targeted eslint
Deploy: business app update; confirm expo-file-system native availability
```

## Ready-To-Test Checklist

1. In Mingla Business, open the existing draft and upload a JPEG. Expected: Step 4 preview shows image, Home draft card shows image, Supabase URL is non-zero.
2. Upload a PNG/WebP/GIF. Expected: supported files upload and display; GIF animation behavior recorded.
3. Choose Video and select an MP4 over 15 seconds. Expected: native in-app trim UI appears where supported; returned <=15s asset uploads and displays.
4. Cancel the video picker/trim UI. Expected: existing draft media URL remains unchanged.
5. Select an MP4 <=15 seconds. Expected: upload succeeds and video displays or stills under reduced motion.
6. Select MOV/QuickTime. Expected: clear MP4/WebM unsupported copy and no draft mutation.
7. Force a bad saved URL/render failure. Expected: hue fallback plus persistent inline warning, with Replace/Remove still visible.
