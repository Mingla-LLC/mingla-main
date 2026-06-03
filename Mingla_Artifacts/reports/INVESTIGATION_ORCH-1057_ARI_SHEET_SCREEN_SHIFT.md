# INVESTIGATION — ORCH-1057 · Ari sheet open shifts whole screen up

**Surface under test:** Mingla **Business** app · Ari assistant chat screen (`AriChatScreen`) · empty state (orb + quick-question chips) · iOS + Android + web
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1057-[ari-composer-icons-polish]/` · branch `ORCH-1057-ari-composer-icons-polish` (HEAD == `main` `e944b0b20` at investigation time — no pending Ari changes)
**Investigator:** mingla-forensics (INVESTIGATE)
**Date:** 2026-06-02
**Confidence:** `proven` (live-fire reproduced on iOS ×2 + Android with pixel-precise before/after + frame-by-frame measurement)

---

## 1. Symptom (as reported by Seth)

> On the Business app's Ari chat screen, opening the "more" sheet (the conversations drawer, opened by the `≡` header button) shifts the ENTIRE screen content upward — the orb and the quick-question content visibly jump up when the sheet opens.

**Expected:** Opening the conversations drawer overlays a bottom sheet; the underlying screen (header + orb + chips) stays put behind the scrim.
**Reported actual:** The orb + quick-question content jump up when the sheet opens.

---

## 2. Headline finding

**The reported behavior does NOT reproduce on current `main` on any of the three primary surfaces (business-iOS, business-Android, business-web).** Opening the `ConversationDrawer` sheet on the Ari empty-state screen produces **zero vertical shift** of the orb / "Hi, I'm Ari." headline / quick-question content. This is proven by pixel-precise orb-centroid measurement before vs. after (≤1px delta, i.e. measurement noise) on two iOS devices and one Android device, plus a 1085-frame analysis of the entire open animation showing the orb's true Y never moves (736 → 737).

The architecture **structurally prevents** the reflow the report describes: the `Sheet` primitive renders inside a React Native `Modal`, which on every platform is a portal — on native iOS/Android the OS presents a separate modal window; on web `react-native-web`'s `Modal` `createPortal`s a `position:fixed` `<div>` appended to `document.body`. In all three cases the sheet is removed from `AriChatScreen`'s layout flow and cannot shrink the `styles.kav` flex parent that vertically centers the orb. Hypothesis 1 (web inline-reflow) is disproven at both source and library-implementation level; Hypotheses 2 and 3 are disproven at runtime.

Because the bug as literally described does not reproduce, this is classified **🔵 Observation / Not-Reproducible (NREP)** rather than a root-cause defect. Section 7 documents the one residual layout coupling that *could* produce a related (but opposite-direction and keyboard-gated) motion, which is the most plausible thing Seth actually saw, and Section 8 gives the orchestrator concrete next options.

---

## 3. Investigation manifest (every file read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `mingla-business/src/screens/ari/AriChatScreen.tsx` | The screen under test — `≡` button (L133-140) → `drawerOpen`; `<ConversationDrawer visible={drawerOpen}>` (L220); `<EmptyState>` (L169) inside `styles.kav` (flex:1); manual keyboard listeners (L69-82) → `keyboardHeight`; dynamic `inputWrap` paddingBottom (L182-194). |
| 2 | `mingla-business/src/components/ari/ConversationDrawer.tsx` | Renders `<Sheet visible={visible} onClose={onClose} snapPoint="half">` (L202). |
| 3 | `mingla-business/src/components/ari/EmptyState.tsx` | Host `flex:1, alignItems:center, justifyContent:center` — the orb is vertically centered. |
| 4 | `mingla-business/src/components/ui/Sheet.tsx` | Native entry — re-exports `./SheetMobile`. |
| 5 | `mingla-business/src/components/ui/SheetMobile.tsx` | The bottom-sheet primitive — wraps content in RN `Modal` (L286, `transparent`, `statusBarTranslucent`); panel is `position:absolute bottom:0` inside the Modal portal; ORCH-0892-B v2 explicitly dropped all keyboard handling from the Sheet. |
| 6 | `mingla-business/src/components/ui/Sheet.web.tsx` | Web variant — narrow web → `MobileSheet` (RN Modal); wide desktop → `DesktopCenteredCard` (also RN Modal). Both portal. |
| 7 | `mingla-business/src/hooks/useResponsiveLayout.ts` | Web wide/narrow gate (1024px inclusive). |
| 8 | `mingla-business/src/components/ari/AriOrb.tsx` | Orb is fixed-dimension; breathing is a `transform: scale` (no layout effect). |
| 9 | `mingla-business/src/components/ari/InputBar.tsx` | TextInput has NO `autoFocus`; opening the drawer does not focus an input. |
| 10 | `mingla-business/app/_layout.tsx` | `SafeAreaProvider` at root (L262); standard single provider. |
| 11 | `node_modules/react-native-web/dist/exports/Modal/ModalPortal.js` + `ModalContent.js` | RN-web `Modal` uses `react-dom` `createPortal` to a `div` appended to `document.body`; content is `position:fixed`. Library-level proof the web Sheet does not reflow. |

---

## 4. What I actually ran (live-fire evidence)

**Blocker resolved first:** the installed Business dev-build binaries on both iOS sims (and the DerivedData build, all dated ≤ May 31) predate the `react-native-video-trim` native TurboModule (added 2026-05-28 by ORCH-0978), so the app red-boxed at boot with `TurboModuleRegistry.getEnforcing(...): 'VideoTrim' could not be found` before any screen rendered. I unblocked WITHOUT a 30-min native rebuild by adding an **investigation-only** Metro `resolveRequest` alias pointing `react-native-video-trim` to a harmless stub (the cover-trim path is never exercised in this repro). I also added an **investigation-only** unauthenticated harness route `app/__orch1057_ari.tsx` that mounts the REAL `EmptyState` + `ConversationDrawer`(→`Sheet`) + `InputBar` with the EXACT `host`/`kav`/`inputWrap` layout and the EXACT manual keyboard listeners from `AriChatScreen` (the only thing it omits is the live `useAgentChat`/`useConversationList` data, irrelevant to the empty-state layout). **Both the stub and the harness route + all measurement scripts were removed and `metro.config.js` reverted after the session — the worktree is clean.** Faithful-harness justification: the empty-state layout is byte-identical to the screen under test.

**Why the harness instead of the real screen:** reaching the real Ari tab requires a live email-OTP login; no persisted session exists on the sims and no test credential is documented. The harness reproduces the exact layout + sheet interaction the bug concerns, without auth.

### Driven sequences + measurements

Maestro was the sim driver (per project rule). Orb position measured by orange-pixel centroid (pngjs) in the screenshots.

| Surface | Device | Orb centroid Y BEFORE sheet | Orb centroid Y AFTER sheet open | Shift |
|---|---|---|---|---|
| business-iOS | iPhone 17 Pro · iOS 26.4 | **y = 680** (cx 596) | **y = 681** (cx 596) | **+1px (noise) → none** |
| business-iOS | iPhone SE 3rd gen · iOS 26.4 | **y = 246** | **y = 242** | **−4px, occlusion artifact (sheet clips lower halo) → none** |
| business-Android | Pixel emulator (emulator-5554) | **y = 903** (cx 671) | **y = 904** (cx 671) | **+1px (noise) → none** |

**Frame-by-frame (iOS open animation, 1085 frames @ 20fps):** orb centroid Y = **736 at start, 737 at end**; first-5 frames all 736, last-5 all 737. The mid-animation min/max spread (736–944) is fully explained by the scrim progressively dimming the orb's lower halo (faint pixels drop below the orange threshold mid-fade), NOT a position change — the stable start/end prove the orb never moved.

Evidence screenshots (session-local, /tmp): `orch1057_BEFORE.png` / `orch1057_AFTER_open.png` (iPhone 17 Pro), `orch1057_SE_BEFORE.png` / `orch1057_SE_AFTER.png` (SE), `orch1057_AND_BEFORE.png` / `orch1057_AND_AFTER.png` (Android). In every pair the orb + "Hi, I'm Ari." headline + header are visibly at the identical Y; only the bottom half is covered by the rising sheet + dimmed by the scrim.

---

## 5. Five-layer cross-check

| Layer | Finding |
|---|---|
| **Docs** | ORCH-1057 design spec (`DESIGN_ORCH-1057_ARI_COMPOSER_ICONS_EMPTYSTATE.md`) scopes cosmetic polish (send button, lucide header icons, empty-state chip removal). `SheetMobile.tsx` header docs (ORCH-0892-B v2) explicitly state the Sheet "no longer owns keyboard handling… panel rests at its designed snap point regardless of keyboard state." Expected behavior = sheet overlays, screen stays put. |
| **Schema** | N/A (pure client UI). |
| **Code** | `Sheet` → RN `Modal` portal on all platforms (SheetMobile L286; Sheet.web both branches). `EmptyState` is centered in `kav` (flex:1). `inputWrap` paddingBottom is keyboard-driven (AriChatScreen L189-192). No code path makes opening the drawer change `kav`'s height. |
| **Runtime** | Reproduced live on iOS ×2 + Android: **zero shift** (≤1px). RN-web Modal verified to `createPortal` to `document.body` (library source). |
| **Data** | No persisted Supabase session on either sim (`RCTAsyncLocalStorage_V1` manifest has zero `sb-*-auth-token` keys); brand/store keys present from a prior login. Irrelevant to the layout repro. |

No layer contradicts another. All five agree the sheet overlays without reflowing the screen.

---

## 6. Candidate causes considered and disproven

- **H1 — Web `Sheet.web.tsx` renders inline (not portaled), shrinking the flex parent so the centered EmptyState re-centers / orb jumps.** DISPROVEN. Both branches of `Sheet.web.tsx` wrap children in RN `Modal`; `react-native-web`'s `Modal` (`ModalPortal.js`) uses `react-dom` `createPortal` into a `position:fixed` `<div>` appended to `document.body`. The sheet is not in `AriChatScreen`'s layout tree on web. (Library-source proof + source reasoning.)
- **H2 — Native iOS RN `Modal` (with `statusBarTranslucent`) triggers a `react-native-safe-area-context` re-measure that collapses `host`'s `paddingTop: insets.top` to 0, shifting all content up.** DISPROVEN at runtime. The leading native hypothesis (and a documented RN 0.76+ class of issue — see §9) — but on iPhone 17 Pro AND iPhone SE the orb centroid moved ≤1px on sheet open and 736→737 across 1085 animation frames. The underlying SafeAreaProvider does not re-emit on Modal present in this RN 0.81.5 / safe-area-context 5.6.0 / Expo 54 config.
- **H3 — Opening the sheet fires a keyboard show/hide event that changes `inputWrap` paddingBottom and reflows the centered EmptyState.** DISPROVEN as a cause of the *reported* motion. `InputBar`'s TextInput has no `autoFocus`; opening the drawer does not focus an input, so no keyboard event fires on open. (And see §7 for why the keyboard-coupled motion, even when it occurs, goes the OPPOSITE direction.)

---

## 7. The one residual layout coupling (🟡 Hidden flaw — most plausible thing Seth saw)

`AriChatScreen`'s `styles.kav` (flex:1) contains TWO siblings: `<EmptyState>` (itself `flex:1`, vertically centering the orb) AND `<View style={inputWrap}>` whose `paddingBottom` is **keyboard-driven**:

```
paddingBottom:
  keyboardHeight > 0
    ? keyboardHeight + spacing.sm
    : Math.max(insets.bottom, spacing.md) + BOTTOM_NAV_CLEARANCE_PX   // 80
```
(`AriChatScreen.tsx` L189-192.)

Because `inputWrap` and the centered `EmptyState` share the same flex parent, **the orb's vertical position is a function of `keyboardHeight`**: when the keyboard is UP, `inputWrap` is tall → `EmptyState` flex space is small → **the orb sits HIGH**; when the keyboard goes DOWN, `inputWrap` shrinks → `EmptyState` gets more room → **the orb drops DOWN**.

Now consider the real-world sequence "tap the input (keyboard up) → tap `≡` to open the drawer": presenting the Modal dismisses the keyboard → `keyboardWillHide` fires → `inputWrap` shrinks → **the orb animates DOWNWARD**. So this coupling can make the orb move when opening the drawer, but in the **opposite direction** to "jumps up," and only when a keyboard was already up. It is therefore unlikely to be the exact reported symptom, but it is the only mechanism in this screen by which opening the drawer can move the orb at all, and it is a genuine latent fragility (the empty-state orb's resting position is coupled to keyboard state via a shared flex parent). I could not force the iOS soft keyboard on the sim to film this exact motion — the sim suppressed the soft keyboard even after disabling the hardware keyboard + reboot, a known sim limitation (Maestro `inputText` also bypasses the keyboard pipeline per project memory). Confidence on THIS sub-finding: `probable` (sim attempt made, soft-keyboard blocker named), vs. `proven` for the main not-reproducible finding.

**Classification:** 🟡 Hidden flaw — `EmptyState` resting position is keyboard-coupled through the shared `kav` flex parent. Six fields:
- **File+line:** `AriChatScreen.tsx` L167-194 (`styles.kav` wrapping `<EmptyState>` flex:1 + `inputWrap` with keyboard-driven paddingBottom).
- **Exact code:** the `paddingBottom: keyboardHeight > 0 ? keyboardHeight + spacing.sm : …` ternary, with `EmptyState` (flex:1) as a preceding sibling in the same flex column.
- **What it does:** the orb's centered Y depends on `inputWrap` height, which depends on `keyboardHeight`; any keyboard show/hide reflows the orb.
- **What it should do:** the empty-state orb's resting position should be independent of the composer's keyboard-driven padding (e.g. EmptyState centered against a stable container, or inputWrap absolutely positioned / keyboard handled without resizing the centered region).
- **Causal chain:** keyboard up → inputWrap tall → EmptyState short → orb high; open drawer → keyboard dismissed → inputWrap short → EmptyState tall → orb drops. A user who had the keyboard up would see the orb move on drawer open.
- **Verification step:** force the iOS soft keyboard (physical device or sim with soft keyboard genuinely shown), focus the composer, then open the drawer, and film the orb — it should translate downward as the keyboard dismisses. (Blocked on sim soft-keyboard suppression this session.)

---

## 8. Outcome & journey step-back

**User goal:** open past conversations / start a new chat with Ari, without the screen feeling like it lurches.
**Journey:** Ari tab (empty state, orb centered) → tap `≡` → conversations sheet rises over the bottom half → pick a conversation or "New conversation" → sheet dismisses → back to chat.
**Where reality diverges from the report:** at the "tap `≡`" step the report says the whole screen jumps up; live-fire shows it does not (orb fixed to ≤1px). The journey is visually stable on all three surfaces with the keyboard down.
**Does fixing the reported node deliver the outcome?** There is no reproducible "screen shifts up on sheet open" node to fix on current main. If Seth's real complaint is the keyboard-coupled orb motion (§7), the fix is to decouple the empty-state orb's resting position from the composer's keyboard padding — which is naturally in scope for ORCH-1057's empty-state work (the design spec already plans to restructure the empty state by removing the chip wall). The orchestrator should confirm the exact reproducer with Seth before specing a fix.

---

## 9. External research (cited)

- React Native `Modal` + `statusBarTranslucent` + safe-area interactions are a documented regression class since RN 0.76 (content pushed/inset changes when a Modal presents): facebook/react-native#47524, facebook/react-native#49256. This motivated H2; H2 was nonetheless disproven at runtime on this exact stack (RN 0.81.5 / `react-native-safe-area-context` ~5.6.0 / Expo SDK 54).
- React Navigation safe-area guidance + Expo safe-areas docs recommend the `useSafeAreaInsets()` hook and warn that mixing `SafeAreaView` + the hook can flicker on different update timings (reactnavigation.org/docs/handling-safe-area, docs.expo.dev/develop/user-interface/safe-areas). `AriChatScreen` correctly uses only the hook (`insets.top`) — no mixed-source flicker.
- `react-native-web` `Modal` implementation (local `node_modules/react-native-web/dist/exports/Modal/ModalPortal.js` + `ModalContent.js`): `createPortal` to a `document.body`-appended `div`; content `position:fixed` → confirms the web Sheet is a portal, not inline.

---

## 10. Blast radius

`Sheet` (SheetMobile + Sheet.web) is the canonical bottom-sheet primitive used across mingla-business (BrandSwitcherSheet, EventCreator sheets, ticket sheets, ConversationDrawer, etc.). The portal/no-reflow behavior proven here applies to all of them — none reflow their host screen on open. The keyboard-coupling in §7 is specific to `AriChatScreen` (the pattern of a flex:1 centered child sharing a flex parent with a keyboard-driven sibling); a quick grep of other screens for the same shape is advisable if the §7 fix is pursued, but no other screen was found to centre a hero element this way in the manifest read.

---

## 11. Surfaces that reproduce

| Surface | Reproduces the reported "screen shifts up on sheet open"? |
|---|---|
| business-iOS (iPhone 17 Pro · iOS 26.4) | **No** (orb 680→681, ≤1px; 1085-frame stable) |
| business-iOS (iPhone SE · iOS 26.4) | **No** (orb 246→242; occlusion artifact only) |
| business-Android (Pixel emulator) | **No** (orb 903→904, ≤1px) |
| business-web | **No** (RN-web Modal `createPortal` to `document.body`; cannot reflow host) — library-source + source proof; not separately filmed because the portal mechanism is identical and definitive |

---

## 12. Discoveries for orchestrator

- **D-1 (P2, cross-ORCH):** The installed Business dev-build sim binaries + the only DerivedData build all predate the `react-native-video-trim` native module (ORCH-0978, 2026-05-28) → the Business app red-boxes at boot on every sim with `getEnforcing('VideoTrim')`. Any future Business sim QA needs a fresh native rebuild (per the iOS dev-build runbook) before it can launch. This will bite the ORCH-1057 implementor/tester too.
- **D-2 (P3):** No documented Business test login + no persisted sim session → reaching authenticated Business screens on the sim requires a live email-OTP login (notify-Seth item) or a dev harness route. Consider a documented seeded test account for Business sim QA.
- **D-3 (feeds ORCH-1057):** §7 keyboard-coupled orb motion — the empty-state orb's resting Y is coupled to the composer's keyboard padding via the shared `kav` flex parent. Likely the real thing Seth saw; naturally addressable inside ORCH-1057's empty-state restructure. Confirm the exact reproducer with Seth.

---

## 13. Confidence

- **Main finding (not reproducible on current main):** `proven` — live-fire on iOS ×2 + Android, pixel-precise before/after + 1085-frame analysis, plus library-source disproof of the web path.
- **§7 keyboard-coupling sub-finding (most plausible real symptom):** `probable` — source-traced + geometry-reasoned; the exact on-device motion could not be filmed due to sim soft-keyboard suppression (blocker named).
