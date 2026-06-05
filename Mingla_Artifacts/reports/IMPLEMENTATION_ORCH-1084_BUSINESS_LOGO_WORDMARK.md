# IMPLEMENTATION — ORCH-1084 [business-logo-wordmark]

**Official Mingla Business logo replaces the "Mingla Business" text wordmark — web + iOS + Android**

- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1084-[business-logo-wordmark]/`
- **Branch:** `ORCH-1084-business-logo-wordmark`
- **Status:** implemented and verified (web build surface → CLOSE needs `[deploy]`; native side needs an OTA)
- **Date:** 2026-06-05

---

## 1. Summary

The Mingla Business welcome/auth screen showed an orange uppercase **"MINGLA BUSINESS"** text
badge as the apparent brand mark, with empty/odd space above it. ORCH-1084 replaces that text
wordmark with the **official Mingla Business logo image** as the single, clean brand mark.

This screen (`BusinessWelcomeScreen.tsx`) is one shared React Native component rendered on all
three surfaces — web (business.usemingla.com), iOS, and Android — so the single edit covers all
three.

---

## 2. Root cause of the "empty space + only text shows" symptom

The screen already `require`d the correct official asset:

```ts
const logo = require("../../../assets/brand/mingla-business-logo.png");
```

…and rendered it as `<Image source={logo} style={styles.logo} resizeMode="contain" />`.

**But `styles.logo` set `aspectRatio: 1356 / 480`** — the *wide* ratio of the *consumer* wordmark
(`mingla_official_logo.png`, 1356×480). The official business asset is **2000×2000 (square)**.
With `resizeMode="contain"` inside a box forced to a 2.83:1 wide aspect ratio, the square lockup
was letterboxed into a thin sliver — visually it read as "empty space above the text." The orange
`<Text>businessBadge` underneath was therefore the only thing clearly visible, which is exactly
what the screenshot showed.

So the screen had a **double mark** (Image lockup + text badge), but the Image was mis-sized to
near-invisibility.

---

## 3. Asset chosen — and why

| Asset | Dimensions | Alpha | Content | Verdict |
|---|---|---|---|---|
| `assets/brand/mingla-business-logo.png` | **2000×2000 (square)** | yes | "Mingla" wordmark + pretzel symbol + **"BUSINESS"** pill — full official lockup | **CHOSEN** |
| `assets/brand/mingla-business-logo.svg` | vector | yes | same lockup | rejected — no SVG transformer |
| `assets/mingla_official_logo.png` | 1356×480 (wide) | yes | "Mingla" wordmark + pretzel only — **no "Business"** (consumer mark) | rejected — not the business lockup |

**Chosen: `assets/brand/mingla-business-logo.png`** — it IS the official Mingla Business logo: it
contains the "Mingla" wordmark, the pretzel symbol, AND the "BUSINESS" pill in one coherent
lockup. It is the asset already imported by the code; the only bug was the wrong aspect ratio.

**SVG rejected:** `react-native-svg` (15.12.1) is present as a *runtime* dependency, but
`react-native-svg-transformer` is **not** in `package.json` and `metro.config.js` has **no SVG
transformer configuration** (`grep -i svg metro.config.js` → no matches). Importing an `.svg`
via `require()` would not produce a renderable React component on Expo web or native without the
transformer. The PNG renders correctly on web (`<img>`) and native (expo-image / RN Image) with
no extra config, is retina-crisp (2000×2000 downscaled to ~220pt), has transparency, and looks
clean on the warm/white gradient background. PNG is the correct, lowest-risk choice.

**Consumer mark rejected:** `mingla_official_logo.png` lacks "Business" entirely, so it is not the
official *Business* logo.

---

## 4. Double-mark resolution

The official business logo already contains "Mingla **BUSINESS**" as a complete lockup, so the
separate `<Text>Mingla Business</Text>` orange badge was **redundant** with the logo. Stacking
both would be two competing marks (the dispatch's explicit "do NOT end up with two competing
marks").

**Resolution:** keep the single official-logo `<Image>` (now correctly sized) as THE brand mark,
and **remove the redundant orange text badge** (`<Text style={styles.businessBadge}>Mingla
Business</Text>`) and its now-orphaned `businessBadge` style. One clean official-logo presentation.

Accessibility is preserved: the `<Image>`'s `accessibilityLabel` was changed from "Mingla logo"
to **"Mingla Business"** so screen readers still announce the full brand name now that the text is
gone.

---

## 5. Old → New receipt

### `mingla-business/src/components/auth/BusinessWelcomeScreen.tsx`

**What it did before:**
- Rendered `<Image source={logo} style={styles.logo} resizeMode="contain" accessibilityLabel="Mingla logo" />` where `styles.logo` had `aspectRatio: 1356 / 480` (wide consumer ratio) → squashed the square 2000×2000 official asset into a thin letterbox.
- Rendered a separate `<Text style={styles.businessBadge}>Mingla Business</Text>` orange uppercase badge directly below.
- Defined a `businessBadge` style (orange `colors.accent`, uppercase, letter-spacing).

**What it does now:**
- Renders the same official-logo `<Image>` with `accessibilityLabel="Mingla Business"`, and `styles.logo` now uses `aspectRatio: 1` (square, matching the source) at `width: s(220)`, `maxWidth: "62%"` so the full lockup renders un-distorted and legibly.
- The orange `<Text>Mingla Business</Text>` badge is **removed** — the logo is the brand mark.
- `businessBadge` style **removed**; `logoContainer.marginBottom` bumped `vs(12)→vs(18)` for breathing room now that the text no longer sits between the logo and the headline.
- The logo `<Image>` is still wrapped in the existing `Animated.View` driven by `logoOpacity`/`logoScale`, so the entrance fade+scale animation is preserved unchanged.

**Why:** the official Mingla Business logo must be the single clean brand mark on web + iOS + Android (ORCH-1084), with no competing text wordmark and no distortion.

**Lines changed:** ~22 (1 JSX element + 1 accessibility label removed/changed, 1 style block removed, 1 style block adjusted, comments added).

### `mingla-business/__tests__/components/BusinessWelcomeScreenLogo.test.tsx` (NEW)

Regression test (see §7).

---

## 6. Cross-surface impact

| Surface | Affected? | What changes | Parity |
|---|---|---|---|
| Consumer iOS (`app-mobile`) | No | Different app; no business welcome screen here | — |
| Consumer Android (`app-mobile`) | No | Same | — |
| Buyer/anonymous Web | No | Buyer-anon routes don't render the business auth screen | — |
| **Business iOS** (`mingla-business`) | **Yes** | Welcome/auth screen now shows official logo, no text badge | **Automatic** — shared component |
| **Business Android** (`mingla-business`) | **Yes** | Same | **Automatic** — shared component |
| **Business Web** (`business.usemingla.com`) | **Yes** | Same | **Automatic** — shared component |
| Admin Web | No | Admin doesn't render this screen | — |

All three target surfaces (web + iOS + Android) are covered by the single shared
`BusinessWelcomeScreen.tsx`. Parity is automatic — one render path.

---

## 7. Regression test

**Path:** `mingla-business/__tests__/components/BusinessWelcomeScreenLogo.test.tsx`

Follows the established `mingla-business` convention (ts-jest, `testEnvironment: node`,
source-assertion tests — same shape as the existing `BrandCreationFlow.test.tsx`). Two tests:
- **SC-1** asserts the screen renders the official `mingla-business-logo.png` as an `<Image source={logo}>` with `resizeMode="contain"`, `accessibilityLabel="Mingla Business"`, square `aspectRatio: 1`, and NOT the old `aspectRatio: 1356 / 480`.
- **SC-2** asserts the screen does NOT render the `<Text style={styles.businessBadge}>` "Mingla Business" badge and that the `businessBadge` style is gone.

**Passing run (fixed code):**
```
PASS __tests__/components/BusinessWelcomeScreenLogo.test.tsx
  ✓ SC-1 renders the official Mingla Business logo Image (square lockup)
  ✓ SC-2 does NOT render the orange 'Mingla Business' text wordmark badge
Tests: 2 passed, 2 total
```

**Fails-on-revert verified at `8781d6d1f`** (the pre-fix HEAD). With the component fix stashed
(test kept), both tests FAIL — SC-2 trips on the still-present `<Text style={styles.businessBadge}>`
and SC-1 trips on the still-present `aspectRatio: 1356 / 480`:
```
Tests: 2 failed, 2 total
> 42 | expect(source).not.toMatch(/<Text[^>]*styles\.businessBadge[^>]*>/);
```
After `git stash pop`, the suite passes again (2 passed).

**Shipped in the same branch/PR as the fix** (untracked → committed together).

---

## 8. No regressions

`npx jest __tests__/components` → `BrandCreationFlow` PASS, `BusinessWelcomeScreenLogo` PASS.
`PublicBrandPage.dataDriven` fails, but this is **pre-existing and unrelated**: it also fails on a
clean HEAD with all ORCH-1084 changes stashed (3 failed / 1 passed), and ORCH-1084 never touches
`PublicBrandPage.tsx`. Logged as a Discovery below.

`tsc --noEmit` not run: TypeScript is not installed in `mingla-business` node_modules (no
`mingla-business/node_modules/.bin/tsc`; the package has no `typescript` dep). The change is
type-trivial — it removes a JSX element + a `ViewStyle`/`TextStyle` object and changes a numeric
style value + a string literal; it introduces no new type surface, and the file already compiled.

---

## 9. Invariants / animation / scope

- **Animation preserved:** the logo `<Image>` remains inside the existing `Animated.View` (`logoOpacity` fade + `logoScale` scale-in); behavior unchanged.
- **Scope:** only the welcome-screen wordmark touched. No auth logic, no other screens, no other styling beyond the spacing tweak needed for a clean single-mark layout.
- **Android glass policy / other invariants:** not implicated (no glass surfaces, no translucent fills changed).

---

## 10. Deploy notes (for CLOSE)

- This touches a **web-built surface** (`business.usemingla.com`), so the **CLOSE commit must carry the `[deploy]` tag** to trigger the Vercel business-web deploy.
- The **native side (Business iOS + Android) needs an OTA** — this is a pure-JS/asset change (no native module / config change), so `eas update --platform ios` then `--platform android` (per-platform, never `--platform all`) ships it to the business app's prod channel. No native rebuild required.

---

## 11. Discoveries for Orchestrator

- **Pre-existing failure:** `mingla-business/__tests__/components/PublicBrandPage.dataDriven.test.tsx` fails on clean `main`-anchored HEAD (`8781d6d1f`), independent of ORCH-1084. It expects `const EventsTab` / `const TripsTab` / `const ExperiencesTab` string forms in `PublicBrandPage.tsx` that no longer match the current source. Worth a small triage ORCH to repoint or refresh that locked test.
