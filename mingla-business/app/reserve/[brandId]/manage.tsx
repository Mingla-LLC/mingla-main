import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import {
  cancelGuestVenueReservation,
  fetchGuestVenueRefund,
  type GuestVenueRefundSummary,
} from "../../../src/services/venueGuestReservationService";
import { SafeScreen } from "../../../src/components/ui/SafeScreen";

function fragmentCredentials(): {
  reservationId: string;
  token: string;
} {
  if (typeof window === "undefined") {
    return { reservationId: "", token: "" };
  }
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const value = {
    reservationId: params.get("reservationId") ?? "",
    token: params.get("token") ?? "",
  };
  window.history.replaceState(null, "", window.location.pathname);
  return value;
}

export default function GuestReservationManageRoute() {
  const [credentials] = useState(fragmentCredentials);
  const [refund, setRefund] = useState<GuestVenueRefundSummary | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [cancelling, setCancelling] = useState(false);
  const load = useCallback(async () => {
    if (!credentials.reservationId || !credentials.token) {
      return setState("error");
    }
    setState("loading");
    try {
      setRefund(
        await fetchGuestVenueRefund({
          reservationId: credentials.reservationId,
          guestToken: credentials.token,
        }),
      );
      setState("ready");
    } catch {
      setState("error");
    }
  }, [credentials]);
  useEffect(() => {
    void load();
  }, [load]);
  if (state === "loading") {
    return (
      <SafeScreen edges={["top", "bottom"]} style={styles.host}>
        <ActivityIndicator />
        <Text>Loading reservation…</Text>
      </SafeScreen>
    );
  }
  if (state === "error") {
    return (
      <SafeScreen edges={["top", "bottom"]} style={styles.host}>
        <Text>We couldn’t open this reservation.</Text>
        <Pressable
          accessibilityLabel="Try again"
          onPress={() => void load()}
        >
          <Text>Try again</Text>
        </Pressable>
      </SafeScreen>
    );
  }
  const copy = refund?.buyer_state === "processed"
    ? "Your refund has been processed."
    : refund?.buyer_state === "needs_attention"
    ? "Action is needed to continue your refund."
    : refund
    ? "Your refund is processing."
    : "No refund has been requested.";
  return (
    <SafeScreen edges={["top", "bottom"]} style={styles.host}>
      <Text style={styles.title}>Manage reservation</Text>
      <Text>{copy}</Text>
      {refund
        ? (
          <Text>
            {(refund.amount_cents / 100).toFixed(2)} {refund.currency}
          </Text>
        )
        : null}
      {refund?.buyer_state === "needs_attention"
        ? (
          refund.attentionDeliveryState === "parked"
            ? (
              <Text>
                We couldn&apos;t confirm your text was sent. Contact Mingla
                Support and reference this refund: {refund.refund_id}
              </Text>
            )
            : (
              <Text>
                Use the secure refund link sent to your email or phone.
                Reservation management links cannot submit bank details.
              </Text>
            )
        )
        : null}
      <Text>Updating refund status…</Text>
      <Pressable
        accessibilityLabel="Refresh refund status"
        accessibilityRole="button"
        onPress={() => void load()}
        style={styles.button}
      >
        <Text style={styles.buttonText}>Refresh</Text>
      </Pressable>
      {!refund
        ? (
          <Pressable
            accessibilityLabel="Cancel reservation"
            accessibilityRole="button"
            disabled={cancelling}
            onPress={async () => {
              setCancelling(true);
              try {
                const result = await cancelGuestVenueReservation({
                  reservationId: credentials.reservationId,
                  guestToken: credentials.token,
                });
                setRefund(result.refund);
              } finally {
                setCancelling(false);
              }
            }}
            style={styles.button}
          >
            <Text style={styles.buttonText}>
              {cancelling ? "Cancelling…" : "Cancel reservation"}
            </Text>
          </Pressable>
        )
        : null}
    </SafeScreen>
  );
}
const styles = StyleSheet.create({
  host: { flex: 1, justifyContent: "center", padding: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: "700" },
  button: {
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#111827",
    borderRadius: 12,
  },
  buttonText: { color: "#fff", fontWeight: "700" },
});
