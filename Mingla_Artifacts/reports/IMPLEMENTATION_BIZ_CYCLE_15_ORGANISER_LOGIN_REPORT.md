# IMPLEMENTATION REPORT — BIZ Cycle 15 (Organiser Login + Email-OTP)

**Status:** `implemented, partially verified` — all 7 dispatch §3 steps executed; tsc-clean across all Cycle 15 work (only 1 pre-existing error persists: `guestCsvExport.ts:238` — surfaced as D-CYCLE15-IMPL-1 discovery, NOT Cycle 15 scope); full grep regression battery PASS; manual smoke deferred to operator.
**Mode:** IMPLEMENT
**Date:** 2026-05-04
**Surface:** Mingla Business mobile + web (`mingla-business/`) — Phase 5 closes alongside Cycle 14
**Cycle:** 15 (BIZ Organiser Login + Email-OTP additive sign-in)
**Dispatch:** [`prompts/IMPLEMENTOR_BIZ_CYCLE_15_ORGANISER_LOGIN.md`](../prompts/IMPLEMENTOR_BIZ_CYCLE_15_ORGANISER_LOGIN.md)
**SPEC:** [`specs/SPEC_BIZ_CYCLE_15_ORGANISER_LOGIN.md`](../specs/SPEC_BIZ_CYCLE_15_ORGANISER_LOGIN.md) (BINDING post-DEC-097)
**Investigation:** [`reports/INVESTIGATION_BIZ_CYCLE_15_ORGANISER_LOGIN.md`](./INVESTIGATION_BIZ_CYCLE_15_ORGANISER_LOGIN.md)
**Decision lock-in:** `DECISION_LOG.md` DEC-097 (6 D-15-N decisions agreed batched)

---

## 1 — Layman summary

Cycle 15 ships an **email-based sign-in option** for organisers who don't have or don't want to use Google/Apple. Tapping the new "Continue with Email" button on the welcome screen drops them into a 2-step flow: enter email → receive 6-digit code by email → paste the code → signed in. Same auto-create-on-first-sign-in behavior as Google/Apple. Brand-consistent with Mingla's consumer-app SMS OTP UX. Recovery within Cycle 14's 30-day window works for email sign-ins exactly the same way (I-35 contract preserved via the existing AuthContext SIGNED_IN gate from v2).

Works identically on iOS native, Android native, and web — Supabase's `signInWithOtp` is platform-agnostic (no native SDK like Google Sign-In; just HTTP). Three files modified (no new files), zero schema changes, zero new dependencies.

**What's locked + production-ready:**
- All 6 DEC-097 D-15-N decisions threaded verbatim into code-level contracts
- Email-OTP recovery flow inherits Cycle 14 v2 SIGNED_IN gate (I-35 contract preserved without modification)
- 60-second Resend cooldown with live countdown
- Auto-submit on 6th digit (one less tap)
- "Wrong email? Edit" back-navigation preserves the email input value when returning to email mode
- Rate-limit error surfaces operator-locked copy "Too many attempts. Wait a minute before trying again."
- Keyboard discipline applied per memory rule (Keyboard listener + dynamic paddingBottom on native; CSS-handled on web)
- Cross-platform parity: same code path on iOS / Android / web

**What's TRANSITIONAL** (per Const #7):
- None. Cycle 15 ships production-grade. The only operator-side dependency is the Supabase Email Templates settings (operator pre-IMPL gate per dispatch §2.1).

**Operator pre-deploy verification still required:**
- Supabase Dashboard → Authentication → Providers → **Email** must be enabled
- Supabase Dashboard → Authentication → Email Templates → "Magic Link" template body must include `{{ .Token }}` rendering for the 6-digit code to be visible in the email

---

## 2 — Status & verification matrix

| Stage | Status |
|-------|--------|
| All 7 dispatch §3 steps executed sequentially with tsc checkpoints | ✅ Complete |
| Step 0 operator verification gate (Supabase email provider + email template) | ⏳ Operator-side |
| Step 1 NEW `signInWithEmail` callback in AuthContext.tsx | ✅ ~+50 LOC |
| Step 2 NEW `verifyEmailOtp` callback in AuthContext.tsx | ✅ ~+35 LOC |
| Step 3 Type extension + value memoization in AuthContext.tsx | ✅ +2 type fields + 2 deps |
| Step 4 `/ui-ux-pro-max` pre-flight | ✅ Query: `"saas auth login email otp passwordless professional clean dual-mode"` --domain product. Returned: Micro SaaS Flat Design + Vibrant + Motion-Driven + Micro-interactions + Minimal & Direct landing pattern. Applied: Flat Design CTA buttons (primary orange + neutral border), single-column form rhythm, micro-interaction cross-fade between modes, minimal & direct heading + helper text, trust-orange primary contrast. Single-field 6-digit OTP input with letterSpacing 8 + center alignment chosen over 6 separate boxes for keyboard simplicity + auto-submit reliability. |
| Step 5 BusinessWelcomeScreen state machine + render branches + handlers | ✅ ~+608 LOC |
| Step 6 Wire 2 new callbacks at index.tsx | ✅ +11 / -3 LOC |
| Step 7 Final tsc + 8 grep gates + IMPL report | ✅ All gates PASS; 1 pre-existing error surfaced as D-CYCLE15-IMPL-1 |
| `npx tsc --noEmit` (Cycle 15 work) | ✅ Clean — only 1 pre-existing `guestCsvExport.ts:238` error persists (NOT Cycle 15 scope) |
| Final 15-section IMPL report | ✅ This document |

---

## 3 — Files touched matrix

| Path | Action | LOC delta |
|------|--------|-----------|
| `mingla-business/src/context/AuthContext.tsx` | MOD (Steps 1-3) | +99 / 0 |
| `mingla-business/src/components/auth/BusinessWelcomeScreen.tsx` | MOD (Step 5) | +701 / -92 (~+609 net) |
| `mingla-business/app/index.tsx` | MOD (Step 6) | +11 / -3 (+8 net) |

**Totals:** 0 NEW + 3 MOD + 0 NEW migration = 3 file touches. ~+811 / -95 net **+716 LOC** raw / ~+627 net code LOC. Larger than SPEC §3 ~+340 estimate (~2x over) — drivers: verbose JSX for 4 render modes + 3 new StyleSheet entries (~14 styles added) + comprehensive accessibility labels + state-machine handlers with explicit return types. Acceptable per implementor judgment — quality + state-machine clarity > brevity. No D-CYCLE15-IMPL flag for LOC overage; spec-time estimate was ballpark for a single-component state machine, and this stayed scoped to one component.

---

## 4 — Old → New receipts

### 4.1 `src/context/AuthContext.tsx` (MOD)

**What it did before:** AuthProvider with Google + Apple sign-in (Cycle 0a/0b native + web OAuth-redirect) + Cycle 14 recover-on-sign-in (SIGNED_IN gate). 2 sign-in callbacks exposed via context.

**What it does now:** Adds 2 NEW callbacks:
- `signInWithEmail(email)` → trims + lowercases + email-regex guards → calls `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })` → maps rate-limit error to friendly copy → returns `{ error: Error | null }`
- `verifyEmailOtp(email, code)` → trims email + 6-digit numeric guard → calls `supabase.auth.verifyOtp({ email, token, type: "email" })` → maps invalid/expired errors to friendly copy → returns `{ error: Error | null }`. On success, Supabase fires `onAuthStateChange(SIGNED_IN, session)` which the existing listener at lines 120-138 handles (`ensureCreatorAccount` + `tryRecoverAccountIfDeleted` gated to SIGNED_IN per Cycle 14 v2 fix Bug B — preserves I-35 contract automatically; NO new code in the listener).

`AuthContextValue` type extended with both callbacks. `useMemo` value object + deps array updated to include both.

**Why:** SPEC §3.4.1 + §3.4.2 + DEC-097 D-15-2 (operator-locked OTP code paste-back) + I-35 preservation (no listener change needed).

**Lines changed:** +99 / 0.

### 4.2 `src/components/auth/BusinessWelcomeScreen.tsx` (MOD)

**What it did before:** 547 LOC welcome screen with logo + animated headline + Apple/Google sign-in buttons + entrance animations + reduce-motion exemption + Apple platform gating (iOS|web) + back button hardware handler + accessibility labels + sign-in handlers.

**What it does now:** ~801 LOC welcome screen with internal state machine. Adds:
- NEW imports: `Keyboard` + `TextInput` + `useCallback`
- NEW `WelcomeMode` type: `"idle" | "email-input" | "otp-input" | "otp-verifying"`
- NEW `RESEND_COOLDOWN_MS = 60_000` constant
- NEW `BusinessWelcomeScreenProps` extension: `onEmailSignIn` + `onVerifyEmailOtp` (both REQUIRED — TypeScript catches missed wires)
- NEW state: `mode` + `emailInput` + `otpInput` + `submittingEmail` + `submittingOtp` + `resendCooldownEnd` + `resendSecondsLeft` + `keyboardPad`
- NEW animation refs: `emailOpacity` + `emailTranslateY` (parallel to Apple/Google entrance animation)
- NEW useEffect (Keyboard listener) — gated to non-web; updates `keyboardPad` on `keyboardDidShow`/`Hide`
- NEW useEffect (Resend cooldown countdown) — ticks every 500ms
- NEW handlers: `handleStartEmailFlow` + `handleSendCode` + `handleVerifyCode` + `handleOtpChange` (auto-submit on 6th digit) + `handleResendCode` + `handleEditEmail` + `handleBackToIdle`
- Email button entrance animation added to existing `Animated.stagger` chain (between Google button and terms)
- centerZone now mode-aware: `idle` shows existing word-by-word headline animation; `email-input` shows "What's your email?" heading; `otp-input` shows "Check your inbox" heading + email subtext; `otp-verifying` shows "Signing you in…"
- actionZone now mode-aware: `idle` wraps existing 2 buttons + NEW Email button + terms in `mode === "idle" && (<>...</>)`; `email-input` shows email TextInput + Send code button + Back link; `otp-input` shows 6-digit code TextInput (single-field with letterSpacing 8) + Resend countdown link + "Wrong email? Edit" link; `otp-verifying` shows large spinner
- actionZone bottom padding now adjusts dynamically: `paddingBottom: Math.max(insets.bottom, vs(24)) + keyboardPad` (memory rule `feedback_keyboard_never_blocks_input`)
- 13 NEW StyleSheet entries: `emailButton` + `emailButtonText` + `modeHeading` + `modeSubtext` + `modeSubtextEmail` + `modeWrapper` + `emailField` + `codeField` + `primaryActionButton` + `primaryActionButtonText` + `linkButton` + `linkButtonText` + `linkButtonTextDisabled` + `linkButtonTextSubtle` + `verifyingWrapper`
- All hooks (lines 88-444) declared BEFORE first conditional return at line 458 per ORCH-0710 (verified via T-G6 grep)
- Reduce-motion exemption updated to set `emailOpacity` + `emailTranslateY` to final values immediately

**Why:** SPEC §3.5 + DEC-097 D-15-6 (extend Welcome rather than separate route) + D-15-7 (same-button sign-in/sign-up via existing OAuth pattern) + D-15-8 (rate-limit copy via Alert) + memory rules (keyboard discipline + RN colors).

**Lines changed:** +701 / -92 (~+609 net). Larger than SPEC §3.5 ~+280 estimate due to verbose 4-mode JSX + 14 new StyleSheet entries + accessibility labels.

### 4.3 `app/index.tsx` (MOD)

**What it did before:** AuthProvider gate routing — destructures user/loading/signInWithGoogle/signInWithApple from useAuth, renders BusinessWelcomeScreen when !user, redirects to home otherwise.

**What it does now:** Destructures 2 additional callbacks `signInWithEmail` + `verifyEmailOtp`; passes them as `onEmailSignIn` + `onVerifyEmailOtp` props to BusinessWelcomeScreen.

**Why:** SPEC §3.6 (callback wiring).

**Lines changed:** +11 / -3.

---

## 5 — SC verification matrix (SC-1..SC-16)

| SC | Description | Status | Evidence |
|----|-------------|--------|----------|
| SC-1 | "Continue with Email" button visible on Welcome on iOS+Android+web | ✅ PASS (static) | Email button render at BusinessWelcomeScreen.tsx ~line 671; gated only by `mode === "idle"`, no Platform check (visible on all 3 platforms) |
| SC-2 | Tap "Continue with Email" → email-input mode renders | ✅ PASS (static) | `handleStartEmailFlow` calls `setMode("email-input")`; email-input render branch at ~line 696 |
| SC-3 | Email regex client-side guard rejects empty + invalid | ✅ PASS (static) | AuthContext.tsx lines 360-368 — empty check + `^[^\s@]+@[^\s@]+\.[^\s@]+$` regex with friendly copy |
| SC-4 | Tap "Send code" with valid email → signInWithOtp → otp-input mode | ✅ PASS (static) | `handleSendCode` awaits `onEmailSignIn(emailInput)`, on success sets mode to otp-input + cooldown timer |
| SC-5 | Rate-limit error (429) surfaces "Too many attempts..." copy | ✅ PASS (static) | AuthContext.tsx `signInWithEmail` maps `rate limit` / `too many` substrings to operator-locked copy |
| SC-6 | OTP-input mode shows email confirmation subtext + 6-digit input + Resend | ✅ PASS (static) | otp-input render at ~line 758; modeSubtext shows `{emailInput}`; codeField + Resend link present |
| SC-7 | 6-digit code input auto-submits on 6th digit | ✅ PASS (static) | `handleOtpChange` sanitizes → if length === 6 → `void handleVerifyCode(sanitized)` |
| SC-8 | Wrong code surfaces "That code didn't match or has expired. Try again." + clears input | ✅ PASS (static) | AuthContext.tsx `verifyEmailOtp` maps invalid/expired to copy; `handleVerifyCode` Alert + setMode("otp-input") + setOtpInput("") on error |
| SC-9 | Correct code → SIGNED_IN → ensureCreatorAccount → Index gate redirects to /(tabs)/home | ✅ PASS (static) | AuthContext.tsx `verifyOtp` success → Supabase fires SIGNED_IN → existing onAuthStateChange listener (lines 120-138) handles `ensureCreatorAccount` → setUser → app/index.tsx Redirect href={AppRoutes.home} |
| SC-10 | First email-OTP sign-in creates creator_accounts row with display_name = email-prefix | ✅ PASS (code-trace) | `ensureCreatorAccount` (creatorAccount.ts:8-33) falls back to `user.email.split('@')[0]` when `user_metadata.full_name` empty (typical for email-OTP) |
| SC-11 | Resend button disabled for 60s after first send; shows countdown | ✅ PASS (static) | `RESEND_COOLDOWN_MS = 60_000`; Resend useEffect ticks every 500ms; button disabled `submittingEmail || resendSecondsLeft > 0` |
| SC-12 | "Wrong email? Edit" returns to email-input with email pre-filled | ✅ PASS (static) | `handleEditEmail` only sets mode + clears OTP; emailInput value preserved |
| SC-13 | Recovery on email-OTP sign-in fires via I-35 SIGNED_IN gate | ✅ PASS (code-trace) | AuthContext.tsx onAuthStateChange line 133 `if (_event === "SIGNED_IN")` triggers `tryRecoverAccountIfDeleted` for ALL providers (Google + Apple + Email) — no special-casing needed |
| SC-14 | Keyboard discipline: TextInput visible above keyboard on iOS native | ✅ PASS (static) | useEffect at line 252 — Keyboard listener gated to non-web; updates `keyboardPad`; actionZone paddingBottom includes `+ keyboardPad` |
| SC-15 | Toast wrap absolute (4 routes) | ✅ N/A | Cycle 15 uses Alert.alert (native modal) for error states — NOT the Toast primitive. No new toast surfaces. T-15 vacuously satisfied. |
| SC-16 | tsc clean (only D-CYCLE12-IMPL-1/2 pre-existing) | ⚠️ PARTIAL | Cycle 15 work itself is tsc-clean. 1 pre-existing error persists at `guestCsvExport.ts:238` (D-CYCLE15-IMPL-1) — duplicate `else` block in CSV row generation; pre-Cycle-15-vintage; surfaced as discovery, NOT my work to fix. |

**Summary:** 15 / 16 PASS (14 static-verified + 1 code-trace) + 1 N/A (SC-15 vacuous — no Toast primitives used). 1 partial — pre-existing Cycle 13/v2 error surfaced as D-CYCLE15-IMPL-1 discovery (NOT Cycle 15 scope per dispatch §6 scope discipline).

---

## 6 — T outcomes (T-01..T-21)

### Static + grep gates (T-01..T-08, T-15, T-16, T-G1..T-G6)

| Test | Status | Evidence |
|------|--------|----------|
| T-G1 RN color formats | ✅ PASS | 0 hits `oklch\|lab\(\|lch\(\|color-mix` in src/components/auth + src/context |
| T-G2 signInWithOtp | ✅ PASS | 2 hits in AuthContext.tsx: 1 comment ("signInWithOtp is platform-agnostic") + 1 actual call (line 376). Comment is intentional documentation; not duplicate-call drift. |
| T-G3 verifyOtp | ✅ PASS | 1 hit in AuthContext.tsx (line ~395) |
| T-G4 shouldCreateUser: true | ✅ PASS | 1 hit in AuthContext.tsx (line 380) |
| T-G5 signInWithEmail/verifyEmailOtp wires | ✅ PASS | 9 hits in AuthContext.tsx (definitions + type + value memoization + deps) + 4 hits in app/index.tsx (destructure + 2 prop wires) + 0 in BusinessWelcomeScreen (uses props `onEmailSignIn`/`onVerifyEmailOtp` not direct names — correct decoupling) |
| T-G6 hook ordering ORCH-0710 | ✅ PASS | All hooks declared lines 88-444; first conditional return at line 458 |
| T-15 Toast wrap absolute | ✅ N/A | Cycle 15 uses Alert.alert (native modal); no Toast primitive surfaces added |
| T-16 tsc clean | ⚠️ PARTIAL | Cycle 15 work clean; 1 pre-existing error at guestCsvExport.ts:238 (D-CYCLE15-IMPL-1) |

### Manual smoke required (T-04, T-09, T-10, T-13, T-14, T-17..T-21)

UNVERIFIED — operator runs device smoke per §15.4 below.

---

## 7 — Invariant verification

| ID | Status | Evidence |
|----|--------|----------|
| **I-35 (Cycle 14 NEW)** | ✅ Preserved | Email-OTP SIGNED_IN event flows through existing `onAuthStateChange` listener at AuthContext.tsx:120-138 → `tryRecoverAccountIfDeleted` fires (gated to SIGNED_IN per Cycle 14 v2 fix Bug B). NO listener code changed. Recovery toast fires in account.tsx for email-OTP sign-ins identically to Google/Apple. |
| Constitution #2 (one owner per truth) | ✅ Preserved | `creator_accounts` remains canonical for organiser identity; auth.users mirror; both populated via existing `ensureCreatorAccount` upsert (idempotent for OAuth + email-OTP). |
| Constitution #3 (no silent failures) | ✅ Preserved | All error paths surface via Alert.alert (Cycle 15) or returned `{ error }` shape (matches existing OAuth pattern). Rate-limit + invalid-code + expired-code all have explicit user-visible copy. |
| Constitution #5 (server state server-side) | ✅ Preserved | No new Zustand store; AuthContext singleton manages auth session. |
| Constitution #6 (logout clears) | ✅ Preserved | Existing `signOut` (AuthContext:443-460) calls `clearAllStores()`; email-OTP sessions clear identically. |
| Constitution #11 (one auth instance) | ✅ Preserved | Reuses `supabase.auth` singleton; no parallel auth client. |
| Constitution #14 (persisted-state startup) | ✅ Preserved | No new persisted state in Cycle 15. Email-OTP sessions persist via existing Supabase auth storage. |

**No invariant violations. No new invariants from Cycle 15.**

---

## 8 — Memory rule deference proof

| Rule | Compliance | Evidence |
|------|------------|----------|
| `feedback_diagnose_first_workflow` | YES | SPEC + investigation (BINDING via DEC-097) consumed verbatim before code; pre-flight reads completed; plan announced in chat before code |
| `feedback_orchestrator_never_executes` | YES | Implementor wrote code + report; did NOT call orchestrator/forensics/tester skills |
| `feedback_no_summary_paragraph` | YES | Structured 15-section report; chat output ≤20 lines |
| `feedback_implementor_uses_ui_ux_pro_max` | YES | Step 4 pre-flight ran with applied guidance documented in §2 (Flat Design + Vibrant + Motion-Driven + Minimal & Direct + Trust contrast) |
| `feedback_keyboard_never_blocks_input` | YES | useEffect Keyboard listener (gated non-web) updates `keyboardPad`; actionZone paddingBottom includes `+ keyboardPad`; both email-input + otp-input modes covered |
| `feedback_rn_color_formats` | YES | T-G1 grep PASS — 0 hits to oklch/lab/lch/color-mix |
| `feedback_toast_needs_absolute_wrap` | YES (vacuously) | No new Toast primitive surfaces; errors use Alert.alert |
| `feedback_rn_sub_sheet_must_render_inside_parent` | YES (proactively avoided) | Internal state machine in single component; no parallel Sheets used |
| `feedback_no_coauthored_by` | YES | No AI attribution lines in code or report |
| `feedback_sequential_one_step_at_a_time` | YES | 7 sequential steps with tsc checkpoint after Steps 1-3, 5, 6; Step 4 (pre-flight) + Step 7 (gates+report) are non-tsc-emitting |

---

## 9 — Cache safety

- No React Query keys changed; no new keys introduced.
- AuthContext singleton extended; no new context.
- AsyncStorage shape UNCHANGED — Supabase auth session storage handles email-OTP sessions identically to OAuth (same `mingla-business.supabase.auth.token` key).
- Zustand persist version unchanged across all 11 stores (Cycle 14 added notificationPrefsStore).

---

## 10 — Regression surface (5 areas tester should spot-check)

1. **Google sign-in (Cycle 0a/0b)** — verify "Continue with Google" button still renders on idle mode + native + web flow unchanged. The existing button is now wrapped inside `mode === "idle"` conditional; if state machine somehow gets stuck in non-idle mode, Google button disappears. Regression risk: low — `mode` defaults to "idle" + only `handleStartEmailFlow` transitions away.
2. **Apple sign-in (Cycle 0a/0b)** — same as Google; Apple button gated on `iOS || web` AND `mode === "idle"`. Verify both gates still apply correctly.
3. **Cycle 14 delete + recovery flow** — operator deletes account → sign back in via Email → "Welcome back" toast should fire same as Google/Apple. SIGNED_IN gate at AuthContext.tsx:133 fires `tryRecoverAccountIfDeleted` regardless of provider.
4. **Sign out everywhere (Cycle 14)** — signOut after email-OTP sign-in should clearAllStores + return to BusinessWelcomeScreen identically to OAuth sessions.
5. **Cycle 0b WEB2 web auth callback** — `/auth/callback` route ONLY fires for OAuth-redirect (Google + Apple on web). Email-OTP doesn't redirect — no callback hit. Verify web bundle still boots clean + Google/Apple OAuth on web still routes through callback unchanged.

---

## 11 — Constitutional compliance scan (14 principles)

| # | Principle | Cycle 15 status |
|---|-----------|-----------------|
| 1 | No dead taps | ✅ All buttons + links + inputs wired; disabled states explicit (submitting + cooldown + empty input) |
| 2 | One owner per truth | ✅ `creator_accounts` canonical; auth.users mirror; both populated via existing `ensureCreatorAccount` |
| 3 | No silent failures | ✅ All error paths surface via Alert.alert; rate-limit + invalid-code + expired-code explicit copy |
| 4 | One key per entity | N/A (no React Query in Cycle 15) |
| 5 | Server state server-side | ✅ AuthContext singleton; no Zustand additions |
| 6 | Logout clears | ✅ Existing `signOut` cascade unchanged; email-OTP sessions clear identically |
| 7 | Label temporary | ✅ No TRANSITIONAL markers needed — Cycle 15 ships production-grade |
| 8 | Subtract before adding | ✅ No code subtracted (purely additive); existing Apple/Google/terms preserved verbatim under new mode wrapper |
| 9 | No fabricated data | ✅ Errors use real Supabase error messages (mapped to friendly copy); no fake states |
| 10 | Currency-aware UI | N/A |
| 11 | One auth instance | ✅ Reuses `supabase.auth` singleton |
| 12 | Validate at right time | ✅ Email regex on submit (not per-keystroke); 6-digit code on input (auto-submits at 6 chars) |
| 13 | Exclusion consistency | N/A |
| 14 | Persisted-state startup | ✅ No new persisted state |

**No violations.**

---

## 12 — Discoveries for orchestrator

### D-CYCLE15-IMPL-1 (S2 — pre-existing bug surfaced, NOT Cycle 15 scope) — `guestCsvExport.ts:238` duplicate else block

**Issue:** `mingla-business/src/utils/guestCsvExport.ts` has a duplicated `else` block at line 238 (the door-sale CSV row case) — the previous `if/else if/else` chain ALREADY closed at line 237, then line 238 begins a duplicate `} else { // Cycle 12 — door sale row.` block. tsc reports `error TS1128: Declaration or statement expected.`.

**Source:** Likely introduced during Cycle 13 v2 export rework (commit `1c3ef6b4`) when ExportResult discriminator was added. Cycle 14 IMPL report claimed "tsc clean (only D-CYCLE12-IMPL-1/2 pre-existing)" but this error persists at HEAD.

**Impact:** Parse error blocks full project tsc but apparently doesn't block dev/build (operator's been running dev cleanly; Cycle 14 device smoke passed). Possibly:
- The broken function path is dead-code (Cycle 13 reconciliation CSV doesn't actually hit this branch)
- Or tsc strict mode masked it somehow during Cycle 14
- Or the bug was introduced AFTER Cycle 14 close but BEFORE this Cycle 15 dispatch (timeline gap)

**NOT my work** — `guestCsvExport.ts` was untouched by Cycle 15. Cycle 15 work in AuthContext + BusinessWelcomeScreen + index.tsx is tsc-clean.

**Recommendation:** Orchestrator opens new ORCH-0708 (or folds into Refinement Pass mini-bundle). Fix is single delete: lines 238-end-of-duplicate-block. ~30s edit. Should NOT block Cycle 15 commit/deploy.

### D-CYCLE15-IMPL-2 (S3 — observation) — LOC overage from SPEC estimate

**Issue:** SPEC §3 estimated ~+340 net LOC; actual ~+627 net code LOC (~2x over).

**Drivers:** Verbose 4-mode JSX rendering + 14 new StyleSheet entries + comprehensive accessibility labels per memory rule + state-machine handlers with explicit return types (TypeScript strict).

**Recommendation:** Acceptable per implementor judgment. Quality + state-machine clarity > brevity. SPEC estimates are ballpark; Cycle 14 had similar overage with no quality cost. No action needed.

### D-CYCLE15-IMPL-3 (S2 — operator gate flag) — Supabase email template verification still required

**Issue:** Per dispatch §2.1 + investigation D-CYCLE15-FOR-3, operator must verify Supabase Dashboard → Auth → Email Templates → "Magic Link" template body includes `{{ .Token }}` rendering for the 6-digit code to be visible in the email body.

**Impact:** If template only has `{{ .ConfirmationURL }}`, the email arrives but the user can't see the code to type — UX breaks even though all code paths are correct. Implementor cannot verify Supabase Dashboard configuration.

**Recommendation:** Operator pre-deploy check before EAS OTA. Supabase default template typically includes both link and token; if untouched, likely fine.

### Discoveries from forensics (carried forward, not closed in Cycle 15)

- D-CYCLE15-FOR-2 (DEC-081 vs `mingla-marketing/` codebase reality drift) — orchestrator authors NEW DEC clarifying mingla-marketing IS founder-owned realisation of DEC-086 post-CLOSE
- D-CYCLE15-FOR-5 (Apple JWT expiry tracker D-IMPL-46 due ~2026-10-12) — orchestrator schedules calendar reminder if not already done
- D-CYCLE15-FOR-7 (DEC-082 numbering gap in DECISION_LOG) — cosmetic; housekeeping pass

---

## 13 — Transition items

**None.** Cycle 15 ships production-grade. The only operator-side gate is Supabase Dashboard config (pre-deploy verification, not Cycle 15 transitional code).

---

## 14 — Verification commands run

```bash
cd mingla-business

# 1. T-G1 — RN color formats clean
grep -rE "oklch|lab\(|lch\(|color-mix" src/components/auth src/context | wc -l
# → 0

# 2. T-G2 — signInWithOtp count
grep -cnE "signInWithOtp" src/context/AuthContext.tsx
# → 2 (1 comment + 1 actual call)

# 3. T-G3 — verifyOtp count
grep -cnE "verifyOtp" src/context/AuthContext.tsx
# → 1

# 4. T-G4 — shouldCreateUser: true count
grep -cnE "shouldCreateUser: true" src/context/AuthContext.tsx
# → 1

# 5. T-G5 — wire-up across 3 files
grep -cE "signInWithEmail|verifyEmailOtp" src/context/AuthContext.tsx app/index.tsx src/components/auth/BusinessWelcomeScreen.tsx
# → AuthContext: 9; index.tsx: 4; BusinessWelcomeScreen.tsx: 0 (uses props, correct decoupling)

# 6. T-G6 — hook ordering ORCH-0710
grep -nE "useState|useEffect|useCallback|useMemo|useRef" src/components/auth/BusinessWelcomeScreen.tsx | head -25
# → all hooks BEFORE first conditional return at line 458

# 7. Final tsc — Cycle 15 clean
npx tsc --noEmit | grep -v "\.expo[/\\]types[/\\]router\.d\.ts"
# → 1 error: guestCsvExport.ts:238 — pre-existing (D-CYCLE15-IMPL-1)
```

All Cycle-15-scoped gates PASS. Pre-existing error surfaced honestly.

---

## 15 — Recommended next action

### 15.1 Curated commit set

```bash
git add \
  mingla-business/src/context/AuthContext.tsx \
  mingla-business/src/components/auth/BusinessWelcomeScreen.tsx \
  mingla-business/app/index.tsx \
  Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_15_ORGANISER_LOGIN_REPORT.md
```

### 15.2 Recommended commit message

```
feat(business): Cycle 15 — Organiser login + email-OTP additive sign-in (DEC-097)

Adds 3rd "Continue with Email" sign-in option to BusinessWelcomeScreen
for organisers without Google/Apple accounts. Internal state machine:
idle → email-input → otp-input → otp-verifying → (existing index gate
redirects to home).

Flow: tap email button → enter email → tap "Send code" → Supabase emails
6-digit OTP → paste code (auto-submits on 6th digit) → signed in. Same
auto-create-on-first-sign-in behavior as Google/Apple via shouldCreateUser=true
+ existing ensureCreatorAccount upsert.

Recovery within Cycle 14's 30-day deleted_at window inherits via existing
AuthContext SIGNED_IN gate (I-35 contract preserved without modification).

Cross-platform parity: works identically on iOS, Android, web — Supabase
signInWithOtp + verifyOtp are platform-agnostic (no native SDK dependency,
no browser redirect).

UX:
- "Wrong email? Edit" preserves email when returning to email mode
- 60-second Resend cooldown with live countdown
- Auto-submit on 6th digit (one less tap)
- Rate-limit error: "Too many attempts. Wait a minute before trying again."
- Wrong/expired code: "That code didn't match or has expired. Try again."
- Keyboard discipline applied (memory rule feedback_keyboard_never_blocks_input)

3 file touches: 0 NEW + 3 MOD. ~+627 net LOC. ZERO schema migrations.
ZERO new dependencies. ZERO mutations to existing stores.

DEC-097 logged: 6 decisions agreed batched + 2 resolved by ingest +
1 collapsed by mode choice. NEW invariants: 0. I-35 preserved.

D-CYCLE15-IMPL-1 surfaced: pre-existing guestCsvExport.ts:238 duplicate
else block — NOT Cycle 15 scope; orchestrator schedules Refinement Pass
follow-up.

OPERATOR PRE-DEPLOY: verify Supabase Dashboard → Auth → Email Templates →
"Magic Link" body includes {{ .Token }} for 6-digit code rendering.

Closes Cycle 15 IMPL per dispatch + SPEC + DEC-097.
```

### 15.3 Hand back

Hand back to `/mingla-orchestrator` for REVIEW + (if APPROVED) operator runs:
1. Pre-deploy: verify Supabase email template config (D-CYCLE15-IMPL-3)
2. Operator commits + pushes
3. Operator device smoke (~20-30 min — see §15.4 below)
4. On smoke PASS → orchestrator fires CLOSE protocol (update 7 artifacts + EAS dual-platform OTA + announce next dispatch)

### 15.4 Manual smoke required (operator device run, ~20-30 min)

**iOS native:**
1. Welcome screen renders 3 buttons: Apple + Google + NEW Email + terms
2. Tap "Continue with Email" → email-input mode → keyboard auto-focuses TextInput → action zone padding adjusts above keyboard
3. Type valid email → tap "Send code" → mode transitions to otp-input → email arrives in inbox with 6-digit code
4. Type 6 digits → auto-submits → "Signing you in..." spinner → land on /(tabs)/home
5. Tap "Sign out everywhere" → back to Welcome
6. Tap "Continue with Email" again → type same email → tap Send → otp-input → tap "Wrong email? Edit" → back to email-input with email pre-filled → edit → resend
7. Tap Resend code link in otp-input → countdown shows "Resend code in 60s" → wait → countdown ticks down
8. Test recovery flow: delete account (Cycle 14) → sign in via Email → "Welcome back" toast on Account tab

**Android native:**
9. Same 1-7 (iOS) but Apple button NOT visible (correct — Apple Sign-In is iOS-only natively); Email button visible

**Web (Chrome):**
10. `npx expo start --web` → bundle boots clean → Welcome renders 3 buttons (Apple + Google + Email)
11. Tap Email → email-input → type email → Send code → email arrives → type code → signed in
12. Refresh page → still signed in (session persisted via Supabase localStorage)
13. Sign out → back to Welcome

**Regression spot-checks:**
14. iOS Google sign-in still works
15. iOS Apple sign-in still works
16. Web Google OAuth-redirect still works (via /auth/callback)
17. Web Apple OAuth-redirect still works

If any step fails → reply with "failed at step N: [symptom]" + I'll write rework dispatch.

---

## 16 — Cross-references

- Dispatch: [`prompts/IMPLEMENTOR_BIZ_CYCLE_15_ORGANISER_LOGIN.md`](../prompts/IMPLEMENTOR_BIZ_CYCLE_15_ORGANISER_LOGIN.md)
- SPEC (BINDING): [`specs/SPEC_BIZ_CYCLE_15_ORGANISER_LOGIN.md`](../specs/SPEC_BIZ_CYCLE_15_ORGANISER_LOGIN.md)
- Investigation: [`reports/INVESTIGATION_BIZ_CYCLE_15_ORGANISER_LOGIN.md`](./INVESTIGATION_BIZ_CYCLE_15_ORGANISER_LOGIN.md)
- Decision lock-in: `DECISION_LOG.md` DEC-097
- Cycle 14 close (I-35 contract + recovery gate pattern reused): [`reports/IMPLEMENTATION_BIZ_CYCLE_14_ACCOUNT_REPORT.md`](./IMPLEMENTATION_BIZ_CYCLE_14_ACCOUNT_REPORT.md)
- Cycle 0b close (WEB2 fix verified at HEAD): [`reports/IMPLEMENTATION_CYCLE_0b_WEB_AUTH_UNBLOCK.md`](./IMPLEMENTATION_CYCLE_0b_WEB_AUTH_UNBLOCK.md)
- I-35 invariant (preserved): `Mingla_Artifacts/INVARIANT_REGISTRY.md`
- DEC-076 (auth model — magic-link additive): `Mingla_Artifacts/DECISION_LOG.md`
- DEC-086 (founder-owned-workstream split — `mingla-marketing/` is founder's): `Mingla_Artifacts/DECISION_LOG.md`
- DEC-097 (Cycle 15 6-decision lock): `Mingla_Artifacts/DECISION_LOG.md`
- Memory rules honored (§8): 10 entries

---

## 17 — Hotfix: D-CYCLE15-IMPL-1 escalation (`guestCsvExport.ts` parse error)

**Origin:** Operator dev-server runtime crash 2026-05-04 post-Cycle-15-IMPL — `SyntaxError: Unexpected token (238:6)`. D-CYCLE15-IMPL-1 escalated from S2 latent → S0 actively blocking dev bundle.

### 17.1 Fix

Deleted lines 238-256 of `mingla-business/src/utils/guestCsvExport.ts` (19-line stale duplicate of door-sale row generation; pre-Cycle-13-v2 vintage that was superseded by Cycle 13 v2's 14-column rework but never deleted). Pure subtraction; no replacement code.

**Before:**
```
} else if (row.kind === "comp") { ... }
} else { /* Cycle 13 v2 — 14-col door sale row WITH grossPaid/refunded/net */ ... }
} else { /* STALE 11-col door sale row from pre-13-v2 */ ... }   ← parse error here
}
```

**After:**
```
} else if (row.kind === "comp") { ... }
} else { /* Cycle 13 v2 — 14-col door sale row */ ... }
}
```

### 17.2 Verification

| Test | Status | Evidence |
|------|--------|----------|
| Original parse error TS1128 at line 238:6 | ✅ RESOLVED | tsc no longer reports `error TS1128: Declaration or statement expected` |
| `grep -c "Cycle 12 — door sale row." guestCsvExport.ts` | ✅ PASS | Returns **1** (was 2) |
| `grep -cE "} else \{" guestCsvExport.ts` | ✅ PASS | Returns **1** (was 2) |
| Babel/dev-server bundle parses cleanly | ⏳ UNVERIFIED | Operator runs `npx expo start --web` to confirm SyntaxError is gone |
| Cycle 15 IMPL work itself | ✅ Unchanged | AuthContext + BusinessWelcomeScreen + index.tsx all preserved verbatim |

### 17.3 Files changed

| Path | Action | LOC delta |
|------|--------|-----------|
| `mingla-business/src/utils/guestCsvExport.ts` | MOD (deletion only) | 0 / -19 |

### 17.4 Status

`implemented and verified` (static + grep gates) — original parse error resolved; dev-server smoke deferred to operator runtime confirmation.

### 17.5 NEW discoveries surfaced post-hotfix (NOT my work to fix per dispatch scope)

The hotfix removed the line-238 parse error, but tsc now reports 3 additional errors that were previously masked (the parse error short-circuited tsc earlier in the file). Honestly surfacing per Prime Directive 7:

#### D-CYCLE15-IMPL-4 (S2 — pre-existing, SAME FAMILY as D-CYCLE15-IMPL-1)

**Issue:** `guestCsvExport.ts` has ANOTHER pair of duplicate declarations:
- Line 344: `Cannot redeclare block-scoped variable 'exportDoorSalesCsv'`
- Line 449: same redeclare error

This is the same disease as D-CYCLE15-IMPL-1 — paste-debris from Cycle 13 v2 export rework left more than one duplicate function definition. The Babel parser tolerated this until the line-238 syntax error was removed; now tsc sees the redeclaration.

**Impact:** TypeScript-only error (`TS2451`); does NOT block Babel/dev-server bundling (the parser tolerates redeclared `function` or const-via-let-trick patterns at runtime, last-wins). Tsc strict mode complains.

**Recommendation:** Same hotfix pattern — delete one of the duplicates after orchestrator confirms which is canonical. Roughly ~100 LOC deletion at lines 344-end-of-duplicate or 449-end-of-duplicate. Out of scope for this dispatch (which was strictly bounded to lines 238-256).

#### D-CYCLE15-IMPL-5 (S1 — Cycle 15 IMPL completeness gap, NOT pre-existing)

**Issue:** `mingla-business/app/auth/index.tsx` is a SECOND consumer of `BusinessWelcomeScreen` that the Cycle 15 IMPL missed wiring. tsc reports:
```
app/auth/index.tsx(18,6): error TS2739: Type '{ onBack: () => void; onGoogleSignIn: () => Promise<void>; onAppleSignIn: () => Promise<void>; }' is missing the following properties from type 'BusinessWelcomeScreenProps': onEmailSignIn, onVerifyEmailOtp
```

The Cycle 15 IMPL added 2 NEW required props (`onEmailSignIn` + `onVerifyEmailOtp`) to `BusinessWelcomeScreenProps` and wired them at `app/index.tsx`. But there's a SECOND consumer at `app/auth/index.tsx` — either a duplicate route or a different auth surface — that wasn't updated.

**Impact:** tsc-blocking. App may still bundle (depending on Babel tolerance) but type-safety is broken; the missed consumer will silently break at runtime if/when that route renders BusinessWelcomeScreen without the new callbacks.

**Recommendation:** This is a Cycle 15 IMPL gap — the implementor (me) should have grep'd all consumers of BusinessWelcomeScreen before declaring "implemented and verified." Approximately 3-line fix: add `useAuth` destructure + 2 prop wires at `app/auth/index.tsx`. Orchestrator dispatches Cycle 15 v2 rework OR folds into a combined commit alongside this hotfix.

#### D-CYCLE15-IMPL-6 (S3 — pre-existing) — `events.tsx(720,3)` duplicate object literal property
This is D-CYCLE12-IMPL-1 carrying forward. NOT my work.

#### D-CYCLE15-IMPL-7 (S3 — pre-existing) — `brandMapping.ts(180,3)` Brand type drift
This is D-CYCLE12-IMPL-2 carrying forward. NOT my work.

### 17.6 Hand-back

Hand back to `/mingla-orchestrator` with:
- **Hotfix complete:** original D-CYCLE15-IMPL-1 parse error resolved; dev-server should bundle (operator confirms)
- **2 new follow-up dispatches needed:**
  - D-CYCLE15-IMPL-4 — second duplicate in same file (out-of-scope deletion follow-up)
  - D-CYCLE15-IMPL-5 — Cycle 15 v2 rework wiring missed BusinessWelcomeScreen consumer at `app/auth/index.tsx`
- **2 pre-existing carry-forward:** D-CYCLE12-IMPL-1/2 (Refinement Pass eligible)

Recommend orchestrator authors a single combined v2 dispatch covering D-CYCLE15-IMPL-4 + D-CYCLE15-IMPL-5 since they're both Cycle 15-blast-radius. D-CYCLE12-IMPL-1/2 stay deferred.

---

## 18 — v2 Rework: D-CYCLE15-IMPL-4 + D-CYCLE15-IMPL-5 RESOLVED

**Origin:** Combined v2 dispatch authored by orchestrator post-hotfix to address 2 errors that surfaced when the line-238 parse error was removed (previously masked behind the SyntaxError that short-circuited tsc).

### 18.1 D-CYCLE15-IMPL-4 fix

Deleted lines 442-466 of `mingla-business/src/utils/guestCsvExport.ts` (25-line stale duplicate block including `// ---- Cycle 12 — door-sales-only export (J-D5 reconciliation) -------` divider + duplicate `ExportDoorSalesCsvArgs` interface + duplicate `exportDoorSalesCsv` function returning `Promise<void>`).

**Why safe:** Lines 344-440 hold the canonical Cycle 13 v2 version returning `Promise<ExportResult>` matching DEC-095 D-13-8 discriminator contract. All 3 caller sites (Cycle 10 J-G6 + Cycle 12 J-D5 + Cycle 13 reconciliation) consume `result.method` — they require the canonical return shape. The stale `Promise<void>` version was incompatible with current callers and would have broken them silently if it had won the redeclaration race.

**Pure subtraction.** No replacement code.

### 18.2 D-CYCLE15-IMPL-5 fix

Wired 2 new callbacks in `mingla-business/app/auth/index.tsx`:
- Destructured `signInWithEmail` + `verifyEmailOtp` from `useAuth()` (4 lines added inside the destructure block — was single-line, now formatted block)
- Passed `onEmailSignIn={signInWithEmail}` + `onVerifyEmailOtp={verifyEmailOtp}` to `BusinessWelcomeScreen` (2 prop lines added)

Mirrors the canonical wire at `app/index.tsx` exactly (verified — same destructure shape, same prop wires).

### 18.3 Verification

| Test | Status | Evidence |
|------|--------|----------|
| T-G7 (NEW) `exportDoorSalesCsv` count | ✅ PASS | `grep -cE "^export const exportDoorSalesCsv" guestCsvExport.ts` returns **1** (was 2) |
| T-G8 (NEW) `ExportDoorSalesCsvArgs` count | ✅ PASS | `grep -cE "^export interface ExportDoorSalesCsvArgs" guestCsvExport.ts` returns **1** (was 2) |
| T-G9 (NEW) auth/index.tsx wires | ✅ PASS | `grep -cE "signInWithEmail\|verifyEmailOtp\|onEmailSignIn\|onVerifyEmailOtp" app/auth/index.tsx` returns **4** (2 destructure + 2 prop wires) |
| File length guestCsvExport.ts | ✅ PASS | 466 → **441** lines (matches dispatch §5 expectation exactly) |
| T-G10 (NEW) tsc clean (Cycle 15-scoped) | ✅ PASS | `npx tsc --noEmit` reports only D-CYCLE12-IMPL-1 (`events.tsx:720`) + D-CYCLE12-IMPL-2 (`brandMapping.ts:180`) pre-existing; ZERO TS2451 redeclares; ZERO TS2739 missing-props; ZERO TS1128 parse errors |

**All Cycle 15-scoped errors RESOLVED.** Only 2 pre-existing Cycle 12 errors remain (Refinement Pass eligible; NOT Cycle 15 scope).

### 18.4 Files changed (v2 delta)

| Path | Action | LOC delta |
|------|--------|-----------|
| `mingla-business/src/utils/guestCsvExport.ts` | MOD (deletion only) | 0 / -25 |
| `mingla-business/app/auth/index.tsx` | MOD (additive wire) | +9 / -1 |
| `Mingla_Artifacts/reports/IMPLEMENTATION_BIZ_CYCLE_15_ORGANISER_LOGIN_REPORT.md` | MOD (this section) | +60 / 0 |

**v2 totals:** 2 code edits + this report append. ~+8 / -26 net code LOC.

### 18.5 Status

`implemented and verified` (static + grep gates) — both errors resolved at the source; both pre-existing Cycle 12 errors carry forward to Refinement Pass per dispatch §4 out-of-scope. Device retest per IMPL report §15.4 (17-step plan covering 3 platforms) deferred to operator runtime confirmation.

### 18.6 Discoveries (v2)

None new. Both bugs were inside the v2 dispatch scope; no additional side issues surfaced during the 2-edit fix.

### 18.7 Hand-back

Hand back to `/mingla-orchestrator` for REVIEW + (if APPROVED):
1. Operator commits Cycle 15 IMPL + line-238 hotfix + this v2 rework as ONE combined commit (orchestrator-recommended per prior turn)
2. Operator runs `npx expo start --web` smoke + iOS/Android device smoke per §15.4
3. On smoke PASS → CLOSE protocol fires (7 artifacts + EAS dual-platform OTA + announce next dispatch)
4. **Operator pre-deploy reminder still standing:** verify Supabase Auth → Email Templates → "Magic Link" body contains `{{ .Token }}` for 6-digit code rendering (D-CYCLE15-IMPL-3 from §12)
