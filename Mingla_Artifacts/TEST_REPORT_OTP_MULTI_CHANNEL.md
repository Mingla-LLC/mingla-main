# Test Report: OTP Multi-Channel Verification (ORCH-0370)

> Tester: Mingla Tester | Date: 2026-04-10
> Spec: SPEC_OTP_MULTI_CHANNEL.md
> Implementation: IMPLEMENTATION_REPORT_OTP_MULTI_CHANNEL.md
> Mode: SPEC-COMPLIANCE (orchestrator dispatch)

---

## Verdict: PASS

All 16 test cases pass. Zero P0/P1/P2 issues. Implementation matches spec exactly.

---

## Test Matrix Results

### T-01: Happy path — SMS (unchanged)
**Input:** `handleSendOtp` → calls `sendOtp(e164)` with no channel param
**Expected:** SMS sent, advance to OTP step, 30s countdown
**Actual:** Line 1153: `sendOtp(e164)` — no channel. Line 1163-1168: sets `activeChannel('sms')`, `channelConfirmation(null)`, `showChannelOptions(false)`, `resendCountdown(30)`, `otpAttempts(0)`, calls `goNext()`. Service sends `{ phone }` only (line 23 otpService: spread is no-op when `channel` is undefined). Edge function defaults `rawChannel ?? 'sms'` (line 54).
**Result: PASS** — default flow is 100% unchanged for end user.

### T-02: Resend via SMS
**Input:** Wait 30s, tap "Resend SMS" button
**Expected:** `send-otp` called with `channel: 'sms'`, subtitle "Code re-sent via SMS", countdown resets
**Actual:** Button at line 2110: `onPress={() => handleResendViaChannel('sms')}`. Handler (line 1175) calls `sendOtp(buildE164(), 'sms')`. On success: `setActiveChannel('sms')`, `setShowChannelOptions(false)`, `setResendCountdown(30)`, `setChannelConfirmation('Code re-sent via SMS')` (line 1194).
**Result: PASS**

### T-03: Send via WhatsApp
**Input:** Wait 30s, tap "Send via WhatsApp" button
**Expected:** `send-otp` called with `channel: 'whatsapp'`, subtitle "Code sent via WhatsApp", countdown resets
**Actual:** Button at line 2119: `onPress={() => handleResendViaChannel('whatsapp')}`. Handler calls `sendOtp(buildE164(), 'whatsapp')`. Service spreads `{ phone, channel: 'whatsapp' }` (line 23). Edge function validates against allowlist (line 55), passes to Twilio `Channel: 'whatsapp'` (line 129). On success: `setChannelConfirmation('Code sent via WhatsApp')` (line 1197).
**Result: PASS** (code path verified; actual WhatsApp delivery requires Twilio Console setup)

### T-04: Send via voice
**Input:** Wait 30s, tap "Call me instead" button
**Expected:** `send-otp` called with `channel: 'call'`, subtitle "Calling you now...", countdown resets
**Actual:** Button at line 2128: `onPress={() => handleResendViaChannel('call')}`. Same flow as T-03 but with `'call'`. On success: `setChannelConfirmation('Calling you now...')` (line 1200).
**Result: PASS** (code path verified; actual voice delivery requires device testing)

### T-05: Verify after channel switch
**Input:** Send via WhatsApp, enter 6-digit code
**Expected:** `verify-otp` succeeds (channel-agnostic), advance to gender_identity
**Actual:** `handleVerifyOtp` (line 1229) calls `verifyOtp(buildE164(), code)`. `verifyOtp` in otpService (line 43) sends `{ phone, code }` to `verify-otp` edge function — no channel param. `verify-otp/index.ts` confirmed untouched (git diff = empty). Twilio VerificationCheck uses `To` + `Code` only (investigation F-02 proven).
**Result: PASS**

### T-06: Channel switch cancels previous code
**Input:** Send SMS, then send WhatsApp, enter SMS code
**Expected:** `verify-otp` returns "Incorrect code" (old SMS code invalidated by Twilio)
**Actual:** Code-level: new `handleResendViaChannel('whatsapp')` creates new Twilio Verification for same `To` number. Per Twilio API contract (investigation): this implicitly cancels pending SMS verification. Old code becomes invalid. `verify-otp` would return `status: 'pending'` → our code returns `{ error: 'Incorrect code' }` (verify-otp line 172).
**Result: PASS** (Twilio behavior confirmed by API contract; full-stack runtime requires device test)

### T-07: Rate limit blocks all channels
**Input:** Trigger 429 on SMS, tap "Send via WhatsApp"
**Expected:** WhatsApp also returns 429, navigates to phone step with "Too many attempts"
**Actual:** Edge function line 136-140: catches `status === 429 || code === 60203` → returns `{ error: 'Too many attempts. Try again later.' }` regardless of channel. Mobile handler line 1214: `result.error?.includes('Too many attempts')` → `setShowChannelOptions(false)`. Line 1217-1219: sets `phoneError`, haptic, navigates to phone step.
**Result: PASS** — rate limit hides ALL channel options, not just the triggering one.

### T-08: Invalid channel (server)
**Input:** `POST send-otp { phone: "+1...", channel: "email" }`
**Expected:** HTTP 400, `{ error: "Invalid channel. Must be sms, whatsapp, or call." }`
**Actual:** Edge function line 54: `rawChannel ?? 'sms'` → `channel = 'email'`. Line 55: `ALLOWED_CHANNELS.includes('email')` → false. Line 56-59: returns 400 with exact error message.
**Result: PASS**

### T-09: Missing channel (backward compat)
**Input:** `POST send-otp { phone: "+1..." }` (no channel field)
**Expected:** Defaults to SMS, HTTP 200
**Actual:** Edge function line 46: `{ phone, channel: rawChannel }` → `rawChannel = undefined`. Line 54: `undefined ?? 'sms'` → `channel = 'sms'`. Line 55: `ALLOWED_CHANNELS.includes('sms')` → true. Line 129: `Channel: 'sms'`. Line 149: response includes `channel: 'sms'`.
**Result: PASS**

### T-10: 3 failed verifies → channel picker
**Input:** Enter wrong code 3 times
**Expected:** Code cleared, channel options shown (NOT auto-resend)
**Actual:** `handleVerifyOtp` line 1265: `if (otpAttempts >= 2)` (0-indexed: 3rd failure). Line 1267-1269: `setOtpCode('')`, `setOtpAttempts(0)`, `setShowChannelOptions(true)`. No call to `handleResendOtp()` — removed. The old auto-resend is gone.
**Result: PASS**

### T-11: Countdown → channel options appear
**Input:** Send OTP, wait 30 seconds
**Expected:** Channel options (3 buttons) appear when countdown hits 0
**Actual:** Countdown useEffect (line 1087): `setResendCountdown((prev) => { if (prev <= 1) { setShowChannelOptions(true); return 0 } return prev - 1 })`. At 1→0 transition, `showChannelOptions` becomes true. UI (line 2105): `showChannelOptions ?` renders the 3-button channel picker.
**Result: PASS**

### T-12: Sending state disables all buttons
**Input:** Tap "Send via WhatsApp"
**Expected:** "Sending..." text shown, no buttons visible until response
**Actual:** `handleResendViaChannel` line 1177: `setSendingOtp(true)` before `sendOtp()`. UI line 2097: `sendingOtp ?` renders `<Text>Sending...</Text>` — the entire channel options block is inside the `: (` else branch, so it's hidden. After response: line 1180 `setSendingOtp(false)`.
**Result: PASS** — double-tap guard is solid.

### T-13: Phone already verified — skip
**Input:** Phone already in profile
**Expected:** `already_verified` response, skip OTP entirely
**Actual:** Two paths: (1) `handleSendOtp` line 1139: `data.phoneVerified` → skip to gender_identity (client-side). (2) Edge function line 75: `profile?.phone === phone` → returns `{ success: true, status: 'already_verified' }`. Mobile line 1157-1161: detects `already_verified`, marks phoneVerified, skips. Also works in `handleResendViaChannel` (line 1183-1187).
**Result: PASS**

### T-14: Phone claimed during verify
**Input:** Another user claims phone between send and verify
**Expected:** "already associated" error, navigate to phone step
**Actual:** `handleVerifyOtp` line 1253: `result.error?.includes('already associated')` → sets phoneError, clears code/attempts, haptic error, navigates to phone step. Also handled in `handleResendViaChannel` (line 1205-1211).
**Result: PASS**

### T-15: Consent text updated
**Input:** Read consent checkbox text
**Expected:** Text mentions SMS, WhatsApp, and phone call
**Actual:** Line 2042: `"I agree to receive messages from Mingla via SMS, WhatsApp, or phone call, including verification codes, friend invitations, and experience reminders. Reply STOP to opt out or HELP for help."` Accessibility label (line 2032): `"Agree to receive messages from Mingla"`.
**Result: PASS** — exact copy from spec.

### T-16: Accessibility — channel buttons
**Input:** VoiceOver / TalkBack inspection
**Expected:** Each button announces its role and label correctly
**Actual:** SMS button (line 2111-2112): `accessibilityRole="button"` + `accessibilityLabel="Resend code via SMS"`. WhatsApp (line 2120-2121): `accessibilityRole="button"` + `accessibilityLabel="Send code via WhatsApp"`. Voice (line 2129-2130): `accessibilityRole="button"` + `accessibilityLabel="Receive code via phone call"`. All match spec Section 10 accessibility table.
**Result: PASS**

---

## Additional Checks

| Check | Result | Evidence |
|-------|--------|----------|
| `verify-otp/index.ts` NOT modified | PASS | `git diff HEAD -- supabase/functions/verify-otp/index.ts` = empty |
| `send-phone-invite/index.ts` NOT modified | PASS | `git diff HEAD -- supabase/functions/send-phone-invite/index.ts` = empty |
| `send-pair-request/index.ts` NOT modified | PASS | `git diff HEAD -- supabase/functions/send-pair-request/index.ts` = empty |
| No new files created | PASS | `git diff HEAD --name-only --diff-filter=A` = empty (only CRLF warnings on unrelated mingla-business) |
| No database migrations | PASS | No files in `supabase/migrations/` changed |
| Default SMS flow unchanged | PASS | T-01 proven |
| `handleSendOtp` calls `sendOtp(e164)` without channel | PASS | Line 1153 |
| `handleResendOtp` exists as thin wrapper | PASS | Line 1224-1226: `handleResendViaChannel('sms')` |
| Channel confirmation only after `result.success` | PASS | Lines 1192-1202: switch inside `if (result.success)` block only |
| Error navigates to phone step | PASS | Lines 1217-1219: `goToSubStep('phone')` |
| Rate limit hides ALL channel options | PASS | Line 1214-1215: `setShowChannelOptions(false)` |
| Consent checkbox gates CTA | PASS | Line 1851: `disabled: !isPhoneValid() \|\| !smsConsentChecked` |
| New styles use design tokens | PASS | Lines 3329-3360: all use `typography`, `colors`, `spacing`, `radius`, `fontWeights` |
| TypeScript: zero new errors | PASS | 8 errors in OnboardingFlow all at lines 2439-2496 (location step, pre-existing). Zero in otpService. |

---

## Constitutional Compliance

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| C-01 | No dead taps | PASS | All 3 channel buttons have `onPress` handlers |
| C-02 | One owner per truth | PASS | Channel state owned by OnboardingFlow only |
| C-03 | No silent failures | PASS | Every error path surfaces via `phoneError` + haptic + navigation |
| C-04 | One key per entity | N/A | No React Query changes |
| C-05 | Server state server-side | PASS | Channel is ephemeral local state, not Zustand |
| C-06 | Logout clears | N/A | Onboarding = pre-auth |
| C-07 | Label temporary | N/A | No transitional items |
| C-08 | Subtract before adding | PASS | Old `handleResendOtp` body replaced, not layered on top |
| C-09 | No fabricated data | PASS | Confirmation text set only inside `result.success` branch |
| C-10 | Currency-aware | N/A | No currency display |
| C-11 | One auth instance | N/A | Auth unchanged |
| C-12 | Validate at right time | PASS | Server-side allowlist; client sends from fixed button set |
| C-13 | Exclusion consistency | N/A | No exclusion logic |
| C-14 | Persisted-state startup | N/A | OTP is ephemeral, not persisted |

---

## Parity Check

N/A — OTP is onboarding-only. No solo/collab parity. No admin equivalent.

---

## Regressions Found

None.

---

## Edge Cases Discovered During Testing

None beyond what the spec already identified and the implementation handles.

---

## Severity Summary

| Severity | Count |
|----------|-------|
| P0 — Critical | 0 |
| P1 — High | 0 |
| P2 — Medium | 0 |
| P3 — Low | 0 |
| P4 — Note | 1 |

### P4-01: Good pattern — channel handler design (NOTE)

`handleResendViaChannel` cleanly unifies all three channels with per-channel confirmation text via switch statement, while keeping `handleResendOtp` as a thin wrapper for backward compat. This avoids code duplication and makes adding future channels (e.g., `rcs`) trivial.

---

## Recommendations for Orchestrator

1. **Twilio Console setup is prerequisite.** WhatsApp requires Business Account + Sender configured on the Verify Service. Voice is enabled by default. Neither can be tested end-to-end until Console is configured.
2. **Device runtime testing recommended** before promoting to A grade: confirm buttons render correctly on physical device, WhatsApp message actually arrives, voice call TTS works.
3. **Pre-existing TS warnings** (8x TS2367 in location step) are unrelated to this change but should be tracked if not already.

---

## Discoveries for Orchestrator

None new. Side issues (PII in server logs, env var naming inconsistency) were already flagged in the investigation report.
