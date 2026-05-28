# ORCH-0977 — App Store Connect Privacy Nutrition Labels Answer Sheet

**For:** App Store Connect → My Apps → Mingla → **App Privacy** → Get Started / Edit
**Audit date:** 2026-05-27
**Audit method:** code probe + privacy policy cross-check + third-party SDK inventory
**Bundle audited:** `com.mingla.app.v2` at `~/Desktop/mingla-orchs/ORCH-0977-[consumer-app-store-launch]/app-mobile/`

How to use: ASC's Privacy form asks one big question — "Do you collect any of the following data types?" — and for each YES, you specify the data type's PURPOSE (multi-select) and whether it's **Linked to the user's identity** + whether it's **Used to Track**. Read down the list and paste each answer in the corresponding field.

---

## Apple's three buckets

Each data type your app collects is classified into one or more of:

- 🔴 **Data Used to Track You** = data sent to ANY third party for advertising or shared with a data broker. Triggers Apple's ATT prompt requirement.
- 🟡 **Data Linked to You** = data tied to the user's identity (account, device, etc.)
- 🟢 **Data Not Linked to You** = collected but stripped of identity before processing

A single data type can appear in multiple buckets if used multiple ways.

---

## Apple's data type taxonomy + Mingla's declaration

### Contact Info

| Apple data type | Collected? | Linked to user? | Used to track? | Purpose(s) |
|---|---|---|---|---|
| Name | ✅ Yes | 🟡 Yes (linked) | No | App Functionality, Product Personalization, Analytics |
| Email Address | ✅ Yes | 🟡 Yes (linked) | No | App Functionality, Product Personalization, Analytics |
| Phone Number | ✅ Yes | 🟡 Yes (linked) | No | App Functionality, Other Purposes (OTP verification, friend invites) |
| Physical Address | ❌ No | | | |
| Other User Contact Info | ❌ No | | | |

### Health & Fitness

All ❌ No.

### Financial Info

| Apple data type | Collected? | Linked? | Tracking? | Purpose(s) |
|---|---|---|---|---|
| Payment Info | ❌ **No** — Stripe/Apple/Google process payment data via their native sheets; Mingla only receives tokenized subscription state via RevenueCat. PCI scope sits with payment processors, not Mingla. | | | |
| Credit Info | ❌ No | | | |
| Other Financial Info | ❌ No | | | |

### Location

| Apple data type | Collected? | Linked? | Tracking? | Purpose(s) |
|---|---|---|---|---|
| Precise Location (3-decimal coordinates, GPS) | ✅ Yes (`expo-location` `getCurrentPositionAsync` / `watchPositionAsync`) | 🟡 Yes (linked) | No | App Functionality, Product Personalization, Analytics |
| Coarse Location (city / country) | ✅ Yes | 🟡 Yes (linked) | No | App Functionality, Product Personalization, Analytics |

### Sensitive Info

All ❌ No.

### Contacts

All ❌ No. Mingla does NOT access the device contacts list; invite recipients are manually typed.

### User Content

| Apple data type | Collected? | Linked? | Tracking? | Purpose(s) |
|---|---|---|---|---|
| Emails or Text Messages | ❌ No (Mingla SENDS SMS but does NOT READ inbox) | | | |
| Photos or Videos | ✅ Yes (uploaded to Cloudinary; board discussion + beta feedback) | 🟡 Yes (linked) | No | App Functionality |
| Audio Data | ✅ Yes (beta feedback voice notes; `expo-av`) | 🟡 Yes (linked) | No | App Functionality, App Diagnostics |
| Gameplay Content | ❌ No | | | |
| Customer Support | ❌ No (handled via email, not in-app) | | | |
| Other User Content | ✅ Yes (date plans, place reviews, ratings, board messages) | 🟡 Yes (linked) | No | App Functionality, Product Personalization |

### Browsing History

❌ No.

### Search History

❌ No (search queries against Google Places are NOT persisted with user identity).

### Identifiers

| Apple data type | Collected? | Linked? | Tracking? | Purpose(s) |
|---|---|---|---|---|
| User ID (Supabase user_id, OneSignal external_id, AppsFlyer customer_user_id, Mixpanel distinct_id) | ✅ Yes | 🟡 Yes (linked) | No | App Functionality, Analytics, Product Personalization |
| Device ID (Apple **IDFA** via AppsFlyer after ATT consent; device UID; OneSignal subscription ID) | ✅ Yes | 🟡 Yes (linked) | 🔴 **Yes (Used to Track)** — IDFA is collected after ATT prompt for AppsFlyer install attribution, which Apple defines as tracking even when used for first-party attribution | App Functionality, Analytics, Other Purposes (attribution) |

### Purchases

| Apple data type | Collected? | Linked? | Tracking? | Purpose(s) |
|---|---|---|---|---|
| Purchase History (via RevenueCat — subscription state, trial status, tier) | ✅ Yes | 🟡 Yes (linked) | No | App Functionality, Analytics |

### Usage Data

| Apple data type | Collected? | Linked? | Tracking? | Purpose(s) |
|---|---|---|---|---|
| Product Interaction (Mixpanel: screen views, card swipes, preference changes, friend actions, paywall views; AppsFlyer install/login) | ✅ Yes | 🟡 Yes (linked) | No | Analytics, App Functionality, Product Personalization |
| Advertising Data | ❌ No (Mingla runs no ad networks) | | | |
| Other Usage Data | ❌ No | | | |

### Diagnostics

| Apple data type | Collected? | Linked? | Tracking? | Purpose(s) |
|---|---|---|---|---|
| Crash Data (Sentry) | ✅ Yes | 🟡 **Yes (linked)** — Sentry is configured with `sendDefaultPii: true` so crash reports include IP + user_id (operator decision recorded in `app/_layout.tsx` comment) | No | App Functionality, Analytics |
| Performance Data (Sentry breadcrumbs, network timing, session replay 1% sample) | ✅ Yes | 🟡 Yes (linked) | No | App Functionality, Analytics |
| Other Diagnostic Data | ❌ No | | | |

### Other Data

❌ No.

---

## ATT prompt declaration

ASC also asks about your ATT prompt:

- **Does your app display the AppTrackingTransparency prompt?** → **Yes**
- **Reason for ATT prompt:** AppsFlyer collects IDFA for install attribution. Without ATT permission, AppsFlyer falls back to SKAdNetwork (Apple's privacy-preserving attribution).
- **NSUserTrackingUsageDescription string** (already in `app.json`): "Mingla uses this permission to measure ad performance and improve your experience. You can change this in Settings."

---

## Encryption Export Compliance (item #35)

ASC also asks if your app uses non-exempt encryption.

- **Answer: NO (uses only standard encryption)** — `app.json` already declares `ITSAppUsesNonExemptEncryption: false`, which auto-fills this question and skips the manual upload of CCATS classification documents.
- Item #35 will auto-clear when you submit; no manual action needed.

---

## Cross-references

- Privacy Policy live at `https://www.usemingla.com/privacy-policy/`
- App's deletion path: in-app Settings → Delete Account, plus marketing-site `/delete-account` instructions
- Apple expects your **App Privacy** declarations to match what's described in your Privacy Policy. The mismatch flagged in the Play Console doc (Privacy Policy lists only Supabase/Twilio/Vonage/Google/Apple but code uses Mixpanel/AppsFlyer/Sentry/OneSignal/Cloudinary/RevenueCat/Stripe/Resend/OpenWeatherMap/BestTime/Mapbox/Ticketmaster) applies here too — Apple App Review will flag the gap if a reviewer reads the policy carefully.

## ⚠️ Side finding — Privacy Policy is OUT OF DATE

Same as the Play Console doc. Recommend updating Privacy Policy section 5.1 (Service Providers) to list the full set of third parties before submission. Both stores hard-reject if the declared data practices don't match the policy. File this as a follow-up to #30 OR as ORCH-0980. Estimated ~15 min to write + ship via a small marketing PR.

---

## Quick reconciliation — what's "Used to Track You" vs "Linked to You"

For ASC, you mostly answer **Linked to You = Yes** because nearly every collected data point is tied to the user's Supabase account ID. The single category that triggers **Used to Track You = Yes** is **Device ID (IDFA)** — and only because Mingla uses ATT + AppsFlyer for install attribution.

If you wanted to AVOID the "Tracking" declaration in the future, you'd need to remove AppsFlyer (or run AppsFlyer in SKAdNetwork-only mode without IDFA). That's a separate architectural decision, not in scope for ORCH-0977.
