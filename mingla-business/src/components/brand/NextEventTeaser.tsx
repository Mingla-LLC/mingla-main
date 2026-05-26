import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { accent, spacing, text as textTokens } from "../../constants/designSystem";
import type { PublicUpcomingRow } from "../../services/publicEventsService";
import { formatCurrencyRound } from "../../utils/currency";

interface NextEventTeaserProps {
  item: PublicUpcomingRow;
  onPress: (item: PublicUpcomingRow) => void;
  label?: string;
}

const TYPE_LABEL: Record<PublicUpcomingRow["offeringType"], string> = {
  event: "Event",
  trip: "Trip",
  experience: "Experience",
};

export const NextEventTeaser: React.FC<NextEventTeaserProps> = ({
  item,
  onPress,
  label = "NEXT",
}) => {
  const when = formatStartsAt(item.startsAt);
  const price =
    item.isFree || item.priceFromMinorUnits === null
      ? "Free"
      : `From ${formatCurrencyRound(item.priceFromMinorUnits / 100, item.currency)}`;
  const bodyText = `${TYPE_LABEL[item.offeringType]} · ${when} · ${item.name} · ${price}`;

  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={`Next ${TYPE_LABEL[item.offeringType].toLowerCase()} ${item.name}`}
      style={({ pressed }) => [
        styles.nextTeaser,
        pressed && styles.nextTeaserPressed,
      ]}
    >
      <Text style={styles.nextTeaserLabel}>{label}</Text>
      <Text style={styles.nextTeaserBody} numberOfLines={1}>
        {bodyText}
      </Text>
      <Text style={styles.nextTeaserArrow}>→</Text>
    </Pressable>
  );
};

const formatStartsAt = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Soon";
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
};

const styles = StyleSheet.create({
  nextTeaser: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  nextTeaserPressed: {
    opacity: 0.82,
  },
  nextTeaserLabel: {
    color: accent.warm,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0,
  },
  nextTeaserBody: {
    flex: 1,
    minWidth: 0,
    color: textTokens.primary,
    fontSize: 13,
    fontWeight: "700",
  },
  nextTeaserArrow: {
    color: textTokens.secondary,
    fontSize: 18,
    fontWeight: "800",
  },
});

export default NextEventTeaser;
