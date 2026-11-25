/**
 * VenueListCard (META-ORCH-1255, DESIGN §4.2) — one venue row in the Hub
 * venue card list. Modeled 1:1 on `EventListCard` anatomy: 76×92 cover
 * (hue fallback — never a grey box, never a stock photo), chip-first status
 * (the status IS the operator's question), name, address line, ONE honest
 * data slot, trailing chevron tap affordance.
 *
 * Data-slot precedence (first match wins; none → row HIDDEN — Constitution #9
 * no fabricated data):
 *   1. open admin-feedback count > 0 → "{n} to fix" (warning, w600)
 *   2. #4490: switched-on features   → "Entry · Menu · Events here"
 *   3. menu item count > 0          → "{n} menu items"
 *   4. reservations enabled (features unread) → "Reservations on"
 *
 * The whole card is ONE Pressable (no dead taps; manage actions live inside
 * the venue page — one card, one action). Android glass = the exact
 * META-ORCH-1002 opaque frosted fallback.
 *
 * #4490 P2 (hub, click-test E2) — feature-driven: the data slot names the
 * venue's switched-on features ("Entry · Menu · Events here") instead of the
 * old "Reservations on"; a venue that sells shows its day (In now, To arrive,
 * Paying now) and the two things a host opens most, Check-in and Public page,
 * as their own buttons BELOW the card's pressable (never nested in it).
 */

import React, { useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";

import {
  radius as radiusTokens,
  color,
  space,
  materials,
} from "../../constants/designSystem";
import type { VenueListing } from "../../services/venueListingsService";
import { useVenueDay } from "../../hooks/useVenueDay";
import { useVenueFeatures } from "../../hooks/useVenueFeatures";
import { VENUE_FEATURE_KEYS, featureLine } from "../../types/venueFeatures";
import { Button } from "../ui/Button";
import { StatRow } from "../ui/StatRow";
import { Skeleton } from "../ui/Skeleton";
import { dayNumbers } from "./features/today/todayModel";
import type { ListingStatusView } from "../../utils/listingStatus";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { Icon } from "../ui/Icon";
import { ListingStatusChip } from "./ListingStatusChip";

const COVER_W = 76;
const COVER_H = 92;

/** Deterministic no-media hue (the established app-wide treatment). */
const hashHueFromString = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % 360;
};

export interface VenueListCardProps {
  venue: VenueListing;
  status: Pick<ListingStatusView, "label" | "tone">;
  /** Open admin-feedback count for THIS venue (0 = none). */
  openFixCount: number;
  /** Brand-level menu item count ([TRANSITIONAL-3] menus are brand-level). */
  menuItemCount: number;
  /** THIS venue's reservations toggle (used only while its features are unread). */
  reservationsEnabled: boolean;
  onOpen: () => void;
  /** #4490 — open this venue's Check-in (shown when the venue sells). */
  onCheckIn?: () => void;
  /** #4490 — open the public page (verified venues only; omit to hide). */
  onPublicPage?: () => void;
  testID?: string;
}

export function VenueListCard({
  venue,
  status,
  openFixCount,
  menuItemCount,
  reservationsEnabled,
  onOpen,
  onCheckIn,
  onPublicPage,
  testID,
}: VenueListCardProps): React.ReactElement {
  const featuresQuery = useVenueFeatures(venue.brandId, venue.id);
  const features = featuresQuery.data?.features ?? null;
  const sells = features?.entry.enabled === true;
  const dayQuery = useVenueDay(venue.brandId, venue.id, null, { enabled: sells });
  const enabledKeys = useMemo(
    () => new Set(features === null ? [] : VENUE_FEATURE_KEYS.filter((k) => features[k].enabled)),
    [features],
  );
  // Web focus ring (keyboard :focus-visible semantics via RNW focus events).
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);

  const addressLine = venue.address ?? venue.city;

  const dataSlot = useMemo<{ label: string; warning: boolean } | null>(() => {
    if (openFixCount > 0) {
      return {
        label: openFixCount === 1 ? "1 to fix" : `${openFixCount} to fix`,
        warning: true,
      };
    }
    // #1532 §5 (audit item O9) — a Stay's brand-level menu is not reachable by
    // a guest: `PublicVenuePage.tsx:179` hard-codes `hasMenu = !isStay`. So
    // "12 menu items" on a hotel row is a count of something nobody can see,
    // and it reinforced the same false promise the Menus module used to make.
    // Suppressing it here falls through to the honest reservations slot.
    // Re-enable for Stays when #1536 ships a Stay menu that actually renders.
    // #4490 E2 — the features the venue has on come before the menu count.
    const features0 = featureLine(enabledKeys);
    if (features0 !== null) return { label: features0, warning: false };
    if (menuItemCount > 0 && venue.venueCategory !== "stay") {
      return {
        label:
          menuItemCount === 1 ? "1 menu item" : `${menuItemCount} menu items`,
        warning: false,
      };
    }
    if (features === null && reservationsEnabled) {
      return { label: "Reservations on", warning: false };
    }
    return null;
  }, [enabledKeys, features, openFixCount, menuItemCount, reservationsEnabled, venue.venueCategory]);
  const day = dayQuery.data;
  const numbers = day !== undefined ? dayNumbers(day) : null;
  const showActions = (sells && onCheckIn !== undefined) || onPublicPage !== undefined;

  return (
    <View style={styles.outer}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${venue.name}, status: ${status.label}`}
      onPress={onOpen}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        styles.host,
        hovered ? styles.hostHovered : null,
        focused ? styles.hostFocused : null,
        Platform.select({
          web: { cursor: "pointer" } as unknown as ViewStyle,
          default: undefined,
        }),
      ]}
      testID={testID}
    >
      {({ pressed }) => (
        <View style={[styles.cardBody, pressed ? styles.cardBodyPressed : null]}>
          <View style={styles.coverWrap}>
            <EventCoverMedia
              hue={hashHueFromString(venue.name)}
              mediaUrl={venue.coverMediaUrl}
              mediaType={venue.coverMediaType}
              radius={radiusTokens.md}
              label={`${venue.name} cover`}
              height={COVER_H}
              width={COVER_W}
              muted
            />
          </View>
          <View style={styles.bodyCol}>
            <View style={styles.chipRow}>
              <ListingStatusChip status={status} />
            </View>
            <Text style={styles.title} numberOfLines={1}>
              {venue.name}
            </Text>
            {addressLine !== null && addressLine.length > 0 ? (
              <Text style={styles.addressLine} numberOfLines={1}>
                {addressLine}
              </Text>
            ) : null}
            {dataSlot !== null ? (
              <Text
                style={[styles.dataSlot, dataSlot.warning ? styles.dataSlotWarning : null]}
                numberOfLines={1}
              >
                {dataSlot.label}
              </Text>
            ) : null}
          </View>
          <View style={styles.tapAffordance}>
            <Icon name="chevR" size={18} color={color.text3} />
          </View>
        </View>
      )}
    </Pressable>
    {sells ? (
      dayQuery.isLoading ? (
        <Skeleton height={56} radius="md" />
      ) : numbers !== null ? (
        <StatRow
          items={[
            { key: "in", label: "In now", value: String(numbers.inNow) },
            { key: "arrive", label: "To arrive", value: String(numbers.toArrive) },
            { key: "paying", label: "Paying now", value: String(numbers.waiting) },
          ]}
          style={styles.stats}
          testID={testID !== undefined ? `${testID}-stats` : undefined}
        />
      ) : null
    ) : null}
    {showActions ? (
      <View style={styles.actions}>
        {sells && onCheckIn !== undefined ? (
          <View style={styles.action}>
            <Button
              label="Check-in"
              variant="secondary"
              size="sm"
              leadingIcon="scan"
              fullWidth
              onPress={onCheckIn}
              accessibilityLabel={`Check-in at ${venue.name}`}
              testID={testID !== undefined ? `${testID}-checkin` : undefined}
            />
          </View>
        ) : null}
        {onPublicPage !== undefined ? (
          <View style={styles.action}>
            <Button
              label="Public page"
              variant="secondary"
              size="sm"
              leadingIcon="eye"
              fullWidth
              onPress={onPublicPage}
              accessibilityLabel={`Public page of ${venue.name}`}
              testID={testID !== undefined ? `${testID}-public` : undefined}
            />
          </View>
        ) : null}
      </View>
    ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { gap: space[2] },
  stats: {
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: color.line,
  },
  actions: { flexDirection: "row", gap: space[2] },
  action: { flex: 1 },
  host: {
    position: "relative",
    // META-ORCH-1002 opaque frosted Android fallback; translucent glass on iOS.
    backgroundColor: Platform.select({
      ios: color.fill.inset,
      android: materials.pane.solidFill,
      default: color.fill.inset,
    }),
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: color.line,
    overflow: "hidden",
  },
  hostHovered: {
    backgroundColor: Platform.select({
      ios: color.fill.tile,
      android: materials.pane.solidFill,
      default: color.fill.tile,
    }),
  },
  hostFocused: {
    borderColor: color.accentLine,
  },
  cardBody: {
    flexDirection: "row",
    gap: space[2],
    padding: space[2],
    alignItems: "stretch",
  },
  cardBodyPressed: {
    opacity: 0.85,
  },
  coverWrap: {
    width: COVER_W,
    height: COVER_H,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    flexShrink: 0,
  },
  bodyCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: "space-between",
  },
  chipRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  // Token-for-token the EventListCard `title` treatment.
  title: {
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2,
    color: color.text1,
    marginBottom: 2,
  },
  addressLine: {
    fontSize: 13,
    lineHeight: 18,
    color: color.text2,
  },
  dataSlot: {
    fontSize: 12,
    lineHeight: 16,
    color: color.text3,
  },
  dataSlotWarning: {
    color: color.warning,
    fontWeight: "600",
  },
  tapAffordance: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default VenueListCard;
