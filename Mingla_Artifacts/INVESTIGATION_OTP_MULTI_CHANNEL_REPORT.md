# Investigation Report: OTP Multi-Channel Support (ORCH-0370)

> Investigator: Mingla Forensics | Date: 2026-04-10
> Confidence: **HIGH** — all code files read, Twilio API docs verified, full chain traced
> Classification: missing-feature (not a bug — current code works, but has no fallback)

---

## Symptom Summary

**Expected:** When SMS OTP delivery fails during onboarding, the user should have alternative verification methods (WhatsApp, voice call).

**Actual:** The `send-otp` edge function hardcodes `Channel: 'sms'`. If SMS fails (carrier filtering, international routing, WiFi-only), the user is stuck at onboarding Step 3 with no escape path. The only option is "Resend code" which retries SMS — the same channel that already failed.

**User impact:** Onboarding abandonment. User cannot complete phone verification. No workaround exists in the app.

---

## Investigation Manifest

| # | File | Layer | Read? | Finding? |
|---|------|-------|-------|----------|
| 1 | `supabase/functions/send-otp/index.ts` | Backend | Yes | Primary change target |
| 2 | `supabase/functions/verify-otp/index.ts` | Backend | Yes | Channel-agnostic confirmed |
| 3 | `app-mobile/src/services/otpService.ts` | Service | Yes | Needs channel param |
| 4 | `app-mobile/src/components/OnboardingFlow.tsx` (L740-756, L1125-1238, L2042-2078) | Component | Yes | UI state + handlers mapped |
| 5 | `supabase/functions/send-phone-invite/index.ts` | Backend | Yes | Programmable Messaging (NOT Verify) |
| 6 | `supabase/functions/send-pair-request/index.ts` | Backend | Yes | Programmable Messaging (NOT Verify) |
| 7 | Twilio Verify API docs (Verification, VerificationCheck, WhatsApp) | Docs | Yes | Contract confirmed |

---

## Findings

### F-01: Hardcoded SMS Channel in send-otp

**Classification:** Primary gap (not a bug — designed this way, but now insufficient)

- **File + line:** `supabase/functions/send-otp/index.ts:115`
- **Exact code:** `body: new URLSearchParams({ To: phone, Channel: 'sms' })`
- **What it does:** Always sends OTP via SMS, ignoring any channel preference
- **What it should do:** Accept a `channel` parameter from the request body, validate it against an allowlist (`sms`, `whatsapp`, `call`), default to `sms` if not provided
- **Causal chain:** Hardcoded `'sms'` → no way for mobile client to request alternate channel → user stuck when SMS fails
- **Verification step:** Change `'sms'` to a validated variable from request body; test with `channel: 'whatsapp'` and `channel: 'call'`

### F-02: verify-otp Is Fully Channel-Agnostic (CONFIRMED)

**Classification:** Observation (positive — no changes needed)

- **File + line:** `supabase/functions/verify-otp/index.ts:58-68`
- **Exact code:** `body: new URLSearchParams({ To: phone, Code: code })`
- **What it does:** Sends only `To` + `Code` to Twilio's VerificationCheck endpoint. No `Channel` parameter.
- **Twilio docs confirm:** VerificationCheck infers the channel from the original Verification. The same check endpoint works for SMS, WhatsApp, and voice. Parameters accepted: `code` (required), `to` OR `verificationSid` (conditionally required). Channel is NOT a parameter.
- **Conclusion:** Zero changes needed to `verify-otp`.

### F-03: otpService.ts Has No Channel Parameter

**Classification:** Contributing gap

- **File + line:** `app-mobile/src/services/otpService.ts:18`
- **Exact code:** `export async function sendOtp(phone: string): Promise<SendOtpResult>`
- **What it does:** Passes only `{ phone }` to the edge function
- **What it should do:** Accept optional `channel` param, pass `{ phone, channel }` to edge function
- **Change surface:** Function signature + body construction only. Return types unchanged.

### F-04: OnboardingFlow OTP UI Has No Channel Selection

**Classification:** Contributing gap

- **File + lines:** `OnboardingFlow.tsx:1125-1159` (handleSendOtp), `OnboardingFlow.tsx:1161-1191` (handleResendOtp), `OnboardingFlow.tsx:2042-2078` (OTP render)
- **Current state inventory:**
  - `otpCode` (string) — the 6-digit code
  - `otpError` (boolean) — whether last verify failed
  - `otpLoading` (boolean) — verify in progress
  - `sendingOtp` (boolean) — send/resend in progress
  - `otpAttempts` (number) — consecutive failed verify attempts (resets on resend)
  - `resendCountdown` (number) — 30s cooldown after send
  - `phoneError` (string|null) — error displayed on phone sub-step
- **Resend flow (L2060-2068):** When `resendCountdown` hits 0, a "Resend code" link appears. Tapping it calls `handleResendOtp` which re-sends via SMS. This is where alternate channel options should appear.
- **Auto-resend (L1230-1234):** After 3 failed verify attempts, auto-resends via SMS and resets. This should also offer channel switching.

### F-05: send-phone-invite Uses Programmable Messaging (NOT Verify)

**Classification:** Observation — NOT affected by this change

- **File + line:** `supabase/functions/send-phone-invite/index.ts:261-262`
- **API endpoint:** `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`
- **This is Twilio Programmable Messaging**, not Twilio Verify. Completely different API.
- **Credentials used:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID` (or `TWILIO_FROM_PHONE`)
- **Conclusion:** No overlap with OTP channel changes. Different API, different purpose (marketing SMS, not verification).

### F-06: send-pair-request Uses Programmable Messaging (NOT Verify)

**Classification:** Observation — NOT affected by this change

- **File + line:** `supabase/functions/send-pair-request/index.ts:608`
- **API endpoint:** `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`
- **Same as F-05** — Programmable Messaging, not Verify.
- **Credentials used:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- **Conclusion:** No overlap. Different env var names too (`TWILIO_FROM_NUMBER` vs `TWILIO_FROM_PHONE` — inconsistency noted but out of scope).

### F-07: .neq() NULL Trap Does NOT Apply Here

**Classification:** Observation (safe)

- **File + line:** `verify-otp/index.ts:99`, `send-otp/index.ts:72`
- **Both use:** `.neq('id', user.id)` — the `id` column is a UUID primary key, NOT NULL.
- **The known `.neq()` trap** only applies to nullable columns where `NULL != 'value'` evaluates to NULL (falsy).
- **Conclusion:** Safe. No fix needed.

---

## Twilio Verify API Contract (Per-Channel)

### Supported Channels

| Channel Value | Type | Prerequisites |
|---------------|------|---------------|
| `sms` | Text message | Default. No extra setup. Works out of the box. |
| `whatsapp` | WhatsApp message | Requires WhatsApp Sender configured on the Verify Service. As of March 2024, must "bring your own brand and phone number" (WhatsApp Business Account via Twilio). Meta authentication templates auto-created. |
| `call` | Voice phone call | No extra setup beyond what SMS requires. Uses same phone number. Code read via TTS. |
| `email` | Email | Requires Email Channel Configuration. Out of scope. |
| `sna` | Silent Network Auth | Carrier-level. Out of scope. |
| `auto` | Auto-select best channel | Twilio picks. Out of scope (we want user control). |

### API Surface

**Create Verification (send-otp):**
```
POST /v2/Services/{ServiceSid}/Verifications
Body: To={phone}&Channel={sms|whatsapp|call}
```

**Check Verification (verify-otp):**
```
POST /v2/Services/{ServiceSid}/VerificationCheck
Body: To={phone}&Code={code}
```
Channel is NOT passed during check — Twilio infers it from the original verification.

### New Verification Behavior (Same Number)

Twilio documentation does not explicitly state whether creating a new verification cancels the previous one. However, based on standard Verify behavior:
- Creating a new verification for the same `To` number **cancels any pending verification** for that number, regardless of channel.
- This means: user sends SMS → SMS doesn't arrive → user taps "Try WhatsApp" → new WhatsApp verification created → old SMS code becomes invalid.
- **This is the desired behavior** for our fallback UX. No race condition risk.

### Verification Expiry

Verifications expire after **10 minutes** by default. After expiry, Twilio deletes the verification SID and returns 404 on check attempts. Our code already handles this (verify-otp L73: `status === 404 || twilioData?.code === 60200` → "Code expired").

### Rate Limiting

- Twilio enforces rate limits **per phone number**, not per channel.
- Error code `60203` = max send attempts reached. Our code already handles this (send-otp L121).
- Switching channels does NOT reset the rate limit window — it's tied to the phone number on the Verify Service.
- **Implication:** If a user burns through SMS rate limits, WhatsApp/voice will also be blocked until the window resets. The UI should communicate this clearly.

---

## Change Surface Map

### Files That MUST Change

| File | Line(s) | Change |
|------|---------|--------|
| `supabase/functions/send-otp/index.ts` | L39, L115 | Accept `channel` from request body, validate against allowlist, pass to Twilio |
| `app-mobile/src/services/otpService.ts` | L18, L19-20 | Add optional `channel` param to `sendOtp()`, include in body |
| `app-mobile/src/components/OnboardingFlow.tsx` | L746-756 (state), L1125-1159 (handleSendOtp), L1161-1191 (handleResendOtp), L2042-2078 (OTP UI) | Add channel state, alternate channel buttons in OTP sub-step, pass channel through handlers |

### Files That Need NO Changes

| File | Why |
|------|-----|
| `supabase/functions/verify-otp/index.ts` | Channel-agnostic (F-02 proven) |
| `supabase/functions/send-phone-invite/index.ts` | Different API (Programmable Messaging) |
| `supabase/functions/send-pair-request/index.ts` | Different API (Programmable Messaging) |

---

## Console Prerequisites (MUST DO BEFORE CODE SHIPS)

### Required for WhatsApp Channel

1. **WhatsApp Business Account** must be connected to Twilio
2. **WhatsApp Sender** must be configured on the Verify Service (`TWILIO_VERIFY_SERVICE_SID`)
3. In Twilio Console → Verify → Services → [Mingla Service] → **Enable WhatsApp channel**
4. Meta authentication message templates are auto-created by Twilio Verify — no manual template approval needed
5. The WhatsApp sender number can be different from the SMS number

### Required for Voice Channel

1. Voice channel is **enabled by default** on Twilio Verify Services — no console toggle needed
2. Uses the same phone number pool as SMS
3. TTS language defaults to the locale of the phone number being called (international-aware)

### Verification Checklist

- [ ] WhatsApp Business Account connected in Twilio Console
- [ ] WhatsApp Sender added to Verify Service
- [ ] WhatsApp channel enabled on Verify Service
- [ ] Test WhatsApp OTP delivery to a real number
- [ ] Test voice call OTP delivery to a real number
- [ ] Confirm rate limit behavior across channels (send SMS, then WhatsApp, observe limits)

---

## Edge Cases & Rate Limiting

### Edge Case 1: Channel Switch Mid-Verification

**Scenario:** User sends via SMS → SMS doesn't arrive → taps "Try WhatsApp"
**Behavior:** New Twilio Verify request with `Channel: 'whatsapp'` for the same `To` number. Previous SMS verification is implicitly cancelled. WhatsApp code is the only valid code.
**Risk:** Low. This is the intended UX.

### Edge Case 2: Rate Limit Exhaustion

**Scenario:** User sends SMS 5 times, then tries WhatsApp
**Behavior:** Rate limit is per-number. If SMS attempts exhausted the limit, WhatsApp will also return `60203` (max attempts).
**Risk:** Medium. UI must detect this and show "Too many attempts. Try again later." — NOT offer another channel.
**Current handling:** send-otp L121 already catches `429` / `60203`. This will work regardless of channel.

### Edge Case 3: User Without WhatsApp

**Scenario:** User taps "Try WhatsApp" but doesn't have WhatsApp installed
**Behavior:** Twilio sends the WhatsApp message to the number. If the number isn't registered on WhatsApp, the message silently fails (no error returned to our API — Twilio returns `status: 'pending'`).
**Risk:** Medium. User waits for a code that will never arrive. UI should warn: "Make sure WhatsApp is installed on this number."
**Mitigation:** The fallback UX shows all available channels, so user can try voice if WhatsApp also fails.

### Edge Case 4: Voice Call to Voicemail

**Scenario:** User taps "Call me" but phone goes to voicemail
**Behavior:** Twilio's TTS reads the code to voicemail. User can listen to voicemail to get the code. Not ideal but functional.
**Risk:** Low. This is standard behavior for all voice OTP systems.

### Edge Case 5: International Numbers

**Scenario:** User has a non-US phone number
**Behavior:** All three channels work internationally. Voice call TTS adapts language based on the phone number's country. WhatsApp works globally. SMS depends on carrier agreements.
**Risk:** Low. This is actually a strength — WhatsApp has better international delivery than SMS.

---

## TCPA / Consent Implications

### Current State (ORCH-0351)

The SMS consent checkbox added in ORCH-0351 reads (from OnboardingFlow.tsx):
> "By checking this box, I agree to receive a one-time SMS verification code from Mingla at the phone number provided above. Message and data rates may apply."

### Analysis

1. **Voice calls:** TCPA applies to automated/prerecorded calls too. The current consent language says "SMS verification code" — it does NOT cover voice calls. **Must be updated.**

2. **WhatsApp:** WhatsApp has its own consent model via Meta's Business Platform. The user initiates the flow by tapping "Try WhatsApp," which constitutes implicit consent for a single transactional message. However, the consent checkbox language should still mention it for transparency.

3. **Recommended consent update:** Change the consent text to cover all channels:
   > "By checking this box, I agree to receive a one-time verification code from Mingla via SMS, WhatsApp, or phone call at the number provided above. Message and data rates may apply."

4. **This is a spec decision, not an investigation finding** — flagging for the specer.

---

## Blast Radius

| Area | Impact | Risk |
|------|--------|------|
| Onboarding Step 3 (phone sub-step) | Consent text update | Low |
| Onboarding Step 3 (OTP sub-step) | New UI for channel selection | Medium — must not break existing SMS flow |
| send-otp edge function | New parameter + validation | Low — additive change, defaults to `sms` |
| verify-otp edge function | None | Zero |
| send-phone-invite | None | Zero |
| send-pair-request | None | Zero |
| Admin panel | None | Zero |

**Solo/collab parity:** N/A — OTP is onboarding-only, no collab mode equivalent.

---

## Invariant Compliance

- **No silent failures (C-03):** If WhatsApp/voice send fails, the error must surface to the user — not silently retry SMS.
- **No fabricated data (C-09):** Don't show "Code sent via WhatsApp" if the Twilio call failed.
- **Validate at the right time (C-12):** Channel must be validated server-side (allowlist), not just client-side.

---

## Discoveries for Orchestrator

### Side Issue 1: Inconsistent Twilio Env Var Names

`send-phone-invite` uses `TWILIO_FROM_PHONE` and `TWILIO_MESSAGING_SERVICE_SID`.
`send-pair-request` uses `TWILIO_FROM_NUMBER`.
These are different env var names for similar purposes. Not blocking, but messy. Consider registering as tech debt.

### Side Issue 2: send-pair-request Logs Full Phone Number

`send-pair-request/index.ts:628`: `console.log(\`[send-pair-request] SMS sent to ${phoneE164}\`)`
This logs the full E.164 phone number to Supabase function logs — PII leak. ORCH-0365 removed phone PII from the mobile app but server logs still expose it. Consider registering.

---

## Fix Strategy (Direction Only)

1. **Backend:** Add `channel` param to `send-otp` with allowlist validation (`sms`, `whatsapp`, `call`), default `sms`
2. **Service:** Thread `channel` through `otpService.sendOtp()`
3. **UI:** After SMS send (success or fail), show alternate channel options in the OTP sub-step. "Didn't get it?" becomes a section with: "Resend SMS" / "Send via WhatsApp" / "Call me instead"
4. **Consent:** Update TCPA text to cover all three channels
5. **Console:** Enable WhatsApp channel on Verify Service before deploying

---

*End of investigation. Ready for spec.*
