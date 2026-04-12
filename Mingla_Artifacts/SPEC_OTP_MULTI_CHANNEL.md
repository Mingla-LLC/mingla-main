# Spec: OTP Multi-Channel Verification — WhatsApp & Voice Fallbacks (ORCH-0370)

> Date: 2026-04-10
> Investigation: `Mingla_Artifacts/INVESTIGATION_OTP_MULTI_CHANNEL_REPORT.md`
> Root cause: N/A — new feature
> Status: ready for implementation

---

## 1. Layman Summary

Right now, if your phone doesn't receive the SMS verification code during sign-up, you're stuck. There's no other way to get the code. This spec adds two fallback options: WhatsApp and voice call. After the initial SMS is sent, if you haven't received it, you'll see buttons to resend via SMS, get the code on WhatsApp, or have Mingla call you and read it out loud. The default flow (SMS) doesn't change at all.

---

## 2. User Story

As a new user verifying my phone number during onboarding, I want to receive my verification code via WhatsApp or phone call when SMS doesn't arrive, so that I can complete sign-up regardless of carrier issues or connectivity.

---

## 3. Scope

- **In scope:**
  - `send-otp` edge function: accept optional `channel` parameter
  - `otpService.ts`: thread `channel` through `sendOtp()`
  - `OnboardingFlow.tsx`: alternate channel UI on OTP sub-step, consent text update
- **Non-goals:**
  - `verify-otp` changes (proven channel-agnostic — investigation F-02)
  - `send-phone-invite` / `send-pair-request` changes (different Twilio API)
  - Auto-cascade (SMS → WhatsApp → voice automatically)
  - Persisted channel preference
  - `email`, `sna`, or `auto` channels
- **Assumptions:**
  - WhatsApp Business Account + Sender configured in Twilio Console before deploy
  - Voice channel enabled by default on Verify Service (confirmed)

---

## 4. Success Criteria

| # | Criterion |
|---|-----------|
| SC-01 | User taps "Send Code" → SMS fires (default, zero change to happy path) |
| SC-02 | On OTP sub-step, after 30s countdown expires, user sees three options: "Resend SMS", "Send via WhatsApp", "Call me instead" |
| SC-03 | Tapping "Send via WhatsApp" calls `send-otp` with `channel: 'whatsapp'` → on success, subtitle updates to "Code sent via WhatsApp" and countdown resets to 30s |
| SC-04 | Tapping "Call me instead" calls `send-otp` with `channel: 'call'` → on success, subtitle updates to "Calling you now..." and countdown resets to 30s |
| SC-05 | Tapping "Resend SMS" calls `send-otp` with `channel: 'sms'` (or no channel) → subtitle updates to "Code re-sent via SMS" and countdown resets to 30s |
| SC-06 | Verifying the 6-digit code works identically regardless of which channel delivered it (verify-otp is unchanged) |
| SC-07 | Rate limit error (HTTP 429 / Twilio 60203) hides all channel options and shows "Too many attempts. Try again later." |
| SC-08 | Invalid `channel` value in request body returns HTTP 400 with `{ error: "Invalid channel..." }` |
| SC-09 | Omitting `channel` from request body defaults to `sms` — backward compatible with older mobile clients |
| SC-10 | Consent checkbox text covers SMS, WhatsApp, and voice (exact copy in Section 10) |
| SC-11 | After 3 failed verify attempts, instead of auto-resending SMS, show channel selection (same UI as SC-02) |

---

## 5. Invariants

### Must Preserve

| Invariant | How Implementation Preserves It |
|-----------|-------------------------------|
| C-03: No silent failures | Every Twilio error surfaces to user via `phoneError` or `otpError` state. No silent channel fallback. |
| C-09: No fabricated data | Subtitle text only updates after `sendOtp()` returns `success: true`. On failure, shows the error. |
| C-12: Validate at the right time | `channel` validated server-side against allowlist. Client only sends values from a fixed set of buttons. |
| Backward compat | `channel` defaults to `'sms'` when absent from request body. No breaking change for older clients. |

### New Invariants Established

| Invariant | Enforcement | Test |
|-----------|-------------|------|
| OTP channel must be one of `sms`, `whatsapp`, `call` | Server-side allowlist check in `send-otp` returns 400 for anything else | T-08 |

---

## 6. Database Changes

None. This is purely a code change across edge function, service, and component layers.

---

## 7. Edge Functions

### send-otp (MODIFY)

- **Method:** POST
- **Route:** `/functions/v1/send-otp`
- **Auth:** Required — validates JWT at entry (unchanged)

**Request (updated):**

```typescript
interface SendOtpRequest {
  phone: string;    // required — E.164 format, validated by E164_REGEX
  channel?: string; // optional — 'sms' | 'whatsapp' | 'call', defaults to 'sms'
}
```

**Validation (new — add after phone validation, before Twilio call):**

```typescript
const ALLOWED_CHANNELS = ['sms', 'whatsapp', 'call'] as const;
const channel = body.channel ?? 'sms';
if (!ALLOWED_CHANNELS.includes(channel)) {
  // return 400
}
```

**Twilio call (line 115 — change):**

```typescript
// BEFORE:
body: new URLSearchParams({ To: phone, Channel: 'sms' }),

// AFTER:
body: new URLSearchParams({ To: phone, Channel: channel }),
```

**Response (success — updated):**

```typescript
// 200:
{ success: true, status: string, channel: string }
// channel echoed back so mobile knows which channel was used
```

**Response (errors — unchanged + new):**

```typescript
// 400 (new): { error: "Invalid channel. Must be sms, whatsapp, or call." }
// 400 (existing): { error: "Invalid phone number format" }
// 401 (existing): { error: "Unauthorized" }
// 409 (existing): { error: "This phone number is already associated with another account." }
// 429 (existing): { error: "Too many attempts. Try again later." }
// 500 (existing): { error: "Couldn't send code. Try again." }
```

**External calls:** Twilio Verify API `POST /v2/Services/{ServiceSid}/Verifications` — unchanged endpoint, only `Channel` value varies.

### verify-otp (NO CHANGES)

Confirmed channel-agnostic. `VerificationCheck` uses `To` + `Code` only.

---

## 8. Service Layer

### otpService.ts — sendOtp (MODIFY)

- **Path:** `app-mobile/src/services/otpService.ts`

**Signature (updated):**

```typescript
type OtpChannel = 'sms' | 'whatsapp' | 'call';

export async function sendOtp(
  phone: string,
  channel?: OtpChannel
): Promise<SendOtpResult>
```

**Body construction (updated):**

```typescript
const { data, error } = await trackedInvoke('send-otp', {
  body: { phone, ...(channel && { channel }) },
})
```

**Return type (updated — add channel):**

```typescript
interface SendOtpResult {
  success: boolean;
  error?: string;
  status?: string;
  channel?: OtpChannel; // echo from server
}
```

Populate `channel` from `data?.channel` in the success path.

### otpService.ts — verifyOtp (NO CHANGES)

---

## 9. Hook Layer

None. OTP uses direct service calls, not React Query hooks.

---

## 10. Component Layer

### OnboardingFlow.tsx (MODIFY)

**Path:** `app-mobile/src/components/OnboardingFlow.tsx`

#### New Import

```typescript
import { WhatsAppLogo } from './ui/BrandIcons'
```

(Icon component already imported. `'call'` maps to `Phone` icon. `'message-square'` maps to `MessageSquare` for SMS.)

#### New Type

```typescript
type OtpChannel = 'sms' | 'whatsapp' | 'call';
```

(Same type as in otpService — can also be imported from there if exported.)

#### New State (add near line 756, after `otpAttempts`)

```typescript
const [activeChannel, setActiveChannel] = useState<OtpChannel>('sms')
const [channelConfirmation, setChannelConfirmation] = useState<string | null>(null)
const [showChannelOptions, setShowChannelOptions] = useState(false)
```

- `activeChannel`: which channel was last used to send. Defaults to `'sms'`.
- `channelConfirmation`: subtitle text like "Code sent via WhatsApp". Null = default subtitle.
- `showChannelOptions`: whether to show the 3-channel picker. True after countdown hits 0 or after 3 failed attempts.

#### Handler Changes

**handleSendOtp (line 1126) — minimal change:**

Add `setActiveChannel('sms')` after successful send. No other changes — first send is always SMS.

```typescript
// After result.success && !already_verified:
setActiveChannel('sms')
setChannelConfirmation(null)
setShowChannelOptions(false)
setResendCountdown(30)
```

**handleResendOtp (line 1162) — replace with channel-aware version:**

```typescript
const handleResendViaChannel = useCallback(async (channel: OtpChannel) => {
  logger.action(`Resend OTP via ${channel}`)
  setSendingOtp(true)
  setChannelConfirmation(null)
  const result = await sendOtp(buildE164(), channel)
  setSendingOtp(false)
  if (result.success) {
    if (result.status === 'already_verified') {
      logger.onboarding('Server says phone already verified on resend — skipping OTP')
      setData((prev) => ({ ...prev, phoneVerified: true }))
      goToSubStep('gender_identity')
      return
    }
    setActiveChannel(channel)
    setShowChannelOptions(false)
    setResendCountdown(30)
    // Set confirmation text based on channel
    switch (channel) {
      case 'sms':
        setChannelConfirmation('Code re-sent via SMS')
        break
      case 'whatsapp':
        setChannelConfirmation('Code sent via WhatsApp')
        break
      case 'call':
        setChannelConfirmation('Calling you now...')
        break
    }
  } else {
    if (result.error?.includes('already associated')) {
      setPhoneError(result.error)
      setOtpCode('')
      setOtpAttempts(0)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      goToSubStep('phone')
      return
    }
    // Rate limit — hide channel options, show error
    if (result.error?.includes('Too many attempts')) {
      setShowChannelOptions(false)
    }
    setPhoneError(result.error || "Couldn't send code. Try again.")
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    goToSubStep('phone')
  }
}, [buildE164, goToSubStep])
```

**Keep `handleResendOtp` as a thin wrapper** for backward compat with auto-resend:

```typescript
const handleResendOtp = useCallback(() => {
  handleResendViaChannel('sms')
}, [handleResendViaChannel])
```

**handleVerifyOtp (line 1194) — change auto-resend behavior at line 1230:**

```typescript
// BEFORE (line 1230-1234):
if (otpAttempts >= 2) {
  setOtpCode('')
  setOtpAttempts(0)
  handleResendOtp()
}

// AFTER:
if (otpAttempts >= 2) {
  setOtpCode('')
  setOtpAttempts(0)
  setShowChannelOptions(true) // Show channel picker instead of auto-resend
}
```

**Countdown effect — trigger `showChannelOptions` when countdown hits 0:**

Find the existing countdown `useEffect` (decrements `resendCountdown`). At the end, when countdown reaches 0:

```typescript
if (prev <= 1) {
  setShowChannelOptions(true)
  return 0
}
```

#### UI Changes — OTP Sub-Step (line 2042-2078)

Replace the existing resend row (lines 2060-2068) with the channel-aware version:

**Subtitle (after "Sent to {buildE164()}"):**

```tsx
{channelConfirmation && (
  <Text style={styles.channelConfirmation}>{channelConfirmation}</Text>
)}
```

**Resend section replacement:**

```tsx
{otpLoading ? (
  <Text style={[styles.caption, styles.textCenter]}>Verifying...</Text>
) : sendingOtp ? (
  <Text style={[styles.caption, styles.textCenter]}>Sending...</Text>
) : (
  <>
    {resendCountdown > 0 && !showChannelOptions ? (
      <View style={styles.resendRow}>
        <Text style={styles.caption}>Resend in {resendCountdown}s</Text>
      </View>
    ) : showChannelOptions ? (
      <View style={styles.channelOptions}>
        <Text style={styles.channelOptionsLabel}>Didn't get it? Try another way:</Text>

        <Pressable
          style={styles.channelButton}
          onPress={() => handleResendViaChannel('sms')}
          accessibilityRole="button"
          accessibilityLabel="Resend code via SMS"
        >
          <Icon name="message-square" size={18} color={colors.text.secondary} />
          <Text style={styles.channelButtonText}>Resend SMS</Text>
        </Pressable>

        <Pressable
          style={styles.channelButton}
          onPress={() => handleResendViaChannel('whatsapp')}
          accessibilityRole="button"
          accessibilityLabel="Send code via WhatsApp"
        >
          <WhatsAppLogo size={18} color={colors.text.secondary} />
          <Text style={styles.channelButtonText}>Send via WhatsApp</Text>
        </Pressable>

        <Pressable
          style={styles.channelButton}
          onPress={() => handleResendViaChannel('call')}
          accessibilityRole="button"
          accessibilityLabel="Receive code via phone call"
        >
          <Icon name="call" size={18} color={colors.text.secondary} />
          <Text style={styles.channelButtonText}>Call me instead</Text>
        </Pressable>
      </View>
    ) : null}

    {otpError && (
      <Text style={styles.errorText}>
        {otpAttempts >= 3
          ? "Three tries, no luck. Try a different method below."
          : "That code didn't land. Try again."}
      </Text>
    )}
  </>
)}
```

#### Consent Text Update (line 2006-2007)

```
BEFORE:
"I agree to receive texts from Mingla, including verification codes, friend
invitations, and experience reminders. Reply STOP to opt out or HELP for help."

AFTER:
"I agree to receive messages from Mingla via SMS, WhatsApp, or phone call,
including verification codes, friend invitations, and experience reminders.
Reply STOP to opt out or HELP for help."
```

Also update the accessibility label on the consent `Pressable` (line 1997):

```
BEFORE: "Agree to receive text messages from Mingla"
AFTER:  "Agree to receive messages from Mingla"
```

#### New Styles (add to StyleSheet.create)

```typescript
channelConfirmation: {
  ...typography.sm,
  color: colors.success[600],
  textAlign: 'center' as const,
  marginTop: spacing.xs,
},
channelOptions: {
  marginTop: spacing.md,
  gap: spacing.sm,
},
channelOptionsLabel: {
  ...typography.sm,
  fontWeight: fontWeights.medium,
  color: colors.text.secondary,
  marginBottom: spacing.xs,
},
channelButton: {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  paddingVertical: spacing.sm,
  paddingHorizontal: spacing.md,
  borderRadius: radius.md,
  borderWidth: 1,
  borderColor: colors.gray[200],
  backgroundColor: colors.background.secondary,
  gap: spacing.sm,
},
channelButtonText: {
  ...typography.sm,
  fontWeight: fontWeights.medium,
  color: colors.text.primary,
},
```

#### States Matrix

| State | Condition | Renders |
|-------|-----------|---------|
| Default (just sent) | `resendCountdown > 0 && !showChannelOptions` | "Resend in {N}s" countdown text |
| Channel options visible | `showChannelOptions && !sendingOtp` | Three channel buttons + "Didn't get it?" label |
| Sending via channel | `sendingOtp` | "Sending..." text, all buttons hidden |
| Verifying code | `otpLoading` | "Verifying..." text, OTPInput disabled |
| Channel confirmation | `channelConfirmation != null` | Green subtitle below phone number (e.g., "Code sent via WhatsApp") |
| Rate limited | `phoneError` contains "Too many" | Navigates back to phone sub-step, error shown, channel options hidden |
| 3 failed verifies | `otpAttempts >= 3` | Code cleared, channel options shown (replaces auto-resend) |

#### Haptics

- Channel button press: none (it triggers network call, haptic on result)
- Channel send success: none (countdown reset + confirmation text is sufficient feedback)
- Channel send failure: `Haptics.notificationAsync(NotificationFeedbackType.Error)` (existing pattern from `handleResendOtp`)

#### Accessibility

| Element | Role | Label |
|---------|------|-------|
| SMS button | `button` | "Resend code via SMS" |
| WhatsApp button | `button` | "Send code via WhatsApp" |
| Voice button | `button` | "Receive code via phone call" |
| Consent checkbox | `checkbox` | "Agree to receive messages from Mingla" (updated) |
| Channel confirmation | none (decorative text) | — |

---

## 11. Realtime

None.

---

## 12. Implementation Order

1. **`supabase/functions/send-otp/index.ts`** — Add `channel` to request body destructuring, validate against allowlist, pass to Twilio, echo in response. Deploy edge function.
2. **`app-mobile/src/services/otpService.ts`** — Add `OtpChannel` type, update `sendOtp` signature, pass `channel` in body, return `channel` in result.
3. **`app-mobile/src/components/OnboardingFlow.tsx`** — Add imports, state, `handleResendViaChannel`, update `handleVerifyOtp` auto-resend, update OTP sub-step UI, update consent text, add styles.

Edge function first so it's deployed and accepting the new param before mobile sends it. Mobile changes are additive and backward-safe (existing `sendOtp(phone)` with no channel sends `undefined` which server defaults to `sms`).

---

## 13. Test Cases

| ID | Scenario | Input | Expected | Layer |
|----|----------|-------|----------|-------|
| T-01 | Happy path — SMS (unchanged) | Tap "Send Code" | SMS sent, advance to OTP step, 30s countdown | Full stack |
| T-02 | Resend via SMS | Wait 30s, tap "Resend SMS" | `send-otp` called with `channel: 'sms'`, subtitle "Code re-sent via SMS", countdown resets | Full stack |
| T-03 | Send via WhatsApp | Wait 30s, tap "Send via WhatsApp" | `send-otp` called with `channel: 'whatsapp'`, subtitle "Code sent via WhatsApp", countdown resets | Full stack |
| T-04 | Send via voice | Wait 30s, tap "Call me instead" | `send-otp` called with `channel: 'call'`, subtitle "Calling you now...", countdown resets | Full stack |
| T-05 | Verify after channel switch | Send via WhatsApp, enter 6-digit code | `verify-otp` succeeds (channel-agnostic), advance to gender_identity | Full stack |
| T-06 | Channel switch cancels previous code | Send SMS, then send WhatsApp, enter SMS code | `verify-otp` returns "Incorrect code" (old SMS code invalidated) | Full stack |
| T-07 | Rate limit blocks all channels | Trigger 429 on SMS, tap "Send via WhatsApp" | WhatsApp also returns 429, navigates to phone step with "Too many attempts" error | Full stack |
| T-08 | Invalid channel (server) | `POST send-otp { phone: "+1...", channel: "email" }` | HTTP 400, `{ error: "Invalid channel..." }` | Edge function |
| T-09 | Missing channel (backward compat) | `POST send-otp { phone: "+1..." }` | Defaults to SMS, HTTP 200 | Edge function |
| T-10 | 3 failed verifies → channel picker | Enter wrong code 3 times | Code cleared, channel options shown (NOT auto-resend) | Component |
| T-11 | Countdown → channel options appear | Send OTP, wait 30 seconds | Channel options (3 buttons) appear when countdown hits 0 | Component |
| T-12 | Sending state disables all buttons | Tap "Send via WhatsApp" | "Sending..." text shown, no buttons visible until response | Component |
| T-13 | Phone already verified — skip | Phone already in profile | `already_verified` response, skip OTP entirely | Full stack |
| T-14 | Phone claimed during verify | Another user claims phone between send and verify | "already associated" error, navigate to phone step | Full stack |
| T-15 | Consent text updated | Read consent checkbox | Text mentions SMS, WhatsApp, and phone call | Component |
| T-16 | Accessibility — channel buttons | VoiceOver / TalkBack | Each button announces its role and label correctly | Component |

---

## 14. Regression Prevention

- **Structural safeguard:** Server-side `ALLOWED_CHANNELS` allowlist. Any new channel requires explicit addition. Unknown values rejected with 400.
- **Test:** T-08 (invalid channel returns 400) and T-09 (missing channel defaults to SMS) catch drift.
- **Protective comment:** Add above the allowlist in `send-otp`:
  ```
  // ALLOWED_CHANNELS: Twilio Verify channel allowlist.
  // WhatsApp requires Console setup (WhatsApp Sender on Verify Service).
  // Voice is enabled by default. Do not add 'auto' or 'sna' without reviewing
  // investigation ORCH-0370 for UX and rate-limit implications.
  ```

---

## 15. Common Mistakes

1. **Mistake:** Passing `channel` in the `verify-otp` call. **Avoidance:** Don't. VerificationCheck is channel-agnostic. Only `send-otp` needs it.

2. **Mistake:** Using `handleResendOtp()` (the old SMS-only function) in new UI buttons. **Avoidance:** All channel buttons call `handleResendViaChannel(channel)`. The old `handleResendOtp` is only kept as a thin `handleResendViaChannel('sms')` wrapper.

3. **Mistake:** Showing channel options while `sendingOtp` is true (double-tap sends two requests). **Avoidance:** When `sendingOtp` is true, render only "Sending..." text — no buttons.

4. **Mistake:** Forgetting to reset `channelConfirmation` on error. **Avoidance:** `setChannelConfirmation(null)` at the start of `handleResendViaChannel`, before the `sendOtp` call.

5. **Mistake:** Setting channel confirmation text before confirming Twilio success (C-09 violation). **Avoidance:** Confirmation text is set only inside the `if (result.success)` branch.

6. **Mistake:** Offering alternate channels after rate limit exhaustion. **Avoidance:** When error contains "Too many attempts", `setShowChannelOptions(false)` hides all channel buttons.

---

## 16. Rollback Safety

- **Database:** No migration. No rollback needed.
- **Edge function:** Revert `send-otp` to hardcoded `Channel: 'sms'`. Unknown `channel` param in request body is harmlessly ignored (it was destructured but the revert removes the destructuring). Zero risk.
- **Mobile:** Revert service + component. Since `channel` is optional and server defaults to `sms`, even if a new mobile build sends `channel: undefined` to an old edge function, it works (URLSearchParams omits undefined values).
- **Risk:** Partial rollback (edge function reverted but mobile not) is safe — mobile sends `channel: 'whatsapp'` to server that ignores it and sends SMS. User gets SMS. Not ideal UX but not broken.

---

## 17. Handoff to Implementor

Build in this order: (1) `send-otp` edge function — destructure `channel` from body, validate against `['sms', 'whatsapp', 'call']`, default to `'sms'`, pass to Twilio's `Channel` param, echo in response. Deploy. (2) `otpService.ts` — add optional `channel` param to `sendOtp()`, include in body, return in result. (3) `OnboardingFlow.tsx` — add `WhatsAppLogo` import, three new state vars (`activeChannel`, `channelConfirmation`, `showChannelOptions`), new `handleResendViaChannel` handler, update auto-resend to show channel picker instead of auto-retry, replace resend row UI with channel buttons, update consent text, add 5 new styles.

Watch out for: don't touch `verify-otp` or `handleVerifyOtp` internals (only the auto-resend branch changes). Don't auto-cascade channels. Don't persist channel preference. Keep the "Sending..." guard to prevent double-tap. Test with `channel` omitted to confirm backward compatibility.
