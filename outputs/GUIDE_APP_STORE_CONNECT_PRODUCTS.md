# App Store Connect Product Setup Guide for Mingla

## What Your Code Expects

Your codebase has **2 tiers** and **2 entitlements**:

| Tier | RevenueCat Entitlement ID (exact) | How code checks it |
|------|-----------------------------------|--------------------|
| **Pro** | `Mingla Pro` | `customerInfo.entitlements.active["Mingla Pro"]` |
| **Elite** | `Mingla Elite` | `customerInfo.entitlements.active["Mingla Elite"]` |

### Critical: How Products Get Sorted Into Tiers

`CustomPaywallScreen.tsx` line 78-80 filters packages by tier using:

```ts
pkg.product.identifier.toLowerCase().includes(tier)
```

This means your **App Store product IDs MUST contain "pro" or "elite"** in the name. Otherwise, the paywall shows "Loading packages..." forever.

### Critical: How Period Labels Are Determined

`CustomPaywallScreen.tsx` line 83-90 reads the identifier to show "Monthly", "Annual", etc.:

```ts
if (id.includes('annual') || id.includes('yearly')) return 'Annual'
if (id.includes('monthly'))                          return 'Monthly'
if (id.includes('weekly'))                           return 'Weekly'
if (id.includes('lifetime'))                         return 'Lifetime'
```

So your product IDs must ALSO contain the period keyword.

---

## Step-by-Step: App Store Connect

### 1. Go to App Store Connect > Your App > Subscriptions

URL: https://appstoreconnect.apple.com → Apps → Mingla → Subscriptions (left sidebar under "Monetization")

### 2. Create Subscription Groups

You need **two subscription groups** (one per tier):

| Group Name | Purpose |
|------------|---------|
| **Mingla Pro** | All Pro-tier subscription durations |
| **Mingla Elite** | All Elite-tier subscription durations |

> Apple requires subscriptions within a group to be mutually exclusive (user can only have one active at a time within a group). Separate groups allow a user to theoretically have both Pro and Elite, but your code handles this — Elite takes priority.

### 3. Create Products Inside Each Group

For each group, create the subscription products you want to offer. **The Product ID is the most important field** — it must match what RevenueCat and your code expect.

#### Recommended Product IDs

| Product ID | Group | Display Name | Duration |
|------------|-------|--------------|----------|
| `mingla_pro_monthly` | Mingla Pro | Mingla Pro Monthly | 1 Month |
| `mingla_pro_annual` | Mingla Pro | Mingla Pro Annual | 1 Year |
| `mingla_elite_monthly` | Mingla Elite | Mingla Elite Monthly | 1 Month |
| `mingla_elite_annual` | Mingla Elite | Mingla Elite Annual | 1 Year |

> Optional additions if you want: `mingla_pro_weekly`, `mingla_elite_weekly`, `mingla_pro_lifetime`, `mingla_elite_lifetime`

#### For Each Product, Fill In:

1. **Product ID** — exactly as shown above (lowercase, underscores)
2. **Reference Name** — human-readable, e.g. "Mingla Pro - Monthly"
3. **Subscription Duration** — select the matching period
4. **Subscription Price** — set your price in all territories
5. **Localizations** — at minimum add English (US):
   - **Display Name**: e.g. "Mingla Pro" or "Mingla Elite"
   - **Description**: e.g. "Unlimited swipes, curated experiences, custom starting point"

### 4. Set Subscription Pricing

For each product:
1. Click the product → Subscription Prices
2. Click "+" to add a price
3. Select starting price (e.g., $4.99/mo for Pro, $9.99/mo for Elite)
4. Apple auto-calculates other territories

### 5. Review Status

Each product must reach **"Ready to Submit"** status. Common blockers:
- Missing localizations
- Missing price
- Missing screenshot (for the subscription page — can be added later with app review)

---

## Step-by-Step: RevenueCat Dashboard

### 6. Add Products in RevenueCat

Go to RevenueCat Dashboard → Your Project → Products (left sidebar)

For each product:
1. Click "New Product"
2. **App Store Product ID**: paste the exact ID (e.g., `mingla_pro_monthly`)
3. **Store**: App Store
4. Save

You should have 4 products minimum (or however many you created above).

### 7. Configure the Offering

Go to RevenueCat → Offerings

You likely have a "default" offering. Inside it, create **packages**:

| Package Identifier | Product |
|-------------------|---------|
| `mingla_pro_monthly` | mingla_pro_monthly |
| `mingla_pro_annual` | mingla_pro_annual |
| `mingla_elite_monthly` | mingla_elite_monthly |
| `mingla_elite_annual` | mingla_elite_annual |

> **Package identifiers** — your code doesn't filter by RC's built-in `$rc_monthly` etc. It uses the **product identifier** to determine tier and period. So the package identifier doesn't matter much, but keeping it consistent is good practice.

### 8. Configure Entitlements

Go to RevenueCat → Entitlements

Create (or verify you have) exactly these two:

| Entitlement ID | Products to attach |
|----------------|-------------------|
| `Mingla Pro` | `mingla_pro_monthly`, `mingla_pro_annual` |
| `Mingla Elite` | `mingla_elite_monthly`, `mingla_elite_annual` |

**The entitlement IDs must be exactly `Mingla Pro` and `Mingla Elite`** (capital M, space between words). These are hardcoded in `revenueCatService.ts` lines 22-23.

---

## Verification Checklist

After setup, verify:

- [ ] App Store Connect: All products show "Ready to Submit" (or "Approved" if app was already reviewed)
- [ ] RevenueCat Products: All 4+ products appear and show "✓" for App Store connection
- [ ] RevenueCat Entitlements: "Mingla Pro" has Pro products attached, "Mingla Elite" has Elite products attached
- [ ] RevenueCat Offerings: Default offering has all packages
- [ ] **Test**: Run the app → the error should disappear and `useOfferings()` returns packages
- [ ] **Test**: Open `CustomPaywallScreen` → Pro tab shows Pro packages, Elite tab shows Elite packages

---

## Common Pitfalls

1. **Product ID typo** — If the product ID doesn't contain "pro" or "elite", the paywall will show "Loading packages..." because `filterPackagesByTier` won't match anything.

2. **Entitlement ID mismatch** — Must be exactly `Mingla Pro` and `Mingla Elite` with that exact casing and spacing. RevenueCat is case-sensitive.

3. **Products not attached to entitlements** — Even if products exist and are in an offering, purchases won't grant entitlements unless the products are attached to the entitlement objects.

4. **Sandbox vs Production** — Your API key (`appl_yzYuV...`) is a production key. For testing, use a Sandbox Apple ID in App Store Connect → Users and Access → Sandbox Testers.

5. **Agreements** — If you haven't signed the Paid Applications agreement in App Store Connect → Business → Agreements, Tax, and Banking, products won't work at all.
