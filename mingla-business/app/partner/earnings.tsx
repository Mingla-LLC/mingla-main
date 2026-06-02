/**
 * /partner/earnings — Mingla partner earnings screen. ORCH-1052 + ORCH-1054.
 *
 * Visible only to flagged Mingla partners (creator_accounts.partner_enabled =
 * true). Surfaces:
 *  - Partner Stripe Connect status (not connected → CTA, onboarding → resume,
 *    active → managed)
 *  - ORCH-1054: live partner_splits ledger. Per-currency totals (no FX),
 *    per-month + per-brand breakdowns, status badges, empty state on no
 *    splits yet. Multi-currency safe — each currency renders in its own
 *    section.
 *
 * Non-partners hit a friendly empty state directing them to support.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";

import {
  usePartnerStripeStatus,
  useStartPartnerStripeOnboarding,
} from "../../src/hooks/usePartnerStripe";
import {
  usePartnerEarningsSummary,
  usePartnerSplits,
} from "../../src/hooks/usePartnerSplits";
import type {
  PartnerSplitRow,
  PartnerSplitStatus,
} from "../../src/services/partnerSplitsService";
import {
  colors,
  accent,
  spacing,
  radius,
  typography,
} from "../../src/constants/designSystem";

const RETURN_DEEP_LINK = "mingla-business://partner-onboarding-complete";

export default function PartnerEarningsScreen(): React.ReactElement {
  const router = useRouter();
  const statusQuery = usePartnerStripeStatus();
  const startOnboarding = useStartPartnerStripeOnboarding();

  const handleStartOnboarding = useCallback(async () => {
    if (!statusQuery.data) return;
    const country = statusQuery.data.partner_country ?? "GB";
    try {
      const result = await startOnboarding.mutateAsync({
        country,
        returnUrl: RETURN_DEEP_LINK,
      });
      if (Platform.OS === "web") {
        // Web: navigate inline.
        if (typeof window !== "undefined") {
          window.location.href = result.onboarding_url;
        }
      } else {
        // Native: open via expo-web-browser auth session.
        await WebBrowser.openAuthSessionAsync(
          result.onboarding_url,
          RETURN_DEEP_LINK,
        );
        // On return, refresh status.
        statusQuery.refetch();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[partner/earnings] onboarding launch failed:", message);
    }
  }, [statusQuery, startOnboarding]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <Stack.Screen
        options={{
          title: "Partner earnings",
          headerBackTitleVisible: false,
        }}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.h1}>Partner earnings</Text>

        {statusQuery.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={accent.warm} />
          </View>
        ) : statusQuery.error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Couldn’t load partner status</Text>
            <Text style={styles.errorBody}>{statusQuery.error.message}</Text>
            <Pressable
              accessibilityLabel="Retry"
              style={styles.secondaryBtn}
              onPress={() => statusQuery.refetch()}
            >
              <Text style={styles.secondaryBtnText}>Retry</Text>
            </Pressable>
          </View>
        ) : statusQuery.data?.partner_enabled === false ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Not a Mingla partner yet</Text>
            <Text style={styles.emptyBody}>
              Mingla partners earn a share of every paid event they help bring
              in. Want in? Email{" "}
              <Text
                style={styles.link}
                onPress={() => Linking.openURL("mailto:partners@usemingla.com")}
              >
                partners@usemingla.com
              </Text>
              .
            </Text>
          </View>
        ) : (
          <>
            <StatusBlock
              status={statusQuery.data?.status ?? "not_connected"}
              country={statusQuery.data?.country ?? null}
              externalCurrencies={
                statusQuery.data?.external_account_currencies ?? []
              }
              onStart={handleStartOnboarding}
              starting={startOnboarding.isPending}
              startError={startOnboarding.error?.message ?? null}
            />
            <PartnerSplitsSection />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * ORCH-1054 — partner_splits live ledger UI.
 *
 * Renders:
 *  - per-currency totals (transferred + pending + reversed; no FX between
 *    currencies per I-PROPOSED-PARTNER-TRANSFER-SOURCE-CURRENCY)
 *  - month + currency filter chips
 *  - per-split rows with status badge
 *  - empty state when the partner has no splits yet
 */
function PartnerSplitsSection(): React.ReactElement {
  const [currencyFilter, setCurrencyFilter] = useState<string | null>(null);
  const summaryQuery = usePartnerEarningsSummary();
  const splitsQuery = usePartnerSplits(
    currencyFilter ? { currency: currencyFilter } : {},
  );

  const availableCurrencies = useMemo(() => {
    const set = new Set<string>();
    for (const bucket of summaryQuery.data?.totals_by_currency ?? []) {
      set.add(bucket.currency);
    }
    return Array.from(set).sort();
  }, [summaryQuery.data]);

  if (summaryQuery.isLoading) {
    return (
      <View style={styles.splitsCard}>
        <Text style={styles.cardTitle}>Splits</Text>
        <ActivityIndicator color={accent.warm} />
      </View>
    );
  }

  if (summaryQuery.error) {
    return (
      <View style={styles.errorCard}>
        <Text style={styles.errorTitle}>Couldn’t load splits</Text>
        <Text style={styles.errorBody}>{summaryQuery.error.message}</Text>
      </View>
    );
  }

  const totals = summaryQuery.data?.totals_by_currency ?? [];
  const splits = splitsQuery.data ?? [];

  if (totals.length === 0) {
    return (
      <View style={styles.splitsCard}>
        <Text style={styles.cardTitle}>Splits</Text>
        <Text style={styles.cardBody}>
          No splits yet. As soon as a partnered event sells tickets, your
          share lands here automatically.
        </Text>
      </View>
    );
  }

  return (
    <>
      <View style={styles.splitsCard}>
        <Text style={styles.cardTitle}>Earnings by currency</Text>
        {totals.map((bucket) => (
          <View key={bucket.currency} style={styles.currencyRow}>
            <Text style={styles.currencyLabel}>
              {bucket.currency.toUpperCase()}
            </Text>
            <View style={styles.currencyValues}>
              <Text style={styles.currencyTransferred}>
                Paid {formatCents(bucket.transferred_cents, bucket.currency)}
              </Text>
              {bucket.pending_cents > 0 ? (
                <Text style={styles.currencyPending}>
                  Pending {formatCents(bucket.pending_cents, bucket.currency)}
                </Text>
              ) : null}
              {bucket.reversed_cents > 0 ? (
                <Text style={styles.currencyReversed}>
                  Reversed {formatCents(bucket.reversed_cents, bucket.currency)}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      {availableCurrencies.length > 1 ? (
        <View style={styles.filterRow}>
          <Pressable
            accessibilityLabel="Show all currencies"
            style={[
              styles.filterChip,
              currencyFilter === null && styles.filterChipActive,
            ]}
            onPress={() => setCurrencyFilter(null)}
          >
            <Text style={styles.filterChipText}>All</Text>
          </Pressable>
          {availableCurrencies.map((cur) => (
            <Pressable
              key={cur}
              accessibilityLabel={`Filter ${cur}`}
              style={[
                styles.filterChip,
                currencyFilter === cur && styles.filterChipActive,
              ]}
              onPress={() => setCurrencyFilter(cur)}
            >
              <Text style={styles.filterChipText}>{cur.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.splitsCard}>
        <Text style={styles.cardTitle}>Recent splits</Text>
        {splits.length === 0 ? (
          <Text style={styles.cardBody}>
            No splits in this filter. Try clearing the currency filter.
          </Text>
        ) : (
          splits.map((row) => <SplitRow key={row.id} row={row} />)
        )}
      </View>
    </>
  );
}

function SplitRow({ row }: { row: PartnerSplitRow }): React.ReactElement {
  return (
    <View style={styles.splitRow}>
      <View style={styles.splitRowLeft}>
        <Text style={styles.splitAmount}>
          {formatCents(row.partner_share_cents, row.transfer_currency)}
        </Text>
        <Text style={styles.splitMeta}>
          {new Date(row.created_at).toLocaleDateString()} · order {row.order_id.slice(0, 8)}
        </Text>
      </View>
      <StatusBadge status={row.status} />
    </View>
  );
}

function StatusBadge({ status }: { status: PartnerSplitStatus }): React.ReactElement {
  const map: Record<PartnerSplitStatus, { label: string; color: string; bg: string }> = {
    transferred: { label: "Transferred", color: "#065F46", bg: "#D1FAE5" },
    pending: { label: "Pending", color: "#92400E", bg: "#FEF3C7" },
    blocked_currency_mismatch: { label: "Blocked — currency", color: "#7F1D1D", bg: "#FEE2E2" },
    blocked_no_stripe: { label: "Blocked — Stripe", color: "#7F1D1D", bg: "#FEE2E2" },
    failed: { label: "Failed", color: "#7F1D1D", bg: "#FEE2E2" },
    reversed: { label: "Reversed", color: "#475569", bg: "#E2E8F0" },
    reversed_pending: { label: "Reversed (pending)", color: "#475569", bg: "#E2E8F0" },
  };
  const cfg = map[status];
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

function formatCents(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
      currencyDisplay: "narrowSymbol",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function StatusBlock(props: {
  status: string;
  country: string | null;
  externalCurrencies: string[];
  onStart: () => void;
  starting: boolean;
  startError: string | null;
}): React.ReactElement {
  const { status, country, externalCurrencies, onStart, starting, startError } =
    props;

  if (status === "active") {
    return (
      <View style={styles.statusCardActive}>
        <Text style={styles.cardTitle}>Payouts ready</Text>
        <Text style={styles.cardBody}>
          Your partner Stripe account is active
          {country ? ` (${country})` : ""}.
          {externalCurrencies.length > 0
            ? ` We can settle in ${externalCurrencies.join(", ").toUpperCase()}.`
            : ""}
        </Text>
      </View>
    );
  }

  if (status === "restricted") {
    return (
      <View style={styles.statusCard}>
        <Text style={styles.cardTitle}>Stripe needs more info</Text>
        <Text style={styles.cardBody}>
          Open your partner Stripe to finish the requirements Stripe is
          waiting on.
        </Text>
        <Pressable
          accessibilityLabel="Resume Stripe onboarding"
          style={styles.primaryBtn}
          onPress={onStart}
          disabled={starting}
        >
          <Text style={styles.primaryBtnText}>
            {starting ? "Opening…" : "Resume onboarding"}
          </Text>
        </Pressable>
        {startError ? <Text style={styles.errorBody}>{startError}</Text> : null}
      </View>
    );
  }

  if (status === "onboarding") {
    return (
      <View style={styles.statusCard}>
        <Text style={styles.cardTitle}>Finish setting up payouts</Text>
        <Text style={styles.cardBody}>
          You started Stripe onboarding. Pick up where you left off.
        </Text>
        <Pressable
          accessibilityLabel="Resume Stripe onboarding"
          style={styles.primaryBtn}
          onPress={onStart}
          disabled={starting}
        >
          <Text style={styles.primaryBtnText}>
            {starting ? "Opening…" : "Resume onboarding"}
          </Text>
        </Pressable>
        {startError ? <Text style={styles.errorBody}>{startError}</Text> : null}
      </View>
    );
  }

  // not_connected
  return (
    <View style={styles.statusCard}>
      <Text style={styles.cardTitle}>Connect partner Stripe</Text>
      <Text style={styles.cardBody}>
        Mingla pays partners through Stripe Connect. Set up your payout
        account once — your bank details go directly to Stripe, never to
        Mingla.
      </Text>
      <Pressable
        accessibilityLabel="Connect Stripe"
        style={styles.primaryBtn}
        onPress={onStart}
        disabled={starting}
      >
        <Text style={styles.primaryBtnText}>
          {starting ? "Opening…" : "Connect Stripe"}
        </Text>
      </Pressable>
      {startError ? <Text style={styles.errorBody}>{startError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background ?? "#FAFAFA" },
  scroll: { padding: spacing.lg ?? 16, gap: spacing.md ?? 12 },
  center: { paddingVertical: 48, alignItems: "center" },
  h1: {
    fontSize: 26,
    fontWeight: "700",
    color: colors.text ?? "#0F172A",
    marginBottom: spacing.md ?? 12,
  },
  statusCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.lg ?? 12,
    padding: spacing.lg ?? 16,
    gap: spacing.sm ?? 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  statusCardActive: {
    backgroundColor: "#F0FDF4",
    borderRadius: radius.lg ?? 12,
    padding: spacing.lg ?? 16,
    gap: spacing.sm ?? 8,
    borderWidth: 1,
    borderColor: "#86EFAC",
  },
  splitsCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.lg ?? 12,
    padding: spacing.lg ?? 16,
    gap: spacing.sm ?? 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.lg ?? 12,
    padding: spacing.lg ?? 16,
    gap: spacing.sm ?? 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  errorCard: {
    backgroundColor: "#FEF2F2",
    borderRadius: radius.lg ?? 12,
    padding: spacing.lg ?? 16,
    gap: spacing.sm ?? 8,
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text ?? "#0F172A",
  },
  cardBody: {
    fontSize: 15,
    lineHeight: 22,
    color: "#475569",
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text ?? "#0F172A",
  },
  emptyBody: { fontSize: 15, lineHeight: 22, color: "#475569" },
  errorTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#7F1D1D",
  },
  errorBody: { fontSize: 14, color: "#7F1D1D" },
  link: { color: accent.warm ?? "#eb7825", textDecorationLine: "underline" },
  primaryBtn: {
    backgroundColor: accent.warm ?? "#eb7825",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: radius.md ?? 8,
    alignItems: "center",
    marginTop: spacing.sm ?? 8,
  },
  primaryBtnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  secondaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.md ?? 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    marginTop: spacing.sm ?? 8,
  },
  secondaryBtnText: { color: "#0F172A", fontSize: 15, fontWeight: "500" },
  // ORCH-1054 partner_splits ledger
  currencyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  currencyLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
  },
  currencyValues: { alignItems: "flex-end" },
  currencyTransferred: { fontSize: 16, fontWeight: "600", color: "#065F46" },
  currencyPending: { fontSize: 13, color: "#92400E" },
  currencyReversed: { fontSize: 13, color: "#475569" },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
  },
  filterChipActive: {
    backgroundColor: accent.warm ?? "#eb7825",
    borderColor: accent.warm ?? "#eb7825",
  },
  filterChipText: { fontSize: 13, fontWeight: "500", color: "#0F172A" },
  splitRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  splitRowLeft: { flex: 1, paddingRight: 8 },
  splitAmount: { fontSize: 15, fontWeight: "600", color: "#0F172A" },
  splitMeta: { fontSize: 12, color: "#64748B", marginTop: 2 },
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  badgeText: { fontSize: 12, fontWeight: "600" },
});
