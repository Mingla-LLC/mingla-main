/**
 * #2879 / #2947 slice 3 — waitlist offer screen (buyer web).
 *
 * Reached when ticket-checkout-create answers kind:"waitlist_offered".
 * No hold was taken — stock is genuinely gone.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { Button } from "../../../src/components/ui/Button";
import { eventPublicPath } from "../../../src/constants/publicUrls";
import { usePublicEventById } from "../../../src/hooks/usePublicEvents";

export default function CheckoutWaitlistScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    eventId: string;
    position?: string;
  }>();
  const eventId = typeof params.eventId === "string" ? params.eventId : "";
  const position = Number(params.position);
  const { data: detail } = usePublicEventById(eventId || null);
  const event = detail?.event ?? null;

  const positionLine = Number.isFinite(position) && position > 0
    ? `You're #${position} on the waitlist.`
    : "You're on the waitlist.";

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom },
      ]}
    >
      <Text style={styles.eyebrow}>Sold out</Text>
      <Text style={styles.title}>{positionLine}</Text>
      <Text style={styles.body}>
        These tickets are gone — we did not put you in a line for stock that
        does not exist. We already have your name, email and mobile from the
        details you entered, and we will email you if a spot opens.
      </Text>
      <Button
        label="Back to event"
        onPress={() => {
          if (event?.brandSlug && event?.eventSlug) {
            router.replace(
              eventPublicPath({
                brandSlug: event.brandSlug,
                eventSlug: event.eventSlug,
              }) as never,
            );
            return;
          }
          router.replace("/(tabs)/home" as never);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0c0e12",
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  eyebrow: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    textTransform: "uppercase",
  },
  title: {
    ...typography.h2,
    color: textTokens.primary,
  },
  body: {
    ...typography.body,
    color: textTokens.secondary,
    marginBottom: spacing.lg,
  },
});
