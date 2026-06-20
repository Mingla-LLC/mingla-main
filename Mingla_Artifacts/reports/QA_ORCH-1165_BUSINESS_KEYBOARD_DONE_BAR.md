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

---

# FINAL RETEST — rework loop 2 @ `9ad7b1639`

**Phase:** RETEST (mingla-tester, canonical TEST owner). **Worktree:** `~/Desktop/mingla-orchs/ORCH-1165-[business-keyboard-done-bar]/` on branch `ORCH-1165-business-keyboard-done-bar`. **Rework commit:** `9ad7b1639de1081357f7050fdf794a5a42117924` (loop 2).
**Binding contract:** `SPEC_AMENDMENT_ORCH-1165_AT_RISK_COMPLETE.md` (A5 matrix + A6 hard directives).
**Runtime — Android (gating):** Samsung Galaxy `R58R54YV7JT` (`com.sethogieva.minglabusiness`), dev build loading **current-branch JS over Metro started from THIS worktree** (port 8081, adb reverse, Android bundle = **5305 modules / 32.7MB** = route-healthy, NOT the COMMS-0027 poisoned ~951-module bundle). **Bundle identity confirmed:** the served Android bundle contains the loop-2 markers `onComposerLayout`, `COMPOSER_HEIGHT_FALLBACK`, and the exact expression `42 + composerHeight + 12` (grep over `/index.bundle?platform=android` = present). Brand "Lantern & Vine", dark theme.
**Runtime — iOS:** iPhone 17 Pro Max sim (`2C3312D9…`) booted + business dev-client reinstalled + deep-linked to this Metro; iOS native bundle built (5305 modules) — but the app **redboxed on `Cannot find native module 'ExpoImageManipulator'`** (stale Jun-9 local native binary predates the `expo-image-manipulator` native module current main's JS requires — the known ORCH-1119/COMMS-0035 native-drift). The redbox is unrelated to ORCH-1165 (neither `AriChatScreen.tsx` nor `BrandPaystackOnboardView.tsx` imports that module). iOS therefore capped at **suspected** (see §F7).

## F1. Verdict

**CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 0 · **P3: 1** (carried DISC-1165-T3, not driven) · P4: 1.
**Sole condition: SC-4a (Sheet) + SC-4b (Modal) are DEFERRED TO SETH EYEBALL** (deep-flow staging genuinely unreachable in-session; precise staging requirements in §F3 / DISC-1165-T6). Paystack (P3, Nigeria-only flow) not reachable in-session — fix verified sound by inspection.

**The gating item — SC-3-Ari (FAIL twice prior) — now PASSES, `proven` on Android.** The loop-2 fix (lift the keyboard-open `paddingBottom` by `keyboardHeight + spacing.sm + 42 + composerHeight + 12`, where `composerHeight` is measured via `onLayout` on a `<View>` wrapping ONLY the `InputBar` pill — so the measurement is independent of the `inputWrap`'s own changing padding, no feedback loop) clears the **entire** composer pill above the 42dp Done bar with a visible gap, across **5 separate focus cycles** AND a **4-line multi-line** grown composer (the onLayout measurement self-adjusted), AND leaves **no permanent dead gap when the keyboard is closed** (the `keyboardHeight > 0` guard scopes the lift to keyboard-open only). The exact prior-FAIL reproducer (typed text hidden behind the bar) is now INVERTED: typed text is fully visible above the bar in every cycle.

Regression gate: SATISFIED — implementor clearance test + the loop-2-extended mount-coverage adversarial test both present, on-branch, in-diff; loop-2 Ari fails-on-revert independently re-reproduced (§F4).

## F2. SC-by-SC matrix (FINAL RETEST)

| SC | Surface | Verdict | Evidence |
|----|---------|---------|----------|
| **SC-3-Ari** (gating, was FAIL ×2) | **Android** | **PASS (proven)** | 5 focus cycles, each with typed `CycleN_ABOVE_BAR` **fully visible above the Done bar** with a clear gap: `RETEST2_android_ari_cycle1..5.png`. Multi-line: a 4-line grown composer's LAST line + cursor clears the bar (`RETEST2_android_ari_multiline.png`) — onLayout self-adjusts. Keyboard-closed: composer rests normally above the bottom nav, NO phantom gap (`RETEST2_android_ari_keyboard_closed.png`). Prior FAIL inverted: text now visible WHILE keyboard up. |
| SC-3-Ari | iOS | **suspected (PASS by inspection)** | Path is platform-agnostic (`Platform.OS === "web" ? … : keyboardHeight > 0 ? keyboardHeight + spacing.sm + 42 + composerHeight + 12 : …`; web-exempt). iOS hits the identical native branch with the same measured `composerHeight`. Not driven: stale local sim binary redboxes on `ExpoImageManipulator` native-drift (§F7), unrelated to ORCH-1165 JS. |
| SC-3 — SmartScrollView wizards (spot-check) | Android | **PASS (proven, re-confirmed)** | EventCreatorWizard Step-1 "Event name" focused, keyboard up → field fully visible above the Done-only orange bar, clear gap, **no dead-gap / no double-padding** (`orch1165_wizard_kbd.png`). Code path UNCHANGED by loop 2. |
| SC-1 / SC-6 | Android | **PASS (proven, re-confirmed)** | Done-**only** bar (no Prev/Next), "Done" brand-orange `#eb7825`, flush on keyboard top — re-seen on Ari (all cycles) + Event wizard this pass. |
| SC-2 | Android | **PASS (carried)** | Dismiss behavior unchanged; keyboard-closed Ari shot confirms clean teardown. |
| **SC-4a (Sheet — TicketTierEditSheet)** | Android | **DEFERRED → Seth eyeball** | NOT driven (deep-flow staging unreachable — see §F3). **Evidence upgrade:** `TicketTierEditSheet.tsx:20-21` renders its `<TextInput>`s inside `ScrollView` from the **SmartScrollView wrapper** (its own comment L422-425: "keyboard awareness handled natively via the ScrollView's… TextInput above the keyboard top. No manual listener needed") → its inputs use the **exact `DEFAULT_BOTTOM_OFFSET=54` mechanism already PROVEN on the Event wizard this pass**. Risk materially lower than a bespoke site. Sheet host (`Sheet`/`SheetMobile.tsx`) mount of `<KeyboardToolbarRoot/>` unchanged + adversarial-test-asserted. |
| **SC-4b (Modal — CancelOrderDialog)** | Android | **DEFERRED → Seth eyeball** | NOT driven (requires a LIVE order — brand has 0 sales). Host `Modal.tsx` mount of `<KeyboardToolbarRoot/>` unchanged + adversarial-test-asserted. |
| SC-3 — Paystack bank-picker modal (#24, DISC-1165-T3) | Android | **NOT REACHABLE in-session (P3)** | The view renders only when `isPaystackBrand` (a Nigeria-payout brand); "Lantern & Vine" is a Stripe brand. Loop-2 fix verified by inspection: `useKeyboardIsVisible()` (library primitive, not bespoke listener — keeps orch-0892 green) → Android-only `bankListKbPad: {paddingBottom:42}` on the bank-list `ScrollView` contentContainer, keyed on `Platform.OS==="android" && keyboardVisible` (no permanent gap); iOS keeps the KAV `behavior="padding"` path. Sound by inspection; runtime deferred (P3). |
| SC-3 — checkout buyer/intake/payment | Android | **suspected (carried)** | Source patches verified prior pass (`+42` keyed on keyboard-open); not driven (live cart needed). 140–260pt headroom + `scrollToEnd`; not gating. |
| SC-5 / SC-7 | Web / CI | **PASS (re-run)** | Web ternary branch untouched (no `+42` on web); `orch-0892` gate **EXIT 0** re-run this pass (8 safelisted, 0 violations). |

## F3. Findings (FINAL RETEST)

### SC-3-Ari — RESOLVED (the gating P1 from RETEST 1 is fixed)
- **Evidence:** `src/screens/ari/AriChatScreen.tsx:350` keyboard-open branch is now `keyboardHeight + spacing.sm + 42 + composerHeight + 12`; `composerHeight` set from `onComposerLayout` (`:375` `<View onLayout={onComposerLayout}>` wrapping `InputBar`), fallback `COMPOSER_HEIGHT_FALLBACK = 110` before first measure. On device (Samsung, 1080×2400), across 5 focus cycles the typed text is fully visible above the Done bar with a clear gap; a 4-line grown composer's bottom line still clears (self-adjusting); keyboard-closed shows no phantom gap.
- **Root-cause closure:** RETEST 1's `+42` lifted only the pill's BOTTOM edge to the bar top, leaving the text row (mid-pill) behind the bar. Loop 2 adds the **full measured composer height + 12dp**, so the entire pill (incl. text row) sits above the bar's top. The `onLayout` wraps only `InputBar` (not `inputWrap`, whose `paddingBottom` is the value being computed), so there is no measurement feedback loop — verified by reading the JSX nesting.
- **Status: PASS.** No further action on Ari.

### P3-1 (CARRIED) — DISC-1165-T3: Paystack bank-picker not driven (Nigeria-only flow)
- **Evidence:** `BrandPaystackOnboardView.tsx` renders only for `isPaystackBrand` (`BrandPaymentsView.tsx:286`); current brand is Stripe. Loop-2 fix (Android bank-list `paddingBottom:42` via `useKeyboardIsVisible`) is sound by inspection and keeps orch-0892 green (library primitive). **Impact: LOW / P3** — Nigeria payout onboarding only; the search Input sits at the sheet top (never occluded), the fix only adds bottom-row clearance.
- **Required to verify:** stage a Nigeria-payout brand (or drive the Nigeria self-onboard country-picker path) → Brand → Payments → bank-picker; focus search with keyboard up; confirm bottom bank-list rows reachable on Android. Deferred (P3, not gating).

### P4-1 (praise) — loop-2 fix is precise, self-adjusting, and minimal
- The measured-`onLayout` approach (vs a guessed pill constant) self-corrects for multi-line growth and font scaling, proven on device. The wrap-`InputBar`-only choice correctly avoids the feedback loop. The Paystack switch to `useKeyboardIsVisible` (over a no-op Android KAV offset) is the right library-only fix. All keyed-on-keyboard-open; no web/closed-branch pollution.

## F4. Step 0.5 — Independent re-run of the implementor's fails-on-revert proofs (loop 2)
- **Clearance test** (`orch_1165_keyboard_toolbar_clearance.test.ts`): at HEAD `9ad7b1639` → 2/2 PASS (carried; `DEFAULT_BOTTOM_OFFSET=54 >= 42`).
- **Loop-2 Ari assertion** (`orch_1165_keyboard_toolbar_mount_coverage.test.ts`): the test now asserts the full `keyboardHeight + spacing.sm + 42 + composerHeight + 12` expression + `onLayout={onComposerLayout}` + `setComposerHeight(`. **Independently reproduced fails-on-revert:** line-edited `AriChatScreen.tsx` back to the RETEST-1 `keyboardHeight + spacing.sm + 42` (removed `+ composerHeight + 12`) → re-ran → **FAIL** (`✕ Ari composer lifts the FULL composer above the Done bar only when keyboard open (REWORK loop 2)`); restored → **17/17 PASS**; `git status` clean on the file. Full suite: **19/19 PASS** at HEAD.

## F5. Adversarial test (FINAL RETEST)
The tester adversarial test (`orch_1165_keyboard_toolbar_mount_coverage.test.ts`, token `[TEST-MOD-APPROVED ORCH-1165]`) was correctly EXTENDED by the implementor in loop 2 to assert the new measured-lift expression + onLayout wiring + web-branch exclusion for Ari (3 new regex assertions on the same `it`). It remains on-branch and in `git diff origin/main...HEAD --name-only` alongside the implementor clearance test. The gating defect was a runtime-magnitude failure (the `+42` WAS present in source) now closed by adding the measured term — newly guarded at source level by the loop-2 assertions, and proven at runtime on device. No new tester test file added (the magnitude defect is fundamentally runtime; documented with device evidence). Regression gate: SATISFIED.

## F6. Constitution (FINAL RETEST delta)
Rule 3 (no silent failures) — the prior "typing into a hidden composer" silent-UX-failure is now RESOLVED (text visible while typing). No constitutional violation. All other rules N/A as in the base pass.

## F7. Device / parity matrix (FINAL RETEST)

| Surface | Verdict | Notes |
|---------|---------|-------|
| **Business Android** | **DRIVEN — PASS (gating SC-3-Ari)** | Samsung `R58R54YV7JT`, current-branch JS over Metro (5305 modules, bundle-identity-confirmed). SC-3-Ari PASS (5 cycles + multi-line + closed-state). SC-1/2/3-wizard/6/7 PASS. SC-4a/4b deferred (staging); Paystack not reachable (Nigeria-only). |
| **Business iOS** | **suspected — blocked by stale local native build** | iPhone 17 Pro Max sim booted, dev-client reinstalled + deep-linked to this Metro, iOS bundle built (5305 modules) — but the app **redboxed: `Cannot find native module 'ExpoImageManipulator'`** (the Jun-9 DerivedData binary predates the `expo-image-manipulator` native module current main's JS imports; the known ORCH-1119/COMMS-0035 native-drift). The redbox is **unrelated to ORCH-1165** (neither patched file imports that module — verified). The Ari fix is platform-agnostic JS → iOS behaves identically to the proven Android result. **Operator-unblock:** a fresh business iOS dev-client native build (EAS, or per `IOS_DEV_BUILD_REBUILD_RUNBOOK.md` — NOT `expo run:ios`) is required to eyeball iOS Ari; it would not change the verdict (Android already PASSES the gating item). |
| Consumer iOS/Android, Buyer Web, Admin Web | N/A | out of scope (business leg only). |

Physical iPhone HITL: not requested this pass (Android device proved the gating fix; iOS blocked by the native-drift, an EAS-rebuild matter, not a HITL one).

## F8. Discoveries for Orchestrator (FINAL RETEST)
- **DISC-1165-T6 (SC-4 staging requirements, for the deferred Seth eyeball):** SC-4a (TicketTierEditSheet) requires advancing the Event Creator wizard to the Tickets step (Step 5) on a ticketed event and opening a tier's edit sheet — multi-step staging not completable in-session. **De-risked:** its TextInputs are SmartScrollView-backed (`DEFAULT_BOTTOM_OFFSET=54`), the exact mechanism PROVEN on the Event wizard this pass. SC-4b (CancelOrderDialog Modal) requires a LIVE order to cancel (brand has 0 sales) → unreachable without a completed purchase. Both host mounts (`SheetMobile.tsx`, `Modal.tsx`) are unchanged by loop 2 and adversarial-test-asserted. Recommend Seth eyeball both, OR accept the deferral given the SmartScrollView de-risk + unchanged-mount evidence.
- **DISC-1165-T3 (P3-1):** Paystack bank-picker is a Nigeria-payout-only surface, not reachable with the Stripe test brand; loop-2 fix sound by inspection. Verify when the Nigeria flow is next driven.
- **DISC-1165-T7 (iOS native-drift, sibling of COMMS-0035/ORCH-1119):** the local iPhone-17 sim's business dev-client binary (Jun-9 DerivedData) is stale vs current main's JS — it redboxes on `ExpoImageManipulator`. Any future iOS-sim eyeball of business-app JS needs a fresh native dev build first. Not an ORCH-1165 defect.
- **DISC-1165-T5 (carried):** Samsung keyboard renders its own "Done" key + suggestion strip alongside the app's accessory Done bar (two "Done" affordances). Cosmetic.
- **COMMS-0040 / COMMS-0041 (WARN):** acknowledged again, **zero overlap** — ORCH-1165 touched only keyboard-clearance offsets in Ari + Paystack; no public RSVP/experience page files (`RsvpPublicBody.tsx`, `RsvpMomentumDecision.tsx`, `ConsumerEventDetailScreen.tsx`, `PublicEventPage.tsx`, `packages/offering-rendering/*`, experience public pages all untouched). Factored, no ledger write needed.

## F9. Accepted conditions
This CONDITIONAL PASS carries ONE deferral: **SC-4a (Sheet) + SC-4b (Modal) deferred to a Seth manual eyeball** (deep-flow staging genuinely unreachable in-session — ticket-tier sheet needs a multi-step wizard advance on a ticketed event; cancel-order Modal needs a live order, and the brand has 0 sales). This is NOT a code defect: both host mounts are unchanged from the source+adversarial-verified base pass, and SC-4a's inputs ride the SmartScrollView `54` mechanism already PROVEN on device this pass. Per the dispatch directive ("Do NOT block the verdict solely on SC-4 if SC-3-Ari and the rest pass; mark SC-4 as deferred to Seth eyeball with the reason"), the verdict is not blocked on SC-4. P3 Paystack (Nigeria-only) likewise not reachable; fix sound by inspection.

## F10. Confidence
**High** on the gating result. SC-3-Ari is `proven` on Android with 5 reproducible focus cycles + a multi-line growth case + a keyboard-closed no-gap case, the served-bundle identity is confirmed to contain the loop-2 code, and the loop-2 fails-on-revert is independently reproduced. The fix's correctness (measured composerHeight + 12, no feedback loop, keyed-on-open) is verified at both source and runtime. The verdict is **CONDITIONAL PASS** strictly because SC-4a/4b could not be staged in-session (explicitly deferrable per the dispatch) and iOS is `suspected` (blocked by the stale-binary native-drift, which would not change the gating result since the Ari path is platform-agnostic and Android passes).

---

# ORCH-1170 SC-4 Samsung drive (ex-ORCH-1165 deferred eyeball)

**Phase:** RETEST — SC-4 closure (mingla-tester, canonical TEST owner). **Date:** 2026-06-20.
**Worktree:** detached `origin/main` @ `b43e9f128` (contains the merged keyboard code `b2914b5f5` / PR #548), node_modules symlinked from anchor, Metro from `/tmp/orch-1170-test/mingla-business` (isolated `TMPDIR=/tmp/orch-1170/metro`, port 8081, adb reverse).
**Runtime — Android (gating):** Samsung Galaxy A72 `R58R54YV7JT` (`SM-A725F`, 1080×2400, `com.sethogieva.minglabusiness`), dev build loading **current-main JS over Metro from this worktree**. **Bundle identity confirmed:** the served Android `index.bundle?platform=android` = **5312 modules / 32.9 MB** (route-healthy, NOT the COMMS-0027 ~951-module poisoned bundle) and contains the ORCH-1165 markers `KeyboardToolbarRoot`, `MINGLA_KEYBOARD_TOOLBAR_THEME`, `showArrows: false`, `eb7825` (47 hits), plus the SC-4 components (`CancelOrderDialog` placeholder string + `TicketTierEditSheet`). Brand "Lantern & Vine", dark theme.
**Driver:** Maestro 2.5.1 `--device R58R54YV7JT` for taps (the in-sheet Mapbox autocomplete + sheet/dialog buttons were unresponsive to `adb input tap` — a known z-order/gesture quirk; Maestro's synthesized gestures drove them reliably). `adb input text` for keystrokes. Screenshots `adb exec-out screencap -p`.

## SC-4 Verdict

**FAIL** — P0: 0 · **P1: 1** (the Done bar does NOT render inside either RN-Modal-hosted surface on Android) · P2: 0 · P4: 1.

Both deferred SC-4 surfaces were **driven on the Samsung to the exact required state with the keyboard open**, and on **both** the brand-orange Done bar is **ABSENT**. A clean **positive control** (Ari app-root composer) on the **same device, same session, same bundle** shows the orange "Done" bar rendering correctly — so the failure is specific to the RN-`Modal`-hosted mounts (`SheetMobile.tsx`, `Modal.tsx`), not a global break.

## SC-4 matrix

| SC | Surface (host primitive) | Verdict | Evidence |
|----|--------------------------|---------|----------|
| **SC-4a** | TicketTierEditSheet (`SheetMobile.tsx` → RN `Modal`) | **FAIL (proven)** | Reached via Event Creator wizard (Ryry draft) → advanced Step 1 Basics (filled required description) → Step 2 When (date + door/end times) → Step 3 Where (venue + Mapbox-autocomplete-picked address, via Maestro) → Step 4 Cover (default) → **Step 5 Tickets → "+ Add ticket type" → tier edit Sheet**. Focused the **Name** field, typed "VIP", keyboard up. Field fully visible above keyboard (no occlusion). **But NO orange Done bar renders** between the sheet content and the keyboard top — the sheet's "Free ticket" row meets the Samsung keyboard's emoji toolbar directly. `SC4a_ticket_tier_sheet_samsung.png` + band crop `SC4a_band_no_done_bar.png`. |
| **SC-4b** | CancelOrderDialog (`Modal.tsx` `ModalNative` → RN `RNModal`) | **FAIL (proven)** | Brand "Lantern & Vine" has 0 orders, so deep-linked into a **reachable** free+paid order on sibling brand "Leggo This" (device account is a `brand_team_members` member; order `8f31dfb4…`, event `b1ab659e…`) via `mingla-business://event/<id>/orders/<oid>`. Order detail rendered → red **"Cancel order"** → **CancelOrderDialog** opened with its required reason input. Focused the reason input, typed "testing", keyboard up. Input fully visible. **NO orange Done bar renders** above the keyboard — dialog content meets the keyboard emoji toolbar directly. Dismissed via **"Keep order"** (NO cancellation submitted; verified post-hoc `cancelled_at IS NULL`, order untouched). `SC4b_cancel_order_dialog_samsung.png` + band crop `SC4b_band_no_done_bar.png`. |
| **SC-4 positive control** | Ari composer (`AriChatScreen.tsx`, app-root `KeyboardToolbarRoot` under `app/_layout.tsx` `KeyboardRoot`) | **PASS (proven)** | Same device/session/bundle: focused "Ask Ari…", typed, keyboard up → the brand-orange (#eb7825) "Done" bar renders as a distinct strip flush above the keyboard, right-aligned. `SC4_POSITIVE_CONTROL_ari_done_bar.png`. Proves the toolbar works at app-root but NOT inside the Modal windows. |

## Root cause (P1)

`react-native-keyboard-controller`'s `KeyboardToolbar` (via internal `KeyboardStickyView`) requires a `KeyboardProvider` **in the same native window** to receive keyboard-frame animation events. The only `KeyboardProvider` is at app root (`app/_layout.tsx:695` `<KeyboardRoot>`). Both `SheetMobile.tsx` (L294 RN `<Modal>`, `<KeyboardToolbarRoot/>` at L340) and `Modal.tsx` (L185 `<RNModal>`, `<KeyboardToolbarRoot/>` at L224) render their content + the toolbar inside a **separate Android native window**, with **NO `KeyboardProvider` inside that window**. The root provider does not observe the Modal's window, so the sheet/dialog `KeyboardToolbar` never receives a keyboard frame and stays translated off-screen → the Done bar never appears. The ORCH-1165 mounts are present in source but **non-functional on Android**.

- **Impact:** The two RN-Modal-hosted text-entry surfaces (ticket-tier name/price edit; order cancellation reason) get NO Done bar — the very surfaces the SC-4 mounts were added to cover. Field occlusion is NOT the issue here (both fields sit above the keyboard); the issue is the **missing Done affordance** the spec requires on these surfaces.
- **Required fix:** wrap the Modal/Sheet content (or at minimum the `KeyboardToolbarRoot`) in its own `<KeyboardProvider>` inside each RN-Modal window — `SheetMobile.tsx` and `Modal.tsx` — so the sticky toolbar receives keyboard frames in that window. Then re-drive SC-4a/SC-4b on the Samsung (same staging recipe above).
- **Retest:** repeat the two flows; confirm the orange Done bar appears flush above the keyboard in both the tier sheet and the cancel dialog, matching the Ari positive control.

## Constitution / regression note
No new product code touched by this drive (test-only). The P1 is a runtime defect in already-merged code; routes to REWORK (implementor) under ORCH-1170. The implementor happy-path + tester adversarial tests asserted the *source mount* of `<KeyboardToolbarRoot/>` in both primitives — which is present — but could NOT assert runtime rendering inside the Modal window; this drive supplies the missing runtime proof that the mount is inert on Android.

## Evidence paths (`Mingla_Artifacts/evidence/ORCH-1165/`)
- `SC4a_ticket_tier_sheet_samsung.png` — tier edit Sheet, Name focused, keyboard up, no Done bar.
- `SC4a_band_no_done_bar.png` — cropped band above keyboard (SC-4a), no orange strip.
- `SC4b_cancel_order_dialog_samsung.png` — CancelOrderDialog reason input focused, keyboard up, no Done bar.
- `SC4b_band_no_done_bar.png` — cropped band above keyboard (SC-4b), no orange strip.
- `SC4_POSITIVE_CONTROL_ari_done_bar.png` — Ari app-root composer with the orange Done bar PRESENT (same session).

## Confidence
**High / proven.** Both deferred surfaces were driven to the exact required state with the keyboard open on the physical Samsung running the confirmed current-main bundle; the negative (no Done bar in Sheet + Modal) is corroborated by a same-session positive control (Ari) where the bar DOES render, and the source root cause (no `KeyboardProvider` inside the RN-Modal windows) is consistent with the observed runtime. No DB mutation performed (cancellation aborted via "Keep order"; order verified untouched).

---

# ORCH-1170 SC-4 RETEST (post-provider-fix)

**Phase:** RETEST — SC-4 closure after the per-Modal `KeyboardProvider` fix (mingla-tester, canonical TEST owner). **Date:** 2026-06-20.
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1170-[keyboard-modal-provider]/` on branch `ORCH-1170-keyboard-modal-provider`, fix @ `a10438607` (HEAD).
**Fix under test:** `a10438607` wraps each RN-Modal window's content in its OWN `<KeyboardRoot>` (native = `<KeyboardProvider>`, web = passthrough) in `SheetMobile.tsx` (SC-4a host) and `Modal.tsx` (SC-4b host), so the `<KeyboardToolbarRoot/>` Done bar mounted in that window receives keyboard frames.
**Runtime — Android:** Samsung Galaxy A72 `R58R54YV7JT` (`SM-A725F`, 1080×2400, `com.sethogieva.minglabusiness`), dev build loading **current-branch JS over Metro from this worktree** (isolated `TMPDIR=/tmp/orch-1170/metro`, port 8081, adb reverse).
**Bundle identity CONFIRMED (this branch's fix, not stale main):** served `index.bundle?platform=android` = **32.9 MB / 4850 modules** (route-healthy). The served bundle contains **2× `require(..., "../../wrappers/KeyboardRoot")`** — the NEW per-window providers imported from `src/components/ui/SheetMobile.tsx` and `src/components/ui/Modal.tsx` (both two levels deep under `components/ui/`) — paired with **2× `require(..., "../../wrappers/KeyboardToolbarRoot")`**, plus the app-root `require(..., "../src/wrappers/KeyboardRoot")` from `app/_layout.tsx`. The pre-fix bundle would have had only the single app-root `KeyboardRoot` require. Both `Dismiss sheet`/`Dismiss modal` a11y strings present, `eb7825` ×45.
**Driver:** Maestro 2.5.1 `--device R58R54YV7JT` (tapOn) + `adb shell input tap`/`input text` + `screenrecord` frame extraction.

## ORCH-1170 SC-4 Verdict

**BLOCKED** — P0: 0 · P1: 0 · P2: 0 · P4: 0. **Cannot issue PASS or FAIL: the same-session positive control (Ari app-root Done bar) did NOT render under any automated focus method, so the absence of the bar in the SC-4a/SC-4b captures is confounded by a test-tooling limitation and cannot be attributed to the code.** Requires a Seth human finger-tap to confirm (HITL).

## What changed vs. the prior FAIL pass (behavioral signal the fix IS live)

In the prior FAIL pass the Modal-hosted toolbar was entirely inert (no provider in the window → no reaction at all). In THIS retest the toolbar is demonstrably **mounted and reacting inside the Modal window**: on keyboard-CLOSE in the tier Sheet the brand-orange "Done" bar is visibly parked at the **window top** overlapping the status bar (`SC4a_RETEST_done_bar_at_window_top_on_kbclose.png`, 494 orange `#eb7825` px in the top-right band; 0 px when keyboard fully up). That top-parked rest position is the `KeyboardStickyView`'s hidden translate state — proof the per-window `KeyboardProvider` is now wired and the bar is animating against this window's keyboard frame. This is a genuine, observable change from the prior "no provider, no reaction" state.

## Why this is BLOCKED, not PASS/FAIL — the positive-control failure

With the keyboard genuinely UP and the field focused, **no orange Done bar renders flush above the keyboard on ANY surface I drove — including the Ari app-root composer, which PASSED in the prior pass** (`SC4_POSITIVE_CONTROL_ari_done_bar.png` shows the grey strip + right-aligned orange "Done" above the Samsung keyboard's emoji row). I reproduced the Ari focus via Maestro `tapOn`, `adb shell input tap` (genuine InputManager MotionEvent), and `adb input text`, and extracted **39 frames from a `screenrecord` of the full keyboard-show animation** — the orange Done bar appears in **zero** frames above the keyboard. Since my positive control is dark, the identical "no bar above keyboard" result in SC-4a/SC-4b is **not diagnostic** — it is consistent with both "fix works but my synthesized focus doesn't trigger the `WindowInsetsAnimation` callbacks the keyboard-controller needs to render the bar in a capturable frame" AND "fix doesn't work." The prior pass's cropped positive-control screenshot proves the bar CAN render on this device via a real human tap; New-Architecture keyboard-controller is known to depend on genuine IME inset-animation callbacks that synthesized input does not always deliver. No keyboard-controller errors in Metro/logcat.

Per tester discipline ("If neither tool reproduces a keystroke bug, STOP and ask Seth to perform the sequence while you prep field state and screenshot before/after; never claim a hardware-event repro you didn't perform") this is escalated HITL — fields are pre-staged on the device for Seth's finger-tap.

## ORCH-1170 SC-4 matrix

| SC | Surface (host primitive) | Verdict | Evidence |
|----|--------------------------|---------|----------|
| **SC-4a** | TicketTierEditSheet (`SheetMobile.tsx` → RN `Modal`, now wrapped in per-window `<KeyboardProvider>`) | **BLOCKED (HITL)** | Reached via Event Creator wizard (Ryry draft already on Step 5) → "+ Add ticket type" → tier edit Sheet → focused Name field (Maestro tapOn), keyboard up, field visible above keyboard (no occlusion). No orange Done bar above keyboard in capture — but positive control also dark, so non-diagnostic. Behavioral proof the provider IS live: Done bar parks at window-top on keyboard-close. `SC4a_RETEST_ticket_tier_sheet_samsung.png`, `SC4a_RETEST_done_bar_at_window_top_on_kbclose.png`. |
| **SC-4b** | CancelOrderDialog (`Modal.tsx` `ModalNative` → RN `RNModal`, now wrapped in per-window `<KeyboardProvider>`) | **BLOCKED (HITL)** | Deep-linked the reachable real order (`mingla-business://event/b1ab659e…/orders/8f31dfb4…`) → order detail rendered → red "Cancel order" → CancelOrderDialog opened → focused reason input (Maestro tapOn), keyboard up, input visible above keyboard. No orange Done bar above keyboard in capture — non-diagnostic (positive control dark). **Aborted via "Keep order" — NO cancellation submitted; DB verified `cancelled_at IS NULL` before AND after.** `SC4b_RETEST_cancel_order_dialog_samsung.png`. |
| **SC-4 positive control** | Ari composer (`AriChatScreen`, app-root `KeyboardToolbarRoot` under `app/_layout.tsx` `KeyboardRoot`) | **FAILED TO REPRODUCE (tooling)** | Same device/session/bundle. Focused "Ask Ari…" via Maestro tapOn, adb tap, adb input text + screenrecord (39 frames). The orange Done bar that rendered in the prior pass does NOT appear above the keyboard under any automated method → invalidates automated SC-4 disambiguation; the bar requires a genuine human tap on this New-Arch build. `SC4_POSITIVE_CONTROL_ari_done_bar_RETEST.png`. |

## No-regression (Ari)

The Ari composer renders, accepts text ("hello"), shows its orange send button, and the keyboard raises/lowers normally — no crash, no layout break, no regression in the composer itself. The ONLY anomaly is the Done-bar accessory not rendering under synthesized focus (a capture limitation affecting all three surfaces equally, including the previously-passing positive control), not a functional Ari regression.

## DB safety

Order `8f31dfb4-f241-4686-943a-3377f2fab02a` queried before staging and after "Keep order": `cancelled_at = null` both times. **No order cancelled. No DB mutation performed.**

## Evidence paths (`Mingla_Artifacts/evidence/ORCH-1165/`)
- `SC4a_RETEST_ticket_tier_sheet_samsung.png` — tier edit Sheet, Name focused, keyboard up.
- `SC4a_RETEST_done_bar_at_window_top_on_kbclose.png` — brand-orange "Done" bar parked at window top on keyboard-close (proof the per-window provider is live + reacting).
- `SC4b_RETEST_cancel_order_dialog_samsung.png` — CancelOrderDialog reason input focused, keyboard up.
- `SC4_POSITIVE_CONTROL_ari_done_bar_RETEST.png` — Ari composer focused, keyboard up; Done bar did NOT reproduce under automated focus (compare to passing `SC4_POSITIVE_CONTROL_ari_done_bar.png`).

## Required to close (Seth HITL — 2 finger-taps, ~60s)

Fields are pre-staged. On the connected Samsung:
1. **SC-4a:** open the Ari tab → tap "Ask Ari…" with your finger. If the brand-orange "Done" strip appears flush above the keyboard → the keyboard-controller works via real tap (positive control GREEN). Then: Home → resume "Ryry" draft (Step 5) → "+ Add ticket type" → finger-tap the Name field. Confirm the orange "Done" bar renders flush above the keyboard with the field visible.
2. **SC-4b:** deep-link `mingla-business://event/b1ab659e-358d-41f3-a56d-76f7b273bddd/orders/8f31dfb4-f241-4686-943a-3377f2fab02a` → "Cancel order" → finger-tap the reason input. Confirm the orange "Done" bar renders above the keyboard. **Dismiss via "Keep order" — do NOT submit a cancellation.**

If the bar renders above the keyboard in both (and in the Ari positive control) → SC-4 is **PASS**. The source fix + bundle identity + live-provider behavioral signal all point to PASS; only the runtime eyeball under a real finger-tap is outstanding.

## ORCH-1170 Confidence
**Medium-high that the fix is correct; BLOCKED on runtime eyeball.** The fix is structurally sound (native `KeyboardRoot` = real `<KeyboardProvider>`, correctly wrapping both Modal hosts), the served bundle is confirmed to carry it, and the Done bar is observably mounted + reacting inside the Modal windows now (parks at window-top on keyboard-close — a behavior absent in the prior FAIL). The single gap is that automated synthesized focus does not render the bar in a capturable above-keyboard frame on this New-Architecture build, AND that same limitation blanks the previously-passing Ari positive control — so I will not assert PASS/FAIL without Seth's finger-tap. No order cancelled.

## COMMS ledger
Scanned `COMMS_LEDGER.md` on entry. No `BLOCK`+`OPEN` entry targets `mingla-tester`, `ORCH-1170`, `ORCH-1165`, or `ALL`. The open `ALL`/WARN entries (COMMS-0038/0039 Stripe-idempotency + realtime-pairing, COMMS-0040/0041 RSVP/experience public-page standardization) do not touch the keyboard/Modal/Sheet surfaces under test — no action required.
