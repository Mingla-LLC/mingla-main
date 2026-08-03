/**
 * VenueIdentityBand (#1483) — band 2 of the per-venue management page header.
 *
 * The venue page used to hand-roll a single naked row (back glyph + truncated
 * name + status chip) and was the ONLY detail page in the business app not
 * using the shared `TopBar`. #1483 splits that into two bands, mirroring
 * `app/event/[id]/index.tsx`: band 1 is the canonical `TopBar` (section title
 * + page actions in `rightSlot`), band 2 is THIS identity band — cover, venue
 * name at display size (2 lines, no longer clipped to one), the category+city
 * secondary line, and the unchanged `ListingStatusChip`.
 *
 * The cover hue uses the SAME `hashHueFromString(venue.name)` treatment as
 * `VenueListCard` so a venue with no cover media shows the identical colour on
 * the Hub card and on its page. The helper is a private const duplicated per
 * file — the established convention in this codebase (VenueListCard.tsx:41),
 * deliberately not extracted.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { VenueListing } from "../../services/venueListingsService";
import type { VenueCategory } from "../../types/brand";
import type { ListingStatusView } from "../../utils/listingStatus";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { ListingStatusChip } from "./ListingStatusChip";

const COVER_SIZE = 52;

/** Deterministic no-media hue (the established app-wide treatment). */
const hashHueFromString = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % 360;
};

/**
 * Operator-facing category labels — verbatim from the authoring picker
 * (`src/components/brand/VenueCategoryPicker.tsx:23-35`) so the page names the
 * category exactly the way the operator chose it. Exhaustive by type: adding a
 * `VenueCategory` member fails the build here until it is labelled.
 */
const CATEGORY_LABEL: Record<VenueCategory, string> = {
  restaurant: "Restaurant",
  play: "Play",
  creative_and_arts: "Creative & arts",
  stay: "Stay",
};

export interface VenueIdentityBandProps {
  venue: VenueListing;
  status: Pick<ListingStatusView, "label" | "tone">;
  testID?: string;
}

export function VenueIdentityBand({
  venue,
  status,
  testID,
}: VenueIdentityBandProps): React.ReactElement {
  const categoryLabel = CATEGORY_LABEL[venue.venueCategory];
  const city = venue.city;
  // Constitution #9 — no fabricated data: a venue with no city shows the
  // category alone, never a placeholder location.
  const secondaryLine =
    city !== null && city.length > 0
      ? `${categoryLabel} · ${city}`
      : categoryLabel;

  return (
    <View style={styles.host} testID={testID}>
      <View style={styles.coverWrap}>
        <EventCoverMedia
          hue={hashHueFromString(venue.name)}
          mediaUrl={venue.coverMediaUrl}
          mediaType={venue.coverMediaType}
          radius={radiusTokens.md}
          label={`${venue.name} cover`}
          width={COVER_SIZE}
          height={COVER_SIZE}
          muted
        />
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={2}>
          {venue.name}
        </Text>
        <Text style={styles.secondary} numberOfLines={1}>
          {secondaryLine}
        </Text>
      </View>
      <View style={styles.chipWrap}>
        <ListingStatusChip status={status} testID="venue-page-status-chip" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm + spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
  },
  coverWrap: {
    width: COVER_SIZE,
    height: COVER_SIZE,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    flexShrink: 0,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  secondary: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    letterSpacing: typography.caption.letterSpacing,
    color: textTokens.tertiary,
  },
  chipWrap: {
    flexShrink: 0,
  },
});

export default VenueIdentityBand;
