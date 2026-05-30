# IMPLEMENTATION — META-ORCH-0991 [Consumer-app modals → slide-down bottom sheets] — FINISHING PASS (bugs 3a, 3b, 4 tab-bar awareness)

**Skill:** mingla-implementor (Claude) — IMPLEMENT side
**Date:** 2026-05-29 → 2026-05-30
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-0991-[consumer-modals-to-sheets]/` on branch `META-ORCH-0991-consumer-modals-to-sheets`
**HEAD before this pass (fails-on-revert anchor):** `cd68b3805` (the primitive rework)
**Inputs:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-0991_SHEET_BUGS.md` (Issues 3a/3b) + `Mingla_Artifacts/reports/IMPLEMENTATION_META-ORCH-0991_SHEET_REWORK_REPORT.md` (the `tabBarAware` capability added to BaseBottomSheet).
**Status:** implemented + iOS-verified (all 3 tasks). Android: bundle compiles + serves; on-device AFTER verification blocked by host CPU saturation (load avg ~520 from concurrent multi-session emulators) — see §Verification. Bug 3b Ticketmaster-CDN render needs a real Android device per the investigation.

**Comms ledger:** read on entry. No BLOCK/WARN row addressed to META-ORCH-0991 or this skill. COMMS-0007 (RESOLVED — cover rendering lives in the SHARED `@mingla/event-rendering`, edit the package not the shims) factored into Task C.

---

## Layman summary

Three finishing fixes for the sheet rollout:
- **Bug 4 (menu awareness) — turned ON.** The two sheets that open over Mingla's floating bottom menu (Notifications + Friend Requests) now push their content up so nothing sits behind the menu. Sheets that cover the menu entirely (the ~34 modal-wrapped ones) are left alone so they aren't over-padded.
- **Bug 3a (tap doesn't open) — fixed.** Tapping an event card on Discover now reliably opens it, even with a little finger drift — the card used to lose the tap to the scrolling screen.
- **Bug 3b (blank/flat thumbnails) — fixed in code.** Video-cover events now show a real poster frame instead of a flat color band, and the photo cards fall back gracefully instead of going blank if an image fails. Final confirmation of the Ticketmaster photos on Android needs a real device (the emulator can't reach that image server).

---

## Task A — BUG 4: Mingla floating-menu awareness (tabBarAware enabled)

### Audit — which converted sheets render IN-TREE (nav stays visible)?
I enumerated all 42 BaseBottomSheet consumers and classified each by `wrapInRNModal` + variant + mount surface:
- **34 sheets pass `wrapInRNModal`** → they z-stack in a separate RN `<Modal>` window ABOVE the floating `GlassBottomNav` (the nav hides behind the modal backdrop). These must NOT add tab-bar padding (would double-pad). Left untouched.
- **EBES (`ExpandedBusinessEventSheet`) + `TicketCartSheet`** are non-`wrapInRNModal` sheets BUT they mount INSIDE a `wrapInRNModal` parent (`ExpandedCardModal` / `MessageInterface`), so the nav is hidden behind that parent window. NOT tab-bar candidates. Left untouched (and `MetaOrch0991FinishingPass.test.mjs` asserts TicketCartSheet is NOT tabBarAware — proving the opt-in is surgical, not blanket).
- **NotificationsSheet (`wrapInRNModal={false}`) + FriendRequestsModal (no wrap)** are the ONLY two sheets opened from HomePage as in-tree absolute floats. `GlassBottomNav` is rendered at the app root (`app/index.tsx`, `position:absolute; bottom:0; zIndex:50`) AFTER the page tree, so it z-stacks ON TOP of these two sheets and overlaps their bottom content. **These are the exact tab-bar-awareness candidates** → enabled `tabBarAware`.

I rejected the "default tabBarAware whenever NOT wrapInRNModal" option because EBES/TicketCart/AccountSettings-pickers are non-wrapped-but-nested-in-a-wrapped-parent, where the nav is hidden — auto-padding them would open a wrong gap. Explicit per-sheet opt-in is correct and safe.

### Primitive gap fixed
The prior rework's `tabBarAware` only added the nav height to the SCROLL/list content. But `FriendRequestsModal` uses a **sticky footer**, and the footer (the true bottommost element) got no tab-bar clearance, while the scroll body above it would have been over-padded. Reworked the primitive so:
- `tabBarExtra = tabBarAware ? BOTTOM_NAV_CONTENT_HEIGHT : 0` (additive, opt-in).
- Non-sticky scroll/list bodies (the bottommost element) get `bottomInset = safeBottom + tabBarExtra` via `withBottomInset`.
- Sticky-footer case: the scroll body above the footer uses a new `withFooterClearance` helper (OS-inset only — NO tab-bar height, so no empty gap above the pinned footer), and the **footer is wrapped with `paddingBottom: bottomInset` ONLY when `tabBarAware`** (so non-tabBarAware sticky footers like TicketCartSheet, which already hand-roll `insets.bottom+16`, are never double-padded).

### iOS evidence
- NotificationsSheet opened from HomePage; the floating GlassBottomNav stays visible and the sheet content sits above it (`ios_A_notifications_above_visible_nav.png`). The notifications list `contentContainerStyle` paddingBottom is now `max(insets.bottom,16)+56` (nav-cleared) via the primitive's `withBottomInset` `Math.max` against the sheet's existing `insets.bottom+16`.

### Limit (honest)
The populated-last-row pixel clearance + FriendRequestsModal's sticky footer were verified by **mechanism + regression test**, not a populated screenshot: the test account has zero notifications/requests (empty state), and `setShowFriendRequestsModal(true)` is not wired to any current UI control (the modal is latent — flagged below). The padding value is asserted by `MetaOrch0991FinishingPass.test.mjs` and the primitive code.

---

## Task B — BUG 3a: reliable Discover card tap

Root cause (investigation): cards are `.map()`'d inside the Discover screen-level RN `<ScrollView>`; a plain `<Pressable onPress>` is cancelled the instant the scroll claims the touch (tiny drift → tap lost).

Fix: both card types open via an RNGH `Gesture.Tap().maxDistance(16).maxDuration(500).runOnJS(true)` inside a `<GestureDetector>` instead of a bare `Pressable`:
- **BusinessEventCard** ("On Mingla" cards): full GestureDetector over the card body. ALSO discovered + fixed a follow-on: the shared `EventCoverMedia` (now the cover, Task C) mounts a native `VideoView`/`Image` that captured the touch and blocked the card tap on video-cover cards — wrapped the cover in a `pointerEvents="none"` View so the tap always reaches the GestureDetector. (Image-cover/TM cards had no VideoView, which is why only the "On Mingla" video cards failed to open in the first sim run — caught + fixed live.)
- **EventGridCard** (Discover Ticketmaster cards): `cardTapGesture` (open) composed with `saveTapGesture` (heart) via `.requireExternalGestureToFail(saveTapGesture)` so the save-heart wins in its region and never also opens the card. Press-scale haptics moved onto the tap gesture's `onBegin`/`onFinalize`; `handlePressIn/Out/SavePress` wrapped in `useCallback` so the gestures memoize stably.

### iOS evidence
- BusinessEventCard "Vibes and Stuff" tap → opens EBES (`ios_B_business_card_tap_opens.png`).
- Ticketmaster "R&B Soul Session" tap → opens the expanded sheet (`ios_B_ticketmaster_card_tap_opens.png`).
- 4 consecutive tap-open → swipe-close cycles all succeeded, ending back on the grid (`ios_B_repeated_taps_reliable.png`) — repeated taps reliably open.

### Drift-tap note (Maestro limitation)
Maestro's `swipe` primitive is a continuous synthetic DRAG, not a finger-tap-with-incidental-jitter; even an 8px Maestro swipe registers as a deliberate scroll (correct behavior — that IS a drag). The drift bug is a hardware-touch-timing phenomenon Maestro can't faithfully reproduce in the borderline zone (per `feedback_sim_test_drivers_maestro_default.md`). Clean `tapOn` opens reliably (proven, repeatedly); the RNGH `maxDistance(16)` slop is the mechanism that tolerates a real finger's incidental drift. `maxDistance(16)` is a standard slop value — large enough for tap jitter, small enough that a real scroll (which moves far more) still scrolls.

---

## Task C — BUG 3b: event thumbnails (video poster + image robustness)

COMMS-0007 mandates editing the SHARED `@mingla/event-rendering` cover renderer, never the shims. The shared `EventCoverMedia` ALREADY handles video (real frame), image (`onError` → `EventCover` hue-band fallback), and a per-`mediaUrl` error reset. The bug was that **`BusinessEventCard` hand-rolled its own `ExpoImage` + a `coverMediaType !== "video"` fall-through to a flat hue band** — it never used the shared renderer.

Fix:
- **BusinessEventCard** now renders its cover via the SHARED `EventCoverMedia` (`autoplay={false}`, `playbackActive={false}`, `muted`, `loop={false}`): video covers show a real first-frame POSTER (no flat band); images get the shared `onError`/fallback/per-url-reset robustness; null/errored covers fall back to the shared hue band. Removed the local `heroColorFromHue` helper + the bare `ExpoImage`. `autoplay={false}` keeps the non-virtualized grid from spinning up concurrent video playback (paused first-frame posters only).
- **Discover Ticketmaster card** (`EventGridCard`, consumer-app — not a shared cover surface): added `recyclingKey={card.id}` + `placeholder={{blurhash}}` + `onError` → a dark `cardImageFallback` band (never a blank cell). `cachePolicy="memory-disk"` was already present.

No shared-package version changes; `expo-video`/`expo-image` versions untouched (alignment preserved).

### iOS evidence (BEFORE/AFTER)
- AFTER (my :8222 bundle, iOS): the two "On Mingla" video-cover cards ("Vibes and Stuff", "A life in vegas") now render REAL POSTER FRAMES; Ticketmaster cards render their real photos (`ios_C_video_posters_render.png`).
- BEFORE (Android, other session's old bundle on emulator-5554): the same two video covers render as FLAT TEAL/BROWN BANDS — the exact Bug 3b symptom (`android_BEFORE_oldbundle_flat_bands_5554.png`). This is the clean before-state control.

### Android real-device caveat (carried forward from the investigation)
The AOSP/standard emulator cannot reach the Ticketmaster CDN (`s1.ticketm.net` ENETUNREACH), so the Ticketmaster-photo render on Android can only be FINAL-confirmed on a REAL Android device or a Google-Play emulator with working external networking. The video-poster fix (Cloudinary covers) and the image-robustness fallback ARE testable on any Android, but on-device Android verification this session was blocked by host CPU saturation (below). **Flag for operator: device-test Bug 3b on a real Android phone.**

---

## Old → New Receipts

### app-mobile/src/components/ui/BaseBottomSheet.tsx
**Before:** `tabBarAware` added the nav height to ALL bodies via a single `bottomInset`; the sticky-footer scroll body used `withBottomInset` and the sticky footer got no tab-bar clearance.
**After:** `tabBarExtra = tabBarAware ? BOTTOM_NAV_CONTENT_HEIGHT : 0`; non-sticky bodies use `withBottomInset` (= safeBottom + tabBarExtra). Sticky case: scroll body uses new `withFooterClearance` (safeBottom only); the footer is wrapped with `paddingBottom: bottomInset` ONLY when `tabBarAware` (no double-pad for TicketCartSheet).
**Why:** Task A — make the sticky footer (FriendRequestsModal) clear the floating menu without over-padding the scroll body or the non-tabBarAware sticky sheets.
**Lines changed:** ~30.

### app-mobile/src/components/NotificationsSheet.tsx
**Before:** `wrapInRNModal={false}` with no tab-bar awareness; list clipped under the floating nav.
**After:** added `tabBarAware`. The sectionlist `contentContainerStyle` paddingBottom now `Math.max(insets.bottom+16, safeBottom+56)` via the primitive.
**Why:** Task A — in-tree HomePage sheet under the visible nav.
**Lines changed:** ~8 (one prop + comment).

### app-mobile/src/components/FriendRequestsModal.tsx
**Before:** non-wrap sticky-footer sheet; footer (`paddingVertical:12`) sat behind the floating nav.
**After:** added `tabBarAware`; primitive wraps the sticky footer with the nav clearance.
**Why:** Task A.
**Lines changed:** ~8.

### app-mobile/src/components/discover/BusinessEventCard.tsx
**Before:** bare `<Pressable onPress>` card host (scroll-stolen on drift) + hand-rolled `<ExpoImage>` with a `coverMediaType !== "video"` fall-through to a flat hue band (`heroColorFromHue`).
**After:** `<GestureDetector gesture={Gesture.Tap().maxDistance(16)…}>` over the card; cover rendered via the SHARED `<EventCoverMedia>` (video poster + image fallback) inside a `pointerEvents="none"` wrapper so the cover never eats the tap. Removed `heroColorFromHue`, `heroImage`/`heroBand` styles, and the `expo-image` import; added `heroFill` (absoluteFill).
**Why:** Tasks B + C.
**Lines changed:** ~55.

### app-mobile/src/components/DiscoverScreen.tsx
**Before:** `EventGridCard` opened via `<Pressable onPress>` (scroll-stolen); save-heart was a nested `Pressable`; the TM `<ExpoImage>` had no onError/placeholder/recyclingKey.
**After:** card-open via `cardTapGesture` (`Gesture.Tap().maxDistance(16)`) composed `.requireExternalGestureToFail(saveTapGesture)`; save-heart via `saveTapGesture`; press handlers `useCallback`-wrapped. TM image gained `recyclingKey`/`placeholder(blurhash)`/`onError → cardImageFallback`. Added `TM_CARD_BLURHASH` + `cardImageFallback` style + `hasImageError` state (reset on `card.image` change).
**Why:** Tasks B + C.
**Lines changed:** ~70.

### app-mobile/src/components/ui/__tests__/MetaOrch0991FinishingPass.test.mjs (NEW)
Regression suite for A/B/C with fails-on-revert anchor `cd68b3805`.

### app-mobile/src/components/ui/__tests__/BaseBottomSheetRework.test.mjs (MODIFIED — `[TEST-MOD-APPROVED META-ORCH-0991]`)
The R-4b call-site count now counts `withBottomInset(` + `withFooterClearance(` (still ≥4) because the sticky scroll body legitimately moved to `withFooterClearance`. Contract (inset applied, not discarded) unchanged.

---

## Verification

### Static (CAPTURED)
- `tsc --noEmit` (app-mobile): **246 errors == baseline `cd68b3805` (246)** → ZERO net new. My 5 touched consumer/primitive files show ZERO tsc errors. The `@mingla/event-rendering` `Cannot find module 'react'` cluster (25 errors) is a pre-existing app-mobile-tsconfig package-resolution artifact identical at baseline (PublicEventPage already imports the package).
- `eslint` on touched files: ZERO net new errors/warnings. BaseBottomSheet's 6 `rules-of-hooks` are the documented baseline (unchanged — I added only plain consts). The `@mingla/event-rendering` `import/no-unresolved` is a pre-existing resolver gap (EBES has the identical line). DiscoverScreen `import/first` count 4==4 baseline.
- Sole-gorhom strict-grep gate: **PASS** (0 offenders, 409 files).
- Both iOS + Android bundles served by Metro :8222: **HTTP 200, 4.75MB each** → my changes (RNGH gestures, shared EventCoverMedia, primitive) compile for BOTH platforms.

### Regression tests (MANDATORY gate — satisfied)
- New: `app-mobile/src/components/ui/__tests__/MetaOrch0991FinishingPass.test.mjs` — **PASSES on the fix**; **fails-on-revert VERIFIED at `cd68b3805`** (reverted the 5 source files, kept the test → first assertion "A NotificationsSheet sets tabBarAware" FAILS; restored → PASS).
- Modified: `BaseBottomSheetRework.test.mjs` still PASSES (`[TEST-MOD-APPROVED META-ORCH-0991]`).
- All 11 META-ORCH-0991 suites + the locked `NotificationsSheet.test.tsx`: **PASS**.

### Live-device — iOS (`17091E60-C3B6-4167-980D-60C348E177F6`, iPhone 17 Pro, iOS 26.4) — CAPTURED
Own scoped Metro on **:8222** (NOT :8100 — owned by another session; never killed/global-killed). Maestro driver (no osascript). Screenshots in `Mingla_Artifacts/reports/screenshots/IMPLEMENT_META-ORCH-0991_FINISHING/`.
- Task A: `ios_A_notifications_above_visible_nav.png` (NotificationsSheet open, floating nav visible, content clears it).
- Task B: `ios_B_business_card_tap_opens.png`, `ios_B_ticketmaster_card_tap_opens.png`, `ios_B_repeated_taps_reliable.png` (4 reliable cycles).
- Task C: `ios_C_video_posters_render.png` (video covers now real posters; TM photos render).

### Live-device — Android — PARTIAL / environment-blocked (honest)
- `Pixel_8_Pro` emulator-5554 belongs to ANOTHER session (reverse tunnel → :8100); did NOT touch it. Captured a read-only BEFORE screenshot from it: old bundle shows flat color bands on video covers (`android_BEFORE_oldbundle_flat_bands_5554.png`).
- Booted MY OWN `Pixel_7_API35` emulator-5556 (reverse → :8222), pulled + installed the dev-client APK, connected to my Metro ("Connected to: http://localhost:8222" confirmed on-device). But the host was/became CPU-saturated (`uptime` load avg ~378→565 from the combined multi-session emulators + iOS sims + Metro), causing persistent System-UI/process ANRs on the cold AVD; the app could not settle for a clean AFTER capture. I cannot relieve the load without killing other sessions' processes (forbidden by the no-cross-session-interference rule). I hard-killed only MY own qemu-5556 (scoped by its `-port 5556` cmdline) to relieve what I owned.
- **Conclusion:** Android AFTER on-device capture is environment-blocked, not code-blocked. The bundle compiles + serves for Android; the fixes are platform-shared code (RNGH is documented to be MORE reliable on Android than Pressable-in-ScrollView; `EventCoverMedia` is the same shared component mingla-business already runs on Android cards). Bug 3b Ticketmaster-photo render on Android still needs a REAL device per the investigation.

---

## Invariant preservation
- I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER: PRESERVED (gate green; BusinessEventCard/DiscoverScreen import RNGH + `@mingla/event-rendering`, not gorhom).
- Stock-gorhom motion / center-dialog non-swipe: PRESERVED (untouched).
- 34 wrapInRNModal conversions + the primitive rework: UNREGRESSED (11 suites green; tab-bar padding is opt-in + additive `Math.max`; sticky-footer wrap is tabBarAware-only).

## Parity check
- Tasks A/B/C are app-mobile consumer-only. Task C edits the SHARED `EventCoverMedia` ONLY by CONSUMING it from a new surface (BusinessEventCard) — no change to the shared component itself, so mingla-business (web + native) is unaffected. The `pointerEvents="none"` wrapper is local to BusinessEventCard.

## Cross-surface impact (Step 3.5)
- Consumer iOS: ALL three tasks (verified). Consumer Android: ALL three (code; on-device blocked). Buyer-web / Business iOS/Android / Admin: UNAFFECTED — none renders Discover cards or the consumer HomePage sheets; the shared `EventCoverMedia` component file is unchanged.

## Cache safety
- N/A — UI/gesture/layout/image-rendering only. No query keys, data shapes, or persisted storage touched.

## Regression surface (for the tester)
1. NotificationsSheet + FriendRequestsModal — bottom content clears the floating nav (populate notifications/requests to see the last row + footer).
2. TicketCartSheet — sticky footer still pinned, NOT over-padded (adversarial: must stay non-tabBarAware).
3. Discover BusinessEventCard + Ticketmaster cards — tap reliably opens; save-heart still toggles without opening the card.
4. Discover video-cover cards — show a poster frame, not a flat band.
5. Discover image cards on a flaky network — fall back to a dark band, never blank (Android real-device).

## Discoveries for orchestrator
- **FriendRequestsModal is latent**: `setShowFriendRequestsModal(true)` is not wired to any current UI control in HomePage (the modal renders but nothing opens it). `tabBarAware` is correctly set for when it IS reachable; flagging the dead trigger as a separate finding.
- **Android on-device QA is gated by host capacity**: running 2 iOS sims + 2 Android emulators + Metro pushed the Mac to load avg ~520. Future cross-platform live matrices need fewer concurrent devices per session OR a less contended host.
- **Bug 3b real-device confirmation** (Ticketmaster CDN render on Android) remains open per the investigation — needs a real Android phone / Google-Play emulator with external networking.

## Transition items
- None.
