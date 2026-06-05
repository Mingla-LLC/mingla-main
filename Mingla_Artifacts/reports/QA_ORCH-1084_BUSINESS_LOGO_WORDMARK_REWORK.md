# QA - ORCH-1084 [business-logo-wordmark] rework

**Verdict:** CONDITIONAL PASS  
**Mode:** TARGETED / REWORK VERIFY  
**Tester:** Codex `tester-mingla`  
**Date:** 2026-06-05  
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1084-[logo-close-sync]/`  
**Branch:** `ORCH-1084-logo-close-sync`  
**HEAD:** `7ccf01716` (`origin/main`, PR #378 merge commit)

## Executive Summary

The rework fixes the web invisibility/dimension regression locally. The business web export renders a visible plain DOM `<img>` for `Mingla Business` at `220 x 220`, `opacity: 1`, using `/brand/mingla-business-logo.png` whose natural size is `2000 x 2000`. Focused ORCH-1084 tests pass, and the expanded tests fail against the current `HEAD`/`origin/main` component, so they catch the still-live PR #378 web regression class from a different angle than the original happy-path tests.

This is not CLOSE-ready yet because the rework is still uncommitted/unpushed in the ORCH worktree. `git status` shows the component/tests as modified and the implementation report/screenshots as untracked. Per COMMS-0015/0018, no deploy or OTA was performed; future release must come only after the rework is committed, PR-reviewed/merged to `main`, then deployed/OTA'd from merged `main`.

## Findings

| Severity | Finding | Evidence | Release impact |
|---|---|---|---|
| P0 | None | No crash/security/data issue in scope. | None. |
| P1 | None | Web DOM/runtime proof shows fixed logo visibility/dimensions. | None. |
| P2 | Rework is local only, not in a scoped branch commit/push. | `git status --short --branch` shows modified files and untracked report/evidence; branch HEAD remains `7ccf01716`, same as `origin/main`. | CLOSE must wait for implementor/orchestrator to commit and push the rework files, then merge through PR. |
| P2 | Native parity is source-verified only, not iOS/Android runtime-launched in this QA pass. | `Platform.OS === "web"` uses DOM `<img>`; non-web path still uses RN `<Image source={logo} style={styles.logo} resizeMode="contain" accessibilityLabel="Mingla Business" />`. | Acceptable for this web rework if post-merge OTA planning includes native smoke; not a web close blocker. |
| P4 | Typecheck still has repo-wide pre-existing failures outside ORCH-1084. | `npm run typecheck -- --noEmit` fails, but filtered rerun has no `BusinessWelcomeScreen` / logo-test hits. | Not attributed to this rework. |

## Claim Table

| Claim | Verdict | Evidence |
|---|---|---|
| Web uses a plain DOM image instead of RN Web `Image` internals. | Verified | `BusinessWelcomeScreen.tsx:499-511` uses `React.createElement("img", { src: WEB_LOGO_SRC, alt, role, style })`. |
| Web image has explicit square dimensions and visible styling. | Verified | `BusinessWelcomeScreen.tsx:505-510` sets `width: LOGO_SIZE`, `height: LOGO_SIZE`, `objectFit: "contain"`, `display: "block"`, `opacity: 1`. |
| Logo container no longer lets the 2000px natural height leak. | Verified | `BusinessWelcomeScreen.tsx:865-871` sets `width: LOGO_SIZE`, `height: LOGO_SIZE`, `justifyContent: "center"`, `flexShrink: 0`. |
| Native path is preserved. | Verified | `BusinessWelcomeScreen.tsx:512-519` keeps RN `<Image source={logo} style={styles.logo} resizeMode="contain" accessibilityLabel="Mingla Business" />`. |
| Logo style remains square. | Verified | `BusinessWelcomeScreen.tsx:879-882` sets `width`, `height`, and `aspectRatio: 1`. |
| Public web asset exists and is square. | Verified | `file` output: both `assets/brand/mingla-business-logo.png` and `public/brand/mingla-business-logo.png` are `PNG image data, 2000 x 2000, 8-bit/color RGBA`. |
| Focused tests cover the new web invisibility/dimension contract. | Verified | `BusinessWelcomeScreenLogoAdversarial.test.tsx` asserts DOM `<img>`, `opacity: 1`, explicit equal width/height, no `maxWidth`/`maxHeight`, no `height: 2000`, native binding, and square asset. |
| Tests fail against the old web-buggy version. | Verified | Temporary detached worktree at `HEAD`/`7ccf01716` with new tests copied in failed both focused suites: 2 suites failed, 4 tests failed, 3 passed. Failures include missing `React.createElement("img"` and missing `LOGO_SIZE`. |
| No deploy or OTA was performed. | Verified | Only local Jest/export/Playwright/typecheck/source commands were run. Static server was local-only and stopped. |

## Platform Matrix

| Surface | Evidence | Result |
|---|---|---|
| Business web desktop | Local `web:export` served at `127.0.0.1:43186`; Playwright Chromium viewport `1440 x 1000`; screenshot `Mingla_Artifacts/reports/orch-1084-evidence/desktop-qa.png`. DOM proof: `rect.width=220`, `rect.height=220`, `opacity="1"`, `display="block"`, `visibility="visible"`, `naturalWidth=2000`, `naturalHeight=2000`, `visiblePixels=true`. | PASS |
| Business web mobile | Local `web:export` served at `127.0.0.1:43186`; Playwright Chromium viewport `390 x 844`; screenshot `Mingla_Artifacts/reports/orch-1084-evidence/mobile-qa.png`. DOM proof: same `220 x 220`, opacity/display/visibility OK, natural size `2000 x 2000`, visible pixels true. | PASS |
| Business iOS | Source parity only: non-web platform keeps RN `Image` branch with official bundled logo and explicit square style. | CONDITIONAL / source sanity |
| Business Android | Source parity only: same non-web RN `Image` branch as iOS. | CONDITIONAL / source sanity |
| Consumer app / admin | Not touched by `mingla-business/src/components/auth/BusinessWelcomeScreen.tsx`. | N/A |

## Commands Run

### Ledger / worktree sanity

```bash
sed -n '1,240p' /Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md
awk -F'|' '/^\| COMMS-/ { ... }' /Users/sethogieva/Desktop/mingla-main/COMMS_LEDGER.md
git status --short --branch
git rev-parse --abbrev-ref HEAD && git rev-parse HEAD && git rev-list --left-right --count origin/main...HEAD
```

Key output:

```text
ORCH-1084-logo-close-sync
7ccf01716a9fbd30439570579315a47e3e457b62
0 0

## ORCH-1084-logo-close-sync...origin/main
 M mingla-business/__tests__/components/BusinessWelcomeScreenLogo.test.tsx
 M mingla-business/__tests__/components/BusinessWelcomeScreenLogoAdversarial.test.tsx
 M mingla-business/src/components/auth/BusinessWelcomeScreen.tsx
?? Mingla_Artifacts/reports/IMPLEMENTATION_REWORK_ORCH-1084_BUSINESS_LOGO_WORDMARK.md
?? Mingla_Artifacts/reports/orch-1084-evidence/desktop-after.png
?? Mingla_Artifacts/reports/orch-1084-evidence/desktop-qa.png
?? Mingla_Artifacts/reports/orch-1084-evidence/mobile-after.png
?? Mingla_Artifacts/reports/orch-1084-evidence/mobile-qa.png
```

### Focused tests

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-1084-[logo-close-sync]/mingla-business
npx jest __tests__/components/BusinessWelcomeScreenLogo.test.tsx __tests__/components/BusinessWelcomeScreenLogoAdversarial.test.tsx --runInBand
```

Output:

```text
PASS __tests__/components/BusinessWelcomeScreenLogoAdversarial.test.tsx
PASS __tests__/components/BusinessWelcomeScreenLogo.test.tsx

Test Suites: 2 passed, 2 total
Tests:       7 passed, 7 total
Snapshots:   0 total
Time:        1.84 s, estimated 4 s
```

### Fail-on-revert / old-version proof

```bash
git worktree add --detach /tmp/orch1084-revert-proof HEAD
ln -s /Users/sethogieva/Desktop/mingla-orchs/ORCH-1084-[logo-close-sync]/mingla-business/node_modules /tmp/orch1084-revert-proof/mingla-business/node_modules
cp mingla-business/__tests__/components/BusinessWelcomeScreenLogo*.tsx /tmp/orch1084-revert-proof/mingla-business/__tests__/components/
cd /tmp/orch1084-revert-proof/mingla-business
npx jest __tests__/components/BusinessWelcomeScreenLogo.test.tsx __tests__/components/BusinessWelcomeScreenLogoAdversarial.test.tsx --runInBand
git worktree remove --force /tmp/orch1084-revert-proof
```

Key output:

```text
HEAD is now at 7ccf01716 Close ORCH-1084 [deploy]: official Mingla Business logo replaces text wordmark (web + iOS + Android) (#378)
FAIL __tests__/components/BusinessWelcomeScreenLogoAdversarial.test.tsx
FAIL __tests__/components/BusinessWelcomeScreenLogo.test.tsx
Test Suites: 2 failed, 2 total
Tests:       4 failed, 3 passed, 7 total
```

Representative failing assertions:

```text
Expected substring: "const LOGO_SIZE = Math.min(s(220), 220);"
Expected substring: "React.createElement(\"img\""
```

This proves the new tests catch the post-PR #378 web invisibility/dimension regression, not just the original square-asset happy path.

### Web export

```bash
cd /Users/sethogieva/Desktop/mingla-orchs/ORCH-1084-[logo-close-sync]/mingla-business
npm run web:export
```

Output summary:

```text
> expo export -p web --output-dir web-build
Web Bundled 15815ms index.js (4265 modules)
Exported: web-build
```

Warnings were Sentry config fallback and `NO_COLOR`/`FORCE_COLOR`; no logo/export failure. `web-build/brand/mingla-business-logo.png` exists.

### Local DOM/screenshot probe

```bash
node playwright/meta-orch-0952-static-server.mjs web-build 43186
node <Playwright Chromium DOM/screenshot probe>
```

Desktop proof:

```json
{
  "src": "/brand/mingla-business-logo.png",
  "alt": "Mingla Business",
  "role": "img",
  "naturalWidth": 2000,
  "naturalHeight": 2000,
  "rect": { "width": 220, "height": 220, "top": 182, "left": 610 },
  "opacity": "1",
  "display": "block",
  "visibility": "visible",
  "objectFit": "contain",
  "parentRect": { "width": 220, "height": 220 },
  "parentOpacity": "1",
  "visiblePixels": true,
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
  "rect": { "width": 220, "height": 220, "top": 106, "left": 85 },
  "opacity": "1",
  "display": "block",
  "visibility": "visible",
  "objectFit": "contain",
  "parentRect": { "width": 220, "height": 220 },
  "parentOpacity": "1",
  "visiblePixels": true,
  "viewport": { "width": 390, "height": 844 }
}
```

Screenshot evidence:

- `Mingla_Artifacts/reports/orch-1084-evidence/desktop-qa.png`
- `Mingla_Artifacts/reports/orch-1084-evidence/mobile-qa.png`

The local static server was stopped after the probe.

### Typecheck

```bash
npm run typecheck -- --noEmit
npm run typecheck -- --noEmit 2>&1 | rg 'BusinessWelcomeScreen|BusinessWelcomeScreenLogo|mingla-business-logo|ORCH-1084' || true
```

Result:

```text
npm run typecheck -- --noEmit
# exits 2 with existing repo-wide errors in account, checkout buyer, ComposerV2,
# IconChrome, Sheet.web, native payments package typings, shared ../packages/*,
# and several existing tests.

# Filtered ORCH-1084 check:
# no output
```

No typecheck error references `BusinessWelcomeScreen`, the ORCH-1084 tests, or the logo asset.

## Regression Coverage Assessment

The regression coverage is strong and materially different from the original PR #378 happy path. The original fix proved the official square asset and a square `aspectRatio`; the rework tests additionally require:

- public web logo URI `/brand/mingla-business-logo.png`;
- plain DOM `<img>` on web;
- explicit equal `width` and `height` on both wrapper and image style;
- `opacity: 1`, `display: block`, `objectFit: contain`;
- no percent `maxWidth` / `maxHeight` in the logo style bodies;
- no `height: 2000`;
- native `Image` branch still bound to `styles.logo`;
- one native accessibility label and one web alt, with no visible duplicate brand text.

Fail-on-revert proof was performed in a temporary detached worktree at `7ccf01716` with the new tests copied in. The tests failed against the old source because the web `<img>` contract and explicit `LOGO_SIZE` contract were absent.

Important caveat: because the rework files are uncommitted, these tests are not yet part of a scoped pushed branch/PR. This is the only release-process blocker found.

## Deploy / OTA Readiness

No deploy and no OTA were performed. COMMS-0015 and COMMS-0018 were acknowledged and carried.

Close/release sequence must be:

1. Commit the modified component, modified tests, implementation report, QA report, and evidence screenshots on `ORCH-1084-logo-close-sync`.
2. Push the branch and open/merge a PR to `main`.
3. After merge, verify `origin/main` contains the rework commit and content probe.
4. Deploy business web from merged `main`.
5. Generate any native OTA only from merged `main`.

## Final Verdict

CONDITIONAL PASS.

The web logo bug is fixed locally and proven by focused tests, fail-on-revert evidence, web export, DOM proof, and screenshots. The condition is process/readiness, not product behavior: the rework is still local and must be committed/pushed/merged before orchestrator CLOSE or any deploy/OTA can proceed.
