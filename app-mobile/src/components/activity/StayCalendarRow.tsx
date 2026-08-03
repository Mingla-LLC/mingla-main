import React from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  formatStayMoney,
  type MyStayReservationGroup,
} from "@mingla/brand-rendering/stayGuest";
import { Icon } from "../ui/Icon";

const STATE_LABELS: Record<MyStayReservationGroup["state"], string> = {
  instant_payment_pending: "Payment required",
  request_pending: "Request pending",
  declined: "Declined",
  request_expired: "Request expired",
  approved_payment_required: "Approved · Pay now",
  finalizing: "Confirming",
  confirmed: "Confirmed",
  partially_cancelled: "Partially cancelled",
  cancelled: "Cancelled",
  reconciliation_required: "Needs attention",
};

function firstStayDate(group: MyStayReservationGroup): string | null {
  const dates = group.lines.flatMap((line) =>
    [line.roomCheckIn, line.placeStartsAt].filter(
      (value): value is string => typeof value === "string",
    )
  );
  dates.sort((a, b) => Date.parse(a) - Date.parse(b));
  return dates[0] ?? null;
}

function formatStayStart(value: string): string {
  const hasTime = value.includes("T");
  const date = new Date(hasTime ? value : `${value}T12:00:00`);
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: hasTime ? "numeric" : undefined,
    minute: hasTime ? "2-digit" : undefined,
  });
}

export default function StayCalendarRow({
  group,
  animation,
}: {
  group: MyStayReservationGroup;
  animation?: { opacity: Animated.Value; slide: Animated.Value };
}): React.ReactElement {
  const router = useRouter();
  const startsAt = firstStayDate(group);
  const roomCount = group.lines
    .filter((line) => line.kind === "room")
    .reduce((sum, line) => sum + (line.roomQuantity ?? 1), 0);
  const placeCount = group.lines.filter((line) => line.kind === "place").length;
  const detail = [
    roomCount > 0 ? `${roomCount} Room${roomCount === 1 ? "" : "s"}` : null,
    placeCount > 0 ? `${placeCount} Place${placeCount === 1 ? "" : "s"}` : null,
  ].filter((value): value is string => value !== null).join(" · ");

  const content = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open Stay reservation at ${group.venueName}`}
      onPress={() => router.push(`/stay/${group.groupId}` as never)}
      style={styles.card}
    >
      <View style={styles.icon}>
        <Icon name="key" size={24} color="#ffffff" />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {group.venueName}
        </Text>
        <Text style={styles.brand} numberOfLines={1}>
          {group.brandName}
        </Text>
        <Text style={styles.meta} numberOfLines={2}>
          {startsAt
            ? formatStayStart(startsAt)
            : "Date pending"}
          {detail ? ` · ${detail}` : ""}
        </Text>
        <View style={styles.chips}>
          <Text style={styles.status}>{STATE_LABELS[group.state]}</Text>
          <Text style={styles.price}>
            {formatStayMoney(group.totalMinor, group.currencyCode)}
          </Text>
        </View>
      </View>
      <Icon name="chevron-forward" size={20} color="#9ca3af" />
    </Pressable>
  );

  return animation ? (
    <Animated.View
      style={{
        opacity: animation.opacity,
        transform: [{ translateY: animation.slide }],
      }}
    >
      {content}
    </Animated.View>
  ) : content;
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 14,
    marginHorizontal: 16,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: "#f3f4f6",
  },
  icon: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eb7825",
  },
  body: { flex: 1, gap: 3 },
  title: { fontSize: 15, fontWeight: "800", color: "#111827" },
  brand: { fontSize: 12, color: "#6b7280" },
  meta: { fontSize: 13, lineHeight: 18, color: "#4b5563" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 2 },
  status: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9a3412",
    backgroundColor: "#ffedd5",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: "hidden",
  },
  price: {
    fontSize: 11,
    fontWeight: "700",
    color: "#374151",
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: "hidden",
  },
});
