/**
 * Stripe decides whether Google Pay uses its test environment from the
 * publishable key attached to the PaymentIntent, not from an EAS profile name.
 * A missing or live key must fail closed to the live environment: treating an
 * unknown key as test would silently disable real Google Pay in a store build.
 */
export const isStripeGooglePayTestEnv = (
  publishableKey: string | null | undefined,
): boolean => publishableKey?.trim().startsWith("pk_test_") === true;
