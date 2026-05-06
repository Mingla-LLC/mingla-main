# Handoff — Android Glass-Sheet Opacity Fix

**Date:** 2026-05-06
**Started on:** Windows
**Continue on:** Mac
**Branch:** `Seth`
**Repo root:** `mingla-main/`

---

## What we were doing (plain English)

The frosted-glass material used by sheet/dropdown/chrome panels in **mingla-business**
looks great on iOS and Web but was rendering near-transparent on Android. Content behind
the panel was bleeding through, making the panel hard to read and the boundary visually
weak.

**Root cause:** `expo-blur`'s default Android implementation produces a very thin frosted
overlay (Android has no system-level backdrop-blur API). The L2 tint floor on top of it
is only 6% white (`rgba(255, 255, 255, 0.06)`) — calibrated to layer on top of a real
blur, can't carry the material on its own. On Android, the BlurView contributed almost
nothing → panel looked transparent.

**Decision (user-confirmed Approach B):** Route Android through the same solid
`rgba(20, 22, 26, 0.92)` fallback the web path already uses when CSS `backdrop-filter` is
unsupported. iOS and Web rendering stay byte-identical. Android trades "true blur" for a
deterministic opaque dark glass surface.

Approaches A (experimental dimezis blur) and C (Android-only tint bump) were rejected.

---

## What we changed (3 files)

All three files use the exact same pattern: a small predicate function `useBlurOnWeb()`
that decided whether to render `<BlurView>` or the solid fallback `<View>`. We renamed it
to `shouldUseRealBlur()` and made it return `false` on Android.

### 1. `mingla-business/src/components/ui/Sheet.tsx`

Bottom-anchored drag-to-dismiss panel. The largest sheet surface in the app (used by
BrandEditView, EventCreator, country picker, ticket sheets, etc.).

**Diff (conceptual):**

```ts
// BEFORE
const useBlurOnWeb = (): boolean => {
  if (Platform.OS !== "web") return true;
  return supportsBackdropFilter;
};
// ...
const blurOk = useBlurOnWeb();

// AFTER
const shouldUseRealBlur = (): boolean => {
  if (Platform.OS === "ios") return true;
  if (Platform.OS === "android") return false;
  return supportsBackdropFilter;
};
// ...
const blurOk = shouldUseRealBlur();
```

The existing `else` branch (lines ~285-292) that renders the solid fallback `<View>` with
`backgroundColor: FALLBACK_BACKGROUND` is what now fires on Android. No new code paths.

### 2. `mingla-business/src/components/ui/TopSheet.tsx`

Top-anchored dropdown panel, used by the brand-switcher dropdown. Same predicate, same
edit. Existing solid fallback at lines ~309-315 now fires on Android.

### 3. `mingla-business/src/components/ui/GlassChrome.tsx`

5-layer chrome wrapper used by topbars, bottom navs, pill switchers — ANY chrome surface
that floats above content. Same predicate, same edit. Existing solid fallback at lines
~116-118 now fires on Android.

---

## Status

- **Code:** all three edits applied and saved on Windows.
- **Static check:** confirmed `useBlurOnWeb` is fully removed from `mingla-business/`
  (zero grep matches post-edit).
- **Type-shape check:** new function has identical signature `(): boolean`. Call sites
  unchanged: `const blurOk = shouldUseRealBlur()`.
- **Device verification:** NOT performed yet. Requires Android device or emulator.
- **Report written:** `outputs/IMPLEMENTATION_ANDROID_GLASS_OPACITY_REPORT.md`

---

## What to do next on Mac

### Step 1 — Pull / pick up the changes

The three edits are uncommitted on the `Seth` branch. Either:

- **Option A:** Pull the branch state if it was pushed (it has not been pushed yet — check
  with `git log Seth ^origin/Seth`).
- **Option B:** Reapply the same edits on Mac. The diffs are tiny — see "Diff (conceptual)"
  above. Apply identical replacement to all three files. There is exactly ONE call site of
  the predicate per file (the `const blurOk = ...` line), and ONE definition per file (the
  function itself).

To find the lines fast:

```bash
grep -n "useBlurOnWeb\|shouldUseRealBlur" mingla-business/src/components/ui/Sheet.tsx \
  mingla-business/src/components/ui/TopSheet.tsx \
  mingla-business/src/components/ui/GlassChrome.tsx
```

### Step 2 — Run on Android (mandatory verification)

```bash
cd mingla-business
npx expo start
# press 'a' to open Android emulator, or scan the QR with an Android device
```

Open these surfaces and confirm the panel reads as a near-opaque dark glass (NOT
see-through):

1. **Any bottom sheet** — open BrandEditView, an EventCreator wizard step, the country
   picker, a ticket sheet, a role picker. Each uses `Sheet` underneath.
2. **Brand-switcher dropdown** — top of any screen with the brand chip in the topbar.
   This uses `TopSheet`.
3. **Any chrome surface** — topbar, bottom nav pills, pill switchers. These use
   `GlassChrome`.

You should still see: top-edge highlight, hairline border, drop shadow. The L1 base is
now solid `rgba(20,22,26,0.92)` instead of a wispy BlurView.

### Step 3 — Confirm iOS and Web are unchanged

Open the same screens on iOS Simulator and on web (`npx expo start --web` then 'w').
Take screenshots if you want — the pixels should be byte-identical to before the fix.
This is the riskiest part of the change to regress, even though logically it can't.

### Step 4 — Commit if happy

The commit message is ready in `outputs/IMPLEMENTATION_ANDROID_GLASS_OPACITY_REPORT.md`
section 11/end. Reproduced here verbatim:

```
fix(ui): Android sheets/chrome use solid fallback instead of weak BlurView

expo-blur on Android renders near-transparent because Android has no
system backdrop-blur API. The L2 6%-white tint cannot carry the glass
material alone, so panels bled content through. Route Android to the
same solid rgba(20,22,26,0.92) fallback already used by web browsers
without backdrop-filter support. iOS UIVisualEffectView blur and Web
backdrop-filter paths unchanged.

Applies to Sheet, TopSheet, GlassChrome. Toast.tsx shares the bug and
is queued for a follow-up dispatch.
```

```bash
git add mingla-business/src/components/ui/Sheet.tsx \
        mingla-business/src/components/ui/TopSheet.tsx \
        mingla-business/src/components/ui/GlassChrome.tsx
git commit -m "fix(ui): Android sheets/chrome use solid fallback instead of weak BlurView

expo-blur on Android renders near-transparent because Android has no
system backdrop-blur API. The L2 6%-white tint cannot carry the glass
material alone, so panels bled content through. Route Android to the
same solid rgba(20,22,26,0.92) fallback already used by web browsers
without backdrop-filter support. iOS UIVisualEffectView blur and Web
backdrop-filter paths unchanged.

Applies to Sheet, TopSheet, GlassChrome. Toast.tsx shares the bug and
is queued for a follow-up dispatch."
```

(No `Co-Authored-By` line per project convention.)

### Step 5 — Push and decide on follow-up

If the Android verification passes, push the branch and decide whether to dispatch the
follow-up Toast.tsx fix immediately or queue it.

---

## Discoveries / Follow-ups (out of scope, do not silently fix)

### `Toast.tsx` has the identical bug

`mingla-business/src/components/ui/Toast.tsx` line 146:

```ts
const blurOk = Platform.OS !== "web" || supportsBackdropFilter;
```

Same predicate. Same Android transparency issue. NOT fixed in this pass because the user
explicitly scoped to "all 3" = Sheet/TopSheet/GlassChrome.

**Recommended next dispatch:** apply the same Approach B fix to Toast.tsx. The diff is
identical: replace the inline expression with a `shouldUseRealBlur()` helper that returns
`true` on iOS, `false` on Android, `supportsBackdropFilter` on Web. Toast already has a
`FALLBACK_BACKGROUND` constant defined at line 148.

### `app-mobile/` likely has the same bug class

`app-mobile/` very likely has its own copy of these primitives (mirror app sharing the
design system but a separate codebase). Has not been audited. Recommend:

```bash
grep -rn "BlurView\|expo-blur" app-mobile/src/components --include="*.tsx" --include="*.ts"
grep -rn "Platform.OS !== \"web\"" app-mobile/src/components --include="*.tsx"
```

Any consumer that uses the same `useBlurOnWeb`-style predicate has the same Android bug
and needs the same fix. Out of scope for this dispatch.

---

## Reference — exact final state of the predicate (paste-ready)

In all three files, the predicate now reads:

```ts
// iOS uses real UIVisualEffectView blur. Web uses CSS backdrop-filter when
// supported. Android's expo-blur backdrop is too thin to read against busy
// content (renders near-transparent), so we route Android to the same solid
// fallback the web path uses when backdrop-filter is unavailable.
const shouldUseRealBlur = (): boolean => {
  if (Platform.OS === "ios") return true;
  if (Platform.OS === "android") return false;
  return supportsBackdropFilter;
};
```

And the call site is:

```ts
const blurOk = shouldUseRealBlur();
```

---

## Quick context on the project state when leaving

Branch: `Seth` (not pushed since these edits)

Modified files at handoff:

```
M mingla-business/app/event/[id]/door/index.tsx          (unrelated, pre-existing)
M mingla-business/app/event/[id]/scanners/index.tsx      (unrelated, pre-existing)
M mingla-business/src/components/ui/GlassChrome.tsx      (THIS FIX)
M mingla-business/src/components/ui/Sheet.tsx            (THIS FIX)
M mingla-business/src/components/ui/TopSheet.tsx         (THIS FIX)
M mingla-business/src/store/currentBrandStore.ts         (unrelated, pre-existing)
?? Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_B2A_STRIPE_CONNECT_ONBOARDING_REPORT.md
?? Mingla_Artifacts/specs/SPEC_ORCH_0742_CURRENT_BRAND_ID_ONLY.md
?? clade transfer/
```

The four pre-existing modifications (door/scanners screens, currentBrandStore, untracked
artifact files) are NOT part of this fix. Be careful not to bundle them into the same
commit unless you intend to. Stage only the three UI primitive files for the glass fix.

---

## TL;DR for future-you

1. Three files changed. One predicate function in each, returning `false` on Android.
2. iOS + Web unchanged. Android now uses the existing `rgba(20,22,26,0.92)` solid fallback.
3. Run on Android device, verify panels look opaque, then commit with the message above.
4. Follow-up: same fix needed on `Toast.tsx` and probably across `app-mobile/`.
