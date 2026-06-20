# SPEC AMENDMENT — ORCH-1165 [Business app keyboard "Done" accessory bar] — COMPLETE at-risk inventory

**Phase:** SPEC AMENDMENT (mingla-forensics). Strict **superset** of `SPEC_ORCH-1165_BUSINESS_KEYBOARD_DONE_BAR.md` (same folder). Relaxes nothing; adds the surfaces the original SPEC's §4.6 6-row list missed.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1165-[business-keyboard-done-bar]/` on branch `ORCH-1165-business-keyboard-done-bar`. Implementation @ `e41f68dee`, TEST verdict FAIL @ `d2f7e2170`.
**Why this exists:** TEST (`QA_ORCH-1165_…md`) proved the original SPEC's core assumption WRONG — "everything not in the 6-row list is auto-fixed by `SmartScrollView` 12→54" did not hold, because the app-wide 42pt Done bar mounts at the app ROOT (`app/_layout.tsx`) and therefore overlays EVERY bespoke `Keyboard.addListener`/`KeyboardAvoidingView` site that bypasses `SmartScrollView` — not just the `keyboardVerticalOffset` composers. The Ari chat composer (`AriChatScreen.tsx:325-330`, `keyboardHeight + spacing.sm`, ~8pt < 42pt) was occluded on-device (P1, `proven`). The defect class is an INCOMPLETE blast-radius audit. This amendment makes it COMPLETE.
**Scope (HARD, unchanged):** `mingla-business/` ONLY, iOS + Android. NO `app-mobile/`, NO buyer-web, NO admin-web. Library-only fix (orch-0892 gate stays green).

---

## A1. Method of the complete re-sweep (evidence trail)

Swept `mingla-business/src/**` AND `mingla-business/app/**` for every keyboard-avoidance pattern:

```
# bespoke raw-API listeners feeding a manual layout value
grep -rnE "Keyboard\.addListener|keyboardDidShow|keyboardWillShow|keyboardDidHide|keyboardWillHide" src/ app/
# KeyboardAvoidingView (any source) + its keyboardVerticalOffset
grep -rnE "KeyboardAvoidingView|keyboardVerticalOffset" src/ app/
# library height/visibility hooks + reanimated/sticky primitives
grep -rnE "useKeyboard|useReanimatedKeyboard|useAnimatedKeyboard|useKeyboardHandler|KeyboardStickyView|KeyboardGestureArea" src/ app/
# bottom-sheet inputs
grep -rnE "BottomSheetTextInput" src/ app/
# per-instance bottomOffset overrides that could defeat the 12->54 auto-fix
grep -rnE "bottomOffset" src/ app/
# who is genuinely SmartScrollView-backed
grep -rlE "from .*wrappers/SmartScrollView" src/ app/
```

Then read each hit's input-container JSX verbatim and classified by whether the focused input's keyboard avoidance is owned by `SmartScrollView`/`KeyboardAwareScrollView` (→ auto-fixed by the already-shipped `DEFAULT_BOTTOM_OFFSET=54`) or by bespoke plumbing (→ must be individually patched).

**Decisive architecture facts established (verbatim-read):**
- `SmartScrollView.native.tsx` already exports `DEFAULT_BOTTOM_OFFSET = 54` (`= 12 clearance + 42 toolbar`). Every consumer that renders `<ScrollView>` from this wrapper **without** a per-instance `bottomOffset` is auto-fixed.
- **Zero non-comment `bottomOffset` overrides exist** across 37 SmartScrollView-consuming files (the single `bottomOffset` grep hit, `TripCreatorWizard.tsx:1205`, is a code COMMENT). → no SmartScrollView surface defeats the 54 auto-fix.
- `useKeyboardIsVisible()` returns a **boolean only** (`useKeyboardState().isVisible`), never a height — so the wizards that use it for dock-hide UX still rely on `SmartScrollView` for actual avoidance. It is NOT a manual-padding source.
- The orch-0892 gate's `Keyboard.addListener` regex only matches a **string-literal** event (`addListener("keyboardWillShow"…)`). Ari + all 7 checkout forms pass the event via a `showEvent` **variable**, so they are invisible to the gate. **Adding `+42` to a numeric padding term in these files changes nothing the gate inspects → gate stays green, no new safelist entries needed for the +42 patches.** (Confirmed: `node .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` → EXIT 0, 840 files, 0 violations, on the current implementation.)

---

## A2. The COMPLETE at-risk table (SUPERSEDES SPEC §4.6's 6-row list)

Every business-app surface whose keyboard avoidance is NOT owned by SmartScrollView. The +42 is **always keyed on keyboard-open** (`keyboardHeight > 0` / `keyboardPadding > 0` / `keyboardVisible` / `keyboardVerticalOffset` on an open-keyboard avoider) — never a permanent dead gap, never the web branch, never the keyboard-closed branch.

Legend — **Status**: `PATCHED` = already correctly fixed in impl @ `e41f68dee` (re-verified this sweep); `DEFECT` = the proven P1; `NEW-REWORK` = must be patched by this amendment.

| # | Surface | File:line | Mechanism | Current expr (verbatim) | At-risk? | EXACT +42 patch (keyed on keyboard-open) | Status |
|---|---------|-----------|-----------|--------------------------|----------|-------------------------------------------|--------|
| 1 | Ari chat composer | `src/screens/ari/AriChatScreen.tsx:329` | raw `Keyboard.addListener` → manual `paddingBottom` (bottom-pinned composer) | `? keyboardHeight + spacing.sm` (≈8pt) `: Math.max(insets.bottom, spacing.md) + BOTTOM_NAV_CLEARANCE_PX` | **YES (proven, P1)** | keyboard-open branch only → `? keyboardHeight + spacing.sm + 42`. Leave the web branch (`Platform.OS === "web" ? spacing.sm`) and the closed branch untouched. | **DEFECT** |
| 2 | Event checkout — buyer details | `app/checkout/[eventId]/buyer.tsx:423` | raw listener → plain `ScrollView` `contentContainerStyle` padding (scrollable, dock hides on open) | `keyboardHeight > 0 ? { paddingBottom: keyboardHeight + 140 } : null` | YES (low — 140pt headroom usually clears, but `scrollToEnd` can land a field in the bottom 42pt on short viewports) | `keyboardHeight + 140 + 42` (in the `> 0` branch only). | **NEW-REWORK** |
| 3 | Event checkout — payment | `app/checkout/[eventId]/payment.tsx:629` | same as #2 | `keyboardHeight > 0 ? { paddingBottom: keyboardHeight + 140 } : null` | YES (low) | `keyboardHeight + 140 + 42` (`> 0` branch only). | **NEW-REWORK** |
| 4 | Trip checkout — buyer details | `app/checkout-trip/[tripEventId]/buyer.tsx:455` | same as #2 | `keyboardHeight > 0 ? { paddingBottom: keyboardHeight + 140 } : null` | YES (low) | `keyboardHeight + 140 + 42` (`> 0` branch only). | **NEW-REWORK** |
| 5 | Trip checkout — intake form | `app/checkout-trip/[tripEventId]/intake.tsx:468` | raw listener → plain `ScrollView` padding (dock hidden when keyboard up) | `keyboardHeight > 0 ? { paddingBottom: keyboardHeight + spacing.xl } : { paddingBottom: insets.bottom + 120 }` | **YES (higher)** — `spacing.xl` (≈24–32pt) `< 42`; a bottom IntakeFormRenderer field lands inside the bar zone | keyboard-open branch only → `keyboardHeight + spacing.xl + 42`. | **NEW-REWORK** |
| 6 | Trip checkout — payment | `app/checkout-trip/[tripEventId]/payment.tsx:633` | same as #2 (plan-aware padding) | `keyboardHeight > 0 ? { paddingBottom: keyboardHeight + (isPlanActive ? 260 : 140) }` | YES (low) | `keyboardHeight + (isPlanActive ? 260 : 140) + 42` (`> 0` branch only). | **NEW-REWORK** |
| 7 | Experience checkout — buyer details | `app/checkout-experience/[experienceEventId]/buyer.tsx:362` | same as #2 | `keyboardHeight > 0 ? { paddingBottom: keyboardHeight + 140 } : null` | YES (low) | `keyboardHeight + 140 + 42` (`> 0` branch only). | **NEW-REWORK** |
| 8 | Experience checkout — payment | `app/checkout-experience/[experienceEventId]/payment.tsx:537` | same as #2 | `keyboardHeight > 0 ? { paddingBottom: keyboardHeight + 140 } : null` | YES (low) | `keyboardHeight + 140 + 42` (`> 0` branch only). | **NEW-REWORK** |
| 9 | Paystack bank-picker modal (NIGERIA payout onboarding) | `src/components/brand/BrandPaystackOnboardView.tsx:258-260` | library `KeyboardAvoidingView` with **NO `keyboardVerticalOffset`** (defaults to 0); bottom-anchored modal sheet (`modalRoot: justifyContent:"flex-end"`, `sheet: height "64%"`); `autoFocus` search Input at sheet top + `flex:1` bank list below | `<KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>` (no offset) | **YES (NEWLY FOUND — not in SPEC, not in QA)** — with offset 0 the sheet bottom lands exactly at the keyboard top, so the Done bar overlays the bottom ~42pt of the bank-list ScrollView (bottom rows become un-tappable / partially hidden). The focused search Input itself sits at the sheet top so is not hidden, but content occlusion = same defect class. | add `keyboardVerticalOffset={42}` to the `<KeyboardAvoidingView>` (matches the §4.6(e) GroupChat/Support fix exactly). Keyboard-open is implicit — KAV only pads when the keyboard is up. | **NEW-REWORK** |
| 10 | Waitlist sheet | `src/components/waitlist/JoinWaitlistSheet.tsx:154` | raw listener → manual `paddingBottom` (Modal-host sheet) | `keyboardPadding + spacing.lg + (keyboardPadding > 0 ? 42 : 0)` | YES | already `+42` keyed on `keyboardPadding > 0`. | **PATCHED** ✓ |
| 11 | Business sign-in / welcome | `src/components/auth/BusinessWelcomeScreen.tsx:580` | raw listener → manual `paddingBottom` (bottom action zone) | `… + (keyboardPad > 0 ? keyboardPad + 42 : 0)` | YES | already `+42` keyed on `keyboardPad > 0`. | **PATCHED** ✓ |
| 12 | Experience creator wizard | `src/components/experience/ExperienceCreatorWizard.tsx:737` | bare `ScrollView` + `useKeyboardIsVisible()` padding | `keyboardVisible ? { paddingBottom: spacing.lg + 42 } : null` | YES | already `+42` keyed on `keyboardVisible`. | **PATCHED** ✓ |
| 13 | Brand creation flow | `src/components/brand/BrandCreationFlow.tsx:511` | bare `ScrollView` + `useKeyboardIsVisible()` padding | `keyboardVisible ? { paddingBottom: spacing.lg + 42 } : null` | YES | already `+42` keyed on `keyboardVisible`. | **PATCHED** ✓ |
| 14 | Group-chat composer | `src/components/groupChat/GroupChatPanel.tsx:230` | library `KeyboardAvoidingView` | `keyboardVerticalOffset={42}` | YES | already `={42}` (was 0). | **PATCHED** ✓ |
| 15 | Support-thread composer | `src/components/support/SupportThread.native.tsx:26` | library `KeyboardAvoidingView` (shared wrapper for `SupportThreadCore`) | `keyboardVerticalOffset={42}` | YES | already `={42}` (was 0). | **PATCHED** ✓ |
| 16 | Marketing ComposerV2 editor | `src/components/marketing/ComposerV2/ComposerV2Editor.tsx:201` | raw listener → fixed-height body shrink from keyboard frame | `const keyboardShrink = keyboardHeight > 0 ? keyboardHeight + 42 : 0;` | YES | already `+42` keyed on `keyboardHeight > 0`. | **PATCHED** ✓ |

**Total at-risk surfaces: 16** (rows 1–16). Of these: **7 already PATCHED** (the original SPEC §4.6 "6" — where the (e) entry was the GroupChat **+** Support pair, i.e. 7 physical sites), **1 DEFECT** (Ari), **8 NEW-REWORK** (7 checkout forms + BrandPaystackOnboardView).

**Net new work introduced by this amendment beyond the original SPEC = 9 sites** (Ari + 7 checkout + BrandPaystackOnboardView).

> Note on the checkout "low" rows (#2/#3/#4/#6/#7/#8): they carry 140–260pt of keyboard-open padding and fire `scrollToEnd` on focus, so on a normal viewport the focused field clears the bar. The +42 is applied for **guaranteed** clearance + consistency with the keyed-on-open contract (the dock already hides on keyboard-open via `styles.bottomBarHidden`, so the extra 42pt is invisible when the keyboard is closed). Row #5 (intake) is the genuinely-tight one (`spacing.xl` < 42) and is the must-fix among the checkout set.

---

## A3. Per-surface confirmation that NO SmartScrollView-backed surface needs a patch (CONFIRM-OR-CORRECT of the original SPEC's claim)

The original SPEC assumed every non-listed surface is auto-fixed by `SmartScrollView` 12→54. **CONFIRMED for all genuinely SmartScrollView-backed surfaces; CORRECTED only for the bespoke sites enumerated in A2.** Verified per-surface (read the input wrapper JSX, not just the import):

| Surface | Backing | Verdict |
|---------|---------|---------|
| Event / Trip / Rsvp / Venue **creator wizards** (`EventCreatorWizard.tsx:865`, `TripCreatorWizard.tsx:1209`, `RsvpCreatorWizard.tsx:794`, `VenueCreatorWizard.tsx:314/762`) | `<ScrollView>` from SmartScrollView, **no** `bottomOffset` override | **SAFE — auto-fixed by 54.** (SC-1/3 proven on the Event wizard on-device.) |
| `EditPublishedScreen.tsx`, `EditPublishedTripScreen.tsx` | SmartScrollView, no override | SAFE |
| `app/venue/create.tsx:218`, `app/(tabs)/marketing/campaigns/compose.tsx`, `app/(tabs)/marketing/templates/[id].tsx:355` | SmartScrollView (their KAV grep hits were unused imports / type comments — inputs are inside SmartScrollView) | SAFE |
| `BrandEditView.tsx:451`, `TemplateEditor.tsx` (wrapped by its route's SmartScrollView), `SupportThreadCore.tsx:226` | SmartScrollView | SAFE |
| All sheet bodies on SmartScrollView (`TicketTierEditSheet`, `RefundSheet`, `DoorSaleNewSheet`, `AddCompGuestSheet`, `InviteBrandMemberSheet`, `CoverPickerSheet`, `IntakeQuestionEditor`, `MultiDateOverrideSheet`, etc. — 37 importers total) | SmartScrollView, **zero** `bottomOffset` overrides found | SAFE — auto-fixed by 54 |
| `app/account/edit-profile.tsx`, `app/account/delete.tsx`, `app/booking/[orderId]/cancel.tsx`, `app/event/[id]/guests/[guestId].tsx`, `AriSettingsScreen.tsx` | SmartScrollView | SAFE |
| `src/components/ari/InputBar.tsx` | no avoidance of its own — delegates to its **parent** (`AriChatScreen`) | covered transitively by patching #1 (Ari). No edit to InputBar. |
| `src/components/event/types.ts:82` | KAV appears in a **COMMENT only**; type-definition file, no inputs | SAFE (false positive) |

No SmartScrollView-backed surface needs a patch. The only corrections to the original "auto-fixed" assumption are exactly the bespoke sites in A2 (which bypass SmartScrollView).

---

## A4. EXPANDED scoped allowlist (implementor may edit ONLY these)

= the original SPEC's 15 + every NEW-REWORK / DEFECT file from A2. **Strict superset; nothing removed.**

**Original 15 (carried unchanged):**
1. `mingla-business/src/wrappers/KeyboardToolbarRoot.native.tsx`
2. `mingla-business/src/wrappers/KeyboardToolbarRoot.tsx`
3. `mingla-business/app/_layout.tsx`
4. `mingla-business/src/wrappers/SmartScrollView.native.tsx`
5. `mingla-business/src/components/ui/SheetMobile.tsx`
6. `mingla-business/src/components/ui/Modal.tsx`
7. `mingla-business/src/components/waitlist/JoinWaitlistSheet.tsx`
8. `mingla-business/src/components/auth/BusinessWelcomeScreen.tsx`
9. `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx`
10. `mingla-business/src/components/brand/BrandCreationFlow.tsx`
11. `mingla-business/src/components/groupChat/GroupChatPanel.tsx`
12. `mingla-business/src/components/support/SupportThread.native.tsx`
13. `mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx`
14. `.github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs`
15. `mingla-business/src/wrappers/__tests__/orch_1165_keyboard_toolbar_clearance.test.ts`

**ADDED by this amendment (9 files):**
16. `mingla-business/src/screens/ari/AriChatScreen.tsx` — `:329` keyboard-open branch `+ 42` (the DEFECT)
17. `mingla-business/app/checkout/[eventId]/buyer.tsx` — `:423` `+ 42`
18. `mingla-business/app/checkout/[eventId]/payment.tsx` — `:629` `+ 42`
19. `mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx` — `:455` `+ 42`
20. `mingla-business/app/checkout-trip/[tripEventId]/intake.tsx` — `:468` `+ 42` (the tight one)
21. `mingla-business/app/checkout-trip/[tripEventId]/payment.tsx` — `:633` `+ 42`
22. `mingla-business/app/checkout-experience/[experienceEventId]/buyer.tsx` — `:362` `+ 42`
23. `mingla-business/app/checkout-experience/[experienceEventId]/payment.tsx` — `:537` `+ 42`
24. `mingla-business/src/components/brand/BrandPaystackOnboardView.tsx` — `:258-260` add `keyboardVerticalOffset={42}` (NEWLY FOUND)

> Each of #16–#23 already contains a `Keyboard.addListener` invisible to the orch-0892 gate (variable-passed event) — adding `+42` to a numeric padding term does NOT introduce a new forbidden pattern, so **no new orch-0892 safelist/inline-allowlist entry is required** for these. #24 imports KAV from the LIBRARY (allowed). The gate stays green with the existing safelist.

---

## A5. Updated success criteria (SUPERSEDES SPEC §5; SC-3 now enumerates EVERY at-risk surface)

All original SCs (SC-1…SC-7) carry forward unchanged EXCEPT **SC-3 and SC-4 are replaced** below. No existing guard relaxed.

- **SC-3 (THE regression gate — iOS + Android, EVERY at-risk surface):** With the keyboard open on each surface below, the focused field/composer is **fully visible above the Done bar** (≥ ~12pt gap between field bottom and toolbar top); no part of any input or its immediately-adjacent tappable content is occluded by the 42pt bar. **Surfaces to prove (ALL of A2 rows 1–16):**
  1. **Ari composer** (`AriChatScreen`) — type into "Ask Ari…", text fully visible above the bar (the exact P1 repro must now PASS). **[was missing — now mandatory]**
  2. Event checkout — buyer + payment forms
  3. Trip checkout — buyer + **intake** (the tight one) + payment forms
  4. Experience checkout — buyer + payment forms
  5. **Paystack bank-picker modal** (`BrandPaystackOnboardView`) — open from Nigeria payout onboarding; search Input + bottom bank-list rows reachable above the bar **[newly found — mandatory]**
  6. Event/Trip/Rsvp/Venue creator wizard fields (SmartScrollView — auto-fixed; spot-check at least Trip + one other beyond the already-proven Event)
  7. JoinWaitlistSheet · BusinessWelcomeScreen sign-in · ExperienceCreatorWizard last field · BrandCreationFlow · GroupChat composer · Support composer · ComposerV2 editor
- **SC-4 (sheet + Modal hosts — DRIVEN ON DEVICE this pass, no longer source-only):** The toolbar appears over **sheet** inputs and **Modal** inputs, AND those inputs are not occluded:
  - **SC-4a (Sheet):** open a sheet text-input — **TicketTierEditSheet** (or AddCompGuestSheet) — focus it; the Done bar floats over the sheet and the field clears it. **Must be driven on the physical device** (DISC-1165-T2: this was the highest-risk visual claim and was runtime-unverified last pass).
  - **SC-4b (Modal):** open **CancelOrderDialog** (`Modal.tsx` host), focus the reason field; the Done bar floats over the Modal and the field clears it. **Must be driven on the physical device** (was only source-asserted before).
- **All other SCs unchanged.** SC-1/SC-2/SC-6 (Done-only, brand-orange `#eb7825`, dismiss) already proven on the Event wizard; SC-5 (web null) / SC-7 (gate PASS) carry forward.

---

## A6. Hard retest directives (additive to SPEC §11)

1. **SC-4 MUST be driven ON DEVICE this pass.** Last pass it was source-asserted only (DISC-1165-T2). Drive a real sheet text-input (TicketTierEditSheet) and the CancelOrderDialog Modal input on the Samsung device (and/or iOS sim), focus each, and capture an AFTER screenshot proving the field clears the bar. A `suspected`/source-only verdict on SC-4 is NOT acceptable for CLOSE.
2. **iOS-sim eyeball of the Ari fix is REQUIRED.** The P1 was driven on Android; the path is platform-agnostic but the FIX must be eyeballed once on an iOS sim (boot `iPhone 17 Pro Max`, load this worktree's Metro per `IOS_DEV_BUILD_REBUILD_RUNBOOK.md` — NOT `npx expo run:ios`): focus "Ask Ari…", type, confirm text is fully visible above the bar and no phantom gap on dismiss. Also satisfies OQ-3 (iOS-26 floating-keyboard rounded-bar variant) for the Ari surface.
3. **Re-drive the Ari P1 reproducer to PASS:** the exact `AFTER_android_ari_composer_OCCLUDED_DEFECT.png` scenario must now show typed text fully visible (pair the new AFTER with the existing DEFECT baseline).
4. **Checkout intake (row #5) is the must-drive checkout surface:** it has the tightest clearance (`spacing.xl` < 42). If a live order/cart is hard to stage, drive at minimum the intake form with a bottom-anchored question field.

---

## A7. Fix stays library-only + within mingla-business (confirmations)

- **orch-0892 gate stays GREEN:** ran `node .github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs` on the current impl → **EXIT 0**, 840 files scanned, 8 safelisted, 0 violations. The +42 patches (#16–#23) only mutate numeric padding terms in files whose `Keyboard.addListener` is already invisible to the gate (variable-passed event string), and #24 changes a library-KAV prop — **no new forbidden pattern, no new safelist entry required.** Re-run after implementation to confirm still 0.
- **No bespoke `Keyboard.addListener` for layout is ADDED anywhere** (the four forbidden patterns are untouched; every patched site already had its listener/avoider — we only adjust the offset value). I-PROPOSED-KEYBOARD-LIBRARY-ONLY + I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY preserved.
- **Within mingla-business only:** every A4 file is under `mingla-business/` (+ the one CI gate file already in the original allowlist). NO `app-mobile/`, NO buyer-web (`*.web.tsx` untouched — the web branch of each ternary is explicitly NOT patched), NO admin. The Cross-Surface Declaration (SPEC §3) is unchanged: surfaces 1/2/3/6/7 remain NOT-covered.

---

## A8. Invariants (unchanged + scope note)

- `I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE` (DRAFT) — unchanged; still enforced by the §9 fails-on-revert test (`DEFAULT_BOTTOM_OFFSET >= 42`). This amendment does NOT add a new structural invariant: the bespoke sites are per-screen literals (`+ 42`), not a single owned constant, so they cannot be guarded by one numeric assertion. They are instead guarded by the tester's mount/offset adversarial test (`orch_1165_keyboard_toolbar_mount_coverage.test.ts`) — **extend that test** to assert the `+ 42` (or `keyboardVerticalOffset={42}`) is present and keyed-on-keyboard-open for the 9 newly-added sites (source-regex assertions, fails-on-revert).
- I-PROPOSED-KEYBOARD-LIBRARY-ONLY, I-PROPOSED-SMART-SCROLLVIEW-WRAPPER-ONLY — preserved (A7).

---

## A9. Downstream routing

**Next = mingla-implementor (business side):** apply the 9 NEW-REWORK/DEFECT patches in A2/A4 (#16–#24). Then **extend** `orch_1165_keyboard_toolbar_mount_coverage.test.ts` with source-regex assertions for the 9 new sites (each `+ 42` / `keyboardVerticalOffset={42}` present AND keyed-on-keyboard-open), proven fails-on-revert. Re-run the orch-0892 gate (must stay EXIT 0). Then **mingla-tester** drives the full A5 matrix with the A6 hard directives (SC-3 Ari-must-PASS + all checkout + Paystack modal; SC-4a/SC-4b ON DEVICE; iOS Ari eyeball). Then **mingla-orchestrator** CLOSE (flips `I-PROPOSED-KEYBOARD-TOOLBAR-CLEARANCE` ACTIVE, OTA business dev channel — pure-JS, no native rebuild).

**Stop-and-amend** still binds: touching anything outside the A4 expanded allowlist requires a further amendment.

---

## A10. DO-NOT-TOUCH (carried from SPEC §, reaffirmed)

- `app-mobile/` (entire consumer app — separate leg).
- `mingla-business/src/wrappers/KeyboardRoot.native.tsx` / `.tsx`.
- Any `*.web.tsx` variant / the web branch of every patched ternary (web has no accessory bar — never add 42 to a web branch).
- Public offering pages under COMMS-0040/0041 (`RsvpPublicBody.tsx`, public experience pages) — zero overlap; do not edit. (COMMS-0040/0041 = WARN, acked, no keyboard-UI overlap.)
- Any DB / edge / service / hook / migration.
- The four forbidden strict-grep patterns — do NOT introduce a new bespoke `Keyboard.addListener` for layout.
- `SupportThreadCore.tsx`, `BrandEditView.tsx`, the creator wizards, and all other SmartScrollView-backed surfaces in A3 — they are auto-fixed by 54; do NOT add a redundant `+42` (that would double-pad and create a dead gap).
