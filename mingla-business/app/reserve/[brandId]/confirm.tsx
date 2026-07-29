import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { captureWeb } from "../../../src/analytics/webAnalytics";
import {
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { confirmGuestVenueReservation } from "../../../src/services/venueGuestReservationService";
import { Button } from "../../../src/components/ui/Button";

type State = "loading" | "completed" | "pending" | "error";

export default function VenueReservationConfirmRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{
    brandId: string | string[];
    rcs?: string | string[];
    bst?: string | string[];
  }>();
  const brandId = Array.isArray(params.brandId)
    ? params.brandId[0]
    : params.brandId;
  const reservationDraftId = Array.isArray(params.rcs)
    ? params.rcs[0]
    : params.rcs;
  const buyerStatusToken = Array.isArray(params.bst)
    ? params.bst[0]
    : params.bst;
  const [state, setState] = useState<State>("loading");

  const confirm = useCallback(async (): Promise<void> => {
    if (
      typeof reservationDraftId !== "string" ||
      typeof buyerStatusToken !== "string"
    ) {
      setState("error");
      return;
    }
    setState("loading");
    try {
      const result = await confirmGuestVenueReservation({
        reservationDraftId,
        buyerStatusToken,
      });
      setState(
        result.status === "completed"
          ? "completed"
          : result.status === "pending"
            ? "pending"
            : "error",
      );
      if (result.status === "completed") {
        captureWeb("venue_reservation_completed", {
          surface: "buyer_web",
          brand_id: typeof brandId === "string" ? brandId : null,
          free_paid: "paid",
        });
      }
    } catch {
      setState("error");
      captureWeb("venue_reservation_failed", {
        surface: "buyer_web",
        brand_id: typeof brandId === "string" ? brandId : null,
        result_class: "confirm_failed",
      });
    }
  }, [brandId, buyerStatusToken, reservationDraftId]);

  useEffect(() => {
    void confirm();
  }, [confirm]);

  return (
    <SafeAreaView
      style={styles.host}
      edges={["top", "bottom", "left", "right"]}
    >
      {state === "loading" ? (
        <>
          <ActivityIndicator />
          <Text style={styles.title}>Confirming your reservation…</Text>
        </>
      ) : state === "completed" ? (
        <>
          <Text style={styles.title}>Your table is reserved</Text>
          <Text style={styles.body}>
            Confirmation has been sent to your email.
          </Text>
          <Button label="Done" onPress={() => router.replace("/" as never)} />
        </>
      ) : state === "pending" ? (
        <>
          <Text style={styles.title}>Payment is still confirming</Text>
          <Text style={styles.body}>Give it a moment, then check again.</Text>
          <Button label="Check again" onPress={() => void confirm()} />
        </>
      ) : (
        <>
          <Text style={styles.title}>We couldn’t confirm it yet</Text>
          <Text style={styles.body}>
            If you were charged, your reservation is still protected while we
            check the payment.
          </Text>
          <Button label="Try again" onPress={() => void confirm()} />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: "#0c0e12",
  },
  title: { ...typography.h2, color: textTokens.primary, textAlign: "center" },
  body: {
    ...typography.body,
    color: textTokens.secondary,
    textAlign: "center",
  },
});
