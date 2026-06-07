# QA_RETEST_ORCH-1097_BUSINESS_WEB_MEDIA_PICKER_CONTROLS

## Verdict

PASS.

The bounded rework removes the prior P2 automated coverage gap. The new adapter tests and component-contract tests now run through `npm run test:orch-1097`, fail against the old `fd5da4018` adapter for the exact `validate:false` empty-file regression, and pass at `f960afae0`.

No P0/P1 blockers were found. The remaining authenticated OS file-picker and iPhone Safari checks are still runtime manual smoke gates from the original QA report, not release-blocking automation gaps for this bounded rework.

## Scope Retested

In scope:

- P2 automated coverage gap from the original QA report.
- `pickBrowserFiles({ validate: false })` adapter behavior for stop-photo per-file validation.
- `npm run test:orch-1097`.
- `npm run test:orch-1096`.
- `npm run web:export`.
- Export/native-token/provider-neutral preservation.
- No backend/provider/schema/storage/edge/deploy/merge/OTA/reap mutation.

Out of scope:

- Checkout intake uploads.
- Group chat attachments.
- Scanner/camera parity.
- Payout, Stripe, Paystack, Ari, Hub/detail.
- Live authenticated upload behavior and physical iPhone Safari proof, except as manual gates.

## Findings

| Severity | Finding | Evidence | Required action |
|---|---|---|---|
| P4 NOTE | Authenticated OS file picker and iPhone Safari runtime proof remain manual gates, clearly separate from the automated rework verdict. | Original QA already listed these as runtime gates. This retest did not use a logged-in business account or physical iPhone Safari. The rework goal was to close the automated P2 gap, and that is now proven. | Keep the original manual smoke matrix before deploy or during orchestrator close acceptance. |

No P0, P1, P2, or P3 findings remain for the bounded rework.

## Claim Table

| Claim | QA status | Evidence |
|---|---|---|
| `test:orch-1097` now includes adapter and component-contract coverage for the prior P2 gap. | VERIFIED | `mingla-business/package.json:61` runs the guard plus `browserFilePicker.test.ts` and `orch_1097_browser_picker_component_contracts.test.ts`. Current run passed: 2 suites, 14 tests. |
| `validate:false` really defers adapter validation so callers can skip invalid files per-file. | VERIFIED | `browserFilePicker.ts:99-112` adds a no-validation conversion path; `browserFilePicker.ts:192-195` uses it only when `options.validate === false`. |
| New tests fail on old code at `fd5da4018` for the exact empty-file failure. | VERIFIED | Temp worktree `/tmp/orch1097-old-proof` at `fd5da4018`, patched with only the new tests/package script, failed: `BrowserFilePickerError: Choose a non-empty file.` at `src/utils/browserFilePicker.ts:81`; `old-proof-exit=1`. |
| New tests pass after the adapter fix at `f960afae0`. | VERIFIED | `npm run test:orch-1097` passed at current HEAD: guard PASS, 2 Jest suites PASS, 14 tests PASS. |
| Component-contract tests cover the previously narrow source coverage gap. | VERIFIED | `orch_1097_browser_picker_component_contracts.test.ts:14-85` checks cover image/GIF/video preparation, phone-video degradation, brand/creator avatar browser branches, stop-photo remaining-slot/per-file invalid contract, and Activities/Menu image/PDF browser callbacks. |
| ORCH-1096 and prior guards remain preserved. | VERIFIED | `npm run test:orch-1096` passed through ORCH-1085, ORCH-1087, ORCH-1088, ORCH-1089, ORCH-1092, ORCH-1093, ORCH-1094, ORCH-1095, and ORCH-1096. |
| Web export remains green. | VERIFIED | `npm run web:export` passed and exported `web-build`; only the known non-blocking Sentry organization/project warning appeared. |
| Export bundle avoids forbidden native picker/provider tokens. | VERIFIED | Post-export guard passed. Manual scan returned `ABSENT` for `expo-image-picker`, `expo-document-picker`, `expo-file-system`, `expo-camera`, `react-native-keyboard-controller`, `Connect Stripe`, and `Payments & Stripe`. |
| Native picker parity remains preserved. | VERIFIED | Rework diff from `fd5da4018..HEAD` touches only `browserFilePicker.ts`, tests, `package.json`, and reports; no native picker implementation files changed during rework. ORCH-1097 guard still requires native split files and native imports there. |
| No backend/provider/schema/storage/edge mutation occurred. | VERIFIED | Rework diff from `fd5da4018..HEAD` includes no Supabase, provider, schema, storage, edge, payout, checkout, scanner, chat, Hub, or detail files. |

## Platform Matrix

| Surface | Result | Evidence |
|---|---|---|
| Business web automation | PASS | `npm run test:orch-1097`, `npm run test:orch-1096`, and `npm run web:export` all passed. |
| Business desktop browser runtime | MANUAL GATE | Not rerun with authenticated account in this bounded retest; original QA manual picker matrix remains applicable. |
| Android Chrome runtime | MANUAL GATE | Original QA had signed-out recovery proof; authenticated file chooser was not rerun in this bounded retest. |
| iPhone Safari | MANUAL GATE | Physical iPhone Safari remains unavailable in this retest. |
| Native iOS/Android picker parity | SOURCE PASS | No native files changed in rework; native split guard remains green. |
| Backend/admin/public | N/A | Not touched and outside scope. |

## Commands Run

```text
git status --short
git rev-parse --abbrev-ref HEAD
git rev-parse --short HEAD
git log -1 --oneline
```

Result: branch `ORCH-1097-business-web-media-picker-controls`, HEAD `f960afae0`, clean before report write.

```text
npm run test:orch-1097
```

Result: PASS.

```text
ORCH-1097 business web media picker controls guard PASS
PASS src/utils/__tests__/orch_1097_browser_picker_component_contracts.test.ts
PASS src/utils/__tests__/browserFilePicker.test.ts
Test Suites: 2 passed, 2 total
Tests: 14 passed, 14 total
```

```text
npm run test:orch-1096
```

Result: PASS.

Key excerpt:

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

```text
Web Bundled 169ms index.js (397 modules)
Exported: web-build
```

Non-blocking warning:

```text
[@sentry/react-native/expo] Missing config for organization, project.
```

```text
npm run test:orch-1097
```

Result after export: PASS; same 2 suites / 14 tests.

```text
rm -rf /tmp/orch1097-old-proof
git worktree add --detach /tmp/orch1097-old-proof fd5da4018
git diff fd5da4018..HEAD -- mingla-business/package.json mingla-business/src/utils/__tests__/browserFilePicker.test.ts mingla-business/src/utils/__tests__/orch_1097_browser_picker_component_contracts.test.ts > /tmp/orch1097-new-tests.patch
git -C /tmp/orch1097-old-proof apply /tmp/orch1097-new-tests.patch
ln -s current node_modules into /tmp/orch1097-old-proof/mingla-business/node_modules
npm run test:orch-1097
```

Result: expected FAIL on old code.

```text
FAIL src/utils/__tests__/browserFilePicker.test.ts
browserFilePicker › pickBrowserFiles can defer validation so callers skip invalid files per-file
BrowserFilePickerError: Choose a non-empty file.
at validateBrowserFile (src/utils/browserFilePicker.ts:81:11)
old-proof-exit=1
```

```text
node scripts/ci/orch-1097-business-web-media-picker-controls.mjs
for token in expo-image-picker expo-document-picker expo-file-system expo-camera react-native-keyboard-controller 'Connect Stripe' 'Payments & Stripe'; do rg web-build/_expo/static/js/web; done
```

Result: PASS and all manual scan tokens absent.

```text
ORCH-1097 business web media picker controls guard PASS
ABSENT expo-image-picker
ABSENT expo-document-picker
ABSENT expo-file-system
ABSENT expo-camera
ABSENT react-native-keyboard-controller
ABSENT Connect Stripe
ABSENT Payments & Stripe
```

## Manual Smoke Gate

These are not blockers to the automated rework verdict, but they should remain visible before deployment or close acceptance:

1. Sign in with a business account on desktop Chromium and verify cover image/GIF, desktop cover video, brand avatar, creator avatar, stop photos with mixed valid/invalid files, and Activities/Menu image/PDF snaps.
2. On Android Chrome, verify at least cover image, one avatar where reachable, stop-photo image selection, one snap image/PDF selection, and phone-video degraded copy.
3. On iPhone Safari, verify cover image file chooser opens, one snap input file chooser opens, and phone-video degraded copy appears.

## Deploy Readiness

- Migrations: none.
- Edge functions: none.
- Backend/provider/schema/storage/RLS: none.
- Native OTA: not expected.
- Business web deploy: only from merged `main` if orchestrator authorizes it; do not deploy from this ORCH worktree.

## Final Recommendation

Route to orchestrator for close. The P2 automated coverage gap is removed, the scoped adapter fix is correct, old-failure proof is exact, preservation gates are green, and the remaining runtime checks are explicit manual smoke gates rather than unresolved automated release blockers.
