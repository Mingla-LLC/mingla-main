# Implementation Report: Business Web Media Picker Controls (ORCH-1097)

> Date: 2026-06-07
> Mode: Spec Execute
> Spec: `Mingla_Artifacts/specs/SPEC_ORCH-1097_BUSINESS_WEB_MEDIA_PICKER_CONTROLS.md`
> Status: implemented and verified

## 1. Layman Summary

Business web users can now choose local files for the approved authoring media controls instead of hitting native permission stubs. This covers cover images/GIFs, desktop cover video selection, brand avatar, creator avatar, experience stop photos, and Activities/Menu image/PDF snaps. Native iOS/Android picker paths remain split through native-only files.

## 2. Request And Context

- **Request:** Implement the approved narrow ORCH-1097 scope and add repo-running regression tests.
- **Source:** Investigation/spec plus orchestrator approval in `Mingla_Artifacts/AGENT_HANDOFFS.md`.
- **Affected surfaces:** Mingla Business web media controls and native split preservation.
- **Related issues/artifacts:** ORCH-1091 cache recovery, ORCH-1093 OOM guards, ORCH-1095/1096 phone preboot contracts, COMMS provider-neutral payout warning.

## 3. Scope

- **In scope:** CoverPicker local files, brand/creator avatars, experience stop photos, Activities/Menu snap image/PDF browser selection, ORCH-1097 tests/guards, preservation-test updates for the changed phone-image contract.
- **Out of scope:** Checkout intake, group chat attachments, scanner/camera route parity, Ari, Hub/detail parity, backend/provider/schema/storage/edge changes, payout copy, deploy/merge/OTA/reap.
- **Assumptions:** Phone-web cover image upload is now allowed when the browser returns an image file; phone-web cover video remains degraded.

## 4. Files Read

| File | Why | Relevant finding |
|---|---|---|
| `src/components/ui/CoverPicker.tsx` | Cover image/video wiring | Phone image and video were both disabled; local picker used default web stub. |
| `src/components/ui/coverPickerDeviceMedia.ts/.native.ts` | Picker split | Web was canceled/denied stub; native used dynamic Expo imports. |
| `src/components/brand/BrandAvatarPickerSheet.tsx` | Brand avatar | Web called native permission helper. |
| `app/account/edit-profile.tsx` | Creator avatar | Web called native permission helper. |
| `src/components/experience/ExperienceStopPhotoSheet.tsx` | Stop photos | Web called native permission helper. |
| `src/components/experience/ActivitiesSnapInput.tsx` / `MenuSnapInput.tsx` | Snap inputs | Web-reachable files directly imported Expo document picker and web-throwing file-system shim. |
| ORCH-1088/1089/1095/1096 guards/tests | Preservation | Older ORCH-1088/1089 assertions pinned phone image degradation and needed contract updates. |

## 5. Blast Radius

- **Direct changes:** Business web media controls and local CI guards.
- **Cascade changes:** ORCH-1088/1089 preservation tests now encode the ORCH-1097 phone-image change while retaining phone-video degradation.
- **Parity surfaces:** Native snap inputs now live in `.native.tsx`; native cover picker keeps dynamic Expo imports.
- **Cache impact:** None.
- **State boundaries:** Local component picker/upload state only.
- **Auth/RLS/security:** No backend, schema, RLS, bucket, edge, or auth contract changes.
- **Deploy path:** Business web runtime change only; deploy after PR merge from `main` if orchestrator authorizes.

## 6. Old To New Receipts

### Browser Picker Adapter

- **Before:** No shared browser file input adapter existed for these controls.
- **After:** `src/utils/browserFilePicker.ts` creates `<input type="file">` only inside user actions, validates type/size/empty files, returns object URLs + metadata, reads File bytes as base64, and revokes object URLs.
- **Why:** Gives web controls a real browser-safe file contract without native modules.
- **Approx lines changed:** New file.

### Cover Picker

- **Before:** Web cover device picker returned canceled/denied; phone image/video buttons were disabled together.
- **After:** Web cover image/GIF uses the browser picker; desktop web video uses browser picker plus metadata read; phone video remains disabled/degraded; object URLs are revoked after upload.
- **Why:** In-scope users can choose local covers without native stubs while preserving the phone-video guard.
- **Approx lines changed:** `CoverPicker.tsx`, `coverPickerDeviceMedia.ts`, `coverPickerDeviceMedia.native.ts`.

### Avatars

- **Before:** Brand and creator avatar web flows requested native photo permissions and canceled.
- **After:** Web branches use the browser picker with avatar size/MIME limits; native branches keep the old permission + native picker behavior.
- **Why:** Browser avatar uploads work without route promotion or native path changes.
- **Approx lines changed:** `BrandAvatarPickerSheet.tsx`, `edit-profile.tsx`.

### Stop Photos

- **Before:** Browser stop-photo local upload hit native permission stubs.
- **After:** Browser multi-select uploads valid image files up to remaining slots and skips invalid files with explicit copy; provider tabs remain unchanged.
- **Why:** One bad file no longer discards all valid stop-photo selections.
- **Approx lines changed:** `ExperienceStopPhotoSheet.tsx`.

### Activities/Menu Snaps

- **Before:** Web-reachable snap inputs imported `expo-document-picker` and used `platformFileSystem.ts`, which throws on web.
- **After:** Default web files use browser image/PDF selection and `FileReader`; native copies preserve Expo document/image picker + native file-system behavior.
- **Why:** Web can ingest image/PDF snaps while native parity remains intact.
- **Approx lines changed:** `ActivitiesSnapInput.tsx`, `ActivitiesSnapInput.native.tsx`, `MenuSnapInput.tsx`, `MenuSnapInput.native.tsx`.

### Regression Guards

- **Before:** No `test:orch-1097` script; older guards pinned the pre-ORCH-1097 phone image degradation.
- **After:** `test:orch-1097` runs source/export guard + adapter unit tests; ORCH-1088/1089 tests now assert browser image enabled and phone video degraded.
- **Why:** The behavior change is protected in the same commit.
- **Approx lines changed:** `package.json`, `scripts/ci/orch-1097...mjs`, `browserFilePicker.test.ts`, ORCH-1088/1089 guard/test updates.

## 7. Implementation Details

- **Architecture decisions:** Browser picker is a web/default utility with no import-time DOM access; native picker modules remain in `.native` files or dynamic native imports.
- **Data flow:** Browser `File` -> object URL/metadata -> existing upload services; snap inputs use `FileReader` -> existing base64 payload shape.
- **Mutation/query behavior:** Existing upload services and mutations remain owners.
- **State handling:** Existing busy/error states preserved; browser errors surface as explicit messages.
- **Error handling:** Unsupported MIME, oversize, empty, unavailable picker, and read failures are deterministic.
- **Copy/accessibility:** Phone cover copy changed to say image uploads work in-browser while video remains desktop/app-only.
- **Analytics/notifications/realtime:** Not touched.

## 8. Spec / Goal Traceability

| Criterion / goal | Implemented | Verification | Status |
|---|---|---|---|
| Cover image/GIF browser selection | Yes | `test:orch-1097`, source review | PASS |
| Desktop cover video browser selection | Yes | `web:export`, `test:orch-1097`; manual runtime still advised | PASS with manual runtime gate |
| Phone-web cover video degraded | Yes | ORCH-1088/1089 updated guards + ORCH-1096 chain | PASS |
| Brand avatar browser selection | Yes | `test:orch-1097`, lint | PASS |
| Creator avatar browser selection without route promotion | Yes | `test:orch-1097`, ORCH-1095 chain | PASS |
| Stop-photo multi-add | Yes | Source guard + browser picker tests; manual runtime advised | PASS with manual runtime gate |
| Activities/Menu image/PDF browser reading | Yes | `test:orch-1097` source guard + adapter tests | PASS |
| Native picker parity | Yes | Native split files + ORCH-1097 guard + ORCH-1096 chain | PASS |
| No backend/provider/schema changes | Yes | Git diff review | PASS |

## 9. Invariant Verification

| Invariant | Relevant | Preserved | Notes |
|---|---|---|---|
| ORCH-1091 cache recovery | Yes | Yes | No cache/preboot changes. |
| ORCH-1093 OOM route guards | Yes | Yes | `npm run test:orch-1096` chained through ORCH-1093. |
| ORCH-1095/1096 phone preboot routes | Yes | Yes | `npm run test:orch-1096` passed. |
| Native-module quarantine | Yes | Yes | Source/export guard rejects native picker tokens in in-scope web files and web export bundle. |
| Provider-neutral payout copy | Yes | Yes | `npm run test:orch-1096` passed; no payout files changed. |
| No schema/backend mutation | Yes | Yes | No Supabase/backend files changed. |

## 10. Parity Check

- **Mobile:** Native picker behavior preserved through `.native` files/dynamic imports.
- **Business app:** In-scope business authoring surfaces changed on web.
- **Admin:** Not touched.
- **Public/web:** Not touched.
- **Solo/collab:** Business authoring only; group chat attachments explicitly deferred.
- **Gaps:** Physical Android Chrome/iPhone Safari media picker smoke tests remain manual/tester gates.

## 11. Cache And Persisted State Safety

- **Query keys changed:** None.
- **Invalidations added:** None.
- **Data shape changes:** None persisted; selected file metadata shape matches existing upload services.
- **AsyncStorage/Zustand impact:** None.
- **Cold start behavior:** No route promotion or preboot map changes.

## 12. Verification

| Check | Command / method | Result | Notes |
|---|---|---|---|
| Ledger ack | Direct `main` commit `560f62739` | PASS | COMMS WARN entries acknowledged. |
| Old-failure proof | Temp worktree at old HEAD `258cffc60`; ran current ORCH-1097 guard | FAIL as expected | Failed: `ActivitiesSnapInput.native.tsx is missing`. |
| ORCH-1097 gate | `npm run test:orch-1097` | PASS | Source/export guard + 4 adapter tests. |
| Preservation chain | `npm run test:orch-1096` | PASS | Chains ORCH-1085 through ORCH-1096. |
| Web export | `npm run web:export` | PASS | Exported `web-build`; Sentry config warning only. |
| Export native-token scan | Included in `test:orch-1097` with `web-build` present | PASS | Forbidden tokens absent from exported web JS. |
| Targeted lint | `npx eslint <changed files>` | PASS with warnings | 0 errors; 8 warnings remain, all style/pre-existing in touched files/tests. |
| Broad TypeScript | `npm run typecheck -- --noEmit` | BLOCKED by existing repo errors | Includes checkout implicit anys, payment package module gaps, package typings, and other pre-existing failures; not isolated to ORCH-1097. |

## 13. Regression Surface

1. Cover picker local image/video selection and phone-video degradation.
2. Avatar uploads on browser versus native picker parity.
3. Stop-photo multi-select and per-file invalid handling.
4. Snap input image/PDF ingestion on web and native document picker split.
5. Phone preboot/native provider token quarantine.

## 14. Risks, Limitations, Transition Items

| Item | Risk / temporary state | Exit condition | Location |
|---|---|---|---|
| Physical browser picker runtime | Automated tests prove source/export contracts, not real OS picker UX | Tester verifies Desktop Chromium, Android Chrome, and iPhone Safari smoke paths | In-scope controls |
| Phone-web cover video | Still degraded by design | Separate ORCH or physical proof expands phone video | `CoverPicker.tsx` |
| Checkout/chat/scanner hazards | Still not browser-safe | Separate scoped ORCHs | Out-of-scope files named in spec |

## 15. Discoveries For Orchestrator

- None requiring a new COMMS entry.

## 16. Deploy Notes

- **Migrations:** None.
- **Edge functions:** None.
- **Mobile OTA/native:** Not expected; native behavior path preserved.
- **Business/admin web:** Business web runtime changed. Deploy only after PR merge to `main` if orchestrator marks the merge/deploy commit appropriately; do not deploy from this worktree.
- **Env vars/secrets:** None.

## Suggested Commit Message

```text
business-web: add browser media picker controls

Resolves: ORCH-1097
Evidence: npm run test:orch-1097; npm run test:orch-1096; npm run web:export
Deploy: Business web deploy after merged main only; no backend/schema/OTA
```

## Ready-To-Test Checklist

1. Desktop Chromium: open business web from this branch, create/edit a cover, choose a local image/GIF, and confirm it uploads; choose desktop video and confirm it starts upload or shows existing video validation.
2. Brand/account: choose a brand avatar and creator avatar from browser file picker; confirm preview/public URL updates.
3. Experience stop photos: select two valid images and one invalid/oversized file; valid files should upload and invalid file should be skipped with copy.
4. Activities/Menu: choose an image and a PDF in each snap input; payload should read without native permission/file-system errors.
5. Phone browsers: verify cover image picker opens; verify cover video remains desktop/app-only; verify one snap image/PDF picker opens.
