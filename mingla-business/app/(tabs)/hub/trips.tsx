/**
 * /hub/trips — Hub > Trips sub-route.
 *
 * ORCH-0826 [Hub Foundation + universal-plus creator] M0: empty-state placeholder.
 * ORCH-0859 [Tr2 Minimum Viable Trip] (this file): wired to useTripsByBrand,
 * lists the current brand's trips. Tap routes to operator dashboard at
 * /trip/{id}. For non-trip-planner brands shows an explainer.
 *
 * Per SPEC §4.10 file 26.
 */

import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { Icon } from "../../../src/components/ui/Icon";
import { useCurrentBrand } from "../../../src/hooks/useCurrentBrand";
import { useTripsByBrand } from "../../../src/hooks/useTrips";

function formatDateShort(iso: string | null): string {
  if (iso === null) return "Date TBD";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "Date TBD";
  }
}

export default function HubTripsRoute(): React.ReactElement {
  const router = useRouter();
  const currentBrand = useCurrentBrand();
  const tripsQuery = useTripsByBrand(currentBrand?.id ?? null);

  if (currentBrand === null) {
    return (
      <View style={styles.stateHost}>
        <Text style={styles.body}>Select a brand to see its trips.</Text>
      </View>
    );
  }

  if (currentBrand.kind !== "trip_planner") {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.placeholderCard}>
          <Text style={styles.title}>Trips are for trip-planner brands.</Text>
          <Text style={styles.body}>
            This brand is set up for events. To plan multi-day trips, switch to
            a trip-planner brand or create one in the brand switcher.
          </Text>
        </View>
      </ScrollView>
    );
  }

  if (tripsQuery.isLoading) {
    return (
      <View style={styles.stateHost}>
        <ActivityIndicator />
      </View>
    );
  }

  if (tripsQuery.isError) {
    return (
      <View style={styles.stateHost}>
        <Text style={styles.title}>Couldn&rsquo;t load trips</Text>
        <Text style={styles.body}>
          {tripsQuery.error instanceof Error
            ? tripsQuery.error.message
            : "Check your connection and try again."}
        </Text>
      </View>
    );
  }

  const trips = tripsQuery.data ?? [];

  if (trips.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.placeholderCard}>
          <Text style={styles.title}>No trips yet.</Text>
          <Text style={styles.body}>
            Tap the + at the top to create your first trip — a yoga retreat,
            food tour, or weekend getaway.
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.tripsList}>
        {trips.map((trip) => (
          <Pressable
            key={trip.id}
            onPress={() => {
              // ORCH-0859 REWORK 2 (operator smoke #3): drafts route back
              // into the wizard so the operator can finish them; published
              // / live / ended / cancelled trips route to the operator
              // dashboard. Was unconditionally /trip/{id} — left drafts
              // with no edit path.
              const route =
                trip.status === "draft"
                  ? `/trip/${trip.id}/edit`
                  : `/trip/${trip.id}`;
              router.push(route as never);
            }}
            accessibilityRole="button"
            accessibilityLabel={
              trip.status === "draft"
                ? `Continue editing ${trip.title}`
                : `Open ${trip.title}`
            }
            style={styles.tripCard}
            testID={`hub-trips-card-${trip.id}`}
          >
            <View style={styles.tripCardTextCol}>
              <Text style={styles.tripCardTitle} numberOfLines={1}>
                {trip.title}
              </Text>
              <Text style={styles.tripCardSub}>
                {formatDateShort(trip.businessTrip.startAt)}
                {trip.businessTrip.endAt !== null
                  ? ` – ${formatDateShort(trip.businessTrip.endAt)}`
                  : ""}
              </Text>
              <Text style={styles.tripCardStatus}>
                {trip.status === "draft"
                  ? "Draft"
                  : trip.status === "scheduled"
                    ? "Published"
                    : trip.status === "live"
                      ? "Live now"
                      : trip.status === "ended"
                        ? "Ended"
                        : "Cancelled"}
              </Text>
            </View>
            <Icon name="chevR" size={18} color={textTokens.tertiary} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  stateHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  body: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
    textAlign: "center",
  },
  placeholderCard: {
    padding: spacing.xl,
    borderRadius: radius.xl,
    backgroundColor: glass.tint.profileElevated,
    borderColor: glass.border.profileElevated,
    borderWidth: 1,
    gap: spacing.md,
  },
  tripsList: {
    gap: spacing.sm,
  },
  tripCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  tripCardTextCol: {
    flex: 1,
  },
  tripCardTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  tripCardSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    marginTop: 2,
  },
  tripCardStatus: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: accent.warm,
    marginTop: 4,
  },
});
