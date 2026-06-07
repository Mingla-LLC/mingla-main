# SPEC_ORCH-1097_BUSINESS_WEB_MEDIA_PICKER_CONTROLS

## Status

READY FOR ORCHESTRATOR REVIEW.

This spec defines the next business-web completion slice after ORCH-1096: browser-safe media and file picker controls for business-authoring surfaces. It intentionally avoids backend/provider/schema changes and preserves native picker parity.

## Goal

Business users on desktop and phone browsers can complete core media/file actions without falling into native permission stubs, native module imports, or web file-reader throws.

## User Outcomes

- A creator can choose a local image/GIF for cover media from a browser file picker.
- A creator can choose local cover video on desktop web, with phone-web video kept in a clear degraded state unless physical proof passes.
- A creator can upload brand and creator avatar images from a browser.
- A creator can add one or more local stop photos from a browser.
- A creator can attach activity/menu image or PDF snaps from a browser.
- Native iOS/Android picker behavior remains unchanged.

## Hard Constraints

- No backend/provider/schema/storage-policy/edge-function changes.
- No payout-provider copy changes; keep provider-neutral language.
- No changes to ORCH-1091 cache recovery, ORCH-1093 OOM route guards, or ORCH-1095/1096 phone preboot route contracts.
- No Vercel deployment from the worktree.
- No native OTA unless native code behavior changes; this slice should not require OTA.
- Native modules remain quarantined to `.native` files or documented native-only route files.
- Every behavior fix ships with a regression test that would fail before and pass after.

## In Scope

### CoverPicker

Files:

- `mingla-business/src/components/ui/CoverPicker.tsx`
- `mingla-business/src/components/ui/coverPickerDeviceMedia.ts`
- `mingla-business/src/components/ui/coverPickerDeviceMedia.native.ts`
- `mingla-business/src/components/ui/coverPickerFileInfo.ts`
- `mingla-business/src/components/ui/coverPickerFileInfo.native.ts`
- Existing cover upload services/readers as needed, without backend changes.

Requirements:

- Replace the default web denied/canceled picker path with a browser-safe file picker invoked only from a user action.
- Image/GIF local upload must work on desktop web and phone web when the browser returns an image file.
- Video local upload must work on desktop web if the existing upload service accepts the selected file type and size.
- Phone-web video remains explicitly degraded unless implementation produces physical Android Chrome and iPhone Safari proof.
- Existing Giphy/Pexels/color flows remain unchanged.
- Native `.native` picker behavior remains unchanged.
- Browser file chooser must respect file type and size limits before upload.
- Object URLs created for previews must be revoked after upload, clear, or component unmount.

### Brand Avatar Picker

Files:

- `mingla-business/src/components/brand/BrandAvatarPickerSheet.tsx`
- `mingla-business/src/services/brandAvatarService.ts`
- `mingla-business/src/services/brandAvatarFileReader.ts`
- `mingla-business/src/services/brandAvatarFileReader.native.ts`

Requirements:

- Browser users can choose an image file without hitting native permission-copy behavior.
- Existing avatar upload service remains the upload authority.
- Web crop parity is not required; show the resulting preview in the existing avatar frame and preserve native crop/picker behavior.
- Reject unsupported MIME and oversized files before upload.

### Creator Avatar Picker

Files:

- `mingla-business/app/account/edit-profile.tsx`
- `mingla-business/src/services/creatorAvatarService.ts`
- `mingla-business/src/services/creatorAvatarFileReader.ts`
- `mingla-business/src/services/creatorAvatarFileReader.native.ts`

Requirements:

- Desktop web creator avatar selection uses the same browser-safe image picker contract.
- Do not promote `/account/edit-profile` into the ORCH-1095 phone preboot set in this slice.
- If phone browser reaches the screen through an already supported path, file picking may work, but route promotion is not part of the acceptance criteria.

### Experience Stop Photos

Files:

- `mingla-business/src/components/experience/ExperienceStopPhotoSheet.tsx`
- `mingla-business/src/services/experienceStopImageService.ts`
- `mingla-business/src/services/brandCoverFileReader.ts`
- `mingla-business/src/services/brandCoverFileReader.native.ts`

Requirements:

- Browser users can select one or more local image files up to the remaining stop-photo slot count.
- Each file validates MIME and size before upload.
- Failures are per-file where possible; one bad file should not discard all valid selections.
- Giphy/Pexels/public URL behavior remains unchanged.
- Native picker behavior remains unchanged.

### Activities/Menu Snap Inputs

Files:

- `mingla-business/src/components/experience/ActivitiesSnapInput.tsx`
- `mingla-business/src/components/experience/MenuSnapInput.tsx`
- `mingla-business/src/utils/fileReader.ts`
- `mingla-business/src/utils/fileReader.native.ts`
- `mingla-business/src/utils/platformFileSystem.ts`
- `mingla-business/src/utils/platformFileSystem.native.ts`

Requirements:

- Remove direct `expo-document-picker` imports from web-reachable snap input modules.
- Browser image/PDF selection uses browser File/Blob reading, not `platformFileSystem.ts`.
- Native document/image picking remains in native-only split code.
- Accepted MIME types: images supported by the existing snap flow plus PDF.
- Explicit errors for unsupported MIME, oversize files, empty files, and read failures.
- Camera capture on browser may use `capture` only as a hint; never depend on it for correctness.

## Out of Scope

- Checkout intake upload parity in `mingla-business/src/components/checkout/intake/IntakeFilePickerChooserSheet.tsx`.
- Group chat media attachment parity in `mingla-business/src/components/groupChat/GroupChatPanel.tsx`.
- Scanner route camera parity.
- Buyer checkout, tax, fee, payout, Stripe, Paystack, or provider work.
- New Supabase migrations, RLS, storage policy edits, or edge function changes.
- Static Home routing, preboot route promotion, or Vercel deployment.

If orchestrator wants checkout/chat/scanner in the same ORCH, this spec must be expanded before implementation because those flows require additional UX, route, and service proof.

## Browser Picker Contract

Add or reuse a small browser-safe picker adapter. The adapter may live under `mingla-business/src/utils/` or the existing media helper folder, but it must meet this contract:

- It runs only inside a user-initiated event handler.
- It creates an `<input type="file">` at action time, sets `accept`, `multiple`, and optional `capture`, and resolves selected browser `File` objects.
- It never reads `window` or `document` at module import time.
- It returns enough metadata for existing upload services: name, MIME type, size, local preview URI/data URI/object URL, and the underlying Blob/File when needed.
- It supports single and multi-file selection.
- It has deterministic error outcomes for canceled selection, invalid type, oversize file, empty file, and read failure.
- It includes cleanup hooks for object URL revocation.

Browser references:

- MDN file input supports JavaScript access to selected files and attributes such as `accept`, `multiple`, and `capture`: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/file
- MDN FileReader supports reading Blob/File values as data URLs: https://developer.mozilla.org/en-US/docs/Web/API/FileReader/readAsDataURL
- MDN blob URLs support local Blob/File previews through `URL.createObjectURL()`: https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob

## Implementation Plan

1. Add failing ORCH-1097 regression guard first.
2. Add browser-safe file picker adapter and tests.
3. Wire CoverPicker image/GIF and desktop video to the browser picker while keeping native `.native` behavior intact.
4. Wire brand avatar and creator avatar to browser image selection.
5. Wire experience stop-photo multi-add to browser image selection.
6. Wire ActivitiesSnapInput and MenuSnapInput to browser image/PDF selection and browser-safe file reading.
7. Add export/source guards against direct native picker/file imports in the in-scope web files.
8. Run source tests, export guards, and browser runtime proof.
9. Produce implementation report with exact tested URLs/dev-server details and physical-device results.

## Regression Tests

Add package script:

- `mingla-business/package.json`: `test:orch-1097`.

Recommended command composition:

- Keep `test:orch-1097` narrowly scoped to ORCH-1097 source guards and unit tests.
- Do not weaken `test:orch-1095` or `test:orch-1096`.
- Implementation close should run `test:orch-1097` plus the affected existing ORCH web guards.

Required tests/guards:

- Source guard fails if in-scope web modules directly import `expo-image-picker`, `expo-document-picker`, `expo-file-system`, `expo-file-system/legacy`, `expo-camera`, or `react-native-keyboard-controller`, except in `.native.*` files and documented out-of-scope native-only routes.
- Source guard fails if ActivitiesSnapInput or MenuSnapInput import the web-throwing `platformFileSystem` path for browser ingestion.
- Source guard fails if `coverPickerDeviceMedia.ts` remains an unconditional denied/canceled stub on web.
- Unit tests cover browser picker cancel, single image, GIF, multi-image, PDF, unsupported MIME, oversize file, empty file, and object URL cleanup.
- CoverPicker tests prove desktop web image/GIF local selection reaches upload preparation and phone-web video remains degraded unless physical proof expands it.
- Avatar tests prove browser selection uses file metadata and does not call native permission helpers.
- Stop-photo tests prove multi-file add respects remaining slot count and handles per-file invalid cases.
- Snap-input tests prove image/PDF files are read through browser File/Blob readers and produce the existing base64 payload shape.
- Export/chunk guard proves ORCH-1095/1096 phone preboot routes still avoid native/provider tokens and that no new media picker code is pulled into boot-critical chunks.

## Runtime Proof Required

Desktop Chromium:

- Start business web from the implementation worktree.
- Sign in with a business test account.
- Verify cover image upload, GIF/provider selection, and color fallback in the create/edit flow.
- Verify desktop cover video local selection or explicitly document desktop video degraded state if implementation keeps it off.
- Verify brand avatar upload.
- Verify creator avatar upload if the account edit route is reachable in the current web surface.
- Verify experience stop-photo multi-add with at least two valid images and one rejected invalid file.
- Verify activities/menu snap image and PDF selection.

Android Chrome:

- Use the same phone-browser discipline as ORCH-1095/1096.
- Prove promoted phone routes still boot without native provider tokens or OOM behavior.
- Verify phone browser cover image selection, avatar selection where reachable, stop-photo selection, and snap image/PDF selection.
- Verify phone video cover copy if video remains degraded.

iPhone Safari:

- Required manual gate unless unavailable.
- Verify browser file chooser opens for at least cover image and one snap input.
- Verify phone video cover degraded copy or upload proof, depending on implementation choice.
- If physical iPhone is unavailable, implementation must mark this as an explicit tester manual gate, not as a silent pass.

## Acceptance Criteria

- Browser users no longer hit native permission-denied stubs for in-scope image/PDF controls.
- In-scope web modules no longer directly import native picker/file modules.
- Existing provider tabs still work.
- Native iOS/Android picker paths still use native modules through `.native` files or dynamic native imports.
- ORCH-1095/1096 phone preboot route guards remain green.
- No backend/provider/schema/payout changes are present in the commit.
- `test:orch-1097` fails before the implementation and passes after.
- Runtime proof includes desktop Chromium and Android Chrome; iPhone Safari is either proven or escalated as a manual gate.

## Deployment Discipline

- Implementation PR title/merge commit must include `[deploy]` only if it ships web runtime changes intended for Vercel.
- Vercel deployment must happen only from merged `main`, not from the ORCH worktree.
- No native OTA is expected.
- If implementation unexpectedly changes native runtime behavior, stop and route back to orchestrator before OTA planning.

## Orchestrator Decision Needed

Recommended decision: approve the narrow ORCH-1097 implementation scope above and defer checkout intake, group chat attachment parity, and scanner camera parity to separate ORCHs.

Reason: the primary business-authoring controls share the same fix pattern and can be guarded cleanly. Checkout/chat/scanner each adds different route, service, or camera semantics and would dilute the regression contract for this slice.
