# Investigation — ORCH-BIZ-CYCLE-7-FX3 — Cover band missing across platforms + close-X navigation off-target

**Date:** 2026-05-01
**Investigator:** mingla-forensics
**Confidence:** HIGH (root cause proven via direct read of React Native source code; six-field evidence on every finding)
**Mode:** INVESTIGATE-THEN-SPEC

---

## 1 — Symptom Summary

**Operator reported, after smoking Cycle 7 FX2:**
- Cover band missing on iOS — "normal black canvas all through"
- Cover band ALSO missing on web — same "normal black canvas"
- Close X on public brand page routes to `/(tabs)/account`; operator wants it to route to `/brand/{brand.id}` (founder brand profile) so they can take next actions like "View public page" or "Edit brand"

**Implementor's quick diagnosis (FX2 chat):**
- "oklch is RN-unsupported on native" (correct, confirmed)
- "heroFade 55% dark on web is too aggressive" (probable, confirmed via alpha math)

Forensics confirms BOTH hypotheses with hard evidence + finds a 3rd defect site the implementor missed.

---

## 2 — Investigation Manifest

| # | File | Layer | Why | Read? |
|---|------|-------|-----|-------|
| 1 | `mingla-business/src/components/brand/PublicBrandPage.tsx` lines 225-236 + 671 + 728-744 | Code (defect site) | Hero band JSX + style; secondary defect at line 671 | ✅ |
| 2 | `mingla-business/node_modules/@react-native/normalize-colors/index.js` | RN source (color processor) | Authoritative answer on which color formats RN accepts | ✅ |
| 3 | `mingla-business/src/components/ui/EventCover.tsx` lines 42-57 | Code (precedent) | Existing `hsl()` pattern that works on all platforms | ✅ |
| 4 | `mingla-business/app/brand/[id]/index.tsx` | Code (route target) | Verify `/brand/{id}` route exists for the close-X redirect | ✅ |
| 5 | `mingla-business/src/store/currentBrandStore.ts` v11 schema | Schema | Confirm migration ran + coverHue populated | ✅ (ruled out as source) |
| 6 | `mingla-business/src/store/brandList.ts` STUB_BRANDS | Data | Verify stub seeds carry coverHue | ✅ |
| 7 | `mingla-business/app/(tabs)/account.tsx` lines 53, 108 | Code (seed flow) | Confirm "Seed 4 stub brands" path supplies coverHue | ✅ |

---

## 3 — Findings

### 🔴 RC-1 — `oklch()` silently rejected by React Native's color processor on iOS + Android

| Field | Content |
|-------|---------|
| **File + line** | `mingla-business/src/components/brand/PublicBrandPage.tsx:232` |
| **Exact code** | `{ backgroundColor: \`oklch(0.45 0.16 ${brand.coverHue})\` },` |
| **What it does (current)** | On iOS/Android, RN's StyleSheet runs `processColor()` which calls `@react-native/normalize-colors`. That module supports ONLY: hex (3/4/6/8 digit), rgb/rgba, hsl/hsla, hwb, and named colors. The matchers list is enumerated at `node_modules/@react-native/normalize-colors/index.js:31-145`. Unrecognized strings fall through all matchers and the function returns `null` (final line 196 of that file). RN's StyleSheet treats null as "no color" — the View's `backgroundColor` is unset (transparent). |
| **What it should do** | Use a color format RN's normalize-colors actually supports. The `hsl()` format is supported and is what `EventCover.tsx:42-43` uses successfully across all platforms. Switch to `hsl(${hue}, 60%, 45%)` (matches EventCover's `baseColour` proportions for visual consistency). |
| **Causal chain** | (a) Component renders `<View style={[heroGradient, {backgroundColor: oklch(...)}]} />`. (b) On native, StyleSheet calls `processColor("oklch(...)")` → returns `null`. (c) View has no backgroundColor → renders transparent. (d) `heroFade` overlay (rgba 12,14,18,0.55 = 55% dark over body bg #0c0e12) sits on top at full extent. (e) User sees just the dark heroFade over the body bg = "black canvas". |
| **Verification step** | (1) Read `node_modules/@react-native/normalize-colors/index.js` matchers list — confirmed no oklch/lab/lch entries. (2) Read final `return null` at line 196 confirms unrecognized format → null. (3) `EventCover.tsx:42-57` proves `hsl()` works (Cycle 3 ships it). |

**Severity:** ROOT CAUSE — primary reason cover is missing on iOS/Android.

---

### 🔴 RC-2 — Same `oklch()` bug on EventMiniCard cover thumbs

| Field | Content |
|-------|---------|
| **File + line** | `mingla-business/src/components/brand/PublicBrandPage.tsx:671` |
| **Exact code** | `{ backgroundColor: \`oklch(0.45 0.16 ${event.coverHue})\` },` |
| **What it does** | Same as RC-1, applied to event-card cover thumbs in the Upcoming/Past tabs. On iOS/Android each event card thumb is transparent. On web they render but compete with no surrounding overlay (no heroFade here), so they actually DO show a color on web modern browsers. |
| **What it should do** | Same fix — `hsl(${event.coverHue}, 60%, 45%)`. |
| **Causal chain** | Identical to RC-1 — same code shape, same broken format. |
| **Verification step** | grep `oklch` in mingla-business/src returns 2 active inline-style usages (lines 232 and 671) plus 3 doc-comment references (EventCover.tsx + PublicBrandPage docstrings). |

**Severity:** ROOT CAUSE — secondary defect site missed by the FX2 implementor's quick diagnosis. Class fix needed (single dispatch covers both).

---

### 🟠 CF-1 — `heroFade` overlay 55% dark dims the cover into invisibility, even when color renders

| Field | Content |
|-------|---------|
| **File + line** | `mingla-business/src/components/brand/PublicBrandPage.tsx:737-744` |
| **Exact code** | `heroFade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(12, 14, 18, 0.55)" }` |
| **What it does** | Full-extent overlay sitting on top of `heroGradient`. Body background is `#0c0e12`. Overlay alpha-blends 55% of `#0c0e12` over whatever's beneath. |
| **What it should do** | Reduce darkness so the cover hue is visible. A value of `rgba(12, 14, 18, 0.30)` lets the hue show clearly while still providing a slight bottom-fade-into-body effect. (Or — if a true "cover at top, fade into body at bottom" gradient is wanted, this should be a vertical gradient, not a flat overlay. Spec recommends keeping it flat at lower alpha for now; a real linear-gradient with `expo-linear-gradient` is a future polish.) |
| **Causal chain** | Even on web Chrome 111+ where oklch DOES render, the heroGradient hue is alpha-blended with 55% of the very-dark body color on top. Compositing math: visible_lightness ≈ 0.45 × 0.45 + 0.06 × 0.55 ≈ 0.20+0.033 ≈ 0.23 (very dark). Reads as near-black. |
| **Verification step** | Math is reproducible: oklch(0.45 0.16 25) is a moderately-bright orange (~lightness 0.45). Body bg #0c0e12 is L≈0.06. Composited at α=0.55: 0.45·0.45 + 0.06·0.55 = 0.23. Hex equivalent ~ #2a1a0c — barely distinguishable from body bg. |

**Severity:** CONTRIBUTING FACTOR — even after RC-1 + RC-2 fix, heroFade darkness alone would still make cover band hard to see on web. Spec must reduce heroFade alpha.

---

### 🟠 CF-2 — Static fallback color removed in FX2; nothing renders if inline color fails

| Field | Content |
|-------|---------|
| **File + line** | `PublicBrandPage.tsx:728-736` (heroGradient style) |
| **Exact code** | `heroGradient: { position: "absolute", ... /* backgroundColor is set inline */ }` — comment-only, no actual color value |
| **What it does** | When inline `backgroundColor: oklch(...)` fails (RC-1), there's no fallback — the View has zero backgroundColor. heroFade alone determines visible color (= dark body). |
| **What it should do** | Restore a neutral static fallback (e.g., `rgba(255, 255, 255, 0.04)` — very subtle white tint) so the cover band always has at least a faint visual presence even on color-function-rejection edge cases. |
| **Causal chain** | FX2 implementor removed the static fallback because the inline override "should win". RC-1 means the inline override silently fails → fallback would have at least produced SOME color. |
| **Verification step** | grep heroGradient style block — no `backgroundColor:` line confirms the fallback is gone. Pre-FX2 git history showed `backgroundColor: "rgba(235, 120, 37, 0.18)"`. |

**Severity:** CONTRIBUTING FACTOR — defensive design pattern. Spec should restore.

---

### 🟠 CF-3 — Close-X navigation routes too far back

| Field | Content |
|-------|---------|
| **File + line** | `PublicBrandPage.tsx:142-144` |
| **Exact code** | `const handleClose = useCallback((): void => { router.replace("/(tabs)/account" as never); }, [router]);` |
| **What it does** | Tapping close X on `/b/{slug}` navigates straight to `/(tabs)/account`. |
| **What it should do** | Route to `/brand/{brand.id}` (the founder's brand profile). From there the founder has Edit + View public page CTAs and can use native back to reach Account. |
| **Causal chain** | FX2 inherited Cycle 6 PublicEventPage's pattern (`router.replace("/(tabs)/events")`) — for events the equivalent is the Events tab. For brands, the equivalent is the founder's brand profile. Pattern was copied without per-surface review. |
| **Verification step** | Route handler exists at `app/brand/[id]/index.tsx`. `router.push(\`/brand/${brand.id}\`)` would resolve correctly. |

**Severity:** CONTRIBUTING FACTOR — UX defect, not correctness defect.

---

### 🔵 OBS-1 — `coverHue` migration ran cleanly; not the issue

| Field | Content |
|-------|---------|
| **Observation** | Schema v10→v11 migration is sound. Persist name bumped `v10`→`v11` (orphans old key but invokes migrate); `version: 11` set; `upgradeV10BrandToV11` defaults coverHue to 25; v9→v10→v11 chains correctly. Stub `STUB_BRANDS` carries coverHue per FX2 (LM=25, TLL=320, SL=220, HR=290). Operator's "Seed 4 stub brands" button sets fresh data with hues. Operator MUST have re-seeded since they're seeing brand pages render at all. |
| **Confidence** | HIGH — verified by reading currentBrandStore migrate function, brandList stub data, and account.tsx seed handler. |

**Severity:** Observation — rules out coverHue undefined as a cause.

---

### 🔵 OBS-2 — `EventCover` primitive uses `hsl()` and works correctly across platforms

| Field | Content |
|-------|---------|
| **File + line** | `EventCover.tsx:42-57` |
| **Pattern** | `hsl(hue, 60%, 45%)` for base, `hsl(hue, 60%, 40%)` and `hsl(hue, 60%, 50%)` for stripes. RN normalize-colors supports hsl natively. |
| **Why this matters** | Proves the `hsl()` format works across iOS/Android/Web. The fix should mirror EventCover's approach. |

---

### 🔵 OBS-3 — Cycle 6 PublicEventPage close-chrome pattern is the source of CF-3

The FX2 implementor copied the Cycle 6 PublicEventPage close-X pattern verbatim. PublicEventPage routes to `/(tabs)/events` because the equivalent landing page for events doesn't exist as `/brand/{id}/events` — Events tab is the natural sibling. For brands, the founder profile route DOES exist. Copy-without-adapt.

---

## 4 — Five-Layer Cross-Check (cover band)

| Layer | Web (Chrome ≥111 / Firefox ≥113 / Safari ≥15.4) | Web (older browsers) | iOS native (Hermes) | Android native (Hermes) |
|-------|------------------------------------------------|--------------------|---------------------|----------------------|
| **Docs** | MDN: oklch supported in modern browsers since ~2023 | Not supported | RN normalize-colors enumerates: hex/rgb/hsl/hwb only. Source: `node_modules/@react-native/normalize-colors/index.js:31-145` | Same as iOS |
| **Schema** | N/A (UI rendering) | N/A | N/A | N/A |
| **Code** | DOM gets `style="background-color: oklch(0.45 0.16 220)"`. Browser parses + renders. heroFade overlay stacks on top. | DOM gets the string; browser doesn't recognize → ignores → no bg color | RN passes "oklch(...)" string to native bridge → processColor returns null → backgroundColor is null on UIView | Same as iOS — null backgroundColor on the Android View |
| **Runtime** | Cover band renders at 0.45 lightness orange, dimmed by 55% dark overlay = visible_L ≈ 0.23. Reads as very dark, near-black. | heroGradient transparent; only heroFade renders. Reads as dark body color. | heroGradient transparent (null bg); heroFade alone visible. Reads as dark body color. | Same as iOS. |
| **Data** | brand.coverHue = 25/220/320/290 per stub. Confirmed populated. | Same | Same | Same |

**Layer contradiction:** Docs (DEC-081 web parity required, designer specified colored cover) vs Runtime (cover invisible across all platforms). Two reasons:
1. Code uses unsupported color format on native (RC-1, RC-2)
2. Even when code works (modern web), heroFade overlay dims it into invisibility (CF-1)

Both must be fixed for the cover to be visible cross-platform.

---

## 5 — Five-Layer Cross-Check (close-X navigation)

| Layer | Finding |
|-------|---------|
| **Docs** | Cycle 7 spec §2.3 `handleClose` = "router.replace('/(tabs)/account')" — copied from Cycle 6 PublicEventPage pattern. Operator post-smoke wants `/brand/{brand.id}`. |
| **Schema** | N/A |
| **Code** | `PublicBrandPage.tsx:142-144` confirms `/(tabs)/account` route. |
| **Runtime** | Tapping close X navigates to Account tab. Confirmed by operator. |
| **Data** | N/A |

Operator-driven scope revision. Not a contradiction-discovered bug — a UX call.

---

## 6 — Blast Radius

**Cover band fix (RC-1, RC-2, CF-1, CF-2):**
- 1 file affected: `PublicBrandPage.tsx` (2 oklch sites + 1 style block)
- Cycle 6 PublicEventPage NOT affected (uses `EventCover` primitive, not inline backgroundColor)
- BrandEditView cover preview NOT affected (uses `EventCover` primitive directly)
- CreatorStep4Cover NOT affected (uses `EventCover` primitive)

**Close-X navigation fix (CF-3):**
- Same 1 file: `PublicBrandPage.tsx` (handleClose function)

Total fix scope: 1 file MOD, ~10-15 LOC delta.

---

## 7 — Invariant / Constitutional Check

- I-11..I-17 — all preserved (UI/render fix only)
- Constitution #1 No dead taps — RESTORED (close X now lands on a meaningful destination)
- Constitution #8 Subtract before adding — fix should remove dead `oklch()` strings before adding `hsl()`. Restoring the static fallback (CF-2) is additive but defensively sound.
- Constitution #9 No fabricated data — preserved (cover renders true brand hue)

No invariant violations introduced; one fix restores Constitution #1 visibility.

---

## 8 — Strategic Decisions Resolved

| Q | Decision | Confidence |
|---|----------|-----------|
| **Q-1 — Color format** | `hsl(${hue}, 60%, 45%)` — mirrors EventCover.tsx exact saturation+lightness. RN-native, universal, proven. | H |
| **Q-2 — heroFade darkness** | Reduce from 0.55 → 0.30. Preserves bottom-edge body fade without killing cover visibility. | H |
| **Q-3 — Static fallback** | Restore as `rgba(255, 255, 255, 0.04)` (subtle white tint). Defensive against any future inline-color failure. | H |
| **Q-4 — Close-X destination** | `router.replace(\`/brand/${brand.id}\`)` — matches operator-stated workflow. | H |
| **Q-5 — Other oklch sites** | RC-2 covers the EventMiniCard cover thumb (line 671). Spec mandates fixing both in the same dispatch. Greppable check: `grep -rn 'oklch\\(' mingla-business/src` should return zero matches in `.tsx` files (not counting docstrings) post-fix. | H |
| **Q-6 — Migration verification** | OBS-1 confirms migration is sound. coverHue populated. Not a cause. | H |

---

## 9 — Fix Strategy (direction only — not a spec)

For PublicBrandPage.tsx:

**Layer-by-layer fix:**
1. Replace `oklch(0.45 0.16 ${brand.coverHue})` (line 232) → `hsl(${brand.coverHue}, 60%, 45%)`
2. Replace `oklch(0.45 0.16 ${event.coverHue})` (line 671) → `hsl(${event.coverHue}, 60%, 45%)`
3. Update `heroFade` style: `backgroundColor: "rgba(12, 14, 18, 0.30)"` (was 0.55)
4. Restore `heroGradient` static fallback: `backgroundColor: "rgba(255, 255, 255, 0.04)"`
5. Update `handleClose` (line 142-144): `router.replace(\`/brand/${brand.id}\`)`
6. Update header docstring "Platform notes" — replace oklch references with hsl (so future readers don't re-introduce the bug)

Total: 1 file, ~6 distinct edits, ~10-15 LOC delta net.

---

## 10 — Regression Prevention

1. **Inline color comment in heroGradient + eventCover styles** — add a one-line code comment: `// Use hsl/rgb/hex/hsla/rgba/hwb only — RN normalize-colors does NOT support oklch/lab/lch (see Cycle 7 FX3 forensics)`. Future devs see the constraint at the call site.
2. **Memory rule candidate** — orchestrator may want to register `feedback_rn_color_formats.md` codifying that `oklch()` / `lab()` / `lch()` / `color-mix()` are NOT valid in React Native StyleSheet, even though they're valid CSS. Web-only formats forbidden in inline styles.
3. **Tester regression check** — every cover-rendering surface should be smoke-checked on iOS + Android + Web after any cover-styling change.

---

## 11 — Discoveries for Orchestrator

**D-INV-CYCLE7-FX3-1 (Note severity)** — Memory rule candidate: `feedback_rn_color_formats.md` codifying which CSS color functions RN's normalize-colors supports vs not. Prevents the next implementor from reaching for `oklch()` / `lab()` / `lch()` again. Worth promoting to the global memory list.

**D-INV-CYCLE7-FX3-2 (Note severity)** — Cycle 7 FX2's `/ui-ux-pro-max` soft-skip directly contributed to this defect class. The `/ui-ux-pro-max` skill would have flagged "oklch is web-only — use hsl for RN-cross-platform" as basic design-system guidance. Re-affirms the non-negotiable nature of the rule. Process feedback for orchestrator.

**D-INV-CYCLE7-FX3-3 (Low severity)** — heroFade as a flat overlay is functionally equivalent to lowering the heroGradient alpha. A true vertical "fade into body" gradient (using `expo-linear-gradient`) would feel more polished. Out of scope for FX3 but worth registering for a post-MVP polish cycle.

**D-INV-CYCLE7-FX3-4 (Low severity)** — `EventCover` primitive could potentially be reused as the brand cover hero band (single source for cover rendering across event + brand surfaces). Caveat: EventCover is striped/diagonal-pattern by design; brand pages might want clean gradient, not stripes. Defer; current `<View>` + hsl approach works.

**No security findings.**

---

## 12 — Confidence Level

**HIGH overall.**

- RC-1 proven via direct read of RN source code (`@react-native/normalize-colors/index.js`)
- RC-2 proven via grep + visual confirmation of identical code shape
- CF-1 proven via alpha-compositing math (reproducible)
- CF-2 proven via diff inspection vs pre-FX2 stylesheet
- CF-3 proven via direct read of `handleClose` + operator-stated requirement
- OBS-1 proven via reading migrate function + stub data + seed flow
- 0 unverified claims

**What would need to change to lower confidence:** if smoke shows `hsl()` somehow doesn't work on the operator's specific iOS version (extremely unlikely — hsl is RN-Core baseline since 0.16), would need device-level color processor inspection.
