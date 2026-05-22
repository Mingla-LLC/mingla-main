/**
 * /trip/[id]/travelers — ORCH-0913 dedicated travelers route.
 *
 * Lifted from the former trip-dashboard Travelers tab body. Data ownership
 * stays with useTrip / useTripOrders / useTripIntakeSchemasByEvent.
 */

import React from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../../../src/constants/designSystem";
import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { Icon } from "../../../../src/components/ui/Icon";
import { SafeScreen } from "../../../../src/components/ui/SafeScreen";
import { TopBar } from "../../../../src/components/ui/TopBar";
import {
  TravelerIntakeAnswerCard,
  TravelerTierChip,
} from "../../../../src/components/trip/TravelerIntakeAnswerCard";
import { useTripIntakeSchemasByEvent } from "../../../../src/hooks/useIntakeSchema";
import { useTripOrders } from "../../../../src/hooks/useTripOrders";
import { useTrip } from "../../../../src/hooks/useTrips";
import type { IntakeAnswerValue } from "../../../../src/services/intakeSchemaService";

function formatCurrency(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export default function TripTravelersRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : params.id;
  const tripQuery = useTrip(typeof eventId === "string" ? eventId : null);
  const ordersQuery = useTripOrders(typeof eventId === "string" ? eventId : null);
  const intakeSchemasQuery = useTripIntakeSchemasByEvent(
    typeof eventId === "string" ? eventId : "",
    { enabled: typeof eventId === "string" },
  );

  if (typeof eventId !== "string" || eventId.length === 0) {
    return (
      <SafeScreen style={styles.stateHost}>
        <Text style={styles.title}>Trip not found</Text>
      </SafeScreen>
    );
  }

  if (tripQuery.isLoading) {
    return (
      <SafeScreen style={styles.stateHost}>
        <ActivityIndicator />
      </SafeScreen>
    );
  }

  if (tripQuery.isError || ordersQuery.isError) {
    const err = tripQuery.error ?? ordersQuery.error;
    return (
      <SafeScreen style={styles.host}>
        <TopBar
          leftKind="back"
          title="Travelers"
          onBack={() => router.push(`/trip/${eventId}` as never)}
          rightSlot={null}
        />
        <EmptyState
          illustration="users"
          title="Couldn't load travelers"
          description={err instanceof Error ? err.message : "Try again."}
          cta={{ label: "Retry", onPress: () => void ordersQuery.refetch() }}
        />
      </SafeScreen>
    );
  }

  const trip = tripQuery.data;
  if (trip === null || trip === undefined) {
    return (
      <SafeScreen style={styles.stateHost}>
        <Text style={styles.title}>Trip not found</Text>
      </SafeScreen>
    );
  }

  return (
    <SafeScreen style={styles.host}>
      <TopBar
        leftKind="back"
        title="Travelers"
        onBack={() => router.push(`/trip/${eventId}` as never)}
        rightSlot={null}
      />
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
      >
        {ordersQuery.isLoading ? (
          <ActivityIndicator />
        ) : (ordersQuery.data ?? []).length === 0 ? (
          <View style={styles.emptyState}>
            <Icon name="users" size={32} color={textTokens.tertiary} />
            <Text style={styles.emptyText}>
              No travelers yet. Share the trip link to start taking bookings.
            </Text>
          </View>
        ) : (
          (ordersQuery.data ?? []).map((o) => {
            const intakeArray = Array.isArray(o.intakeFormData)
              ? (o.intakeFormData as {
                  ticket_type_id?: string;
                  schema_version_id?: string;
                  answers?: Record<string, IntakeAnswerValue>;
                }[])
              : [];
            const intakeEntry = intakeArray[0] ?? null;
            const ticketTypeId = intakeEntry?.ticket_type_id ?? null;
            const intakeSchema =
              ticketTypeId !== null && intakeSchemasQuery.data !== undefined
                ? intakeSchemasQuery.data.get(ticketTypeId) ?? null
                : null;
            const tier =
              ticketTypeId !== null
                ? trip.pricingTiers.find(
                    (t) => t.ticketTypeId === ticketTypeId,
                  ) ?? null
                : null;
            const tierChipHidden = trip.pricingTiers.length <= 1;
            return (
              <View key={o.id} style={styles.travelerRow}>
                <View style={styles.travelerTextCol}>
                  <Text style={styles.travelerName}>
                    {o.buyerName ?? o.buyerEmail ?? "Anonymous"}
                  </Text>
                  {o.buyerEmail !== null ? (
                    <Text style={styles.travelerEmail}>{o.buyerEmail}</Text>
                  ) : null}
                  <TravelerIntakeAnswerCard
                    schema={intakeSchema}
                    answers={intakeEntry?.answers ?? null}
                  />
                </View>
                <View style={styles.travelerMeta}>
                  {tier !== null && !tierChipHidden ? (
                    <TravelerTierChip
                      tierName={tier.tierName}
                      hidden={tierChipHidden}
                    />
                  ) : null}
                  <Text style={styles.travelerStatus}>{o.paymentStatus}</Text>
                  <Text style={styles.travelerAmount}>
                    {formatCurrency(o.totalCents, o.currency)}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
  },
  stateHost: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: "#0c0e12",
  },
  title: {
    fontSize: typography.h3.fontSize,
    color: textTokens.primary,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  emptyState: {
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    textAlign: "center",
  },
  travelerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  travelerTextCol: {
    flex: 1,
  },
  travelerName: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  travelerEmail: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    marginTop: 2,
  },
  travelerMeta: {
    alignItems: "flex-end",
  },
  travelerStatus: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    textTransform: "capitalize",
  },
  travelerAmount: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
    marginTop: 2,
  },
});
