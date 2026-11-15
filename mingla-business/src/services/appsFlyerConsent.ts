/**
 * #4238 P2-2 (W6-6, I-4238-AF-DMA-CONSENT): AppsFlyer DMA consent for
 * EU / EEA / UK devices, from the app's existing analytics switch.
 *
 * The SDK's `setConsentData` (react-native-appsflyer 6.16.2+ `AppsFlyerConsent`
 * shape: isUserSubjectToGDPR + three consent flags) is told:
 *   - region in EU / EEA / UK → subject to GDPR, and every consent flag is
 *     "sharing on" (the switch is on by default, spec Q4) or "off" (switched off);
 *   - any other or unknown region → not subject to GDPR.
 * The region is the device locale's region (the closest on-device stand-in for
 * the store country; no new native module). Pure: callers pass the inputs.
 */

/** EU member states, the EEA (IS, LI, NO) and the UK. ISO 3166-1 alpha-2. */
export const DMA_REGION_CODES: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES",
  "SE", "IS", "LI", "NO", "GB",
]);

export interface AppsFlyerConsentData {
  isUserSubjectToGDPR: boolean;
  hasConsentForDataUsage?: boolean;
  hasConsentForAdsPersonalization?: boolean;
  hasConsentForAdStorage?: boolean;
}

/** The region subtag of a BCP 47 locale ("en-GB" → "GB"), upper-cased. */
export function regionFromLocale(locale: string | null | undefined): string | null {
  if (typeof locale !== "string") return null;
  const parts = locale.replace(/_/g, "-").split("-");
  for (const part of parts.slice(1)) {
    if (/^[A-Za-z]{2}$/.test(part)) return part.toUpperCase();
  }
  return null;
}

export function appsFlyerConsentFor(
  optedOut: boolean,
  regionCode: string | null | undefined,
): AppsFlyerConsentData {
  const region = typeof regionCode === "string" ? regionCode.toUpperCase() : "";
  if (!DMA_REGION_CODES.has(region)) return { isUserSubjectToGDPR: false };
  const granted = !optedOut;
  return {
    isUserSubjectToGDPR: true,
    hasConsentForDataUsage: granted,
    hasConsentForAdsPersonalization: granted,
    hasConsentForAdStorage: granted,
  };
}

/** The device locale's region, via Intl (never throws; null when unknown). */
export function intlDeviceRegion(): string | null {
  try {
    return regionFromLocale(new Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return null;
  }
}
