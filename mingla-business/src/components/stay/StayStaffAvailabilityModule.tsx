import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import {
  radius,
  color,
  space,
  type,
} from "../../constants/designSystem";
import { useStaffStayDetail } from "../../hooks/useStaffStayDetail";
import { Button } from "../ui/Button";

export function StayStaffAvailabilityModule({
  venueId,
}: {
  venueId: string;
}): React.ReactElement {
  const query = useStaffStayDetail(venueId);
  if (query.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color.accent} />
        <Text style={styles.helper}>Loading live Stay availability…</Text>
      </View>
    );
  }
  if (query.isError || query.data === null || query.data === undefined) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Availability could not load</Text>
        <Text style={styles.helper}>Nothing was changed. Try again.</Text>
        <Button label="Try again" onPress={() => void query.refetch()} variant="secondary" size="md" />
      </View>
    );
  }
  const detail = query.data;
  return (
    <View style={styles.page} testID="stay-staff-availability">
      <Text style={styles.title}>Availability</Text>
      <Text style={styles.helper}>
        Live Rooms and Places available to book. Pricing and inventory editing
        stay with property administrators.
      </Text>
      {detail.offerings.map((offering) => (
        <View key={offering.id} style={styles.card}>
          <View style={styles.row}>
            <View style={styles.flexOne}>
              <Text style={styles.offeringName}>{offering.name}</Text>
              <Text style={styles.meta}>
                {offering.kind === "room" ? "Room" : "Place"} · Up to {offering.maxGuests} guests
              </Text>
            </View>
            <Text style={styles.badge}>Bookable</Text>
          </View>
          {offering.kind === "room" ? (
            <Text style={styles.meta}>
              {offering.quantity ?? 0} room{offering.quantity === 1 ? "" : "s"} · booking horizon {offering.maxAdvanceDays ?? detail.bookingHorizonDays} days
            </Text>
          ) : (
            <Text style={styles.meta}>
              {offering.placeWindows.length} upcoming window{offering.placeWindows.length === 1 ? "" : "s"}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: space[6], gap: space[2] },
  center: { padding: space[7], alignItems: "center", gap: space[2] },
  title: { ...type.h1, color: color.text1 },
  helper: { ...type.small, color: color.text2, lineHeight: 20 },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: color.line, backgroundColor: color.fill.inset, padding: space[4], gap: space[1] },
  row: { flexDirection: "row", alignItems: "flex-start", gap: space[2] },
  flexOne: { flex: 1, minWidth: 0 },
  offeringName: { fontSize: 15, color: color.text1, fontWeight: "700" },
  meta: { fontSize: 12, color: color.text2, lineHeight: 18 },
  badge: { fontSize: 11, fontWeight: "700", color: color.accent },
});
