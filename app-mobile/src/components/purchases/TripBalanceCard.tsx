import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import {
  formatTripBalanceMoney,
  supportsBalancePayments,
  tripBalanceBelowProviderMinimum,
  tripBalanceOverpaymentLines,
  tripBalanceSmallRemainderCopy,
} from "@mingla/offering-rendering/tripBalance";

import { useTripBalance } from "../../hooks/useTripBalance";
import { TripBalancePayError } from "../../services/tripBalancePayService";

/**
 * issue #4522 S-16 — the shared balance money rule (a whole amount has no
 * decimals), in the locale Explorer's purchase money uses.
 */
export const balanceMoney = (minor: number, currency: string): string =>
  formatTripBalanceMoney(minor, currency, "en-GB");
const money = balanceMoney;

const date = (value: string): string => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
      .format(parsed);
};

export function TripBalanceCard(
  { orderId }: { orderId: string },
): React.ReactElement {
  const router = useRouter();
  const query = useTripBalance(orderId);
  const balance = query.data?.balance ?? null;
  // issue #4522 (N6) — the card follows what the server says this order
  // supports: an older instalment plan keeps the purchase screen exactly as
  // before (no card, no flexible actions), and so does a server that has no
  // balance endpoint yet (the app can ship before the migrations).
  if (query.isError && isBalanceUnavailable(query.error)) return null;
  if (balance !== null && !supportsBalancePayments(balance)) return null;
  // issue #4522 rework 9 (T8-6, I-4522-NEVER-WRITE-OFF) — a balance below
  // what the provider can charge stays owed: the balance screen's line, no
  // next payment and nothing to pay.
  const tooSmall = balance !== null && tripBalanceBelowProviderMinimum(balance);
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>BALANCE</Text>
      {query.isLoading
        ? (
          <View
            accessibilityLabel="Loading trip balance"
            style={styles.loading}
          >
            <ActivityIndicator color="#eb7825" />
            <View style={styles.skeleton} />
          </View>
        )
        : query.isError
        ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading your balance"
            onPress={() => void query.refetch()}
          >
            <Text style={styles.error}>
              Couldn’t load your balance. Tap to try again.
            </Text>
          </Pressable>
        )
        : balance === null || balance.remainingMinor === 0 ||
            query.data?.state === "paid"
        ? (
          <>
            <Text style={styles.paid}>Paid in full</Text>
            {balance !== null
              ? (
                <OverpaymentLine
                  heldMinor={balance.heldCreditMinor}
                  refundedMinor={balance.overpaymentRefundedMinor}
                  currency={balance.currency}
                />
              )
              : null}
          </>
        )
        : (
          <>
            <Text style={styles.amount}>
              {money(balance.remainingMinor, balance.currency)} left
            </Text>
            <OverpaymentLine
              heldMinor={balance.heldCreditMinor}
              refundedMinor={balance.overpaymentRefundedMinor}
              currency={balance.currency}
            />
            {tooSmall
              ? (
                <Text style={styles.next}>
                  {tripBalanceSmallRemainderCopy(
                    money(balance.remainingMinor, balance.currency),
                  )}
                </Text>
              )
              : null}
            {balance.nextPayment && !tooSmall
              ? (
                <Text style={styles.next}>
                  Next{" "}
                  {money(balance.nextPayment.amountMinor, balance.currency)} on
                  {" "}
                  {date(balance.nextPayment.dueAt)}
                </Text>
              )
              : null}
            {tooSmall ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Pay toward balance"
                onPress={() =>
                  router.push(
                    `/trip-balance/${encodeURIComponent(orderId)}` as never,
                  )}
                style={(
                  { pressed },
                ) => [styles.button, pressed && styles.pressed]}
              >
                <Text style={styles.buttonText}>Pay toward balance</Text>
              </Pressable>
            )}
          </>
        )}
    </View>
  );
}

/** issue #4522 (N6) — no balance endpoint, no v2 schema, or no such balance yet. */
export function isBalanceUnavailable(error: unknown): boolean {
  if (!(error instanceof TripBalancePayError)) return false;
  return error.code === "payment_plan_v2_unavailable" ||
    error.code === "balance_not_found" || error.status === 404;
}

/**
 * issue #4522 (N5, S-5) — money paid beyond what the trip costs is shown once,
 * in plain words (being refunded, and already refunded), and never counted
 * in what is paid or left. Copy is the shared one buyer web shows.
 */
export function OverpaymentLine(
  { heldMinor, refundedMinor = 0, currency }: {
    heldMinor: number;
    refundedMinor?: number;
    currency: string;
  },
): React.ReactElement | null {
  const lines = tripBalanceOverpaymentLines(
    { heldCreditMinor: heldMinor, overpaymentRefundedMinor: refundedMinor },
    (minor) => money(minor, currency),
  );
  if (lines.length === 0) return null;
  return (
    <>
      {lines.map((line) => (
        <Text key={line} style={styles.overpaid}>{line}</Text>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  overpaid: { color: "rgba(255,255,255,0.72)", fontSize: 13, lineHeight: 19 },
  card: {
    borderRadius: 22,
    backgroundColor: "#171a20",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    padding: 18,
    marginTop: 24,
    gap: 8,
  },
  eyebrow: {
    color: "#f8a35f",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.3,
  },
  amount: { color: "#fff", fontSize: 24, lineHeight: 30, fontWeight: "900" },
  next: { color: "rgba(255,255,255,0.62)", fontSize: 13, lineHeight: 19 },
  paid: { color: "#86efac", fontSize: 18, fontWeight: "900" },
  loading: { gap: 10 },
  skeleton: {
    height: 24,
    width: "64%",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  error: { color: "#fca5a5", fontSize: 13, lineHeight: 19 },
  button: {
    minHeight: 48,
    borderRadius: 15,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "900" },
  pressed: { opacity: 0.72 },
});
