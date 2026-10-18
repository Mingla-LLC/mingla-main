/**
 * #2879 / #2947 slice 3 — waiting-room screen (buyer web).
 *
 * Reached when ticket-checkout-create answers kind:"queued". Polls status
 * with the device token until admitted (hold clock started). Copy contract:
 * place is device-local; clearing data / switching phones loses the place.
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
import { useCart } from "../../../src/components/checkout/CartContext";
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
  const { lines, totals, result: cartResult } = useCart();

  const ticketTypeId = lines[0]?.ticketTypeId ?? "";
  const queueDeviceToken = useMemo(
    () =>
      Platform.OS === "web"
        ? getOrCreateQueueDeviceToken(ticketTypeId)
        : null,
    [ticketTypeId],
  );

  const storage = Platform.OS === "web"
    ? (globalThis as unknown as { sessionStorage?: Storage }).sessionStorage
    : undefined;
  const resume = eventId ? readCheckoutResumePayload(storage, eventId) : null;
  const checkoutSessionId =
    cartResult?.checkoutSessionId ?? resume?.checkoutSessionId ?? "";
  const buyerStatusToken =
    cartResult?.buyerStatusToken ?? resume?.buyerStatusToken ?? "";

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
      !checkoutSessionId ||
      !buyerStatusToken ||
      !queueDeviceToken
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
        if (typeof status.holdSecondsRemaining === "number") {
          onAdmitted();
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
      } catch {
        // Keep polling — transient status failures must not eject the guest.
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
    router,
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
      <Text style={styles.title}>{statusLine}</Text>
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
