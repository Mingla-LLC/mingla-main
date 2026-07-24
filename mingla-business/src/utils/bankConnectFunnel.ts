import {
  getStripeSupportedCountry,
  type StripeSupportedCountry,
} from "../constants/stripeSupportedCountries";

export type BankConnectProvider = "stripe" | "paystack";

export interface BankConnectRail {
  provider: BankConnectProvider;
  countryCode: string;
  displayName: string;
  currency: string;
}

interface ResolveBankConnectRailInput {
  countryCode?: string | null;
  paymentProvider?: string | null;
}

interface StartStripeWebBankConnectInput {
  brandId: string;
  userId: string;
  country: string;
  origin: string;
  tosVersion: string;
  acceptTerms: (input: {
    brandId: string;
    userId: string;
    version: string;
  }) => Promise<unknown>;
  mintOnboarding: (input: {
    brandId: string;
    returnUrl: string;
    country: string;
  }) => Promise<{ onboarding_url: string }>;
  assign: (url: string) => void;
}

const DEFAULT_STRIPE_COUNTRY = "GB" as const;
const PAYSTACK_RAIL: BankConnectRail = {
  provider: "paystack",
  countryCode: "NG",
  displayName: "Nigeria",
  currency: "NGN",
} as const;

function normalizeCountryCode(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized.length === 2 ? normalized : null;
}

function stripeRail(country: StripeSupportedCountry): BankConnectRail {
  return {
    provider: "stripe",
    countryCode: country.country,
    displayName: country.displayName,
    currency: country.defaultCurrency,
  };
}

/**
 * Resolves the payout rail from the canonical brand row.
 *
 * Paystack is Nigeria-only. Stripe countries must exist in Mingla's existing
 * frontend allowlist; missing or unsupported country data keeps the prior GB
 * fallback instead of sending an untrusted code to Stripe.
 */
export function resolveBankConnectRail(
  input: ResolveBankConnectRailInput,
): BankConnectRail {
  const countryCode = normalizeCountryCode(input.countryCode);
  const provider =
    typeof input.paymentProvider === "string"
      ? input.paymentProvider.trim().toLowerCase()
      : null;

  if (provider === "paystack" || countryCode === "NG") {
    return PAYSTACK_RAIL;
  }

  const supported = countryCode === null
    ? null
    : getStripeSupportedCountry(countryCode);
  return stripeRail(
    supported ??
      getStripeSupportedCountry(DEFAULT_STRIPE_COUNTRY) ??
      (() => {
        throw new Error("The canonical Stripe country list is missing GB.");
      })(),
  );
}

export function buildBankConnectWebReturnUrl(
  origin: string,
  brandId: string,
): string {
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.protocol !== "https:") {
    throw new Error("Bank setup requires a secure HTTPS page.");
  }
  const returnUrl = new URL(
    `/brand/${encodeURIComponent(brandId)}/payments`,
    parsedOrigin.origin,
  );
  return returnUrl.toString();
}

export function isSameOriginConnectOnboardingUrl(
  onboardingUrl: string,
  expectedOrigin: string,
): boolean {
  try {
    const parsed = new URL(onboardingUrl);
    const origin = new URL(expectedOrigin);
    return (
      parsed.protocol === "https:" &&
      parsed.origin === origin.origin &&
      parsed.pathname === "/connect-onboarding" &&
      (parsed.searchParams.get("session")?.trim().length ?? 0) > 0
    );
  } catch {
    return false;
  }
}

/**
 * Load-bearing web sequence for the one-hop Stripe path.
 *
 * Terms are persisted before the AccountSession is minted. The minted URL is
 * accepted only when it is the existing same-origin HTTPS Connect form with a
 * non-empty session, then the browser performs one same-tab navigation.
 */
export async function startStripeWebBankConnect(
  input: StartStripeWebBankConnectInput,
): Promise<string> {
  await input.acceptTerms({
    brandId: input.brandId,
    userId: input.userId,
    version: input.tosVersion,
  });

  const returnUrl = buildBankConnectWebReturnUrl(
    input.origin,
    input.brandId,
  );
  const result = await input.mintOnboarding({
    brandId: input.brandId,
    returnUrl,
    country: input.country,
  });

  if (
    !isSameOriginConnectOnboardingUrl(
      result.onboarding_url,
      input.origin,
    )
  ) {
    throw new Error(
      "Stripe returned an unexpected bank setup link. Please try again.",
    );
  }

  input.assign(result.onboarding_url);
  return result.onboarding_url;
}
