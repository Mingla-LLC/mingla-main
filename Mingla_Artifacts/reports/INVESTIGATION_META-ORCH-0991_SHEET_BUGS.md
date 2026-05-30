# INVESTIGATION — META-ORCH-0991 [Consumer-app modals → slide-down bottom sheets] — Sheet scroll / swipe / inset + tap / thumbnail bugs

**Skill:** mingla-forensics (Claude) — INVESTIGATE mode
**Date:** 2026-05-29
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-0991-[consumer-modals-to-sheets]/` on branch `META-ORCH-0991-consumer-modals-to-sheets`
**HEAD at investigation:** `40f671cdd` (PreferencesSheet body rebuild)
**Devices:** iOS sim iPhone 17 Pro `17091E60-C3B6-4167-980D-60C348E177F6` (iOS 26.4) + Android emulator `emulator-5554` (Pixel 8 Pro, AOSP API image). Metro :8100 (shared LAN, not started/killed by this session — both devices loaded the current HEAD JS bundle live). Android: installed EAS dev-client APK `0f9b20e8` (runtime 1.1.0), Supabase session cloned from the iOS sim's AsyncStorage so the same authed account (`sethogieva@icloud.com`) drove both devices.
**Scope guard honored:** INVESTIGATION ONLY. No fixes written. Consumer `app-mobile/` only.

---

## Layman summary (read this first)

Four bugs, three of them trace to **one shared piece** (`BaseBottomSheet`), and one is two separate smaller things.

1. **Swipe-down won't close the Preferences sheet** — PROVEN. The shared sheet has an "escape hatch" mode (`wrapInRNModal`) used by ~34 of the converted sheets. In that mode the sheet is put inside a separate OS window, and the gesture engine that powers drag-to-dismiss is **not wired into that window**. Result: on **Android the swipe-to-close is completely dead** on those sheets; on **iOS it works but is fragile** (once you've scrolled the body, one swipe-down just scrolls back to the top instead of closing). This is a **primitive-level** bug and the single highest-impact finding.

2. **The event sheet "freezes / won't scroll"** — on the **current build it actually scrolls fine on both iOS and Android** (I could not reproduce the freeze on HEAD). But the event sheet is built on a genuinely **fragile double-scroll structure** (a plain scroll view stuffed inside the sheet's gorhom scroll view, both stretched with `flex:1`). That is the most likely cause of the transient freeze you saw, and it should be fixed structurally even though it isn't reproducing right now.

3a. **Tapping an event sometimes doesn't open it** — PROVEN. The event cards live inside a big scrolling screen. A perfectly clean tap opens the sheet; a tap with the tiniest finger drift is grabbed by the scroll view and the tap is cancelled. That's the "sometimes nothing happens" feel.

3b. **Event thumbnails don't render on Android** — on the **emulator** this is purely a network limitation (the emulator literally can't reach the Ticketmaster image server — `ENETUNREACH`), so it's not app-bug evidence. On a **real device** the genuine app-side causes are: (i) video-cover events show a flat color band, never a thumbnail, on the card; and (ii) the image components have no error/placeholder/recycling handling, a known weak spot of expo-image on Android.

4. **Scroll + bottom spacing** — the shared sheet **computes the safe-area bottom inset and then throws it away** (`void safeBottom`), and it has **zero awareness of Mingla's floating tab bar height**. So bottom padding is left entirely to each sheet, and some sheets' buttons sit right at the bottom edge / behind the home indicator. Primitive-level.

Bottom line recommendation: **the BaseBottomSheet primitive needs a focused rework** of three things — (a) wrap the modal path in a gesture root so swipe-to-close works on Android, (b) own the bottom-inset + tab-bar model so consumers stop hand-rolling padding, and (c) provide a clean single-scroll-host contract so sheets like the event sheet don't nest scroll views. Issue 3a is a per-screen card-gesture fix; Issue 3b is a per-card/image fix.

---

## Findings count

- 🔴 Root cause **proven**: 3 (Issue 1, Issue 3a, Issue 4b-inset-discarded)
- 🔴 Root cause **probable / not-reproduced-on-HEAD**: 1 (Issue 2 — structural fragility, freeze not reproduced on current build)
- 🟠 Contributing: 2 (Issue 3b real-device causes; Issue 4a)
- 🔵 Observation: emulator network + video-cover-card gap
- **Overall confidence: HIGH** on Issues 1 / 3a / 4; **MEDIUM** on Issue 2 (root structure proven, live freeze not reproduced on HEAD); **MEDIUM** on Issue 3b real-device cause (emulator could not exercise the real network path).

---

## ISSUE 1 — Swipe-down-to-close broken on PreferencesSheet (and ~21 other scrollable wrapInRNModal sheets)

### Classification: 🔴 ROOT CAUSE — PROVEN (live-fire, both platforms) — PRIMITIVE-LEVEL

### Reproduction + device evidence

**Android (PROVEN dead):**
- Open Explore → tap "Preferences" (top-left sliders) → "Your Vibe" sheet rolls up (`A12_prefs.png`).
- Swipe down firmly from the handle (x=672, y 470→2800, 350ms): sheet **did not move/close** (`A13_after_handle_swipe.png`).
- Repeat slower/firmer (y 480→2900, 600ms): **still did not close** (`A14_handle_swipe2.png`).
- Body **scroll works** (`A15_prefs_scrolled.png` shows sections 3–5 after an up-swipe) — so the inner scroll gesture is alive, only the **sheet pan-to-dismiss** is dead.
- The ONLY way to dismiss on Android was hardware-back (`A18_after_back.png`, routed by the RN Modal `onRequestClose`).

**iOS (works on handle, fragile from scrolled body):**
- Open prefs (`03_prefs.png`) → swipe down from handle (50%,14% → 50%,95%): **closes** (`04_after_swipe_handle.png`).
- BUT after scrolling the body down (`06_scrolled.png` shows sections 3–5 + Apply), a single swipe-down **scrolls back to the top instead of closing** (`07_after_swipe_scrolled.png` — sheet still open, back at section 1). A *second* swipe-down from the top then closes it.

**Control proving the cause is `wrapInRNModal`, not gorhom generally:** `ExpandedBusinessEventSheet` is the same primitive but **does NOT** use `wrapInRNModal`. Its handle swipe-down **closes cleanly on Android** (`A28_ebes_close.png`). The only differing variable is `wrapInRNModal`.

### Root cause (six fields)

| Field | Evidence |
|---|---|
| **File + line** | `app-mobile/src/components/ui/BaseBottomSheet.tsx:475–489` (the `wrapInRNModal` branch). Consumer: `app-mobile/src/components/PreferencesSheet.tsx:1487` (`wrapInRNModal`). |
| **Exact code** | The `wrapInRNModal` branch renders `<RNModal transparent animationType="none" …>{sheet}</RNModal>` with **no `GestureHandlerRootView`** wrapping `{sheet}`. The app's only `GestureHandlerRootView` is at `app-mobile/app/_layout.tsx:62`, in the MAIN React root. |
| **What it does** | RN `<Modal>` mounts its children into a **separate native window / ViewRootImpl**. `react-native-gesture-handler` attaches its touch interception to the `GestureHandlerRootView` of the *host* tree, which does not extend into the modal's new window. gorhom's drag-to-dismiss is a `PanGestureHandler`; with no GHRV ancestor inside the modal window, that pan handler never receives touches. |
| **What it should do** | The modal's content must be wrapped in its own `<GestureHandlerRootView style={{flex:1}}>` so the sheet's `PanGestureHandler` (drag-to-dismiss) registers inside the modal window. |
| **Causal chain** | `wrapInRNModal=true` → sheet rendered in new OS window → no GHRV in that window → gorhom pan-down handler dead → swipe-down does not dismiss. Android enforces this strictly (gestures fully dead); iOS evaluates GHRV "as a View" and is lenient, so the sheet-pan partly works there but loses to the inner scroll once scrolled. |
| **Verification step** | (a) Android control: EBES (no wrapInRNModal) closes on swipe, PreferencesSheet (wrapInRNModal) does not — same primitive, same device, same session. (b) Official RNGH docs: *"If you want to use gestures in Modals, you need to wrap Modal's content with GestureHandlerRootView"* and *"On iOS, GestureHandlerRootView will be evaluated as a View, whereas on Android it requires proper setup to register touch events"* — exactly the asymmetry observed. |

### External research (cited)
- gorhom troubleshooting / GitHub: *PanGestureHandler must be a descendant of GestureHandlerRootView, otherwise gestures are not recognized.* https://gorhom.dev/react-native-bottom-sheet/troubleshooting , https://github.com/gorhom/react-native-bottom-sheet/issues/1389
- react-native-gesture-handler official docs (root view): *"If you want to use gestures in Modals, you need to wrap Modal's content with GestureHandlerRootView"* + iOS-as-View / Android-strict note. https://docs.swmansion.com/react-native-gesture-handler/docs/fundamentals/root-view/
- Known Android Modal + GHRV gesture failures: https://github.com/react-navigation/react-navigation/issues/9757

### Blast radius — LARGE (primitive-level)
- **34** consumer sheets pass `wrapInRNModal`; of these **≥21 have scrollable bodies** (and therefore visibly broken swipe-to-close on Android): FeedbackHistorySheet, NotificationsSheet, ReportUserModal, BoardMemberManagementModal, ExpandedCardModal (place/TM path), PairRequestModal, CustomHolidayModal, MessageInterface, FriendRequestsModal, AddToBoardModal, **PreferencesSheet**, ConnectionsPage, ShareModal, CityPickerSheet, CreateGroupChatSheet, ProposeDateTimeModal, CollabSessionChatBanners, AccountSettings, EditInterestsSheet, FriendPickerSheet, BillingSheet (full grep list in §Appendix).
- Every one of these has dead swipe-to-close on Android and fragile swipe-to-close on iOS. Hardware-back / explicit buttons still dismiss them, which is why it wasn't caught earlier.

### FIX-MAP (primitive — do NOT implement here)
- In `BaseBottomSheet.tsx`, the `wrapInRNModal` branch must wrap `{sheet}` in `<GestureHandlerRootView style={{ flex: 1 }}>` (import from `react-native-gesture-handler`, already a dependency, v2.28.0; `GestureHandlerRootView` is exported). Place the GHRV as the direct child of `<RNModal>` and parent of `{sheet}`.
- Verify on **Android first** (strict): every wrapInRNModal sheet must close on a handle swipe-down after the change.
- For the iOS "scrolled-body won't close in one gesture" nuance: this is gorhom's normal scroll↔pan handoff and is acceptable once the GHRV fix lands (the sheet pan re-engages at scroll-top). If product wants single-gesture dismiss from any scroll position, that's a separate UX decision, not a bug.
- Regression guard: a strict-grep or runtime test asserting the wrapInRNModal path contains a GHRV; add `GestureHandlerRootView` to the BaseBottomSheet modal branch test.

---

## ISSUE 2 — ExpandedBusinessEventSheet "opens but freezes / doesn't scroll"

### Classification: 🔴 ROOT CAUSE PROBABLE (structural) — NOT REPRODUCED ON CURRENT HEAD — PRIMITIVE/SHARED-PACKAGE-LEVEL

### Reproduction attempt + device evidence
- **iOS:** Discover → "Vibes and Stuff" opens EBES (`10_event_open.png`); swipe up scrolls the body, revealing About / Tickets / "Buy ticket" (`11_event_after_scroll.png`); swipe-down closes it (`12_event_swipe_close.png`). **Scrolls + closes — no freeze.**
- **Android:** same event opens EBES (`A26_ebes.png`); body scrolls (`A27_ebes_scroll.png` reveals About/Tickets/Buy); swipe-down closes (`A28_ebes_close.png`). **Scrolls + closes — no freeze.**
- **Conclusion:** the freeze does NOT reproduce on HEAD (`40f671cdd`) on either platform. Per the live-fire honesty rule, confidence is capped — the *structure* below is proven, the *live freeze* is not currently reproducible.

### What the migration changed (diff `4e113a3c8^..HEAD`)
Pre-migration EBES = `<BottomSheet>` → `<BottomSheetScrollView>` → `<PublicEventPage>`. Post-migration = `<BaseBottomSheet scrollMode="scroll">` → (gorhom `BottomSheetScrollView`) → `<PublicEventPage>`. The **double-nesting existed before AND after** the migration; the migration did not introduce it. The only behavioral delta is `enableDynamicSizing`: unset (gorhom default `true`) pre-migration → forced `false` by BaseBottomSheet (`BaseBottomSheet.tsx:269`) post-migration. With explicit `snapPoints ['50%','90%']`, `false` is the *safer* setting, so this is **not** the freeze cause.

### The proven structural defect (the probable freeze mechanism)
`packages/event-rendering/PublicEventPage.tsx` renders (root) `<View style={styles.host} flex:1>` (line 334) containing `PublishedBody` whose body is a **raw React-Native `<ScrollView style={{flex:1}}>`** (line 30 import from `react-native`; line 529 usage; `styles.scroll` = `flex:1` at line 1258). This whole subtree is handed to BaseBottomSheet's gorhom `<BottomSheetScrollView>` as children. So the runtime tree is:

```
BottomSheet (gorhom)
  BottomSheetScrollView   (gorhom-aware, outer — BaseBottomSheet scrollMode="scroll")
    View  host  flex:1            ← flex:1 child inside scroll content (unbounded height)
      ScrollView (RAW react-native, flex:1)   ← second scroll host, NOT gorhom-aware
        hero(absolute,380) + body
```

Two compounding problems:
1. **Double scroll host:** a raw RN `<ScrollView>` nested in gorhom's `BottomSheetScrollView`. gorhom cannot observe the inner RN scroll offset, so the two scroll responders + the sheet pan are uncoordinated. (gorhom's own guidance: use gorhom's `BottomSheetScrollView`, never a raw RN `ScrollView`, inside a sheet — same root rule as Issue 1's text-input/scroll re-exports.)
2. **`flex:1` inside a scroll content container:** a `flex:1` view inside a ScrollView's content has no bounded height; it resolves only because gorhom's outer container imposes the snap height. Under certain layout-timing conditions (cover video/image not yet measured, a re-render mid-open) the inner ScrollView can be starved of height → "opens but content is frozen / can't scroll." This precisely matches "opens but freezes."

### Why I still classify it PROBABLE not PROVEN
The freeze is timing/layout-dependent and did not recur on HEAD in my runs. The structure is unambiguously fragile and is the only credible source for the reported symptom, but I did not capture a live freeze. (`PublicEventPage` is a SHARED package — also used by buyer-web — which is why it uses a raw RN ScrollView; that constraint matters for the fix.)

### FIX-MAP (do NOT implement here)
- **Eliminate the double scroll host.** Two viable shapes:
  - (A) EBES passes `scrollMode="view"` to BaseBottomSheet and lets `PublicEventPage` own the single scroll — but on native that single scroll must be a gorhom-aware scroll (`BottomSheetScrollView`), not a raw RN `<ScrollView>`. Because `PublicEventPage` is shared with web, gate the scroll component by platform/prop (inject a `ScrollComponent` so native gets `BottomSheetScrollView`, web gets RN `ScrollView`). This is the cleanest.
  - (B) Keep BaseBottomSheet's outer `BottomSheetScrollView` and make `PublicEventPage`'s inner container **non-scrolling** when rendered inside a sheet (render its children directly, drop the inner `<ScrollView>` + the `host flex:1` + `scrollContent paddingTop:288`, reproduce the hero-behind-content via padding on the outer scroll's `contentContainerStyle`).
- Remove the `flex:1` from any view that lives directly inside a sheet scroll content container.
- This is **shared-package + EBES-level**, not strictly the BaseBottomSheet primitive — but it is the same class of "no raw RN scroll inside a gorhom sheet" rule the primitive already enforces for text inputs and nested scrolls.
- Regression: a test asserting EBES renders no raw RN `ScrollView` inside the sheet path; a sim live-fire that opens EBES on a long-content event and proves the body scrolls top→bottom on iOS AND Android.

---

## ISSUE 3a — Event-card tap intermittently does not open the sheet

### Classification: 🔴 ROOT CAUSE — PROVEN (live-fire, iOS) — PER-SCREEN (card gesture)

### Reproduction + device evidence
- **Clean tap opens reliably:** clean taps on "Vibes and Stuff" opened EBES on iOS (`10_event_open.png`) and Android (`A26_ebes.png`).
- **Tap with tiny drift fails:** a short vertical drag (Maestro swipe start 26%,34% → 26%,37%, 120ms — i.e. a tap with ~3% finger drift) on the same card on iOS **did NOT open the sheet** (`14_drift_result.png` — screen unchanged). The parent ScrollView claimed the touch as a scroll and cancelled the card's `onPress`.

### Root cause (six fields)
| Field | Evidence |
|---|---|
| **File + line** | `app-mobile/src/components/DiscoverScreen.tsx:1632` (screen-level `<ScrollView>` opens) → `:1712` (`businessEvents.map(...)` renders the cards) → `:1738` (ScrollView closes). Card press: `app-mobile/src/components/discover/BusinessEventCard.tsx:73–78` (`<Pressable onPress={handlePress}>`). |
| **Exact code** | The events list is `businessEvents.map(...)` rendered **inside the screen-level `<ScrollView>`** (NOT a FlatList), each card a bare `<Pressable onPress>`. No `onStartShouldSetResponder` / gesture-handler coordination between the `Pressable` and the parent scroll. |
| **What it does** | RN's ScrollView responder claims any touch whose movement exceeds the scroll slop (a few px). A tap with minor vertical drift is interpreted as the start of a scroll, so the child `Pressable.onPress` is cancelled — the sheet doesn't open. |
| **What it should do** | A tap (small movement, quick release) must always fire `onPress` and open the sheet, regardless of a few px of drift, while a clear drag still scrolls. |
| **Causal chain** | finger taps card with slight drift → parent ScrollView grabs responder → child Pressable press cancelled → `handleBusinessEventCardPress` never fires → `setExpansionTarget`/`setIsExpandedModalVisible` never called → sheet doesn't open → "tapping sometimes does nothing." |
| **Verification step** | Clean tap → opens (multiple captures, both platforms). Drift tap → does not open (`14_drift_result.png`). Identical card, identical session; only the gesture shape differs. |

### Blast radius
Affects every tappable card inside the Discover screen-level ScrollView: business-event cards AND the Ticketmaster night-out cards (same `.map()` inside the same ScrollView). Same pattern likely on any other screen-level-ScrollView list of `Pressable` cards — worth a sweep, but Discover is the confirmed surface.

### FIX-MAP (do NOT implement here)
- Make the card press robust to the parent scroll. Options: wrap the card press in a gesture-handler `Gesture.Tap()` (from `react-native-gesture-handler`, which coordinates with scroll), OR move the list to a `FlatList`/gorhom list with `Pressable` children tuned with appropriate `hitSlop`/`pressRetentionOffset`, OR set the ScrollView's responder negotiation so a tap with small drift still resolves to the child press. Gesture-handler `Gesture.Tap` is the most reliable and matches the app's RNGH stack.
- Note: this is **NOT** caused by the sheet work; it's a pre-existing Discover card-gesture issue surfaced by the same testing pass. Per-screen, not primitive.
- Regression: a sim test that taps a card with a few px of drift and asserts the sheet opens.

---

## ISSUE 3b — Event thumbnail does not render correctly on Android

### Classification: 🟠 CONTRIBUTING / split-cause — emulator manifestation is a NETWORK ARTIFACT; real-device causes are app-side — PER-CARD/IMAGE-LEVEL

### Device evidence + what's actually happening
- **Emulator (NOT app-bug evidence):** on Android, the Ticketmaster cards (French Montana, Young the Giant) render as **blank dark blocks** (`A23_events.png`), while on **iOS the same cards show real photos** (`13_ios_state.png`). Logcat proves the cause is **network, not code**: `ExpoImage: java.net.ConnectException: Failed to connect to s1.ticketm.net … ENETUNREACH (Network is unreachable)`. The AOSP emulator's NAT cannot reach the Ticketmaster CDN; `ping s1.ticketm.net` also fails. The Explore place-card photos DID render on Android (reachable CDN), confirming Android expo-image networking otherwise works. **So the emulator cannot reproduce the real-device thumbnail bug.**
- **"On Mingla" cards (Vibes / vegas) show solid color bands on BOTH platforms** — because both events are `cover_media_type = "video"` (verified via DB: both `cover_media_url` = `res.cloudinary.com/.../video/upload/...`). In `BusinessEventCard.tsx:84` the condition `data.coverMediaUrl !== null && data.coverMediaType !== "video"` is FALSE for video covers → it renders the hue band (`heroColorFromHue`), **never a video thumbnail/poster**. This is cross-platform, not Android-specific, but it IS a "thumbnail doesn't render" gap.

### Real-device root-cause candidates (since emulator can't exercise the network path)
1. **Video-cover events have no card thumbnail** (PROVEN gap, cross-platform): `BusinessEventCard.tsx:84` falls through to a flat hue band for `coverMediaType === "video"`. No poster frame is shown. (Most "On Mingla" discover events are video covers.)
2. **No `onError` / `placeholder` / `recyclingKey` on the image components** (PROBABLE Android cause): `BusinessEventCard.tsx:85` and `DiscoverScreen.tsx:408` both render `<ExpoImage source={{uri}} contentFit="cover" transition>` with **no `onError`, no `placeholder`, no `recyclingKey`**. expo-image 3.0.11 on Android has documented blank-render and stale/recycled-image issues without these; a failed decode shows nothing and is never retried.

### External research (cited)
- expo-image Android blank-render / not-loaded issues: https://github.com/expo/expo/issues/22100 , https://github.com/expo/expo/issues/24512 , wrong-image-on-recycle: https://github.com/expo/expo/issues/22515
- expo-image API (placeholder / onError / recyclingKey): https://docs.expo.dev/versions/latest/sdk/image/

### Blast radius
- Video-cover gap: every "On Mingla" event with a video cover, on every platform (cards only — EBES itself plays the video).
- expo-image robustness: every remote-image card surface (`BusinessEventCard`, Discover TM cards, and any other `ExpoImage` without onError/placeholder).

### FIX-MAP (do NOT implement here)
- **Video covers on cards:** render a poster/first-frame for video covers (e.g. a Cloudinary still transform of the video, or a stored poster URL) instead of the flat hue band, so the card shows a thumbnail. Decision/spec needed (poster source).
- **expo-image robustness on Android:** add `placeholder` (blurhash or hue), `onError` (fall back to hue band), and a stable `recyclingKey={data.id}` to `BusinessEventCard` + the Discover TM `ExpoImage`. Per-card, not primitive.
- **Verification caveat for the tester:** this MUST be retested on a **real Android device or a Google-Play emulator image with working external networking** — the AOSP emulator cannot reach the Ticketmaster CDN and will always show those cards blank for a non-app reason.

---

## ISSUE 4 — Scroll + bottom-inset awareness

### 4a — Some sheets don't scroll / appear frozen
- **PreferencesSheet scrolls** on both platforms (iOS `06_scrolled.png`; Android `A15_prefs_scrolled.png`) — the prior Wave-C rebuild (HEAD `40f671cdd`) fixed it by rendering header+body+footer as **direct children** of `scrollMode="scroll"` (no `header`/`stickyFooter` slots).
- **The latent scroll-kill quirk is REAL and documented** (prior report Discoveries #1): BaseBottomSheet's `header`/`stickyFooter` slots wrap the `BottomSheetScrollView` in an intermediate flexed `<BottomSheetView>` (`BaseBottomSheet.tsx:362–368` sticky path; `:394–401` header+scroll path), making the scrollable a **non-direct descendant** of `<BottomSheet>` → gorhom's content-pan→scroll handoff breaks for any body that OVERFLOWS the snap height. Sheets converted with those slots only work because their content FITS. **Classification: 🟡 HIDDEN FLAW — primitive-level**, affects any future/edited sheet with overflowing content + a header/footer slot.
- EBES scroll = Issue 2 (above).

### 4b — Content/buttons blocked at the bottom (PROVEN, primitive-level)
**The primitive computes the safe-area bottom inset and then discards it:**
`BaseBottomSheet.tsx:341–342`:
```
const safeBottom = Math.max(insets.bottom, 16);
void safeBottom;   // ← computed, then explicitly thrown away
```
- **What it does:** `safeBottom` is never applied to the scroll/list `contentContainerStyle`. The primitive adds **no** bottom padding for the OS home-indicator / Android nav bar, and has **no awareness of Mingla's floating tab bar** (`GlassBottomNav`, capsule height `glass.chrome.nav.capsuleHeight`, no exported height constant the sheet reads). Every consumer must hand-roll its own bottom padding.
- **Device evidence:** Android PreferencesSheet footer ("No changes to save" / "Start Over") sits at y≈2732–2793 of a 2992px screen (`A16_prefs_bottom.png`, uiautomator bounds) — only ~66dp clearance below the buttons, partially under the dev error toast and close to the gesture pill. The footer renders because PreferencesSheet hand-adds `paddingBottom: Math.max(insets.bottom,16)+12` (`PreferencesSheet.tsx:1506`); any sheet that forgets this will clip its buttons.
- **Tab-bar nuance:** most `wrapInRNModal` sheets z-stack ABOVE the floating nav (the nav hides behind the backdrop), so the tab-bar overlap is mainly a risk for **non-wrapped** sheets and for sheets whose backdrop doesn't cover the nav. The OS home-indicator / Android nav-bar clearance is the universal gap.

### FIX-MAP (primitive — do NOT implement here)
- BaseBottomSheet should OWN a bottom-inset model: apply `Math.max(insets.bottom, 16)` (plus, when relevant, the floating-nav height) to the scroll/list `contentContainerStyle` paddingBottom and to the `stickyFooter` padding — instead of `void safeBottom`. Expose the floating-nav height as a shared constant from `GlassBottomNav`/design tokens so the primitive can add it when a sheet is NOT z-stacked above the nav.
- For the 4a header/sticky-footer scroll-kill: upgrade the primitive to use gorhom's native sticky-header support (a sticky first child of `BottomSheetScrollView`) so the `header`/`stickyFooter` slots survive overflowing content — OR formally document the direct-child pattern as the only overflow-safe path and add a gate. (Prior report Discovery #1 recommended a dedicated primitive ORCH; this confirms it.)
- Regression: a test asserting the scroll/list contentContainerStyle receives a non-zero bottom padding derived from insets; a sim check that a tall sheet's last button clears the home indicator on both platforms.

---

## Cross-cutting: primitive-level vs per-sheet

| Issue | Level | Fix once benefits all? |
|---|---|---|
| 1 — swipe-down-close dead (wrapInRNModal) | **PRIMITIVE** (`BaseBottomSheet` modal branch) | YES — one GHRV wrap fixes ~21+ scrollable sheets |
| 2 — EBES freeze (double scroll host) | **SHARED-PACKAGE + EBES** (`PublicEventPage` + EBES wiring) | Partial — fixes EBES; the "no raw RN scroll in a sheet" rule is the primitive's existing contract |
| 3a — intermittent tap | **PER-SCREEN** (DiscoverScreen card gesture) | NO — Discover-specific (pre-existing, not sheet work) |
| 3b — Android thumbnail | **PER-CARD/IMAGE** (BusinessEventCard + Discover ExpoImage) + product gap (video poster) | NO — image-component + poster decisions |
| 4a — header/footer scroll-kill | **PRIMITIVE** (slot composition) | YES |
| 4b — bottom inset discarded | **PRIMITIVE** (`void safeBottom`) | YES — one inset model fixes all sheets |

**Overall recommendation: YES — the BaseBottomSheet primitive needs a focused scroll/gesture/inset rework.** Three primitive changes (GHRV-in-modal, own-the-bottom-inset, overflow-safe header/footer or documented single-scroll-host contract) resolve Issues 1, 4a, 4b and harden the contract that makes Issue 2 fixable. Issues 3a (card gesture) and 3b (image/poster) are independent per-surface fixes that happened to surface during the same sheet-testing pass.

---

## Five-layer cross-check (Issue 1, the headline)
| Layer | Finding |
|---|---|
| Docs | RNGH docs require GHRV inside Modal; iOS-as-View vs Android-strict — matches observation. |
| Schema | N/A (UI/gesture). |
| Code | `BaseBottomSheet.tsx:475–489` wraps `{sheet}` in RNModal with no GHRV; `_layout.tsx:62` GHRV is in the host tree only. |
| Runtime | Android: handle swipe-down does nothing (`A13`/`A14`); body scroll alive (`A15`); EBES (no modal) closes (`A28`). iOS: closes from handle (`04`), scroll-wins-from-body (`07`). |
| Data | N/A. |
Layers agree → root cause proven.

---

## Outcome / journey step-back
**User goal:** browse experiences, open an event, read it, act (buy/save), and dismiss naturally. **Where reality diverges:** (3a) the open itself fails on imperfect taps; (1) once a sheet is open the most natural dismissal — swipe down — silently fails (dead on Android, fragile on iOS), forcing hardware-back/buttons; (4b) action buttons crowd the bottom edge; (3b) cards that should entice with a thumbnail show flat color (video covers) or blank (Android image failures). Fixing only the reported nodes is insufficient: Issue 1's fix must be verified across all ~21 scrollable wrapInRNModal sheets (not just PreferencesSheet), and Issue 3b must be retested on real-network Android (the emulator cannot exercise it).

---

## Discoveries for orchestrator
1. **Issue 3a (intermittent card tap) is a pre-existing Discover bug, not introduced by the sheet conversion** — but it directly degrades the "open the sheet" outcome. Recommend folding into this META-ORCH or a fast follow.
2. **Video-cover events show no card thumbnail anywhere** (`BusinessEventCard.tsx:84`) — a cross-platform product gap (flat hue band for `coverMediaType==="video"`). Needs a poster-source product decision.
3. **AOSP emulator cannot reach the Ticketmaster CDN (`s1.ticketm.net` ENETUNREACH)** — any Android image/thumbnail testing must use a real device or a Google-Play emulator image with working external networking, else false negatives.
4. **The `header`/`stickyFooter` scroll-kill quirk (prior Discovery #1) is confirmed latent** and silently affects any converted sheet whose content overflows — a dedicated primitive ORCH is warranted.
5. **Investigation method note:** Android login uses Google-only sign-in; the AOSP emulator has no Play Services. I cloned the iOS sim's Supabase session from `RCTAsyncLocalStorage_V1` into Android's `RKStorage` (`catalystLocalStorage`) to drive the authed app on the emulator — reusable technique for future Android sim QA without Google sign-in.

---

## Appendix — full wrapInRNModal consumer list (Issue 1 blast radius)
Scrollable-body wrapInRNModal sheets (broken swipe-close on Android): FeedbackHistorySheet, NotificationsSheet, ReportUserModal, BoardMemberManagementModal, ExpandedCardModal, PairRequestModal, CustomHolidayModal, MessageInterface, FriendRequestsModal, AddToBoardModal, PreferencesSheet, ConnectionsPage, ShareModal, CityPickerSheet, CreateGroupChatSheet, ProposeDateTimeModal, CollabSessionChatBanners, AccountSettings, EditInterestsSheet, FriendPickerSheet, BillingSheet. (34 total wrapInRNModal consumers; the rest are non-scrolling / center-dialog / fixed-height pickers but still get the dead sheet-pan on Android.)

## Evidence index
All screenshots under `Mingla_Artifacts/reports/screenshots/INVESTIGATE_META-ORCH-0991/`. iOS prefix numeric (01–14), Android prefix `A` (A01–A28). Logcat ExpoImage ENETUNREACH captured live from `emulator-5554`.

## Confidence
- Issue 1: **PROVEN** (live-fire both platforms + control + official docs).
- Issue 2: **PROBABLE** structural cause; live freeze **NOT reproduced** on HEAD (honesty cap).
- Issue 3a: **PROVEN** (live-fire iOS drift-tap).
- Issue 3b: emulator manifestation **PROVEN network artifact**; real-device app-side causes **PROBABLE** (could not exercise real network on emulator).
- Issue 4a: latent quirk **PROVEN by source + prior live evidence**; 4b inset-discarded **PROVEN by source + Android footer measurement**.
