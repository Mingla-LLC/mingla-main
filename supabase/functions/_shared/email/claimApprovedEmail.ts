// Ve3 — venue claim approved operator email body.

import type { GenericBodyInput } from "./types.ts";
import { buildBrandPublicUrl } from "../brandPublicUrl.ts";

export function buildClaimApprovedEmail(input: {
  brandName: string;
  publicVenueUrl: string;
}): GenericBodyInput {
  return {
    variant: "generic_notification",
    title: "Your venue is live on Mingla",
    paragraphs: [
      `Good news — ${input.brandName} has been approved.`,
      "Your venue profile is now visible to guests. Sign in to Mingla Host to manage events and your profile.",
    ],
    cta: {
      label: "View your venue page",
      url: input.publicVenueUrl,
    },
  };
}

export function defaultVenuePublicUrl(slug: string): string {
  // ISSUE-927: BUSINESS_WEB_ORIGIN is the canonical secret; the old name is
  // a fallback so its deletion is safely decoupled (same digest, audited).
  // The env chain stays HERE — #3258 only moved the `/b/{slug}` assembly
  // (trailing-slash strip + slug encoding) into the shared builder so this
  // module and Stripe onboarding cannot drift on what a brand page looks like.
  const base = Deno.env.get("BUSINESS_WEB_ORIGIN") ??
    Deno.env.get("MINGLA_BUSINESS_WEB_URL") ??
    "https://host.usemingla.com";
  return buildBrandPublicUrl({ origin: base, slug });
}
