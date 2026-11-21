import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { useTripBalance } from "../../hooks/useTripBalance";
import { formatPurchaseMoney } from "../../utils/purchasePresentation";

const money = (minor: number, currency: string): string =>
  formatPurchaseMoney(minor, currency) ?? `${minor} ${currency}`;

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
            onPress={() => void query.refetch()}
          >
            <Text style={styles.error}>
              Couldn’t load your balance. Tap to try again.
            </Text>
          </Pressable>
        )
        : balance === null || balance.remainingMinor === 0 ||
            query.data?.state === "paid"
        ? <Text style={styles.paid}>Paid in full</Text>
        : (
          <>
            <Text style={styles.amount}>
              {money(balance.remainingMinor, balance.currency)} left
            </Text>
            {balance.nextPayment
              ? (
                <Text style={styles.next}>
                  Next{" "}
                  {money(balance.nextPayment.amountMinor, balance.currency)} on
                  {" "}
                  {date(balance.nextPayment.dueAt)}
                </Text>
              )
              : null}
            <Pressable
              accessibilityRole="button"
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
          </>
        )}
    </View>
  );
}

const styles = StyleSheet.create({
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
