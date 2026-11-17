import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import {
  color,
  space,
} from "../../constants/designSystem";
import type { PublicUpcomingRow } from "../../services/publicEventsService";
import { formatCurrencyRound } from "../../utils/currency";

interface NextEventTeaserProps {
  item: PublicUpcomingRow;
  onPress: (item: PublicUpcomingRow) => void;
  label?: string;
}

const TYPE_LABEL: Record<PublicUpcomingRow["offeringType"], string> = {
  event: "Event",
  rsvp: "RSVP",
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
    marginTop: space[2],
    marginBottom: space[4],
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    borderRadius: 999,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    backgroundColor: color.fill.tabOn,
    borderWidth: 1,
    borderColor: color.lineStrong,
  },
  nextTeaserPressed: {
    opacity: 0.82,
  },
  nextTeaserLabel: {
    color: color.text1,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0,
  },
  nextTeaserBody: {
    flex: 1,
    minWidth: 0,
    color: color.text1,
    fontSize: 13,
    fontWeight: "700",
  },
  nextTeaserArrow: {
    color: color.text2,
    fontSize: 18,
    fontWeight: "800",
  },
});

export default NextEventTeaser;
