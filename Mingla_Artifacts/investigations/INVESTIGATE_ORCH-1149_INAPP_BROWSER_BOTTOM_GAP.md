# INVESTIGATE — ORCH-1149 — in-app browser sheet leaves a bottom gap exposing the consumer tab nav

**Phase:** INVESTIGATE (forensics sub-agent, Conductor dispatch)
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1149-[inapp-browser-bottom-anchor]/` on branch `ORCH-1149-inapp-browser-bottom-anchor` (rebased clean onto `origin/main`)
**Date:** 2026-06-15
**Confidence:** `proven` (static-layout root cause; orchestrator-reproduced on device; mechanism is a deterministic CSS fact, not a runtime/timing bug)
**Comms ledger:** read on entry. No OPEN BLOCK entry targets forensics / ORCH-1149 / ALL. Open ALL-targeted entries are WARN-level (COMMS-0027 EAS OTA gotchas, COMMS-0035 expo-image-manipulator native drift) and do not bear on a pure-layout change. Nothing to ack as BLOCK.

---

## 1. Symptom summary (expected vs actual)

**Reproducer (Seth-confirmed, orchestrator-reproduced):** Open a curated place card → tap the **"Policies & Reservations"** button on a stop (e.g. "Dram And Draught") → the in-app browser opens with title "Dram And Draught".

- **Expected:** the in-app browser opens like every other Mingla sheet — bottom-anchored, flush to the bottom of the screen, covering the consumer in-tree tab bar (Explore / Discover / Friends / Likes / Profile). No nav bleed-through.
- **Actual:** the browser renders as a **centered floating card** (`justifyContent:'center'`, fixed `height: SCREEN_HEIGHT * 0.85`, `width:'95%'`, all-four-corners `borderRadius: 20`, `animationType="fade"`). Because it floats mid-screen it leaves a **GAP at the bottom** through which the consumer tab bar is visible. It also opens with a fade, not a slide-up, so it does not feel like a Mingla sheet.

This is a layout/animation defect only. WebView behavior, the dark title header, and the back/forward + lock/URL nav bar all function correctly.

---

## 2. Investigation manifest (every file read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `app-mobile/src/components/InAppBrowserModal.tsx` | The shared component under investigation — full verbatim read (262 lines). |
| 2 | `app-mobile/src/components/ExpandedCardModal.tsx` (L1118-1140, L2265-2295, import L50) | Reproducer call site: curated "Policies & Reservations" button → `onOpenBrowser`; the two parent-owned `<InAppBrowserModal>` mounts (ticket L2273, policies L2282). |
| 3 | `app-mobile/src/utils/normalizeWebsiteUrl.ts` (full) | Confirm I-WEBVIEW-URL-NORMALIZED lives in the call sites, not in the modal. |
| 4 | `app-mobile/src/components/expandedCard/ActionButtons.tsx` (L35, L634) | Second normalizeWebsiteUrl consumer (single-place flow). |
| 5 | `app-mobile/scripts/ci/orch-1022-expanded-card-modal-gating-check.mjs` (G-01…G-06, L40-78) | Confirm exactly what the gate asserts about `<InAppBrowserModal`. |
| 6 | `app-mobile/src/components/ui/BaseBottomSheet.tsx` (header L1-80) | API + architecture invariants; decide in-place-raw-Modal vs route-through-BaseBottomSheet. |
| 7 | `app-mobile/src/components/{ProfilePage,CustomPaywallScreen,OnboardingFlow}.tsx` (mount lines + imports) | Enumerate the other 3 consumers; confirm shared-component parity is automatic. |
| 8 | `mingla-business/src/**` (grep) | Confirm the business app does NOT use `InAppBrowserModal` (different browser path) → out of scope. |
| 9 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` (gorhom-sole / NotificationsSheet sections) | Establish the RN-Modal-vs-gorhom precedent for sheets. |

---

## 3. Q-scorecard

**Q1 — Is the centered-floating-card layout the root cause of the bottom gap?**
Verdict: **YES — CONFIRMED ROOT CAUSE** (`proven`). See F-1.

**Q2 — Does the fade animation (vs slide-up) make it not feel like a Mingla sheet?**
Verdict: **YES — confirmed contributory layout fact** (`proven`). `animationType="fade"` at L73. See F-2.

**Q3 — How many mount sites consume this shared component, and is parity automatic?**
Verdict: **5 mount sites across 4 files; parity is AUTOMATIC** (single shared default export). See F-3.

**Q4 — Does the orch-1022 gate require `<InAppBrowserModal` to be present, or absent?**
Verdict: **NUANCED.** G-04 (line 74) requires `<InAppBrowserModal` to be **ABSENT from the curated sub-component body** (`curatedBody`) — it must delegate to the parent. The component is mounted in the parent `ExpandedCardModal` overlay block. The component NAME, file, default-export signature, and the parent mounts must all be preserved. A layout-only edit inside `InAppBrowserModal.tsx` does not touch any string the gate scans. See F-4. (The dispatch's "asserts present" framing was inverted; the binding fact is "preserve the component + its parent mounts; do not reintroduce it into curatedBody.")

**Q5 — Is I-WEBVIEW-URL-NORMALIZED affected by a layout change?**
Verdict: **NO.** Normalization happens in the call sites (`normalizeWebsiteUrl` at ExpandedCardModal L1128 / ActionButtons L634) before `url` is passed in; the modal renders `url` verbatim. A style/animation change cannot regress it. See F-5.

**Q6 — In-place raw-Modal refactor vs route through BaseBottomSheet?**
Verdict: **IN-PLACE RAW-MODAL REFACTOR** (`animationType="slide"`, bottom-anchored full-bleed). See F-6 for the full justification.

**Q7 — Will un-centering create a new safe-area regression at the bottom edge?**
Verdict: **YES if unhandled** — the WebView/footer would sit under the iOS home indicator / Android nav bar. Must add `useSafeAreaInsets().bottom`. See F-7.

**Q8 — Is the business app in scope?**
Verdict: **NO.** Zero `InAppBrowserModal` references in `mingla-business/src`; the business app uses a different browser path (expo WebBrowser / Stripe Connect embedded). Out of scope. See F-8.

---

## 4. Findings (six-field evidence)

### F-1 — Centered floating card with fixed 0.85 height is the bottom-gap root cause — CONFIRMED ROOT CAUSE
- **Symptom:** Browser floats mid-screen; consumer tab bar visible in the gap below it.
- **Layer:** Code (component styles).
- **Probe:** `Read InAppBrowserModal.tsx` lines 70-180 verbatim.
- **Evidence:**
  - L71-77: `<Modal visible animationType="fade" transparent onRequestClose onShow>`.
  - L154-159 `overlay`: `{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }`.
  - L167-180 `modalContainer`: `{ width: '95%', maxWidth: 600, height: SCREEN_HEIGHT * 0.85, maxHeight: SCREEN_HEIGHT * 0.85, borderRadius: 20, overflow: 'hidden', shadow…, elevation: 10 }`.
  - L181-190 `header`: `borderTopLeftRadius: 20`, `borderTopRightRadius: 20` (rounded top because the card floats).
- **Mechanism:** `overlay` centers the `modalContainer` vertically; the container is fixed at 85% of screen height and 95% width with rounded bottom corners → ~7.5% of screen height remains uncovered at the bottom (plus the side insets), exposing the in-tree tab bar that every bottom-anchored Mingla sheet otherwise covers.
- **Severity:** **CONFIRMED ROOT CAUSE.**

### F-2 — `animationType="fade"` makes the open feel un-Mingla — confirmed contributory layout fact
- **Symptom:** Browser fades in centered rather than sliding up from the bottom.
- **Layer:** Code.
- **Probe:** `Read InAppBrowserModal.tsx` L73.
- **Evidence:** `animationType="fade"` on the RN `<Modal>`. Every other Mingla sheet slides up (BaseBottomSheet gorhom spring; legacy RN sheets used `animationType="slide"` per the NotificationsSheet invariant note).
- **Mechanism:** fade + center = a dialog presentation, not a sheet presentation. Seth's locked decision item 2 requires switching to slide-up.
- **Severity:** **SECONDARY ROOT CAUSE** (part of the same one-component fix; not independently shippable from F-1).

### F-3 — 5 mount sites across 4 files; parity automatic — informational
- **Symptom:** N/A (scope mapping).
- **Layer:** Code.
- **Probe:** `grep -rn "<InAppBrowserModal" src` and `grep -rn "import.*InAppBrowserModal" src`.
- **Evidence (5 JSX mounts):**
  - `ExpandedCardModal.tsx:2273` — ticket browser (`Tickets – <eventName>`), parent-owned.
  - `ExpandedCardModal.tsx:2282` — policies/reservations browser, parent-owned (reproducer).
  - `ProfilePage.tsx:602`.
  - `CustomPaywallScreen.tsx:442`.
  - `OnboardingFlow.tsx:3298`.
  - Imports: ExpandedCardModal L50, CustomPaywallScreen L13, ProfilePage L48, OnboardingFlow L62 (ExpandedCardModal hosts both mounts). All are `import InAppBrowserModal from './InAppBrowserModal'` (single default export).
- **Mechanism:** all 5 render the SAME default export. A style/animation change inside the component propagates to all 5 automatically — parity is automatic, no per-site edits required.
- **Severity:** RULED OUT (not a defect; scope fact).

### F-4 — orch-1022 gate G-04 requires `<InAppBrowserModal` ABSENT from curatedBody; component + parent mounts must be preserved — guard
- **Symptom:** N/A (CI guard).
- **Layer:** Code (CI gate).
- **Probe:** `grep -n "InAppBrowserModal" scripts/ci/orch-1022-expanded-card-modal-gating-check.mjs` + read L40-78.
- **Evidence:** Single hit at L74: `!curatedBody.includes("<InAppBrowserModal")` inside the **G-04** check ("curated policies no longer mount a nested browser modal"). The gate also requires (G-04) `onOpenBrowser: (url: string, title: string) => void` and `onOpenBrowser(normalized, stop.placeName)` in curatedBody, and (G-01/G-03) that `browserUrl`/`ticketBrowserUrl` drive the parent overlay. The component is mounted only in the parent overlay block.
- **Mechanism:** The gate enforces the ORCH-1022 architecture (browser is parent-owned, not nested under the sheet). Editing only the *styles/animation inside* `InAppBrowserModal.tsx` changes none of the strings the gate scans (the gate reads `ExpandedCardModal.tsx`, not `InAppBrowserModal.tsx`). The fix must NOT: rename/delete the component, change the default export, change the `{ visible, url, title, onClose }` prop contract, or move any mount into curatedBody.
- **Severity:** SUSPECTED CONTRIBUTOR (constraint, not defect) — must be enumerated as a hard guard in the SPEC.

### F-5 — I-WEBVIEW-URL-NORMALIZED is call-site-owned; unaffected by layout change — RULED OUT as risk
- **Symptom:** N/A.
- **Layer:** Code.
- **Probe:** `Read normalizeWebsiteUrl.ts` + ExpandedCardModal L1124-1135 + ActionButtons L634.
- **Evidence:** `normalizeWebsiteUrl` is called at the button handlers (`const normalized = normalizeWebsiteUrl(stop.website); … onOpenBrowser(normalized, …)`) BEFORE the URL reaches the modal. `InAppBrowserModal` renders `source={{ uri: url }}` at L132 verbatim — it neither normalizes nor mutates the URL.
- **Mechanism:** A change to `overlay`/`modalContainer`/`animationType` cannot affect URL normalization. Invariant preserved by construction. The SPEC must list `source={{ uri: url }}` and all WebView props as DO-NOT-TOUCH.
- **Severity:** RULED OUT (as a risk introduced by this fix).

### F-6 — In-place raw-Modal refactor is correct; routing through BaseBottomSheet is wrong — DECISION
- **Symptom:** N/A (architecture decision).
- **Layer:** Code / architecture.
- **Probe:** `Read BaseBottomSheet.tsx` L1-80 + INVARIANT_REGISTRY.md (gorhom-sole + NotificationsSheet rule L259-263).
- **Evidence:**
  - BaseBottomSheet header L21-24: it is the **SOLE permitted importer of `@gorhom/bottom-sheet`** under `app-mobile/src/` (gate `meta-orch-0991-base-bottom-sheet-sole-consumer.mjs`). InAppBrowserModal must NOT import gorhom.
  - BaseBottomSheet is built on the gorhom inline `<BottomSheet>` with snap points, `BOTTOM_NAV_CONTENT_HEIGHT` clearance, pan-down-to-dismiss `PanGestureHandler`, and `GestureHandlerRootView` inside an RN `<Modal>` — designed for *scrollable sheet content that clears the visible nav*, not a full-bleed, edge-to-edge, nav-COVERING WebView host. Adopting it would (a) violate the sole-consumer gate unless routed through the primitive, (b) fight gorhom's snap-point/pan-down model against a WebView that itself handles scroll, and (c) require the primitive to support a no-handle, full-screen, nav-covering mode it does not expose.
  - ORCH-0908 precedent (BaseBottomSheet header L13-15): z-stacking over the in-tree tab bar is achieved by wrapping in an RN `<Modal transparent … statusBarTranslucent>`. The RN `<Modal>` mounts in its own native OS overlay window that renders over the in-tree tab bar regardless of tree position. InAppBrowserModal ALREADY uses a raw RN `<Modal transparent>` (L71-77) — it already layers over the tab bar; the ONLY problem is the centered, fixed-height, fade layout. The minimal correct fix is to keep the raw `<Modal>`, switch `animationType` to `"slide"`, and bottom-anchor a full-bleed container.
  - NotificationsSheet invariant precedent (registry L261): RN `<Modal animationType="slide" transparent>` was the *legacy sheet pattern*; gorhom replaced it ONLY where a pan-down-to-close gesture over scrollable sheet content was required. A WebView host has no pan-down requirement (the WebView owns its scroll), so the raw-Modal slide pattern is appropriate here and does not regress any gesture.
- **Mechanism:** In-place raw-Modal refactor is the smallest, gate-compliant, invariant-preserving change that satisfies all three locked decisions. Routing through BaseBottomSheet would widen scope, fight the gorhom model, and risk the sole-consumer gate.
- **Severity:** RULED OUT (BaseBottomSheet route) / CONFIRMED (in-place raw-Modal route).

### F-7 — Un-centering introduces a bottom safe-area regression if unhandled — SUSPECTED CONTRIBUTOR (pre-emptive)
- **Symptom:** After bottom-anchoring, content would sit under the iOS home indicator / Android nav bar.
- **Layer:** Code.
- **Probe:** `grep -rn "useSafeAreaInsets" src/components/InAppBrowserModal.tsx` (none) + `useSafeAreaInsets` usage count across `src` (46 files).
- **Evidence:** InAppBrowserModal currently does NOT use `useSafeAreaInsets` (it doesn't need to while centered with a 7.5% bottom margin). `react-native-safe-area-context` is used in 46 src files (widely available; `SafeAreaProvider` is mounted at the app root). Once the container is flush to the bottom, the rounded card no longer provides the implicit inset.
- **Mechanism:** A bottom-anchored full-bleed sheet must pad its bottom edge by `useSafeAreaInsets().bottom` (applied to the WebView container / sheet footer) or content will be occluded by the home indicator. This is the single most likely regression of the un-centering operation — the SPEC must mandate it as a numbered success criterion on both platforms.
- **Severity:** SUSPECTED CONTRIBUTOR (regression risk this fix must pre-empt).

### F-8 — Business app uses a different browser path — out of scope — RULED OUT
- **Symptom:** N/A (scope boundary).
- **Layer:** Code.
- **Probe:** `grep -rln "InAppBrowserModal" mingla-business/src` (0 hits) + `grep -rln "react-native-webview|openBrowserAsync" mingla-business/src`.
- **Evidence:** Zero `InAppBrowserModal` references in `mingla-business/src`. The business app's WebView/browser usage is in `nativeCheckoutFlow.native.ts`, Stripe Connect / payments views (`BrandPaymentsView`, `BrandOnboardView`, `usePartnerStripe`, `useBrandStripeTaxAccountSession`) — a different surface and component. The consumer `app-mobile` `InAppBrowserModal` is consumer-only.
- **Mechanism:** Business surfaces (#4 Business iOS, #5 Business Android) do not render this component → no parity work there.
- **Severity:** RULED OUT (out of scope).

---

## 5. Five-Truth-Layer reconciliation

| Layer | Finding | Contradiction? |
|-------|---------|----------------|
| **Docs** | No spec mandates the in-app browser be centered; every other Mingla sheet is bottom-anchored (BaseBottomSheet doctrine, NotificationsSheet invariant). | **YES** — Code (centered card) contradicts the product convention (bottom-anchored sheets). The Code layer holds the defect; the doctrine holds the truth. |
| **Schema** | N/A — pure client layout; no DB/RLS/migration touched. | None. |
| **Code** | `overlay justifyContent:'center'` + `modalContainer height: SCREEN_HEIGHT*0.85` + all-corner radius + `animationType="fade"` (F-1, F-2). | This is the defect. |
| **Runtime** | Orchestrator reproduced on device: centered card, visible tab bar in the bottom gap, fade-in. Forensics confirms the static mechanism deterministically produces this (no timing/state dependence). | None — runtime matches the static prediction. |
| **Data** | N/A — no data dependence; the bug reproduces for any URL. | None. |

**Single contradiction:** Docs/convention (bottom-anchored sheet, covers nav) vs Code (centered floating card, exposes nav). Truth = the convention; Code is wrong. This is the entire bug.

---

## 6. Repro evidence

- **Orchestrator light-scoping (cited in dispatch):** reproduced on device via curated place card "Dram And Draught" → "Policies & Reservations" → centered browser with the tab bar visible below.
- **Forensics static confirmation:** the mechanism is a deterministic CSS layout fact (F-1) — `justifyContent:'center'` + fixed `SCREEN_HEIGHT*0.85` height with rounded bottom corners mathematically leaves an uncovered bottom strip on every device, for every URL, every time. There is no runtime/state/timing branch that could make it bottom-anchored. A booted sim is present (`iPhone 17 Pro` UDID `17091E60-…`); a Maestro live-fire was not run because (a) the bug is a static layout invariant already device-reproduced by the orchestrator, and (b) driving it requires building this worktree's dev build (symlinked `node_modules`), which is disproportionate for a deterministic style fact. **Confidence: `proven`** on the static-layout root cause; the device repro corroborates.

---

## 7. Blast radius / cross-surface map

| # | Surface | In scope? | Behavior | Reason |
|---|---------|-----------|----------|--------|
| 1 | Consumer iOS (`app-mobile` iOS) | **YES** | Browser bottom-anchors, slides up, covers tab bar, respects bottom safe-area (home indicator). | Primary surface; renders `InAppBrowserModal`. |
| 2 | Consumer Android (`app-mobile` Android) | **YES** | Same; respects Android nav-bar inset; `statusBarTranslucent` z-stacking over the in-tree tab bar. | Primary surface; renders `InAppBrowserModal`. |
| 3 | Buyer/anon Web | NO | Unchanged. | `InAppBrowserModal` is a native RN-Modal component; not used on web buyer routes. |
| 4 | Business iOS | NO | Unchanged. | F-8 — business app does not import `InAppBrowserModal`. |
| 5 | Business Android | NO | Unchanged. | F-8. |
| 6 | Admin Web (adjacent) | NO | Unchanged. | Different stack; no usage. |
| 7 | Business Web preview (adjacent) | NO | Unchanged. | No usage. |

**Within consumer app, all 5 mount sites change together (shared component, automatic parity):** ExpandedCardModal ticket browser, ExpandedCardModal policies browser, ProfilePage, CustomPaywallScreen, OnboardingFlow.

---

## 8. Invariant impact

- **I-WEBVIEW-URL-NORMALIZED (ORCH-0649):** PRESERVED by construction (call-site owned; modal renders `url` verbatim). F-5.
- **Sole-gorhom-consumer (`meta-orch-0991-base-bottom-sheet-sole-consumer.mjs`):** PRESERVED — the fix must NOT import `@gorhom/bottom-sheet` into `InAppBrowserModal`; it keeps the raw RN `<Modal>`. F-6.
- **orch-1022 gate G-01…G-06 (`orch-1022-expanded-card-modal-gating-check.mjs`):** PRESERVED — the fix does not rename/delete the component, change its default export or prop contract, or move a mount into curatedBody. F-4.
- **ORCH-0908 z-stacking (`<Modal transparent statusBarTranslucent>`):** already in use; the fix keeps `transparent` and should add/confirm `statusBarTranslucent` so the slide-up layers over the in-tree tab bar on Android. F-6.
- **Keep-all-nav-inside-WebView (no eject to external browser):** PRESERVED — `onShouldStartLoadWithRequest` returns true; `onError`/`onHttpError` → error state. Not touched. (L46-53, L137-139.)
- **No NEW invariant strictly required**, but a DRAFT is warranted to lock the bottom-anchored layout against a future "simplifying" re-center (see SPEC §6: `I-PROPOSED-1149-INAPP-BROWSER-BOTTOM-ANCHORED`).

---

## 9. Discoveries for orchestrator (side issues)

- **D-1 (FYI):** `InAppBrowserModal` does not pass `i18n` keys for the error state (there is no rendered error UI — `handleError` only flips `loading=false`, leaving a blank WebView on hard error). This is pre-existing and OUT OF SCOPE for ORCH-1149 (locked "no other visual change"); flagged for a future polish ORCH only.
- **D-2 (FYI):** the header title bar (`#1C1C1E`) and nav bar are not safe-area-padded at the TOP either (they rely on the centered card's top margin today). Once bottom-anchored at 85%+ height it still won't reach the status bar, so a top inset is NOT required for this fix — but if a future ORCH makes it full-height, the top inset will become necessary. OUT OF SCOPE now; noted.

Neither discovery should widen ORCH-1149. Both are append-only notes.

---

## 10. Confidence + recommended next phase

**Confidence: `proven`** — the root cause is a deterministic static-layout fact (F-1/F-2) with all six evidence fields, corroborated by the orchestrator's device repro and consistent across all five truth layers.

**Recommended next phase:** SPEC (this dispatch is IA — SPEC follows immediately below as `SPEC_ORCH-1149_INAPP_BROWSER_BOTTOM_ANCHOR.md`).

**Recommended scope (direction only, not a fix):** surgical, single-file layout/animation change to `app-mobile/src/components/InAppBrowserModal.tsx` — un-center (`overlay` → bottom-anchored), full-bleed container (drop fixed `0.85` height, full width, top-only border radius), `animationType` "fade" → "slide", add `useSafeAreaInsets().bottom` padding, confirm `statusBarTranslucent`. Keep the header, nav/URL bar, all WebView props, normalizeWebsiteUrl flow, and error handling EXACTLY as-is. No call-site edits beyond confirming the 5 mounts still compile. Business app untouched.
