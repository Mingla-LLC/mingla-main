# ORCH-1215 — Mingla Business · App Store Connect Privacy Nutrition Labels Answer Sheet

**For:** App Store Connect → My Apps → **Mingla Business** (ASC App ID `6768737367`) → **App Privacy** → Get Started / Edit
**Audit date:** 2026-06-22
**Audit method:** code probe of `mingla-business/` + shared-backend cross-check + SDK inventory
**Bundle audited:** `com.sethogieva.minglabusiness` v1.0.0
**Modeled on:** `ORCH_0977_APP_STORE_PRIVACY_NUTRITION_LABELS.md` (consumer). Business deltas are flagged ⚠️.

How to use: ASC's Privacy form asks "Do you collect any of the following data types?" For each YES, specify PURPOSE (multi-select), whether **Linked to the user's identity**, and whether **Used to Track**. Read down and paste.

> **Business-vs-consumer deltas (read first):**
> - **No Location collected** — business app has NO `expo-location` and NO `NSLocation*` infoPlist key (verified `app.json`). Declare Precise + Coarse Location = **No**.
> - **No Purchase History** — RevenueCat is install-only, NO IAP (`src/services/revenueCatService.ts`). Declare Purchases = **No**.
> - **Phone Number not collected for the account** — auth is Apple / Google / Email-OTP, no phone gate. (Buyer checkout phone may apply — see row.)
> - **Sentry has no `sendDefaultPii`** — crash data still Linked (tied to account session) but not deliberately IP/PII-tagged.
> - **IDFA / ATT still applies** — `expo-tracking-transparency` + AppsFlyer present (`app.config.ts` plugin + `NSUserTrackingUsageDescription` in `app.json`). Device ID = **Used to Track = Yes**, same as consumer.

---

## Apple's three buckets

- 🔴 **Used to Track You** = data shared with third parties for advertising / data brokers → triggers ATT.
- 🟡 **Linked to You** = tied to user identity.
- 🟢 **Not Linked to You** = identity-stripped.

---

## Apple data type taxonomy + Mingla Business declaration

### Contact Info

| Apple data type | Collected? | Linked? | Tracked? | Purpose(s) |
|---|---|---|---|---|
| Name | ✅ Yes | 🟡 Yes | No | App Functionality, Analytics |
| Email Address | ✅ Yes | 🟡 Yes | No | App Functionality, Communications, Analytics |
| Phone Number | ⚠️ Conditional — **No** for the organizer account (no phone auth). ✅ Yes **only if** buyer checkout phone is persisted (`eventOrdersService`/`phone.test`). If yes: 🟡 Linked / No track / App Functionality. ⚠️ VERIFY buyer-phone persistence. | | | |
| Physical Address | ❌ No (venue/stop addresses are business place addresses, not the user's personal address) | | | |
| Other User Contact Info | ❌ No | | | |

### Health & Fitness
All ❌ No.

### Financial Info

| Apple data type | Collected? | Linked? | Tracked? | Purpose(s) |
|---|---|---|---|---|
| Payment Info | ❌ **No** — buyer card data goes into Stripe PaymentSheet / Apple Pay; brand payout bank details go into Stripe Connect / Paystack hosted+embedded onboarding. Mingla receives only tokens. PCI scope sits with the processors. | | | |
| Credit Info | ❌ No | | | |
| Other Financial Info | ❌ No | | | |

### Location

| Apple data type | Collected? | Linked? | Tracked? | Purpose(s) |
|---|---|---|---|---|
| Precise Location | ❌ **No** (no `expo-location`; no `NSLocationWhenInUseUsageDescription`) | | | |
| Coarse Location | ❌ **No** | | | |

### Sensitive Info
All ❌ No.

### Contacts
All ❌ No. No device-contacts access.

### User Content

| Apple data type | Collected? | Linked? | Tracked? | Purpose(s) |
|---|---|---|---|---|
| Emails or Text Messages | ❌ No (Mingla sends mail via Resend but does not read the inbox) | | | |
| Photos or Videos | ✅ Yes (brand logo + event/experience cover image/video uploaded to Cloudinary; `expo-image-picker`, `expo-video`, `CoverPicker.tsx`) | 🟡 Yes | No | App Functionality |
| Audio Data | ❌ No (no audio-record code path; `RECORD_AUDIO` permission is vestigial — recommend removing) | | | |
| Gameplay Content | ❌ No | | | |
| Customer Support | ⚠️ ✅ Yes — the in-app **Support tab** has a ticket inbox (`app/support/inbox.tsx`, `[ticketId].tsx`). Organizer support messages are stored. Declare 🟡 Linked / No track / App Functionality (Customer Support). | 🟡 Yes | No | App Functionality |
| Other User Content | ✅ Yes (brand/event/trip/experience listings, menu items, marketing campaign copy, **Ari AI-assistant chat prompts** `app/(tabs)/ari.tsx`) | 🟡 Yes | No | App Functionality |

### Browsing History
❌ No.

### Search History
❌ No (Mapbox address autocomplete not persisted with identity).

### Identifiers

| Apple data type | Collected? | Linked? | Tracked? | Purpose(s) |
|---|---|---|---|---|
| User ID (Supabase user_id, OneSignal external_id, AppsFlyer customer_user_id, Mixpanel/PostHog distinct_id) | ✅ Yes | 🟡 Yes | No | App Functionality, Analytics |
| Device ID (Apple **IDFA** via AppsFlyer after ATT; device UID; OneSignal subscription ID) | ✅ Yes | 🟡 Yes | 🔴 **Yes (Used to Track)** — IDFA collected after the ATT prompt for AppsFlyer install attribution, which Apple defines as tracking | App Functionality, Analytics, Other Purposes (attribution) |

### Purchases

| Apple data type | Collected? | Linked? | Tracked? | Purpose(s) |
|---|---|---|---|---|
| Purchase History | ❌ **No** — Business has NO IAP/subscription (RevenueCat install-only, no products). Ticket sales the brand makes are business records, not the app user's personal purchases. | | | |

### Usage Data

| Apple data type | Collected? | Linked? | Tracked? | Purpose(s) |
|---|---|---|---|---|
| Product Interaction (Mixpanel + PostHog: screen views, create steps, publish, marketing actions; AppsFlyer install/login) | ✅ Yes | 🟡 Yes | No | Analytics, App Functionality |
| Advertising Data | ❌ No (Mingla runs no ad networks) | | | |
| Other Usage Data | ❌ No | | | |

### Diagnostics

| Apple data type | Collected? | Linked? | Tracked? | Purpose(s) |
|---|---|---|---|---|
| Crash Data (Sentry; `sendDefaultPii` NOT set) | ✅ Yes | 🟡 Yes (tied to the authenticated session) | No | App Functionality, Analytics |
| Performance Data (Sentry traces; PostHog/Mixpanel perf) | ✅ Yes | 🟡 Yes | No | App Functionality, Analytics |
| Other Diagnostic Data | ❌ No | | | |

### Other Data
❌ No.

---

## ATT prompt declaration

- **Does your app display the ATT prompt?** → **Yes**
- **Reason:** AppsFlyer collects IDFA for install attribution. Without ATT, AppsFlyer falls back to SKAdNetwork.
- **NSUserTrackingUsageDescription** (already in `app.json` infoPlist + set via the `expo-tracking-transparency` plugin in `app.config.ts`):
  > "Mingla Business uses your advertising identifier to measure the performance of our ads and help us reach more organizers like you."

---

## Encryption Export Compliance

- **Answer: NO (uses only standard encryption)** — `app.json` infoPlist already declares `ITSAppUsesNonExemptEncryption: false`, which auto-fills this and skips CCATS docs. No manual action.

---

## Quick reconciliation — Tracked vs Linked

Mostly **Linked to You = Yes** (everything ties to the Supabase account). The single **Used to Track = Yes** category is **Device ID (IDFA)** via ATT + AppsFlyer — same as consumer. To avoid the Tracking declaration in the future you'd remove AppsFlyer / run it SKAdNetwork-only (separate decision, out of scope here).

## Cross-references

- Privacy Policy: `https://usemingla.com/privacy-policy` · Support: `https://usemingla.com/support`
- ⚠️ Apple expects App Privacy declarations to match the Privacy Policy. Confirm the policy covers the full business processor set (Stripe Connect, Paystack, PostHog, Cloudinary, Mapbox, GIPHY, Pexels, Gemini parser) — see the mismatch flag in the Play Data Safety doc.
