import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { formatStayMoney } from "@mingla/brand-rendering/stayGuest";
import type { StayPaymentSession } from "@mingla/brand-rendering/stayGuest";

import { StayStripePayment } from "../../../src/components/stay/StayStripePayment";
import {
  stayStaffPaymentLinkService,
  type StayStaffPaymentLinkDetails,
} from "../../../src/services/stayStaffPaymentLinkService";
import { randomId } from "../../../src/utils/randomId";
import { ScrollView } from "../../../src/wrappers/SmartScrollView";
import { Button } from "../../../src/components/ui/Button";

function errorCopy(value: unknown): string {
  const message = value instanceof Error ? value.message : "";
  if (message.includes("expired")) return "This secure payment link has expired. Ask the property for a new link.";
  if (message.includes("not_found")) return "This secure payment link is no longer available.";
  if (message.includes("not_actionable")) return "This reservation can no longer be paid from this link.";
  return "This payment link could not load. Try again or contact the property.";
}

export default function StayStaffPaymentLinkRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const tokenParam = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = typeof tokenParam === "string" ? tokenParam : "";
  const [details, setDetails] = useState<StayStaffPaymentLinkDetails | null>(null);
  const [session, setSession] = useState<StayPaymentSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setDetails(await stayStaffPaymentLinkService.view(token));
    } catch (caught) {
      setError(errorCopy(caught));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const pay = async (): Promise<void> => {
    if (!details || paying) return;
    setPaying(true);
    setError(null);
    try {
      const next = await stayStaffPaymentLinkService.pay({
        token,
        expectedVersion: details.version,
        idempotencyKey: `stay:staff-link:pay:${randomId()}`,
      });
      if (next.provider === "paystack") {
        await Linking.openURL(next.authorizationUrl);
      } else {
        setSession(next);
      }
    } catch (caught) {
      setError(errorCopy(caught));
    } finally {
      setPaying(false);
    }
  };

  const returnUrl = Platform.OS === "web" && typeof window !== "undefined"
    ? `${window.location.origin}/stay/pay/${encodeURIComponent(token)}?payment=returned`
    : undefined;

  return (
    <ScrollView style={styles.host} contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>MINGLA STAY</Text>
      <View style={styles.card}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#eb7825" />
            <Text style={styles.helper}>Opening your secure reservation…</Text>
          </View>
        ) : details ? (
          <>
            <Text style={styles.title}>{details.venueName}</Text>
            <Text style={styles.helper}>{details.brandName} · Reservation {details.publicReference}</Text>
            <View style={styles.divider} />
            {details.lines.map((line, index) => (
              <View key={`${line.name}-${index}`} style={styles.line}>
                <View style={styles.flexOne}>
                  <Text style={styles.lineTitle}>{line.name}</Text>
                  <Text style={styles.helper}>
                    {line.kind === "room"
                      ? `${line.roomCheckIn ?? ""} → ${line.roomCheckOut ?? ""}`
                      : `${line.placeGuests ?? 0} guests`}
                  </Text>
                </View>
                <Text style={styles.amount}>{formatStayMoney(line.totalMinor, details.currencyCode)}</Text>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.total}>{formatStayMoney(details.totalMinor, details.currencyCode)}</Text>
            </View>
            {details.paid ? (
              <View style={styles.success}>
                <Text style={styles.successTitle}>Payment received</Text>
                <Text style={styles.helper}>Your Stay reservation is confirmed.</Text>
              </View>
            ) : session?.provider === "stripe" ? (
              <StayStripePayment
                session={session}
                groupId={details.groupId}
                accent="#eb7825"
                returnUrl={returnUrl}
                onComplete={() => {
                  setSession(null);
                  void load();
                }}
              />
            ) : (
              <Button
                label={paying ? "Starting secure payment…" : `Pay ${formatStayMoney(details.totalMinor, details.currencyCode)}`}
                onPress={() => void pay()}
                variant="primary"
                size="lg"
                fullWidth
                loading={paying}
                disabled={paying}
                testID="stay-staff-link-pay"
              />
            )}
            <Text style={styles.expiry}>Link expires {new Date(details.expiresAt).toLocaleString()}.</Text>
          </>
        ) : (
          <View style={styles.center}>
            <Text style={styles.title}>Payment link unavailable</Text>
            <Button label="Try again" onPress={() => void load()} variant="secondary" size="md" />
          </View>
        )}
        {error ? (
          <Text accessibilityLiveRegion="polite" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: "#0c0e12" },
  content: { width: "100%", maxWidth: 720, alignSelf: "center", padding: 24, paddingTop: 64, gap: 14 },
  eyebrow: { color: "#eb7825", fontSize: 12, fontWeight: "900", letterSpacing: 1.4 },
  card: { backgroundColor: "#171a21", borderRadius: 24, padding: 24, gap: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  center: { alignItems: "center", gap: 12, paddingVertical: 28 },
  title: { color: "#fff", fontSize: 26, fontWeight: "800" },
  helper: { color: "#aeb4c0", fontSize: 14, lineHeight: 20 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(255,255,255,0.12)" },
  line: { flexDirection: "row", gap: 16, alignItems: "flex-start" },
  flexOne: { flex: 1, minWidth: 0 },
  lineTitle: { color: "#fff", fontSize: 15, fontWeight: "700" },
  amount: { color: "#fff", fontSize: 14, fontWeight: "700" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 8 },
  totalLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },
  total: { color: "#fff", fontSize: 22, fontWeight: "900" },
  success: { padding: 16, borderRadius: 16, backgroundColor: "rgba(34,197,94,0.12)", gap: 4 },
  successTitle: { color: "#4ade80", fontSize: 16, fontWeight: "800" },
  expiry: { color: "#7f8795", fontSize: 12, textAlign: "center" },
  error: { color: "#fb7185", fontSize: 13, lineHeight: 18 },
});

