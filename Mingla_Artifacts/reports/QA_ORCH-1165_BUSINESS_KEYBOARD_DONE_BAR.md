# QA — ORCH-1165 [Business app keyboard "Done" accessory bar] (BUSINESS LEG)

**Phase:** TEST (mingla-tester, canonical TEST owner).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1165-[business-keyboard-done-bar]/` on branch `ORCH-1165-business-keyboard-done-bar`, implementation @ `e41f68dee`.
**Binding contract:** `Mingla_Artifacts/investigations/SPEC_ORCH-1165_BUSINESS_KEYBOARD_DONE_BAR.md`.
**Runtime:** Samsung Galaxy (`R58R54YV7JT`) — business app `com.sethogieva.minglabusiness`, dev build loading current-branch JS over Metro (8081, this worktree, bundle = 4840 modules, brand "Lantern & Vine", dark theme).

---

## 1. Verdict

**FAIL** — P0: 0 · **P1: 1** · P2: 1 · P3: 0 · P4: 1.

The Done-bar mechanism itself works correctly and beautifully on the surfaces driven (Done-only, brand-orange, dismisses, no occlusion on SmartScrollView wizards). **But the bar mounts app-wide at the root and the spec's at-risk inventory MISSED the Ari chat composer (`AriChatScreen.tsx`)** — a primary business-app screen whose composer is now **fully occluded behind the 42pt Done bar** (proven on device: typed text was completely hidden until the keyboard was dismissed). This is the exact "field hidden behind the taller keyboard" regression Seth flagged. The same code path is platform-agnostic (`keyboardHeight + spacing.sm` for both iOS and Android), so iOS is affected identically by inspection. Unaccepted P1 UI/runtime regression with `proven`-level repro → **FAIL → REWORK**.

Regression gate: SATISFIED (implementor happy-path test fails-on-revert re-run independently; tester adversarial test added on a different angle, on-branch, in-diff, fails-on-revert proven).

---

## 2. SC-by-SC matrix

| SC | Surface | Verdict | Evidence |
|----|---------|---------|----------|
| SC-1 | Android | **PASS (proven)** | Event Creator wizard, "Event name" field focused (EditText bounds [70,799]-[1010,930], `mInputShown=true`) → 42pt **Done-only** bar (no Prev/Next) flush on keyboard top. `AFTER_android_event_wizard_done_bar.png` |
| SC-1 | iOS | **suspected** | No iOS sim driven (see §7); same root mount + library = same render. Capped at suspected per Phase 0.A. |
| SC-2 | Android | **PASS (proven)** | Tapped Done (965,1235) → `mInputShown=false`, keyboard + bar both gone, wizard fully restored. `AFTER_android_done_dismissed.png` |
| SC-2 | iOS | **suspected** | inherited library behavior, not driven |
| SC-3 | Android — Event wizard | **PASS (proven)** | Field rendered with orange focus border fully ABOVE the Done bar, clear gap. `AFTER_android_event_wizard_done_bar.png` |
| SC-3 | Android — **Ari composer** | **FAIL (proven)** | **P1-1.** "Ask Ari…" composer 100% occluded behind Done bar; typed "TestOcclusion" invisible until dismiss. `AFTER_android_ari_composer_OCCLUDED_DEFECT.png`, `AFTER_android_ari_composer_typed_text_hidden.png` |
| SC-3 | Android — Trip/Venue/Rsvp wizards | **suspected (PASS-by-mechanism)** | Same SmartScrollView mechanism as the proven Event wizard (`DEFAULT_BOTTOM_OFFSET=54`); not individually driven |
| SC-3 | Android — GroupChat / Support / ComposerV2 / JoinWaitlist / Welcome / Experience / Brand | **suspected** | Source patches correct + adversarial-test-asserted; not driven on device |
| SC-3 | iOS — all | **suspected / FAIL-Ari** | Ari path is platform-agnostic (`keyboardHeight + spacing.sm`, web-only exempt) → iOS Ari = FAIL by inspection. Others not driven. |
| SC-4 | Sheet + Modal hosts | **suspected** | Mounts present + correct in diff (`SheetMobile.tsx` + `Modal.tsx`, last child of native window) + asserted by tester adversarial test; could not drive a sheet/modal text-input on device this pass (highest-risk visual claim remains runtime-unverified) |
| SC-5 | Web | **PASS (proven, source+precedent)** | `KeyboardToolbarRoot.tsx` returns `null`, library import only in `.native.tsx` (comment-only ref in web file); identical to the proven `KeyboardRoot` split. Full `expo export` web build not run this pass. |
| SC-6 | Android | **PASS (proven)** | Done text renders brand orange `#eb7825` (`accent.warm`), clearly orange on device. `AFTER_android_event_wizard_done_bar.png`, `AFTER_android_ari_composer_OCCLUDED_DEFECT.png` |
| SC-7 | CI | **PASS (proven)** | `orch-0892` gate run: `EXIT 0`, 840 files scanned, 0 violations, `KeyboardToolbarRoot.native.tsx` safelisted |
| OQ-3 | iOS-26 floating kbd | **not assessed** | no iOS sim |

---

## 3. Findings

### P1-1 — Ari chat composer occluded by the Done bar (the exact regression Seth flagged)
- **Evidence:** `src/screens/ari/AriChatScreen.tsx:325-330` — native `paddingBottom = keyboardHeight > 0 ? keyboardHeight + spacing.sm : …`. `spacing.sm` (~8pt) < the 42pt Done bar. The bar mounts at the root (`app/_layout.tsx`) so it overlays the Ari screen, but `AriChatScreen` uses a bespoke `Keyboard.addListener` (L105-119) and was NOT in the spec's §4.6 at-risk list (only `GroupChatPanel` + `SupportThread.native.tsx` were patched). Device proof: typed "TestOcclusion" into "Ask Ari…" with keyboard up → text NOWHERE visible (`AFTER_android_ari_composer_typed_text_hidden.png`); after Done dismiss, the text appeared in the composer (`/tmp/and_now.png`), proving it was hidden behind the bar+keyboard.
- **Impact:** On the Ari tab (a primary, every-brand business-app screen), the user cannot see what they type — composer is behind the orange Done bar. This IS the "field hidden behind the taller keyboard" regression the ORCH was meant to prevent. iOS identical (path is platform-agnostic; web exempt).
- **Root cause:** Spec gap, not implementor deviation. The INVESTIGATE explicitly flagged Ari (`INVESTIGATE_…md` L159/L163: "Ari composer pushed flush to the keyboard top … confirms F-5(e): a 42pt toolbar lands exactly here") but the SPEC §4.6(e) patch covered only the two `keyboardVerticalOffset` composers and omitted `AriChatScreen` (different mechanism — raw `keyboardHeight` padding). The implementor correctly stayed inside the spec allowlist.
- **Required fix:** Add `AriChatScreen.tsx` to the patch set — bump the keyboard-up branch to `keyboardHeight + spacing.sm + 42` (or `+ KEYBOARD_TOOLBAR_HEIGHT`), keyed on `keyboardHeight > 0` only (do NOT add 42 to the closed/web branches). Requires a SPEC_AMENDMENT (AriChatScreen is outside the current allowlist).
- **Retest:** Focus "Ask Ari…", type text with keyboard up → text fully visible above the Done bar with ~12pt clearance; on dismiss, no phantom gap.

### P2-1 — Other unpatched bespoke keyboard sites at risk of the same occlusion
- **Evidence:** `grep "Keyboard.addListener"` over `mingla-business/src` + `app/` returns 8 unpatched native sites beyond the spec's list: `AriChatScreen.tsx` (P1-1 above) plus the buyer-checkout forms `app/checkout/[eventId]/{buyer,payment}.tsx`, `app/checkout-trip/[tripEventId]/{buyer,intake,payment}.tsx`, `app/checkout-experience/[experienceEventId]/{buyer,payment}.tsx`. These compute their own keyboard offset (no +42). On native business app the root Done bar overlays them; on web the bar is null (no risk).
- **Impact:** Any of these checkout forms, if reached in the native business app with a bottom-anchored input, can occlude the focused field. Not driven this pass (checkout requires a live order/cart); lower blast radius than Ari (primary screen).
- **Required fix:** During the P1-1 SPEC_AMENDMENT, audit each `Keyboard.addListener`+padding site for a bottom-anchored input and add +42 where the focused field sits within 42pt of the keyboard top. Several may be auto-safe (scrollable above the keyboard) — verify per site.
- **Retest:** Drive each checkout form on the native business app with keyboard open; field must clear the bar.

### P4-1 — Clean implementation of the in-scope work (praise)
- The wrapper split (`.native.tsx`/`.tsx`), the `DEFAULT_BOTTOM_OFFSET` export, the per-Modal-host mounts, the keyed-on-keyboard-open `> 0 ?` ternaries (no permanent dead gap), and the brand-orange theme are all correct and idiomatic — mirror the proven `KeyboardRoot` pattern exactly. The Event-wizard SC-1/2/3/6 drive was flawless on device. The defect is a spec-inventory gap, not sloppy code.

---

## 4. Step 0.5 — Independent re-run of the implementor's fails-on-revert proof

- Checked out branch @ `e41f68dee`. Ran `npx jest orch_1165_keyboard_toolbar_clearance` → **PASS** (2/2) at `DEFAULT_BOTTOM_OFFSET = 54`.
- True value edit `54 → 12` in `SmartScrollView.native.tsx` → re-ran → **FAIL**: `expect(received).toBeGreaterThanOrEqual(expected) / Expected: >= 42 / Received: 12` at test line 45 (1 failed, 1 passed).
- Restored `12 → 54` (verified `git diff` clean on the file) → re-ran → **PASS** (2/2).
- **Implementor fails-on-revert independently reproduced.** Hashes: branch HEAD `e41f68dee`; edit was a transient working-tree change, reverted, no commit.

---

## 5. Adversarial test added

- **Path:** `mingla-business/src/wrappers/__tests__/orch_1165_keyboard_toolbar_mount_coverage.test.ts` (token `[TEST-MOD-APPROVED ORCH-1165]`).
- **Different angle:** the implementor's test asserts only `DEFAULT_BOTTOM_OFFSET >= 42` + `showArrows={false}`. Mine attacks (A) **mount coverage** — `<KeyboardToolbarRoot/>` is imported AND rendered in all three required native-window hosts (`app/_layout.tsx`, `SheetMobile.tsx`, `Modal.tsx`) so sheet/modal inputs (SC-4) actually get the bar; and (B) **keyed-on-keyboard-open offsets** — the +42 lives inside a `> 0 ?` ternary for the three numeric-padding surfaces (not unconditional, which would leave a permanent dead gap) and the two chat composers use `keyboardVerticalOffset={42}` (not 0). 8 tests, all PASS.
- **fails-on-revert verified at `e41f68dee`:** removed the `Modal.tsx` toolbar render + reverted `GroupChatPanel` offset `42 → 0` → 2 targeted tests FAILED (Modal mount, GroupChat offset), the other 6 still PASSED; restored both → 8/8 PASS again (`git diff` clean).
- Both the implementor happy-path test AND this adversarial test appear in `git diff origin/main...HEAD --name-only`.

---

## 6. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|------|---------|----------|
| 1 | No dead taps | PASS | Done dismisses (proven); no new tap targets added |
| 2 | One owner per truth | PASS | Single `MINGLA_KEYBOARD_TOOLBAR_THEME`; offset constant single-owned in SmartScrollView |
| 3 | No silent failures | **N/A→flagged** | The Ari occlusion is a silent UX failure (user types into a hidden field) — captured as P1-1 |
| 4 | One query key per entity | N/A | no data |
| 5 | Server state server-side | N/A | pure UI |
| 6 | Logout clears everything | N/A | no persisted state |
| 7 | Label `[TRANSITIONAL]` | PASS | +42 patches are permanent (correctly not marked transitional) |
| 8 | Subtract before adding | PASS | reused library `KeyboardToolbar`, no new plumbing |
| 9 | No fabricated data | N/A | no data |
| 10 | Currency-aware | N/A | no money |
| 11 | One auth instance | N/A | untouched |
| 12 | Validate at right time | N/A | no validation |
| 13 | Exclusion consistency | N/A | n/a |
| 14 | Persisted-state startup | N/A | n/a |

No constitutional violation that auto-escalates to P0 (rule 3 is the UX-occlusion P1, not a swallowed error).

---

## 7. Device / parity matrix

| Surface | Verdict | Notes |
|---------|---------|-------|
| Consumer iOS (app-mobile) | N/A | out of scope (separate leg) |
| Consumer Android (app-mobile) | N/A | out of scope |
| Buyer/anon Web | N/A | out of scope |
| **Business Android** | **DRIVEN — FAIL** | Samsung `R58R54YV7JT`, current-branch JS over Metro. SC-1/2/3(Event)/6/7 PASS; SC-3(Ari) FAIL. |
| **Business iOS** | **suspected** | No iOS sim driven this pass (would require booting a 17-series sim + a fresh Metro dev-client install — time-costly and would NOT change the verdict, since the Ari occlusion path is platform-agnostic by code inspection). iOS Ari = FAIL by inspection; other iOS SCs = suspected. **Operator-unblock note for orchestrator:** if Seth wants an iOS eyeball, boot `iPhone 17 Pro Max` + load this worktree's Metro; the Ari fix must land first regardless. |
| Admin Web | N/A | different app |
| Business Web preview | suspected-PASS | web variant `null`, no library import; `expo export` not run this pass |

Physical iPhone HITL: not requested this pass (Android device sufficed to find the blocking defect).

---

## 8. Discoveries for Orchestrator

- **DISC-1165-T1 (→ feeds P1-1 REWORK):** the at-risk keyboard-site inventory must be EXHAUSTIVE before mounting an app-wide accessory bar. The INVESTIGATE flagged Ari but the SPEC's patch list dropped it; a root-mounted bar over-reaches every bespoke `Keyboard.addListener` site, not just the ones with `keyboardVerticalOffset`. Recommend the REWORK SPEC_AMENDMENT sweep ALL 8 unpatched native sites (Ari + 7 checkout forms), not just Ari.
- **DISC-1165-T2:** SC-4 (sheet/Modal toolbar mounts) is the highest-risk visual claim and remains **runtime-unverified** — source + adversarial-test confirm the mounts exist, but no sheet/modal text-input was driven on device this pass. The REWORK retest should drive TicketTierEditSheet (sheet) + CancelOrderDialog (Modal) explicitly.
- **COMMS-0040 / COMMS-0041 (WARN):** acknowledged, zero overlap — ORCH-1165 touched no public RSVP/experience page files; keyboard-UI only. (No new ledger write needed; the Ari gap is internal to this ORCH's REWORK, not cross-ORCH.)

---

## 9. Accepted conditions

None — this is a FAIL (unaccepted P1), not a CONDITIONAL PASS.

---

## Confidence

**High** on the FAIL. The P1 Ari occlusion is `proven` (device repro with typed-text-hidden evidence), the root cause is traced to a specific spec-inventory gap + the exact unpatched line, and the iOS impact is established by platform-agnostic code inspection. The in-scope mechanism (Done-only, brand-orange, dismiss, SmartScrollView clearance) is genuinely solid and proven on the Event wizard — the fix is narrow (add Ari + audit the checkout forms).

---

# RETEST 1 — rework @ `1fee49d35` (SPEC AMENDMENT A2/A4 sites #16–#24)

**Phase:** RETEST (mingla-tester). **Worktree:** same. **Rework commit:** `1fee49d3524adc6c018d711c77e3dc18cbdef0b0`.
**Binding contract:** `SPEC_AMENDMENT_ORCH-1165_AT_RISK_COMPLETE.md` (A5 matrix + A6 hard directives).
**Runtime:** Samsung Galaxy `R58R54YV7JT` (`com.sethogieva.minglabusiness`), dev build loading **current-branch JS over Metro** started from THIS worktree (port 8081, adb reverse, bundle = 4840 modules, brand "Lantern & Vine", dark theme). iOS: not driven (see RETEST §7).

## R1. Verdict

**FAIL** — P0: 0 · **P1: 1** (carried/unresolved — Ari) · P2: 0 · P3: 1 (minor) · P4: 1.

The rework correctly applied all 9 source patches (verified in the diff and on disk), the static gates are green (orch-0892 EXIT 0, jest 19/19, both fails-on-revert independently re-reproduced), and the Ari composer is **materially improved** vs the BEFORE state. **BUT the gating item — SC-3-Ari — still FAILS on device:** with the keyboard up, the "Ask Ari…" composer is **still occluded by the 42pt Done bar** in steady state. The `+ 42` lifted the composer's BOTTOM to the bar top but the composer pill is ~57dp tall, so its text-entry row and most of its body remain BEHIND the bar. Typed text ("VISIBLE_ABOVE_BAR_OK" / "RetestOcclusionCheck") was NOT visible while the keyboard was up — it only appeared after dismissing the keyboard. Measured across 5 independent focus/settle cycles: only **~11–29dp of the ~57dp composer pill clears the bar** (never the full pill); the text baseline sits at-or-behind the bar boundary. Per A6 directive 3, "the exact P1 reproducer must now show typed text fully visible" — it does NOT. **Unaccepted P1 UI/runtime regression, `proven` on Android → FAIL → REWORK.**

## R2. SC-by-SC matrix (RETEST)

| SC | Surface | Verdict | Evidence |
|----|---------|---------|----------|
| **SC-3-Ari** (gating) | **Android** | **FAIL (proven)** | Composer occluded by Done bar in steady state. Full-width pill detector: BEFORE-rework send-button = 0px above bar (100% hidden); AFTER-rework = only top **11–29dp** of the 57dp pill above bar; text row hidden. Typed text invisible until keyboard dismissed. 5 focus cycles, reproducible. `RETEST_android_ari_OCCLUDED_no_suggestion_strip.png` (text hidden, kbd up), `RETEST_android_ari_composer_text_revealed_on_dismiss.png` (same text shown after dismiss → proves it was behind bar), `RETEST_android_ari_CLEARS_when_settled.png` (best case, still only ~29dp/57dp). |
| SC-3-Ari | iOS | **suspected (FAIL by inspection)** | Path is platform-agnostic (`keyboardHeight + spacing.sm + 42`, web-exempt). The +42 undershoots by the composer's own height on both platforms → iOS Ari occlusion expected identically. No iOS sim driven this pass (RETEST §7). |
| SC-3 — checkout intake (#5 tight) | Android | **BLOCKED (not driven)** | Reaching a checkout intake form requires a live published-event order/cart; could not stage in-session. Source patch verified present (`keyboardHeight + spacing.xl + 42`, keyboard-open branch only). Not the gating item; verdict already FAIL on Ari. |
| SC-3 — checkout buyer/payment | Android | **suspected** | Source patches verified (`keyboardHeight + 140 + 42` / plan-aware `+42`, keyboard-open branch only). Not driven (live cart needed). These carry 140–260pt headroom + `scrollToEnd`, lower blast radius. |
| SC-3 — Paystack bank-picker modal (#24) | Android | **suspected / N/A-on-Android** | Source verified: `keyboardVerticalOffset={42}` added. **CAVEAT (DISC-1165-T3):** the KAV uses `behavior={Platform.OS === "ios" ? "padding" : undefined}` — on **Android the behavior is `undefined`, so KAV (and the offset) are NO-OP**; Android relies on native windowSoftInput. So the `={42}` only takes effect on iOS. Not driven on either platform (Nigeria payout onboarding flow not staged). |
| SC-3 — SmartScrollView wizards | Android | **PASS (proven, re-confirmed)** | EventCreatorWizard (Ticketed) Step-1 "Event name" focused with keyboard up → field fully visible above the Done bar, orange focus border, **no dead-gap / no double-padding**. Code path UNCHANGED by rework. `wiz_step_basics_focused` (in-session). |
| SC-1 / SC-6 | Android | **PASS (proven, re-confirmed)** | Done-**only** bar (no Prev/Next), "Done" text brand-orange `#eb7825`, flush on keyboard top — re-seen on Ari + Event wizard this pass. |
| SC-2 | Android | **PASS (carried)** | Dismiss behavior unchanged by rework; proven prior pass. |
| **SC-4a (Sheet)** / **SC-4b (Modal)** | Android | **suspected (NOT re-driven — A6.1 unmet)** | TicketTierEditSheet / CancelOrderDialog require deep flow staging (publish event → tiers; stage an order → cancel); not reached in-session. Mount code (`SheetMobile.tsx`, `Modal.tsx`) is **UNCHANGED by this rework** and was source+adversarial-test verified in the base pass; the Done bar mounting at the root over full-screen surfaces (Ari, wizard) is now visually proven this pass. A6.1 wanted these driven on device — **not achieved**; flagged. Since the verdict is already FAIL on Ari, this does not change routing. |
| SC-5 / SC-7 | Web / CI | **PASS** | Web branch untouched (web ternary not patched); orch-0892 EXIT 0 re-run this pass. |

## R3. Findings

### P1-1 (CARRIED, UNRESOLVED) — Ari composer STILL occluded by the Done bar
- **Evidence:** `src/screens/ari/AriChatScreen.tsx:329` now `keyboardHeight + spacing.sm + 42`. On device, full-width-pill measurement (Done-bar top = y1274 on the 1080×2400 frame): the composer pill (full at-rest height ~170px ≈ 57dp) shows only **31–88px (≈11–29dp) above the bar** across 5 focus cycles (`ari_stab_1/2`, `ari_clean_focus`, `maestro_ari_typed`, `ari_final_typed`). Typed text invisible with keyboard up; appears only after `hideKeyboard` (`RETEST_android_ari_composer_text_revealed_on_dismiss.png`). The orange send-button sliver peeks ~10dp above the bar; the text-entry row is at-or-behind the bar.
- **Impact:** On the Ari tab (a primary every-brand business screen), the user still cannot reliably see what they type — the composer body sits behind the orange Done bar. This is the exact regression the ORCH exists to prevent; the rework reduced but did not eliminate it.
- **Root cause of the insufficient fix:** `+ 42` adds ONLY the bar height, lifting the composer's BOTTOM edge to the bar top (0dp gap). Because the composer is a tall pill (~57dp) whose text row sits in its vertical middle, ~half the pill (incl. the text baseline) remains behind the 42dp bar. To fully clear, the keyboard-open offset must account for the composer's own height + a breath, e.g. `keyboardHeight + 42 + <composerHeight> + spacing.sm` OR restructure so the bar reserves space rather than overlaying (the composer must end ≥12dp ABOVE the bar TOP, not at it). Note the screen is the Ari empty-state; the same container is reused for the conversation state.
- **Required fix:** Increase the Ari keyboard-open offset so the **full composer** clears the bar with ≥12dp gap (add the composer container's measured/known height to the `+ 42`, or anchor the composer above a reserved bar inset). Re-drive: focus "Ask Ari…", type, confirm typed text fully visible above the bar with ≥12dp gap in steady state AND immediately after typing (no suggestion-strip dependency).
- **Retest:** the A6.3 reproducer — typed text fully visible above the bar, every focus cycle.

### P3-1 (minor, NEW) — DISC-1165-T3: Paystack KAV offset is a no-op on Android
- **Evidence:** `BrandPaystackOnboardView.tsx:258-261` — `<KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={42}>`. With `behavior` undefined on Android, KAV does nothing → the `keyboardVerticalOffset={42}` has no Android effect. The amendment A2 row #9 assumed the offset would lift the Android bank-list; on Android the sheet relies on native windowSoftInput instead.
- **Impact:** LOW. The search Input sits at the sheet TOP (not occluded); the concern was the bottom bank-list rows. On Android the native resize handles the sheet; the `={42}` is iOS-only. Not a regression (prior behavior preserved), but the patch does not do on Android what A2 #9 described. Worth a one-line confirmation when the Nigeria flow is driven.
- **Required fix:** none mandatory; verify the Android bank-list bottom rows are reachable when this flow is next driven. iOS keeps the `={42}`.

### P4-1 (praise) — patches are precise and minimal
All 9 patches are exactly keyed on the keyboard-open branch (never web, never closed) — no permanent dead gap. The test extension (9 source-regex assertions) is a genuine different-angle guard with proven fails-on-revert. The defect is a clearance-magnitude miscalibration on Ari, not sloppy or out-of-scope code.

## R4. Step 0.5 — Independent re-run of the implementor's fails-on-revert proofs (RETEST)
- **Implementor clearance test** (`orch_1165_keyboard_toolbar_clearance.test.ts`): checked out HEAD `1fee49d35`; ran → 2/2 PASS. Line-deleted `DEFAULT_BOTTOM_OFFSET = 54` → `12` in `SmartScrollView.native.tsx` → re-ran → **FAIL** (`Expected: >= 42 / Received: 12` at line 45, 1 failed/1 passed). Restored `12 → 54` → 2/2 PASS; `git status` clean. **Independently reproduced.**
- **New 9-site mount-coverage assertions** (`orch_1165_keyboard_toolbar_mount_coverage.test.ts`): line-deleted the Ari `+ 42` (`keyboardHeight + spacing.sm + 42` → `keyboardHeight + spacing.sm`) → re-ran → **FAIL** (`✕ Ari composer adds +42 to the keyboard-open paddingBottom term only`). Restored → 17/17 PASS; tree clean. **Independently reproduced.**

## R5. Adversarial test (RETEST)
The base-pass tester adversarial test (`orch_1165_keyboard_toolbar_mount_coverage.test.ts`, token `[TEST-MOD-APPROVED ORCH-1165]`) was EXTENDED by the implementor with the 9 new source-regex assertions (mount + keyed-on-open). It remains on-branch and in `git diff origin/main...HEAD --name-only`. Both the implementor happy-path clearance test and this adversarial test are present. **No new tester test added this RETEST** — the source-regex layer is adequate and the gating defect is a runtime-magnitude failure (the +42 IS present in source — the source assertions correctly PASS — but the magnitude is too small), which is fundamentally a **runtime** defect not catchable by a source regex; it is documented as P1-1 with device evidence. Regression gate: SATISFIED (both tests present, both fails-on-revert independently re-reproduced).

## R6. Constitution (RETEST delta)
No change from base pass. Rule 3 (no silent failures) is again the relevant lens — typing into a composer the user cannot see is a silent UX failure → captured as P1-1. No new constitutional violation. All other rules N/A as before.

## R7. Device / parity matrix (RETEST)

| Surface | Verdict | Notes |
|---------|---------|-------|
| **Business Android** | **DRIVEN — FAIL** | Samsung `R58R54YV7JT`, current-branch JS over Metro (4840 modules). SC-3-Ari FAIL (proven, 5 cycles). SC-1/2/3-wizard/6/7 PASS. SC-3-checkout / SC-4a/4b not driven (deep-flow staging). |
| **Business iOS** | **suspected — NOT driven** | A6.2 REQUIRED an iOS-sim eyeball of the Ari fix. **Not achieved this pass.** No iOS sim was booted (none booted at start; booting a 17-series sim + fresh Metro dev-client install was not completed in-session). The Ari occlusion path is platform-agnostic → iOS Ari = FAIL by inspection regardless; since Android already FAILs the gating item, the iOS eyeball would not change the verdict (it would still need the bigger-offset rework first). **Operator-unblock note:** once the Ari offset is corrected, an iOS Ari eyeball is still owed before CLOSE per A6.2. |
| Consumer iOS/Android, Buyer Web, Admin Web | N/A | out of scope (business leg only). |

Physical iPhone HITL: not requested this pass (Android device proved the blocking defect).

## R8. Discoveries for Orchestrator (RETEST)
- **DISC-1165-T3 (P3-1 above):** the Paystack KAV `keyboardVerticalOffset={42}` is a **no-op on Android** (`behavior` is `undefined` there). A2 row #9's Android rationale does not hold; the offset is iOS-only. Verify the Android bank-list bottom rows when the Nigeria payout flow is next driven.
- **DISC-1165-T4:** SC-4a/4b were **not re-driven on device** (A6.1 unmet) — they require deep-flow staging (publish event → ticket tiers; stage order → cancel). Mount code is unchanged by this rework + already source/adversarial-verified, and the Done bar's root-mount over full-screen surfaces is visually proven, so risk is low — but A6.1's explicit on-device requirement remains open and should be satisfied in the next retest (alongside the Ari re-drive), OR explicitly accepted by Seth.
- **DISC-1165-T5:** the Samsung keyboard renders its OWN suggestion strip + its OWN "Done" key in addition to the app's accessory Done bar (two "Done" affordances visible). Cosmetic only; flagging for awareness.
- **COMMS-0040 / COMMS-0041 (WARN):** acknowledged, **zero overlap** — this ORCH touched only keyboard-clearance offsets in Ari/checkout/Paystack; no public RSVP/experience page files. Factored, no ledger write needed.

## R9. Accepted conditions
None — this is a FAIL (unaccepted gating P1), not a CONDITIONAL PASS.

## R10. Confidence
**High** on the FAIL. The SC-3-Ari occlusion is `proven` on Android with quantified, reproducible pixel measurements across 5 focus cycles (full-width-pill detector, Done-bar top precisely located), plus the dispositive type→hidden→dismiss→revealed sequence. The root cause (the `+ 42` undershoots by the composer's own ~57dp height) is traced to the exact line. The static gates and both fails-on-revert proofs are independently re-reproduced. Caveats explicitly stated: SC-4a/4b not re-driven (A6.1 unmet, low risk, mount code unchanged); iOS not driven (A6.2 unmet, would not change the FAIL); Paystack offset is iOS-only on inspection (P3-1).
