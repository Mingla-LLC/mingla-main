# ORCH-0977 — Play Console Data Safety Answer Sheet

**For:** Play Console → Mingla → **Policy > App content > Data safety**
**Audit date:** 2026-05-27
**Audit method:** code probe + privacy policy cross-check + third-party SDK inventory
**Bundle audited:** `com.mingla.app.v2` at `~/Desktop/mingla-orchs/ORCH-0977-[consumer-app-store-launch]/app-mobile/`

How to use: read down the list, paste each answer into the matching field in Play Console's Data Safety form. Google's form is multi-page (introduction → data collection → data security → review). Sections below match the form's structure.

---

## Section 1 — Data collection and security

**Q1: Does your app collect or share any of the required user data types?**
→ **Yes**

**Q2: Is all of the user data collected by your app encrypted in transit?**
→ **Yes** (Supabase enforces HTTPS; every third-party SDK uses HTTPS; no plain-HTTP transport anywhere in the consumer app)

**Q3: Do you provide a way for users to request that their data be deleted?**
→ **Yes** — Settings → Delete Account flow (in-app self-service deletion). Privacy Policy section 7 also documents the right. Marketing site `/delete-account` page documents the contact path for exceptional requests.

---

## Section 2 — Data types

For each data type below, the answer schema is:

- **Collected?** (Yes/No)
- **Shared with third parties?** (Yes/No)
- **Optional or Required?** (user can use app without providing → Optional; user can't → Required)
- **Purposes** (multi-select from Google's list)

If "Collected" is No, skip the rest of that row.

### Personal info

| Sub-type | Collected | Shared | Optional/Required | Purposes |
|---|---|---|---|---|
| **Name** (full name, display name) | Yes | Yes (Supabase, Mixpanel, Sentry) | Required | App functionality, Account management, Personalization |
| **Email address** | Yes | Yes (Supabase, Mixpanel, Sentry, Resend) | Required | App functionality, Account management, Communications |
| **User IDs** (Supabase user_id, AppsFlyer UID, OneSignal external_id) | Yes | Yes (all SDKs receive a stable user_id) | Required | Account management, Analytics, App functionality, Fraud prevention |
| **Phone number** | Yes | Yes (Supabase, Twilio for OTP/invite, Vonage fallback) | Required | Account management, App functionality (OTP verification) |
| **Address** | No (only city/country strings, NOT street address — categorize under Approximate Location instead) | — | — | — |
| **Race and ethnicity** | No | | | |
| **Political or religious beliefs** | No | | | |
| **Sexual orientation** | No | | | |
| **Other info** (gender + date of birth, collected in onboarding) | Yes | Yes (Supabase) | Optional (user can skip in onboarding for current build) | App functionality, Personalization |

### Financial info

| Sub-type | Collected | Shared | Optional/Required | Purposes |
|---|---|---|---|---|
| **Payment info** (credit card numbers, PCI-scoped data) | **No (declared NOT collected by Mingla)** — Stripe/Apple/Google process payment data directly via their native sheets; Mingla only receives a tokenized purchase confirmation via RevenueCat. The PCI scope sits with Stripe + Apple + Google, not Mingla. This is the standard answer for apps using RevenueCat + native payment sheets. | — | — | — |
| **Purchase history** | Yes | Yes (RevenueCat) | Required (for Mingla Plus subscribers) | App functionality, Fraud prevention |
| **Credit score** | No | | | |
| **Other financial info** | No | | | |

### Health and fitness

All No.

### Messages

| Sub-type | Collected | Shared | Optional/Required | Purposes |
|---|---|---|---|---|
| **Emails** | No | | | |
| **SMS or MMS** | No (Mingla SENDS SMS via Twilio for OTP + invites, but does NOT READ user's SMS inbox) | | | |
| **Other in-app messages** (board discussion messages between users) | Yes | Yes (Supabase) | Optional (user can use app without sending messages) | App functionality |

### Photos and videos

| Sub-type | Collected | Shared | Optional/Required | Purposes |
|---|---|---|---|---|
| **Photos** (uploaded via camera or library to BoardDiscussion / experience photos / beta feedback) | Yes | Yes (Cloudinary for storage, Supabase for ref) | Optional | App functionality |
| **Videos** | No (no video upload surface in consumer app today) | | | |

### Audio

| Sub-type | Collected | Shared | Optional/Required | Purposes |
|---|---|---|---|---|
| **Voice or sound recordings** (beta feedback voice notes via `expo-av`) | Yes | Yes (Cloudinary for storage, Supabase for ref) | Optional | App functionality, App diagnostics (beta feedback flow) |
| **Music files** | No | | | |
| **Other audio files** | No | | | |

### Files and docs

All No.

### Calendar

| Sub-type | Collected | Shared | Optional/Required | Purposes |
|---|---|---|---|---|
| **Calendar events** (Mingla WRITES events to user's device calendar via `expo-calendar`; does NOT read existing events) | **No (Mingla only writes, doesn't collect)** — Play Console asks if you COLLECT calendar data; writing-only doesn't count as collection. | — | — | — |

### Contacts

All No. Mingla does NOT access the device contacts list. SMS invites work by user manually typing the recipient's phone number.

### App activity

| Sub-type | Collected | Shared | Optional/Required | Purposes |
|---|---|---|---|---|
| **App interactions** (Mixpanel: screen views, card swipes, preference changes, friend actions, paywall views, etc.) | Yes | Yes (Mixpanel, AppsFlyer for install/login events) | Required | Analytics, App functionality |
| **In-app search history** | No (search queries against Google Places API are not logged or persisted with user identity) | | | |
| **Installed apps** | No | | | |
| **Other user-generated content** (date plans, place reviews, ratings) | Yes | Yes (Supabase) | Optional | App functionality, Personalization |
| **Other actions** | No | | | |

### Web browsing

All No.

### App info and performance

| Sub-type | Collected | Shared | Optional/Required | Purposes |
|---|---|---|---|---|
| **Crash logs** (Sentry, with `sendDefaultPii: true` → includes IP and user_id) | Yes | Yes (Sentry) | Required | App functionality, Analytics, Fraud prevention |
| **Diagnostics** (performance metrics, network timing, breadcrumbs — Sentry) | Yes | Yes (Sentry, Mixpanel) | Required | App functionality, Analytics |
| **Other app performance data** | No | | | |

### Device or other identifiers

| Sub-type | Collected | Shared | Optional/Required | Purposes |
|---|---|---|---|---|
| **Device or other IDs** (Android Advertising ID + Apple IDFA via AppsFlyer after ATT consent; device UID; OneSignal subscription ID) | Yes | Yes (AppsFlyer, Mixpanel, OneSignal, Sentry) | Required (Android Ad ID + iOS IDFA are required to function for AppsFlyer attribution; OneSignal token required for push) | Analytics, App functionality, Communications |

### Location

| Sub-type | Collected | Shared | Optional/Required | Purposes |
|---|---|---|---|---|
| **Approximate location** (city / country, derived from reverse geocoding or user-selected) | Yes | Yes (Supabase, Mixpanel) | Required (used for recommendations) | App functionality, Personalization |
| **Precise location** (GPS coordinates via `expo-location` `getCurrentPositionAsync` / `watchPositionAsync`) | Yes | Yes (Google for reverse geocoding via Mingla's edge function) | **Optional** (user can deny location permission and manually select a city) | App functionality, Personalization |

---

## Section 3 — Data usage and handling

For **every** data type marked "Yes (Collected)" above, Google also asks:

**Is this data processed ephemerally?**
- → No (every collected category is persisted in Supabase or third-party SDK storage for the duration of the user's account)

**Is this data required for the app to function?**
- → See per-row "Optional/Required" column above. Mostly Required; Photos/Audio/Messages/Other-content are Optional.

**Why is this data collected/shared?**
- → See per-row "Purposes" column above. Google accepts multiple purposes per data type.

**Are users in control of sharing this data?**
- → Yes for Optional rows (user can decline location, decline microphone, decline ATT, etc.)
- → No for Required rows (account creation requires email + name + phone; analytics/diagnostics required for app to function)

---

## Section 4 — Security practices

- **Data encrypted in transit:** Yes (HTTPS everywhere)
- **Data deletion mechanism:** Yes (in-app Settings → Delete Account; documented in Privacy Policy section 7)
- **Independent security review:** No (Mingla has not commissioned an external security audit — answer truthfully)
- **Compliance with Families Policy:** Not applicable (Mingla restricts to users 13+ per ToS and Children's Privacy section 8)

---

## Cross-references

- Privacy Policy live at `https://www.usemingla.com/privacy-policy/` (item #30 closed)
- App's deletion path: in-app Settings → Delete Account
- Code evidence files cited inline in the research audit (`src/services/enhancedLocationService.ts`, `src/services/mixpanelService.ts`, `src/services/appsFlyerService.ts`, `src/services/oneSignalService.ts`, `app/_layout.tsx` Sentry config, etc.)

## ⚠️ Side finding — Privacy Policy is OUT OF DATE

The current Privacy Policy at `usemingla.com/privacy-policy/` (deployed today via #30) lists only:
**Supabase, Twilio, Vonage, Google, Apple** as service providers.

The actual code uses MORE: **Mixpanel, AppsFlyer, Sentry, OneSignal, Cloudinary, RevenueCat, Stripe, Resend, OpenWeatherMap, BestTime, Mapbox, Ticketmaster**.

**Both stores ask if your declared data practices match your Privacy Policy.** Mismatch is a rejection risk. Recommend updating Privacy Policy section 5.1 (Service Providers) to list the full set before submission. This is its own work item — flag as ORCH-0980 or as a follow-up to #30.
