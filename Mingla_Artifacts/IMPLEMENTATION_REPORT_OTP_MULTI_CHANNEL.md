# Implementation Report: OTP Multi-Channel Verification (ORCH-0370)

> Date: 2026-04-10
> Spec: SPEC_OTP_MULTI_CHANNEL.md
> Status: implemented, partially verified (needs device testing for WhatsApp/voice delivery)

---

## Files Changed

### 1. supabase/functions/send-otp/index.ts

**What it did before:** Hardcoded `Channel: 'sms'` in Twilio Verify request. No way for mobile to request a different channel.

**What it does now:** Accepts optional `channel` param from request body. Validates against `ALLOWED_CHANNELS` allowlist (`sms`, `whatsapp`, `call`). Defaults to `sms` when omitted. Passes validated channel to Twilio. Echoes channel in success response.

**Why:** SC-01 through SC-09. Primary backend change enabling multi-channel OTP.

**Lines changed:** ~15 (added allowlist constant + type, channel destructuring, validation block, swapped hardcoded value, added channel to response)

### 2. app-mobile/src/services/otpService.ts

**What it did before:** `sendOtp(phone)` — single param, no channel awareness.

**What it does now:** Exports `OtpChannel` type. `sendOtp(phone, channel?)` — optional channel param spread into body. Returns `channel` from server response in `SendOtpResult`.

**Why:** SC-03/SC-04/SC-05. Service layer threading for channel param.

**Lines changed:** ~8 (added type export, updated signature, spread in body, added to interface, populated in return)

### 3. app-mobile/src/components/OnboardingFlow.tsx

**What it did before:** Single "Resend code" link after 30s countdown. Auto-resend via SMS after 3 failed verify attempts. Consent text mentioned "texts" only.

**What it does now:**
- Imports `WhatsAppLogo` from BrandIcons, `OtpChannel` from otpService
- 3 new state vars: `activeChannel`, `channelConfirmation`, `showChannelOptions`
- New `handleResendViaChannel(channel)` handler with per-channel confirmation text
- `handleResendOtp` is now thin wrapper → `handleResendViaChannel('sms')`
- Countdown reaching 0 triggers `setShowChannelOptions(true)`
- 3 failed verifies show channel picker instead of auto-resending SMS
- OTP sub-step renders: channel confirmation subtitle, "Sending..." guard, 3 channel buttons with icons (SMS/WhatsApp/Voice), updated error text
- Consent text: "texts from Mingla" → "messages from Mingla via SMS, WhatsApp, or phone call"
- Accessibility label: "text messages" → "messages"
- 5 new styles using design tokens

**Why:** SC-02 through SC-11. Full UI implementation of fallback channel selection.

**Lines changed:** ~95

---

## Spec Traceability

| SC | Criterion | Implemented | Verified |
|----|-----------|-------------|----------|
| SC-01 | SMS default unchanged | Yes — `handleSendOtp` still calls `sendOtp(e164)` with no channel | PASS (code inspection) |
| SC-02 | Channel options after 30s | Yes — countdown effect sets `showChannelOptions(true)` at 0 | PASS (code inspection) |
| SC-03 | WhatsApp sends with correct channel | Yes — button calls `handleResendViaChannel('whatsapp')` | UNVERIFIED (needs device + Twilio Console) |
| SC-04 | Voice sends with correct channel | Yes — button calls `handleResendViaChannel('call')` | UNVERIFIED (needs device + Twilio Console) |
| SC-05 | SMS resend with channel | Yes — button calls `handleResendViaChannel('sms')` | UNVERIFIED (needs device) |
| SC-06 | Verify works regardless of channel | Yes — verify-otp untouched (channel-agnostic) | PASS (code inspection) |
| SC-07 | Rate limit hides all channels | Yes — "Too many attempts" sets `showChannelOptions(false)` + navigates to phone step | PASS (code inspection) |
| SC-08 | Invalid channel returns 400 | Yes — `ALLOWED_CHANNELS.includes()` check in send-otp | PASS (code inspection) |
| SC-09 | Missing channel defaults to SMS | Yes — `rawChannel ?? 'sms'` in send-otp | PASS (code inspection) |
| SC-10 | Consent text updated | Yes — exact copy from spec | PASS (code inspection) |
| SC-11 | 3 failures show channel picker | Yes — `setShowChannelOptions(true)` replaces `handleResendOtp()` | PASS (code inspection) |

---

## Invariant Verification

| Invariant | Preserved? | How |
|-----------|-----------|-----|
| C-03: No silent failures | Yes | Every error in `handleResendViaChannel` surfaces via `setPhoneError` + haptic + navigation to phone step |
| C-09: No fabricated data | Yes | `channelConfirmation` set only inside `result.success` branch |
| C-12: Validate at the right time | Yes | Server-side allowlist in send-otp. Client buttons are fixed values. |
| Backward compat | Yes | `rawChannel ?? 'sms'` means old clients without channel param get SMS |

---

## Parity Check

N/A — OTP is onboarding-only. No collab mode equivalent. No solo/collab parity needed.

---

## Cache Safety

No query keys affected. OTP uses direct service calls (`trackedInvoke`), not React Query. No cache invalidation needed.

---

## Regression Surface

1. **Default SMS OTP flow** — must still work identically (first send, verify, already_verified skip)
2. **Auto-resend after 3 failures** — now shows channel picker instead of auto-sending; verify the picker appears
3. **Consent checkbox gating** — "Send Code" CTA must still be disabled until checkbox is checked
4. **Phone claimed error** — must still navigate back to phone step when phone is already associated
5. **Rate limit handling** — 429 must still show correct error and hide channel options

---

## Surprises

None. The spec was precise and the code matched expectations. All imports (`WhatsAppLogo`, `Icon` name mappings, design tokens) were available as documented.

---

## Discoveries for Orchestrator

None new (side issues already flagged in investigation: PII in server logs, inconsistent Twilio env var naming).

---

## What Still Needs Testing

1. **Device testing** — channel buttons render correctly on iOS/Android
2. **WhatsApp delivery** — requires WhatsApp Business Account configured in Twilio Console
3. **Voice call delivery** — requires a real phone number to receive the call
4. **Channel switch flow** — send SMS, then WhatsApp, verify with WhatsApp code
5. **Rate limit cross-channel** — exhaust SMS attempts, try WhatsApp, confirm 429
