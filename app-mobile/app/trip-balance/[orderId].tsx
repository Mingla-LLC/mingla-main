// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
/** Issue #4522 — signed-in Explorer balance screen, inert behind its env flag. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { initStripe } from "@stripe/stripe-react-native";
import {
  isStripeGooglePayTestEnv,
  useStripePaymentSheet,
} from "@mingla/payments-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import {
  aggregateTripBalanceSchedule,
  parseTripBalanceAmount,
  rebalanceTripPlan,
  type TripBalance,
  type TripBalanceChoice,
  supportsBalancePayments,
  tripBalanceOptions,
  unpayableRemainderCopy,
} from "@mingla/offering-rendering/tripBalance";

import { FEATURE_FLAG_TRIP_BALANCE } from "../../src/config/featureFlags";
import { purchaseKeys, tripBalanceKeys } from "../../src/hooks/queryKeys";
import { useTripBalance } from "../../src/hooks/useTripBalance";
import { useNetworkMonitor } from "../../src/services/networkMonitor";
import {
  startTripBalance,
  statusTripBalance,
  TripBalancePayError,
} from "../../src/services/tripBalancePayService";
import {
  isBalanceUnavailable,
  OverpaymentLine,
} from "../../src/components/purchases/TripBalanceCard";
import { toastManager } from "../../src/components/ui/Toast";
import { formatPurchaseMoney } from "../../src/utils/purchasePresentation";

const POLL_INTERVAL_MS = 2_000;
const POLL_BUDGET_MS = 30_000;

const first = (value: string | string[] | undefined): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;
const money = (minor: number, currency: string): string =>
  formatPurchaseMoney(minor, currency) ?? `${minor} ${currency}`;
const due = (value: string): string => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
      .format(parsed);
};
const clientKey = (): string =>
  `balance-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
const amountString = (minor: number): string =>
  `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;

const paymentErrorCopy = (
  code: string,
  balance: TripBalance | null,
): string => {
  switch (code) {
    case "payment_plan_v2_unavailable":
      return "Paying in parts isn't available right now. You can pay the full balance.";
    case "balance_payment_in_flight":
      return "Your earlier payment on this trip is still being confirmed. You can pay again once it's confirmed, within 24 hours.";
    case "flex_amount_invalid":
      return balance
        ? `That's more than your balance of ${
          money(balance.remainingMinor, balance.currency)
        }.`
        : "Enter an amount.";
    case "flex_amount_below_minimum":
      return balance?.minPaymentMinor !== null &&
          balance?.minPaymentMinor !== undefined
        ? `The smallest payment is ${
          money(balance.minPaymentMinor, balance.currency)
        }.`
        : "Enter a valid amount.";
    case "flex_amount_leaves_unpayable_remainder":
      return balance
        ? unpayableRemainderCopy(balance, (minor) => money(minor, balance.currency))
        : "Enter a valid amount.";
    case "balance_settled":
      return "Nothing more is owed on this trip. The last amount was too small to charge, so it has been cleared.";
    case "plan_not_flexible":
      return "This trip takes set payments. You can pay your next payment or the full balance.";
    case "deposit_not_paid":
      return "Pay your deposit first.";
    case "balance_not_found":
      return "We couldn't find this booking.";
    case "order_cancelled":
    case "event_cancelled":
      return "This trip balance is no longer due.";
    default:
      return "Payment couldn't start. Your balance has not been changed.";
  }
};

export default function TripBalanceRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ orderId?: string | string[] }>();
  const orderId = first(params.orderId);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const network = useNetworkMonitor();
  const online = network.isConnected && network.isInternetReachable;
  const query = useTripBalance(orderId, FEATURE_FLAG_TRIP_BALANCE);
  const { initPaymentSheet, presentPaymentSheet, isPaymentSheetSupported } =
    useStripePaymentSheet();
  const [choice, setChoice] = useState<TripBalanceChoice>("next");
  const [customAmount, setCustomAmount] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const balance = query.data?.balance ?? null;
  const options = useMemo(() => balance ? tripBalanceOptions(balance) : [], [
    balance,
  ]);
  useEffect(() => {
    if (!balance || options.some((option) => option.key === choice)) return;
    setChoice(options[0]?.key ?? "full");
  }, [balance, choice, options]);
  const amountMinor = useMemo(() => {
    if (!balance) return null;
    if (choice === "other") {
      const parsed = parseTripBalanceAmount(customAmount, balance);
      return parsed.ok ? parsed.amountMinor : null;
    }
    return options.find((option) => option.key === choice)?.amountMinor ?? null;
  }, [balance, choice, customAmount, options]);

  const refreshBoth = useCallback(async (): Promise<void> => {
    if (!orderId) return;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: tripBalanceKeys.detail(orderId),
      }),
      queryClient.invalidateQueries({ queryKey: purchaseKeys.all }),
    ]);
  }, [orderId, queryClient]);

  const poll = useCallback(async (
    paidAmount: number,
    expectedRemainingMinor: number,
  ): Promise<void> => {
    if (!orderId) return;
    setConfirming(true);
    const startedAt = Date.now();
    while (Date.now() - startedAt < POLL_BUDGET_MS) {
      try {
        const view = await statusTripBalance(orderId);
        queryClient.setQueryData(tripBalanceKeys.detail(orderId), view);
        const remainingMinor = view.balance?.remainingMinor;
        const collected = view.state !== "payable" || remainingMinor === 0 ||
          (typeof remainingMinor === "number" &&
            remainingMinor < expectedRemainingMinor);
        if (collected) {
          await refreshBoth();
          toastManager.success(
            view.balance?.remainingMinor === 0
              ? `${
                money(paidAmount, view.balance.currency)
              } paid. Your trip is paid in full.`
              : `${
                money(
                  paidAmount,
                  view.balance?.currency ?? balance?.currency ?? "USD",
                )
              } paid. Your schedule is updated.`,
            4000,
          );
          setConfirming(false);
          return;
        }
        if (view.balance?.paymentInFlight !== true) {
          setConfirming(false);
          toastManager.error(
            "Payment wasn't completed. Your balance has not been changed.",
            5000,
          );
          await refreshBoth();
          return;
        }
      } catch {
        // The provider webhook and reconciliation worker remain backstops.
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, POLL_INTERVAL_MS)
      );
    }
    setConfirming(false);
    toastManager.info(
      "We're still confirming your payment. You won't be charged twice.",
      5000,
    );
    await refreshBoth();
  }, [balance?.currency, orderId, queryClient, refreshBoth]);

  const validateOther = (): number | null => {
    if (!balance || choice !== "other") return amountMinor;
    const parsed = parseTripBalanceAmount(customAmount, balance);
    if (parsed.ok) return parsed.amountMinor;
    setCustomError(
      parsed.error === "empty"
        ? "Enter an amount."
        : parsed.error === "over_balance"
        ? `That's more than your balance of ${
          money(balance.remainingMinor, balance.currency)
        }.`
        : parsed.error === "below_minimum"
        ? `The smallest payment is ${
          money(balance.minPaymentMinor ?? 0, balance.currency)
        }.`
        : parsed.error === "leaves_unpayable_remainder"
        ? unpayableRemainderCopy(balance, (minor) => money(minor, balance.currency))
        : "Enter a valid amount.",
    );
    return null;
  };

  const pay = async (): Promise<void> => {
    if (!orderId || !balance || !online || busy) return;
    const paying = validateOther();
    if (paying === null) return;
    setBusy(true);
    setCustomError(null);
    try {
      const session = await startTripBalance({
        orderId,
        amountMinor: paying,
        expectedRemainingMinor: balance.remainingMinor,
        clientKey: clientKey(),
        method: query.data?.provider === "paystack" && query.data.savedCardLast4
          ? "saved_card"
          : "new_card",
      });
      if (session.kind === "open_page") {
        // #2227 — the provider returns through an https web page. A normal
        // browser session is required; never use openAuthSessionAsync here.
        await WebBrowser.openBrowserAsync(session.url);
        await poll(paying, balance.remainingMinor);
        return;
      }
      if (session.kind === "paystack_saved_card") {
        await poll(paying, balance.remainingMinor);
        return;
      }
      if (!isPaymentSheetSupported) {
        throw new Error("payment_sheet_unavailable");
      }
      await initStripe({
        publishableKey: session.publishableKey,
        stripeAccountId: session.stripeAccountId,
        merchantIdentifier: "merchant.com.mingla.app.v2",
        urlScheme: "com.mingla.app.v2",
      });
      const initialized = await initPaymentSheet({
        merchantDisplayName: "Mingla",
        paymentIntentClientSecret: session.clientSecret,
        customerId: session.customerId,
        customerEphemeralKeySecret: session.customerEphemeralKeySecret,
        returnURL: "com.mingla.app.v2://stripe-redirect",
        applePay: {
          merchantCountryCode: "US",
          cartItems: [{
            label: query.data?.tripTitle ?? "Trip balance",
            amount: amountString(paying),
            paymentType: "Immediate",
          }],
        },
        googlePay: {
          merchantCountryCode: "US",
          testEnv: isStripeGooglePayTestEnv(session.publishableKey),
          currencyCode: balance.currency.toLowerCase(),
        },
      });
      if (initialized.error) {
        throw new Error(
          initialized.error.localizedMessage ?? initialized.error.message ??
            "payment_sheet_failed",
        );
      }
      const presented = await presentPaymentSheet();
      if (presented.error) {
        if (presented.error.code === "Canceled") return;
        throw new Error(
          presented.error.localizedMessage ?? presented.error.message ??
            "payment_failed",
        );
      }
      await poll(paying, balance.remainingMinor);
    } catch (error) {
      if (
        error instanceof TripBalancePayError && error.code === "balance_changed"
      ) {
        await query.refetch();
        setCustomError(
          "Your balance just changed. Check the new amount and try again.",
        );
      } else if (
        error instanceof TripBalancePayError &&
        error.code === "balance_payment_in_flight"
      ) {
        toastManager.info(paymentErrorCopy(error.code, balance), 5000);
        await query.refetch();
      } else if (error instanceof TripBalancePayError) {
        toastManager.error(paymentErrorCopy(error.code, balance), 5000);
      } else {
        toastManager.error(
          "Payment couldn't start. Your balance has not been changed.",
          4000,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const back = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/purchases" as never);
  };

  let content: React.ReactNode;
  if (!FEATURE_FLAG_TRIP_BALANCE) {
    content = (
      <State
        title="Balance payments aren't available yet"
        body="This feature is still being prepared."
      />
    );
  } else if (!orderId) {
    content = (
      <State
        title="Balance not found"
        body="Open the trip from Purchases and try again."
      />
    );
  } else if (!online) {
    content = <State title="You're offline" body="Connect to pay." />;
  } else if (query.isLoading) {
    content = <State title="Loading your balance" busy />;
  } else if (query.isError && isBalanceUnavailable(query.error)) {
    // issue #4522 (N6) — no balance endpoint or v2 schema yet.
    content = (
      <State
        title="Not available for this trip"
        body="Your payments stay on their schedule. Check Purchases for the next one."
      />
    );
  } else if (query.isError || !query.data) {
    content = (
      <State title="Couldn't load your balance" body="Pull to try again." />
    );
  } else if (balance !== null && !supportsBalancePayments(balance)) {
    // issue #4522 (N6) — an older instalment plan: no flexible actions.
    content = (
      <State
        title="Not available for this trip"
        body="Your payments stay on their schedule. Check Purchases for the next one."
      />
    );
  } else if (query.data.state === "paid" || balance?.remainingMinor === 0) {
    content = (
      <View style={styles.stack}>
        <State
          title="Paid in full"
          body={`You're all set for ${query.data.tripTitle ?? "your trip"}.`}
        />
        {balance !== null
          ? (
            <OverpaymentLine
              heldMinor={balance.heldCreditMinor}
              currency={balance.currency}
            />
          )
          : null}
      </View>
    );
  } else if (!balance) {
    content = (
      <State
        title="Nothing to pay"
        body="This trip balance is no longer due."
      />
    );
  } else {content = (
      <BalanceContent
        amountMinor={amountMinor}
        balance={balance}
        busy={busy || confirming}
        choice={choice}
        customAmount={customAmount}
        customError={customError}
        paystackLast4={query.data.provider === "paystack"
          ? query.data.savedCardLast4
          : undefined}
        onChoice={(next) => {
          setChoice(next);
          setCustomError(null);
        }}
        onCustom={(value) => {
          setCustomAmount(value);
          setCustomError(null);
        }}
        onPay={() => void pay()}
        title={query.data.tripTitle ?? "Your trip"}
      />
    );}

  return (
    <View style={styles.host}>
      <ScrollView
        contentContainerStyle={[styles.content, {
          paddingTop: insets.top + 16,
          paddingBottom: insets.bottom + 36,
        }]}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor="#eb7825"
          />
        }
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={back}
          style={styles.back}
        >
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.screenTitle}>Balance</Text>
        {content}
      </ScrollView>
    </View>
  );
}

function State(
  { title, body, busy }: { title: string; body?: string; busy?: boolean },
): React.ReactElement {
  return (
    <View style={styles.state}>
      {busy ? <ActivityIndicator color="#eb7825" /> : null}
      <Text style={styles.stateTitle}>{title}</Text>
      {body ? <Text style={styles.stateBody}>{body}</Text> : null}
    </View>
  );
}

function BalanceContent(
  {
    balance,
    title,
    choice,
    customAmount,
    customError,
    amountMinor,
    busy,
    paystackLast4,
    onChoice,
    onCustom,
    onPay,
  }: {
    balance: TripBalance;
    title: string;
    choice: TripBalanceChoice;
    customAmount: string;
    customError: string | null;
    amountMinor: number | null;
    busy: boolean;
    paystackLast4?: string;
    onChoice: (choice: TripBalanceChoice) => void;
    onCustom: (value: string) => void;
    onPay: () => void;
  },
): React.ReactElement {
  const options = tripBalanceOptions(balance);
  const after = amountMinor === null
    ? balance.openRows
    : rebalanceTripPlan(balance.openRows, amountMinor, balance.minPaymentMinor, balance.providerMinimumMinor);
  const pct = balance.totalMinor > 0
    ? Math.min(100, balance.paidMinor / balance.totalMinor * 100)
    : 100;
  return (
    <View style={styles.stack}>
      <View style={styles.hero}>
        <Text style={styles.tripTitle}>{title}</Text>
        <Text style={styles.label}>Balance remaining</Text>
        <Text style={styles.balance}>
          {money(balance.remainingMinor, balance.currency)}
        </Text>
        <OverpaymentLine
          heldMinor={balance.heldCreditMinor}
          currency={balance.currency}
        />
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{
            min: 0,
            max: balance.totalMinor,
            now: balance.paidMinor,
          }}
          style={styles.track}
        >
          <View style={[styles.progress, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.muted}>
          {money(balance.paidMinor, balance.currency)} paid of{" "}
          {money(balance.totalMinor, balance.currency)}
        </Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Choose what to pay</Text>
        <View style={styles.options}>
          {options.map((option) => (
            <Pressable
              key={option.key}
              accessibilityRole="radio"
              accessibilityState={{ checked: choice === option.key }}
              onPress={() => onChoice(option.key)}
              style={[styles.option, choice === option.key && styles.optionOn]}
            >
              <Text style={styles.optionLabel}>{option.label}</Text>
              <Text style={styles.optionAmount}>
                {option.amountMinor === null
                  ? "Enter amount"
                  : money(option.amountMinor, balance.currency)}
              </Text>
            </Pressable>
          ))}
        </View>
        {choice === "other"
          ? (
            <View>
              <TextInput
                accessibilityLabel="Other payment amount"
                keyboardType="decimal-pad"
                onChangeText={onCustom}
                placeholder="0.00"
                placeholderTextColor="rgba(255,255,255,0.35)"
                style={styles.input}
                value={customAmount}
              />
              {customError
                ? (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {customError}
                  </Text>
                )
                : null}
            </View>
          )
          : null}
        {choice !== "other" && customError
          ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {customError}
            </Text>
          )
          : null}
      </View>
      {amountMinor !== null
        ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Your remaining payments update after you pay
            </Text>
            <View style={styles.columns}>
              <Schedule
                title="Now"
                rows={aggregateTripBalanceSchedule(balance.openRows)}
                currency={balance.currency}
              />
              <Schedule
                title={`After paying ${money(amountMinor, balance.currency)}`}
                rows={after}
                currency={balance.currency}
              />
            </View>
          </View>
        )
        : null}
      {balance.history.length > 0
        ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Paid so far</Text>
            {balance.history.map((row) => (
              <View key={row.installmentId} style={styles.row}>
                <Text style={styles.muted}>
                  {row.kind === "deposit" ? "Deposit" : "Payment"}
                </Text>
                <Text style={styles.rowAmount}>
                  {money(row.amountMinor, balance.currency)}
                </Text>
              </View>
            ))}
          </View>
        )
        : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{
          disabled: busy || amountMinor === null || balance.paymentInFlight,
        }}
        disabled={busy || amountMinor === null || balance.paymentInFlight}
        onPress={onPay}
        style={[
          styles.payButton,
          (busy || amountMinor === null || balance.paymentInFlight) &&
          styles.disabled,
        ]}
      >
        <Text style={styles.payText}>
          {busy
            ? "Confirming payment…"
            : amountMinor === null
            ? "Choose an amount"
            : paystackLast4
            ? `Pay ${
              money(amountMinor, balance.currency)
            } with card ending ${paystackLast4}`
            : `Pay ${money(amountMinor, balance.currency)}`}
        </Text>
      </Pressable>
      {balance.paymentInFlight
        ? (
          <Text style={styles.notice}>
            A payment on this trip is already processing. Pull to refresh in a
            moment.
          </Text>
        )
        : null}
    </View>
  );
}

function Schedule(
  { title, rows, currency }: {
    title: string;
    rows: TripBalance["openRows"];
    currency: string;
  },
): React.ReactElement {
  return (
    <View style={styles.schedule}>
      <Text style={styles.scheduleTitle}>{title}</Text>
      {rows.length === 0
        ? <Text style={styles.paid}>Paid in full</Text>
        : rows.map((row) => (
          <View key={row.installmentId}>
            <Text style={styles.muted}>{due(row.dueAt)}</Text>
            <Text style={styles.rowAmount}>
              {money(row.amountMinor, currency)}
            </Text>
          </View>
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: "#0b0d11" },
  content: { paddingHorizontal: 18 },
  back: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center" },
  backText: { color: "#fff", fontSize: 31, lineHeight: 33 },
  screenTitle: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "900",
    marginTop: 8,
    marginBottom: 18,
  },
  stack: { gap: 16 },
  hero: {
    borderRadius: 24,
    backgroundColor: "#171a20",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    padding: 20,
  },
  tripTitle: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 15,
    fontWeight: "700",
  },
  label: { color: "rgba(255,255,255,0.52)", fontSize: 12, marginTop: 24 },
  balance: {
    color: "#fff",
    fontSize: 36,
    lineHeight: 43,
    fontWeight: "900",
    marginTop: 2,
  },
  track: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    marginTop: 16,
  },
  progress: { height: "100%", borderRadius: 999, backgroundColor: "#eb7825" },
  muted: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 7,
  },
  card: {
    borderRadius: 22,
    backgroundColor: "#171a20",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    padding: 18,
    gap: 14,
  },
  cardTitle: { color: "#fff", fontSize: 17, fontWeight: "900" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  option: {
    flexGrow: 1,
    flexBasis: "45%",
    minHeight: 82,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.04)",
    padding: 13,
    justifyContent: "space-between",
  },
  optionOn: {
    borderColor: "#eb7825",
    backgroundColor: "rgba(235,120,37,0.12)",
  },
  optionLabel: {
    color: "rgba(255,255,255,0.60)",
    fontSize: 12,
    fontWeight: "800",
  },
  optionAmount: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 8,
  },
  input: {
    minHeight: 52,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    color: "#fff",
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingHorizontal: 15,
    fontSize: 18,
    fontWeight: "800",
  },
  error: { color: "#fca5a5", fontSize: 12, lineHeight: 18, marginTop: 7 },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  schedule: {
    flex: 1,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.04)",
    padding: 12,
    gap: 10,
  },
  scheduleTitle: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    fontWeight: "900",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  rowAmount: { color: "#fff", fontSize: 13, fontWeight: "800" },
  paid: { color: "#86efac", fontSize: 14, fontWeight: "900", marginTop: 7 },
  payButton: {
    minHeight: 54,
    borderRadius: 17,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
  },
  payText: { color: "#fff", fontSize: 16, fontWeight: "900" },
  disabled: { opacity: 0.46 },
  notice: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  state: {
    borderRadius: 24,
    backgroundColor: "#171a20",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    padding: 26,
    gap: 10,
    alignItems: "center",
  },
  stateTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  stateBody: {
    color: "rgba(255,255,255,0.58)",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
});
