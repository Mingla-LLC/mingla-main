// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StayReservationDetail } from "@mingla/brand-rendering/StayReservationDetail";
import {
  type StayPaymentSession,
} from "@mingla/brand-rendering/stayGuest";
import { formatStayMoney } from "@mingla/brand-rendering/stayGuestMoney";
import {
  createThemePalette,
  resolveTheme,
} from "@mingla/offering-rendering";

import { captureWeb } from "../../src/analytics/webAnalytics";
import { StayStripePayment } from "../../src/components/stay/StayStripePayment";
import { useStayReservationGroup } from "../../src/hooks/useStayGuest";
import { stayGuestService } from "../../src/services/stayGuestService";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function StayReservationRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ groupId?: string | string[] }>();
  const raw = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId;
  const groupId = typeof raw === "string" && UUID.test(raw) ? raw : null;
  const query = useStayReservationGroup(groupId);
  const theme = useMemo(() => resolveTheme(null, null), []);
  const palette = useMemo(() => createThemePalette(theme), [theme]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<StayPaymentSession | null>(null);
  const groupViewFired = useRef(false);

  useEffect(() => {
    const group = query.data;
    if (!group || groupViewFired.current) return;
    groupViewFired.current = true;
    captureWeb("stay_group_viewed", {
      surface: "buyer_web",
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
      const session = await stayGuestService.createPayment(group);
      captureWeb("stay_payment_started", {
        surface: "buyer_web",
        brand_id: group.brandId,
        venue_id: group.venueId,
        group_id: group.groupId,
        provider: session.provider,
      });
      if (session.provider === "paystack") {
        await Linking.openURL(session.authorizationUrl);
      } else {
        setPayment(session);
      }
    } catch (caught) {
      captureWeb("stay_payment_failed", {
        surface: "buyer_web",
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
      {payment?.provider === "stripe" && query.data ? (
        <View style={[styles.payment, { backgroundColor: palette.card }]}>
          <Text style={[styles.paymentTitle, { color: palette.primaryText }]}>
            Pay {formatStayMoney(payment.amountMinor, payment.currencyCode)}
          </Text>
          <StayStripePayment
            session={payment}
            groupId={query.data.groupId}
            accent={palette.accent}
            onComplete={() => {
              captureWeb("stay_payment_completed", {
                surface: "buyer_web",
                brand_id: query.data?.brandId ?? null,
                venue_id: query.data?.venueId ?? null,
                group_id: query.data?.groupId ?? groupId,
                provider: "stripe",
              });
              setPayment(null);
              void query.refetch();
            }}
          />
        </View>
      ) : (
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
              captureWeb("stay_cancellation_previewed", {
                surface: "buyer_web",
                brand_id: group.brandId,
                venue_id: group.venueId,
                group_id: group.groupId,
                line_count: selectedLineIds.length,
              });
              return preview;
            } catch (caught) {
              captureWeb("stay_cancellation_failed", {
                surface: "buyer_web",
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
              captureWeb("stay_cancellation_completed", {
                surface: "buyer_web",
                group_id: preview.groupId,
                line_count: preview.selectedLineIds.length,
              });
              await query.refetch();
            } catch (caught) {
              captureWeb("stay_cancellation_failed", {
                surface: "buyer_web",
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
      )}
      {query.isFetching && !query.isLoading ? (
        <ActivityIndicator color={palette.accent} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  content: { width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: 18, gap: 16 },
  eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 1.4 },
  payment: { padding: 20, borderRadius: 18, gap: 16 },
  paymentTitle: { fontSize: 24, lineHeight: 30, fontWeight: "900" },
  invalid: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0c0e12",
  },
  invalidTitle: { color: "#ffffff", fontSize: 20, fontWeight: "800" },
});
