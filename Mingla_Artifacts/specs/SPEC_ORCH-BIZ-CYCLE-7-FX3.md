# Spec — ORCH-BIZ-CYCLE-7-FX3 — Restore brand cover band rendering + retarget close-X navigation

**Date:** 2026-05-01
**Author:** mingla-forensics
**Investigation:** [reports/INVESTIGATION_ORCH-BIZ-CYCLE-7-FX3.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-BIZ-CYCLE-7-FX3.md)
**Estimated effort:** 15 min implementor + 10 min smoke

---

## 1 — Scope

Surgical fix to PublicBrandPage.tsx for 5 defects:

1. RC-1: oklch() backgroundColor on hero band (line 232) — RN-unsupported, silently rejected on native
2. RC-2: oklch() backgroundColor on event mini-card cover thumbs (line 671) — same bug
3. CF-1: heroFade overlay 55% dark dims cover into invisibility on web
4. CF-2: heroGradient static fallback removed in FX2 — restore for defensive rendering
5. CF-3: handleClose routes to `/(tabs)/account` — operator wants `/brand/{brand.id}`

**Files affected:** 1 file MOD (`PublicBrandPage.tsx`).
**Schema:** No bumps.
**OUT OF SCOPE:** EventCover primitive changes, BrandEditView, Cycle 6 PublicEventPage, brand schema.

---

## 2 — Layer Specification

**File:** `mingla-business/src/components/brand/PublicBrandPage.tsx`

### 2.1 — Hero band cover color (line 232)

**Replace:**
```tsx
{ backgroundColor: `oklch(0.45 0.16 ${brand.coverHue})` },
```

**With:**
```tsx
{ backgroundColor: `hsl(${brand.coverHue}, 60%, 45%)` },
```

Rationale: `hsl()` is RN-native (supported by `@react-native/normalize-colors` matchers) and identical to the pattern in `EventCover.tsx:42-57` (which is proven to work cross-platform). Saturation 60% + lightness 45% mirrors `EventCover`'s `baseColour` exactly.

### 2.2 — Event mini-card cover thumb color (line 671)

**Replace:**
```tsx
{ backgroundColor: `oklch(0.45 0.16 ${event.coverHue})` },
```

**With:**
```tsx
{ backgroundColor: `hsl(${event.coverHue}, 60%, 45%)` },
```

### 2.3 — heroFade overlay darkness reduction

**Find in stylesheet (approx line 737-744):**
```tsx
heroFade: {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(12, 14, 18, 0.55)",
},
```

**Replace `0.55` with `0.30`:**
```tsx
heroFade: {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(12, 14, 18, 0.30)",
},
```

Rationale: 30% body-color overlay preserves a subtle bottom-edge fade while letting the cover hue read clearly. Math: visible_lightness with hsl(L=0.45) + 0.30 dark overlay ≈ 0.45·0.70 + 0.06·0.30 ≈ 0.34. Visibly colored (was 0.23 = near-black at α=0.55).

### 2.4 — Restore heroGradient static fallback

**Find in stylesheet (approx line 728-736):**
```tsx
heroGradient: {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  // backgroundColor is set inline at the call site from brand.coverHue
  // via oklch(). Safari ≤15 falls through to body via heroFade overlay.
},
```

**Replace with:**
```tsx
heroGradient: {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  // Defensive fallback — visible if inline color fails for any reason.
  // Inline override at the call site uses hsl(brand.coverHue, 60%, 45%).
  // Use hsl/rgb/hex/hwb ONLY — RN normalize-colors rejects oklch/lab/lch
  // (CSS Color Module 4 functions are web-only on inline RN styles).
  backgroundColor: "rgba(255, 255, 255, 0.04)",
},
```

Rationale: subtle 4% white tint provides a faint visual presence in the unlikely case the inline color fails. Code comment teaches future devs the format constraint.

### 2.5 — Retarget close-X navigation

**Find in component body (approx line 142-144):**
```tsx
const handleClose = useCallback((): void => {
  router.replace("/(tabs)/account" as never);
}, [router]);
```

**Replace with:**
```tsx
const handleClose = useCallback((): void => {
  // Cycle 7 FX3: route to founder brand profile, NOT all the way to
  // Account tab. Founder lands on /brand/{brand.id} where they can
  // Edit, Team, Stripe, etc. From there native back returns to Account.
  router.replace(`/brand/${brand.id}` as never);
}, [router, brand.id]);
```

Note: dependency array gets `brand.id` added.

### 2.6 — Update header docstring "Platform notes"

**Find in top-of-file docstring (approx line 18-30 area):**
```
 * Platform notes:
 *   ...uses oklch for color richness...
```

**Replace oklch references with hsl + lesson note:**
```
 * Platform notes:
 *   Cover band uses `hsl()` not `oklch()` — RN's normalize-colors
 *   accepts only hex/rgb/rgba/hsl/hsla/hwb. CSS Color Module 4
 *   functions (oklch/lab/lch/color-mix) silently fail on iOS+Android
 *   and dim into invisibility on web when stacked under a dark
 *   overlay. Lesson from Cycle 7 FX3.
```

(Implementor judgment for exact docstring wording; the constraint is documenting the RN color-format limitation in-file so the next dev doesn't re-introduce.)

---

## 3 — Success Criteria

| AC | Criterion |
|----|-----------|
| AC#1 | `/b/lonelymoth` on iOS — cover band renders ORANGE (hsl 25, 60%, 45%) clearly visible. Not "black canvas". |
| AC#2 | `/b/sundaylanguor` on iOS — cover band renders BLUE (hsl 220) clearly visible. |
| AC#3 | `/b/thelonglunch` on iOS — cover band renders MAGENTA (hsl 320). |
| AC#4 | `/b/hiddenrooms` on iOS — cover band renders PURPLE-PINK (hsl 290). |
| AC#5 | Same 4 brand pages on Android emulator (if available) — cover bands all render their hue. |
| AC#6 | Same 4 brand pages on Expo Web (Chrome) — cover bands all render their hue. Not dimmed into near-black. |
| AC#7 | Event mini-card cover thumbs in Upcoming/Past tabs render their `event.coverHue` on iOS+Android+Web. |
| AC#8 | heroFade still produces a subtle bottom-fade-into-body effect — not a stark cover/body boundary. |
| AC#9 | If for any reason the inline hsl() fails, the heroGradient static fallback (`rgba(255,255,255,0.04)`) shows a faint tint instead of pure transparency. |
| AC#10 | Tap close X on `/b/lonelymoth` → routes to `/brand/lm` (Lonely Moth's founder brand profile). NOT `/(tabs)/account`. |
| AC#11 | From `/brand/lm` (post-close), tapping native back-arrow / hardware back → returns to `/(tabs)/account`. |
| AC#12 | grep `oklch\\(` in `mingla-business/src` returns ZERO active inline-style usages (docstring mentions OK; only `EventCover.tsx` doc-comment references should remain). |
| AC#13 | TypeScript strict EXIT=0. |
| AC#14 | NO regression on Cycle 6 PublicEventPage — share modal, founder close X, web SEO Head all still work. |
| AC#15 | NO regression on BrandEditView cover hue picker — live preview still updates as founder taps swatches. |
| AC#16 | NO regression on CreatorStep4Cover (event-creator wizard cover step). |

---

## 4 — Test Cases

| Test | Scenario | Layer |
|------|----------|-------|
| T-01 | iOS — open Lonely Moth brand page → cover orange | Native runtime |
| T-02 | iOS — open Sunday Languor brand page → cover blue | Native runtime |
| T-03 | iOS — open The Long Lunch → cover magenta | Native runtime |
| T-04 | iOS — open Hidden Rooms → cover purple-pink | Native runtime |
| T-05 | Web Chrome — same 4 brands, all cover hues visible (not black) | Web runtime |
| T-06 | Event mini-cards in Upcoming/Past tabs render hue thumbs (iOS+Web) | Component render |
| T-07 | grep `oklch\\(` in src returns 0 inline-style hits | Static analysis |
| T-08 | tsc strict | Type system |
| T-09 | Tap close X on `/b/lonelymoth` → land on `/brand/lm` | Navigation |
| T-10 | From `/brand/lm` press back → return to `/(tabs)/account` | Navigation |
| T-11 | BrandEditView open Lonely Moth → BRAND COVER section live preview shows orange (uses EventCover, untouched by this fix) | Regression |
| T-12 | Publish event from SL wizard → routes to `/e/sundaylanguor/{slug}` (Cycle 6 untouched) | Regression |
| T-13 | Bottom-fade into body still visible on cover band (heroFade still does its job at α=0.30) | Visual |
| T-14 | Pull AsyncStorage clear → re-seed brands → re-open SL → cover renders blue cleanly (migration + render full path) | Full stack |

---

## 5 — Invariants Preserved

- I-11..I-17 — all preserved (no schema/route/store changes; pure rendering + navigation fix)
- Constitution #1 No dead taps — RESTORED on cover (was visually missing) and improved on close-X (now lands somewhere meaningful for the founder)
- Constitution #2 One owner per truth — preserved
- Constitution #8 Subtract before adding — HONORED (delete oklch strings BEFORE adding hsl; delete old fallback comment BEFORE restoring static fallback)
- Constitution #9 No fabricated data — preserved (real founder-chosen hue renders, not faked)

---

## 6 — Implementation Order

1. **Edit 1:** line 232 oklch → hsl (hero band)
2. **Edit 2:** line 671 oklch → hsl (event mini-card)
3. **Edit 3:** stylesheet `heroFade.backgroundColor` 0.55 → 0.30
4. **Edit 4:** stylesheet `heroGradient` — restore static `backgroundColor: "rgba(255, 255, 255, 0.04)"` + add the in-line code comment about RN format constraint
5. **Edit 5:** `handleClose` body — `router.replace("/(tabs)/account")` → `router.replace(\`/brand/${brand.id}\`)`. Update useCallback dep array to `[router, brand.id]`.
6. **Edit 6:** header docstring "Platform notes" — replace oklch references with hsl + lesson note
7. **Verification:** `cd mingla-business && npx tsc --noEmit` → EXIT=0
8. **Web smoke (Chrome):** all 4 brands render hue cover, close X routes to `/brand/{id}`
9. **iOS smoke (sim):** same as web, plus event mini-cards render hue thumbs
10. **Regression:** open BrandEditView cover preview, open CreatorStep4Cover event preview, publish an event end-to-end on SL — confirm no breakage
11. **Implementation report** at `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_7_FX3.md`

---

## 7 — Regression Prevention

1. **Inline code comment** at `heroGradient` style block teaches the RN color-format constraint at the call site (per spec §2.4).
2. **Header docstring update** captures the lesson for the next reader (per spec §2.6).
3. **D-INV-CYCLE7-FX3-1 — promote to memory** — orchestrator may want to register `feedback_rn_color_formats.md` codifying which CSS color functions are RN-safe.
4. **Tester regression check** — every cover-rendering surface should be smoke-checked on iOS + Android + Web after any cover-styling change. (Add to test checklist if one exists.)

---

## 8 — Hard Constraints

- ❌ NO new external libraries
- ❌ NO new kit primitives
- ❌ NO change to `EventCover.tsx` (already uses hsl — not broken)
- ❌ NO change to BrandEditView cover preview (uses EventCover primitive — unaffected)
- ❌ NO change to CreatorStep4Cover (event-creator wizard step — orthogonal scope)
- ❌ NO change to schema (coverHue migration is sound)
- ❌ NO use of oklch/lab/lch/color-mix anywhere in the file (or any RN component)
- ✅ Cross-platform parity verified post-fix on iOS + Web minimum (Android if emulator available)
- ✅ TypeScript strict EXIT=0
- ✅ Implementor MUST run web + iOS smoke before declaring "implemented" (per memory rule on runtime config-dependent behavior — this fix is in the same class)

---

## 9 — Estimated Scope

- ~10-15 LOC delta net across 6 distinct edits
- 1 file MOD only
- 0 new files, 0 deps, 0 schema bumps, 0 new TRANSITIONALs
- Implementor wall: ~15 min
- Smoke: ~10 min

---

## 10 — Open Questions for Orchestrator

None blocking. All 6 strategic decisions resolved at HIGH confidence in investigation §8.
