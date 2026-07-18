// Ve3 — venue claim approved operator email body.

import type { GenericBodyInput } from "./types.ts";

export function buildClaimApprovedEmail(input: {
  brandName: string;
  publicVenueUrl: string;
}): GenericBodyInput {
  return {
    variant: "generic_notification",
    title: "Your venue is live on Mingla",
    paragraphs: [
      `Good news — ${input.brandName} has been approved.`,
      "Your venue profile is now visible to guests. Sign in to Mingla Business to manage events and your profile.",
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
  const base = (Deno.env.get("BUSINESS_WEB_ORIGIN") ??
    Deno.env.get("MINGLA_BUSINESS_WEB_URL") ??
    "https://business.usemingla.com").replace(/\/+$/, "");
  const safeSlug = encodeURIComponent(slug.trim());
  return `${base}/b/${safeSlug}`;
}
