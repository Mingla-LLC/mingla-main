# IMPLEMENTATION — ORCH-1098 Stage 5: the two P0 residuals (compose OOM + event/create React #300)

Date: 2026-06-07
Author: Claude (mingla-implementor)
Worktree: `~/Desktop/mingla-orchs/ORCH-1098-[business-web-real-app-on-mobile]/` on branch `ORCH-1098-stage5-residuals`
Base: origin/main `56f0da9e2` (Stage 4 COMMS-0022; includes the Stage 3 BottomNav fix merged via PR #406 `76a10b126`)
Device: physical Samsung **SM-A725F** (adb serial `R58R54YV7JT`), Android 14, Chrome 148 (V8 14.8), driven via adb + Chrome DevTools Protocol.
Constraints honoured: native iOS/Android **byte-unchanged** (web-gated); NO auth/Stripe/schema change; NO new runtime deps; NO deploy/OTA/merge (orchestrator owns, per COMMS-0015/0018). adb reverse/forward torn down; local server killed; Samsung left as-is.

---

## Headline

Both Stage-4 P0 residuals are FIXED and device-proven on the Samsung. The big root cause (BottomNav reanimated loop, Stage 2b/3) was intact and untouched. The two residuals were **two separate offenders newly exposed once phones got the real app**:

- **Residual 1 — `/marketing/campaigns/compose` OOM-crash:** culprit was NOT the Tiptap editor and NOT BottomNav — it was the **`TemplatePreviewDrawer` narrow-web path**, which delegated to the NATIVE base component (`MobileDrawer`). That native-targeted component drives an unbounded re-render/allocation loop on phone Chrome under React 19 the instant it mounts — **even while `visible === false`** (it returns null but its hooks still run). Fixed by web-gating a loop-free `MobileWebDrawer` for narrow web (mirrors `BottomNav.web.tsx`). After: compose flat ~21 MB, renders fully, no crash.
- **Residual 2 — `/event/create` React #300:** culprit was `app/_layout.tsx` (the ROOT layout wrapping EVERY route) calling **9 hooks AFTER two early returns** (the signed-out + mobile-route recovery returns). When the auth/route gate flipped between renders the hook count changed → React #300 → "Something broke". Fixed by deferring both recovery `return`s to after all hooks (all hooks now run unconditionally). ESLint: 9 `rules-of-hooks` errors → 0.

Both fixes are `.web.tsx` / web-gated; native is byte-unchanged. Regression tests for both pass and fail-on-revert @ `56f0da9e2`.

---

## Residual 1 — compose OOM (root cause + fix)

### Device repro (baseline, production signed-in)
On production `business.usemingla.com` signed in (sethogieva@gmail.com, brand "Leggo This"), navigating to `/marketing/campaigns/compose`: heap climbed 11 MB → 100 → 226 → 355 → 534 → 656 → 774 MB in ~5 s, then renderer SIGSEGV (socket death) — "Aw, Snap". The route NEVER painted (`txt=""` throughout) → a mount-time render loop, same V8-OOM CLASS as the original BottomNav bug.

### On-device heap bisect (method = SPIKE Stage 2b)
Served a local `npm run web:export` build via `adb reverse tcp:8099` + a SPA static server, loaded the route SIGNED-OUT on the Samsung (the loop is data-independent — it reproduced signed-out identically, exactly like the Stage 2b BottomNav bug; a do-not-ship lever temporarily exposed the route signed-out for the bisect), polled `Runtime.getHeapUsage`, and binary-searched the compose component tree with `?s5bisect=` levers:

| Variant (what rendered) | Outcome | Conclusion |
|---|---|---|
| FULL compose (baseline) | OOM 12→868 MB → crash | reproduces |
| `noeditor` (drop ComposerV2Editor) | FLAT ~18 MB | loop is inside ComposerV2Editor subtree |
| `editoronly` (only ComposerV2Editor) | OOM → crash | confirms subtree |
| `stubeditor` (all ComposerV2Editor hooks run, render NOTHING) | FLAT ~18.8 MB | ComposerV2Editor's own hooks are fine |
| `nohook` / `forceempty` (RichEditor element renders bare `<View>`) | OOM → crash | NOT the RichEditor content |
| `noricheditor` (full tree, `<RichEditor>` element removed) | OOM → crash | NOT the RichEditor at all |
| **`nodrawer`** (real editor present, `<TemplatePreviewDrawer>` removed) | **FLAT ~18.7 MB, full route renders** | **TemplatePreviewDrawer is the SOLE culprit** |
| `forcetiptap` (drawer fixed, Tiptap forced on phone) | FLAT ~21 MB | Tiptap is FINE on phone web once the drawer is fixed |

Decisive: removing ONLY `<TemplatePreviewDrawer>` makes the route flat; forcing the Tiptap editor with the drawer fixed is flat. A `visualViewport`/`resize` counter showed only 1–2 resize events total (not a resize storm) — it is a passive-effect re-render loop, same CLASS as BottomNav.

### Root cause (file:line)
`src/components/marketing/ComposerV2/TemplatePreviewDrawer.web.tsx` (pre-fix line 63):
```
import { TemplatePreviewDrawer as MobileDrawer, ... } from "./TemplatePreviewDrawer";
```
and (pre-fix lines 75–78):
```
if (!isWideDesktop) { return <MobileDrawer {...props} />; }
```
On narrow mobile web the wrapper delegated to the **native base** `TemplatePreviewDrawer.tsx` (a `<Modal>` + `useWindowDimensions` + debounce/preview-version component built for iOS/Android). That native-targeted component, run through react-native-web on the phone renderer under React 19, enters an unbounded re-render/allocation loop on mount — **even though `<TemplatePreviewDrawer visible={false}>`** (it returns null but its hooks still execute every render). Same architectural bug class as the BottomNav native capsule on web.

### The fix (web-only, native untouched)
`src/components/marketing/ComposerV2/TemplatePreviewDrawer.web.tsx` (+136):
- Dropped the value import of the native base (`MobileDrawer`); kept only the `import type { TemplatePreviewDrawerProps }`.
- Narrow-web branch now renders a NEW **`MobileWebDrawer`** defined in the same web file: a loop-free, web-safe bottom-sheet overlay (plain absolute-positioned `View` + `Pressable` scrim + `ScrollView` of the existing `TemplateRow`s). It **renders null until `visible`** (so a closed drawer does zero hooks-driven work) and uses **no native `Modal`, no `useWindowDimensions`, no debounce/preview-version effects** — exactly the machinery that looped.
- Desktop web keeps the inline `DesktopRightRail`; native (iOS/Android) keeps the full base `TemplatePreviewDrawer.tsx` (Metro picks `.tsx`), byte-unchanged.

### Device proof (after)
`/marketing/campaigns/compose` on the Samsung (local export): **FLAT 21.1 MB peak over 14 s, no crash**, route renders fully ("New campaign / Save draft / Pick an audience" + the B/I/U/Link/+Event/Personalize toolbar + editor body + Preview/Send now/Schedule footer).
- Screenshot: `Mingla_Artifacts/reports/stage5_screens/compose_FIXED_flat.png`
- Logcat: clean (no `mark-compact` / `CrRendererMain` / `SIGSEGV` / `Aw, Snap`).
- Before/after peak heap: **~774 MB → crash (production signed-in)** vs **21.1 MB flat (fixed)**.

Signed-in note: the BEFORE OOM was captured on production SIGNED-IN; the AFTER is proven on the local export. The loop is auth/data-INDEPENDENT (it reproduced signed-out byte-for-byte in the bisect, and the drawer loops with 0 templates), so the signed-in body mounts the same fixed wrapper — verified-by-equivalence + the production-before/local-after pair. A full signed-in production pass needs a deploy (orchestrator-owned).

---

## Residual 2 — event/create React #300 (root cause + fix)

### Root cause (file:line)
`app/_layout.tsx` — `RootLayoutInner`. Pre-fix the two recovery EARLY RETURNS lived at ~lines 389–416:
```
if (Platform.OS === "web" && !loading && user === null && ORCH_1092_SIGNED_OUT_ROUTES.has(pathname)) {
  return <Orch1092SignedOutRecovery .../>;
}
const orch1093Status = orch1093RouteStatus(pathname);
if (Platform.OS === "web" && isMobileWebRouteEntry() && orch1093Status !== "interactive") {
  return <Orch1093MobileRouteRecovery .../>;
}
```
…BEFORE **9 hooks** at lines 423–568: `useEffect` (AppsFlyer/analytics), `usePushPermissionMoment`, `useEffect` (notification handlers), `useEffect` (deferred-push replay), `useEffect` (AppState focus), `useState`+`useEffect` (eviction), `useState`+`useEffect` (orphan-key reap). When the auth/route gate flipped between renders (e.g. `loading` true→false while signed-out, or a route-status change), React saw a DIFFERENT hook count between renders → **Minified React error #300** → the app error boundary ("Something broke. We're on it.") → redirect to `/`. ESLint flagged exactly these 9 as `react-hooks/rules-of-hooks` (the static signature of #300). `/event/create` is where it surfaced because the wizard mounts right as auth resolves (deep-link AND in-app CTA).

### The fix
`app/_layout.tsx` (+58/−27): the two recovery decisions are now computed early as `shouldShowSignedOutRecovery` / `shouldShowMobileRouteRecovery` booleans (NO hooks there), but the actual `return`s are **DEFERRED to just before the JSX return**, after EVERY hook has run. All hooks now execute unconditionally in the same order on every render. Behaviourally identical (the returns still fire for the same conditions); only the timing-relative-to-hooks changed. Native: both `shouldShow*` are gated by `Platform.OS === "web"` so they're always `false` on native → the deferred returns never fire → native is byte-equivalent.

### Proof
- **ESLint:** 9 `react-hooks/rules-of-hooks` errors on `app/_layout.tsx` (with bug) → **0** (with fix). This is the authoritative proof for a hooks-order/#300 bug.
- **Device:** `/event/create` on the Samsung (local export) renders cleanly — the route's own signed-out terminal state ("Sign in to create an event" + buttons), **no "Something broke", no React #300, no crash** (CDP console + logcat clean). Screenshot: `Mingla_Artifacts/reports/stage5_screens/event_create_FIXED.png`. (Signed-out shows the terminal state because localhost has no session; signed-in it mounts the wizard with the now-stable hook order.)
- Transition probe (`/account` recovery ⇄ `/event/create` interactive) on device post-fix: no #300.
- Honest scope note: the EXACT signed-in #300 sequence (auth `loading` resolving on a mounted layout) cannot be reproduced on localhost signed-out; the QA captured the #300 on device signed-in (the BEFORE). The fix's correctness is established by the lint signature (9→0) + the deferred-return structure + the clean device render.

---

## Regression tests (Step 0.5)

Both new, both pass, both fail-on-revert @ `56f0da9e2`. Source-structure jest tests (no DOM render — these RN-web components are fragile under jsdom; the Stage-4 adversarial gate uses the same source-parse approach).

| Test | Asserts | Run | Fails-on-revert |
|---|---|---|---|
| `mingla-business/__tests__/orch1098Stage5ComposeDrawerLoopFix.test.ts` (5 tests) | narrow-web renders loop-free `MobileWebDrawer` (not native `MobileDrawer`); no value-import of the base; `MobileWebDrawer` renders null until visible + no native Modal/useWindowDimensions; native base drawer untouched | PASS (5/5) | RED (3 failed) when `TemplatePreviewDrawer.web.tsx` reverted to origin/main `56f0da9e2` |
| `mingla-business/__tests__/orch1098Stage5EventCreateHooksOrder.test.ts` (4 tests) | both recovery returns come AFTER the last hook call; decisions computed as deferred `shouldShow*` booleans; deferred hooks (incl. `usePushPermissionMoment`) still present; ≥8 hook calls | PASS (4/4) | RED (2 failed) when `app/_layout.tsx` reverted to origin/main `56f0da9e2` |

Combined run: **9 passed, 9 total**. Both files appear in `git diff origin/main...HEAD --name-only`.

Broader gates (no regression):
- Existing `__tests__/orch1098*` + `src/components/marketing/ComposerV2/__tests__` → **12 suites / 101 tests PASS** (includes the 2 new).
- `npm run web:export` → exit 0 (clean build, both fixes in the bundle).
- `tsc --noEmit`: **0 new errors** on the two touched files (full-tree baseline 260 unchanged — pre-existing worktree config baseline, same on origin/main).
- `eslint app/_layout.tsx`: 0 `rules-of-hooks` errors (was 9).

---

## Old → New receipts

### `src/components/marketing/ComposerV2/TemplatePreviewDrawer.web.tsx`
**Before:** narrow mobile web (`!isWideDesktop`) delegated to the native base drawer via `import { TemplatePreviewDrawer as MobileDrawer } from "./TemplatePreviewDrawer"` + `return <MobileDrawer {...props}/>`.
**After:** narrow web renders a new loop-free `MobileWebDrawer` (plain overlay, null-until-visible, no native Modal/useWindowDimensions/debounce). Native value-import removed (kept `import type`). Desktop right-rail + native base unchanged.
**Why:** the native base drawer OOM-loops on phone Chrome under React 19 even while invisible (device heap bisect, Residual 1).
**Lines changed:** +136.

### `app/_layout.tsx`
**Before:** two web recovery `return`s (signed-out + mobile-route) placed BEFORE 9 hooks → hook-count change between renders → React #300 on `/event/create`.
**After:** recovery decisions computed as `shouldShow*` booleans (no hooks); the two `return`s deferred to after all hooks. All hooks unconditional. Native unaffected (web-gated).
**Why:** Rules-of-Hooks / React #300 fix (Residual 2). ESLint 9 errors → 0.
**Lines changed:** +58/−27.

### `src/components/marketing/ComposerV2/TemplatePreviewDrawer.tsx` (native base) — UNCHANGED
Verified byte-identical to origin/main. iOS/Android keep the full native `<Modal>` swipe + live-preview drawer.

---

## Cross-surface impact

- **Business Web (phone browser)** — target: compose no longer OOMs; event-create no longer #300s. Files: the two above.
- **Business Web (desktop)** — unaffected: desktop drawer = `DesktopRightRail` (untouched); `_layout` recovery returns are web-gated but desktop wasn't hitting the #300 (it's the same fix, harmless on desktop).
- **Business iOS / Android (native)** — byte-unchanged: drawer fix is `.web.tsx`-only (native base untouched); `_layout` change is web-gated (`Platform.OS === "web"` makes both `shouldShow*` false on native → deferred returns never fire → identical behaviour).
- **Consumer app, Admin, buyer-anon web** — N/A (no mingla-business composer / root layout).

---

## Discoveries for orchestrator

1. **Two SEPARATE residual offenders, both "native-component-rendered-on-web" loops.** Residual 1 (TemplatePreviewDrawer) is the SAME architectural class as the Stage-2b BottomNav bug: a native-targeted RN component that loops under react-native-web on phone Chrome. **Tiptap was exonerated** (forced on the phone with the drawer fixed → flat). Recommend a sweep for OTHER `.web.tsx` files that fall through to a native base component on narrow web (the pattern `import { X as Mobile } from "./X"; if (!isWideDesktop) return <Mobile/>`), as each is a latent phone-web OOM. Candidates to audit: any composer/sheet/drawer with a `.web.tsx` + base `.tsx` pair.
2. **`useResponsiveLayout` value-stability rewrite was prototyped and REVERTED.** It is NOT the cause here (only 1–2 resize events during the loop) and it cannot be done without breaking the append-only-protected `useResponsiveLayout.test.ts` (bare-call node test). Leave it as-is; if a future ORCH wants the rewrite it needs a `[TEST-MOD-APPROVED]` for that test.
3. **Signed-in device proof is deploy-bounded.** The BEFORE OOM was captured on production signed-in; the AFTER is local-export signed-out (loop is auth-independent). Recommend a post-merge signed-in smoke of `/marketing/campaigns/compose` + `/event/create` on the deployed `business.usemingla.com` once Stage 5 merges + deploys.
4. **`app/_layout.tsx` still has a `if (stripeModeError) throw` before the hooks** — that is a THROW (unmounts to the error boundary), not an early return, so it does NOT cause #300 (React tolerates throws before hooks). Left as-is; flag only if a future audit wants all pre-hook control flow removed.

---

## Completion condition

Both residuals fixed with captured device evidence (screenshots + heap/logcat) + lint + tests; regression tests green AND fails-on-revert @ `56f0da9e2`; web:export exit 0; tsc 0-new on touched files; native byte-unchanged (web-gated). No deploy/OTA/merge (orchestrator owns). adb reverse/forward + local server torn down; Samsung left as-is.
