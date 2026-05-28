# ORCH-0977 — App Review Information (#36)

**For:** App Store Connect "App Review Information" + Google Play Console "App access".
**Date:** 2026-05-28
**Depends on:** the test-OTP bypass shipped 2026-05-28 (reviewer number `+12015550199` + code `123456`, live in `send-otp` / `verify-otp`). This must be in the submitted build for the steps below to work.

---

## The access situation (why this matters)

Mingla's primary login is **Sign in with Apple** or **Google**, and onboarding has a **mandatory phone-verification step** with no skip. Reviewers can't receive a real SMS, so without the test-OTP bypass they'd be blocked at the phone step. The bypass (now live) lets a reviewer enter a fictional number + fixed code to pass that step. The instructions below walk the reviewer through it.

---

## App Store Connect → App Review Information

**Sign-in required:** Yes

**Demo account:** Mingla uses Sign in with Apple (OAuth), not username/password, so the demo "account" is the reviewer's own Apple ID plus the test phone bypass. Fill the fields as follows:

- **User name:** `+12015550199`
- **Password:** `123456`
- (These map to the test phone + code; ASC requires both fields filled when sign-in is required. The Notes below explain the real flow.)

**Notes (paste this into the "Notes" field):**

```
Mingla sign-in uses Sign in with Apple (no username/password). To review:

1. On the welcome screen, tap "Sign in with Apple" and authenticate with your Apple ID.
2. Onboarding will ask for a phone number. Enter this test number:
      +1 201 555 0199
   Tap continue.
3. On the verification-code screen, enter this code:
      123456
   (This is a reserved review test number. Real users receive a real SMS code;
   this fixed number/code exists only for App Review and does not send an SMS.)
4. Complete the brief onboarding (preferences, location permission). You can
   allow or deny location — the app works either way; denying lets you pick a
   city manually.
5. You'll reach the Home screen with curated venue/experience cards.

Notes on permissions:
- App Tracking Transparency: the ATT prompt appears after onboarding (used for
  AppsFlyer install attribution). You may allow or deny.
- Location: optional; used to suggest nearby venues. Deny → manual city select.
- Push: optional.

Subscriptions: "Mingla Plus" is an auto-renewable subscription
(weekly/monthly/annual). It is not required to browse the core experience.

Contact for review questions: support@usemingla.com
```

**Contact Information (App Review):** ⚠️ FILL IN — first name, last name, phone number, email. Use a phone + email you actively monitor during review (recommend the email `support@usemingla.com` or your personal, and your real phone).

---

## Google Play Console → App access

Play's "App access" section. Choose **"All or some functionality is restricted"** (already set), then add an instruction set:

- **Name:** `Reviewer sign-in + phone bypass`
- **Username:** `+12015550199`
- **Password:** `123456`
- **Any other information (paste):**

```
Login is via Google or Apple sign-in (no username/password). Steps:
1. Tap "Continue with Google" (or Apple) and authenticate.
2. Onboarding asks for a phone number — enter the test number +12015550199.
3. Enter verification code 123456 (reserved review test number; sends no SMS).
4. Finish onboarding (preferences + optional location) to reach Home.

Mingla Plus subscription is optional and not required to review core features.
Questions: support@usemingla.com
```

---

## What operator must do

1. ⚠️ **Fill the App Review "Contact Information"** in ASC (name + phone + email you monitor during review).
2. **Paste the Notes blocks** into ASC App Review Information + Play App access.
3. **Confirm the test-OTP bypass is in the submitted build.** It's live in the deployed `send-otp`/`verify-otp` edge functions now, so it already works server-side — but the build must be the post-2026-05-28 one (the bypass is server-side, so any build that calls these functions benefits; no client change needed for the bypass itself).
4. **(Optional) Test the reviewer flow yourself once** on the TestFlight build: sign in with Apple → enter +12015550199 → code 123456 → confirm you reach Home. This proves the reviewer path before submitting.

## Security note

The bypass only lets someone attach a fictional number to an account they've ALREADY logged into via Apple/Google — it grants no account access by itself and sends no SMS. The number is in the NANP 555-0199 reserved-for-fiction range, so it can never collide with a real line. Risk is negligible. If you ever want to retire it post-launch, remove the `REVIEWER_TEST_PHONE` blocks from `send-otp`/`verify-otp` and redeploy.
