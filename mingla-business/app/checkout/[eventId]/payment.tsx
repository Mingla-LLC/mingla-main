/**
 * J-C3 — Payment screen.
 *
 * Route: /checkout/{eventId}/payment
 *
 * Stub Stripe Payment Element with 4 method tabs (Card / Apple Pay /
 * Google Pay). Free orders never reach this screen — they skip from
 * J-C2 directly to /confirm. 3DS challenge opens as a Sheet over this
 * screen when __DEV__ Force-3DS toggle is ticked.
 *
 * On payment success: generate stub OrderResult → recordResult into
 * cart Context → router.replace to /confirm.
 *
 * Per Cycle 8 spec §4.6.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { KeyboardEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  spacing,
  text as textTokens,
} from "../../../src/constants/designSystem";
import { useLiveEventStore } from "../../../src/store/liveEventStore";
import { formatGbp } from "../../../src/utils/currency";
import {
  generateOrderId,
  generateTicketId,
} from "../../../src/utils/stubOrderId";

import { Button } from "../../../src/components/ui/Button";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Toast } from "../../../src/components/ui/Toast";

import {
  useCart,
  useCartTotals,
} from "../../../src/components/checkout/CartContext";
import type {
  CartLine,
  CheckoutPaymentMethod,
} from "../../../src/components/checkout/CartContext";
import { CheckoutHeader } from "../../../src/components/checkout/CheckoutHeader";
import {
  PaymentElementStub,
  runCardPaymentStub,
  type PaymentMethodId,
  type PaymentResult,
} from "../../../src/components/checkout/PaymentElementStub";
import { ThreeDSStubSheet } from "../../../src/components/checkout/ThreeDSStubSheet";

const buildResultFromCart = (
  lines: CartLine[],
  totalGbp: number,
  paymentMethod: CheckoutPaymentMethod,
): {
  orderId: string;
  ticketIds: string[];
  paidAt: string;
  paymentMethod: CheckoutPaymentMethod;
  totalGbp: number;
} => {
  const orderId = generateOrderId();
  const ticketIds: string[] = [];
  lines.forEach((line, lineIdx) => {
    for (let seatIdx = 0; seatIdx < line.quantity; seatIdx += 1) {
      ticketIds.push(generateTicketId(orderId, lineIdx, seatIdx));
    }
  });
  return {
    orderId,
    ticketIds,
    paidAt: new Date().toISOString(),
    paymentMethod,
    totalGbp,
  };
};

const paymentMethodToCart = (m: PaymentMethodId): CheckoutPaymentMethod => {
  switch (m) {
    case "card":
      return "card";
    case "apple_pay":
      return "apple_pay";
    case "google_pay":
      return "google_pay";
    default: {
      const _exhaustive: never = m;
      return _exhaustive;
    }
  }
};

export default function CheckoutPaymentScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ eventId: string }>();
  const eventId = typeof params.eventId === "string" ? params.eventId : null;

  const event = useLiveEventStore((s) =>
    eventId === null ? null : s.events.find((e) => e.id === eventId) ?? null,
  );
  const { lines, buyer, recordResult } = useCart();
  const totals = useCartTotals();

  const [processing, setProcessing] = useState<boolean>(false);
  const [pendingMethod, setPendingMethod] = useState<PaymentMethodId | null>(
    null,
  );
  const [threeDSVisible, setThreeDSVisible] = useState<boolean>(false);
  const [declineToast, setDeclineToast] = useState<boolean>(false);
  // __DEV__ test toggles — Card method's bottom-bar Pay button reads these
  // to decide whether to return "ok" / "requiresAction" / "declined" from
  // the stub. PaymentElementStub renders its own toggles for visual parity
  // but the Card Pay button lives in this screen's sticky bottom bar.
  const [force3DS, setForce3DS] = useState<boolean>(false);
  const [forceDecline, setForceDecline] = useState<boolean>(false);

  // ----- Defensive guards ------------------------------------------
  // Free orders never reach this screen (J-C2 skips to /confirm).
  // Cart empty → bounce to J-C1. Buyer details invalid → bounce to /buyer.
  useEffect(() => {
    if (eventId === null) return;
    if (lines.length === 0) {
      router.replace(`/checkout/${eventId}` as never);
      return;
    }
    if (totals.isFree) {
      router.replace(`/checkout/${eventId}/buyer` as never);
      return;
    }
    if (buyer.name.trim().length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email.trim())) {
      router.replace(`/checkout/${eventId}/buyer` as never);
      return;
    }
  }, [
    eventId,
    lines.length,
    totals.isFree,
    buyer.name,
    buyer.email,
    router,
  ]);

  // ----- Keyboard pattern (lifted from buyer.tsx / EventCreatorWizard) -----
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);
  const scrollViewRef = useRef<ScrollView | null>(null);
  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(
      showEvent,
      (e: KeyboardEvent): void => {
        setKeyboardHeight(e.endCoordinates.height);
      },
    );
    const hideSub = Keyboard.addListener(hideEvent, (): void => {
      setKeyboardHeight(0);
    });
    return (): void => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // ----- Handlers -------------------------------------------------
  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else if (eventId !== null) {
      router.replace(`/checkout/${eventId}/buyer` as never);
    }
  }, [router, eventId]);

  const completePayment = useCallback(
    (method: PaymentMethodId): void => {
      const result = buildResultFromCart(
        lines,
        totals.totalGbp,
        paymentMethodToCart(method),
      );
      recordResult(result);
      if (eventId !== null) {
        router.replace(`/checkout/${eventId}/confirm` as never);
      }
    },
    [lines, totals.totalGbp, recordResult, router, eventId],
  );

  const handleResult = useCallback(
    (method: PaymentMethodId, result: PaymentResult): void => {
      setProcessing(false);
      setPendingMethod(null);
      switch (result) {
        case "ok":
          completePayment(method);
          return;
        case "requiresAction":
          setPendingMethod(method);
          setThreeDSVisible(true);
          return;
        case "declined":
          setDeclineToast(true);
          return;
        default: {
          const _exhaustive: never = result;
          return _exhaustive;
        }
      }
    },
    [completePayment],
  );

  // Card method "Pay" lives in this screen's bottom bar; Apple/Google Pay
  // tabs trigger their own onPay callback inside PaymentElementStub.
  const handleCardPay = useCallback(async (): Promise<void> => {
    if (processing) return;
    setProcessing(true);
    setPendingMethod("card");
    const result = await runCardPaymentStub(force3DS, forceDecline);
    handleResult("card", result);
  }, [processing, force3DS, forceDecline, handleResult]);

  // 3DS sheet
  const handleThreeDSSuccess = useCallback((): void => {
    setThreeDSVisible(false);
    if (pendingMethod !== null) {
      completePayment(pendingMethod);
      setPendingMethod(null);
    }
  }, [pendingMethod, completePayment]);

  const handleThreeDSClose = useCallback((): void => {
    setThreeDSVisible(false);
    setPendingMethod(null);
  }, []);

  // Render an empty shell while defensive guards redirect.
  if (
    event === null ||
    lines.length === 0 ||
    totals.isFree ||
    buyer.name.trim().length < 2
  ) {
    return (
      <View style={styles.host}>
        <CheckoutHeader
          stepIndex={2}
          totalSteps={3}
          title="Payment"
          onBack={handleBack}
        />
      </View>
    );
  }

  return (
    <View style={styles.host}>
      <CheckoutHeader
        stepIndex={2}
        totalSteps={3}
        title="Payment"
        onBack={handleBack}
      />
      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 140 },
          keyboardHeight > 0
            ? { paddingBottom: keyboardHeight + 140 }
            : null,
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Order summary recap */}
        <GlassCard
          variant="base"
          radius="lg"
          padding={spacing.md}
          style={styles.summary}
        >
          <Text style={styles.summaryLabel}>ORDER SUMMARY</Text>
          {lines.map((l) => (
            <View key={l.ticketTypeId} style={styles.summaryLine}>
              <Text style={styles.summaryQty}>{l.quantity}×</Text>
              <Text style={styles.summaryName} numberOfLines={1}>
                {l.ticketName}
              </Text>
              <Text style={styles.summaryTotal}>
                {l.isFree ? "Free" : formatGbp(l.unitPriceGbp * l.quantity)}
              </Text>
            </View>
          ))}
          <View style={styles.summaryDivider} />
          <View style={styles.summaryTotalRow}>
            <Text style={styles.summaryTotalLabel}>Total</Text>
            <Text style={styles.summaryTotalValue}>
              {formatGbp(totals.totalGbp)}
            </Text>
          </View>
        </GlassCard>

        <PaymentElementStub
          onPay={handleResult}
          processing={processing}
          totalGbp={totals.totalGbp}
        />

        {__DEV__ ? (
          <View style={styles.devLifted}>
            <Text style={styles.devLiftedHint}>
              Note: __DEV__ toggles inside the Payment Element apply to Apple
              Pay / Google Pay tabs. The bottom-bar &quot;Pay&quot; button (Card
              method) uses these explicit toggles below for parity in stub
              testing:
            </Text>
            <View style={styles.devLiftedRow}>
              <Pressable
                onPress={() => setForce3DS((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: force3DS }}
                accessibilityLabel="Force 3DS challenge (Card, testing only)"
                style={[
                  styles.devLiftedToggle,
                  force3DS && styles.devLiftedToggleOn,
                ]}
              >
                <Text style={styles.devLiftedToggleText}>
                  {force3DS ? "✓ " : ""}Force 3DS (Card)
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setForceDecline((v) => !v)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: forceDecline }}
                accessibilityLabel="Force payment decline (testing only)"
                style={[
                  styles.devLiftedToggle,
                  forceDecline && styles.devLiftedToggleOn,
                ]}
              >
                <Text style={styles.devLiftedToggleText}>
                  {forceDecline ? "✓ " : ""}Force decline (Card)
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* Sticky bottom bar — Card method's Pay button. Apple/Google Pay
          tabs render their own pay buttons inside PaymentElementStub. */}
      <View
        style={[
          styles.bottomBar,
          { paddingBottom: insets.bottom + spacing.md },
          keyboardHeight > 0 ? styles.bottomBarHidden : null,
        ]}
      >
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>
            {formatGbp(totals.totalGbp)}
          </Text>
        </View>
        <Button
          label={`Pay ${formatGbp(totals.totalGbp)}`}
          onPress={handleCardPay}
          variant="primary"
          size="lg"
          fullWidth
          loading={processing && pendingMethod === "card"}
          disabled={processing}
          accessibilityLabel={`Pay ${formatGbp(totals.totalGbp)} with card`}
        />
      </View>

      <ThreeDSStubSheet
        visible={threeDSVisible}
        onClose={handleThreeDSClose}
        onSuccess={handleThreeDSSuccess}
      />

      {/* Decline toast — top-anchored absolute wrapper (Cycle 8a lesson) */}
      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={declineToast}
          kind="error"
          message="Card declined — try another payment method."
          onDismiss={() => setDeclineToast(false)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  summary: {
    marginBottom: spacing.lg,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    color: textTokens.tertiary,
    marginBottom: spacing.sm,
  },
  summaryLine: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    gap: spacing.sm,
  },
  summaryQty: {
    fontSize: 14,
    color: textTokens.tertiary,
    fontWeight: "500",
    minWidth: 28,
  },
  summaryName: {
    flex: 1,
    fontSize: 14,
    color: textTokens.primary,
    fontWeight: "500",
  },
  summaryTotal: {
    fontSize: 14,
    color: textTokens.primary,
    fontWeight: "600",
  },
  summaryDivider: {
    marginVertical: spacing.sm,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  summaryTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  summaryTotalLabel: {
    fontSize: 13,
    color: textTokens.tertiary,
    fontWeight: "500",
  },
  summaryTotalValue: {
    fontSize: 17,
    color: textTokens.primary,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  devLifted: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(245, 158, 11, 0.3)",
    backgroundColor: "rgba(245, 158, 11, 0.06)",
  },
  devLiftedHint: {
    fontSize: 11,
    color: textTokens.tertiary,
    fontStyle: "italic",
    marginBottom: spacing.xs,
  },
  devLiftedRow: {
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  devLiftedToggle: {
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.4)",
  },
  devLiftedToggleOn: {
    backgroundColor: "rgba(245, 158, 11, 0.18)",
  },
  devLiftedToggleText: {
    fontSize: 11,
    color: textTokens.secondary,
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: "rgba(12, 14, 18, 0.94)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
  },
  bottomBarHidden: {
    transform: [{ translateY: 200 }],
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: spacing.sm,
  },
  totalLabel: {
    fontSize: 13,
    color: textTokens.tertiary,
    fontWeight: "500",
  },
  totalValue: {
    fontSize: 20,
    color: textTokens.primary,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  // Top-anchored toast wrap — Toast slides down 40px from above this
  // wrap into its natural position.
  toastWrap: {
    position: "absolute",
    top: 80,
    left: 0,
    right: 0,
  },
});
