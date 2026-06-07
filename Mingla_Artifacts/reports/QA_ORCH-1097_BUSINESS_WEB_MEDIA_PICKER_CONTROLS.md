# QA_ORCH-1097_BUSINESS_WEB_MEDIA_PICKER_CONTROLS

## Verdict

CONDITIONAL PASS.

ORCH-1097's implementation is source-safe and export-safe for the approved browser media picker slice. The required local gates passed, the implementation commit is the requested `9e9c54f294b01e0c86cd6e18c64f2551b8c95657`, and the changed code preserves native picker splits, prior web-route guards, and provider-neutral payout copy.

The conditional items are not backend or schema risks. They are runtime and coverage gates: authenticated picker interaction was not proven in this session, iPhone Safari was not available, and `test:orch-1097` does not cover every browser picker behavior named in the spec.

## Scope Verified

In scope:

- Cover image/GIF and desktop video browser picker wiring.
- Phone-web cover image enabled and phone-web cover video degraded.
- Brand avatar browser picker.
- Creator avatar browser picker without route promotion.
- Experience stop-photo browser multi-add source path.
- Activities/Menu image and PDF browser snap input source path.
- Native picker parity through `.native` files and dynamic native imports.
- ORCH-1091, ORCH-1093, ORCH-1095, and ORCH-1096 guard preservation.
- Provider-neutral payout copy preservation.

Out of scope and not tested:

- Checkout intake uploads.
- Group chat attachments.
- Scanner/camera parity.
- Payout, Stripe, Paystack, Ari, Hub/detail, backend, provider, schema, storage, RLS, migrations, and edge functions.

## Findings

| Severity | Finding | Evidence | Required action |
|---|---|---|---|
| P2 MEDIUM | Authenticated picker runtime remains unverified. Source/export checks prove browser-safe code shape, but no logged-in business session was available to click actual file controls and verify upload/preview behavior across cover, avatar, stop-photo, Activities, and Menu flows. | Desktop and phone Chromium boot checks passed at `http://localhost:8098`; direct `/event/create` unauthenticated route showed bounded recovery. No authenticated business account/file chooser run was completed. | Before close/deploy, run the manual picker smoke matrix below or accept it as a post-merge manual gate. |
| P2 MEDIUM | iPhone Safari proof remains unverified. The spec allows this to become a manual gate when unavailable, but it cannot be silently treated as PASS. | Physical Android Chrome was available and tested. iPhone Safari was not available in this session. | Run iPhone Safari manual checks for cover image and one snap input; confirm phone-video degraded copy. |
| P2 MEDIUM | Regression coverage is narrower than the spec requested. The guard and four adapter unit tests are useful and fail on old code, but they do not automate all required cases: `pickBrowserFiles` cancel/single/multi/PDF flow, CoverPicker upload preparation, avatar branch behavior, stop-photo remaining-slot/per-file invalid behavior, or snap-input component callbacks. | `test:orch-1097` passes; `browserFilePicker.test.ts` covers MIME matching, invalid/oversize/empty rejection, object URL cleanup, and base64 read only. Source guard covers native-token quarantine and required tokens. | Accept as a bounded coverage gap or send to implementor for additional focused tests. |

No P0/P1 release blockers were found in the verified source/export/test surface.

## Claim Table

| Spec / implementation claim | QA status | Evidence |
|---|---|---|
| `test:orch-1097` exists and passes. | VERIFIED | `npm run test:orch-1097` passed: guard PASS plus 4 Jest tests. |
| `test:orch-1096` preservation chain remains green. | VERIFIED | `npm run test:orch-1096` passed through ORCH-1085, 1087, 1088, 1089, 1092, 1093, 1094, 1095, and 1096 checks. |
| Web export succeeds. | VERIFIED | `npm run web:export` passed and wrote `web-build`; only Sentry config warning was reported. |
| Exported web bundle excludes in-scope native picker/provider tokens. | VERIFIED | `node scripts/ci/orch-1097-business-web-media-picker-controls.mjs` passed after export; manual scan found `ABSENT` for `expo-image-picker`, `expo-document-picker`, `expo-file-system`, `expo-camera`, `react-native-keyboard-controller`, `Connect Stripe`, and `Payments & Stripe`. |
| CoverPicker web default picker is no longer denied/canceled stub. | VERIFIED SOURCE | `coverPickerDeviceMedia.ts` uses `pickBrowserFiles`; guard rejects `granted: false` and `canceled: true` stub tokens. |
| Phone-web cover video remains degraded. | VERIFIED SOURCE/TEST | `CoverPicker.tsx` disables video on `isPhoneWeb`; ORCH-1088/1089 tests passed with phone image enabled and video degraded. |
| Brand avatar and creator avatar use browser picker on web while preserving native picker helper on native. | VERIFIED SOURCE | `BrandAvatarPickerSheet.tsx` and `app/account/edit-profile.tsx` branch on `Platform.OS === "web"` and call `pickBrowserFiles`; native branch still uses `platformImagePicker`. |
| Experience stop photos support browser multi-select up to remaining slots and skip invalid files. | VERIFIED SOURCE, RUNTIME UNVERIFIED | `ExperienceStopPhotoSheet.tsx` uses `pickBrowserFiles` with `multiple`, `maxFiles: remaining`, validates each file, and skips invalid files. No authenticated upload runtime proof. |
| Activities/Menu snap inputs no longer import Expo document picker on web and use browser FileReader/base64. | VERIFIED SOURCE | Default `.tsx` files import `pickBrowserFiles` and `readBrowserFileAsBase64`; native copies import `expo-document-picker` and `platformFileSystem`. |
| Native picker parity is preserved. | VERIFIED SOURCE/TEST | Native split files exist for cover device media and both snap inputs; ORCH-1097 guard requires native files and checks native imports are present there. |
| No backend/provider/schema/storage/edge changes. | VERIFIED | `git diff --name-only HEAD~1..HEAD` contains business web files, scripts/tests, and artifacts only; no Supabase/backend/provider/schema files changed. |
| Provider-neutral payout copy preserved. | VERIFIED | ORCH-1096 chain passed; manual export scan found `ABSENT Connect Stripe` and `ABSENT Payments & Stripe`. |
| Regression guard fails before the implementation. | VERIFIED | Temp worktree at `258cffc60` with current ORCH-1097 guard failed: `ActivitiesSnapInput.native.tsx is missing`; exit `1`. |

## Platform Matrix

| Platform | Result | Evidence |
|---|---|---|
| Desktop Chromium | PARTIAL PASS | Expo dev server `http://localhost:8098` rendered sign-in screen with no page or console errors. Authenticated picker controls were not exercised. |
| Android Chrome physical device | PARTIAL PASS | ADB device `R58R54YV7JT` opened `http://172.20.17.113:8098/event/create`; screenshot showed signed-out recovery with "Sign in to create an event", "Sign in again", and "Back to Home". |
| iPhone Safari | MANUAL GATE | Not available in this session. Spec requires manual proof if unavailable. |
| Native iOS/Android app picker paths | SOURCE PASS | Native behavior is preserved through `.native` split files and dynamic imports; no native runtime smoke was required because this slice should not change native behavior. |
| Admin/public/backend | N/A | Not in scope and not touched. |

## Commands Run

```text
git status --short
git branch --show-current
git rev-parse HEAD
git log --oneline -5
```

Result: clean worktree, branch `ORCH-1097-business-web-media-picker-controls`, HEAD `9e9c54f294b01e0c86cd6e18c64f2551b8c95657`.

```text
npm run test:orch-1097
```

Result: PASS.

Excerpt:

```text
ORCH-1097 business web media picker controls guard PASS
PASS src/utils/__tests__/browserFilePicker.test.ts
Test Suites: 1 passed, 1 total
Tests: 4 passed, 4 total
```

```text
npm run test:orch-1096
```

Result: PASS.

Excerpt:

```text
ORCH-1085 mobile-web sign-in PASS.
ORCH-1087 static route firewall PASS.
ORCH-1088 event creator phone parity PASS.
ORCH-1089 signed-in Event Creator wizard PASS.
ORCH-1092 business web restoration wave PASS.
ORCH-1093 signed-in route OOM PASS.
ORCH-1094 business web core parity PASS.
ORCH-1095 business web interactive parity guard PASS
ORCH-1096 business web Marketing Composer parity guard PASS
```

```text
npm run web:export
```

Result: PASS.

Excerpt:

```text
Web Bundled 158ms index.js (444 modules)
Exported: web-build
```

Sentry config warning appeared and is non-blocking for this slice.

```text
node scripts/ci/orch-1097-business-web-media-picker-controls.mjs
```

Result: PASS after export.

```text
for token in expo-image-picker expo-document-picker expo-file-system expo-camera react-native-keyboard-controller stripe_inactive "Connect Stripe" "Payments & Stripe"; do rg web-build/_expo/static/js/web; done
```

Result: all listed tokens were absent.

```text
Temp worktree at 258cffc60 + current ORCH-1097 guard
```

Result: expected FAIL.

Excerpt:

```text
ORCH-1097 business web media picker controls FAIL: src/components/experience/ActivitiesSnapInput.native.tsx is missing
old-proof-exit=1
```

```text
python3 -m http.server 8097 --directory web-build
```

Result: static server served `index.html`, but root rendered Expo Router `No routes found` under the generic static fallback. This does not refute `web:export`, but it is not useful for authenticated runtime proof.

```text
npx expo start --web --port 8098
```

Result: Expo dev server bundled and served web at `http://localhost:8098`.

```text
Playwright Chromium desktop + phone boot to http://localhost:8098/
```

Result: PASS.

Excerpt:

```json
{
  "title": "Business",
  "body": "List experiences, reach guests, and grow - simply. Continue with Apple Continue with Google Continue with Email ...",
  "errors": []
}
```

```text
Playwright Chromium phone boot to http://localhost:8098/event/create
```

Result: PASS signed-out recovery.

Excerpt:

```json
{
  "url": "http://localhost:8098/event/create",
  "body": "Sign in to create an event. Your browser session is not available on this route. Sign in again Back to Home",
  "errors": []
}
```

```text
adb -s R58R54YV7JT shell am start -a android.intent.action.VIEW -d http://172.20.17.113:8098/event/create com.android.chrome
adb -s R58R54YV7JT exec-out screencap -p > /tmp/orch1097_android_chrome_event_create.png
```

Result: PASS signed-out recovery on physical Android Chrome. Screenshot showed the same recovery copy and no blank/OOM state.

## Manual Smoke Gate

Run from the ORCH worktree or clean post-merge main surface. Current dev URL used for QA was `http://localhost:8098`; Android Chrome used `http://172.20.17.113:8098`.

1. Sign in with a business account on desktop Chromium.
2. In event/trip/experience/brand cover picker, choose a local image/GIF and confirm preview/upload succeeds.
3. On desktop Chromium, choose a local cover video and confirm upload starts or validation copy is correct.
4. On phone Chrome, confirm cover image picker opens and cover video remains "desktop/app only."
5. Choose a brand avatar and creator avatar from the browser picker and confirm preview/public URL updates.
6. In experience stop photos, select two valid images plus one invalid/oversized file; valid files should upload and invalid files should be skipped with copy.
7. In Activities and Menu snap inputs, choose one image and one PDF; payload should read without native permission or file-system errors.
8. On iPhone Safari, confirm cover image picker opens, one snap input opens, and phone-video degraded copy appears.

## Deploy Readiness

- Migrations: none.
- Edge functions: none.
- Backend/provider/schema/storage/RLS: none.
- Native OTA: not expected.
- Business web deploy: only after PR merge to `main`; do not deploy from this ORCH worktree.

## Final Recommendation

Proceed to orchestrator with CONDITIONAL PASS. The orchestrator can close only if Seth accepts the manual authenticated picker and iPhone Safari gates, or can route a bounded implementor follow-up for fuller automated browser picker/component coverage before close.
