# ORCH-1215 — Mingla Business · Play Console Data Safety Answer Sheet

**For:** Play Console → **Mingla Business** → **Policy > App content > Data safety**
**Audit date:** 2026-06-22
**Audit method:** code probe of `mingla-business/` + shared-backend cross-check + third-party SDK inventory
**Bundle audited:** `com.sethogieva.minglabusiness` v1.0.0 at `~/Desktop/mingla-main/mingla-business/`
**Modeled on:** `ORCH_0977_PLAY_CONSOLE_DATA_SAFETY.md` (consumer). Business differs — read the deltas, do NOT copy the consumer answers blind.

How to use: read down the list, paste each answer into the matching field in Play Console's Data Safety form. Google's form is multi-page (introduction → data collection → data security → review). Sections below match the form's structure.

> **Key business-vs-consumer deltas (read first):**
> - Business is the **venue/brand/organizer side**. Its users are event organizers and venue owners, not consumers planning dates.
> - **No precise/background location** collected the way consumer does. The business app does NOT request `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` (verified: `mingla-business/app.json` android.permissions has NO location permission, and infoPlist has NO `NSLocation*` key). Venue/stop addresses are entered as TEXT via Mapbox geocoding, not device GPS.
> - **No phone-number collection / no phone-OTP gate.** Auth is Apple / Google / **Email-OTP** (`src/components/auth/BusinessWelcomeScreen.tsx`, `src/context/AuthContext.tsx:863 verifyOtp type:"email"`). The consumer reviewer phone bypass does NOT apply.
> - **Payout/bank details** are collected during Stripe Connect (US) / Paystack (Nigeria) onboarding — but these are entered into **Stripe/Paystack-hosted or embedded surfaces**; Mingla does not store raw bank/card numbers (`src/components/brand/BrandPaystackOnboardView.tsx`, `app/connect-onboarding.web.tsx`).
> - **RevenueCat is install-only / vestigial** — NO products, NO paywall, NO purchase flow (`src/services/revenueCatService.ts` header: "No products configured… No purchase flow"). → **Business has NO IAP. Purchase History = NOT collected.**
> - **Sentry does NOT set `sendDefaultPii: true`** in business (`app/_layout.tsx:110` Sentry.init has no PII flag — unlike consumer). Crash data is still collected but is not deliberately PII-tagged.

---

## Section 1 — Data collection and security

**Q1: Does your app collect or share any of the required user data types?**
→ **Yes**

**Q2: Is all of the user data collected by your app encrypted in transit?**
→ **Yes** (Supabase enforces HTTPS; every third-party SDK uses HTTPS; no plain-HTTP transport in the business app)

**Q3: Do you provide a way for users to request that their data be deleted?**
→ **Yes** — in-app account deletion flow (`app/account/` delete flow, the Cycle 14 4-step delete precedent referenced in `BusinessWelcomeScreen.tsx`). Privacy Policy documents the right; marketing `/delete-account` page documents the contact path. ⚠️ **VERIFY** the in-app delete entry point is reachable in the shipped build before checking this Yes (see Compliance doc action list).

---

## Section 2 — Data types

Answer schema per row: **Collected?** / **Shared with third parties?** / **Optional or Required?** / **Purposes**. If Collected = No, skip the rest.

### Personal info

| Sub-type | Collected | Shared | Optional/Required | Purposes |
|---|---|---|---|---|
| **Name** (organizer/brand display name) | Yes | Yes (Supabase, Mixpanel, PostHog, Sentry) | Required | App functionality, Account management, Analytics |
| **Email address** | Yes | Yes (Supabase, Mixpanel, PostHog, Sentry, Resend for transactional/blast mail) | Required | App functionality, Account management, Communications |
| **User IDs** (Supabase user_id, AppsFlyer UID, OneSignal external_id, Mixpanel distinct_id, PostHog distinct_id) | Yes | Yes (all SDKs receive a stable user_id) | Required | Account management, Analytics, App functionality, Fraud prevention |
| **Phone number** | ⚠️ **No** for the ORGANIZER account (auth is email/OAuth, no phone gate). **BUT** brands enter a public venue/contact phone on the event/venue listing, and buyers may enter a phone at checkout (`phone.test`, `eventOrdersService`). If a buyer/contact phone is persisted server-side, declare **Yes / Required (for ticket buyers) / App functionality**. ⚠️ VERIFY whether buyer phone is stored. | Yes (Supabase) | Optional | App functionality |
| **Address** | No (venue/stop addresses are place/business addresses entered as text, not the USER's home address → categorize the place under App functionality, not Personal Address) | — | — | — |
| **Race/ethnicity, Political/religious beliefs, Sexual orientation** | No | | | |
| **Other info** | No | | | |

### Financial info

| Sub-type | Collected | Shared | Optional/Required | Purposes |
|---|---|---|---|---|
| **Payment info** (card numbers, PCI data) | **No (declared NOT collected by Mingla)** — buyer card data is entered directly into Stripe's native PaymentSheet / Apple Pay sheet (`src/payments/nativeCheckoutFlow.native.ts` initPaymentSheet/presentPaymentSheet); brand payout bank details are entered into Stripe Connect / Paystack hosted+embedded onboarding. Mingla receives only tokenized confirmations. PCI scope sits with Stripe + Apple + Google + Paystack, not Mingla. | — | — | — |
| **Purchase history** | **No** — Business has NO IAP/subscription (RevenueCat is install-only, no products). Ticket SALES the brand makes are business records, not the app user's personal purchase history. | — | — | — |
| **Credit score / Other financial info** | No | | | |

### Health and fitness
All No.

### Messages

| Sub-type | Collected | Shared | Optional/Required | Purposes |
|---|---|---|---|---|
| **Emails** | No (Mingla SENDS marketing/transactional email via Resend; does NOT read the user's inbox) | | | |
| **SMS or MMS** | No | | | |
| **Other in-app messages** | ⚠️ **Yes (Ari AI assistant chat)** — the "Ari" tab (`app/(tabs)/ari.tsx` → `AriChatScreen`) is a user↔AI assistant chat; the organizer's prompts are sent to the AI backend. This is NOT user-to-user messaging. Declare **Yes / Shared (Supabase + AI provider) / Optional / App functionality**. | Yes | Optional | App functionality |

### Photos and videos

| Sub-type | Collected | Shared | Optional/Required | Purposes |
|---|---|---|---|---|
| **Photos** (brand logo + event/experience cover imagery uploaded from camera/library; `expo-image-picker`, Cloudinary via `CoverPicker.tsx`) | Yes | Yes (Cloudinary for storage, Supabase for ref) | Optional | App functionality |
| **Videos** (event cover videos — trim→upload; `expo-video`, `react-native-video-trim`, `react-native-compressor`) | Yes | Yes (Cloudinary for storage, Supabase for ref) | Optional | App functionality |

### Audio
All No. ⚠️ `RECORD_AUDIO` is declared in `app.json` android.permissions but NO audio-recording code path was found in the business app. See Compliance doc — recommend removing the unused permission. Declare **No** for audio collection.

### Files and docs
| Sub-type | Collected | Shared | Optional/Required | Purposes |
|---|---|---|---|---|
| **Files and docs** (menu/document upload via `expo-document-picker` for the "snap your menu" experience parser) | ⚠️ **Yes (if menu image/doc upload persists)** — a menu snap is parsed by Gemini and may store the image. Declare **Yes / Shared (Cloudinary/Supabase + Gemini parser) / Optional / App functionality**. | Yes | Optional | App functionality |

### Calendar
All No.

### Contacts
All No. The business app does NOT access the device contacts list.

### App activity

| Sub-type | Collected | Shared | Optional/Required | Purposes |
|---|---|---|---|---|
| **App interactions** (Mixpanel + PostHog autocapture: screen views, event-create steps, publish, marketing-blast actions, paywall N/A) | Yes | Yes (Mixpanel, PostHog, AppsFlyer install/login) | Required | Analytics, App functionality |
| **In-app search history** | No (Mapbox address autocomplete queries are not persisted with user identity) | | | |
| **Installed apps** | No | | | |
| **Other user-generated content** (brand profile, event/trip/experience listings, menu items, marketing campaign copy) | Yes | Yes (Supabase) | Optional | App functionality |
| **Other actions** | No | | | |

### Web browsing
All No.

### App info and performance

| Sub-type | Collected | Shared | Optional/Required | Purposes |
|---|---|---|---|---|
| **Crash logs** (Sentry — `app/_layout.tsx:110`; note `sendDefaultPii` is NOT set, unlike consumer) | Yes | Yes (Sentry) | Required | App functionality, Analytics |
| **Diagnostics** (Sentry traces `tracesSampleRate: 0.2` in prod; PostHog/Mixpanel perf events) | Yes | Yes (Sentry, PostHog, Mixpanel) | Required | App functionality, Analytics |
| **Other app performance data** | No | | | |

### Device or other identifiers

| Sub-type | Collected | Shared | Optional/Required | Purposes |
|---|---|---|---|---|
| **Device or other IDs** (Android Advertising ID + Apple IDFA via AppsFlyer after ATT consent; device UID; OneSignal subscription ID; PostHog/Mixpanel device id) | Yes | Yes (AppsFlyer, Mixpanel, PostHog, OneSignal, Sentry) | Required (Ad ID/IDFA required for AppsFlyer attribution; OneSignal token required for push) | Analytics, App functionality, Communications |

### Location

| Sub-type | Collected | Shared | Optional/Required | Purposes |
|---|---|---|---|---|
| **Approximate location** | ⚠️ **No (recommended)** — the business app declares NO location permission (verified `app.json`). Venue/stop locations are typed addresses, not the user's device location. **Declare No** unless ⚠️ an AppsFlyer/IP-derived coarse location is considered collection — if conservative, declare Approximate = Yes / Analytics. Recommend **No**. | — | — | — |
| **Precise location** | **No** — no `expo-location`, no `ACCESS_FINE_LOCATION`. | — | — | — |

---

## Section 3 — Data usage and handling

For every "Yes (Collected)" row:

- **Processed ephemerally?** → No (persisted in Supabase or SDK storage for the account lifetime)
- **Required for the app to function?** → See per-row Optional/Required column.
- **Why collected/shared?** → See per-row Purposes.
- **Users in control of sharing?** → Yes for Optional rows (photos/videos/Ari chat/menu docs); No for Required rows (account email + analytics/diagnostics).

---

## Section 4 — Security practices

- **Data encrypted in transit:** Yes (HTTPS everywhere)
- **Data deletion mechanism:** Yes (in-app account deletion; documented in Privacy Policy) — ⚠️ verify the delete entry point ships
- **Independent security review:** No (truthful — no external audit commissioned)
- **Compliance with Families Policy:** Not applicable (business app is a B2B tool for organizers 18+; restrict to adults)

---

## Advertising ID declaration

- **Advertising ID = Yes** (AppsFlyer uses it; `AD_ID` permission auto-merges from the SDK).
- **Purpose:** Analytics + App functionality (attribution) — **NOT advertising**. Same as consumer.

---

## Cross-references

- Privacy Policy: `https://usemingla.com/privacy-policy` (shared backend — same policy as consumer; ⚠️ see policy-mismatch flag below)
- Support: `https://usemingla.com/support`
- Shared Supabase backend: `gqnoajqerqhnvulmnyvv` (now on LIVE Stripe/Paystack)
- Code evidence: `app.config.ts` (SDK env), `src/services/{mixpanelService,postHogService,oneSignalService,appsFlyerService,revenueCatService}.ts`, `app/_layout.tsx` (Sentry), `src/payments/nativeCheckoutFlow.native.ts` (Stripe), `src/components/brand/BrandPaystackOnboardView.tsx` (Paystack).

## ⚠️ Privacy Policy mismatch (same risk as consumer ORCH-0977)

The Privacy Policy must list every third-party processor the BUSINESS app uses: **Supabase, Cloudinary, Resend, Google, Apple, Mapbox, Mixpanel, PostHog, AppsFlyer, OneSignal, Sentry, Stripe (+ Stripe Connect), Paystack, GIPHY, Pexels, and the Gemini menu/activity parser.** If the live policy lists only the consumer set, both stores can flag a mismatch. ⚠️ Confirm the policy covers Paystack + PostHog + the AI parser before submission.
