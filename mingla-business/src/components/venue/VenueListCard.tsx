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
 *   2. menu item count > 0          → "{n} menu items"
 *   3. reservations enabled          → "Reservations on"
 *
 * The whole card is ONE Pressable (no dead taps; manage actions live inside
 * the venue page — one card, one action). Android glass = the exact
 * META-ORCH-1002 opaque frosted fallback.
 */

import React, { useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import type { VenueListing } from "../../services/venueListingsService";
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
  /** THIS venue's reservations toggle. */
  reservationsEnabled: boolean;
  onOpen: () => void;
  testID?: string;
}

export function VenueListCard({
  venue,
  status,
  openFixCount,
  menuItemCount,
  reservationsEnabled,
  onOpen,
  testID,
}: VenueListCardProps): React.ReactElement {
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
    if (menuItemCount > 0) {
      return {
        label:
          menuItemCount === 1 ? "1 menu item" : `${menuItemCount} menu items`,
        warning: false,
      };
    }
    if (reservationsEnabled) {
      return { label: "Reservations on", warning: false };
    }
    return null;
  }, [openFixCount, menuItemCount, reservationsEnabled]);

  return (
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
            <Icon name="chevR" size={18} color={textTokens.tertiary} />
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "relative",
    // META-ORCH-1002 opaque frosted Android fallback; translucent glass on iOS.
    backgroundColor: Platform.select({
      ios: glass.tint.profileBase,
      android: "rgba(20, 22, 26, 0.92)",
      default: glass.tint.profileBase,
    }),
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    overflow: "hidden",
  },
  hostHovered: {
    backgroundColor: Platform.select({
      ios: glass.tint.profileElevated,
      android: "rgba(20, 22, 26, 0.92)",
      default: glass.tint.profileElevated,
    }),
  },
  hostFocused: {
    borderColor: accent.border,
  },
  cardBody: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
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
    color: textTokens.primary,
    marginBottom: 2,
  },
  addressLine: {
    fontSize: 13,
    lineHeight: 18,
    color: textTokens.secondary,
  },
  dataSlot: {
    fontSize: 12,
    lineHeight: 16,
    color: textTokens.tertiary,
  },
  dataSlotWarning: {
    color: semantic.warning,
    fontWeight: "600",
  },
  tapAffordance: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default VenueListCard;
