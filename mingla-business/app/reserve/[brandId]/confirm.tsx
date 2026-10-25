import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { captureWeb } from "../../../src/analytics/webAnalytics";
import {
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { BUYER_CLAIM_COPY } from "../../../src/constants/buyerClaimCopy";
import {
  confirmGuestVenueReservation,
  type GuestReservationConfirmResult,
} from "../../../src/services/venueGuestReservationService";
import { mintClaimLinkHandoff } from "../../../src/services/claimLinkService";
import { Button } from "../../../src/components/ui/Button";
import { BuyerClaimCard } from "../../../src/components/checkout/DownloadMinglaCta";
import { PrivacyChoicesLink } from "../../../src/analytics/PrivacyChoicesLink";

type State = "loading" | "completed" | "pending" | "error";

export default function VenueReservationConfirmRoute(): React.ReactElement {
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
  const [completedResult, setCompletedResult] =
    useState<GuestReservationConfirmResult | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // #1221: provider return credentials do not remain in query/history.
    const clean = `${window.location.pathname}${window.location.hash}`;
    window.history.replaceState(null, "", clean);
  }, []);

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
        setCompletedResult(result);
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
      {/*
        #2211 — this region SCROLLS. All four payment-return states share ONE
        `flex: 1` + `justifyContent: "center"` root with no scroll container.
        The `completed` state stacks an h2, body copy and TWO buttons, and the
        `error` state carries the only retry — so at accessibility text sizes a
        guest who had just been charged could not reach either.
      */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {state === "loading" ? (
          <>
            <ActivityIndicator />
            <Text style={styles.title}>Confirming your reservation…</Text>
          </>
        ) : state === "completed" ? (
          <>
            <Text style={styles.title}>{BUYER_CLAIM_COPY.venue.title}</Text>
            {completedResult !== null ? (
              <BuyerClaimCard
                kind="booking"
                email={completedResult.buyerContact?.email ?? null}
                phoneLast4={completedResult.buyerContact?.phoneLast4 ?? null}
                shortUrl={completedResult.claim?.shortUrl ?? null}
                handoff={
                  completedResult.claim?.code
                    ? {
                        mint: () =>
                          mintClaimLinkHandoff(
                            completedResult.claim?.code ?? "",
                          ),
                      }
                    : null
                }
                textSent={completedResult.buyerContact?.phoneLast4 != null}
                analyticsSurface="venue_reservation_confirm"
                fallbackEntity={{
                  entityType: "event",
                  brandSlug: typeof brandId === "string" ? brandId : "",
                  entitySlug: completedResult.reservationId ?? "",
                }}
              />
            ) : null}
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
        {/* #2331 — end of content: reopens the privacy bar. */}
        <PrivacyChoicesLink />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // #2211 — `host` keeps only the frame; centring moved to `scrollContent`.
  host: { flex: 1, backgroundColor: "#0c0e12" },
  scroll: { flex: 1, overflow: "hidden" },
  scrollContent: {
    // #2211 — EXPLICIT flexGrow (RN defaults content containers to 0).
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  title: { ...typography.h2, color: textTokens.primary, textAlign: "center" },
  body: {
    ...typography.body,
    color: textTokens.secondary,
    textAlign: "center",
  },
});
