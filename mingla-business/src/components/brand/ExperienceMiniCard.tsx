import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { accent, spacing, text as textTokens } from "../../constants/designSystem";
import type { PublicExperienceCard } from "../../services/publicEventsService";
import { formatCurrencyRound } from "../../utils/currency";
import { EventCoverMedia } from "../ui/EventCoverMedia";

interface ExperienceMiniCardProps {
  experience: PublicExperienceCard;
  showTypePill?: boolean;
  testID?: string;
}

export const ExperienceMiniCard: React.FC<ExperienceMiniCardProps> = ({
  experience,
  showTypePill = false,
  testID,
}) => {
  const router = useRouter();
  const fallbackHue = useMemo(
    () => hashHueFromString(experience.experienceId),
    [experience.experienceId],
  );
  const nextLine = formatNextOccurrence(experience.nextOccurrenceAt);
  const subline = [
    experience.venueText,
    nextLine !== null ? `Next: ${nextLine}` : null,
  ]
    .filter((item): item is string => item !== null && item.length > 0)
    .join(" · ");
  const priceLabel =
    experience.isFree || experience.priceFromMinorUnits === null
      ? "Free"
      : `From ${formatCurrencyRound(
          experience.priceFromMinorUnits / 100,
          experience.currency,
        )}`;

  return (
    <Pressable
      testID={testID}
      onPress={() =>
        router.push(
          `/exp/${experience.brandSlug}/${experience.experienceSlug}` as never,
        )
      }
      accessibilityRole="button"
      accessibilityLabel={`Open experience ${experience.name}`}
      style={({ pressed }) => [
        styles.card,
        pressed && styles.cardPressed,
      ]}
    >
      <EventCoverMedia
        hue={fallbackHue}
        mediaUrl={experience.coverMediaUrl}
        mediaType="image"
        radius={12}
        label=""
        style={styles.cover}
      />
      <View style={styles.body}>
        <View style={styles.topRow}>
          {showTypePill ? (
            <View style={styles.typePill}>
              <Text style={styles.typePillText}>Experience</Text>
            </View>
          ) : null}
          <View style={styles.pricePill}>
            <Text style={styles.pricePillText}>{priceLabel}</Text>
          </View>
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {experience.name.length > 0 ? experience.name : "Untitled experience"}
        </Text>
        {subline.length > 0 ? (
          <Text style={styles.subline} numberOfLines={1}>
            {subline}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
};

const hashHueFromString = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % 360;
};

// ORCH-1162 Bug 1 (A.3 hygiene) — this component has ZERO importers (the live
// brand-page mini card is an inline component in
// packages/brand-rendering/PublicBrandPage.tsx). Fixed for parity so the en-GB
// 24h formatter does not linger as a latent bug — switched to en-US + hour12 so
// it emits a meridiem ("Wed, 7:00 PM") consistent with the repo's 12h discipline.
const formatNextOccurrence = (iso: string | null): string | null => {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  cardPressed: {
    opacity: 0.82,
  },
  cover: {
    width: 92,
    aspectRatio: 16 / 9,
  },
  body: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
    gap: 6,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  typePill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  typePillText: {
    color: textTokens.secondary,
    fontSize: 11,
    fontWeight: "800",
  },
  pricePill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: "rgba(255,159,64,0.18)",
  },
  pricePillText: {
    color: accent.warm,
    fontSize: 11,
    fontWeight: "900",
  },
  title: {
    color: textTokens.primary,
    fontSize: 16,
    fontWeight: "800",
  },
  subline: {
    color: textTokens.secondary,
    fontSize: 13,
  },
});

export default ExperienceMiniCard;
