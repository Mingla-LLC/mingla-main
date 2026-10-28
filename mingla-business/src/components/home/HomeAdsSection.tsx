import { useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  canvas,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  trafficAnalytics,
  typography,
} from "../../constants/designSystem";
import { useHostAdCampaigns } from "../../hooks/marketing/useHostAdCampaigns";
import { useBrandTrafficRollup } from "../../hooks/useTrafficAnalytics";
import { useHostAdPermissions } from "../../hooks/useHostAdPermissions";
import {
  pauseHostAdCampaign,
  type HostAdCampaign,
} from "../../services/hostAdCampaignService";
import { currencyCodeOrNull, formatCurrencyRound } from "../../utils/currency";
import {
  homeAdAttentionCopy,
  homeAdCanPause,
  homeAdNetworkList,
  homeAdStatusLabel,
  homeAdTileSpan,
  selectHomeAdCampaigns,
} from "../../utils/homeAdLifecycle";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";

interface HomeAdsSectionProps {
  brandId: string;
}

type CurrencyTotals = Map<string, { spent: number; budget: number }>;

const dateLabel = (value: string | null): string | null => {
  if (value === null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
};

const campaignCurrencies = (
  campaign: HostAdCampaign,
): { currency: string; spent: number; budget: number }[] => {
  const currency = currencyCodeOrNull(campaign.currency);
  const budget = campaign.cap_cents ?? campaign.lifetime_budget_cents ?? 0;
  if (currency !== null && campaign.host_spend_equivalent_cents !== null) {
    return [{
      currency,
      spent: campaign.host_spend_equivalent_cents,
      budget,
    }];
  }
  const byCurrency = campaign.spend_by_currency.map((row) => ({
    currency: row.currency.toUpperCase(),
    spent: row.spend_cents,
    budget: row.currency.toUpperCase() === currency ? budget : 0,
  }));
  if (byCurrency.length > 0) return byCurrency;
  return currency === null ? [] : [{ currency, spent: 0, budget }];
};

const summaryTotals = (campaigns: readonly HostAdCampaign[]): CurrencyTotals => {
  const totals: CurrencyTotals = new Map();
  for (const campaign of campaigns) {
    for (const row of campaignCurrencies(campaign)) {
      const current = totals.get(row.currency) ?? { spent: 0, budget: 0 };
      totals.set(row.currency, {
        spent: current.spent + row.spent,
        budget: current.budget + row.budget,
      });
    }
  }
  return totals;
};

const currencyLines = (values: Record<string, number>, suffix: string) =>
  Object.entries(values)
    .filter(([, value]) => value > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, value]) =>
      `${formatCurrencyRound(value, currency, true)}${suffix.length > 0 ? ` ${suffix}` : ""}`
    );

const StatusPill: React.FC<{ campaign: HostAdCampaign }> = ({ campaign }) => {
  const attention = campaign.lifecycle === "needs_attention";
  const live = campaign.lifecycle === "live";
  return (
    <View
      style={[
        styles.statusPill,
        attention && styles.attentionPill,
        live && styles.livePill,
      ]}
    >
      <View
        style={[
          styles.statusDot,
          attention && styles.attentionDot,
          live && styles.liveDot,
        ]}
      />
      <Text style={styles.statusLabel}>{homeAdStatusLabel(campaign)}</Text>
    </View>
  );
};

const Identity: React.FC<{ campaign: HostAdCampaign }> = ({ campaign }) => {
  const platforms = campaign.platforms.length > 0
    ? campaign.platforms
    : [campaign.platform];
  return (
    <View style={styles.identity}>
      {campaign.creative?.preview_url ? (
        <Image
          source={{ uri: campaign.creative.preview_url }}
          style={styles.thumbnail}
          accessibilityIgnoresInvertColors
          accessible={false}
        />
      ) : null}
      <View style={styles.identityCopy}>
        <Text style={styles.name} numberOfLines={1}>{campaign.name}</Text>
        <Text style={styles.networks} numberOfLines={1}>
          {homeAdNetworkList(platforms)}
        </Text>
      </View>
      <StatusPill campaign={campaign} />
    </View>
  );
};

const Results: React.FC<{ campaign: HostAdCampaign; compact?: boolean }> = ({
  campaign,
  compact = false,
}) => {
  const salesLines = currencyLines(
    campaign.results_value_cents ?? {},
    "in sales",
  );
  const attention = campaign.lifecycle === "needs_attention";
  const resultCount = campaign.primary_result_count > 0
    ? campaign.primary_result_count.toLocaleString("en-GB")
    : null;
  const resultSuffix = resultCount === null
    ? null
    : `${campaign.primary_result_label}${
      campaign.cost_per_result_cents !== null && campaign.currency !== null
        ? ` · ${formatCurrencyRound(campaign.cost_per_result_cents, campaign.currency, true)} each`
        : ""
    }`;
  if (compact) {
    const start = dateLabel(campaign.starts_at);
    const cap = campaign.cap_cents ?? campaign.lifetime_budget_cents;
    const scheduled = start !== null && cap !== null && campaign.currency !== null
      ? `Starts ${start} · ${formatCurrencyRound(cap, campaign.currency, true)} budget`
      : null;
    const compactResult = resultCount === null
      ? null
      : `${resultCount} ${campaign.primary_result_label}`;
    const line = compactResult !== null
      ? [compactResult, ...salesLines].join(" · ")
      : attention
        ? homeAdAttentionCopy(campaign.next_action)
        : scheduled;
    return line === null ? null : (
      <Text
        style={[styles.compactLine, attention && styles.attentionText]}
        numberOfLines={2}
      >
        {line}
      </Text>
    );
  }
  if (resultCount === null && salesLines.length === 0 && !attention) return null;
  return (
    <View style={styles.results}>
      {resultCount === null || resultSuffix === null ? null : (
        <View style={styles.resultLine}>
          <Text style={styles.resultCount}>{resultCount}</Text>
          <Text style={styles.resultSuffix}>{resultSuffix}</Text>
        </View>
      )}
      {salesLines.map((line) => (
        <Text key={line} style={styles.salesLine}>{line}</Text>
      ))}
      {attention ? (
        <Text style={styles.attentionText}>
          {homeAdAttentionCopy(campaign.next_action)}
        </Text>
      ) : null}
    </View>
  );
};

const Budget: React.FC<{ campaign: HostAdCampaign; compact?: boolean }> = ({
  campaign,
  compact = false,
}) => {
  const rows = campaignCurrencies(campaign);
  const hasSpend = rows.some((row) => row.spent > 0);
  if (!hasSpend) {
    if (compact) return null;
    const start = dateLabel(campaign.starts_at);
    const cap = campaign.cap_cents ?? campaign.lifetime_budget_cents;
    return start !== null && cap !== null && campaign.currency !== null ? (
      <Text style={styles.budgetLine}>
        {`Starts ${start} · ${formatCurrencyRound(cap, campaign.currency, true)} budget`}
      </Text>
    ) : null;
  }
  return (
    <View style={styles.budgetBlock}>
      {rows.filter((row) => row.spent > 0).map((row) => {
        const comparable = row.budget > 0;
        const percent = comparable
          ? Math.min(100, Math.round((row.spent / row.budget) * 100))
          : null;
        return (
          <View key={row.currency} style={styles.budgetCurrency}>
            <View style={styles.budgetLabelRow}>
              <Text style={styles.budgetLine}>
                {comparable
                  ? `${formatCurrencyRound(row.spent, row.currency, true)} of ${formatCurrencyRound(row.budget, row.currency, true)} spent`
                  : `${formatCurrencyRound(row.spent, row.currency, true)} spent`}
              </Text>
              {percent === null ? null : (
                <Text style={styles.percent}>{percent}%</Text>
              )}
            </View>
            {percent === null ? null : (
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${percent}%` }]} />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
};

export const HomeAdsSection: React.FC<HomeAdsSectionProps> = ({ brandId }) => {
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
  const permissions = useHostAdPermissions(brandId);
  const ads = useHostAdCampaigns(permissions.canRead ? brandId : null);
  const traffic = useBrandTrafficRollup(
    permissions.canRead ? brandId : null,
    "30d",
    permissions.canRead,
  );
  const activeCampaigns = useMemo(
    () => selectHomeAdCampaigns(ads.campaigns, Number.MAX_SAFE_INTEGER),
    [ads.campaigns],
  );
  const campaigns = activeCampaigns.slice(0, 4);
  const totals = useMemo(() => summaryTotals(campaigns), [campaigns]);
  const [busyCampaignId, setBusyCampaignId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const adSales = traffic.data?.sources.find((row) =>
    row.source === "mingla_ads"
  )?.valueByCurrency ?? {};
  const salesLines = currencyLines(adSales, "");
  const spendLines = [...totals.entries()]
    .filter(([, total]) => total.spent > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, total]) =>
      total.budget > 0
        ? `${formatCurrencyRound(total.spent, currency, true)} spent of ${formatCurrencyRound(total.budget, currency, true)} budget`
        : `${formatCurrencyRound(total.spent, currency, true)} spent`
    );

  const openAds = useCallback((): void => {
    router.push("/(tabs)/marketing/ads" as never);
  }, [router]);
  const openCampaign = useCallback((campaignId: string): void => {
    router.push(`/(tabs)/marketing/ads/${campaignId}` as never);
  }, [router]);
  const pause = useCallback(async (campaign: HostAdCampaign): Promise<void> => {
    if (!permissions.canPause) return;
    setBusyCampaignId(campaign.id);
    setActionError(null);
    try {
      await pauseHostAdCampaign({ brandId, campaignId: campaign.id });
      await ads.refetch();
    } catch {
      setActionError(`Could not pause ${campaign.name}. Try again from Ads.`);
    } finally {
      setBusyCampaignId(null);
    }
  }, [ads, brandId, permissions.canPause]);

  if (permissions.isLoading || permissions.isError || !permissions.canRead) {
    return null;
  }
  if (ads.isLoading) {
    return (
      <View style={styles.section} testID="home-ads-loading">
        <GlassCard variant="elevated" radius="xl">
          <View style={styles.skeletonRow}>
            <Skeleton width={40} height={40} radius="md" />
            <View style={styles.skeletonCopy}>
              <Skeleton width="45%" height={18} />
              <Skeleton width="78%" height={14} />
            </View>
          </View>
        </GlassCard>
      </View>
    );
  }
  if (ads.isError) {
    return (
      <View style={styles.section} testID="home-ads-error">
        <GlassCard variant="elevated" radius="xl">
          <Text style={styles.errorText}>
            Couldn&apos;t load your ads. Nothing was changed.
          </Text>
          <Pressable
            onPress={() => void ads.refetch()}
            accessibilityRole="button"
            style={styles.retry}
            testID="home-ads-retry"
          >
            <Text style={styles.link}>Retry</Text>
          </Pressable>
        </GlassCard>
      </View>
    );
  }
  if (campaigns.length === 0) return null;

  const viewAll = activeCampaigns.length > 4
    ? `View all ${activeCampaigns.length} ads ›`
    : "View all ›";
  const span = homeAdTileSpan(campaigns.length);
  const hasSummaryData = salesLines.length > 0 || spendLines.length > 0;
  const quietRow = campaigns.every((campaign) =>
    campaign.lifecycle === "scheduled" || campaign.lifecycle === "in_review"
  );
  return (
    <View
      style={[styles.section, !isWideDesktop && styles.sectionNarrow]}
      testID="home-ads-section"
    >
      <GlassCard
        variant="elevated"
        radius="xl"
        padding={0}
        testID="home-ads-card"
      >
        <View style={[
          styles.summary,
          hasSummaryData
            ? isWideDesktop
              ? styles.summaryWithDataWide
              : styles.summaryWithDataNarrow
            : styles.summaryCompact,
        ]}>
          <View style={styles.summaryCopy}>
            <Text style={styles.eyebrow}>ADS</Text>
            {salesLines.map((line, index) => (
              <View key={line} style={styles.salesSummaryRow}>
                <Text style={styles.salesSummary}>{line}</Text>
                {index === 0 ? (
                  <Text style={styles.summarySuffix}>
                    in sales from your ads · 30 days
                  </Text>
                ) : null}
              </View>
            ))}
            {spendLines.map((line) => (
              <Text key={line} style={styles.spendSummary}>{line}</Text>
            ))}
          </View>
          {isWideDesktop || !hasSummaryData ? (
            <Pressable
              onPress={openAds}
              accessibilityRole="button"
              accessibilityLabel={viewAll}
              style={styles.viewAll}
              testID="home-ads-view-all"
            >
              <Text style={styles.link}>{viewAll}</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={[styles.tiles, isWideDesktop && styles.tilesWide]}>
          {campaigns.map((campaign) => {
            const attention = campaign.lifecycle === "needs_attention";
            const live = campaign.lifecycle === "live";
            const isBusy = busyCampaignId === campaign.id;
            const end = dateLabel(campaign.ends_at);
            const pauseVisible = live && homeAdCanPause(campaign) &&
              permissions.canPause;
            const hasResults = attention || campaign.primary_result_count > 0 ||
              Object.values(campaign.results_value_cents ?? {}).some((value) => value > 0);
            return (
              <View
                key={campaign.plan_version_id ?? campaign.id}
                style={[
                  styles.tile,
                  isWideDesktop && { width: `${(span / 12) * 100}%` },
                  isWideDesktop && quietRow && styles.quietTile,
                  attention && styles.attentionTile,
                ]}
              >
                {isWideDesktop ? (
                  <>
                    <Pressable
                      onPress={() => openCampaign(campaign.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${campaign.name}`}
                      style={({ pressed }) => [
                        styles.desktopTile,
                        campaigns.length === 1 && styles.singleTile,
                        quietRow && styles.quietDesktopTile,
                        pressed && styles.pressed,
                      ]}
                      testID={`home-ad-${campaign.id}`}
                    >
                      <View style={styles.tileSection}><Identity campaign={campaign} /></View>
                      {hasResults ? (
                        <View style={styles.tileSection}><Results campaign={campaign} /></View>
                      ) : null}
                      <View style={[styles.tileSection, styles.tileFoot]}>
                        <Budget campaign={campaign} />
                        <View style={styles.actions}>
                          <Text style={styles.footnote}>
                            {live && end !== null
                              ? `Ends ${end}`
                              : campaign.lifecycle === "paused"
                                ? `Paused ${dateLabel(campaign.updated_at) ?? ""}`
                                : ""}
                          </Text>
                          {pauseVisible || attention ? (
                            <View style={styles.desktopActionSpacer} />
                          ) : null}
                        </View>
                      </View>
                    </Pressable>
                    {pauseVisible ? (
                      <Pressable
                        onPress={() => void pause(campaign)}
                        disabled={busyCampaignId !== null}
                        accessibilityRole="button"
                        accessibilityLabel={`Pause ${campaign.name}`}
                        style={[styles.pauseButton, styles.desktopActionOverlay]}
                        testID={`home-ad-pause-${campaign.id}`}
                      >
                        <Icon name="pause" size={15} color={textTokens.primary} />
                        <Text style={styles.actionText}>{isBusy ? "…" : "Pause"}</Text>
                      </Pressable>
                    ) : attention ? (
                      <Pressable
                        onPress={() => openCampaign(campaign.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Fix ${campaign.name}`}
                        style={[styles.fixButton, styles.desktopActionOverlay]}
                      >
                        <Text style={styles.fixText}>Fix</Text>
                      </Pressable>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Pressable
                      onPress={() => openCampaign(campaign.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${campaign.name}`}
                      style={({ pressed }) => [
                        styles.phoneRow,
                        attention && styles.attentionPhoneRow,
                        (live || campaign.lifecycle === "paused") &&
                          styles.resultsPhoneRow,
                        pressed && styles.pressed,
                      ]}
                      testID={`home-ad-${campaign.id}`}
                    >
                      {campaign.creative?.preview_url ? (
                        <Image
                          source={{ uri: campaign.creative.preview_url }}
                          style={styles.thumbnail}
                          accessible={false}
                        />
                      ) : null}
                      <View style={styles.phoneMiddle}>
                        <View style={styles.phoneTitleRow}>
                          <Text style={styles.name} numberOfLines={1}>{campaign.name}</Text>
                          <StatusPill campaign={campaign} />
                        </View>
                        <Results campaign={campaign} compact />
                        <Budget campaign={campaign} compact />
                      </View>
                      {pauseVisible || attention ? (
                        <View style={styles.phoneActionSpacer} />
                      ) : (
                        <Icon name="chevR" size={18} color={textTokens.tertiary} />
                      )}
                    </Pressable>
                    {pauseVisible ? (
                      <Pressable
                        onPress={() => void pause(campaign)}
                        disabled={busyCampaignId !== null}
                        accessibilityRole="button"
                        accessibilityLabel={`Pause ${campaign.name}`}
                        style={[styles.iconButton, styles.phoneActionOverlay]}
                        testID={`home-ad-pause-${campaign.id}`}
                      >
                        <Icon name="pause" size={18} color={textTokens.primary} />
                      </Pressable>
                    ) : attention ? (
                      <Pressable
                        onPress={() => openCampaign(campaign.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Fix ${campaign.name}`}
                        style={[styles.fixButton, styles.phoneActionOverlay]}
                      >
                        <Text style={styles.fixText}>Fix</Text>
                      </Pressable>
                    ) : null}
                  </>
                )}
              </View>
            );
          })}
          {!isWideDesktop && activeCampaigns.length > 4 ? (
            <Pressable
              onPress={openAds}
              accessibilityRole="button"
              accessibilityLabel={viewAll}
              style={styles.phoneViewAll}
            >
              <Text style={styles.link}>{viewAll}</Text>
            </Pressable>
          ) : null}
        </View>
        {actionError === null ? null : (
          <Text accessibilityRole="alert" style={styles.actionError}>
            {actionError}
          </Text>
        )}
      </GlassCard>
    </View>
  );
};

const styles = StyleSheet.create({
  section: { paddingHorizontal: spacing.md, marginBottom: spacing.md },
  sectionNarrow: { paddingHorizontal: spacing.sm + spacing.xs },
  summary: {
    minHeight: 72,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  summaryCopy: { flex: 1, minWidth: 0 },
  summaryWithDataWide: { minHeight: 120 },
  summaryWithDataNarrow: { minHeight: 138 },
  summaryCompact: { minHeight: 51, paddingVertical: 0 },
  eyebrow: { ...typography.labelCap, color: textTokens.tertiary },
  salesSummaryRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  salesSummary: {
    color: textTokens.primary,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  summarySuffix: { ...typography.bodySm, color: textTokens.secondary },
  spendSummary: { ...typography.caption, color: textTokens.secondary },
  viewAll: { minHeight: 44, justifyContent: "center" },
  link: { ...typography.bodySm, color: accent.warm, fontWeight: "600" },
  tiles: { borderTopWidth: 1, borderTopColor: glass.border.profileBase },
  tilesWide: { flexDirection: "row", alignItems: "stretch" },
  tile: {
    minWidth: 0,
    position: "relative",
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: glass.border.profileBase,
  },
  quietTile: { height: 118 },
  attentionTile: { backgroundColor: semantic.warningTint },
  pressed: { opacity: 0.72 },
  desktopTile: { flex: 1, minHeight: 255, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  singleTile: { minHeight: 124, flexDirection: "row", alignItems: "stretch", gap: spacing.lg },
  quietDesktopTile: { minHeight: 118, height: 118, flex: 0 },
  tileSection: { flex: 1, minWidth: 0 },
  tileFoot: { marginTop: "auto", paddingTop: spacing.md },
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  thumbnail: { width: 40, height: 40, borderRadius: radius.md, flexShrink: 0 },
  identityCopy: { flex: 1, minWidth: 0 },
  name: { ...typography.bodySm, color: textTokens.primary, fontWeight: "700", flexShrink: 1 },
  networks: { ...typography.caption, color: textTokens.tertiary },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.full,
    backgroundColor: glass.tint.profileElevated,
  },
  attentionPill: { backgroundColor: semantic.warningTint },
  livePill: { backgroundColor: semantic.successTint },
  statusDot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: textTokens.tertiary },
  attentionDot: { backgroundColor: semantic.warning },
  liveDot: { backgroundColor: semantic.success },
  statusLabel: { ...typography.micro, color: textTokens.primary },
  results: { marginTop: spacing.md, gap: spacing.xs },
  resultLine: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: spacing.xs },
  resultCount: { color: textTokens.primary, fontSize: 20, lineHeight: 26, fontWeight: "800", fontVariant: ["tabular-nums"] },
  resultSuffix: { ...typography.bodySm, color: textTokens.secondary },
  salesLine: { ...typography.bodySm, color: trafficAnalytics.positiveDelta, fontWeight: "700" },
  attentionText: { ...typography.bodySm, color: semantic.warning, marginTop: spacing.xs },
  budgetBlock: { gap: spacing.sm },
  budgetCurrency: { gap: spacing.xs },
  budgetLabelRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  budgetLine: { ...typography.caption, color: textTokens.secondary, flexShrink: 1 },
  percent: { ...typography.caption, color: textTokens.secondary, fontVariant: ["tabular-nums"] },
  track: { height: 5, borderRadius: radius.full, overflow: "hidden", backgroundColor: glass.border.profileElevated },
  fill: { height: "100%", borderRadius: radius.full, backgroundColor: accent.warm },
  actions: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  desktopActionSpacer: { width: 72, height: 44 },
  desktopActionOverlay: { position: "absolute", right: spacing.lg, bottom: spacing.md },
  footnote: { ...typography.caption, color: textTokens.tertiary, flex: 1 },
  pauseButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: glass.tint.profileElevated },
  actionText: { ...typography.caption, color: textTokens.primary, fontWeight: "700" },
  fixButton: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: semantic.warning },
  fixText: { ...typography.caption, color: canvas.discover, fontWeight: "700" },
  phoneRow: {
    minHeight: 80,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + spacing.xs,
    padding: spacing.md,
  },
  attentionPhoneRow: { minHeight: 135 },
  resultsPhoneRow: { minHeight: 115 },
  phoneMiddle: { flex: 1, minWidth: 0 },
  phoneActionSpacer: { width: 44, height: 44 },
  phoneActionOverlay: { position: "absolute", right: spacing.md, top: "50%", marginTop: -22 },
  phoneTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  compactLine: { ...typography.caption, color: textTokens.secondary, marginTop: spacing.xs },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: glass.tint.profileElevated },
  phoneViewAll: { minHeight: 52, alignItems: "center", justifyContent: "center" },
  actionError: { ...typography.bodySm, color: semantic.errorText, padding: spacing.md },
  errorText: { ...typography.bodySm, color: textTokens.primary },
  retry: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center" },
  skeletonRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  skeletonCopy: { flex: 1, gap: spacing.sm },
});

export default HomeAdsSection;
