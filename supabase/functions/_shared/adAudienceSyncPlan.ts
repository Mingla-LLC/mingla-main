/** Issue #3697 — minimal @usemingla audience rows required for one event plan. */

import {
  type AudienceDefinition,
  AUTOMATIC_BRAND_AUDIENCE_CODES,
  AUTOMATIC_EVENT_AUDIENCE_CODES,
  AUTOMATIC_MARKET_AUDIENCE_CODES,
  buildAudienceDefinition,
} from "./adAudienceDefinitions.ts";
import type {
  AdAudienceScope,
  PaidSocialPlatform,
} from "./adAudienceStages.ts";

export type AudienceSyncEvent = {
  platform: PaidSocialPlatform;
  market: string;
  brandId: string;
  brandSlug: string;
  eventId: string;
  eventSlug: string;
  pageType: "event" | "rsvp" | "trip" | "experience";
  pixelId: string;
  eventEndsAt: string | null;
};

export type AudienceSyncSeed = {
  platform: PaidSocialPlatform;
  code: string;
  scope: AdAudienceScope;
  market: string;
  brandId: string | null;
  eventId: string | null;
  definition: AudienceDefinition;
};

function seed(
  input: AudienceSyncEvent,
  code: string,
  scope: AdAudienceScope,
): AudienceSyncSeed {
  const brandId = scope === "market" ? null : input.brandId;
  const eventId = scope === "event" ? input.eventId : null;
  return {
    platform: input.platform,
    code,
    scope,
    market: input.market.toUpperCase(),
    brandId,
    eventId,
    definition: buildAudienceDefinition({
      platform: input.platform,
      code,
      scope,
      market: input.market.toUpperCase(),
      brandId,
      brandSlug: scope === "market" ? null : input.brandSlug,
      eventId,
      eventSlug: scope === "event" ? input.eventSlug : null,
      pageType: input.pageType,
      pixelId: input.pixelId,
      eventEndsAt: scope === "event" ? input.eventEndsAt : null,
    }),
  };
}

/**
 * Event rows are precise. Brand/market rows are shared fallbacks and collapse
 * through the database's null-safe unique key when several plans need them.
 */
export function audienceSyncSeedsForEvent(
  input: AudienceSyncEvent,
): AudienceSyncSeed[] {
  if (!/^[A-Z]{2}$/.test(input.market.toUpperCase())) {
    throw new Error("audience_market_invalid");
  }
  if (
    !input.brandId.trim() || !input.brandSlug.trim() ||
    !input.eventId.trim() || !input.eventSlug.trim()
  ) {
    throw new Error("audience_event_identity_missing");
  }
  const rows = [
    ...AUTOMATIC_EVENT_AUDIENCE_CODES[input.platform].map((code) =>
      seed(input, code, "event")
    ),
    ...AUTOMATIC_BRAND_AUDIENCE_CODES[input.platform].map((code) =>
      seed(input, code, "brand")
    ),
    ...AUTOMATIC_MARKET_AUDIENCE_CODES[input.platform].map((code) =>
      seed(input, code, "market")
    ),
  ];
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = [
      row.platform,
      row.code,
      row.scope,
      row.market,
      row.brandId ?? "",
      row.eventId ?? "",
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
