# INVESTIGATION — Android glass rendering: "fill doesn't fill the card" + "sheets too transparent"

**Date:** 2026-05-29
**Mode:** INVESTIGATE (cross-surface forensic sweep)
**Trigger:** Operator saw notification cards on a physical Samsung (SM-A725F) where the cream/white fill doesn't reach the rounded corners (a taupe ring around an inset fill), plus sheets that look too transparent on Android. Requested a total robust investigation across the consumer app, the business app, and shared packages.
**Surfaces:** Consumer Android (`app-mobile`), Business Android (`mingla-business` RN-mobile), shared `packages/` (render natively on Android in the business app). iOS unaffected. Web (Next.js) out of scope.
**Method:** Physical-device repro + screenshot, then 5 parallel forensic agents cataloguing every instance across both apps + shared packages + token sources + RN/Expo versions.

---

## 1. Executive summary

There are **two distinct Android-only defect classes**, both flowing from one architectural fact: **Mingla's "glass" (glassmorphism) design language was built for iOS, and Android handling is inconsistent and duplicated across three separate token sources.**

| | Symptom A — "fill doesn't fill the card" | Symptom B — "sheets too transparent" |
|---|---|---|
| **What you see** | Rounded card shows a taupe/sand ring; the cream/white fill looks inset, not reaching the corner. | Bottom sheets / chrome / overlays look washed-out and see-through over busy content. |
| **Mechanism** | A single `View` combines `borderRadius` + a border and/or `elevation`/shadow + a **translucent or same-as-parent** `backgroundColor`, with **no `overflow:'hidden'`**. Android composites the border/shadow layer and the fill layer separately, so they misalign at the rounded corners. | `expo-blur`'s `BlurView` renders a **thin semi-transparent `View`** on Android unless `experimentalBlurMethod="dimezisBlurView"` is set — and even then it's experimental/unreliable. Low-alpha tint floors (0.04–0.58) were designed to sit on top of a real frost that never materializes. |
| **Consumer app** | Confirmed exemplar = `NotificationsSheet` card. ~95 HIGH translucent + ~15 MED opaque-on-white instances; many HIGH are intentional dark-canvas glass (verify visually). | Root = a version gate that only falls back to opaque on **Android ≤ 11**. On Android 12+ (most devices) all floating glass chrome uses BlurView. 9 HIGH chrome surfaces; chat-input capsule is worst (no guard at all). Full-screen sheets are FINE (opaque). |
| **Business app** | **Systemic — ~215 HIGH instances across ~80 files.** Rounded + 1px translucent border + `rgba(255,255,255,0.03–0.08)` fill is the *house style*, inlined everywhere (event/trip creators, marketing composer, brand/door/ari). Two pill tab-bars also stack a raw `elevation:8`. | **Mostly already solved** — sheets route Android to an opaque `rgba(20,22,26,0.92)` fallback. Only 3 stragglers leak (Toast, AiDisclosureModal, BlastCustomersCta). |
| **Shared package** | `EventCoverMedia`/`EventCover` use `overflow:'hidden'` → **mitigated**. | `GlassBlur.tsx` branches only on web → raw thin blur on Android with **no** `experimentalBlurMethod`. Drives 11 public-page glass panels (PublicEventPage, PublicBrandPage) that render natively on Android in the business app. |

**The deepest root:** there is **no shared design-token package**. Glass/blur/elevation tokens are **triplicated** (`app-mobile/src/constants/designSystem.ts:258`, `mingla-business/src/constants/designSystem.ts:194`, `packages/event-rendering/designTokens.ts:41`), and the two apps adopt **opposite** Android blur strategies (consumer = real `dimezisBlurView`; business = opaque fallback). Any clean fix must decide one strategy and either consolidate tokens or fan the same change across three files.

---

## 2. Environment / versions (both apps pinned identically)

| Package | app-mobile | mingla-business |
|---|---|---|
| react-native | 0.81.5 | 0.81.5 |
| expo | ~54.0.34 | ~54.0.34 |
| expo-blur | ~15.0.8 | ~15.0.8 |
| @gorhom/bottom-sheet | 5.2.8 | not present |
| react-native-reanimated | ^4.1.5 | ~4.1.1 |

**Documented platform behavior (root mechanism for Symptom B):** `expo-blur` `BlurView.types.d.ts:2-11` — `experimentalBlurMethod` defaults to `'none'` on Android, and *"`'none'` — Falls back to a semi-transparent view instead of rendering a blur effect."* Real Android blur requires explicitly setting `experimentalBlurMethod="dimezisBlurView"` (doc warns it is experimental + perf-impacting).

No `*.android.tsx` platform-file convention exists anywhere. Android handling is ad hoc: `Platform.OS==='android'` appears 67× in app-mobile, 27× in business.

---

## 3. Symptom A — "fill doesn't fill the card" (inset taupe ring)

### 3.1 Confirmed exemplar (consumer)
`app-mobile/src/components/NotificationsSheet.tsx:952` `notificationCard`:
- `borderRadius:20` + `borderWidth:1` + `borderColor:'rgba(0,0,0,0.06)'` + `elevation:2` + shadow, fill `#FFFFFF` (read) / `rgba(255,247,237,0.6)` (unread, translucent), **no `overflow:'hidden'`**. The 1px border + elevation render a taupe rounded frame; the (translucent) fill misaligns at the corner → the ring you photographed.

### 3.2 Consumer app catalog (summary; full list in agent output)
- **HIGH (translucent fill + signature):** ~95 blocks. Light-canvas exemplar-grade (~24): e.g. `IncomingPairRequestCard.tsx:274`, `PairingInfoCard.tsx:167`, `MultiDayCalendar.tsx:223`, `AddFriendView.tsx:530` (`glassCard`), `OnboardingShell.tsx:384`, `CalendarTab.tsx:1180/1221`, `StartSwipingHeaderButton.tsx:46`, `ChatListItem.tsx:513`, profile pills/tiles.
- **~50 are dark-canvas glass** (PreferencesSheet, MessageInterface, CalendarTab/SavedTab share-sheets, ExpandedCard chips) — likely intentional; verify visually before touching.
- **MED (opaque white = parent bg + border + elev):** ~15 (incl. the exemplar's read state, `AccountSettings.tsx:1139`, `BillingSheet.tsx:504/575`, `PairedPeopleRow.tsx:160`).
- **POSITIVE reference:** `board/SwipeableSessionCards.tsx:699` — `rgba(255,255,255,0.85)` + border + Platform-branched shadow + **`overflow:'hidden'`** = correct.

### 3.3 Business app catalog (systemic)
- **~215 HIGH instances across ~80 files.** It is the app-wide card/pill/input/sheet idiom: rounded + 1px translucent border + `rgba(255,255,255,0.03–0.08)` or `accent.tint rgba(235,120,37,0.28)` fill. Densest in event creators (`CreatorStep2When` 8, `TicketTierEditSheet` 8, `PreviewEventView` 6), trip creators, marketing composer, brand/door/ari surfaces.
- **Worst (stacks both effects):** `trip/EditPublishedTripIntakeAccordion.tsx:520` and `trip/TripCreatorStep6Intake.tsx:295` — `tabActive` adds raw **`elevation:8`** under a rounded translucent pill (bypasses `androidSafeElevation`).
- **POSITIVE infrastructure (already correct, underused):** `designSystem.ts:26 androidSafeElevation()` zeroes elevation on Android for all tokens; `GlassChrome.tsx` is the canonical correct stack (outer view = radius+shadow, no bg; inner `clip` view = `overflow:'hidden'`+radius holding blur/tint/border; Android uses opaque `rgba(20,22,26,0.92)` fallback). `GlassCard` delegates to it. **The HIGH inline styles simply don't route through `GlassChrome`.**

### 3.4 Shared package
`packages/event-rendering/EventCoverMedia.tsx:576` and `EventCover.tsx:122` use translucent fill + radius **but include `overflow:'hidden'`** → mitigated. Not a Symptom-A source.

---

## 4. Symptom B — "sheets too transparent on Android"

### 4.1 Consumer app — the version-gate root
The glass system is gated by one expression repeated across every chrome component:
```ts
const isAndroidPreBlur = Platform.OS === 'android' && Platform.Version < 31;
const useGlass = !reduceTransparency && !isAndroidPreBlur;
```
**The opaque fallback only fires on Android API < 31 (Android 11 and older).** On Android 12+ (the dominant install base) `useGlass` is `true`, so surfaces render `BlurView` + a low-alpha tint floor via `experimentalBlurMethod='dimezisBlurView'` (the experimental/unreliable path). The well-designed `fallbackSolid` tokens exist but are unreachable on modern Android.

**HIGH chrome surfaces (9):** `MessageInterface.tsx:1912` chat-input capsule (**worst — NO guard, NO fallback, always BlurView+0.48 tint**), `GlassBottomNav.tsx:209`, `GlassTopBar.tsx:181`, `ui/GlassIconButton.tsx:200`, `ui/GlassBadge.tsx:215`, `ui/GlassCard.tsx:104` (profile bento, tint 0.04–0.06), `DiscoverScreen.tsx:442` (card badge/save/chip), `ConnectionsPage.tsx:3264` + `LikesPage.tsx:226` sticky headers.

**NOT at risk:** full-screen sheets/modals (NotificationsSheet, ExpandedCardModal, all connection/profile/friend sheets) — they correctly use solid `#FFFFFF`/`#1C1C1E` surfaces with only a translucent backdrop. Risk is concentrated in **floating glass chrome** + the chat-input capsule.

### 4.2 Business app — mostly solved, 3 stragglers
Sheets route Android to opaque `rgba(20,22,26,0.92)` via `shouldUseRealBlur()` returning `false` on Android (`GlassChrome.tsx:81`, `SheetMobile.tsx:90`, `TopSheet.tsx:96`, `Modal.tsx` via GlassCard). Leaks that bypass the helper:
- **F1 HIGH — `ui/Toast.tsx:182`:** `blurOk = Platform.OS !== "web" || ...` → **`true` on Android**, renders real BlurView; solid fallback branch unreachable. Surface alpha ≈ 0.30–0.32. Global toast surface washed-out. (Inverted logic vs the rest of the kit.)
- **F2 MED — `ari/AiDisclosureModal.tsx:67`:** raw `<BlurView intensity={40}>`, no guard; relies on 0.78 tint.
- **F3 MED — `marketing/BlastCustomersCta.tsx:137`:** raw BlurView, no guard; 0.42 orange wash on Android.

### 4.3 Shared package — `GlassBlur.tsx`
`packages/event-rendering/GlassBlur.tsx:43` branches **only** on `Platform.OS === "web"`; on Android it renders raw `<BlurView>` with **no `experimentalBlurMethod`** → Android's `'none'` semi-transparent fallback. Drives 11 public-page glass panels: `PublicEventPage.tsx:552` + `PublicBrandPage.tsx` (×9: lines 549,629,901,980,1078,1235,1320,1392,1418). These render natively on Android in the business app (`app/e/[brandSlug]/[eventSlug].tsx`, `app/b/[brandSlug]/index.tsx`). Symptom B on every native Android render of those public pages.

---

## 5. Architectural root & leverage map

1. **No shared token package.** Glass/blur/elevation tokens triplicated: `app-mobile/.../designSystem.ts:258`, `mingla-business/.../designSystem.ts:194`, `packages/event-rendering/designTokens.ts:41` (its header explicitly says it's a manual duplicate per `I-MOR-0827-PACKAGE-ISOLATION`).
2. **Opposite Android blur strategies.** Consumer = real `dimezisBlurView` (11 sites); business = opaque fallback (`shouldUseRealBlur()=false`, 0 dimezis usages). The shared package follows neither.
3. **Highest-leverage fixes (one change → both apps):** `packages/event-rendering/GlassBlur.tsx` (the only shared blur primitive) and the `EventCoverMedia`/`EventCover` card surfaces.
4. **The correct patterns already exist** — they're just not universally routed through: business `GlassChrome` (clip-view + opaque fallback + `androidSafeElevation`) and consumer `board/SwipeableSessionCards` (`overflow:'hidden'`).

---

## 6. Recommended fix architecture (for SPEC — not yet implemented)

A **META-ORCH with ordered sub-tracks**, because the surface is too large for one PR and the token layer is a prerequisite:

- **Sub-A (foundation):** Decide the single Android glass policy (recommend: **opaque-fallback on Android by default**, matching business's proven approach; reserve real `dimezisBlurView` only for specific hero surfaces where perf + look are validated on-device). Add a tiny shared helper/primitive — `overflow:'hidden'` + opaque Android fill + `androidSafeElevation` — and codify it as an invariant.
- **Sub-B (consumer Symptom B):** Fix the `Platform.Version < 31` gate so the opaque fallback reaches Android 12+; fix the unguarded `MessageInterface` chat-input capsule and the 9 chrome surfaces.
- **Sub-C (shared package):** Fix `GlassBlur.tsx` Android branch + the public-page panels (fixes both apps' public pages at once).
- **Sub-D (business Symptom B stragglers):** Toast (inverted guard), AiDisclosureModal, BlastCustomersCta.
- **Sub-E (Symptom A sweep):** Route the inline rounded+border+translucent surfaces through the clip primitive — phased by surface (consumer light-canvas exemplars first; business creators next). Dark-canvas "intentional glass" verified on-device before touching.
- **Sub-F (token consolidation, optional):** Stand up `@mingla/design-tokens` to kill the triplication so this can't drift again.

Each sub-track ships its own PR with on-device before/after screenshots and an Android regression test.

---

## 7. Evidence appendix
Five forensic agent catalogs (full file:line lists, including business `/tmp/high.txt` + `/tmp/med.txt`) are the source for §3–§5. Physical-device screenshots: `/tmp/mingla-shots/current.png` (full notifications screen), `/tmp/mingla-shots/card_crop.png` (the ring artifact zoomed).
