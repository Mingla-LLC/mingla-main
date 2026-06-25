# ORCH-1215 — Mingla Business · App Review Information

**For:** App Store Connect "App Review Information" (ASC App ID `6768737367`) + Google Play Console "App access".
**Date:** 2026-06-22
**Modeled on:** `ORCH_0977_APP_REVIEW_INFORMATION.md` (consumer). **The reviewer flow is DIFFERENT — read the access situation.**

---

## The access situation (why this differs from consumer)

The consumer app has a mandatory **phone-OTP** gate, so it needed the `+12015550199` / `123456` SMS bypass.

**The business app does NOT have a phone gate.** Sign-in is **Sign in with Apple**, **Continue with Google**, or **Continue with Email (6-digit OTP)** — verified `src/components/auth/BusinessWelcomeScreen.tsx` + `src/context/AuthContext.tsx`. The email-OTP path (`signInWithOtp` → `verifyOtp type:"email"`, lines 819/863) sends a **real 6-digit code to whatever email the reviewer enters**, with `shouldCreateUser: true`. So:

- ✅ **A reviewer can sign in with their OWN email** and receive a real code in their inbox — no SMS, no bypass needed.
- ✅ Or they can use **Sign in with Apple / Google**.

**The real reviewer problem is EMPTINESS, not the gate.** A brand-new account lands on an onboarding/empty home with no brand, no events, no sales — the reviewer can't evaluate the door-scanner, dashboards, marketing, or checkout because there's nothing there. **To review the app meaningfully, a reviewer needs a pre-seeded demo brand with at least one published event (ideally one with sales + a scannable ticket).**

⚠️ **ACTION FOR SETH (blocking):** Seed a **demo organizer account** and provide its **email login** to reviewers. The cleanest path is a dedicated demo email (e.g. `appreview@usemingla.com`, an alias that routes to a monitored inbox) attached to a brand that already has:
- ≥1 **published event** (and ideally a published trip + experience to show all three lifecycles),
- ≥1 **completed/test ticket order** (so dashboards + the door scanner + guest list are populated),
- a finished/skippable **payout onboarding** state (so the reviewer isn't blocked on Stripe Connect bank entry).

The reviewer signs in with that demo email → Email OTP → the code arrives in the demo inbox → ⚠️ **the reviewer must be able to read that code.** Two options:
- **(A) Recommended — Apple/Google demo account:** seed the demo brand under an **Apple ID or Google account you control** and hand the reviewer those OAuth credentials (App Review can use provided Apple/Google demo credentials). Avoids the "reviewer can't read my inbox" problem entirely.
- **(B) Email-OTP demo:** provide the demo email + instruct the reviewer to request a code; you (Seth) read the code from the monitored inbox and… (this requires real-time coordination — clunky). **Prefer (A).**

⚠️ If you want a true zero-touch reviewer path (no OAuth credential sharing, no inbox coordination), the follow-up is a **reviewer email-OTP bypass** in the shared `verify-otp`/auth path analogous to the consumer phone bypass — a fixed reviewer email + fixed code that skips real email send. That's a backend code change (its own work item), NOT in scope for this docs-only ORCH. Flag it if Seth wants it.

---

## App Store Connect → App Review Information

**Sign-in required:** Yes

**Demo account fields** (use the Apple/Google demo credentials from option A, or the demo email from option B):
- **User name:** `appreview@usemingla.com` ⚠️ (or the demo Apple ID / Google email you seed)
- **Password:** ⚠️ FILL IN — the demo account password (if OAuth, put the OAuth account password; the Notes explain the flow)

**Notes (paste into the "Notes" field, after seeding the demo brand):**

```
Mingla Business is the organizer/venue side of Mingla — venue owners and event
organizers create and manage events, trips, and experiences, sell tickets, scan
attendees at the door, and run marketing.

Sign-in options: Sign in with Apple, Continue with Google, or Continue with Email
(a 6-digit code is emailed). There is NO phone-number step.

To review with a populated account, use the demo organizer we seeded:
1. On the welcome screen, choose "Continue with Email" and enter:
      appreview@usemingla.com        [or use the Apple/Google demo credentials above]
2. A 6-digit code is emailed. Enter it to sign in.
   (If using the provided Apple/Google demo account instead, just tap that button
    and authenticate — no code needed.)
3. You'll land on the organizer Home with a seeded brand that already has a
   published event (plus a trip and an experience), a guest list, and dashboards.

What you can review:
- Create/edit an event, trip, or experience (the + menu).
- The public listing pages these generate.
- Ticket checkout: tickets are purchased with Stripe / Apple Pay (real-world event
  admission, not a digital subscription — there is no in-app subscription).
- Door mode + the QR ticket scanner (Camera permission is used ONLY to scan
  attendee ticket QR codes at the door).
- Marketing (email blasts) and the Ari AI assistant tab.
- Payout onboarding (Stripe Connect for US, Paystack for Nigeria) — the demo
  account's payout step is already completed/skippable so you are not blocked.

Permissions:
- Camera: QR ticket scanning + uploading brand/event cover photos. You may allow
  or deny; the rest of the app works either way.
- App Tracking Transparency: the ATT prompt appears (AppsFlyer attribution). Allow
  or deny — no effect on functionality.
- Push: optional.
- The app does NOT request location.

Contact for review questions: support@usemingla.com
```

**Contact Information (App Review):** ⚠️ FILL IN — Seth Ogieva + a phone + email you monitor during review (recommend `support@usemingla.com` + your real phone).

---

## Google Play Console → App access

Choose **"All or some functionality is restricted"**, then add an instruction set:

- **Name:** `Reviewer sign-in + seeded demo brand`
- **Username:** `appreview@usemingla.com` ⚠️ (or the demo Google account)
- **Password:** ⚠️ FILL IN
- **Any other information (paste):**

```
Mingla Business is the organizer/venue side of Mingla. Sign-in is Google, Apple, or
Email (6-digit code emailed). No phone step.

Use the seeded demo organizer to see a populated account:
1. Tap "Continue with Google" (or "Continue with Email" and enter
   appreview@usemingla.com — a 6-digit code is emailed; enter it).
2. You'll land on the organizer Home with a seeded brand: a published event, trip,
   and experience, plus a guest list and dashboards.
3. Review event/trip/experience creation, the public listings, ticket checkout
   (Stripe / Google Pay — real-world event admission, NOT a digital subscription),
   the door QR ticket scanner (Camera is used only to scan attendee QR codes), and
   marketing blasts.

The app requests NO location. Camera = QR ticket scanning + cover-photo upload.
Payout onboarding (Stripe Connect US / Paystack Nigeria) is already completed on the
demo account so you are not blocked.
Questions: support@usemingla.com
```

---

## What Seth must do

1. ⚠️ **Seed the demo organizer brand** (≥1 published event + trip + experience; a test ticket order; completed/skippable payout state) — this is the blocking prerequisite. Without it the reviewer sees an empty app.
2. ⚠️ **Decide the demo login method:** (A) a controlled Apple/Google demo account handed to reviewers [recommended], or (B) the `appreview@usemingla.com` email-OTP with you reading codes [clunky]. Pick (A).
3. **Paste the Notes blocks** into ASC App Review Information + Play App access, filling the ⚠️ credential fields.
4. **Fill ASC "Contact Information"** (name + monitored phone + email).
5. **(Optional) Walk the reviewer flow yourself** on the TestFlight/internal-track build: sign in with the demo account → confirm you reach a populated Home → scan a test ticket → confirm checkout works.

## Notes

- No SMS / phone bypass is needed — the business app has no phone gate. The only friction is the **empty-account problem**, solved by seeding a demo brand.
- ⚠️ If a fully self-serve reviewer email-OTP bypass is wanted (fixed reviewer email + fixed code, no inbox coordination), that's a separate backend change in the shared auth/`verify-otp` path — flag it as a follow-up ORCH; it is NOT part of this docs-only ORCH-1215.
