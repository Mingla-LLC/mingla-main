/**
 * Issue #3645 — anonymous buyer page for an instalment pay or approval link.
 * Deliberately has no auth hook: the high-entropy URL token is the credential.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { Button } from "../../src/components/ui/Button";
import { SafeScreen } from "../../src/components/ui/SafeScreen";
import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import {
  InstallmentPayLinkError,
  startInstallmentPayLink,
  statusInstallmentPayLink,
  viewInstallmentPayLink,
  type InstallmentPayLinkView,
} from "../../src/services/installmentPayLinkService";
import { formatCurrency as formatCurrencyAmount } from "../../src/utils/currency";
import { withCurrencyGlyph } from "@mingla/offering-rendering/currencyGlyph";

type PageState =
  | { kind: "loading" }
  | { kind: "link"; link: InstallmentPayLinkView }
  | { kind: "returning"; link: InstallmentPayLinkView | null }
  | { kind: "pending"; link: InstallmentPayLinkView | null }
  | { kind: "in_progress"; link: InstallmentPayLinkView | null }
  | { kind: "error"; link: InstallmentPayLinkView | null };

const POLL_INTERVAL_MS = 2_000;
const POLL_BUDGET_MS = 30_000;

function formatAmount(link: InstallmentPayLinkView | null): string {
  if (link?.amountCents === undefined || link.currency === undefined) return "your";
  return withCurrencyGlyph(
    formatCurrencyAmount(link.amountCents, link.currency, true),
    link.currency,
  );
}

function amountA11y(link: InstallmentPayLinkView): string {
  if (link.amountCents === undefined) return "Payment amount";
  if (link.currency === "NGN") {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(link.amountCents / 100)} naira`;
  }
  return formatAmount(link);
}

function formatDueDate(value: string | undefined): string {
  if (value === undefined) return "the due date";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function safeToken(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default function InstallmentPayPage(): React.ReactElement {
  const params = useLocalSearchParams<{ token?: string | string[]; return?: string | string[] }>();
  const token = safeToken(params.token);
  const isReturning = safeToken(params.return) === "1";
  const [page, setPage] = useState<PageState>({ kind: "loading" });
  const lastLink = useRef<InstallmentPayLinkView | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setPage({ kind: "loading" });
    try {
      const link = await viewInstallmentPayLink(token);
      lastLink.current = link;
      setPage({ kind: "link", link });
    } catch (error) {
      if (error instanceof InstallmentPayLinkError && error.status === 404) {
        setPage({ kind: "link", link: { state: "invalid" } });
      } else {
        setPage({ kind: "error", link: lastLink.current });
      }
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    if (!isReturning) {
      void load();
      return (): void => {
        cancelled = true;
      };
    }
    setPage({ kind: "returning", link: lastLink.current });
    const startedAt = Date.now();
    const poll = async (): Promise<void> => {
      while (!cancelled && Date.now() - startedAt < POLL_BUDGET_MS) {
        try {
          const link = await statusInstallmentPayLink(token);
          lastLink.current = link;
          if (link.state !== "payable") {
            if (!cancelled) setPage({ kind: "link", link });
            return;
          }
        } catch {
          // A transient poll failure does not replace the confirmation state.
        }
        await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      if (!cancelled) setPage({ kind: "pending", link: lastLink.current });
    };
    void poll();
    return (): void => {
      cancelled = true;
    };
  }, [isReturning, load, token]);

  const start = useCallback(async (): Promise<void> => {
    try {
      const { url } = await startInstallmentPayLink(token);
      if (Platform.OS === "web") {
        (globalThis as { window?: { location?: { assign?: (next: string) => void } } })
          .window?.location?.assign?.(url);
        return;
      }
      setPage({ kind: "error", link: lastLink.current });
    } catch (error) {
      if (
        error instanceof InstallmentPayLinkError &&
        (error.code === "payment_in_progress" || error.status === 409)
      ) {
        setPage({ kind: "in_progress", link: lastLink.current });
      } else {
        setPage({ kind: "error", link: lastLink.current });
      }
    }
  }, [token]);

  const content = useMemo(() => {
    if (page.kind === "loading") {
      return (
        <View accessibilityLabel="Loading payment" style={styles.skeletonCard}>
          <ActivityIndicator color={accent.warm} />
          <View style={styles.skeletonLineWide} />
          <View style={styles.skeletonLine} />
        </View>
      );
    }
    if (page.kind === "returning") {
      return <StateCard title="Checking your payment…" body="Please keep this page open while we confirm it." busy />;
    }
    if (page.kind === "pending") {
      return (
        <StateCard
          title="We're still confirming your payment"
          body="This can take a few minutes. You'll get an email when it's done. You won't be charged twice."
          action="Check again"
          onAction={() => {
            setPage({ kind: "returning", link: page.link });
            void statusInstallmentPayLink(token).then((link) => {
              lastLink.current = link;
              setPage(link.state === "payable" ? { kind: "pending", link } : { kind: "link", link });
            }).catch(() => setPage({ kind: "error", link: page.link }));
          }}
        />
      );
    }
    if (page.kind === "in_progress") {
      return (
        <StateCard
          title="Payment already started"
          body="Finish the payment in the other tab, or try again in a few minutes."
          action="Try again"
          onAction={() => void start()}
        />
      );
    }
    if (page.kind === "error") {
      return (
        <StateCard
          title="Something went wrong"
          body="We couldn't load this payment. Check your connection and try again."
          action="Try again"
          onAction={() => void load()}
        />
      );
    }

    const link = page.link;
    if (link.state === "invalid") {
      return <StateCard title="This link isn't valid" body="It may have expired or been replaced by a newer link. Check your latest email from Mingla." />;
    }
    if (link.state === "no_longer_due") {
      return <StateCard title="Nothing to pay" body={`This payment is no longer due. If you think this is wrong, contact ${link.brandName ?? "the trip organiser"}.`} />;
    }
    if (link.state === "paid") {
      return <StateCard title="Payment received" body={`Thanks — your ${formatAmount(link)} payment for ${link.tripTitle ?? "your trip"} is in.`} />;
    }
    if (link.purpose === "approve") {
      return (
        <StateCard
          title="Approve your payment"
          body={`Your bank asked you to approve the ${formatAmount(link)} payment for ${link.tripTitle ?? "your trip"}${link.cardLast4 ? ` (card ending ${link.cardLast4})` : ""}.`}
          amount={formatAmount(link)}
          amountLabel={amountA11y(link)}
          action="Approve payment"
          onAction={() => void start()}
        />
      );
    }
    return (
      <StateCard
        title="Pay your trip instalment"
        body={`${link.tripTitle ?? "Your trip"} with ${link.brandName ?? "your organiser"}. Payment ${link.ordinal ?? ""} of ${link.totalPayments ?? ""}, due ${formatDueDate(link.dueAt)}.`}
        amount={formatAmount(link)}
        amountLabel={amountA11y(link)}
        note="Includes fees and tax."
        action={`Pay ${formatAmount(link)}`}
        onAction={() => void start()}
      />
    );
  }, [load, page, start, token]);

  return (
    <SafeScreen edges={["top", "bottom"]} style={styles.screen}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.wordmark}><Text style={styles.wordmarkText}>Mingla</Text></View>
        {content}
      </ScrollView>
    </SafeScreen>
  );
}

interface StateCardProps {
  title: string;
  body: string;
  amount?: string;
  amountLabel?: string;
  note?: string;
  action?: string;
  onAction?: () => void;
  busy?: boolean;
}

const StateCard: React.FC<StateCardProps> = ({ title, body, amount, amountLabel, note, action, onAction, busy }) => (
  <View style={styles.card} accessibilityRole="summary">
    {busy ? <ActivityIndicator color={accent.warm} /> : null}
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.body}>{body}</Text>
    {amount ? <Text style={styles.amount} accessibilityLabel={amountLabel}>{amount}</Text> : null}
    {note ? <Text style={styles.note}>{note}</Text> : null}
    {action && onAction ? (
      <Button
        label={action}
        accessibilityRole="button"
        accessibilityLabel={action}
        onPress={onAction}
        fullWidth
        size="md"
      />
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: canvas.discover },
  content: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xl,
  },
  wordmark: { marginBottom: spacing.lg },
  wordmarkText: { ...typography.h2, color: textTokens.primary },
  card: {
    width: "100%",
    maxWidth: 480,
    padding: spacing.lg,
    borderRadius: radiusTokens.lg,
    backgroundColor: canvas.profile,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    gap: spacing.md,
  },
  title: { ...typography.h2, color: textTokens.primary, textAlign: "center" },
  body: { ...typography.body, color: textTokens.secondary, textAlign: "center" },
  amount: { ...typography.display, color: textTokens.primary, textAlign: "center" },
  note: { ...typography.bodySm, color: textTokens.tertiary, textAlign: "center" },
  skeletonCard: {
    width: "100%",
    maxWidth: 480,
    minHeight: 240,
    padding: spacing.lg,
    borderRadius: radiusTokens.lg,
    backgroundColor: canvas.profile,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.lg,
  },
  skeletonLineWide: { height: 18, width: "72%", borderRadius: radiusTokens.full, backgroundColor: glass.border.profileElevated },
  skeletonLine: { height: 14, width: "48%", borderRadius: radiusTokens.full, backgroundColor: glass.border.profileElevated },
});
