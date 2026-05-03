/**
 * /e/{brandSlug}/{eventSlug} — public event page route.
 *
 * Resolves a LiveEvent by URL (brand-scoped slug). Renders PublicEventPage
 * with state-variant branched rendering.
 *
 * Per Cycle 6 spec §3.2.1.
 */

import React from "react";
import { useLocalSearchParams } from "expo-router";

import { useLiveEventBySlug } from "../../../src/store/liveEventStore";
import { useBrandList } from "../../../src/store/currentBrandStore";
import { PublicEventPage } from "../../../src/components/event/PublicEventPage";
import { PublicEventNotFound } from "../../../src/components/event/PublicEventNotFound";

export default function PublicEventRoute(): React.ReactElement {
  const params = useLocalSearchParams<{
    brandSlug: string | string[];
    eventSlug: string | string[];
  }>();
  const brandSlug = Array.isArray(params.brandSlug)
    ? params.brandSlug[0]
    : params.brandSlug;
  const eventSlug = Array.isArray(params.eventSlug)
    ? params.eventSlug[0]
    : params.eventSlug;

  const event = useLiveEventBySlug(
    typeof brandSlug === "string" ? brandSlug : null,
    typeof eventSlug === "string" ? eventSlug : null,
  );
  const brands = useBrandList();
  const brand =
    event !== null
      ? (brands.find((b) => b.id === event.brandId) ?? null)
      : null;

  if (event === null) {
    return <PublicEventNotFound />;
  }

  return <PublicEventPage event={event} brand={brand} />;
}
