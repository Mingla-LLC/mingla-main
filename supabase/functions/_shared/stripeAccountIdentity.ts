/**
 * #4389 — read the connected account's identity (its verified address) for
 * the Tap to Pay Terminal Location.
 *
 * Kept OUT of stripeBlueprintClient.ts on purpose: that client is the
 * onboarding client, pinned to STRIPE_RAK_ONBOARD for every call (ORCH-0953 /
 * ORCH-0954). This is a read and uses the refresh-status restricted key.
 */
import { STRIPE_BLUEPRINT_API_VERSION } from "./stripeBlueprintClient.ts";
import { resolveStripeKey } from "./stripeMode.ts";

/**
 * #4389 — the connected account's own address, already collected and verified
 * by Stripe during embedded onboarding (`GET /v2/core/accounts/{id}
 * ?include=identity`). A company keeps it at `identity.business_details.address`,
 * an individual at `identity.individual.address`. Used as the first source of
 * a Tap to Pay Terminal Location address, so a host never types it twice.
 */
export interface StripeIdentityAddress {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

export interface StripeV2AccountIdentity {
  id: string;
  identity?: {
    country?: string | null;
    entity_type?: string | null;
    business_details?: { address?: StripeIdentityAddress | null } | null;
    individual?: { address?: StripeIdentityAddress | null } | null;
  } | null;
}

export async function retrieveAccountIdentity(
  accountId: string,
): Promise<StripeV2AccountIdentity> {
  // A read, so the read-only refresh-status key — never the onboarding key.
  const key = resolveStripeKey("REFRESH_STATUS");
  const response = await fetch(
    `https://api.stripe.com/v2/core/accounts/${encodeURIComponent(accountId)}?include=identity`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        "Stripe-Version": STRIPE_BLUEPRINT_API_VERSION,
      },
    },
  );
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Leave payload null; the status still produces a safe error.
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload &&
        payload.error && typeof payload.error === "object" && "message" in payload.error &&
        typeof payload.error.message === "string"
      ? payload.error.message
      : `Stripe identity read failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as StripeV2AccountIdentity;
}

/** Company address first, then the individual's; null when neither has a street. */
export function identityAddressOf(
  account: StripeV2AccountIdentity | null,
): StripeIdentityAddress | null {
  const identity = account?.identity ?? null;
  if (!identity) return null;
  const company = identity.business_details?.address ?? null;
  const person = identity.individual?.address ?? null;
  const pick = identity.entity_type === "individual"
    ? [person, company]
    : [company, person];
  for (const a of pick) {
    if (a && typeof a.line1 === "string" && a.line1.trim().length > 0) return a;
  }
  return null;
}
