# INVESTIGATION — ORCH-0892 [App-wide keyboard avoidance — `react-native-keyboard-controller` pilot on mingla-business]

**Mode:** INVESTIGATE only (no SPEC, no fixes, no code, no installs).
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.
**Date:** 2026-05-19.
**Dispatch:** `Mingla_Artifacts/prompts/INVESTIGATOR_ORCH-0892_KEYBOARD_AVOIDANCE_LIBRARY_PILOT.md`.
**Verdict:** Library is **compatible** with the current stack but **NOT a drop-in replacement** for every existing pattern. Pilot is feasible; sub-ORCH split recommended.

---

## §0 — Mandatory ingestion confirmation

**Memory entries read:**
- `feedback_keyboard_never_blocks_input.md` (13 days old — canonical Cycle 3 wizard root pattern; explicitly names KAV + `automaticallyAdjustKeyboardInsets` as anti-patterns in this stack)
- `feedback_rn_sub_sheet_must_render_inside_parent.md` (13 days old — I-13 native Modal portal contract; sub-sheets MUST be JSX-children of parent Sheet)
- `feedback_mingla_business_desktop_web_contracts.md` (codified 2026-05-19 — 16 intentional desktop-web contracts; the 4 jest gates that must pass)
- `feedback_strict_grep_registry_pattern.md` (13 days old — one script + one workflow job per new gate; never new workflow file)
- `feedback_topsheet_extended_universal_creator.md` (5 days old — TopSheet has TWO consumers: BrandSwitcherSheet + UniversalCreatorSheet; further use needs new DEC)

**Memory NOT read (acknowledged but not needed for this scope):**
- `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md` (ORCH-0857 ScrollView footgun — referenced but not yet read; library wraps ScrollViews so this risk is logged in §8)

**Source code read in full:**
- `mingla-business/package.json` (versions table in §2)
- `mingla-business/app.json` (`newArchEnabled: true`, plugins list, web output: static)
- `mingla-business/app/_layout.tsx` (1-252 — root provider chain)
- `mingla-business/src/components/ui/Sheet.tsx` (1-438 — Sheet primitive with its OWN Keyboard.addListener + translateY = -keyboardHeight)
- `mingla-business/src/components/ui/Sheet.web.tsx` (1-284 — Sheet web variant with desktop-floating-card branch; explicitly declares I-KEYBOARD-NEVER-BLOCKS-INPUT irrelevant on desktop)
- `mingla-business/src/components/ui/CoverPicker.tsx` (1-816 — ORCH-0884 follow-up #8 + #9 layered patches still present; ORCH-0888 InputAccessoryView fix NOT yet implemented in this file)
- `mingla-business/src/components/trip/TripCreatorWizard.tsx` lines 380-414 (Cycle 3 wizard root pattern + ORCH-0884 follow-up #9 scrollViewRef)
- `mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx` lines 190-230 (composer body shrinks by keyboardHeight; explicit note that KAV's padding approach didn't work because of fixed numeric body height for pell-on-iOS tap reliability)

**Inventories (grep-driven, full output in §4):**
- 18 production files contain `Keyboard.addListener`
- 4 production files use `KeyboardAvoidingView`
- 11 production files use `automaticallyAdjustKeyboardInsets`
- 46–51 mingla-business files host a `TextInput` directly (grep count)

**Git log inspected:**
- ORCH-0884 follow-ups #3, #5, #6/7, #8, #9 — five sequential commits between `42fb9e0e` and `16f6d90a` layering keyboard patches across CoverPicker + wizards + Sheet
- Current `Seth` HEAD: ORCH-0887-A-2 `986884ed`

**Library documentation read:**
- `react-native-keyboard-controller` v1.21.7 (May 2026), MIT, 3.6k GitHub stars, 158 forks
- Peer dependencies: `react: *`, `react-native: *`, `react-native-reanimated: >=3.0.0`
- Runtime dependency: `react-native-is-edge-to-edge: ^1.2.1`
- Entry points: `lib/commonjs/index` / `lib/module/index` / `src/index` — **NO `web` or `browser` entry point**
- FabricExample folder present → Fabric / New Architecture supported
- Components: KeyboardProvider, KeyboardAvoidingView, KeyboardAwareScrollView, KeyboardStickyView, KeyboardToolbar, OverKeyboardView, KeyboardBackgroundView, KeyboardExtender, KeyboardChatScrollView
- Hooks: useReanimatedKeyboardAnimation, useKeyboardHandler, useKeyboardContext, useKeyboardController
- Expo install command: `npx expo install react-native-keyboard-controller`
- Web behaviour: **NOT explicitly documented**; the package.json has no web entry point; the docs site is silent. Treated as RISK in §3 and §8.

**Could NOT find on disk (Discovery for Orchestrator):**
- `Mingla_Artifacts/specs/SPEC_ORCH-0888_INPUT_ACCESSORY_VIEW_FOR_COVER_PICKER_SEARCH.md` — cited by WORLD_MAP entry but `find Mingla_Artifacts -iname "*0888*"` returns zero files. Either the WORLD_MAP narrative is ahead of the artifact write, or the artifact lives elsewhere. Confidence: High that ORCH-0888 SPEC IS NOT on disk under that path.
- ORCH-0884 follow-up reports — `find Mingla_Artifacts -iname "*0884*"` returns zero files. Knowledge of follow-ups #3 / #5 / #6/7 / #8 / #9 reconstructed from git log + inline source comments only.

---

## §1 — Operator symptom + decisions already locked

**Symptom (operator's words):**
> "Is there a way to reliably, app wide, set the way keyboards show up under input fields, like just flush beneath them, ensuring it works, and then remove any per input field styling? brainstorming session"

**Engineering restatement:** mingla-business has accreted at least three generations of keyboard-handling plumbing across 30+ surfaces. Each input-bearing screen carries its own bespoke avoidance code. The result is fragile (drifts every time someone adds an input), inconsistent (some screens use KAV, some use Cycle 3 listener pattern, some use iOS auto-insets, some use a 400pt spacer hack), and recurring (ORCH-0884 had 5 sequential follow-ups; ORCH-0888 [Fabric breaks legacy ScrollResponder] is queued because one of those patches turned out to silently no-op under Fabric). Operator wants ONE app-wide mechanism + then delete the bespoke styling.

**Decisions LOCKED at INTAKE 2026-05-19 (do not revisit in SPEC):**
1. **Scope:** mingla-business first (pilot). `app-mobile/` is a separate downstream ORCH IF the pilot lands cleanly.
2. **Cleanup posture:** Hard ban + strict-grep CI gate post-migration. New `Keyboard.addListener('keyboard(Will|Did)(Show|Hide)')` and new `KeyboardAvoidingView` imports from `'react-native'` are forbidden outside an allowlist.
3. **Next move:** Register + dispatch INVESTIGATE (this dispatch).
4. **Candidate library:** `react-native-keyboard-controller` (kirillzyusko, MIT). Investigation evaluates this specific library, not alternatives. If forensics finds a hard blocker, it surfaces as a path-fork question for §10 — does not unilaterally pivot.

---

## §2 — Library compatibility verdict

### Versions table

| Repo dependency | Repo version | Library peer-dep / requirement | Verdict |
|---|---|---|---|
| `react` | 19.1.0 | `*` (any) | **OK** |
| `react-native` | 0.81.5 | `*` (any) | **OK** — well above any reasonable floor |
| `react-native-reanimated` | ~4.1.1 | `>=3.0.0` | **OK** — Reanimated v4 satisfies the >=3 peer dep |
| `react-native-worklets` | 0.5.1 | bundled with Reanimated v4 | **OK** |
| `react-native-gesture-handler` | ~2.28.0 | not a peer-dep but commonly co-installed | **OK** |
| Fabric / New Architecture (`newArchEnabled`) | `true` (`app.json:9`) | claimed-supported (FabricExample in repo, v1.21.7 ships Fabric specs) | **OK** — bring to live-sim during pilot to confirm zero TurboModule registry errors |
| Hermes | default in RN 0.81 (no opt-out in `app.json`) | not required, but compatible | **OK** |
| Expo SDK | ~54.0.34 | Expo plugin auto-discovered via autolinking; `npx expo install` is the documented install command | **OK** — Expo plugin available |
| `react-native-webview` | ^13.16.1 | independent — library does not interact with WebView's internal keyboard handling | **OK at boundary**, see §5 RichEditor carve-out for nested-WebView nuance |
| `expo-dev-client` | ~6.0.21 | required because library ships a native module → dev-client rebuild needed | **OK** — `IOS_DEV_BUILD_REBUILD_RUNBOOK.md` exists for this |
| `react-native-is-edge-to-edge` (transitive) | not currently installed | library runtime dep `^1.2.1` | **OK** — auto-installed via the library |

**Overall library compat verdict: CONFIRMED.** No version gaps. No bumps needed pre-pilot.

**Caveat — Reanimated v4 surface:** Library peer-dep is `>=3.0.0`. Repo runs v4.1.1. Reanimated v4 introduced a breaking change splitting worklets into the separate `react-native-worklets` package (which we have at `0.5.1`). The library has been published since this split landed (v1.21.7 was released after Reanimated v4 GA). Confidence: High that v1.21.x targets both v3 and v4. Verify in pilot by smoke-testing one `KeyboardAvoidingView` mount; if it throws a `WorkletsModule` resolution error, investigate before SPEC commits.

---

## §3 — Web mount behaviour verdict

**Verdict: REQUIRES `Platform.OS` GATING.** The library has **NO web entry point** in `package.json` and **NO web shim** documented. Mounting `<KeyboardProvider>` unconditionally in `mingla-business/app/_layout.tsx` will at minimum log "module not found" warnings under Metro web bundling, and at worst throw at the native-module-resolution step (`UIManagerModule.RNKeyboardController`).

**Why this matters for mingla-business specifically:** the same root layout serves all three surfaces:
- business-iOS (real keyboard, native module needed)
- business-Android (real keyboard, native module needed)
- business-web-preview (browser handles its own keyboard via viewport behaviour, no native module to call)

**Required pattern (do not implement now — for SPEC reference):**
```tsx
// Sketch only — final code is SPEC's job.
const KeyboardRoot: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  if (Platform.OS === 'web') return <>{children}</>;
  const { KeyboardProvider } = require('react-native-keyboard-controller');
  return <KeyboardProvider>{children}</KeyboardProvider>;
};
```

Or, using Metro's `.web.tsx` resolution (mirroring the existing `StripeProviderWrapper` precedent at `mingla-business/src/payments/StripeProviderWrapper.{tsx,native.tsx}` documented in `_layout.tsx:34-40`):
- `KeyboardRoot.native.tsx` — real `<KeyboardProvider>` wrap
- `KeyboardRoot.tsx` — passthrough `<>{children}</>`

**Recommendation:** mirror the StripeProviderWrapper precedent. The repo already has a working pattern for "native-only module behind a passthrough on web" via Metro `.web` resolution; reusing it keeps the gating mechanism uniform.

**Buyer-anon-web inherits the same gating.** `/checkout/{eventId}`, `/e/{brandSlug}/{eventSlug}`, `/b/{brandSlug}` mount through the same `app/_layout.tsx` root provider chain. If the native-only KeyboardProvider crashes on web, both business-web-preview AND buyer-anon-web go down. The `.web.tsx` passthrough variant protects both.

Confidence: **High** (peer-dep + entry-point absence is hard evidence). The exact failure mode on web (warn vs throw) is **Medium** confidence — pilot must capture the console output to lock the SPEC's gating wording.

---

## §4 — Full keyboard-pattern inventory

**Methodology:** `grep -rn "Keyboard\.addListener\|KeyboardAvoidingView\|automaticallyAdjustKeyboardInsets\|InputAccessoryView\|inputAccessoryViewID" mingla-business/src/ mingla-business/app/` then deduplicated by file. Excludes `__tests__`.

| # | Surface | File | Lines | Mechanism | Working? | Migration cost | Notes |
|---|---|---|---|---|---|---|---|
| 1 | **Sheet primitive (canonical)** | `src/components/ui/Sheet.tsx` | 175-194, 196-211 | `Keyboard.addListener` + translateY = -keyboardHeight at panel level (post-ORCH-0884 #3) | YES (operator-confirmed) | **DO NOT MIGRATE** | See §5. Sheet is the keyboard authority for ALL sheet-hosted inputs. Library would double-translate. |
| 2 | **Sheet web variant** | `src/components/ui/Sheet.web.tsx` | line 39 declares I-KEYBOARD-NEVER-BLOCKS-INPUT irrelevant on desktop | Inherits canonical Sheet via re-export for narrow web; desktop variant has no keyboard logic | YES | n/a — already correct | Library would not run on web anyway (§3). |
| 3 | **CoverPicker (GIPHY/Pexels search)** | `src/components/ui/CoverPicker.tsx` | 217-243 (#9 dead scroll), 255-271 (#8 spacer) | Layered: (a) `scrollResponderScrollNativeHandleToKeyboard` via parentScrollRef (Fabric-broken per ORCH-0888 investigation), (b) `Keyboard.addListener` + 400pt spacer below content | NO (operator-reported — input cursor covered) | **REPLACE** — but coordinate with ORCH-0888 (see §10 Q1) | The ORCH-0888 InputAccessoryView fix is the OTHER candidate. Library's `<KeyboardAvoidingView>` may make ORCH-0888 unnecessary. |
| 4 | **EventCreatorWizard** | `src/components/event/EventCreatorWizard.tsx` | 284, 300-310, 869-884 | Cycle 3 wizard root: `Keyboard.addListener` + paddingBottom + iOS `automaticallyAdjustKeyboardInsets`. Inline comments explicitly call out the KAV anti-pattern was removed. | Mostly yes (operator hasn't reported wizard input bugs lately) | MEDIUM — wrap form ScrollView in `<KeyboardAwareScrollView>` from library, delete listener + manual paddingBottom | Currently DIRTY in working tree (ORCH-0884 follow-ups uncommitted) |
| 5 | **TripCreatorWizard** | `src/components/trip/TripCreatorWizard.tsx` | 17-18 (header comment), 386-414, 1064-1178 (KAV wrap) | Hybrid: outer `<KeyboardAvoidingView behavior="padding">` PLUS Keyboard.addListener + paddingBottom mirror of EventCreatorWizard | Mostly yes | MEDIUM — same migration as EventCreatorWizard | Currently DIRTY in working tree (ORCH-0884 follow-ups uncommitted). Header comment explicitly notes "Replaces prior KeyboardAvoidingView per SPEC §3.3.5" — meaning the wizard has been through KAV → listener → KAV-wrap-again churn already. Strong signal the operator wants ONE solution. |
| 6 | **ComposerV2Editor (marketing blast)** | `src/components/marketing/ComposerV2/ComposerV2Editor.tsx` | 195-215 (keyboard height tracking), 222-228 (body height calc) | Body height = `windowHeight - insets - CHROME_CONTENT_PX - keyboardHeight` (custom shrink-on-keyboard because pell rich editor requires fixed numeric body height) | YES | **DO NOT MIGRATE** | See §5. Composer body is a fixed-height container hosting a WebView (pell). Library's `<KeyboardAwareScrollView>` cannot reason about WebView-internal keyboard events. |
| 7 | **TemplateEditor** | `src/components/marketing/TemplateEditor.tsx` | 13 (comment ref to KAV pattern) | Wraps in KAV per composer pattern | YES (?) | MEDIUM — same composer caveat applies | Read in detail at SPEC time. |
| 8 | **BrandEditView** | `src/components/brand/BrandEditView.tsx` | 27 (import), 419-817 | Pure `<KeyboardAvoidingView behavior="padding">` wrap around the entire form | YES | LOW — straight swap to library's `<KeyboardAvoidingView>` | One of the cleanest migration candidates. |
| 9 | **TripBrandWizard** | `src/components/brand/TripBrandWizard.tsx` | 26 (import), 230-329 | Pure `<KeyboardAvoidingView>` wrap | YES | LOW — straight swap | Another clean candidate. |
| 10 | **AriChatScreen** | `src/screens/ari/AriChatScreen.tsx` | 11 (header comment), 65-80 | Listener-based; comments explicitly note "KeyboardAvoidingView's padding approach" was discussed | YES | LOW–MEDIUM — chat surface; library's `<KeyboardChatScrollView>` is purpose-built | Specialized chat primitive in the library; potential UX upgrade. |
| 11 | **InputBar (chat composer)** | `src/components/ari/InputBar.tsx` | 7 (header comment: "PARENT screen wraps this in a KeyboardAvoidingView OR pads the bottom") | No own keyboard logic — relies on parent | n/a | n/a — migrate at parent (AriChatScreen) | Implicit contract risk: comment says "OR" — meaning two valid wrappers. Library standardises. |
| 12 | **BusinessWelcomeScreen (auth)** | `src/components/auth/BusinessWelcomeScreen.tsx` | 268-271 | `Keyboard.addListener("keyboardDidShow"/"keyboardDidHide")` (Android-only events; iOS uses different events here — likely a small bug) | Unclear | MEDIUM — straight migration to library `<KeyboardAvoidingView>` | Inconsistent event-name selection vs Cycle 3 pattern. Flag at SPEC time. |
| 13 | **IntakeQuestionEditor** | `src/components/trip/IntakeQuestionEditor.tsx` | 145-148, 300 (auto-inset) | Listener + iOS auto-inset | YES (post-ORCH-0884 #3 Sheet fix) | MEDIUM — but currently lives INSIDE a Sheet, so Sheet primitive already handles it; this listener may be redundant | Audit at SPEC time. |
| 14 | **EditPublishedTripScreen** | `src/components/trip/EditPublishedTripScreen.tsx` | 542-549, 1242 (auto-inset) | Listener + auto-inset | YES | MEDIUM | Currently DIRTY in working tree. |
| 15 | **EditPublishedScreen (events)** | `src/components/event/EditPublishedScreen.tsx` | 301-308 | Listener pattern | YES | MEDIUM | Currently DIRTY in working tree. |
| 16 | **MultiDateOverrideSheet** | `src/components/event/MultiDateOverrideSheet.tsx` | 159-162 | Listener inside a Sheet — redundant with Sheet primitive | YES | DELETE — Sheet's translateY handles it | Migration is a code DELETION, not a swap. |
| 17–21 | **5 checkout/buyer/payment screens** | `app/checkout/[eventId]/buyer.tsx`, `app/checkout/[eventId]/payment.tsx`, `app/checkout-trip/[tripEventId]/buyer.tsx`, `app/checkout-trip/[tripEventId]/intake.tsx`, `app/checkout-trip/[tripEventId]/payment.tsx` | 200-280 across files | Listener pattern (Cycle 3 mirror) | YES | LOW–MEDIUM — straight swap | Buyer-anon-web inherits — these mount on both native AND web. Library's `<KeyboardAvoidingView>` would skip via §3 gating; web falls through to browser viewport behaviour (which is what we want — operator's only iOS/Android complaint). |
| 22–23 | **Account settings** | `app/account/delete.tsx`, `app/account/edit-profile.tsx` | 105-118 | Listener `keyboardDidShow`/`keyboardDidHide` only (no `keyboardWillShow` Android-only events) | YES | LOW — straight swap | Inconsistent with Cycle 3 pattern (no iOS-specific events). |
| 24 | **BrandStripeDetachConfirmSheet** | `src/components/brand/BrandStripeDetachConfirmSheet.tsx` | 110 | iOS `automaticallyAdjustKeyboardInsets` only | YES (small surface) | LOW — possibly DELETE if Sheet handles it | Audit at SPEC time. |
| 25 | **BrandDeleteSheet** | `src/components/brand/BrandDeleteSheet.tsx` | 21 (header), 181 | Auto-inset only | YES | LOW–DELETE | Sheet primitive may already cover. |
| 26 | **InviteBrandMemberSheet** | `src/components/team/InviteBrandMemberSheet.tsx` | 159 | Auto-inset | YES | LOW–DELETE | Sheet primitive. |
| 27 | **InviteScannerSheet** | `src/components/scanners/InviteScannerSheet.tsx` | 157 | Auto-inset | YES | LOW–DELETE | Sheet primitive. |
| 28 | **RefundSheet** | `src/components/orders/RefundSheet.tsx` | 263 | Auto-inset | YES | LOW–DELETE | Sheet primitive. |
| 29 | **AddCompGuestSheet** | `src/components/guests/AddCompGuestSheet.tsx` | 201 | Auto-inset | YES | LOW–DELETE | Sheet primitive. |
| 30 | **VenueCreatorWizard** | `src/components/venue/VenueCreatorWizard.tsx` | (TextInput-bearing; mechanism not yet read at investigation time) | Unknown | Unknown | UNKNOWN | Flag for SPEC inventory. |
| 31 | **Several minor surfaces** | `account/edit-profile`, `account/delete`, `app/venue/create`, `app/trip/*`, etc. | TextInput-only without explicit keyboard handling | Relies on iOS auto-inset OR browser default | Mixed | LOW | Sweep at SPEC time. |

**Inventory totals:**
- **18 production files** call `Keyboard.addListener` (15 are Cycle-3-pattern wizard-style, 3 are listener-only diagnostics)
- **4 production files** use `KeyboardAvoidingView` directly imported from `'react-native'` (BrandEditView, TripBrandWizard, TripCreatorWizard, AriChatScreen — implicit via comment)
- **11 production files** use `automaticallyAdjustKeyboardInsets={true}` on a ScrollView
- **46–51 mingla-business files** host `TextInput` (full input-bearing surface count)

**The N partially-different patterns operator described is concretely 27+ surfaces touched by THREE distinct mechanisms, often layered on the same surface.**

---

## §5 — Carve-outs that MUST NOT migrate (or must coexist carefully)

### Carve-out CO-1 — Sheet primitive

**File:** `mingla-business/src/components/ui/Sheet.tsx:166-211`
**Why protected:** The Sheet primitive owns the keyboard-aware translateY behaviour for EVERY sheet-hosted input across mingla-business. Wrapping the Sheet's content in the library's `<KeyboardAvoidingView>` would double-translate (panel rises by `-keyboardHeight` AND library adds padding by `keyboardHeight`).
**ORCH-IDs that codified:** ORCH-0884 follow-up #3 (commit `42fb9e0e` 2026-05-19 "fix Nestable* crash + keyboard-block in Sheets"), pattern referenced by `feedback_keyboard_never_blocks_input.md`.
**Recommendation:** Sheet remains the keyboard authority for sheet-hosted inputs. Library wraps EVERYTHING ELSE. The strict-grep allowlist must specifically permit `Sheet.tsx` to keep its `Keyboard.addListener`.
**Caveat:** Sheet itself could in principle migrate to the library's `useReanimatedKeyboardAnimation` hook (it would be cleaner than `Keyboard.addListener` + `useState`), but this is OUT OF SCOPE for ORCH-0892-A; queue as ORCH-0892-D if the operator wants the cleanup.

### Carve-out CO-2 — ComposerV2Editor (marketing blast)

**File:** `mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx:190-228`
**Why protected:** The composer body has a FIXED numeric height (`CHROME_CONTENT_PX = 376`) because the pell rich-editor needs a fixed-height container for tap reliability on iOS. The composer shrinks the body by `keyboardHeight` on keyboard show. The library's `<KeyboardAvoidingView>` and `<KeyboardAwareScrollView>` both assume the container should grow/scroll to keep an input visible — they will fight the fixed-height invariant.
**ORCH-IDs that codified:** Inline source comment "F.9e: track keyboard height so the body shrinks when the keyboard appears... KAV's padding approach didn't work because the body has a fixed numeric height (which it needs for pell-on-iOS tap reliability)".
**Recommendation:** Composer keeps its custom shrink-on-keyboard mechanism for ORCH-0892-A. After the library is installed app-wide, ORCH-0892-D (cleanup) MAY swap the composer's `Keyboard.addListener` for the library's `useReanimatedKeyboardAnimation` hook to drive the body-height calc — this is a cosmetic upgrade (Reanimated worklet vs JS setState), not a functional one. STRICT-GREP allowlist must permit ComposerV2Editor.

### Carve-out CO-3 — RichEditor WebView (pell)

**File:** `mingla-business/src/components/marketing/ComposerV2/richEditor.{native.ts,tsx}` (DIRTY in working tree; not read in full this dispatch)
**Why protected:** `react-native-pell-rich-editor` v1.10.0 mounts a WebView. The WebView's content renders inside an isolated web context with its OWN keyboard handling (the iOS WebView's `inputAccessoryView` is the keyboard accessory bar; HTML inputs inside the WebView get iOS's native keyboard avoidance via the WebView's scrollView, not the outer React Native scrollView). The library's `<KeyboardProvider>` cannot reach inside the WebView's iframe-like sandbox.
**ORCH-IDs that codified:** Implicit (pell architecture); ORCH-0891 [composer chip DOM contract] surfaced recently (strict-grep files visible in `git status`).
**Recommendation:** No migration. WebView keeps its native keyboard handling. The library can wrap the AREA AROUND the WebView (composer footer, send buttons) but MUST NOT wrap the WebView itself.

### Carve-out CO-4 — CoverPicker InputAccessoryView (ORCH-0888 candidate fix)

**File:** `mingla-business/src/components/ui/CoverPicker.tsx:209-271`
**Why protected:** ORCH-0888 [Fabric breaks legacy ScrollResponder] is registered + investigated + SPEC-ready but NOT yet implemented. The CoverPicker currently has TWO layered patches still present (the dead scrollResponder call from ORCH-0884 #9 + the 400pt spacer hack from ORCH-0884 #8). ORCH-0888's proposed fix is to add an `InputAccessoryView` with `inputAccessoryViewID` on the search TextInput.
**Coordination question (escalated to §10 Q1):** does the library's `<KeyboardAvoidingView>` wrapping the CoverPicker make ORCH-0888 unnecessary? Probably YES on iOS+Android — the library lifts the search input above the keyboard via padding, which is exactly what InputAccessoryView achieves via a different mechanism. If TRUE, ORCH-0892-A supersedes ORCH-0888 entirely; the operator should hold ORCH-0888 implementation until ORCH-0892-A pilot proves the library handles CoverPicker.
**Recommendation:** PAUSE ORCH-0888 implementor dispatch until ORCH-0892-A pilot result is known. Add CoverPicker to the 3-screen pilot in ORCH-0892-A so the question is answered empirically.

### Carve-out CO-5 — Desktop-web contracts (the 16 from `feedback_mingla_business_desktop_web_contracts.md`)

**Files:** All 9 files listed in that memory's "Files to inspect-but-preserve" section.
**Why protected:** post-ORCH-0885-A baseline + parallel Codex iteration shipped 16 intentional contracts (compact bezel, four-column lists, fixed/scrolling home, wizard left-rail panes, etc.). The keyboard library MUST NOT regress any of them.
**Cross-surface check:** See §7 below — none of the 16 contracts are keyboard-behaviour contracts; they're layout contracts. Library is web-disabled (§3) → byte-identical desktop-web rendering guaranteed.

---

## §6 — CI gate grammar outline (PROSE, not code)

Per `feedback_strict_grep_registry_pattern.md`: one script + one workflow job. Filename `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs`. Wired into `.github/workflows/strict-grep-mingla-business.yml` as one new job.

**Forbidden patterns (any match → exit 1 with file:line + suggested fix):**

1. **`Keyboard.addListener(...)` outside allowlist.** Regex `Keyboard\s*\.\s*addListener\s*\(\s*['"]?(keyboard(?:Will|Did)(?:Show|Hide))['"]?` matched in `mingla-business/**/*.{ts,tsx}`. Suggested fix in error: "Use `useKeyboardAnimation` from `react-native-keyboard-controller` instead, or wrap the affected ScrollView/View in `<KeyboardAvoidingView from 'react-native-keyboard-controller'>`."

2. **`KeyboardAvoidingView` imported from `'react-native'`.** Regex `from\s*['"]react-native['"]` in the same import statement as `KeyboardAvoidingView`. Suggested fix: "Import `KeyboardAvoidingView` from `'react-native-keyboard-controller'` instead — it's a drop-in replacement with frame-perfect native animation."

3. **`automaticallyAdjustKeyboardInsets`** prop on any JSX element. Suggested fix: "Wrap parent in `<KeyboardAwareScrollView from 'react-native-keyboard-controller'>` — automaticallyAdjustKeyboardInsets is iOS-only and fragile in nested layouts."

**Allowlist mechanism (two layers):**

Layer 1 — hardcoded SAFELIST inside the script:
- `mingla-business/src/components/ui/Sheet.tsx` — primitive owns keyboard for sheet-hosted inputs (Carve-out CO-1)
- `mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx` — fixed-height body shrink for pell (Carve-out CO-2)
- `mingla-business/src/components/marketing/ComposerV2/richEditor.{native.ts,tsx}` — WebView (Carve-out CO-3)
- `mingla-business/src/wrappers/KeyboardRoot.native.tsx` (NEW in ORCH-0892-A) — the actual provider mount

Layer 2 — per-file inline comment exemption: `// orch-strict-grep-allow orch-0892 — <reason>` next to the offending line. Mirrors the existing `// ORCH-0861-OK: <reason>` and `// REALTIME-INERT-OK: ORCH-NNNN` conventions.

**Promotion path (mirrors ORCH-0861 [Sibling ScrollView flexGrow gate]):**
- Phase 1 (ORCH-0892-A close): gate ships as INFORMATIONAL (exit 0 always, prints WARN lines). Allows pilot to ship while sweep happens.
- Phase 2 (ORCH-0892-B close): after sweep, promote to BLOCK (exit 1 on violation). Allowlist locked.

**`test:orch-0892` npm script** added to `mingla-business/package.json` mirroring the existing `test:orch-0885-a` shape: `node ../.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs && npx jest src/wrappers/__tests__/KeyboardRoot.test.tsx`.

---

## §7 — Cross-surface contract impact (the 16 desktop-web contracts)

For each contract from `feedback_mingla_business_desktop_web_contracts.md`, check whether ORCH-0892-A risks regressing it:

| # | Contract (paraphrased) | Risk | Reasoning |
|---|---|---|---|
| 1 | Web-only desktop changes gated via `useResponsiveLayout()` | **SAFE** | ORCH-0892-A doesn't touch responsive gating; library is native-only. |
| 2 | No iOS/Android/mobile regression | **SAFE** with **SMOKE-TEST GATE** | Library REPLACES current keyboard plumbing on iOS/Android. By definition affects mobile. Pilot smoke-test on all 3 pilot screens is the gate. |
| 3 | Desktop content does not bleed into rail | **SAFE** | Library is web-disabled (§3). DesktopCanvas layout unchanged. |
| 4 | Desktop bezel margins (`DESKTOP_BEZEL_MARGIN`) | **SAFE** | Same as #3. |
| 5 | Left rail visible on wide web | **SAFE** | Same as #3. |
| 6 | Top bar with compact top breathing room | **SAFE** | Same as #3. |
| 7 | Hub Events/Experiences/Trips desktop = 4 columns | **SAFE** | Same as #3. |
| 8 | Home top KPI: fixed, 2 columns, compact | **SAFE** | Same as #3. |
| 9 | Home Upcoming title fixed, list scrolls | **SAFE** | Same as #3. |
| 10 | Home Upcoming desktop = 4 columns | **SAFE** | Same as #3. |
| 11 | Active Events KPI compact 2-line | **SAFE** | Same as #3. |
| 12 | Event + Trip wizards desktop = left rail + form pane | **SAFE on web** / **VERIFY on iOS+Android** | The wizards (EventCreatorWizard + TripCreatorWizard) are pilot candidates per §9. The library MUST preserve mobile wizard layout. Pilot smoke-test on iOS sim is the gate. |
| 13 | Desktop wizard hides redundant progress strip | **SAFE** | Wizard render structure unchanged. |
| 14 | Desktop wizard close X in panel header | **SAFE** | Same as #13. |
| 15 | Rail brand mark = official PNG | **SAFE** | Asset unchanged. |
| 16 | Rail active state restrained glass | **SAFE** | Visual style unchanged. |

**Overall verdict: 14 SAFE + 2 SAFE-with-smoke-test (the wizard contracts).** Library is web-disabled per §3, which makes 13 of 16 contracts automatically safe. The two wizard contracts (#2 mobile no-regress + #12 desktop wizard layout) require the pilot smoke-test gate. The four jest commands the memory mandates (`test:orch-0885-a`, `BottomNavWebDesktopPolish`, `wizardDesktopLayout`, `homeKpiPresentation`, `useResponsiveLayout`) must pass post-pilot.

**SPEC requirement:** ORCH-0892-A's pre-close gate runs all 4 desktop-contract jest tests + the new `test:orch-0892` strict-grep gate. If any fail, the close is BLOCKED.

---

## §8 — Risk register

| # | Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|---|
| R-1 | Library throws on web mount (no entry point) crashes business-web-preview + buyer-anon-web | P0 | HIGH if mounted unconditionally; near-zero with `.web.tsx` passthrough | Mirror StripeProviderWrapper pattern (§3). Smoke-test cold-load `localhost:8081/checkout/test-id` in pilot. |
| R-2 | Double-translation when library wraps a Sheet-hosted input (Sheet's translateY + library's padding) | P1 | HIGH if Sheet is migrated | Carve-out CO-1: Sheet primitive keeps its own keyboard logic; library does NOT wrap sheet-hosted inputs. Strict-grep allowlist enforces. |
| R-3 | RichEditor WebView keyboard fight (library doesn't see WebView-internal events) | P1 | MEDIUM if composer is migrated | Carve-out CO-3: composer + richEditor stay out of scope for ORCH-0892-A. |
| R-4 | Reanimated v4 worklet split breaks library import (peer-dep says >=3 but library hasn't validated v4 in their CI matrix as of v1.21.7 release notes I could see) | P1 | MEDIUM | Smoke-test ONE `<KeyboardAvoidingView>` mount in pilot before migrating sweep. If the library's worklets module throws on import, escalate to library issue tracker; fall back to library v1.20.x if needed. |
| R-5 | Dev-build rebuild required → operator workflow disruption | P2 | CERTAIN | Document the rebuild step per `IOS_DEV_BUILD_REBUILD_RUNBOOK.md`. ORCH-0892-A close says "this is NOT EAS-OTA-eligible; you need a dev build rebuild before this code runs on your sim." Single-rebuild cost. |
| R-6 | Library's `<KeyboardAwareScrollView>` triggers the ORCH-0857 ScrollView footgun (wraps ScrollView siblings without `flexGrow: 0`) | P2 | MEDIUM | At SPEC time, audit each pilot screen for sibling ScrollViews per `feedback_rn_scrollview_flex_grow_default_one_silent_footgun.md`. The ORCH-0861 CI gate will WARN if introduced. |
| R-7 | Android `windowSoftInputMode` mismatch — Expo defaults to `adjustResize`; library may assume `adjustNothing` or `adjustPan` for some modes | P2 | LOW | Library claims "identical iOS + Android" via its native module managing softInputMode itself. Pilot smoke-test on Android emulator covers this. No `app.json` `softwareKeyboardLayoutMode` setting present today → Expo default applies. |
| R-8 | Stripe PaymentSheet keyboard interaction (PaymentSheet has its own iOS keyboard handling) | P2 | LOW | StripeProviderWrapper is OUTSIDE the proposed KeyboardRoot — payment screens that mount Stripe Card Element still get Stripe's own keyboard avoidance. The 5 checkout screens that ALSO have email/phone inputs would use the library + Stripe's keyboard handling SEPARATELY (different inputs, no overlap). |
| R-9 | Bundle size increase on web (`react-native-keyboard-controller` JS shim if Metro pulls it in despite the passthrough) | P3 | LOW | The `.web.tsx` passthrough means Metro never imports the native module on web. Verify in pilot by inspecting the web export bundle for `react-native-keyboard-controller` strings (should be zero). |
| R-10 | ORCH-0888 + ORCH-0892-A scope collision: if both ship independently, ORCH-0888's InputAccessoryView fix + ORCH-0892's KeyboardAvoidingView wrap may interact in undefined ways | P1 | CERTAIN if both ship without coordination | Pause ORCH-0888 implementor dispatch until ORCH-0892-A pilot result is known. Operator decides whether to ship ORCH-0888 (if pilot doesn't fix CoverPicker) or supersede it (if pilot does). See §10 Q1. |

---

## §9 — Sub-ORCH decomposition recommendation

### Recommended split: ORCH-0892-A → ORCH-0892-B → ORCH-0892-C

**ORCH-0892-A — Install + root wrap + 3-screen pilot.**
- **Files:** ~10 (install adds 2 to package.json + lock; add `KeyboardRoot.{tsx,native.tsx}` 2 files; modify `_layout.tsx` 1 file; migrate 3 pilot screens — BrandEditView (clean KAV swap), TripBrandWizard (clean KAV swap), CoverPicker (also resolves ORCH-0888 if pilot succeeds) — 3 files; new pilot smoke-test 1-2 jest files)
- **Scope:** Prove the library installs cleanly, mounts via `.web.tsx` gating without crashing web/buyer-anon-web, replaces the bespoke plumbing on 3 representative screens (one pure-KAV form, one wizard with KAV, one Sheet-adjacent input with the ORCH-0888 bug)
- **EAS OTA eligible:** **NO** — native module → dev build rebuild required per `IOS_DEV_BUILD_REBUILD_RUNBOOK.md`. Operator runs the rebuild recipe before testing.
- **Pre-merge gate:** all 4 desktop-contract jest tests + new pilot test + tsc clean + operator iOS sim live-fire + Android emulator live-fire + Chrome web live-fire (3 surfaces)
- **Coordination:** PAUSE ORCH-0888 implementor dispatch. ORCH-0892-A close determines whether ORCH-0888 ships or supersedes.

**ORCH-0892-B — Sweep the remaining ~24 screens + delete bespoke plumbing.**
- **Files:** ~25 (every Keyboard.addListener / KeyboardAvoidingView / automaticallyAdjustKeyboardInsets site EXCEPT the 4 carve-outs) + composer-carve-out documentation note
- **Scope:** Mechanical sweep — replace each pattern with the library's primitive, delete the bespoke listener + paddingBottom code, leave Sheet/CoverPicker (now in library)/ComposerV2/richEditor untouched
- **EAS OTA eligible:** **YES** (no native module change; just JS swaps)
- **Pre-merge gate:** same 4 jest tests + tsc clean + operator iOS sim + Android emulator smoke on 5–10 sampled screens (NOT every one — pilot covers the primitive validation; sweep is mechanical)
- **Strict-grep CI gate:** ships as INFORMATIONAL (exit 0)

**ORCH-0892-C — Promote strict-grep CI gate to BLOCK + final sweep audit.**
- **Files:** 1 (`.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` — exit-code change + allowlist lock)
- **Scope:** Flip the gate from WARN to BLOCK; document allowlist; add INVARIANT_REGISTRY entry I-PROPOSED-KEYBOARD-LIBRARY-ONLY
- **EAS OTA eligible:** **N/A** (CI-only — BACKFILL-EXEMPT per orchestrator close protocol)
- **Pre-merge gate:** the gate's own self-test (clean fixture exit 0; violation fixture exit 1; allowlist fixture exit 0)

### Alternative considered + rejected: single ORCH

**Why rejected:** A single ~35-file ORCH violates the operator's standing preference for narrow scope per `feedback_one_pr_per_close.md` (one PR per CLOSE, narrow exception only when bundled is operator-authorized). The library install + pilot is a genuine pre-requisite for the sweep (we don't know the library works on this stack until 3 screens prove it), and the sweep + CI gate are mechanically independent. The 3-ORCH split also gives the operator a kill switch after ORCH-0892-A if the pilot surfaces a real blocker.

### Alternative considered + rejected: bundle A + B

**Why rejected:** Sweep can't ship until the install works. Bundling forces atomic ship of both — which means if the sweep introduces a regression on screen #18 of 24, the install also rolls back. Atomic rollback of the install means the dev clients need ANOTHER rebuild. Separation lets the install land once and stay.

---

## §10 — Open questions for operator before SPEC

**Q1 — ORCH-0888 sequencing (HARD path-fork, MUST answer before ORCH-0892-A SPEC):**

ORCH-0888 [Fabric breaks legacy ScrollResponder; InputAccessoryView for CoverPicker search] is registered as "INVESTIGATION + SPEC COMPLETE, IMPLEMENTOR DISPATCH READY" per the WORLD_MAP entry. Its proposed fix is to add an `InputAccessoryView` with `inputAccessoryViewID` on the CoverPicker search TextInput. ORCH-0892-A pilot proposes to instead wrap CoverPicker in the library's `<KeyboardAvoidingView>`, which would achieve the same outcome (search input visible above keyboard) via a DIFFERENT mechanism. The two fixes serve the same need.

Three options:
- **(A) Pause ORCH-0888, do ORCH-0892-A first.** If pilot fixes CoverPicker via the library, supersede ORCH-0888 entirely. If pilot does NOT fix CoverPicker (library doesn't handle the specific search-bar-over-keyboard case), ORCH-0888 ships separately afterward.
- **(B) Ship ORCH-0888 first** (Codex implementor, ~1 day), then ORCH-0892-A migrates everything ELSE + leaves CoverPicker's InputAccessoryView intact as a fourth carve-out.
- **(C) Ship both in parallel** and accept the risk that the two fixes interact in undefined ways (NOT recommended; covered as R-10 in §8).

**Forensics recommendation: option A.** The library is the longer-term solution; ORCH-0888 is a one-off patch. Test the library against the harder case (CoverPicker) up front; if it works, we save a separate ORCH; if it fails, we ship ORCH-0888 in 1 day and shrink ORCH-0892-A's scope.

**Q2 — Pilot screen selection.** §9 proposes BrandEditView (clean KAV swap) + TripBrandWizard (clean KAV swap) + CoverPicker (Sheet-adjacent, ORCH-0888 coordination). Operator may swap CoverPicker for a SIMPLER 3rd pilot (e.g., `app/account/edit-profile.tsx`) if the ORCH-0888 coordination is too noisy for ORCH-0892-A. Recommendation: keep CoverPicker — it's the highest-value test of "does the library handle the hardest case we have right now."

**Q3 — Web behaviour verification level.** §3 recommends `.web.tsx` passthrough as the safest gating. Operator could alternatively go with the runtime `if (Platform.OS === 'web') return <>{children}</>` pattern, which is one file instead of two. Trade-off: `.web.tsx` is Metro-static (zero web bundle cost); runtime gate is one file but adds the `require()` of the native module into the web bundle (small bundle bloat). Recommendation: `.web.tsx` for parity with StripeProviderWrapper.

**Q4 — Composer migration deferral.** Carve-out CO-2 keeps ComposerV2Editor's custom shrink-on-keyboard mechanism. Operator could decide to EITHER (a) include composer in ORCH-0892-B sweep (using the library's `useReanimatedKeyboardAnimation` hook to drive the body-height calc — cosmetic upgrade), OR (b) defer to ORCH-0892-D as a separate cleanup ORCH. Recommendation: defer to 0892-D. Composer is dirty in working tree right now (ORCH-0891 [composer chip DOM contract] in progress); touching it during 0892-B sweep would collide.

**Q5 — `app-mobile/` port timing.** This ORCH is explicitly mingla-business-only per operator's INTAKE decision. Once 0892-A+B+C land cleanly, when does `app-mobile/` get the same treatment? Recommendation: register as ORCH-0892-E [Port keyboard-controller to app-mobile] after the mingla-business sweep is fully live for 1+ week and operator has 5+ days of clean signal. Don't commit a date in this dispatch.

---

## §11 — Confidence levels per major finding

| Finding | Confidence | Reasoning |
|---|---|---|
| Library v1.21.7 compatible with RN 0.81.5 + Reanimated 4.1.1 + Fabric | **HIGH** | Peer-dep math is direct evidence; FabricExample folder confirms Fabric path. |
| Library requires `Platform.OS` web gating | **HIGH** | Package.json has no web entry; docs are silent; this is hard evidence. Verifying the EXACT failure mode (warn vs throw) is **MEDIUM** confidence — pilot captures it. |
| Sheet primitive must be carved out (Carve-out CO-1) | **HIGH** | Direct read of Sheet.tsx; explicit ORCH-0884 #3 codification; double-translation is mechanical. |
| ComposerV2Editor must be carved out (Carve-out CO-2) | **HIGH** | Direct read + inline source comment explicitly rules out KAV. |
| RichEditor WebView carve-out (Carve-out CO-3) | **MEDIUM-HIGH** | Architectural reasoning is sound; the richEditor files are DIRTY in working tree (not read in full this dispatch); SPEC must read richEditor.{tsx,native.ts} in full to confirm no surprises. |
| CoverPicker library wrap fixes ORCH-0888 case | **MEDIUM** | High likelihood based on library's design (KeyboardAvoidingView is designed exactly for "input above keyboard"), but UNVERIFIED in this codebase. Pilot is the verification. |
| Full inventory of 27+ surfaces | **HIGH** | grep is mechanical; only ambiguity is which of the ~31 listed surfaces also exist in DIRTY uncommitted state (a few files in `git status` may have keyboard plumbing added/removed). SPEC re-greps post-commit baseline. |
| Risk register coverage | **HIGH** for R-1 through R-6; **MEDIUM** for R-7 through R-10 | Lower-confidence risks are not blockers — they're verification-gates. |
| Sub-ORCH split A→B→C is right | **HIGH** | Matches the operator's `one-pr-per-close` preference + provides natural kill switches; the alternatives are demonstrably worse. |
| `react-native-keyboard-controller` is THE right library (vs alternatives) | **MEDIUM-HIGH** | The community-converged answer for modern RN; 3.6k stars + MIT + maintained (May 2026 release) is strong. Investigation did NOT evaluate Tamagui's keyboard primitive or a from-scratch in-house centralized hook — operator pre-locked the library at INTAKE. Operator may override at SPEC time. |

---

## Discoveries for orchestrator (non-blocking)

- **DISC-0892-1:** ORCH-0888 SPEC file is NOT on disk under the WORLD_MAP-cited path (`Mingla_Artifacts/specs/SPEC_ORCH-0888_INPUT_ACCESSORY_VIEW_FOR_COVER_PICKER_SEARCH.md`). `find Mingla_Artifacts -iname "*0888*"` returns zero results. The WORLD_MAP narrative may be ahead of the artifact write, or the file may have been created under a different name. Recommend orchestrator audits the ORCH-0888 artifact set before any ORCH-0892 SPEC dispatch.
- **DISC-0892-2:** ORCH-0884 follow-up reports are also not findable on disk (`find Mingla_Artifacts -iname "*0884*"` returns zero). Knowledge of follow-ups #3–#9 came entirely from git log + inline source comments. The five follow-up commits (`42fb9e0e` through `16f6d90a`) shipped without independent artifact tracking. Recommend orchestrator either (a) backfill artifacts retroactively, or (b) ratify the missing-artifact pattern as acceptable for sub-ORCH follow-ups.
- **DISC-0892-3:** Working tree is heavily dirty (~30 modified files + multiple ORCH-0889/0891 strict-grep gates uncommitted). EventCreatorWizard / TripCreatorWizard / ComposerV2Editor / richEditor are all DIRTY — meaning the inventory in §4 may shift slightly between this report and SPEC time. SPEC must re-grep the post-commit baseline before locking the surface list.
- **DISC-0892-4:** `BusinessWelcomeScreen.tsx:268-271` uses `keyboardDidShow`/`keyboardDidHide` directly without the iOS `keyboardWillShow`/`keyboardWillHide` branch the rest of the codebase uses. Minor inconsistency; subsumed by ORCH-0892-B sweep but worth noting independently as a small Cycle-3-pattern drift.
- **DISC-0892-5:** `app/account/delete.tsx:105-108` and `app/account/edit-profile.tsx:115-118` have the same Cycle-3-drift as DISC-4. Subsumed by sweep.
- **DISC-0892-6:** The library has primitives `OverKeyboardView`, `KeyboardBackgroundView`, `KeyboardExtender`, `KeyboardChatScrollView` that are NOT used in the recommended migration but represent FUTURE opportunity — e.g., `OverKeyboardView` could replace the Sheet primitive's translateY mechanism in a future ORCH-0892-D cleanup. Not in scope for A/B/C, but worth noting.

---

## Layman summary of the report

- **Library `react-native-keyboard-controller` IS compatible with our stack** (Expo 54, RN 0.81, Reanimated 4, Fabric ON). No version bumps needed.
- **BUT it does NOT work on web** (no web entry point in the package). We need a `Platform.OS === 'web'` gate at the root layout — mirroring the existing StripeProviderWrapper pattern.
- **We have 27+ surfaces with bespoke keyboard plumbing today**, in THREE distinct patterns (Cycle 3 wizard listener + KAV + iOS auto-insets), often layered together on the same screen. Library replaces all three with one primitive.
- **4 surfaces MUST be carved out**: Sheet primitive (owns sheet-hosted input avoidance), ComposerV2Editor (fixed-height body for pell), pell richEditor WebView (isolated keyboard sandbox), CoverPicker (coordination with ORCH-0888 fix).
- **Recommend 3 sub-ORCHs**: 0892-A = install + 3-screen pilot (no EAS OTA — needs dev build rebuild); 0892-B = sweep remaining ~24 screens; 0892-C = promote CI gate from WARN to BLOCK.
- **One operator decision needed before SPEC**: ORCH-0888 sequencing — pause it and let ORCH-0892-A try to supersede it, or ship ORCH-0888 first. Recommended: pause and supersede (option A).
- **Top risks**: web crash if mounted without gate (mitigated by `.web.tsx` passthrough); Reanimated v4 worklet split (mitigated by pilot smoke-test before sweep); ORCH-0888 collision (mitigated by sequencing).
- **Confidence**: HIGH on library compat + carve-outs + sub-ORCH split; MEDIUM on whether library specifically fixes the CoverPicker ORCH-0888 case (pilot is the test).
- **Honest gap**: investigation was source-only by dispatch design (no sim repro mandated; this is an architectural brainstorm). RichEditor WebView details not read in full; SPEC must close that gap.
