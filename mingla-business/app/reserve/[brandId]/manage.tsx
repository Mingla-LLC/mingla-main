/**
 * Guest reservation manage page — reached ONLY through a private link whose
 * reservation id + token ride in the URL fragment (scrubbed from history on
 * arrival, #1221). No sign-in.
 *
 * #3392 — this page used to ask for the refund alone, and the refund lookup
 * refuses any booking that has no refund. Every free booking (and every paid
 * one before a refund) therefore opened to "We couldn't open this
 * reservation." It also set no colours, so its text rendered in the platform
 * default, and after cancelling a free booking it kept offering "Cancel
 * reservation". It now loads the booking itself, shows its state in Mingla's
 * dark palette, and only offers Cancel while the booking can be cancelled.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  cancelGuestVenueReservation,
  fetchGuestReservationManage,
  type GuestVenueRefundSummary,
} from "../../../src/services/venueGuestReservationService";
import { SafeScreen } from "../../../src/components/ui/SafeScreen";
import { Button } from "../../../src/components/ui/Button";
import {
  canvas,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import { formatCurrency } from "../../../src/utils/currency";
import {
  guestManageErrorCode,
  guestManageHeadline,
  guestManageMoneyLine,
  type GuestManageReservation,
} from "../../../src/utils/guestReservationManage";

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

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const CANCEL_NOT_ALLOWED_COPY =
  "This reservation can no longer be cancelled here. Contact the venue if you need help.";
const CANCEL_FAILED_COPY =
  "We couldn’t cancel it. Check your connection and try again.";

export default function GuestReservationManageRoute() {
  const [credentials] = useState(fragmentCredentials);
  const [reservation, setReservation] =
    useState<GuestManageReservation | null>(null);
  const [refund, setRefund] = useState<GuestVenueRefundSummary | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const load = useCallback(
    async (showSpinner = true): Promise<void> => {
      if (!credentials.reservationId || !credentials.token) {
        setState("error");
        return;
      }
      if (showSpinner) setState("loading");
      try {
        const result = await fetchGuestReservationManage({
          reservationId: credentials.reservationId,
          guestToken: credentials.token,
        });
        if (result.reservation === null) {
          setState("error");
          return;
        }
        setReservation(result.reservation);
        setRefund(result.refund);
        setState("ready");
      } catch {
        setState("error");
      }
    },
    [credentials],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const handleCancel = useCallback(async (): Promise<void> => {
    if (!confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    setCancelling(true);
    setCancelError(null);
    try {
      const result = await cancelGuestVenueReservation({
        reservationId: credentials.reservationId,
        guestToken: credentials.token,
      });
      setRefund(result.refund);
      await load(false);
    } catch (error) {
      const code = await guestManageErrorCode(error);
      setCancelError(
        code === "cancel_not_allowed"
          ? CANCEL_NOT_ALLOWED_COPY
          : CANCEL_FAILED_COPY,
      );
      if (code === "cancel_not_allowed") void load(false);
    } finally {
      setCancelling(false);
      setConfirmCancel(false);
    }
  }, [confirmCancel, credentials, load]);

  if (state === "loading") {
    return (
      <SafeScreen edges={["top", "bottom"]} style={styles.host}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          <ActivityIndicator color={textTokens.secondary} />
          <Text style={styles.body}>Loading reservation…</Text>
        </ScrollView>
      </SafeScreen>
    );
  }
  if (state === "error" || reservation === null) {
    return (
      <SafeScreen edges={["top", "bottom"]} style={styles.host}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
        >
          <Text style={styles.title}>We couldn’t open this reservation.</Text>
          <Text style={styles.body}>
            Check you opened the full link from your confirmation, then try
            again.
          </Text>
          <Button
            label="Try again"
            variant="secondary"
            size="md"
            accessibilityLabel="Try again"
            onPress={() => void load()}
            testID="guest-manage-retry"
          />
        </ScrollView>
      </SafeScreen>
    );
  }

  const moneyLine = guestManageMoneyLine(reservation, refund);
  const when = formatWhen(reservation.reservedForUtc);
  return (
    <SafeScreen edges={["top", "bottom"]} style={styles.host}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <Text style={styles.eyebrow}>Manage reservation</Text>
        <Text style={styles.title} testID="guest-manage-headline">
          {guestManageHeadline(reservation)}
        </Text>
        <View style={styles.card}>
          {reservation.venueName !== null ? (
            <Text style={styles.cardTitle}>{reservation.venueName}</Text>
          ) : null}
          {when.length > 0 ? <Text style={styles.body}>{when}</Text> : null}
          <Text style={styles.body}>
            Party of {reservation.partySize}
          </Text>
        </View>
        {moneyLine !== null ? (
          <Text style={styles.body} testID="guest-manage-money">
            {moneyLine}
          </Text>
        ) : null}
        {refund ? (
          <Text style={styles.body}>
            {formatCurrency(refund.amount_cents, refund.currency, true)}
          </Text>
        ) : null}
        {refund?.buyer_state === "needs_attention"
          ? (
            refund.attentionDeliveryState === "parked"
              ? (
                <Text style={styles.body}>
                  We couldn&apos;t confirm your text was sent. Contact Mingla
                  Support and reference this refund: {refund.refund_id}
                </Text>
              )
              : (
                <Text style={styles.body}>
                  Use the secure refund link sent to your email or phone.
                  Reservation management links cannot submit bank details.
                </Text>
              )
          )
          : null}
        {refund ? (
          <Button
            label="Refresh"
            variant="secondary"
            size="md"
            accessibilityLabel="Refresh refund status"
            onPress={() => void load(false)}
            testID="guest-manage-refresh"
          />
        ) : null}
        {reservation.canCancel && !refund ? (
          <Button
            label={
              cancelling
                ? "Cancelling…"
                : confirmCancel
                ? "Tap again to cancel"
                : "Cancel reservation"
            }
            variant="destructive"
            size="md"
            accessibilityLabel={
              confirmCancel ? "Confirm cancel reservation" : "Cancel reservation"
            }
            disabled={cancelling}
            loading={cancelling}
            onPress={() => void handleCancel()}
            testID="guest-manage-cancel"
          />
        ) : null}
        {cancelError !== null ? (
          <Text style={styles.error} testID="guest-manage-cancel-error">
            {cancelError}
          </Text>
        ) : null}
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  // #2211 — `host` keeps only the frame; centring lives in `scrollContent`.
  // #3392 — the frame paints Mingla's dark canvas so every text token below
  // is legible (the page used to set no colours at all).
  host: { flex: 1, backgroundColor: canvas.discover },
  scroll: { flex: 1, overflow: "hidden" },
  // #2211 — EXPLICIT flexGrow (RN defaults content containers to 0).
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  eyebrow: {
    ...typography.caption,
    color: textTokens.tertiary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  title: { ...typography.h2, color: textTokens.primary },
  body: { ...typography.body, color: textTokens.secondary },
  card: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  cardTitle: { ...typography.bodyLg, color: textTokens.primary },
  error: { ...typography.bodySm, color: semantic.errorText },
});
