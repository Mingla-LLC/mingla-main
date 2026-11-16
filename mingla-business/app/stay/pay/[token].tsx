/**
 * /stay/pay/{token} — the staff-made Stay's secure payment link.
 *
 * issue #4420 wave 2 (spec §3.3.4) — the page wears the host's colours, the
 * same palette as the Stay's public page (`createThemePalette(resolveTheme(
 * brand.theme))`):
 *
 *   - a "Payment needed" warning pill, the Stay's name in the host face, the
 *     brand and reference;
 *   - a summary card: the lines, the total at 22/800, "Link expires …";
 *   - the Payment Element (host accent, stripe / night by page brightness);
 *   - the glass bar "Pay {total}" (phone and desktop alike);
 *   - expired / not found / not actionable: an error hero with Try again.
 *
 * The hosted page (Paystack) opens in THIS tab through the Secure payment
 * step (§2.4), never `Linking.openURL` from an awaited callback (popup
 * blockers stop it silently on web).
 *
 * The host's colours need the brand: the page reads `details.brandSlug` when
 * the link's details carry it, and stays on the Mingla default palette
 * otherwise (never a guessed colour).
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  createThemePalette,
  resolveTheme,
  type ThemePalette,
} from "@mingla/offering-rendering";
import {
  boldFontFamily,
  neutralHair,
  statusOn,
  themeTextAccent,
} from "@mingla/offering-rendering/themePalette";
import { themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import { OfferingGlassBar } from "@mingla/offering-rendering/OfferingGlassBar";
import { formatStayMoney } from "@mingla/brand-rendering/stayGuest";
import type { StayPaymentSession } from "@mingla/brand-rendering/stayGuest";

import { StayStripePayment } from "../../../src/components/stay/StayStripePayment";
import { SecurePaymentHandoff } from "../../../src/components/offering/LazyPublicParts";
import {
  stayStaffPaymentLinkService,
  type StayStaffPaymentLinkDetails,
} from "../../../src/services/stayStaffPaymentLinkService";
import { usePublicBrandIdentity } from "../../../src/hooks/usePublicBrandEnquiry";
import { useThemeFont } from "../../../src/theme/useThemeFont";
import { randomId } from "../../../src/utils/randomId";
import { ScrollView } from "../../../src/wrappers/SmartScrollView";
import { Button } from "../../../src/components/ui/Button";
import { Icon } from "../../../src/components/ui/Icon";

function errorCopy(value: unknown): string {
  const message = value instanceof Error ? value.message : "";
  if (message.includes("expired"))
    return "This secure payment link has expired. Ask the property for a new link.";
  if (message.includes("not_found"))
    return "This secure payment link is no longer available.";
  if (message.includes("not_actionable"))
    return "This reservation can no longer be paid from this link.";
  return "This payment link could not load. Try again or contact the property.";
}

const BAR_CLEARANCE = 68 + 24;

export default function StayStaffPaymentLinkRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const tokenParam = Array.isArray(params.token)
    ? params.token[0]
    : params.token;
  const token = typeof tokenParam === "string" ? tokenParam : "";
  const [details, setDetails] = useState<StayStaffPaymentLinkDetails | null>(
    null,
  );
  const [session, setSession] = useState<StayPaymentSession | null>(null);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The host's palette (Mingla default until the brand is known).
  const brandQuery = usePublicBrandIdentity(details?.brandSlug ?? null);
  const brandTheme = brandQuery.data?.theme ?? null;
  const theme = useMemo(() => resolveTheme(brandTheme, null), [brandTheme]);
  const palette: ThemePalette = useMemo(() => createThemePalette(theme), [theme]);
  useThemeFont(boldFontFamily(theme));
  const status = statusOn(palette);
  const hair = neutralHair(palette);

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
        // #4420 §2.4 — this tab, through the Secure payment step.
        setHandoffUrl(next.authorizationUrl);
      } else {
        setSession(next);
      }
    } catch (caught) {
      setError(errorCopy(caught));
    } finally {
      setPaying(false);
    }
  };

  const returnUrl =
    Platform.OS === "web" && typeof window !== "undefined"
      ? `${window.location.origin}/stay/pay/${encodeURIComponent(token)}?payment=returned`
      : undefined;

  const totalLabel =
    details === null ? null : formatStayMoney(details.totalMinor, details.currencyCode);
  const showBar =
    details !== null &&
    !details.paid &&
    session === null &&
    handoffUrl === null &&
    totalLabel !== null;

  let body: React.ReactNode;
  if (loading) {
    body = (
      <View style={styles.center} accessibilityRole="progressbar">
        <ActivityIndicator color={palette.primaryText} />
        <Text style={[styles.helper, { color: palette.secondaryText }]}>
          Opening your secure reservation…
        </Text>
      </View>
    );
  } else if (details === null) {
    body = (
      <View style={styles.hero} testID="stay-pay-link-error">
        <View style={[styles.heroDisc, { backgroundColor: status.error.tint }]}>
          <Icon name="x" size={30} color={status.error.text} />
        </View>
        <Text
          style={[styles.heroTitle, themeBoldFace(theme), { color: palette.primaryText }]}
          accessibilityRole="header"
        >
          Payment link unavailable
        </Text>
        {error !== null ? (
          <Text
            style={[styles.heroBody, { color: palette.secondaryText }]}
            accessibilityRole="alert"
          >
            {error}
          </Text>
        ) : null}
        <Button
          label="Try again"
          onPress={() => void load()}
          variant="secondary"
          size="md"
        />
      </View>
    );
  } else if (handoffUrl !== null) {
    body = (
      <SecurePaymentHandoff
        url={handoffUrl}
        palette={palette}
        holdLine="Your rooms are held while you pay."
        onBack={() => setHandoffUrl(null)}
        testID="issue-4420-stay-pay-link-secure-payment"
      />
    );
  } else {
    const paid = details.paid;
    body = (
      <>
        <View style={styles.status}>
          <View
            style={[
              styles.pill,
              { backgroundColor: paid ? status.success.tint : status.warning.tint },
            ]}
            testID="stay-pay-link-status"
          >
            <View
              style={[
                styles.pillDot,
                { backgroundColor: paid ? status.success.text : status.warning.text },
              ]}
            />
            <Text
              style={[
                styles.pillLabel,
                { color: paid ? status.success.text : status.warning.text },
              ]}
            >
              {paid ? "Confirmed" : "Payment needed"}
            </Text>
          </View>
          <Text
            style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]}
            accessibilityRole="header"
          >
            {details.venueName}
          </Text>
          <Text style={[styles.helper, { color: palette.secondaryText }]}>
            {paid
              ? "Payment received. Your Stay reservation is confirmed."
              : `${details.brandName} · Reservation ${details.publicReference}. Pay to confirm it.`}
          </Text>
        </View>
        <View
          style={[styles.card, { backgroundColor: palette.card, borderColor: hair }]}
          testID="stay-pay-link-summary"
        >
          {details.lines.map((line, index) => (
            <View key={`${line.name}-${index}`} style={styles.line}>
              <View style={styles.flexOne}>
                <Text style={[styles.lineTitle, { color: palette.primaryText }]}>
                  {line.name}
                </Text>
                <Text style={[styles.helper, { color: palette.secondaryText }]}>
                  {line.kind === "room"
                    ? `${line.roomCheckIn ?? ""} → ${line.roomCheckOut ?? ""}`
                    : `${line.placeGuests ?? 0} guests`}
                </Text>
              </View>
              <Text style={[styles.amount, { color: palette.primaryText }]}>
                {formatStayMoney(line.totalMinor, details.currencyCode)}
              </Text>
            </View>
          ))}
          <View style={[styles.totalRow, { borderTopColor: hair }]}>
            <Text style={[styles.totalLabel, { color: palette.primaryText }]}>
              {paid ? "Paid" : "Total"}
            </Text>
            <Text style={[styles.total, { color: palette.primaryText }]}>{totalLabel}</Text>
          </View>
          {paid ? null : (
            <View style={styles.expiryRow}>
              <Icon name="clock" size={14} color={palette.tertiaryText} />
              <Text style={[styles.expiry, { color: palette.tertiaryText }]}>
                Link expires {new Date(details.expiresAt).toLocaleString()}.
              </Text>
            </View>
          )}
        </View>
        {session?.provider === "stripe" ? (
          <View style={[styles.card, { backgroundColor: palette.card, borderColor: hair }]}>
            <StayStripePayment
              session={session}
              groupId={details.groupId}
              accent={palette.accent}
              palette={palette}
              returnUrl={returnUrl}
              onComplete={() => {
                setSession(null);
                void load();
              }}
            />
          </View>
        ) : null}
        {error !== null ? (
          <View
            style={[
              styles.banner,
              { backgroundColor: status.error.tint, borderColor: status.error.line },
            ]}
            accessibilityRole="alert"
          >
            <Text style={[styles.bannerText, { color: status.error.text }]}>{error}</Text>
          </View>
        ) : null}
      </>
    );
  }

  return (
    <View style={[styles.host, { backgroundColor: palette.page }]}>
      <ScrollView
        style={styles.host}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 40,
            paddingBottom: insets.bottom + (showBar ? BAR_CLEARANCE + 24 : 40),
          },
        ]}
      >
        <Text style={[styles.eyebrow, { color: themeTextAccent(palette) }]}>
          MINGLA STAY
        </Text>
        {body}
      </ScrollView>
      {showBar && totalLabel !== null ? (
        <View
          style={[styles.barDock, { paddingBottom: insets.bottom + 12 }]}
          pointerEvents="box-none"
        >
          <OfferingGlassBar
            palette={palette}
            theme={theme}
            title={totalLabel}
            subtitle="Total · taxes and fees included"
            ctaLabel={paying ? "Starting…" : `Pay ${totalLabel}`}
            onPress={() => void pay()}
            enabled={!paying}
            ctaAccessibilityLabel={`Pay ${totalLabel}`}
            style={styles.bar}
            testID="stay-pay-link-bar"
            actionTestID="stay-staff-link-pay"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: 620,
    alignSelf: "center",
    paddingHorizontal: 24,
    gap: 16,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  center: { alignItems: "center", gap: 12, paddingVertical: 40 },
  status: { gap: 10 },
  pill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pillDot: { width: 7, height: 7, borderRadius: 999 },
  pillLabel: { fontSize: 13, fontWeight: "700" },
  title: { fontSize: 30, lineHeight: 34, fontWeight: "800" },
  helper: { fontSize: 14, lineHeight: 20 },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  line: { flexDirection: "row", gap: 16, alignItems: "flex-start" },
  flexOne: { flex: 1, minWidth: 0 },
  lineTitle: { fontSize: 15, fontWeight: "700" },
  amount: { fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"] },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 12,
    borderTopWidth: 1,
  },
  totalLabel: { fontSize: 16, fontWeight: "700" },
  total: { fontSize: 22, fontWeight: "800", fontVariant: ["tabular-nums"] },
  expiryRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  expiry: { fontSize: 12.5 },
  hero: { alignItems: "center", gap: 12, paddingVertical: 24 },
  heroDisc: {
    width: 72,
    height: 72,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: { fontSize: 30, lineHeight: 34, fontWeight: "800", textAlign: "center" },
  heroBody: { fontSize: 15, lineHeight: 22, textAlign: "center", maxWidth: 380 },
  banner: { borderRadius: 16, borderWidth: 1, padding: 14 },
  bannerText: { fontSize: 14, lineHeight: 20 },
  barDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
  },
  bar: { width: "100%", maxWidth: 620, alignSelf: "center" },
});
