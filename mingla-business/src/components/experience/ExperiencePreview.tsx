/**
 * ExperiencePreview — buyer-eye preview of a published experience.
 * META-ORCH-1059 Sub-C. Mirrors TripPreview (cover hero + title + by-brand +
 * the date-model block + description + STOPS itinerary + "From {price}").
 *
 * Used by the public buyer-anon route /exp/{brandSlug}/{experienceSlug}.
 * Anon-tolerant: no useAuth — the caller passes the resolved payload from
 * usePublicExperienceBySlug.
 *
 * The date-model block is the one genuinely-new buyer presentation: it renders
 * one-time / recurring / multi-date via the SINGLE owner
 * `formatExperienceDateSubline` (the same helper the operator dashboard +
 * hub rows use), so all surfaces describe the date model identically.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { formatExperienceDateSubline } from "../../utils/experienceDateSubline";
import type {
  PublicExperience,
  PublicExperienceBrand,
} from "../../services/publicExperienceService";

export interface ExperiencePreviewProps {
  experience: PublicExperience;
  brand: PublicExperienceBrand;
  /** Body padding override for framed parents (e.g. wizard). */
  contentPadding?: number;
  testID?: string;
}

function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

function formatFromPrice(
  experience: PublicExperience,
): string {
  const t = experience.ticket;
  if (t === null) return "Pricing TBD";
  if (t.isFree || t.priceCents === 0) return "Free";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: t.currency || "USD",
    }).format(t.priceCents / 100);
  } catch {
    return `${(t.priceCents / 100).toFixed(2)} ${t.currency}`;
  }
}

function formatStopTime(iso: string | null): string {
  if (iso === null) return "";
  // start_time is stored as a clock string ("HH:mm[:ss]") or an ISO instant.
  if (/^\d{2}:\d{2}/.test(iso)) {
    const [hh, mm] = iso.split(":");
    const h = Number(hh);
    if (!Number.isFinite(h)) return "";
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${mm} ${ampm}`;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .toUpperCase();
}

export const ExperiencePreview: React.FC<ExperiencePreviewProps> = ({
  experience,
  brand,
  contentPadding = spacing.lg,
  testID,
}) => {
  const dateSubline = formatExperienceDateSubline({
    venueText: experience.venueText,
    dateStartIsos: experience.dates.map((d) => d.startAt),
    whenMode: experience.whenMode,
    recurrenceRule: experience.recurrenceRule,
  });

  const fromLabel = formatFromPrice(experience);
  const isFree = experience.ticket?.isFree === true ||
    (experience.ticket?.priceCents ?? 1) === 0;

  return (
    <View style={styles.host} testID={testID}>
      {/* Full-bleed cover hero (image / GIF / video via the shared media). */}
      <EventCoverMedia
        hue={hueFromId(experience.id)}
        mediaUrl={experience.coverMediaUrl}
        mediaType={experience.coverMediaType}
        radius={0}
        label=""
        height={240}
      />

      <View style={[styles.body, { padding: contentPadding }]}>
        <Text style={styles.title}>{experience.title}</Text>
        <Text style={styles.brandByline}>by {brand.name}</Text>

        {/* Date-model block — one-time / recurring / multi-date. */}
        <View style={styles.whenCard}>
          <Icon name="calendar" size={16} color={accent.warm} />
          <Text style={styles.whenText} numberOfLines={2}>
            {dateSubline}
          </Text>
        </View>

        {/* Description / narrative. */}
        {experience.description !== null &&
        experience.description.trim().length > 0 ? (
          <Text style={styles.description}>{experience.description}</Text>
        ) : null}

        {/* STOPS itinerary. */}
        {experience.stops.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>The itinerary</Text>
            <View style={styles.stopsList}>
              {experience.stops.map((stop) => {
                const t = formatStopTime(stop.startTime);
                return (
                  <View key={stop.id} style={styles.stopCard}>
                    <Text style={styles.stopOrder}>
                      STOP {stop.stopOrder + 1}
                    </Text>
                    <Text style={styles.stopName}>{stop.placeName}</Text>
                    {stop.address.trim().length > 0 ? (
                      <Text style={styles.stopAddress} numberOfLines={2}>
                        {stop.address}
                      </Text>
                    ) : null}
                    {t.length > 0 ? (
                      <Text style={styles.stopTime}>{t}</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* "From {price}". */}
        <View style={styles.pricingCard}>
          <Text style={styles.pricingLabel}>
            {isFree ? "Price" : "From"}
          </Text>
          <Text style={styles.pricingPrice}>{fromLabel}</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    backgroundColor: "transparent",
  },
  body: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    fontSize: typography.h1.fontSize,
    lineHeight: typography.h1.lineHeight,
    fontWeight: typography.h1.fontWeight,
    color: textTokens.primary,
  },
  brandByline: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  whenCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
  },
  whenText: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
    flex: 1,
  },
  description: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    marginTop: spacing.md,
  },
  section: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  sectionLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: textTokens.secondary,
    textTransform: "uppercase",
  },
  stopsList: {
    gap: spacing.sm,
  },
  stopCard: {
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
    gap: spacing.xs,
  },
  stopOrder: {
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: accent.warm,
  },
  stopName: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  stopAddress: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  stopTime: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  pricingCard: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radiusTokens.lg,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  pricingLabel: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  pricingPrice: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: "700",
    color: textTokens.primary,
  },
});

export default ExperiencePreview;
