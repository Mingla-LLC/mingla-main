/**
 * Derive `BrandStripeStatus` from mirrored `brands` + optional `requirements` JSON.
 *
 * Logic mirrors `supabase/functions/_shared/stripeConnectProjection.ts` — keep in sync.
 */

import type { BrandStripeStatus } from "../store/currentBrandStore";

interface RequirementsLike {
  currently_due?: unknown;
  past_due?: unknown;
  disabled_reason?: unknown;
}

function reqArray(req: RequirementsLike | null | undefined, key: string): unknown[] {
  if (req === null || req === undefined) return [];
  const v = (req as Record<string, unknown>)[key];
  return Array.isArray(v) ? v : [];
}

export function deriveBrandStripeStatus(
  stripeConnectId: string | null | undefined,
  chargesEnabled: boolean,
  _payoutsEnabled: boolean,
  requirements: RequirementsLike | Record<string, unknown> | null | undefined,
): BrandStripeStatus {
  if (stripeConnectId === null || stripeConnectId === undefined || stripeConnectId.trim() === "") {
    return "not_connected";
  }

  const req = requirements as RequirementsLike | null | undefined;
  const disabledReason =
    req !== null &&
    req !== undefined &&
    typeof (req as RequirementsLike).disabled_reason === "string" &&
    ((req as RequirementsLike).disabled_reason as string).length > 0
      ? ((req as RequirementsLike).disabled_reason as string)
      : null;

  if (disabledReason !== null) {
    return "restricted";
  }

  if (chargesEnabled) {
    return "active";
  }

  const due =
    reqArray(req ?? null, "currently_due").length > 0 ||
    reqArray(req ?? null, "past_due").length > 0;
  if (due) {
    return "onboarding";
  }

  return "onboarding";
}

export const BRAND_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
