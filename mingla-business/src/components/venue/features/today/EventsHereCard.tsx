/**
 * #4490 fix 2 (N76) — Overview "Events here": start an event or experience at
 * this venue. The creator opens with this venue already picked in Where, so
 * the address and time zone are filled and the event lands on the venue's
 * Calendar and its public What's on.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { color, space, type } from "../../../../constants/designSystem";
import { Button } from "../../../ui/Button";
import { GlassCard } from "../../../ui/GlassCard";

export interface EventsHereCardProps {
  venueId: string;
  onOpenCalendar?: () => void;
}

export function eventsHereCreateHref(venueId: string, noun: "event" | "experience"): string {
  return `/${noun}/create?venueId=${encodeURIComponent(venueId)}`;
}

export function EventsHereCard({ venueId, onOpenCalendar }: EventsHereCardProps): React.ReactElement {
  const router = useRouter();
  return (
    <GlassCard variant="base" padding={space[4]} contentStyle={styles.stack} testID="venue-overview-events-here">
      <View style={styles.copy}>
        <Text style={styles.title}>Events here</Text>
        <Text style={styles.body}>
          Put on a night, a class or a show at this venue. It shows on your venue page under What&apos;s on.
        </Text>
      </View>
      <View style={styles.actions}>
        <Button
          label="Add an event here"
          variant="primary"
          size="sm"
          leadingIcon="plus"
          onPress={() => router.push(eventsHereCreateHref(venueId, "event") as never)}
          testID="venue-overview-add-event"
        />
        <Button
          label="Add an experience here"
          variant="secondary"
          size="sm"
          onPress={() => router.push(eventsHereCreateHref(venueId, "experience") as never)}
          testID="venue-overview-add-experience"
        />
        {onOpenCalendar !== undefined ? (
          <Button label="Open calendar" variant="ghost" size="sm" onPress={onOpenCalendar} testID="venue-overview-events-calendar" />
        ) : null}
      </View>
    </GlassCard>
  );
}

export default EventsHereCard;

const styles = StyleSheet.create({
  stack: { gap: space[3] },
  copy: { gap: space[1] },
  title: { ...type.row, color: color.text1 },
  body: { ...type.small, color: color.text2 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
});
