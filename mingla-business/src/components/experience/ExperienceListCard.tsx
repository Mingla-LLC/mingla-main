/**
 * ExperienceListCard — row in the founder Hub "Your experiences" list.
 *
 * META-ORCH-1059 (Hub list polish). Operator: an experience renders fine on the
 * Home "Upcoming" card but the Hub experiences LIST looked like a bare
 * title/description block. This card mirrors the polished EventListCard /
 * trip-row pattern so events, trips, and experiences all read as the same kind
 * of offering row:
 *
 *   [cover thumb 76×92 + DRAFT overlay] · [status pill + title + date·venue
 *   subline + price] · [chevron tap-affordance]
 *
 * Tapping the card opens the experience DASHBOARD (`/experience/{id}`) via the
 * caller's `onOpen` — never the edit screen directly (routeForEventRow owns the
 * decision; the dashboard surfaces "Continue editing" for drafts).
 *
 * Cover falls back to a deterministic hue gradient (hue from id) when no cover
 * media is set, exactly like EventCoverMedia in the events list.
 */

import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import {
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import type { VenueExperience } from "../../services/experiencesService";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { Icon } from "../ui/Icon";
import { Pill, type PillVariant } from "../ui/Pill";

const COVER_W = 76;
const COVER_H = 92;

export interface ExperienceListCardProps {
  experience: VenueExperience;
  /** Tap card → open the experience dashboard. */
  onOpen: () => void;
}

function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

type StatusChip = { label: string; variant: PillVariant } | { label: string; past: true };

function statusChip(status: string): StatusChip {
  switch (status) {
    case "live":
      return { label: "LIVE", variant: "live" };
    case "scheduled":
      return { label: "UPCOMING", variant: "accent" };
    case "cancelled":
      return { label: "CANCELLED", variant: "error" };
    case "ended":
      return { label: "ENDED", past: true };
    case "draft":
    default:
      return { label: "DRAFT", variant: "draft" };
  }
}

export const ExperienceListCard: React.FC<ExperienceListCardProps> = ({
  experience,
  onOpen,
}) => {
  const title =
    experience.title.trim().length > 0 ? experience.title : "Untitled experience";
  const isDraft = experience.status === "draft";
  const chip = statusChip(experience.status);
  const isFaded = experience.status === "ended" || experience.status === "cancelled";

  return (
    <View style={[styles.host, isFaded && styles.hostFaded]}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open experience ${title}`}
        style={({ pressed }) => [styles.cardBody, pressed && styles.cardBodyPressed]}
      >
        {/* Cover */}
        <View style={styles.coverWrap}>
          <EventCoverMedia
            hue={hueFromId(experience.id)}
            mediaUrl={experience.coverMediaUrl}
            mediaType={experience.coverMediaType}
            radius={12}
            label=""
            height={COVER_H}
            width={COVER_W}
          />
          {isDraft ? (
            <View style={styles.draftOverlay}>
              <Text style={styles.draftOverlayText}>DRAFT</Text>
            </View>
          ) : null}
        </View>

        {/* Body */}
        <View style={styles.bodyCol}>
          <View style={styles.pillRow}>
            {"past" in chip ? (
              <View style={styles.pastPill}>
                <Text style={styles.pastPillText}>{chip.label}</Text>
              </View>
            ) : (
              <Pill variant={chip.variant} livePulse={chip.variant === "live"}>
                <Text style={styles.pillText}>{chip.label}</Text>
              </Pill>
            )}
          </View>

          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>

          <Text style={styles.dateVenue} numberOfLines={1}>
            {experience.dateSubline}
          </Text>

          {experience.priceLabel !== null ? (
            <Text style={styles.price} numberOfLines={1}>
              {experience.priceLabel}
            </Text>
          ) : null}
        </View>

        {/* Tap affordance */}
        <View style={styles.tapAffordance} pointerEvents="none">
          <Icon name="chevR" size={18} color={textTokens.tertiary} />
        </View>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    position: "relative",
    // META-ORCH-1002: opaque frosted fill on Android (translucent fills leak the
    // corner ring); kit-consistent rgba(20,22,26,0.92). iOS keeps profileBase.
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
  hostFaded: { opacity: 0.7 },
  cardBody: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
    alignItems: "stretch",
  },
  cardBodyPressed: { opacity: 0.85 },
  coverWrap: {
    width: COVER_W,
    height: COVER_H,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    flexShrink: 0,
  },
  draftOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(12, 14, 18, 0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  draftOverlayText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: "rgba(255, 255, 255, 0.7)",
  },
  bodyCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
    gap: 2,
  },
  tapAffordance: {
    width: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  pillRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  pillText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: textTokens.primary,
  },
  pastPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radiusTokens.full,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  pastPillText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: textTokens.tertiary,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2,
    color: textTokens.primary,
    marginBottom: 2,
  },
  dateVenue: {
    fontSize: 11,
    color: textTokens.tertiary,
  },
  price: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: "700",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
  },
});

export default ExperienceListCard;
