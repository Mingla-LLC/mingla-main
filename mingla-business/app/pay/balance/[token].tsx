/** Issue #4522 — anonymous token-authenticated trip balance page. No auth hook. */
import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import {
  parseTripBalanceAmount,
  type TripBalanceChoice,
  tripBalanceOptions,
  type TripBalanceView,
} from "@mingla/offering-rendering/tripBalance";

import { SafeScreen } from "../../../src/components/ui/SafeScreen";
import {
  balanceMoney,
  TripBalancePanel,
} from "../../../src/components/trip/TripBalancePanel";
import { radius, space, type } from "../../../src/constants/designSystem";
import { color, themedStyles } from "../../../src/theme/surfaceTokens";
import {
  startTripBalanceLink,
  statusTripBalanceLink,
  TripBalancePayError,
  type TripBalanceStart,
  viewTripBalanceLink,
} from "../../../src/services/tripBalancePayService";

const StripePayment = React.lazy(() =>
  import("../../../src/components/trip/TripBalanceStripePayment").then((
    module,
  ) => ({ default: module.TripBalanceStripePayment }))
);
const POLL_INTERVAL_MS = 2_000;
const POLL_BUDGET_MS = 30_000;

const first = (value: string | string[] | undefined): string =>
  typeof value === "string" ? value : "";

const clientKey = (): string => {
  const cryptoValue = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto?.randomUUID?.();
  return `balance-${
    cryptoValue ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }`;
};

const paymentErrorCopy = (
  code: string,
  balance: TripBalanceView["balance"],
): string => {
  switch (code) {
    case "payment_plan_v2_unavailable":
      return "Paying in parts isn't available right now. You can pay the full balance.";
    case "balance_payment_in_flight":
      return "A payment on this trip is already processing. Try again in a few minutes.";
    case "flex_amount_invalid":
      return balance
        ? `That's more than your balance of ${
          balanceMoney(balance.remainingMinor, balance.currency)
        }.`
        : "Enter an amount.";
    case "flex_amount_below_minimum":
      return balance?.minPaymentMinor !== null &&
          balance?.minPaymentMinor !== undefined
        ? `The smallest payment is ${
          balanceMoney(balance.minPaymentMinor, balance.currency)
        }.`
        : "Enter a valid amount.";
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

type Page =
  | { kind: "loading" }
  | { kind: "ready"; view: TripBalanceView }
  | {
    kind: "stripe";
    view: TripBalanceView;
    session: Extract<TripBalanceStart, { kind: "stripe" }>;
  }
  | { kind: "checking"; view: TripBalanceView | null }
  | { kind: "pending"; view: TripBalanceView | null }
  | { kind: "expired" }
  | { kind: "error"; view: TripBalanceView | null; message: string };

export default function TripBalancePayPage(): React.ReactElement {
  const styles = balancePageStyles;
  const params = useLocalSearchParams<
    {
      token?: string | string[];
      return?: string | string[];
      expected?: string | string[];
    }
  >();
  const token = first(params.token);
  const returning = first(params.return) === "1";
  const returnExpected = Number(first(params.expected));
  const expectedOnReturn =
    Number.isSafeInteger(returnExpected) && returnExpected >= 0
      ? returnExpected
      : null;
  const [page, setPage] = useState<Page>({ kind: "loading" });
  const [choice, setChoice] = useState<TripBalanceChoice>("next");
  const [customAmount, setCustomAmount] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const last = useRef<TripBalanceView | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setPage({ kind: "loading" });
    try {
      const view = await viewTripBalanceLink(token);
      last.current = view;
      setPage({ kind: "ready", view });
    } catch (error) {
      if (error instanceof TripBalancePayError && error.status === 410) {
        setPage({ kind: "expired" });
      } else if (
        error instanceof TripBalancePayError &&
        error.code === "balance_not_found"
      ) {
        setPage({
          kind: "error",
          view: last.current,
          message: paymentErrorCopy(error.code, last.current?.balance ?? null),
        });
      } else {
        setPage({
          kind: "error",
          view: last.current,
          message:
            "We couldn't load your balance. Check your connection and try again.",
        });
      }
    }
  }, [token]);

  const poll = useCallback(
    async (expectedRemainingMinor: number | null = null): Promise<void> => {
      setPage({ kind: "checking", view: last.current });
      const startedAt = Date.now();
      while (Date.now() - startedAt < POLL_BUDGET_MS) {
        try {
          const view = await statusTripBalanceLink(token);
          last.current = view;
          const remainingMinor = view.balance?.remainingMinor;
          const collected = view.state !== "payable" || remainingMinor === 0 ||
            (expectedRemainingMinor !== null &&
              typeof remainingMinor === "number" &&
              remainingMinor < expectedRemainingMinor);
          if (collected) {
            setPage({ kind: "ready", view });
            return;
          }
          if (view.balance?.paymentInFlight !== true) {
            setPage({
              kind: "error",
              view,
              message:
                "Payment wasn't completed. Your balance has not been changed.",
            });
            return;
          }
        } catch {
          // Webhook/cron remain backstops; a transient read does not imply failure.
        }
        await new Promise<void>((resolve) =>
          setTimeout(resolve, POLL_INTERVAL_MS)
        );
      }
      setPage({ kind: "pending", view: last.current });
    },
    [token],
  );

  useEffect(() => {
    if (returning) void poll(expectedOnReturn);
    else void load();
  }, [expectedOnReturn, load, poll, returning]);

  const view = page.kind === "ready" || page.kind === "stripe"
    ? page.view
    : page.kind === "checking" || page.kind === "pending" ||
        page.kind === "error"
    ? page.view
    : null;
  const balance = view?.balance ?? null;
  const options = useMemo(() => balance ? tripBalanceOptions(balance) : [], [
    balance,
  ]);
  useEffect(() => {
    if (!balance || options.some((option) => option.key === choice)) return;
    setChoice(options[0]?.key ?? "full");
  }, [balance, choice, options]);

  const amount = useMemo((): number | null => {
    if (!balance) return null;
    if (choice === "other") {
      const parsed = parseTripBalanceAmount(customAmount, balance);
      return parsed.ok ? parsed.amountMinor : null;
    }
    return options.find((option) => option.key === choice)?.amountMinor ?? null;
  }, [balance, choice, customAmount, options]);

  const choose = (next: TripBalanceChoice): void => {
    setChoice(next);
    setCustomError(null);
  };

  const pay = async (): Promise<void> => {
    if (!balance) return;
    if (choice === "other") {
      const parsed = parseTripBalanceAmount(customAmount, balance);
      if (!parsed.ok) {
        setCustomError(
          parsed.error === "empty"
            ? "Enter an amount."
            : parsed.error === "over_balance"
            ? `That's more than your balance of ${
              balanceMoney(balance.remainingMinor, balance.currency)
            }.`
            : parsed.error === "below_minimum"
            ? `The smallest payment is ${
              balanceMoney(balance.minPaymentMinor ?? 0, balance.currency)
            }.`
            : "Enter a valid amount.",
        );
        return;
      }
    }
    if (amount === null) return;
    setBusy(true);
    setCustomError(null);
    try {
      const session = await startTripBalanceLink({
        token,
        amountMinor: amount,
        expectedRemainingMinor: balance.remainingMinor,
        clientKey: clientKey(),
        method: "new_card",
      });
      if (session.kind === "stripe") {
        setPage({ kind: "stripe", view: view as TripBalanceView, session });
      } else if (session.kind === "redirect") {
        if (Platform.OS !== "web") throw new Error("web_required");
        (globalThis as {
          window?: { location?: { assign?: (url: string) => void } };
        }).window?.location?.assign?.(session.url);
      } else {
        void poll(balance.remainingMinor);
      }
    } catch (error) {
      if (
        error instanceof TripBalancePayError && error.code === "balance_changed"
      ) {
        const fresh = await viewTripBalanceLink(token).catch(() => null);
        if (fresh) {
          last.current = fresh;
          setPage({ kind: "ready", view: fresh });
        }
        setCustomError(
          "Your balance just changed. Check the new amount and try again.",
        );
      } else if (error instanceof TripBalancePayError) {
        setPage({
          kind: "error",
          view: last.current,
          message: paymentErrorCopy(error.code, last.current?.balance ?? null),
        });
      } else {
        setPage({
          kind: "error",
          view: last.current,
          message: "Payment couldn't start. Your balance has not been changed.",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  let content: React.ReactNode;
  if (page.kind === "loading") {
    content = <State title="Loading your balance" busy />;
  } else if (page.kind === "expired") {
    content = (
      <State
        title="This balance link has expired"
        body="Open the newest link from your email, or visit your purchase in Mingla."
      />
    );
  } else if (page.kind === "checking") {
    content = (
      <State
        title="Checking your payment…"
        body="Keep this page open while we confirm it."
        busy
      />
    );
  } else if (page.kind === "pending") {
    content = (
      <State
        title="We're still confirming your payment"
        body="This can take a few minutes. You won't be charged twice."
        action="Check again"
        onAction={() => void poll(balance?.remainingMinor ?? null)}
      />
    );
  } else if (page.kind === "error") {
    content = (
      <State
        title="Something went wrong"
        body={page.message}
        action="Try again"
        onAction={() => void load()}
      />
    );
  } else if (
    page.view.state === "paid" || page.view.balance?.remainingMinor === 0
  ) {
    content = (
      <State
        title="Paid in full"
        body={`You're all set for ${page.view.tripTitle ?? "your trip"}.`}
      />
    );
  } else if (page.view.state === "no_longer_due") {
    content = (
      <State
        title="Nothing to pay"
        body="This trip balance is no longer due."
      />
    );
  } else if (!page.view.balance) {
    content = (
      <State
        title="Balance unavailable"
        body="This balance could not be loaded."
        action="Try again"
        onAction={() => void load()}
      />
    );
  } else if (page.kind === "stripe") {
    const origin =
      (globalThis as { window?: { location?: { origin?: string } } }).window
        ?.location?.origin ?? "";
    const returnUrl = `${origin}/pay/balance/${
      encodeURIComponent(token)
    }?return=1&expected=${page.view.balance?.remainingMinor ?? ""}`;
    content = (
      <View style={styles.paymentCard}>
        <Text style={styles.stateTitle}>Complete your secure payment</Text>
        <Suspense fallback={<ActivityIndicator color={color.accent} />}>
          <StripePayment
            session={page.session}
            returnUrl={returnUrl}
            onComplete={() =>
              void poll(page.view.balance?.remainingMinor ?? null)}
          />
        </Suspense>
      </View>
    );
  } else {
    content = (
      <TripBalancePanel
        amountMinor={amount}
        balance={page.view.balance}
        brandName={page.view.brandName}
        busy={busy}
        choice={choice}
        customAmount={customAmount}
        customError={customError}
        onChoice={choose}
        onCustomAmount={(value) => {
          setCustomAmount(value);
          setCustomError(null);
        }}
        onPay={() => void pay()}
        tripTitle={page.view.tripTitle ?? "Your trip"}
      />
    );
  }

  return (
    <SafeScreen edges={["top", "bottom"]} style={styles.screen}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={styles.wordmark}>Mingla</Text>
        {content}
      </ScrollView>
    </SafeScreen>
  );
}

function State(
  { title, body, action, onAction, busy }: {
    title: string;
    body?: string;
    action?: string;
    onAction?: () => void;
    busy?: boolean;
  },
): React.ReactElement {
  const styles = balancePageStyles;
  return (
    <View accessibilityRole="summary" style={styles.paymentCard}>
      {busy ? <ActivityIndicator color={color.accent} /> : null}
      <Text style={styles.stateTitle}>{title}</Text>
      {body ? <Text style={styles.stateBody}>{body}</Text> : null}
      {action && onAction
        ? (
          <Text
            accessibilityRole="button"
            onPress={onAction}
            style={styles.textButton}
          >
            {action}
          </Text>
        )
        : null}
    </View>
  );
}

const balancePageStyles = themedStyles(() =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: color.canvas },
    content: {
      flexGrow: 1,
      width: "100%",
      maxWidth: 720,
      alignSelf: "center",
      paddingHorizontal: space[4],
      paddingVertical: space[7],
      gap: space[6],
    },
    wordmark: { ...type.h1, color: color.text1, textAlign: "center" },
    paymentCard: {
      width: "100%",
      padding: space[6],
      borderRadius: radius.lg,
      backgroundColor: color.card,
      borderWidth: 1,
      borderColor: color.lineStrong,
      gap: space[4],
    },
    stateTitle: { ...type.h1, color: color.text1, textAlign: "center" },
    stateBody: { ...type.body, color: color.text2, textAlign: "center" },
    textButton: {
      ...type.body,
      color: color.accent,
      fontWeight: "800",
      textAlign: "center",
      padding: space[3],
    },
  })
);
