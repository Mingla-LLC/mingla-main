# INVESTIGATION — ORCH-1321 [android-media-permission-policy-strip]

**Date:** 2026-07-07
**App:** Mingla **Business** (`com.sethogieva.minglabusiness`) — CONFIRMED by Seth.
**Surface:** business-Android (Google Play). No consumer-app rejection reported, but consumer is at latent risk (see §6).
**Severity:** S1-high (launch-blocker for the Android business submission — Play will not promote a build that declares these permissions).
**Class:** launch-blocker / platform-compliance.
**Status:** INVESTIGATE complete (root cause PROVEN with file:line + Play API + library CHANGELOG evidence). Fix scoped; SPEC pending.

---

## 1. The rejection (verbatim scope)

> Photo and Video Permissions policy: Permission use is not directly related to your app's core purpose.
> … your app is not compliant with how the READ_MEDIA_IMAGES/READ_MEDIA_VIDEO permissions are allowed to be used.
> Remove the use of READ_MEDIA_IMAGES/READ_MEDIA_VIDEO permission from **all version codes within the submission** (production **and** testing tracks). Consider using the Android photo picker.

Google's Photo and Video Permissions policy: only apps whose **core purpose** requires *persistent, broad* access to the device's shared photo/video store (gallery apps, photo editors, backup tools) may hold `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO`. Apps that only **pick** a file occasionally (avatar, cover, chat attachment — exactly Mingla's use) must use the **Android Photo Picker**, which needs **no permission**.

## 2. Play Console state (pulled live via Google Play Developer API)

Authenticated with the EAS submit service account (`eas-submit@mingla-dev.iam.gserviceaccount.com`, project `mingla-dev`) using the key at `~/.mingla-secrets/playstore-mingla.json`; JWT→OAuth→`androidpublisher/v3` tracks.list. Raw dumps: `/tmp/orch-1321/tracks_business.json`.

**Business (`com.sethogieva.minglabusiness`) — every version code Google reviews:**

| Track | Release | Version code | Status |
|-------|---------|--------------|--------|
| production | 1.0.0 | **6** | completed |
| beta | 1.0.0 | **6** | completed |
| alpha | 1.0.0 | **6** | completed |
| internal | 1.0.1 | **13** | **draft** (pending review) |
| internal | 1.0.0 | 6 | completed |

So "all version codes within the submission" = **code 6 (1.0.0, live) and code 13 (1.0.1, draft)**. Both must stop declaring the media permissions before Google will pass the submission.

## 3. Root cause — where the permission comes from (PROVEN)

**`READ_MEDIA_IMAGES` — explicitly declared in source, still live.**
`mingla-business/app.json:50` lists `"android.permission.READ_MEDIA_IMAGES"` inside `expo.android.permissions` (also line 51 `READ_EXTERNAL_STORAGE`). Confirmed present at v1.0.1 (`git show 417f71e09:mingla-business/app.json` → line 50 identical) — i.e. it is baked into version code 13 (the draft under review) **and** the current v1.0.2 working tree. This is the primary, still-present offender.

**`READ_MEDIA_VIDEO` — from the old expo-image-picker library manifest in the already-uploaded builds.**
The picker library used to inject `READ_MEDIA_IMAGES` + `READ_MEDIA_VIDEO` via its own `AndroidManifest.xml`. That was **removed in expo-image-picker 16.0.0** (2024-10-22, PR expo/expo#31902 — `node_modules/expo-image-picker/CHANGELOG.md:156`): *"Remove READ_MEDIA_IMAGES and READ_MEDIA_VIDEO permissions."* The app now runs **17.0.11** (post-removal): its `android/src/main/AndroidManifest.xml` declares only `CAMERA` + `READ_EXTERNAL_STORAGE` + `WRITE_EXTERNAL_STORAGE` — **no READ_MEDIA_***. The live builds (codes 6/13) were produced when this line still carried the pair (or Google's policy boilerplate always names the IMAGES/VIDEO pair regardless of which is literally declared). Either way, a fresh build no longer picks up VIDEO from the library — but **still ships READ_MEDIA_IMAGES from app.json** and would be rejected again.

**No other source.** Full scans found zero `READ_MEDIA_*` in any other `node_modules/*/AndroidManifest.xml`, in `react-native-compressor`, or `expo-modules-core`. Neither app is prebuilt (no committed `android/` dir) — the manifest is generated at EAS build from app.json + config plugins + library manifests.

## 4. Why it's not config-only — the code GATES on the permission

The picker call sites don't just declare the permission; they **request it and block the pick on denial**. Example — `mingla-business/src/components/ui/CoverPicker.tsx:412-421`:

```ts
const ensureMediaPermission = useCallback(async (): Promise<boolean> => {
  const permission = await requestCoverMediaLibraryPermission();   // → ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!permission.granted) {
    showUploadError(new EventCoverMediaError("permission_denied", "Photo library permission denied."));
    return false;                                                   // ← BLOCKS the pick
  }
  return true;
}, [showUploadError]);
```

Same "request media-library permission → gate the pick" pattern in **~10 call sites**:
`platformImagePicker.native.ts:21`, `coverPickerDeviceMedia.native.ts:23`, `CoverPicker.tsx:413`, `BrandAvatarPickerSheet.tsx:104`, `GroupChatPanel.tsx:78`, `IntakeFilePickerChooserSheet.tsx:129`, `TripDayMediaSheet.tsx:329`, `ExperienceStopPhotoSheet.tsx:320`, `MenuSnapInput.native.tsx:102`, `ActivitiesSnapInput.native.tsx:102` (+ the `usePermissionWithFallback` hook).

Consequence: if we *only* strip the manifest permission, then on Android 13+ `requestMediaLibraryPermissionsAsync()` returns `granted:false` (no permission to grant) → every gallery pick **dies** with "Photo library permission denied." So the code must **stop gating the gallery pick on that permission on Android** and call `launchImageLibraryAsync()` directly — expo-image-picker v17 routes that through the **Android Photo Picker**, which needs no permission. (Camera stays gated on `CAMERA`; iOS stays gated on `NSPhotoLibraryUsageDescription` — neither is affected by this policy.)

## 5. The fix (three parts — for the SPEC)

1. **`mingla-business/app.json`** — remove `"android.permission.READ_MEDIA_IMAGES"` (line 50) and `"android.permission.READ_EXTERNAL_STORAGE"` (line 51). Add `expo.android.blockedPermissions` to force-strip any library-merged residue from the final manifest (belt-and-suspenders that also kills the historical VIDEO): `["android.permission.READ_MEDIA_IMAGES", "android.permission.READ_MEDIA_VIDEO", "android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE"]`. (`blockedPermissions` emits `tools:node="remove"` in the merged manifest.)
2. **Picker code** — on Android, do NOT gate the gallery pick on `requestMediaLibraryPermissionsAsync()`; go straight to the photo picker. Cleanest: make `requestMediaLibraryPermissionsAsync` return `{granted:true}` on Android in the `platformImagePicker.native.ts` layer (photo picker needs no perm), or branch each site `Platform.OS === 'android' ? skip-gate : ensure`. Keep iOS gating and the camera/`CAMERA` gate intact. Verify no site still hard-requires the permission for the gallery path.
3. **Version bump + rebuild + resubmit** — `mingla-business/app.json` version 1.0.2 → **1.0.3**, new version code (EAS `autoIncrement`), fresh AAB, `eas submit` to internal, then send to Google review. Because a fresh AAB no longer declares the permissions, it clears the block; the old codes (6/13) are superseded by the new one in the reviewed set.

**CI guard (CLOSE Step 0.5):** a strict-grep / test that FAILS if `mingla-business/app.json` ever re-adds `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` / `READ_EXTERNAL_STORAGE` to `android.permissions` (and asserts they stay in `blockedPermissions`). New invariant `I-PROPOSED-1321-NO-ANDROID-MEDIA-PERMISSIONS`.

## 6. Cross-surface: the CONSUMER app is at latent risk

`app-mobile/app.json` does **not** explicitly declare `READ_MEDIA_IMAGES` (its android.permissions are location/camera/audio/calendar only). But the consumer app **also** calls `ImagePicker.requestMediaLibraryPermissionsAsync()` (`BetaFeedbackModal.tsx:288`, `MessageInterface.tsx:723`) and its **currently-live production build is code 16 (1.1.0)**. If code 16 was built with a pre-16.0.0 expo-image-picker, its AAB carries the library-injected `READ_MEDIA_*` and is equally non-compliant — Google may flag it on its next policy pass. A consumer rebuild on the current deps + the same `blockedPermissions` clears it. **Recommend applying the same strip to `app-mobile/app.json` proactively** rather than waiting for a second rejection. (Scope decision for Seth — see handoff.)

## 7. Evidence index
- Play API dump: `/tmp/orch-1321/tracks_business.json`, `/tmp/orch-1321/play_api.py`
- `mingla-business/app.json:48-54` (permissions array)
- `git show 417f71e09:mingla-business/app.json` (v1.0.1 = code 13 declared it too)
- `node_modules/expo-image-picker/CHANGELOG.md:156` (16.0.0 removed the perms)
- `node_modules/expo-image-picker/android/src/main/AndroidManifest.xml` (v17 = no READ_MEDIA_*)
- `mingla-business/src/components/ui/CoverPicker.tsx:412-421` (the gate) + 9 sibling call sites
