// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { initStripe } from "@stripe/stripe-react-native";
import { useStripePaymentSheet } from "@mingla/payments-native";
import { StayReservationDetail } from "@mingla/brand-rendering/StayReservationDetail";
import {
  createThemePalette,
  resolveTheme,
} from "@mingla/offering-rendering";
import * as WebBrowser from "expo-web-browser";

import { useStayReservationGroup } from "../../src/hooks/useStayGuest";
import { postHogService } from "../../src/services/postHogService";
import { stayGuestService } from "../../src/services/stayGuestService";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const applePayItems = (
  amountMinor: string,
  currencyCode: string,
): { label: string; amount: string; paymentType: "Immediate" }[] => {
  const digits = new Intl.NumberFormat("en", {
    style: "currency",
    currency: currencyCode,
  }).resolvedOptions().maximumFractionDigits ?? 2;
  const padded = amountMinor.padStart(digits + 1, "0");
  return [{
    label: "Stay reservation",
    amount:
      digits === 0
        ? padded
        : `${padded.slice(0, -digits)}.${padded.slice(-digits)}`,
    paymentType: "Immediate",
  }];
};

export default function StayReservationRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ groupId?: string | string[] }>();
  const raw = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId;
  const groupId = typeof raw === "string" && UUID.test(raw) ? raw : null;
  const query = useStayReservationGroup(groupId);
  const theme = useMemo(() => resolveTheme(null, null), []);
  const palette = useMemo(() => createThemePalette(theme), [theme]);
  const { initPaymentSheet, presentPaymentSheet, isPaymentSheetSupported } =
    useStripePaymentSheet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groupViewFired = useRef(false);

  useEffect(() => {
    const group = query.data;
    if (!group || groupViewFired.current) return;
    groupViewFired.current = true;
    postHogService.capture("stay_group_viewed", {
      surface: "consumer_native",
      brand_id: group.brandId,
      venue_id: group.venueId,
      group_id: group.groupId,
      state: group.state,
    });
  }, [query.data]);

  if (groupId === null) {
    return (
      <View style={styles.invalid}>
        <Text style={styles.invalidTitle}>Stay reservation not found</Text>
      </View>
    );
  }

  const pay = async (): Promise<void> => {
    const group = query.data;
    if (!group) return;
    setBusy(true);
    setError(null);
    try {
      const payment = await stayGuestService.createPayment(group);
      if (payment.provider === "paystack") {
        await WebBrowser.openBrowserAsync(payment.authorizationUrl);
        await query.refetch();
        return;
      }
      if (!isPaymentSheetSupported) {
        throw new Error("Native payment is not available on this device.");
      }
      await initStripe({
        publishableKey: payment.publishableKey,
        stripeAccountId: payment.stripeAccountId,
        merchantIdentifier: "merchant.com.mingla.app.v2",
        urlScheme: "com.mingla.app.v2",
      });
      const initialized = await initPaymentSheet({
        merchantDisplayName: "Mingla",
        paymentIntentClientSecret: payment.clientSecret,
        returnURL: "com.mingla.app.v2://stripe-redirect",
        applePay: {
          merchantCountryCode: "US",
          cartItems: applePayItems(payment.amountMinor, payment.currencyCode),
        },
        googlePay: {
          merchantCountryCode: "US",
          testEnv: process.env.EAS_BUILD_PROFILE !== "production",
          currencyCode: payment.currencyCode.toLowerCase(),
        },
      });
      if (initialized.error) {
        throw new Error(
          initialized.error.localizedMessage ??
            initialized.error.message ??
            "Payment could not open.",
        );
      }
      const presented = await presentPaymentSheet();
      if (presented.error) {
        if (presented.error.code === "Canceled") return;
        throw new Error(
          presented.error.localizedMessage ??
            presented.error.message ??
            "Payment could not be completed.",
        );
      }
      postHogService.capture("stay_payment_completed", {
        surface: "consumer_native",
        brand_id: group.brandId,
        venue_id: group.venueId,
        group_id: group.groupId,
        provider: "stripe",
      });
      await query.refetch();
    } catch (caught) {
      postHogService.capture("stay_payment_failed", {
        surface: "consumer_native",
        brand_id: group.brandId,
        venue_id: group.venueId,
        group_id: group.groupId,
      });
      setError(
        caught instanceof Error ? caught.message : "Payment could not start.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={[styles.host, { backgroundColor: palette.page }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 },
      ]}
    >
      <Text style={[styles.eyebrow, { color: palette.accent }]}>MINGLA STAY</Text>
      <StayReservationDetail
        group={query.data ?? null}
        loading={query.isLoading}
        error={error ?? (query.isError ? "This reservation could not load." : null)}
        palette={palette}
        busy={busy}
        onRetry={() => {
          void query.refetch();
        }}
        onPay={pay}
        onCancelPreview={async (group, selectedLineIds) => {
          setBusy(true);
          setError(null);
            try {
            const preview = await stayGuestService.cancelPreview(
              group,
              selectedLineIds,
            );
            postHogService.capture("stay_cancellation_previewed", {
              surface: "consumer_native",
              brand_id: group.brandId,
              venue_id: group.venueId,
              group_id: group.groupId,
              line_count: selectedLineIds.length,
            });
            return preview;
          } catch (caught) {
            postHogService.capture("stay_cancellation_failed", {
              surface: "consumer_native",
              brand_id: group.brandId,
              venue_id: group.venueId,
              group_id: group.groupId,
              stage: "preview",
            });
            throw caught;
          } finally {
            setBusy(false);
          }
        }}
        onCancel={async (preview, reason) => {
          setBusy(true);
          setError(null);
          try {
            await stayGuestService.cancel(preview, reason);
            postHogService.capture("stay_cancellation_completed", {
              surface: "consumer_native",
              group_id: preview.groupId,
              line_count: preview.selectedLineIds.length,
            });
            await query.refetch();
          } catch (caught) {
            postHogService.capture("stay_cancellation_failed", {
              surface: "consumer_native",
              group_id: preview.groupId,
              stage: "confirm",
            });
            setError(
              caught instanceof Error
                ? caught.message
                : "Cancellation could not be completed.",
            );
          } finally {
            setBusy(false);
          }
        }}
      />
      {query.isFetching && !query.isLoading ? (
        <ActivityIndicator color={palette.accent} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  content: { paddingHorizontal: 18, gap: 16 },
  eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 1.4 },
  invalid: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0c0e12",
  },
  invalidTitle: { color: "#ffffff", fontSize: 20, fontWeight: "800" },
});
