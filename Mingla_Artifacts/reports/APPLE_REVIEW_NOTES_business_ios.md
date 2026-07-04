# App Store Review Notes + Resolution Center reply — Mingla Business iOS

Second rejection (Submission 8d0b57b5-5591-4d92-8aa3-a3a728832dfb, reviewed 2026-07-03 on iPad Air 11-inch M3 / iPadOS 26.5, **build 1.0(15)** — predates the fixes). Fixes are in **build 1.0.2 (28)**.

**BEFORE replying (critical):** in App Store Connect, attach **build 1.0.2 (28)** to the version and submit THAT for review. Apple reviewed the old build 1.0(15); a reply alone re-reviews the old, still-affected build. The two 2.1(a) bugs are fixed only in build 28.

Facts verified 2026-07-04: demo event "FIFA Grill Night" (organizer Smoke & Rhythm) is live (`scheduled` = publicly visible) with 3 paid tiers — General Player Pass $10, Grill & Game Pass $20, VIP Tournament Pass $35 (USD). Account-deletion entry is a direct "Delete account" row in the Account tab. App is iPhone-only (`supportsTablet:false`) → runs on iPad in iPhone-compatibility mode.

---

## Paste into: Resolution Center reply

Thank you for the detailed review. We have addressed all three items; a new build, **version 1.0.2 (build 28)**, contains the fixes for the two App Completeness issues. Please review build 1.0.2 (28), as build 1.0(15) predates these fixes.

**Guideline 2.1 — Apple Pay / PassKit.** Apple Pay is integrated inside the in-app ticket-purchase flow, presented by the Stripe payment sheet. PassKit is linked transitively by our payment provider's SDK (Stripe — `@stripe/stripe-react-native` / the Stripe iOS SDK), which powers all in-app ticket payments; we do not use PassKit directly outside Stripe-mediated checkout. To locate it: open the event **"FIFA Grill Night"** (organizer **Smoke & Rhythm**) → tap **Get tickets** → select **General Player Pass ($10)** → continue to **Payment** → tap **Pay** → the Stripe payment sheet appears and offers **Apple Pay** alongside card entry. Important: Apple Pay only renders when the review device has at least one card added to **Apple Wallet** (standard Apple Pay behavior); with no Wallet card, only card entry is shown. Please add a test card to Wallet on the review device to see the Apple Pay button. The account is in Stripe **test mode**, so Apple Pay tokenizes against test processing (no real charge).

**Guideline 2.1(a) — Profile edit spinner.** Fixed in build 1.0.2 (28). Root cause: the profile/brand screens performed network reads without a client-side timeout, so on a throttled/proxied review network the loading indicator could spin indefinitely — including the iPad (compatibility-mode) case observed. We added a bounded timeout (a stalled read now surfaces an actionable "Retry" screen instead of an infinite spinner) and hardened the launch/auth boot path against the same stall. Verified the edit-profile and brand screens resolve to content or an actionable error on slow networks, on iPad.

**Guideline 2.1(a) — Account deletion.** Now directly accessible in build 1.0.2 (28): open the **Account** tab → in the settings list, tap **"Delete account"** (trash icon, directly below "Sign out everywhere") → a confirmation flow permanently deletes the account and its data. (Previously it was reachable only from within Edit Profile; this build adds the direct, clearly-labeled entry.)

Note: the app is designed and submitted for iPhone (not iPad-optimized; `supportsTablet` is false), so it runs on iPad in iPhone-compatibility mode; all three items above are verified in that mode on build 1.0.2 (28).

---

## Paste into: App Store Connect → the 1.0.2 version's "Review Notes" (App Review Information)

Apple Pay is integrated via the Stripe payment sheet in the in-app ticket checkout. To reach it: FIFA Grill Night → Get tickets → General Player Pass ($10) → Payment → Pay → the sheet offers Apple Pay when a card is in Apple Wallet (please add a test card to Wallet). Account in Stripe test mode (no real charge). PassKit is linked transitively by the Stripe iOS SDK.

Account deletion: Account tab → "Delete account" (below "Sign out everywhere") → confirm.

Profile screens and launch/auth now use bounded timeouts (Retry on stall) so no indefinite spinner, including on iPad compatibility mode. iPhone-only app (`supportsTablet` false).
