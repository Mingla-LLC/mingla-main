import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
  type MakePurchaseResult,
} from 'react-native-purchases'
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui'
import { Platform } from 'react-native'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// RevenueCat API key (test key — replace with platform-specific prod keys before launch)
const RC_API_KEY = 'test_VOcmlrBhMcrSUqAlhRqDzUfkRYL'

// The entitlement identifier configured in the RevenueCat dashboard
export const RC_ENTITLEMENT_ID = 'Mingla Pro'

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

let _configured = false

/**
 * Configure the RevenueCat SDK. Call once at app startup (before any purchases
 * or customer info fetches). Safe to call again when the user changes — RC will
 * log out and log in the new user automatically.
 *
 * @param userId  Supabase user UUID, or null for anonymous users.
 */
export function configureRevenueCat(userId: string | null): void {
  Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.ERROR)

  if (!_configured) {
    Purchases.configure({
      apiKey: RC_API_KEY,
      appUserID: userId ?? undefined, // undefined → anonymous
    })
    _configured = true
  }
}

/**
 * Log in a Supabase user to RevenueCat. This merges any anonymous purchases
 * made before sign-in with the identified user's account.
 *
 * Call this immediately after a successful Supabase sign-in.
 */
export async function loginRevenueCat(userId: string): Promise<CustomerInfo> {
  const { customerInfo } = await Purchases.logIn(userId)
  return customerInfo
}

/**
 * Log out of RevenueCat. Call this immediately after Supabase sign-out.
 * RC will revert to an anonymous user session.
 */
export async function logoutRevenueCat(): Promise<CustomerInfo> {
  return Purchases.logOut()
}

// ─────────────────────────────────────────────────────────────────────────────
// Entitlement helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the given CustomerInfo has an active "Mingla Pro" entitlement.
 */
export function hasProEntitlement(customerInfo: CustomerInfo): boolean {
  return customerInfo.entitlements.active[RC_ENTITLEMENT_ID] !== undefined
}

/**
 * Returns the expiration date of the active "Mingla Pro" entitlement,
 * or null if not active / lifetime purchase.
 */
export function getProExpirationDate(customerInfo: CustomerInfo): Date | null {
  const entitlement = customerInfo.entitlements.active[RC_ENTITLEMENT_ID]
  if (!entitlement) return null
  if (!entitlement.expirationDate) return null // lifetime
  return new Date(entitlement.expirationDate)
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer info
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the latest CustomerInfo from RevenueCat.
 * Throws on network/SDK errors.
 */
export async function getCustomerInfo(): Promise<CustomerInfo> {
  return Purchases.getCustomerInfo()
}

/**
 * Register a listener that fires every time CustomerInfo changes (e.g. after
 * a purchase, a renewal, or a cancellation detected server-side).
 *
 * Returns a cleanup function — call it inside a useEffect cleanup or on sign-out.
 */
export function addCustomerInfoListener(
  listener: (info: CustomerInfo) => void,
): () => void {
  Purchases.addCustomerInfoUpdateListener(listener)
  return () => Purchases.removeCustomerInfoUpdateListener(listener)
}

// ─────────────────────────────────────────────────────────────────────────────
// Offerings & packages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the current offering from RevenueCat.
 * Returns null if no offering is configured on the dashboard.
 */
export async function getCurrentOffering(): Promise<PurchasesOffering | null> {
  const offerings = await Purchases.getOfferings()
  return offerings.current
}

/**
 * Find a package by identifier within the current offering.
 * Identifiers match those set in the RevenueCat dashboard:
 *   '$rc_monthly', '$rc_annual', '$rc_weekly', '$rc_lifetime'
 * or the custom identifiers you named: 'monthly', 'yearly', 'weekly', 'lifetime'.
 */
export async function getPackageByIdentifier(
  identifier: string,
): Promise<PurchasesPackage | null> {
  const offering = await getCurrentOffering()
  if (!offering) return null
  return offering.availablePackages.find(p => p.identifier === identifier) ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// Purchasing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Purchase a package. Returns the CustomerInfo after a successful purchase.
 *
 * Throws `{ userCancelled: true }` if the user cancels the native payment sheet.
 * Throws an error object with a `message` for any other failure.
 */
export async function purchasePackage(
  pkg: PurchasesPackage,
): Promise<MakePurchaseResult> {
  return Purchases.purchasePackage(pkg)
}

/**
 * Restore previously purchased subscriptions. Use when a user reinstalls or
 * switches devices. Returns updated CustomerInfo.
 */
export async function restorePurchases(): Promise<CustomerInfo> {
  return Purchases.restorePurchases()
}

// ─────────────────────────────────────────────────────────────────────────────
// Paywall UI (RevenueCat Paywalls)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Imperatively present the RevenueCat paywall modal.
 * Returns the PAYWALL_RESULT enum indicating what happened.
 *
 * Use this for quick "upgrade" prompts from feature gates.
 * For the full standalone paywall screen, use <PaywallScreen />.
 */
export async function presentPaywall(): Promise<PAYWALL_RESULT> {
  return RevenueCatUI.presentPaywall()
}

/**
 * Present the paywall only if the user does not already have the "Mingla Pro"
 * entitlement. Ideal for feature-gate upgrade prompts.
 *
 * Returns PAYWALL_RESULT.NOT_PRESENTED if the user is already subscribed.
 */
export async function presentPaywallIfNeeded(): Promise<PAYWALL_RESULT> {
  return RevenueCatUI.presentPaywallIfNeeded({
    requiredEntitlementIdentifier: RC_ENTITLEMENT_ID,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer Center
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Present the RevenueCat Customer Center — a self-service portal where users
 * can manage their subscription, request refunds, and contact support.
 *
 * Show this from Profile or Account Settings.
 */
export async function presentCustomerCenter(): Promise<void> {
  await RevenueCatUI.presentCustomerCenter()
}
