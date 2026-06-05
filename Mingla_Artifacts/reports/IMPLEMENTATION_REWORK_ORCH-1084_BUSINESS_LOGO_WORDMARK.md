# IMPLEMENTATION REWORK - ORCH-1084 [business logo]

**Status:** implemented, partially verified  
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1084-[logo-close-sync]/`  
**Branch:** `ORCH-1084-logo-close-sync`  
**Date:** 2026-06-05

## Summary

Production web still hid the Mingla Business auth-screen logo after PR #378. The merged fix had the right official asset, but React Native Web rendered the image through an internal hidden `<img>` and an unstable image box. This rework gives the logo a fixed square contract and uses a plain web `<img>` for the business-web path while preserving the native RN `Image` path for iOS and Android.

No deploy, OTA, merge, or commit was run from this worktree. COMMS-0015 and COMMS-0018 remain binding: future web deploy and native OTA happen only after merge to `main`, from the promoted source.

## Root Cause

The live production probe showed:

| Field | Production symptom |
|---|---|
| Asset | official Mingla Business asset, `naturalWidth=2000`, `naturalHeight=2000` |
| Rendered image box | approximately `width=136`, `height=2000` |
| Visibility | `opacity=0` |
| Parent | mobile parent about `220x432` |

The original PR #378 fix changed the logo to the official square asset and `aspectRatio: 1`, but the style still relied on width plus percent `maxWidth`. RN Web then kept the internal image element hidden (`opacity:0`) and did not paint a visible background image. Local proof during this rework reproduced the same class after only the dimension fix: the box became `220x220`, but the RN Web internal `<img>` was still `opacity=0`.

Final root cause: this was not just a source-asset bug. It was a RN Web `Image` rendering contract bug: the web path needed a stable explicit square box and a visible DOM image instead of relying on RN Web's internal hidden `<img>` behavior.

## Fix

### `mingla-business/src/components/auth/BusinessWelcomeScreen.tsx`

- Added `LOGO_SIZE = Math.min(s(220), 220)` so the logo is responsive on smaller native/mobile widths but capped on desktop web.
- Added `WEB_LOGO_SRC = "/brand/mingla-business-logo.png"` for web. This public asset is already present in `mingla-business/public/brand/` and copied into static export as `web-build/brand/mingla-business-logo.png`.
- Updated `logoContainer` to explicit `width`, `height`, `justifyContent`, and `flexShrink:0`.
- Kept the native path as RN `<Image source={logo} style={styles.logo} resizeMode="contain" accessibilityLabel="Mingla Business" />`.
- Switched only `Platform.OS === "web"` to `React.createElement("img", ...)` with `width`, `height`, `objectFit:"contain"`, `display:"block"`, and `opacity:1`.

The official Mingla Business logo remains the single brand mark. The removed orange text badge was not reintroduced.

## Cross-Surface Matrix

| Surface | Impact | Verification |
|---|---|---|
| Consumer iOS | Not touched | Out of scope; different app |
| Consumer Android | Not touched | Out of scope; different app |
| Buyer/anonymous web | Not touched | Does not render `BusinessWelcomeScreen` |
| Business iOS | Touched via shared component, native RN `Image` path preserved | Source + focused regression tests |
| Business Android | Touched via shared component, native RN `Image` path preserved | Source + focused regression tests |
| Business web | Touched via shared component, web DOM `<img>` path added | Local static export + Playwright desktop/mobile DOM and screenshots |
| Admin web | Not touched | Out of scope |

## Regression Tests

### `mingla-business/__tests__/components/BusinessWelcomeScreenLogo.test.tsx`

Updated the happy-path source test so it now asserts:

- the official bundled business logo remains required for native;
- web uses a DOM `<img>`;
- web uses `/brand/mingla-business-logo.png`;
- web declares `objectFit:"contain"` and `opacity:1`;
- the wrapper and native image style both declare explicit equal dimensions;
- the old wide ratio and orange text badge remain banned.

### `mingla-business/__tests__/components/BusinessWelcomeScreenLogoAdversarial.test.tsx`

Expanded the adversarial suite so it catches the exact live-web failure class:

- wrapper and image must both have explicit equal width/height;
- percent `maxWidth` / `maxHeight` no longer satisfy the contract;
- `height:2000` and `opacity:0` are banned in the logo style bodies;
- web must use a real DOM `<img>` with `opacity:1`;
- native must still bind `<Image source={logo}>` to `styles.logo`;
- the source asset must still be a real square PNG.

Fails-on-revert note: I did not destructively revert the worktree to run the whole suite against the old file. The updated tests are designed to fail against the PR #378 source because that source has no `WEB_LOGO_SRC`, no web DOM `<img>`, no explicit `height: LOGO_SIZE`, and still uses percent `maxWidth`.

## Verification

### Focused Jest

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-1084-[logo-close-sync]/mingla-business
npx jest __tests__/components/BusinessWelcomeScreenLogo.test.tsx __tests__/components/BusinessWelcomeScreenLogoAdversarial.test.tsx --runInBand
```

Result:

```text
PASS __tests__/components/BusinessWelcomeScreenLogoAdversarial.test.tsx
PASS __tests__/components/BusinessWelcomeScreenLogo.test.tsx

Test Suites: 2 passed, 2 total
Tests:       7 passed, 7 total
```

### Local Web Export

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-1084-[logo-close-sync]/mingla-business
npm run web:export
```

Result: export succeeded. Warnings were Sentry config fallback and `NO_COLOR`/`FORCE_COLOR`; no logo or bundle failure.

### Playwright DOM + Screenshot Proof

Served the local export with:

```bash
node playwright/meta-orch-0952-static-server.mjs web-build 43186
```

Then probed desktop and mobile with Chromium. The static server was stopped afterward by killing only the exact local server PID on port `43186`.

Desktop proof:

```json
{
  "src": "/brand/mingla-business-logo.png",
  "alt": "Mingla Business",
  "role": "img",
  "naturalWidth": 2000,
  "naturalHeight": 2000,
  "rect": { "width": 220, "height": 220 },
  "opacity": "1",
  "display": "block",
  "visibility": "visible",
  "objectFit": "contain",
  "parentRect": { "width": 220, "height": 220 },
  "parentOpacity": "1",
  "viewport": { "width": 1440, "height": 1000 }
}
```

Mobile proof:

```json
{
  "src": "/brand/mingla-business-logo.png",
  "alt": "Mingla Business",
  "role": "img",
  "naturalWidth": 2000,
  "naturalHeight": 2000,
  "rect": { "width": 220, "height": 220 },
  "opacity": "1",
  "display": "block",
  "visibility": "visible",
  "objectFit": "contain",
  "parentRect": { "width": 220, "height": 220 },
  "parentOpacity": "1",
  "viewport": { "width": 390, "height": 844 }
}
```

Screenshot evidence:

- `Mingla_Artifacts/reports/orch-1084-evidence/desktop-after.png`
- `Mingla_Artifacts/reports/orch-1084-evidence/mobile-after.png`

### TypeScript

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-1084-[logo-close-sync]/mingla-business
npm run typecheck -- --noEmit
```

Result: failed on existing repo-wide issues outside this ORCH. No reported error referenced `BusinessWelcomeScreen.tsx` or the two ORCH-1084 test files. Representative existing failures include:

- `app/(tabs)/account.tsx(282,17): Type '"trending-up"' is not assignable to type 'IconName'`
- checkout buyer implicit `any` errors;
- `src/components/marketing/ComposerV2/*` type errors;
- shared `../packages/*` missing module/type errors.

## Changed Files

- `mingla-business/src/components/auth/BusinessWelcomeScreen.tsx`
- `mingla-business/__tests__/components/BusinessWelcomeScreenLogo.test.tsx`
- `mingla-business/__tests__/components/BusinessWelcomeScreenLogoAdversarial.test.tsx`
- `Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-1084_BUSINESS_LOGO_WORDMARK.md`
- `Mingla_Artifacts/reports/orch-1084-evidence/desktop-after.png`
- `Mingla_Artifacts/reports/orch-1084-evidence/mobile-after.png`

## Deploy / OTA Notes

No deploy or OTA was performed. Close can proceed only after independent tester/orchestrator verification and PR merge to `main`.

After merge to `main`, the web deploy should come from `main`, not this worktree. Native OTA should also be generated only from merged `main`, preserving COMMS-0015/0018 and the prior instruction that this branch's original OTA is not a durable deploy source.

## Residual Risk

Native runtime was not launched in this rework. Risk is low because the native branch still uses the same RN `<Image source={logo}>` path with explicit square dimensions and the same official bundled asset, but tester should still smoke iOS/Android after merge/OTA planning.
