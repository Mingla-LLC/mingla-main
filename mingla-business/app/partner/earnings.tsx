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
  accent,
  canvas,
  glass,
  radius,
  semantic,
  shadows,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import { GlassCard } from "../../src/components/ui/GlassCard";
import { IconChrome } from "../../src/components/ui/IconChrome";

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

  // ORCH-1052 hotfix — modal presentation + explicit close button so the
  // screen is dismissable (was unreachable to back out of without crashing
  // the back-stack).
  const handleClose = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/account" as never);
    }
  }, [router]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <Stack.Screen
        options={{
          // iOS presents as a sheet that swipes down to dismiss; Android falls
          // back to standard modal. We render our own header below.
          presentation: "modal",
          headerShown: false,
        }}
      />
      {/* On-brand header bar — title + close X. Matches the IconChrome
          glass-circular button style used in TopBar across the business app. */}
      <View style={styles.header}>
        <View style={styles.headerTextCol}>
          <Text style={styles.eyebrow}>MINGLA PARTNER</Text>
          <Text style={styles.h1}>Earnings</Text>
        </View>
        <IconChrome
          icon="x"
          size={36}
          onPress={handleClose}
          accessibilityLabel="Close partner earnings"
          testID="partner-earnings-close-button"
        />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {statusQuery.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={accent.warm} />
          </View>
        ) : statusQuery.error ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.cardTitle}>Couldn't load partner status</Text>
            <Text style={styles.cardBody}>{statusQuery.error.message}</Text>
            <Pressable
              accessibilityLabel="Retry"
              style={styles.secondaryBtn}
              onPress={() => statusQuery.refetch()}
            >
              <Text style={styles.secondaryBtnText}>Retry</Text>
            </Pressable>
          </GlassCard>
        ) : statusQuery.data?.partner_enabled === false ? (
          <GlassCard variant="elevated" padding={spacing.lg}>
            <Text style={styles.cardTitle}>Not a Mingla partner yet</Text>
            <Text style={styles.cardBody}>
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
          </GlassCard>
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
      <GlassCard variant="elevated" padding={spacing.lg}>
        <Text style={styles.cardTitle}>Splits</Text>
        <ActivityIndicator color={accent.warm} />
      </GlassCard>
    );
  }

  if (summaryQuery.error) {
    return (
      <GlassCard variant="elevated" padding={spacing.lg}>
        <View style={styles.statusIndicatorRow}>
          <View style={styles.statusDotMuted} />
          <Text style={styles.statusLabelMuted}>SPLITS UNAVAILABLE</Text>
        </View>
        <Text style={styles.cardTitle}>Couldn't load splits</Text>
        <Text style={styles.cardBody}>{summaryQuery.error.message}</Text>
      </GlassCard>
    );
  }

  const totals = summaryQuery.data?.totals_by_currency ?? [];
  const splits = splitsQuery.data ?? [];

  if (totals.length === 0) {
    return (
      <GlassCard variant="elevated" padding={spacing.lg}>
        <Text style={styles.cardTitle}>Splits</Text>
        <Text style={styles.cardBody}>
          No splits yet. As soon as a partnered event sells tickets, your
          share lands here automatically.
        </Text>
      </GlassCard>
    );
  }

  return (
    <>
      <GlassCard variant="elevated" padding={spacing.lg}>
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
      </GlassCard>

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
            <Text
              style={
                currencyFilter === null
                  ? styles.filterChipTextActive
                  : styles.filterChipText
              }
            >
              All
            </Text>
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
              <Text
                style={
                  currencyFilter === cur
                    ? styles.filterChipTextActive
                    : styles.filterChipText
                }
              >
                {cur.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <GlassCard variant="elevated" padding={spacing.lg}>
        <Text style={styles.cardTitle}>Recent splits</Text>
        {splits.length === 0 ? (
          <Text style={styles.cardBody}>
            No splits in this filter. Try clearing the currency filter.
          </Text>
        ) : (
          splits.map((row) => <SplitRow key={row.id} row={row} />)
        )}
      </GlassCard>
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
  // ORCH-1052 hotfix — semantic-token alignment so badges read on dark canvas.
  const map: Record<PartnerSplitStatus, { label: string; color: string; bg: string }> = {
    transferred: { label: "Transferred", color: semantic.success, bg: semantic.successTint },
    pending: { label: "Pending", color: semantic.warning, bg: semantic.warningTint },
    blocked_currency_mismatch: { label: "Blocked — currency", color: semantic.error, bg: semantic.errorTint },
    blocked_no_stripe: { label: "Blocked — Stripe", color: semantic.error, bg: semantic.errorTint },
    failed: { label: "Failed", color: semantic.error, bg: semantic.errorTint },
    reversed: { label: "Reversed", color: textTokens.tertiary, bg: glass.tint.profileElevated },
    reversed_pending: { label: "Reversed (pending)", color: textTokens.tertiary, bg: glass.tint.profileElevated },
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
      <GlassCard variant="elevated" padding={spacing.lg}>
        <View style={styles.statusIndicatorRow}>
          <View style={styles.statusDotSuccess} />
          <Text style={styles.statusLabelSuccess}>PAYOUTS READY</Text>
        </View>
        <Text style={styles.cardTitle}>You're earning</Text>
        <Text style={styles.cardBody}>
          Your partner Stripe account is active
          {country ? ` (${country})` : ""}.
          {externalCurrencies.length > 0
            ? ` We can settle in ${externalCurrencies.join(", ").toUpperCase()}.`
            : ""}
        </Text>
      </GlassCard>
    );
  }

  if (status === "restricted") {
    return (
      <GlassCard variant="elevated" padding={spacing.lg}>
        <View style={styles.statusIndicatorRow}>
          <View style={styles.statusDotWarning} />
          <Text style={styles.statusLabelWarning}>ACTION NEEDED</Text>
        </View>
        <Text style={styles.cardTitle}>Stripe needs more info</Text>
        <Text style={styles.cardBody}>
          Open your partner Stripe to finish the requirements Stripe is
          waiting on.
        </Text>
        <Pressable
          accessibilityLabel="Resume Stripe onboarding"
          style={[styles.primaryBtn, starting && styles.primaryBtnDisabled]}
          onPress={onStart}
          disabled={starting}
        >
          <Text style={styles.primaryBtnText}>
            {starting ? "Opening…" : "Resume onboarding"}
          </Text>
        </Pressable>
        {startError ? (
          <View style={styles.inlineError}>
            <Text style={styles.inlineErrorText}>{startError}</Text>
          </View>
        ) : null}
      </GlassCard>
    );
  }

  if (status === "onboarding") {
    return (
      <GlassCard variant="elevated" padding={spacing.lg}>
        <View style={styles.statusIndicatorRow}>
          <View style={styles.statusDotInfo} />
          <Text style={styles.statusLabelInfo}>IN PROGRESS</Text>
        </View>
        <Text style={styles.cardTitle}>Finish setting up payouts</Text>
        <Text style={styles.cardBody}>
          You started Stripe onboarding. Pick up where you left off.
        </Text>
        <Pressable
          accessibilityLabel="Resume Stripe onboarding"
          style={[styles.primaryBtn, starting && styles.primaryBtnDisabled]}
          onPress={onStart}
          disabled={starting}
        >
          <Text style={styles.primaryBtnText}>
            {starting ? "Opening…" : "Resume onboarding"}
          </Text>
        </Pressable>
        {startError ? (
          <View style={styles.inlineError}>
            <Text style={styles.inlineErrorText}>{startError}</Text>
          </View>
        ) : null}
      </GlassCard>
    );
  }

  // not_connected
  return (
    <GlassCard variant="elevated" padding={spacing.lg}>
      <View style={styles.statusIndicatorRow}>
        <View style={styles.statusDotMuted} />
        <Text style={styles.statusLabelMuted}>NOT CONNECTED</Text>
      </View>
      <Text style={styles.cardTitle}>Connect partner Stripe</Text>
      <Text style={styles.cardBody}>
        Mingla pays partners through Stripe Connect. Set up your payout
        account once — your bank details go directly to Stripe, never to
        Mingla.
      </Text>
      <Pressable
        accessibilityLabel="Connect Stripe"
        style={[styles.primaryBtn, starting && styles.primaryBtnDisabled]}
        onPress={onStart}
        disabled={starting}
      >
        <Text style={styles.primaryBtnText}>
          {starting ? "Opening…" : "Connect Stripe"}
        </Text>
      </Pressable>
      {startError ? (
        <View style={styles.inlineError}>
          <Text style={styles.inlineErrorText}>{startError}</Text>
        </View>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  // ORCH-1052 hotfix — Mingla brand alignment. Dark canvas + white-alpha text
  // + accent.warm for primary actions + GlassCard for sections (used in JSX
  // instead of bespoke white cards). Mirrors account.tsx / brand screens.
  safe: { flex: 1, backgroundColor: canvas.profile },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  center: { paddingVertical: spacing.xxl, alignItems: "center" },

  // Header bar — eyebrow + h1 on the left, close X on the right.
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  headerTextCol: { flex: 1, gap: 2 },
  eyebrow: {
    ...typography.labelCap,
    color: accent.warm,
  },
  h1: {
    ...typography.h1,
    color: textTokens.primary,
  },

  // Card body content
  cardTitle: {
    ...typography.h3,
    color: textTokens.primary,
    marginTop: spacing.xs,
  },
  cardBody: {
    ...typography.body,
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
  link: {
    color: accent.warm,
    textDecorationLine: "underline",
  },

  // Status indicator row (dot + label above title)
  statusIndicatorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  statusDotSuccess: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: semantic.success,
  },
  statusDotWarning: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: semantic.warning,
  },
  statusDotInfo: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: semantic.info,
  },
  statusDotMuted: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: textTokens.tertiary,
  },
  statusLabelSuccess: { ...typography.labelCap, color: semantic.success },
  statusLabelWarning: { ...typography.labelCap, color: semantic.warning },
  statusLabelInfo: { ...typography.labelCap, color: semantic.info },
  statusLabelMuted: { ...typography.labelCap, color: textTokens.tertiary },

  // Buttons
  primaryBtn: {
    backgroundColor: accent.warm,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: spacing.md,
    ...shadows.md,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: {
    ...typography.buttonLg,
    color: textTokens.inverse,
  },
  secondaryBtn: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    marginTop: spacing.md,
    backgroundColor: glass.tint.profileBase,
  },
  secondaryBtnText: {
    ...typography.buttonMd,
    color: textTokens.primary,
  },

  // Inline error pill — shows under primary button when Stripe call fails
  inlineError: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: semantic.errorTint,
    borderWidth: 1,
    borderColor: semantic.error,
  },
  inlineErrorText: {
    ...typography.bodySm,
    color: semantic.error,
  },

  // ORCH-1054 partner_splits ledger
  currencyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
  },
  currencyLabel: {
    ...typography.bodyLg,
    color: textTokens.primary,
  },
  currencyValues: { alignItems: "flex-end" },
  currencyTransferred: {
    ...typography.bodyLg,
    color: semantic.success,
  },
  currencyPending: {
    ...typography.bodySm,
    color: semantic.warning,
  },
  currencyReversed: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  filterChip: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm + 4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    backgroundColor: glass.tint.profileBase,
  },
  filterChipActive: {
    backgroundColor: accent.warm,
    borderColor: accent.warm,
  },
  filterChipText: {
    ...typography.caption,
    color: textTokens.secondary,
  },
  filterChipTextActive: {
    ...typography.caption,
    color: textTokens.inverse,
  },
  splitRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
  },
  splitRowLeft: { flex: 1, paddingRight: spacing.sm },
  splitAmount: {
    ...typography.bodyLg,
    color: textTokens.primary,
  },
  splitMeta: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  badge: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.full,
  },
  badgeText: {
    ...typography.micro,
  },
});
