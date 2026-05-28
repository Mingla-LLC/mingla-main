# POC_ORCH-0978_TRIMMER_RUNBOOK

Status: implemented, partially verified; STOP for Seth physical-iPhone PoC.
Timestamp: 2026-05-28 12:23 EDT.
Worktree: `/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]`
Branch: `ORCH-0978-video-upload-polish-and-cloudinary-lifecycle`

## Scope

Step 0 only for ORCH-0978 IMPLEMENT-7. This PoC adds `react-native-video-trim@8.1.0`, minimally wires the native Business cover-video picker to open the dedicated trimmer after Expo ImagePicker selection, logs the trim result, and uploads the returned clip through the existing cover-video pipeline.

Full IMPLEMENT-7 is intentionally not complete yet: no C12 strict-grep, no regression tests, no two-commit landing, no PR, no store submission.

## Files touched for this PoC

- `mingla-business/package.json` — added `react-native-video-trim`.
- `mingla-business/package-lock.json` — updated by `npm install react-native-video-trim@8.1.0`; note this file already had a large pre-existing resolved/integrity churn before this PoC.
- `mingla-business/src/components/ui/CoverPicker.tsx` — removed `allowsEditing: true` and `videoMaxDuration: 29` from the video picker path; native platforms now open `react-native-video-trim` after selection.
- `.easignore` and `mingla-business/.easignore` — added to keep EAS from archiving local ORCH worktree residue while building from this monorepo worktree.

## Library verification

- npm latest checked: `react-native-video-trim@8.1.0`.
- Package has no Expo config plugin in its published files. Expo guidance is prebuild/rebuild; Expo Go is not enough because this is a native module.
- Docs checked:
  - `https://github.com/maitrungduc1410/react-native-video-trim`
  - `https://www.npmjs.com/package/react-native-video-trim`
- Implementation note: the prompt shorthand says `maxDuration: 29`, but v8.1.0's types and native code treat `maxDuration` as milliseconds, so the PoC passes `29_000`.

## Current PoC behavior

Native iOS/Android:

1. User taps video cover upload.
2. Expo ImagePicker selects a video only; it no longer asks the picker to trim.
3. `react-native-video-trim` opens with `maxDuration: 29_000`.
4. On finish, Metro logs:

```text
[ORCH-0978-POC] { outputPath, duration, startTime, endTime }
```

5. The app re-stats the returned `outputPath`, normalizes it to a `file://` URI, and calls the existing `videoUpload.start` with the trimmed file.

Web:

Selection falls back to the existing file/duration path with the 33s source ceiling. No native trimmer is loaded on web.

## EAS dev build

Submitted iOS development build:

- Build ID: `905bbbb0-cc50-4abc-8011-ee1fb1442390`
- Logs URL: `https://expo.dev/accounts/sethogieva/projects/mingla-business/builds/905bbbb0-cc50-4abc-8011-ee1fb1442390`
- Status at runbook write: `IN_PROGRESS`
- Profile: `development`
- Distribution: `INTERNAL`
- Provisioned device includes Seth's iPhone UDID ending `A01E`.

Command used:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/mingla-business" && EAS_NO_VCS=1 npx eas build --platform ios --profile development --non-interactive --no-wait --message "ORCH-0978 trimmer PoC dev build"
```

Why `EAS_NO_VCS=1`: EAS otherwise archived the full ORCH worktree and stalled while copying sibling apps and local screenshots. The added `.easignore` files reduce the archive to a small Business-app build context while preserving `packages/` for shared imports.

## Metro

Metro is already running from the Business app worktree.

- PID: `87304`
- Local health check: `http://127.0.0.1:8090/status` returns `packager-status:running`
- Physical-iPhone URL: `http://172.20.9.90:8090`
- Requirement: Mac and iPhone must be on the same Wi-Fi. Tunnel is intentionally not used.

Restart command if needed:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/ORCH-0978-[video-upload-polish-and-cloudinary-lifecycle]/mingla-business" && npx expo start --dev-client --host lan --port 8090
```

## Seth PoC Gate

PASS only if all of this is true on physical iPhone:

1. Install/open the EAS development build once it finishes.
2. Connect the dev build to Metro at `http://172.20.9.90:8090` on the same Wi-Fi.
3. Open a published event cover editor and choose a source video longer than 29 seconds.
4. Confirm the dedicated trimmer opens, not the Expo/iOS picker trim sheet.
5. Drag the trim window to an arbitrary segment that is not the first 29 seconds, for example seconds 20-47.
6. Tap the trimmer save/use button.
7. Confirm Metro logs `[ORCH-0978-POC]` with `outputPath`, `duration`, `startTime`, and `endTime`.
8. Confirm the upload succeeds, the cover renders, and the visible cover starts at the chosen segment rather than the beginning of the source.

FAIL if the native module is missing, the trimmer does not open, the selected segment is ignored, `outputPath` is not playable, upload fails only because of the new trimmer file, or the cover shows the wrong segment.

## Verification

- `npm view react-native-video-trim version peerDependencies dependencies dist-tags --json` — latest is `8.1.0`; peer deps are React/React Native.
- `npm install react-native-video-trim@8.1.0` — completed; npm reported pre-existing vulnerability counts but installed the dependency.
- `npx eslint src/components/ui/CoverPicker.tsx` — exit 0; warnings only for pre-existing `ReadonlyArray<CoverProvider>` lines.
- `npx tsc --noEmit` — failed on unrelated existing app/shared-package type errors; no `CoverPicker`, `react-native-video-trim`, `NativeVideoTrim`, or `VideoTrim` errors appeared in the targeted filter.
- `curl http://127.0.0.1:8090/status` — `packager-status:running`.
- `EAS_NO_VCS=1 npx eas build:inspect --platform ios --profile development --stage archive ...` — completed; inspected archive size was 18 MB after `.easignore` additions.
- EAS iOS dev build submitted successfully; waiting on remote completion.

## Stop Condition

STOP here. Do not proceed to full wiring, tests, strict-grep C12, commits, PR, or store submission until Seth explicitly reports PoC PASS.
