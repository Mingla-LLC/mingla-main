import { useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius,
  trafficAnalytics,
  color,
  space,
  type,
} from "../../constants/designSystem";
import { useHostAdCampaigns } from "../../hooks/marketing/useHostAdCampaigns";
import { useBrandTrafficRollup } from "../../hooks/useTrafficAnalytics";
import { useHostAdPermissions } from "../../hooks/useHostAdPermissions";
import {
  pauseHostAdCampaign,
  type HostAdCampaign,
} from "../../services/hostAdCampaignService";
import { formatCurrencyRound } from "../../utils/currency";
import { hostAdPayFromCredit } from "../marketing/ads/hostAdBuilderModel";
import {
  campaignCurrencies,
  homeAdAttentionReason,
  homeAdCanPause,
  homeAdNetworkList,
  homeAdStatusLabel,
  homeAdPayTotals,
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
      ? `Starts ${start} · ${formatCurrencyRound(hostAdPayFromCredit(cap), campaign.currency, true)} budget`
      : null;
    const compactResult = resultCount === null
      ? null
      : `${resultCount} ${campaign.primary_result_label}`;
    const line = compactResult !== null
      ? [compactResult, ...salesLines].join(" · ")
      : attention
        ? homeAdAttentionReason(campaign)
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
          {homeAdAttentionReason(campaign)}
        </Text>
      ) : null}
    </View>
  );
};

const Budget: React.FC<{ campaign: HostAdCampaign; compact?: boolean }> = ({
  campaign,
  compact = false,
}) => {
  // Pay terms, the same unit as the card total and Promote.
  const rows = campaignCurrencies(campaign).map((row) => ({
    ...row,
    spent: hostAdPayFromCredit(row.spent),
    budget: hostAdPayFromCredit(row.budget),
  }));
  const hasSpend = rows.some((row) => row.spent > 0);
  if (!hasSpend) {
    if (compact) return null;
    const start = dateLabel(campaign.starts_at);
    const cap = campaign.cap_cents ?? campaign.lifetime_budget_cents;
    return start !== null && cap !== null && campaign.currency !== null ? (
      <Text style={styles.budgetLine}>
        {`Starts ${start} · ${formatCurrencyRound(hostAdPayFromCredit(cap), campaign.currency, true)} budget`}
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
  // #4238 rework 3b (P2-2): the total covers EVERY active ad, not the 4
  // tiles, and is what the Host pays (same hostAdPayFromCredit as Promote).
  const totals = useMemo(() => homeAdPayTotals(activeCampaigns), [activeCampaigns]);
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
                        <Icon name="pause" size={15} color={color.text1} />
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
                        <Icon name="chevR" size={18} color={color.text3} />
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
                        <Icon name="pause" size={18} color={color.text1} />
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
  section: { paddingHorizontal: space[4], marginBottom: space[4] },
  // #4420 (device round 2): one gutter with the rest of Home (section's space[4]).
  sectionNarrow: {},
  summary: {
    minHeight: 72,
    paddingHorizontal: space[6],
    paddingVertical: space[4],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[4],
  },
  summaryCopy: { flex: 1, minWidth: 0 },
  summaryWithDataWide: { minHeight: 120 },
  summaryWithDataNarrow: { minHeight: 138 },
  summaryCompact: { minHeight: 51, paddingVertical: 0 },
  eyebrow: { ...type.label, color: color.text3 },
  salesSummaryRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: space[2],
    marginTop: space[1],
  },
  salesSummary: {
    color: color.text1,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  summarySuffix: { ...type.small, color: color.text2 },
  spendSummary: { ...type.caption, color: color.text2 },
  viewAll: { minHeight: 44, justifyContent: "center" },
  link: { ...type.small, color: color.text1, fontWeight: "600" },
  tiles: { borderTopWidth: 1, borderTopColor: color.line },
  tilesWide: { flexDirection: "row", alignItems: "stretch" },
  tile: {
    minWidth: 0,
    position: "relative",
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.line,
  },
  quietTile: { height: 118 },
  attentionTile: { backgroundColor: color.warningTint },
  pressed: { opacity: 0.72 },
  desktopTile: { flex: 1, minHeight: 255, paddingHorizontal: space[6], paddingVertical: space[4] },
  singleTile: { minHeight: 124, flexDirection: "row", alignItems: "stretch", gap: space[6] },
  quietDesktopTile: { minHeight: 118, height: 118, flex: 0 },
  tileSection: { flex: 1, minWidth: 0 },
  tileFoot: { marginTop: "auto", paddingTop: space[4] },
  identity: { flexDirection: "row", alignItems: "center", gap: space[2] },
  thumbnail: { width: 40, height: 40, borderRadius: radius.md, flexShrink: 0 },
  identityCopy: { flex: 1, minWidth: 0 },
  name: { ...type.small, color: color.text1, fontWeight: "700", flexShrink: 1 },
  networks: { ...type.caption, color: color.text3 },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    borderRadius: radius.full,
    backgroundColor: color.fill.tile,
  },
  attentionPill: { backgroundColor: color.warningTint },
  livePill: { backgroundColor: color.successTint },
  statusDot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: color.text3 },
  attentionDot: { backgroundColor: color.warning },
  liveDot: { backgroundColor: color.success },
  statusLabel: { ...type.label, color: color.text1 },
  results: { marginTop: space[4], gap: space[1] },
  resultLine: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: space[1] },
  resultCount: { color: color.text1, fontSize: 20, lineHeight: 26, fontWeight: "800", fontVariant: ["tabular-nums"] },
  resultSuffix: { ...type.small, color: color.text2 },
  salesLine: { ...type.small, color: trafficAnalytics.positiveDelta, fontWeight: "700" },
  attentionText: { ...type.small, color: color.warning, marginTop: space[1] },
  budgetBlock: { gap: space[2] },
  budgetCurrency: { gap: space[1] },
  budgetLabelRow: { flexDirection: "row", justifyContent: "space-between", gap: space[2] },
  budgetLine: { ...type.caption, color: color.text2, flexShrink: 1 },
  percent: { ...type.caption, color: color.text2, fontVariant: ["tabular-nums"] },
  track: { height: 5, borderRadius: radius.full, overflow: "hidden", backgroundColor: color.lineStrong },
  fill: { height: "100%", borderRadius: radius.full, backgroundColor: color.accent },
  actions: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  desktopActionSpacer: { width: 72, height: 44 },
  desktopActionOverlay: { position: "absolute", right: space[6], bottom: space[4] },
  footnote: { ...type.caption, color: color.text3, flex: 1 },
  pauseButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: space[1], paddingHorizontal: space[2], borderRadius: radius.md, backgroundColor: color.fill.tile },
  actionText: { ...type.caption, color: color.text1, fontWeight: "700" },
  fixButton: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: space[2], borderRadius: radius.md, backgroundColor: color.warning },
  fixText: { ...type.caption, color: color.canvas, fontWeight: "700" },
  phoneRow: {
    minHeight: 80,
    flexDirection: "row",
    alignItems: "center",
    gap: space[2] + space[1],
    padding: space[4],
  },
  attentionPhoneRow: { minHeight: 135 },
  resultsPhoneRow: { minHeight: 115 },
  phoneMiddle: { flex: 1, minWidth: 0 },
  phoneActionSpacer: { width: 44, height: 44 },
  phoneActionOverlay: { position: "absolute", right: space[4], top: "50%", marginTop: -22 },
  phoneTitleRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  compactLine: { ...type.caption, color: color.text2, marginTop: space[1] },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: color.fill.tile },
  phoneViewAll: { minHeight: 52, alignItems: "center", justifyContent: "center" },
  actionError: { ...type.small, color: color.errorText, padding: space[4] },
  errorText: { ...type.small, color: color.text1 },
  retry: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center" },
  skeletonRow: { flexDirection: "row", alignItems: "center", gap: space[4] },
  skeletonCopy: { flex: 1, gap: space[2] },
});

export default HomeAdsSection;
