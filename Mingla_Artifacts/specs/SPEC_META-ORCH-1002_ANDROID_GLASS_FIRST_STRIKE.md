# SPEC — META-ORCH-1002 [Android glass hardening] — FAST FIRST STRIKE (Sub-1)

**Mode:** SPEC (bounded first-strike contract)
**Date:** 2026-05-29
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1002-[android-glass-hardening]/` on branch `META-ORCH-1002-android-glass-hardening`. Metro port 8087.
**Primary input (proven, do not re-investigate):** `Mingla_Artifacts/reports/INVESTIGATION_ANDROID_GLASS_FILL_AND_TRANSPARENCY.md`
**Skill:** mingla-forensics
**External APIs touched:** NONE (pure React Native style/Platform.select change). COMMS-0003 docs-citation requirement is N/A. No `supabase`/backend/migration/edge touch. No new dependencies.

---

## 0. Operator decisions already locked (not re-litigated)

- **POLICY = Option 1 — solid frosted surfaces on Android by default.** On Android, glass surfaces render an OPAQUE (or ≥ 0.92 alpha) frosted fill instead of relying on `expo-blur`. Real `dimezisBlurView` blur is reserved ONLY for specific hero surfaces validated on-device later — NOT in this strike. Android visual target = the iOS *intent* (premium frosted card/sheet) rendered with an opaque fill, NOT a see-through tint.
- **SCOPE = FAST FIRST STRIKE ONLY.** Highest-visibility subset, ONE PR, so Seth can eyeball the win before the full ~310-instance sweep. The full sweep (Sub-B…Sub-F in the investigation §6) is explicitly deferred.

---

## 1. Layman summary

On Android, Mingla's "glass" cards and bars were built to lean on a blur effect that Android either renders as a thin see-through film or not at all. Two visible problems result: (A) the notification card's cream fill stops short of the rounded corners leaving a taupe ring, and (B) the chat input bar and bottom nav look washed-out and see-through over busy content. This strike fixes the small set of highest-visibility surfaces by making them solid frosted panels on Android — matching how iOS *looks*, not how iOS technically blurs. iOS rendering is untouched. The deepest single lever is a version gate that currently only helps Android 11 and older; flipping it lights up the bottom nav, top bar, icon buttons, badges and sticky headers on all modern Android at once.

---

## 2. Scope and non-goals

### 2.1 In scope (these surfaces, nothing else)

| # | Surface | File(s) | Symptom | Class |
|---|---------|---------|---------|-------|
| S1 | Consumer notification card + skeleton | `app-mobile/src/components/NotificationsSheet.tsx` (`notificationCard` ~952, `notificationCardUnread` ~969, `skeletonCard` ~1185) + tokens in `app-mobile/src/constants/designSystem.ts` (`glass.notificationsSheet.cardUnreadBg`) | A — inset ring | Symptom A |
| S2 | Consumer chrome gate (root) | `app-mobile/src/constants/designSystem.ts` (NEW shared helper) + the 8 chrome components that inline `isAndroidPreBlur` | B — see-through chrome | Symptom B (root) |
| S3 | Consumer chat-input capsule | `app-mobile/src/components/MessageInterface.tsx` (capsule blur ~1912) | B — worst offender, no guard | Symptom B |
| S4 | Consumer bottom nav | `app-mobile/src/components/GlassBottomNav.tsx` (~208) | B | Symptom B (confirm fixed by S2) |
| S5 | Business trip tab-bars (raw elevation:8) | `mingla-business/src/components/trip/EditPublishedTripIntakeAccordion.tsx` (`tabActive` ~520) + `mingla-business/src/components/trip/TripCreatorStep6Intake.tsx` (`tabActive` ~295) | A — hard Android shadow rectangle | Symptom A |
| S6 | Business representative creator cards | `mingla-business/src/components/event/EventListCard.tsx` (`host` ~275) + `mingla-business/src/components/trip/TripListCard.tsx` (`host` ~247) | A — translucent fill + border + no clip | Symptom A (proof sample) |

### 2.2 Non-goals (explicitly deferred to the later sweep)

- The ~95 consumer translucent-fill HIGH instances and ~50 dark-canvas glass surfaces (investigation §3.2). NOT touched.
- The ~215 business HIGH inline card/pill/input instances across ~80 files (investigation §3.3) beyond the 4 representative surfaces above. NOT touched.
- `packages/event-rendering/GlassBlur.tsx` + the 11 public-page panels (investigation §4.3, Sub-C). NOT touched.
- Business Symptom-B stragglers Toast / AiDisclosureModal / BlastCustomersCta (investigation §4.2, Sub-D). NOT touched.
- Token consolidation into `@mingla/design-tokens` (Sub-F). NOT touched.
- Real `dimezisBlurView` hero-surface validation. NOT touched.
- Token triplication is NOT reconciled. The consumer `designSystem.ts` and business `designSystem.ts` are edited independently below; `packages/event-rendering/designTokens.ts` is NOT edited (no scoped file imports it for these surfaces). See §9 Hard Guards.

### 2.3 Assumptions

- The investigation's catalog (file:line, exact styles) is current truth; verified live against the worktree on 2026-05-29 (all cited lines confirmed). 
- The business creator canvas behind S5/S6 is the dark `canvas.profile` family (`#141113` / `#0c0e12`); the existing proven business opaque fallback `rgba(20,22,26,0.92)` reads correctly on it (it is the shipped `GlassChrome` fallback). Confirmed in `GlassChrome.tsx:68`.
- Consumer chrome fallback tokens (`glass.chrome.fallback.solid = rgba(22,24,28,0.94)`, `glass.bottomSheet`/`stickyHeader.fallbackSolid` etc.) already exist and are ≥ 0.92 alpha — flipping the gate reaches them with zero new color invention. Confirmed in `designSystem.ts:413/484/663/675/691/747/766/785`.

---

## 3. The shared mechanism (canonical "Android-safe glass surface" recipe)

Two defect classes → two recipe halves. Both reuse patterns that ALREADY exist in the codebase; no parallel system is invented.

### 3.1 Recipe-A — Symptom A (fill must reach the rounded corner; no hard Android shadow rectangle)

A rounded surface that carries a `borderRadius` + (`borderWidth` and/or `elevation`/shadow) + a fill MUST, on Android, satisfy ALL of:

1. **`overflow: 'hidden'`** on the rounded fill view — clips the fill + border to the radius so they composite as one layer (kills the inset-ring). Proven reference: consumer `board/SwipeableSessionCards.tsx:699`; business `GlassChrome.tsx` `clip` view (`overflow:'hidden'`).
2. **Opaque (≥ 0.92) fill on Android** via `Platform.select({ ios: <existing translucent>, android: <opaque equivalent>, default: <existing> })`. The opaque equivalent is the existing translucent fill composited over its real background (computed per surface in §4).
3. **Elevation routed so the shadow never draws under the rounded fill on Android.** Either zero the Android elevation (`Platform.select({ ios: N, android: 0 })`, mirroring business `androidSafeElevation()` at `mingla-business/src/constants/designSystem.ts:26`) OR move the shadow to an outer non-clipping wrapper (the `GlassChrome` outer-view pattern). For S5/S6 the chosen path is **zero the Android elevation** (the surfaces already render acceptably with iOS shadow; the Android elevation is the artifact).

> 🔒 LOCKED: `overflow:'hidden'` + opaque-Android-fill + no-Android-elevation-under-rounded-fill is the mechanism. 🎨 OPEN: whether the implementor zeroes elevation vs. lifts the shadow to a wrapper, per surface, as long as no hard Android shadow rectangle remains and iOS is pixel-unchanged.

### 3.2 Recipe-B — Symptom B (chrome reads as solid frosted, not see-through)

A floating glass-chrome surface that today renders `useGlass ? <BlurView+tint> : <fallbackSolid View>` MUST, on Android, take the fallback-solid branch. The fallback-solid tokens already exist and are ≥ 0.92 opaque. Mechanism = make the gate evaluate to "no blur" on ALL Android (not just API < 31).

> 🔒 LOCKED: every in-scope chrome surface routes to its EXISTING `fallbackSolid` token on Android. No new tint floors, no `dimezisBlurView` on these surfaces.

### 3.3 Consumer helper vs per-component patch — RECOMMENDATION

**Recommendation: add ONE tiny shared helper to the consumer `designSystem.ts` and have the 8 chrome components import it, replacing their inline `const isAndroidPreBlur = …`.** Justification:

- The gate is currently **duplicated verbatim in 8 files** (`GlassBottomNav.tsx:66`, `GlassTopBar.tsx:81`, `DiscoverScreen.tsx:96`, `ui/GlassCard.tsx:42`, `ui/GlassBadge.tsx:54`, `ui/GlassIconButton.tsx:55`, `LikesPage.tsx:33`, `ConnectionsPage.tsx:374`). A shared export is a single source of truth that kills the drift that caused this bug, and it is the minimal change (one new const + 8 one-line import/replace edits). This mirrors the business app's centralized `shouldUseRealBlur()` posture (`GlassChrome.tsx:80`) — we are converging the two apps' strategy, not inventing a third.
- This is preferred over a new wrapper *component* (which would force restructuring 8 render trees — out of scope and risky for a first strike). We add a **boolean helper only**, not a primitive component.

Helper contract (consumer `designSystem.ts`, exported):

```ts
// META-ORCH-1002 Sub-1: Android glass policy = OPAQUE frosted fallback by default.
// expo-blur on Android renders a thin semi-transparent view (or, with dimezisBlurView,
// an unreliable experimental blur). Policy Option 1: route ALL Android to the opaque
// fallbackSolid branch; reserve real blur for on-device-validated hero surfaces only.
// Replaces the per-component `Platform.Version < 31` gate that left Android 12+ on BlurView.
export const ANDROID_GLASS_USES_OPAQUE_FALLBACK = Platform.OS === 'android';
```

Each of the 8 components replaces its inline `const isAndroidPreBlur = Platform.OS === 'android' && Platform.Version < 31;` with an import of `ANDROID_GLASS_USES_OPAQUE_FALLBACK` and substitutes it 1:1 wherever `isAndroidPreBlur` was read (i.e. `useGlass = !reduceTransparency && !ANDROID_GLASS_USES_OPAQUE_FALLBACK`, `useBackdropGlass = …`, `useOrangeFallback = reduceTransparency || ANDROID_GLASS_USES_OPAQUE_FALLBACK`). Behavior identical on iOS (`false`) and on Android ≤ 11 (`true`, unchanged); the ONLY behavior change is Android 12+ now also evaluates `true` → opaque fallback. The local symbol MAY be renamed or kept aliased (`const isAndroidPreBlur = ANDROID_GLASS_USES_OPAQUE_FALLBACK;`) — 🎨 OPEN, implementor's choice — provided no file retains a live `Platform.Version < 31` glass gate.

> 🔒 LOCKED: single shared exported boolean is the gate authority for these 8 files; no file keeps a live `Platform.Version < 31` glass gate after this strike. 🎨 OPEN: local alias naming.

---

## 4. Exact per-surface changes (with hex values)

### S1 — Consumer notification card (Symptom A)
**File:** `app-mobile/src/components/NotificationsSheet.tsx` + `app-mobile/src/constants/designSystem.ts`

Current (`NotificationsSheet.tsx:952` `notificationCard`): `borderRadius:20` + `borderWidth:1` (`cardBorder rgba(0,0,0,0.06)`) + `backgroundColor:'#FFFFFF'` + `cardShadow` (`elevation:2`), NO `overflow:'hidden'`. `notificationCardUnread` (969) overrides fill to `cardUnreadBg rgba(255,247,237,0.6)` (translucent). `skeletonCard` (1185) mirrors the read card.

**Changes:**
1. Add `overflow: 'hidden'` to `notificationCard` and `skeletonCard`. 🔒 LOCKED.
2. The READ fill is already opaque `#FFFFFF` — no change. 🔒 LOCKED.
3. The UNREAD fill `glass.notificationsSheet.cardUnreadBg` is translucent `rgba(255,247,237,0.6)` over the `#FFFFFF` card → composites to **`#FFFAF4`** (R: 0.6·255+0.4·255=255=FF; G: 0.6·247+0.4·255=250=FA; B: 0.6·237+0.4·255=244=F4). Replace the token with the opaque hex on Android via `Platform.select`, keeping iOS exactly as-is:
   ```ts
   cardUnreadBg: Platform.select({
     ios: 'rgba(255, 247, 237, 0.6)',
     android: '#FFFAF4',
     default: 'rgba(255, 247, 237, 0.6)',
   }),
   ```
   🔒 LOCKED mechanism. 🎨 OPEN: the exact opaque unread hex (`#FFFAF4` is the mathematically-composited value; a designer may nudge ±2 per channel for warmth, but it MUST be fully opaque and read as the same warm cream — propose and ship `#FFFAF4`).
4. Android elevation: with `overflow:'hidden'` + opaque fill the `elevation:2` shadow no longer rings the corner; `elevation:2` is low enough to keep on Android (it reads as a soft lift on white, not a hard rectangle). KEEP `cardShadow` unchanged. 🔵 If on-device the elevation:2 still shows a faint Android rectangle, zero it via `Platform.select` — 🎨 OPEN fallback only.

**Why both directions hold:** `overflow:'hidden'` clips fill+border to radius (kills ring) AND the opaque unread fill removes the translucency that let the border show through. iOS keeps the translucent cream (Platform.select ios branch) and gains nothing/loses nothing visually since iOS never had the ring (it composites correctly).

### S2 — Consumer chrome gate (Symptom B root)
**Files:** `app-mobile/src/constants/designSystem.ts` (add `ANDROID_GLASS_USES_OPAQUE_FALLBACK`, ensure `Platform` is imported) + the 8 components in §3.3.

**Change:** per §3.3. Each component now takes its EXISTING opaque fallback branch on all Android. No fallback color changes — they already exist and are ≥ 0.92:
- `GlassBottomNav` → `glass.chrome.fallback.solid` = `rgba(22,24,28,0.94)` ✓
- `GlassTopBar` / `DiscoverScreen` badges / `GlassIconButton` / `GlassBadge` → `glass.chrome.fallback.solid` / token `fallbackSolid` siblings (all `rgba(28,30,34,0.92)`–`rgba(22,24,28,0.94)`) ✓
- `LikesPage` / `ConnectionsPage` sticky headers → `g.stickyHeader.fallbackSolid` = `rgba(22,24,28,0.94)` ✓
- `GlassCard` (profile bento) → its `fallback.solid` (verify token; `rgba(22,24,28,0.94)` family) ✓

🔒 LOCKED: route to existing tokens, invent nothing. 🎨 OPEN: none for color.

### S3 — Consumer chat-input capsule (Symptom B worst)
**File:** `app-mobile/src/components/MessageInterface.tsx` (~1912)

Current: capsule (`inputCapsule:3078` — already has `overflow:'hidden'`, good) renders **unconditionally** `<BlurView intensity={glass.chrome.blur.intensity} tint="dark" experimentalBlurMethod={android?'dimezisBlurView'} />` + a tint-floor View `glass.chrome.tint.floor` (`rgba(12,14,18,0.48)`). NO platform guard, NO fallback branch.

**Change:** gate the blur the same way chrome does — when `ANDROID_GLASS_USES_OPAQUE_FALLBACK` (i.e. on Android), render an opaque fallback View instead of the BlurView, and drop/replace the translucent tint floor so the surface is solid:
```tsx
{ANDROID_GLASS_USES_OPAQUE_FALLBACK ? (
  <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: glass.chrome.fallback.solid }]} />
) : (
  <>
    <BlurView intensity={glass.chrome.blur.intensity} tint="dark"
      experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
      style={StyleSheet.absoluteFill} pointerEvents="none" />
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: glass.chrome.tint.floor }]} />
  </>
)}
```
Opaque fill = `glass.chrome.fallback.solid` = **`rgba(22,24,28,0.94)`** (≥ 0.92, the same token the rest of the chrome uses → visual consistency with the bottom nav directly below it). 🔒 LOCKED color + branch structure. The capsule already clips (`overflow:'hidden'`) so no Symptom-A work here. On iOS the path is byte-identical to today (`ANDROID_GLASS_USES_OPAQUE_FALLBACK === false`).

> Note: import `ANDROID_GLASS_USES_OPAQUE_FALLBACK` into `MessageInterface.tsx` (it has no inline gate today). `Platform` is already imported there.

### S4 — Consumer bottom nav (Symptom B chrome)
**File:** `app-mobile/src/components/GlassBottomNav.tsx`

Current (208): `useGlass ? <BlurView dimezisBlurView> : <View fallback.solid>`. `useGlass = !reduceTransparency && !isAndroidPreBlur` (141). **Fixed automatically by S2** — once `isAndroidPreBlur` is replaced by `ANDROID_GLASS_USES_OPAQUE_FALLBACK`, `useGlass` is `false` on all Android → opaque `glass.chrome.fallback.solid` (`rgba(22,24,28,0.94)`). No direct patch needed beyond the S2 gate substitution in this file. 🔒 LOCKED: confirm-via-S2. (The implementor MUST still perform the inline-gate→shared-helper substitution in this file; it is one of the 8.)

### S5 — Business trip tab-bars (Symptom A worst — raw elevation:8)
**Files:** `mingla-business/src/components/trip/EditPublishedTripIntakeAccordion.tsx` (`tabActive` ~520) + `mingla-business/src/components/trip/TripCreatorStep6Intake.tsx` (`tabActive` ~295). Identical style block in both.

Current `tabActive`: `backgroundColor: accent.tint` (`rgba(235,120,37,0.28)`) + `borderColor: accent.border` + `shadowColor:'#eb7825'` + `shadowOpacity:0.35` + `shadowRadius:14` + **`elevation: 8`** (raw, bypasses `androidSafeElevation`). The pill is rounded (`tab.borderRadius: radius.full`) with a translucent fill and no clip → on Android the `elevation:8` draws a hard rectangular shadow under the rounded pill (the photographed artifact class).

**Change (route through the existing primitive, not a new pattern):** zero the Android elevation exactly as `androidSafeElevation()` does for every other business shadow token. Two feasible mechanisms — pick ONE, both LOCKED-acceptable:

- **Preferred (minimal, no export change):** replace the inline `elevation: 8` with `elevation: Platform.select({ ios: 8, android: 0, default: 8 })` in both files. (`Platform` is already imported in both; if not, add it.) This is the exact behavior of the private `androidSafeElevation(8)` and keeps the iOS glow shadow intact.
- **Alternative:** export `androidSafeElevation` from `mingla-business/src/constants/designSystem.ts` and call `elevation: androidSafeElevation(8)`. Cleaner long-term but adds an export; acceptable.

🔒 LOCKED: Android elevation under the rounded pill MUST be 0; iOS `elevation:8` + glow unchanged. 🎨 OPEN: inline `Platform.select` vs. exported `androidSafeElevation`. No fill/border change needed — the iOS shadow is the only artifact; the fill stays `accent.tint`. (The tab fill is `accent.tint rgba(235,120,37,0.28)`; on the dark canvas this reads as a translucent orange selection, which is intended — Symptom A here is ONLY the elevation rectangle.)

### S6 — Business representative creator cards (Symptom A proof sample)
**Files:** `mingla-business/src/components/event/EventListCard.tsx` (`host` ~275) + `mingla-business/src/components/trip/TripListCard.tsx` (`host` ~247). Identical block.

Current `host`: `backgroundColor: glass.tint.profileBase` (`rgba(255,255,255,0.04)`) + `borderRadius: radius.lg` + `borderWidth:1` + `borderColor: glass.border.profileBase` (`rgba(255,255,255,0.08)`) + `overflow:'visible'`, no elevation. On the dark business canvas the 0.04 translucent fill + border with no clip can show the corner-misalignment ring.

**Changes:**
1. Add `overflow: 'hidden'` to `host`. 🔒 LOCKED. (Note: child media already uses `overflow:'hidden'` at `coverWrap`; verify the parent clip does not crop an intentionally-overflowing badge — if any child intentionally overflows `host`, keep `host` visible and instead wrap the fill+border in an inner clip view per the `GlassChrome` pattern. 🎨 OPEN: clip-on-host vs. inner-clip-view, implementor verifies on-device that no child is clipped.)
2. Opaque Android fill. `glass.tint.profileBase rgba(255,255,255,0.04)` over `canvas.profile #141113` composites to **`#1D1B1C`** (R: 0.04·255+0.96·20=29=1D; G: 0.04·255+0.96·17=27=1B; B: 0.04·255+0.96·19=28=1C). **Recommended LOCKED value: reuse the existing proven business opaque `rgba(20,22,26,0.92)`** (the `GlassChrome` `FALLBACK_BACKGROUND`) rather than the raw computed `#1D1B1C`, because (a) it is the already-shipped, on-device-validated business glass-fallback color, (b) it keeps these cards visually consistent with every other Android-fallback business surface, and (c) it avoids introducing a new bespoke hex that diverges from the kit. Apply via:
   ```ts
   backgroundColor: Platform.select({
     ios: glass.tint.profileBase,            // rgba(255,255,255,0.04)
     android: 'rgba(20, 22, 26, 0.92)',
     default: glass.tint.profileBase,
   }),
   ```
   🔒 LOCKED: opaque Android fill ≥ 0.92. 🎨 OPEN: `rgba(20,22,26,0.92)` (recommended, kit-consistent) vs. the surface-true computed `#1D1B1C` — a designer may choose `#1D1B1C` if the card must read warmer than chrome; both satisfy the policy. Ship `rgba(20,22,26,0.92)`.

No elevation change (these cards have none).

---

## 5. Cross-Surface Impact (Phase 2.5 — MANDATORY)

| Surface | Covered? | Behavior demanded | Files | Parity |
|---|---|---|---|---|
| 1. Consumer iOS (`app-mobile`) | YES (no-op) | Pixel-identical to today. Every change is behind `Platform.select` ios / `ANDROID_GLASS_USES_OPAQUE_FALLBACK===false`. | S1–S4 files | Automatic (shared code, iOS branch unchanged) |
| 2. Consumer Android (`app-mobile`) | YES | S1 notification card fill reaches corners, no ring; S2/S4 bottom nav, top bar, icon buttons, badges, sticky headers, profile bento, discover badges = solid frosted; S3 chat input = solid frosted. | S1–S4 files | This is the target surface |
| 3. Buyer/anon Web (`mingla-business` web) | NO | These are RN-mobile surfaces; the public web pages route through `GlassBlur.tsx`/`GlassChrome` web path, NOT touched here (deferred Sub-C). | — | N/A |
| 4. Business iOS (`mingla-business`) | YES (no-op) | Pixel-identical: S5 keeps `elevation:8`+glow (ios branch); S6 keeps `rgba(255,255,255,0.04)` (ios branch). | S5, S6 files | Automatic |
| 5. Business Android (`mingla-business`) | YES | S5 trip tab-bars show NO hard rectangular shadow (elevation 0); S6 event/trip list cards render solid frosted with fill reaching corners. | S5, S6 files | This is the target surface |
| 6. Admin Web (`mingla-admin`) — adjacent | NO | Admin does not render any of these components. | — | N/A |
| 7. Business Web preview — adjacent | NO | Same as #3 — web glass path deferred to Sub-C. | — | N/A |

**Cross-surface impact of the S2 gate fix (which other surfaces it touches — confirm acceptable):** flipping `isAndroidPreBlur → ANDROID_GLASS_USES_OPAQUE_FALLBACK` changes Android-12+ rendering for ALL consumers of the 8 chrome components: `GlassBottomNav` (every screen's bottom nav), `GlassTopBar` (top bars), `GlassIconButton` (all glass icon buttons app-wide), `GlassBadge` (badges), `GlassCard` (profile bento + any `GlassCard` consumer), `DiscoverScreen` (card top-badge / save button / bottom chip), `LikesPage` + `ConnectionsPage` sticky headers. **This is the intended, acceptable blast radius** per the operator's "one change powers the bottom nav, top bar, icon buttons, badges, sticky headers at once" directive: every one of these already has a designed, ≥0.92 opaque `fallbackSolid` token that was previously unreachable on Android 12+. The change makes them all *consistently solid frosted* — a uniform improvement, not a regression. iOS and Android ≤ 11 are byte-identical to today. Per-surface success criteria are SC-2a…SC-2f below so the tester verifies each consumer.

**Manual-parity note:** S5 and S6 each touch TWO files with identical blocks — both must be edited (separate success criteria SC-5a/SC-5b, SC-6a/SC-6b) so neither is skipped.

---

## 6. Success criteria

Observable, testable, per-surface where parity is manual.

- **SC-1 (S1, Android):** On Android, the unread notification card shows a fully opaque warm-cream fill (`#FFFAF4`) that reaches all four rounded corners — no taupe/sand ring, no inset fill. Read cards show opaque `#FFFFFF` to the corners. Skeleton card matches.
- **SC-1-iOS:** On iOS, the notification card is pixel-identical to pre-change (translucent `rgba(255,247,237,0.6)` unread, white read).
- **SC-2 (S2/S4, Android):** On Android 12+, the bottom nav reads as a solid frosted dark capsule (`rgba(22,24,28,0.94)`), not see-through, over busy content.
  - **SC-2a** Bottom nav (`GlassBottomNav`) solid.
  - **SC-2b** Top bar (`GlassTopBar`) solid.
  - **SC-2c** Glass icon buttons (`GlassIconButton`) solid.
  - **SC-2d** Badges (`GlassBadge`) solid.
  - **SC-2e** Sticky headers (`LikesPage`, `ConnectionsPage`) solid.
  - **SC-2f** Profile bento (`GlassCard`) + Discover badges/save/chip (`DiscoverScreen`) solid.
- **SC-2-iOS:** All eight chrome components render real BlurView on iOS exactly as today; Android ≤ 11 unchanged.
- **SC-2-grep:** No `app-mobile` glass component retains a live `Platform.Version < 31` glass gate; all read the shared `ANDROID_GLASS_USES_OPAQUE_FALLBACK`.
- **SC-3 (S3, Android):** The chat-input capsule renders a solid frosted dark fill (`rgba(22,24,28,0.94)`), not a 0.48-tint see-through blur, over the conversation. Capsule corners stay clipped.
- **SC-3-iOS:** Chat capsule renders BlurView + tint floor exactly as today on iOS.
- **SC-5a (S5):** `EditPublishedTripIntakeAccordion` active trip tab shows NO hard rectangular Android shadow; iOS glow + elevation unchanged.
- **SC-5b (S5):** `TripCreatorStep6Intake` active trip tab — same.
- **SC-6a (S6):** `EventListCard` host renders a solid frosted fill reaching the rounded corners on Android; no child content is clipped; iOS unchanged.
- **SC-6b (S6):** `TripListCard` host — same.
- **SC-7 (global):** ZERO touched-file change affects any surface outside §2.1. No `packages/event-rendering/*`, no third token file, no backend, no new dependency.

---

## 7. Invariants

**Preserved:**
- **I-7 (no `return null` for unsupported glass; visible degradation):** every changed branch renders a visible opaque View, never null. Verified by SC-2/SC-3.
- **I-MOR-0827-PACKAGE-ISOLATION:** `packages/event-rendering/designTokens.ts` is NOT edited (no scoped file imports it for these surfaces).
- **iOS-render-frozen:** every change is behind `Platform.select`/`ANDROID_GLASS_USES_OPAQUE_FALLBACK`; iOS branch is byte-identical. Verified by SC-1-iOS, SC-2-iOS, SC-3-iOS.

**New (proposed for this strike, DRAFT → ACTIVE on CLOSE):**
- **I-ANDROID-GLASS-OPAQUE-FALLBACK (DRAFT):** On Android, in-scope glass chrome surfaces render an opaque (≥ 0.92) `fallbackSolid` fill, never an `expo-blur` BlurView (unless a future ORCH explicitly validates a `dimezisBlurView` hero surface on-device). Enforced for the 8 chrome files + chat capsule by SC-2-grep + the regression test.
- **I-ANDROID-ROUNDED-FILL-CLIPPED (DRAFT, scoped to S1/S6):** a rounded surface with a border/fill must carry `overflow:'hidden'` (or inner-clip view) so the fill reaches the corner on Android. (Full-codebase enforcement deferred to the sweep; this strike asserts it only on the scoped surfaces.)

---

## 8. Test cases & regression plan (orchestrator Step 0.5 gate)

Pixel rendering can't be unit-asserted in this repo (consumer "tests" are source-pattern node scripts; business uses ts-jest `testEnvironment:node`). Tests are **style/Platform.select source assertions** — feasible and the established pattern (`app-mobile/src/components/__tests__/NotificationsSheet.test.tsx` reads source + asserts string patterns). On-device pixel verification is the tester's live-fire job (§8.3).

### 8.1 Implementor happy-path test (REQUIRED — ships in the PR)

Add a source-assertion test (consumer side: a node script under `app-mobile/scripts/ci/` or a `__tests__` source-reader matching the existing pattern; business side: a ts-jest source-reader test):

| Test | Scenario | Assertion | Layer |
|---|---|---|---|
| T-01 | S2 shared gate exists | `designSystem.ts` exports `ANDROID_GLASS_USES_OPAQUE_FALLBACK = Platform.OS === 'android'`; `Platform` imported | Source |
| T-02 | S2 gate adopted | each of the 8 chrome files imports `ANDROID_GLASS_USES_OPAQUE_FALLBACK` AND contains NO live `Platform.Version < 31` glass gate | Source |
| T-03 | S1 clip + opaque unread | `NotificationsSheet.tsx` `notificationCard` + `skeletonCard` contain `overflow: 'hidden'`; `designSystem.ts` `cardUnreadBg` is a `Platform.select` with `android: '#FFFAF4'` | Source |
| T-04 | S3 chat capsule guarded | `MessageInterface.tsx` capsule renders the opaque-fallback branch keyed on `ANDROID_GLASS_USES_OPAQUE_FALLBACK` with `glass.chrome.fallback.solid`; BlurView is no longer unconditional | Source |
| T-05 | S5 elevation zeroed (×2) | both trip files' `tabActive` no longer contain a bare `elevation: 8`; Android elevation resolves to 0 (`Platform.select({…android:0…})` or `androidSafeElevation(8)`) | Source |
| T-06 | S6 clip + opaque (×2) | both list-card files' `host` contain `overflow: 'hidden'` and an Android opaque fill (`rgba(20, 22, 26, 0.92)`) via `Platform.select` | Source |
| T-07 | iOS frozen | every change retains the original iOS value in the `ios`/`default` branch (assert the original tokens still present) | Source |

The happy-path test the implementor owns: **T-01 + T-03** (the shared gate exists and the photographed notification card is clipped + opaque on Android). The implementor wires these to a `package.json` script (consumer: `scripts/ci/meta-orch-1002-android-glass-check.mjs`; business: a `__tests__` ts-jest file) and adds them to the CI gate.

### 8.2 Where the tester's adversarial test should attack

- **Revert-canary:** assert the test FAILS if any chrome file's gate is reverted to `Platform.Version < 31` (catches partial adoption).
- **iOS-regression guard:** assert NO `Platform.select` lost its `ios`/`default` branch and that iOS still renders BlurView for all 8 chrome + the chat capsule (the failure mode is "implementor made it opaque on iOS too").
- **Token-leak guard:** assert no NEW translucent (`< 0.92` alpha) Android fill was introduced on the 6 surfaces; assert no `packages/event-rendering/*` or consumer↔business *other* token file was edited (I-MOR-0827 + no-triplication-divergence).
- **Clip-without-crop:** on-device, verify S6 `overflow:'hidden'` on `host` does not clip an intentionally-overflowing child badge (the one judgment call flagged 🎨 OPEN in S6).
- **Both-files parity:** assert S5 and S6 edited BOTH files (the skip-one failure mode).

### 8.3 On-device live-fire (tester, MANDATORY for verdict)

Per Prime Directive 7 + the success criteria: physical/emulated Android, before/after screenshots of (a) the notification card unread fill, (b) chat input + bottom nav over busy chat content, (c) the two trip tab-bars' active pill, (d) the two list cards; plus an iOS pass confirming no visual change. Metro port 8087, this worktree. Maestro/emulator drivers per the skill rules; never global-kill another session's Metro/sim.

---

## 9. Implementation order & hard guards

**Order:**
1. Consumer `designSystem.ts`: add `ANDROID_GLASS_USES_OPAQUE_FALLBACK` export + ensure `Platform` import; change `cardUnreadBg` to `Platform.select` with `android:'#FFFAF4'` (S1 token half).
2. Consumer `NotificationsSheet.tsx`: add `overflow:'hidden'` to `notificationCard` + `skeletonCard` (S1).
3. Consumer 8 chrome files: replace inline gate with the shared import (S2/S4).
4. Consumer `MessageInterface.tsx`: gate the capsule blur → opaque fallback (S3).
5. Business `EditPublishedTripIntakeAccordion.tsx` + `TripCreatorStep6Intake.tsx`: Android-zero the `tabActive` elevation (S5).
6. Business `EventListCard.tsx` + `TripListCard.tsx`: `overflow:'hidden'` + Android opaque `host` fill (S6).
7. Tests T-01…T-07 + wire CI scripts.

**Hard guards (🔒 LOCKED):**
- Touch ONLY the files in §2.1. No other component, no `packages/`, no `mingla-admin/`.
- **No token-triplication divergence.** The consumer `designSystem.ts` and business `designSystem.ts` are edited independently (they are already separate sources). `packages/event-rendering/designTokens.ts` is NOT edited (no scoped file imports it for these surfaces). Note for the LATER sweep: when `GlassBlur.tsx` / public pages are fixed (Sub-C), the third token file participates — out of scope now.
- No `supabase`/migration/edge-function/RLS touch. No new dependency. No `package.json` dep change (CI script entries only).
- **Preserve iOS rendering EXACTLY** — every change is gated; no iOS branch value changes.
- No `dimezisBlurView` added or removed on hero surfaces (out of scope); the existing `experimentalBlurMethod={android?'dimezisBlurView':undefined}` lines stay on the now-unreachable-on-Android blur branches (harmless dead-on-Android, preserved for the eventual hero-surface ORCH).

---

## 10. References examined

- Consumer positive reference: `app-mobile/src/components/board/SwipeableSessionCards.tsx:699` (`overflow:'hidden'` + Platform-branched shadow).
- Business canonical correct stack: `mingla-business/src/components/ui/GlassChrome.tsx` (clip view + `rgba(20,22,26,0.92)` opaque Android fallback + `shouldUseRealBlur()`), `mingla-business/src/constants/designSystem.ts:26` (`androidSafeElevation`).
- expo-blur Android behavior: `BlurView.types.d.ts:2-11` — `experimentalBlurMethod` defaults `'none'` on Android = semi-transparent view fallback (investigation §2).
- Premium frosted-surface intent (iOS source-of-truth look the Android opaque must match): Apple Music / iOS Control Center material; Linear & Things for solid-frosted card surfaces on non-blur platforms.

---

## 11. Open design questions (for Seth / mingla-designer, non-blocking — concrete values proposed)

1. **Unread notification opaque cream** — proposed `#FFFAF4` (mathematically composited). A designer may warm it ±2/channel; ship `#FFFAF4` unless overridden. (🎨 OPEN, S1.)
2. **Business card Android opaque fill** — proposed `rgba(20,22,26,0.92)` (kit-consistent, on-device-validated) vs. surface-true `#1D1B1C` (warmer, matches the card's own canvas). Ship `rgba(20,22,26,0.92)`. (🎨 OPEN, S6.)

Everything else is 🔒 LOCKED.
