# INVESTIGATION_ORCH-1097_BUSINESS_WEB_MEDIA_PICKER_CONTROLS

## Verdict

PASS for forensic completion. ORCH-1097 should proceed as a browser-picker control slice, not as backend, provider, schema, router, or payout work.

The confirmed root cause is not storage, not Giphy/Pexels providers, and not the ORCH-1095/1096 preboot routing layer. The business web media controls still rely on native picker stubs or direct native module imports in several user-facing controls, so browser users either see enabled controls that cannot select a file, receive a permission-denied toast, or enter a file path that cannot be read on web.

## Inputs Read

- Prompt: `Mingla_Artifacts/prompts/FORENSICS_ORCH-1097_BUSINESS_WEB_MEDIA_PICKER_CONTROLS.md`.
- Phase 3 inventory: `Mingla_Artifacts/reports/INVENTORY_ORCH-1085_PHASE_3_BUSINESS_WEB_FULL_WEB_COMPLETION.md`.
- Prior evidence: ORCH-1088, ORCH-1089, ORCH-1095, and ORCH-1096 investigation/spec/implementation/QA artifacts named by the prompt.
- Current source: cover picker helpers, brand/avatar picker, creator avatar picker, experience stop photo sheet, activities/menu snap inputs, intake file chooser, group chat media surface, scanner route, media upload services/readers, and current ORCH web guards.
- Memory scan: project memory reinforces that forensics writes investigation/spec only, business web parity is a standing product contract, Vercel deploys require `[deploy]` on shipping commits, OTA must remain per-platform when needed, and native-web bundle hazards must be treated as hard regressions.
- External browser references: MDN documents `<input type="file">` with `accept`, `multiple`, and `capture`; `FileReader.readAsDataURL()` for Blob/File base64 data URLs; and `blob:` URLs / `URL.createObjectURL()` for local Blob/File previews.

References:

- MDN file input: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/file
- MDN FileReader data URLs: https://developer.mozilla.org/en-US/docs/Web/API/FileReader/readAsDataURL
- MDN blob URLs: https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob

## Guardrails Applied

- No implementation or product-code edits.
- No backend, provider, database, schema, storage policy, edge function, or payout-copy changes.
- Preserve ORCH-1091 cache recovery discipline.
- Preserve ORCH-1093 route OOM guards and chunk-budget intent.
- Preserve ORCH-1095/1096 phone preboot routes and native/provider token quarantine.
- Preserve provider-neutral payout language.
- Preserve native picker parity by keeping native picker modules behind `.native` files or dynamic native-only imports.

## Customer Impact

Business users on web can author core content after the ORCH-1095/1096 phone-browser work, but media-heavy controls still behave like native controls. That means a creator may be able to reach a web route, start an event/trip/experience or marketing workflow, then fail when selecting a cover, avatar, stop photo, activity snap, menu PDF, or other local file.

This is a launch blocker for true business-web completion because media is not optional in the product model: covers, brand avatars, stop photos, menu snaps, and activity evidence are part of how a seller makes a page feel trustworthy and shoppable.

## Confirmed Findings

### F1: CoverPicker desktop web advertises local upload but the default web picker is a stub

Evidence:

- `mingla-business/src/components/ui/CoverPicker.tsx` imports browser/default `coverPickerDeviceMedia` through a platform split and calls it for image/GIF and video cover picks.
- `mingla-business/src/components/ui/coverPickerDeviceMedia.ts` returns canceled/denied on the default web path.
- `mingla-business/src/components/ui/coverPickerDeviceMedia.native.ts` dynamically imports `expo-image-picker`, which is the correct native parity pattern.
- `CoverPicker.tsx` intentionally disables image/video device upload on phone web with copy, but desktop web buttons remain enabled while the web implementation still cannot open a browser file picker.
- Source refs: `CoverPicker.tsx:53`, `CoverPicker.tsx:189`, `CoverPicker.tsx:384-385`, `CoverPicker.tsx:483-484`, `CoverPicker.tsx:1074`, `CoverPicker.tsx:1084`, `coverPickerDeviceMedia.ts`, `coverPickerDeviceMedia.native.ts`.

Impact:

- Phone web has an explicit degraded state from ORCH-1088.
- Desktop web has a broken promise: the UI offers local cover upload, then immediately falls into a denied/canceled path.
- GIF and stock image provider tabs are not the root cause.

Classification: in scope for ORCH-1097.

### F2: Cover media storage and byte readers are not the blocker

Evidence:

- Event/brand/experience cover upload services already use platform file readers that can read web `uri` values through browser fetch/arrayBuffer paths.
- Native readers remain split into `.native` files and can continue to use `expo-file-system` only on native.

Impact:

- ORCH-1097 does not need backend or storage changes for the primary picker slice.
- A browser picker can provide a Blob/File-backed object URL or data URL and feed the existing upload services.

Classification: non-cause; preserve current service contract.

### F3: Brand avatar picker and creator profile photo picker are web-visible controls wired to native permission stubs

Evidence:

- `mingla-business/src/components/brand/BrandAvatarPickerSheet.tsx` uses `platformImagePicker`.
- `mingla-business/app/account/edit-profile.tsx` uses the same picker helper for creator avatar selection.
- The default `mingla-business/src/utils/platformImagePicker.ts` denies media/camera permission and returns canceled on web.
- Brand and creator avatar file readers have web paths capable of reading browser URIs when a real browser-selected file exists.
- Source refs: `BrandAvatarPickerSheet.tsx:52-55`, `BrandAvatarPickerSheet.tsx:111`, `edit-profile.tsx:59-61`, `edit-profile.tsx:167`, `platformImagePicker.ts:27`.

Impact:

- Web users see device/avatar selection UI, but receive permission-denied behavior instead of a browser file chooser.
- Account edit profile remains unpromoted for ORCH-1095 phone direct-entry, so this should not expand the phone route surface without explicit proof.

Classification: in scope for source/control hardening; phone route promotion remains out of scope.

### F4: Experience stop photo device upload is unavailable on web, while provider selections work

Evidence:

- `mingla-business/src/components/experience/ExperienceStopPhotoSheet.tsx` uses `platformImagePicker` for the Library tab.
- The same sheet can still add Giphy/Pexels/public URL media through provider selections.
- The upload service can read web file bytes if supplied with a browser-readable URI.
- Source refs: `ExperienceStopPhotoSheet.tsx:61-63`, `ExperienceStopPhotoSheet.tsx:277`.

Impact:

- Local stop-photo upload and multi-add are unavailable on web.
- Provider media is not blocked and should not be rewritten.

Classification: in scope for ORCH-1097.

### F5: ActivitiesSnapInput and MenuSnapInput are broken for browser file ingestion

Evidence:

- `mingla-business/src/components/experience/ActivitiesSnapInput.tsx` and `mingla-business/src/components/experience/MenuSnapInput.tsx` directly import `expo-document-picker`.
- Both also use `platformImagePicker`, which denies/cancels on web.
- Both call `readAsStringBase64Async` from `utils/platformFileSystem`; the default web implementation throws `Native file reads are unavailable on web.`
- A separate browser-capable `utils/fileReader.ts` exists and can read blob/data URLs to base64, but these snap inputs do not use it.
- Source refs: `ActivitiesSnapInput.tsx:7`, `ActivitiesSnapInput.tsx:18`, `ActivitiesSnapInput.tsx:21-24`, `ActivitiesSnapInput.tsx:107`, `MenuSnapInput.tsx:7`, `MenuSnapInput.tsx:18`, `MenuSnapInput.tsx:21-24`, `MenuSnapInput.tsx:107`, `platformFileSystem.ts:2`, `fileReader.ts:5-6`.

Impact:

- Image/camera snap paths fail on web through picker stubs.
- PDF/document snap paths can also fail after selection because the web file-system reader throws.
- Direct `expo-document-picker` import keeps a native-provider token in a web-reachable component.

Classification: in scope for ORCH-1097.

### F6: Current CI guards do not cover the ORCH-1097 surface

Evidence:

- Existing `test:orch-1088`, `test:orch-1089`, `test:orch-1092`, `test:orch-1095`, and `test:orch-1096` scripts guard earlier route, preboot, provider, and trim-split contracts.
- ORCH-1095/1096 guards scan only promoted phone-preboot routes and composer runtime outputs.
- ORCH-1001 tests guard native video trim split behavior, not browser file selection across cover/avatar/snap controls.
- No `test:orch-1097` script exists.

Impact:

- A regression can reintroduce native picker imports or web-stub picker behavior in media controls without tripping the current suite.
- The implementation must add a source-level and export-level regression gate in the same feature commit.

Classification: in scope for ORCH-1097.

### F7: Checkout intake, group chat media, and scanner are real adjacent hazards but should not be silently bundled into this slice

Evidence:

- `mingla-business/src/components/checkout/intake/IntakeFilePickerChooserSheet.tsx` directly imports `expo-document-picker` and uses `platformImagePicker`; it does have a Blob upload path after a selected URI exists.
- `mingla-business/src/components/groupChat/GroupChatPanel.tsx` directly imports `react-native-keyboard-controller`, uses `platformImagePicker`, and posts attachments using a React Native FormData file shape rather than browser File/Blob.
- `mingla-business/app/event/[id]/scanner/index.tsx` directly imports `expo-camera` and `expo-haptics`.
- Source refs: `IntakeFilePickerChooserSheet.tsx:27`, `IntakeFilePickerChooserSheet.tsx:42-45`, `IntakeFilePickerChooserSheet.tsx:136`, `GroupChatPanel.tsx:16`, `GroupChatPanel.tsx:31-33`, `GroupChatPanel.tsx:86`, `scanner/index.tsx:40`.

Impact:

- These are legitimate future web-completion hazards.
- They touch buyer checkout, chat, and door-ops flows that are not the primary business-authoring media-picker slice and may require separate UX/runtime proof.

Classification: discovered adjacent hazards; explicitly out of ORCH-1097 unless the orchestrator broadens scope.

## Surface Matrix

| Surface | Current browser behavior | Root cause | ORCH-1097 decision |
|---|---|---|---|
| Event/trip/experience/brand cover picker | Provider tabs work; local desktop upload appears enabled but cannot select; phone web degraded by copy | Web device picker stub | In scope |
| Cover video picker | Phone web intentionally degraded; desktop web cannot use native picker path | Web device picker stub; video support needs browser proof | In scope with conservative browser contract |
| Brand avatar picker | Button exists; web receives permission denial | `platformImagePicker` web stub | In scope |
| Creator profile avatar | Same picker issue; phone direct route still unpromoted | `platformImagePicker` web stub | Source/control in scope; route promotion out |
| Experience stop photos | Giphy/Pexels work; local file upload does not | `platformImagePicker` web stub | In scope |
| Activities snap | Image/camera/PDF not browser-safe | Direct `expo-document-picker`; web file-system throw | In scope |
| Menu snap | Same as activities snap | Direct `expo-document-picker`; web file-system throw | In scope |
| Checkout intake file upload | Adjacent buyer-web file surface; partial Blob path exists | Native picker import/stub mix | Defer unless widened |
| Group chat image attachments | Route attachment flow not browser-safe | Keyboard controller import; native FormData file shape | Defer |
| Scanner | Native camera route | Direct `expo-camera` | Defer to door-ops slice |

## Non-Causes

- No Supabase table, RLS, bucket, storage policy, edge function, or provider credential change is needed for the primary media-picker controls.
- No Giphy or Pexels API change is needed; provider selections are working where already supported.
- No Stripe, Paystack, payout, or provider-copy work is involved.
- No ORCH-1095/1096 phone route promotion should be changed as part of this investigation.
- No native picker behavior needs to be rewritten; native should continue through `.native` files and dynamic native imports.

## Risk Register

| Risk | Severity | Why it matters | Mitigation |
|---|---:|---|---|
| Browser file inputs accidentally run at module import time | High | Could break preboot/static export or SSR-like route evaluation | Create input only inside user-initiated handlers; guard `document/window` access |
| Native picker parity regresses | High | Mobile authoring already depends on Expo picker behavior | Keep native paths in `.native` files and do not change native service contracts |
| Phone-web video upload becomes flaky | Medium | Mobile Safari/Chrome video file support varies by file size and codec | Keep video degraded on phone unless physical proof passes; allow desktop first |
| Blob object URLs leak | Medium | Repeated selections can retain memory | Revoke object URLs after upload/clear/unmount |
| Snap file base64 path accepts unsupported MIME | Medium | AI ingestion UX can fail late | Add explicit MIME/size gates before reading |
| Guard too broad blocks allowed native files | Medium | Native implementations need picker modules | Scope guard exclusions to `.native.*`, tests, and documented native-only routes |

## Recommended Scope Boundary

ORCH-1097 should implement browser-safe local file controls for business-authoring media surfaces:

- CoverPicker image/GIF local upload on desktop web and phone web where browser proof passes.
- CoverPicker video local upload on desktop web only, with phone-web degraded copy unless proven.
- Brand avatar and creator avatar browser image selection.
- Experience stop-photo browser multi-add image selection.
- Activities and menu snap browser image/PDF selection using browser Blob/File readers.
- Regression guards that prove native picker modules stay out of web media-control paths.

ORCH-1097 should not implement:

- Checkout intake upload parity.
- Group chat attachment parity.
- Scanner/camera route parity.
- Backend/provider/schema/storage policy changes.
- Vercel deployment from the worktree.
- Native OTA.

## Hard Stop

No hard stop blocks implementation after orchestrator review. The only decision needed is whether to accept the recommended narrow scope or expand ORCH-1097 to include adjacent checkout/chat/scanner hazards, which would materially increase risk and test burden.
