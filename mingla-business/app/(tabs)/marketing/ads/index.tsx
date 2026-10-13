/**
 * toward #3697 Wave 7 — Blast → Ads (credit balance + history).
 *
 * Host campaigns / Ari plan-pay / live-ad Home cards land in follow-ups.
 * This surface consumes Wave 6 `ad-credit` for wallet truth.
 */

import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AdCreditLedgerRow } from "../../../../src/components/marketing/AdCreditLedgerRow";
import {
  AdCreditQuoteSheet,
  type AdCreditQuoteMode,
} from "../../../../src/components/marketing/AdCreditQuoteSheet";
import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { GlassCard } from "../../../../src/components/ui/GlassCard";
import {
  canvas,
  glass,
  spacing,
  text as textTokens,
  typography,
} from "../../../../src/constants/designSystem";
import { useAdCreditWallet } from "../../../../src/hooks/marketing/useAdCreditWallet";
import { useCanManageBrandPayments } from "../../../../src/hooks/useCanManageBrandPayments";
import { useCurrentBrand } from "../../../../src/hooks/useCurrentBrand";
import { formatCurrency } from "../../../../src/utils/currency";

export default function MarketingAdsRoute(): React.ReactElement {
  const brand = useCurrentBrand();
  const brandId = brand?.id ?? null;
  const walletQuery = useAdCreditWallet(brandId);
  const manage = useCanManageBrandPayments(brandId);
  const [sheetMode, setSheetMode] = useState<AdCreditQuoteMode | null>(null);

  const onRefresh = useCallback(() => {
    void walletQuery.refetch();
  }, [walletQuery]);

  if (brandId === null) {
    return (
      <View style={styles.host}>
        <EmptyState
          illustration="users"
          title="Pick a brand"
          description="Choose a brand to see Ads credit."
          testID="ads-no-brand"
        />
      </View>
    );
  }

  if (walletQuery.viewLoading || (!walletQuery.hasResolved && !walletQuery.isError)) {
    return (
      <View style={styles.host} testID="ads-skeleton">
        <ActivityIndicator color={textTokens.secondary} />
      </View>
    );
  }

  if (!walletQuery.canView) {
    return (
      <View style={styles.host}>
        <EmptyState
          illustration="users"
          title="Payments view required"
          description="Ask a brand owner or finance manager to open Ads credit."
          testID="ads-view-denied"
        />
      </View>
    );
  }

  if (walletQuery.isError) {
    return (
      <View style={styles.host}>
        <EmptyState
          illustration="users"
          title="Couldn't load Ads credit"
          description="Check your connection and try again."
          testID="ads-load-error"
          cta={{
            label: "Retry",
            onPress: () => {
              void walletQuery.refetch();
            },
          }}
        />
      </View>
    );
  }

  const wallet = walletQuery.data?.wallet;
  const history = walletQuery.data?.history ?? [];
  const currency = wallet?.currency ?? "USD";
  const balanceCents = wallet?.balance_cents ?? 0;

  return (
    <View style={styles.host} testID="ads-credit-screen">
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={walletQuery.isRefetching}
            onRefresh={onRefresh}
          />
        }
      >
        <GlassCard variant="elevated" padding={spacing.lg}>
          <Text style={styles.kicker}>Available credit</Text>
          <Text style={styles.balance} testID="ads-credit-balance">
            {formatCurrency(balanceCents, currency, true)}
          </Text>
          <Text style={styles.sub}>
            Top-ups keep 15% as Mingla's fee. Withdraw unused credit any time.
          </Text>
          <View style={styles.actions}>
            <Pressable
              style={styles.actionBtn}
              onPress={() => setSheetMode("top_up")}
              accessibilityRole="button"
              accessibilityLabel="Add Ads credit"
              testID="ads-add-credit"
            >
              <Text style={styles.actionLabel}>Add credit</Text>
            </Pressable>
            <Pressable
              style={styles.actionBtn}
              onPress={() => setSheetMode("withdraw")}
              accessibilityRole="button"
              accessibilityLabel="Withdraw Ads credit"
              testID="ads-withdraw"
            >
              <Text style={styles.actionLabel}>Withdraw</Text>
            </Pressable>
          </View>
        </GlassCard>

        <Text style={styles.sectionTitle}>History</Text>
        <GlassCard variant="base" padding={0}>
          {history.length === 0 ? (
            <View style={styles.emptyHistory} testID="ads-history-empty">
              <Text style={styles.emptyHistoryText}>
                No top-ups or withdrawals yet.
              </Text>
            </View>
          ) : (
            history.map((row) => (
              <AdCreditLedgerRow key={row.id} row={row} />
            ))
          )}
        </GlassCard>

        <Text style={styles.sectionTitle}>Your ads</Text>
        <GlassCard variant="base" padding={spacing.lg}>
          <Text style={styles.emptyHistoryText} testID="ads-campaigns-placeholder">
            Ad campaigns you run with Ari will list here. Plan and pay ships
            next.
          </Text>
        </GlassCard>
      </ScrollView>

      {sheetMode !== null ? (
        <AdCreditQuoteSheet
          visible
          mode={sheetMode}
          currency={currency}
          balanceCents={balanceCents}
          canManage={manage.allowed}
          onClose={() => setSheetMode(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  kicker: {
    ...typography.caption,
    color: textTokens.secondary,
  },
  balance: {
    ...typography.statValue,
    color: textTokens.primary,
    marginTop: spacing.xs,
  },
  sub: {
    ...typography.caption,
    color: textTokens.tertiary,
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: glass.tint.chrome.idle,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.chrome,
  },
  actionLabel: {
    ...typography.buttonMd,
    color: textTokens.primary,
  },
  sectionTitle: {
    ...typography.h3,
    color: textTokens.primary,
    marginTop: spacing.sm,
  },
  emptyHistory: {
    padding: spacing.lg,
  },
  emptyHistoryText: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
});
