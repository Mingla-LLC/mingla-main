/**
 * #2879 / #2947 slice 3 — waiting-room screen (buyer web).
 *
 * Reached when ticket-checkout-create answers kind:"queued". Polls status
 * with the device token until admitted (live hold clock) or a terminal
 * release. Restores cart from the checkout resume payload on refresh.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  accent,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import {
  useCart,
  useCartQuoteTotals,
} from "../../../src/components/checkout/CartContext";
import {
  readCheckoutResumePayload,
} from "../../../src/components/checkout/checkoutPersistence";
import {
  getTicketCheckoutStatus,
} from "../../../src/services/ticketCheckoutService";
import {
  getOrCreateQueueDeviceToken,
} from "../../../src/services/queueDeviceToken";

const POLL_MS = 4000;

function formatWait(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
    return "a few minutes";
  }
  if (seconds < 60) return "under a minute";
  const mins = Math.ceil(seconds / 60);
  if (mins === 1) return "about 1 minute";
  if (mins < 60) return `about ${mins} minutes`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (rem === 0) return hours === 1 ? "about 1 hour" : `about ${hours} hours`;
  return `about ${hours}h ${rem}m`;
}

export default function CheckoutQueueScreen(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    eventId: string;
    ahead?: string;
    wait?: string;
    gettingOne?: string;
  }>();
  const eventId = typeof params.eventId === "string" ? params.eventId : "";
  const {
    lines,
    setLineQuantity,
    setBuyer,
    setEventDateIds,
  } = useCart();
  const totals = useCartQuoteTotals();

  const [restoreChecked, setRestoreChecked] = useState(false);
  const [terminalMessage, setTerminalMessage] = useState<string | null>(null);

  const storage = Platform.OS === "web"
    ? (globalThis as unknown as { sessionStorage?: Storage }).sessionStorage
    : undefined;

  // Restore cart + buyer from the resume payload before polling (refresh path).
  useEffect(() => {
    if (Platform.OS !== "web" || !eventId || restoreChecked) return;
    const payload = readCheckoutResumePayload(storage, eventId);
    if (payload !== null && lines.length === 0) {
      for (const l of payload.lines) {
        setLineQuantity({
          ticketTypeId: l.ticketTypeId,
          ticketName: l.ticketName,
          unitPrice: l.unitPrice,
          unitPriceGbp: l.unitPriceGbp,
          currency: l.currency,
          isFree: l.isFree,
          quantity: l.quantity,
        });
      }
      setBuyer(payload.buyer);
      if (payload.eventDateIds && payload.eventDateIds.length > 0) {
        setEventDateIds(payload.eventDateIds);
      }
    }
    setRestoreChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, [eventId]);

  const ticketTypeId = lines[0]?.ticketTypeId ?? "";
  const queueDeviceToken = useMemo(
    () =>
      Platform.OS === "web" && ticketTypeId
        ? getOrCreateQueueDeviceToken(ticketTypeId)
        : null,
    [ticketTypeId],
  );

  const resume = eventId ? readCheckoutResumePayload(storage, eventId) : null;
  const checkoutSessionId = resume?.checkoutSessionId ?? "";
  const buyerStatusToken = resume?.buyerStatusToken ?? "";

  const [aheadOfYou, setAheadOfYou] = useState<number | null>(() => {
    const n = Number(params.ahead);
    return Number.isFinite(n) ? n : null;
  });
  const [gettingOne, setGettingOne] = useState<boolean | null>(() => {
    if (params.gettingOne === "1") return true;
    if (params.gettingOne === "0") return false;
    return null;
  });
  const [estimatedWait] = useState(() => formatWait(Number(params.wait)));
  const [statusLine, setStatusLine] = useState(() => {
    const n = Number(params.ahead);
    if (!Number.isFinite(n)) return "Holding your place…";
    return n === 0 ? "You're next" : `${n} ahead of you`;
  });
  const admittedNav = useRef(false);

  const onAdmitted = useCallback(() => {
    if (admittedNav.current) return;
    admittedNav.current = true;
    if (totals.isFree) {
      router.replace(`/checkout/${eventId}/buyer` as never);
    } else {
      router.replace(`/checkout/${eventId}/payment` as never);
    }
  }, [eventId, router, totals.isFree]);

  useEffect(() => {
    if (
      Platform.OS !== "web" ||
      !restoreChecked ||
      !checkoutSessionId ||
      !buyerStatusToken ||
      !queueDeviceToken ||
      terminalMessage !== null
    ) {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const status = await getTicketCheckoutStatus(
          checkoutSessionId,
          buyerStatusToken,
          { queueDeviceToken },
        );
        if (cancelled) return;
        if (status.order != null) {
          router.replace(`/checkout/${eventId}/confirm` as never);
          return;
        }
        if (status.queueReleased === true) {
          setTerminalMessage(
            "Your hold was released — the organiser reduced capacity or your place expired. You have not been charged.",
          );
          admittedNav.current = true;
          router.replace(`/checkout/${eventId}/waitlist` as never);
          return;
        }
        // Live hold only: positive remaining seconds (0 = expired).
        if (
          status.queueAdmitted === true &&
          typeof status.holdSecondsRemaining === "number" &&
          status.holdSecondsRemaining > 0
        ) {
          onAdmitted();
          return;
        }
        if (
          status.queueAdmitted === true &&
          status.holdSecondsRemaining === 0
        ) {
          setTerminalMessage(
            "Your turn expired before checkout finished. You have not been charged — please try again.",
          );
          return;
        }
        if (typeof status.aheadOfYou === "number") {
          setAheadOfYou(status.aheadOfYou);
          setStatusLine(
            status.aheadOfYou === 0
              ? "You're next"
              : `${status.aheadOfYou} ahead of you`,
          );
        }
        if (typeof status.gettingOne === "boolean") {
          setGettingOne(status.gettingOne);
        }
      } catch (error) {
        const code =
          typeof (error as { code?: unknown })?.code === "string"
            ? (error as { code: string }).code
            : "";
        const status =
          typeof (error as { status?: unknown })?.status === "number"
            ? (error as { status: number }).status
            : null;
        // Permanent refusals — stop polling.
        if (
          status === 403 ||
          status === 404 ||
          code === "buyer_status_token_invalid" ||
          code === "checkout_session_not_found" ||
          code === "checkout_unavailable"
        ) {
          setTerminalMessage(
            "We could not keep your place in the waiting room. You have not been charged — please start checkout again.",
          );
        }
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [
    buyerStatusToken,
    checkoutSessionId,
    eventId,
    onAdmitted,
    queueDeviceToken,
    restoreChecked,
    router,
    terminalMessage,
  ]);

  void aheadOfYou;

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom },
      ]}
    >
      <Text style={styles.eyebrow}>Waiting room</Text>
      <Text style={styles.title}>
        {terminalMessage ? "Place ended" : statusLine}
      </Text>
      {terminalMessage ? (
        <Text style={styles.body}>{terminalMessage}</Text>
      ) : (
        <>
          <Text style={styles.body}>
            Estimated wait: {estimatedWait}. Keep this tab open on this device.
            Your place is saved on this phone. If you clear your browser data or
            switch to another phone, you lose your place and start again. We will
            email you when it is your turn.
          </Text>
          {gettingOne === true ? (
            <Text style={styles.promise}>
              You're getting one — tickets are already held for people ahead of
              you, and there is still stock for your cart.
            </Text>
          ) : null}
          {gettingOne === false ? (
            <Text style={styles.warn}>
              Stock is tight. Stay in line — if tickets run out before your turn,
              we'll offer the waitlist instead of a false promise.
            </Text>
          ) : null}
          <View style={styles.spinnerRow}>
            <ActivityIndicator color={accent.warm} />
            <Text style={styles.spinnerLabel}>Checking your place…</Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0c0e12",
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  eyebrow: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    textTransform: "uppercase",
  },
  title: {
    ...typography.h2,
    color: textTokens.primary,
  },
  body: {
    ...typography.body,
    color: textTokens.secondary,
  },
  promise: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "600",
  },
  warn: {
    ...typography.body,
    color: textTokens.secondary,
  },
  spinnerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  spinnerLabel: {
    ...typography.caption,
    color: textTokens.secondary,
  },
});
