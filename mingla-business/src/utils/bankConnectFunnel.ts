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
  destination?: BankConnectReturnDestination;
}

export type BankConnectReturnDestination = "payments" | "brand-create";

export function buildBankConnectWebReturnUrl(
  origin: string,
  brandId: string,
  destination: BankConnectReturnDestination = "payments",
): string {
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.protocol !== "https:") {
    throw new Error("Bank setup requires a secure HTTPS page.");
  }
  const returnUrl = destination === "brand-create"
    ? new URL("/brand/new", parsedOrigin.origin)
    : new URL(
      `/brand/${encodeURIComponent(brandId)}/payments`,
      parsedOrigin.origin,
    );
  if (destination === "brand-create") {
    returnUrl.searchParams.set("resume_brand", brandId);
  }
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
    input.destination,
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
