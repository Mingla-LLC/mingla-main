/**
 * toward #3697 — operational Ads rail on the actual Mingla Host Home.
 *
 * This component owns its query/action state so Home's existing scroll and
 * offering hooks remain stable. Live offerings are rendered before this rail.
 */

import { useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useHostAdCampaigns } from "../../hooks/marketing/useHostAdCampaigns";
import { useHostAdPermissions } from "../../hooks/useHostAdPermissions";
import {
  cancelHostAdCampaign,
  endHostAdCampaign,
  type HostAdCampaign,
  pauseHostAdCampaign,
} from "../../services/hostAdCampaignService";
import { currencyCodeOrNull, formatCurrency } from "../../utils/currency";
import {
  homeAdCanPause,
  homeAdDestructiveAction,
  homeAdStatusLabel,
  selectHomeAdCampaigns,
  type HomeAdDestructiveAction,
} from "../../utils/homeAdLifecycle";
import { randomId } from "../../utils/randomId";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";

interface HomeAdsSectionProps {
  brandId: string;
}

interface PendingDestructiveAction {
  kind: HomeAdDestructiveAction;
  campaign: HostAdCampaign;
}

function humanize(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function providerLabel(campaign: HostAdCampaign): string {
  const platforms =
    campaign.platforms.length > 0 ? campaign.platforms : [campaign.platform];
  return [...new Set(platforms.map((value) => humanize(value)))].join(" · ");
}

function budgetLabel(campaign: HostAdCampaign): string {
  const currency = currencyCodeOrNull(campaign.currency);
  const cap = campaign.cap_cents ?? campaign.lifetime_budget_cents;
  if (currency === null || cap === null) return "Budget currency unavailable";
  return `Plan cap ${formatCurrency(cap, currency, true)}`;
}

function spendLabel(campaign: HostAdCampaign): string | null {
  if (campaign.spend_by_currency.length === 0) return null;
  return `Provider spend ${campaign.spend_by_currency
    .map((row) => formatCurrency(row.spend_cents, row.currency, true))
    .join(" · ")}`;
}

export const HomeAdsSection: React.FC<HomeAdsSectionProps> = ({ brandId }) => {
  const router = useRouter();
  const permissions = useHostAdPermissions(brandId);
  const ads = useHostAdCampaigns(permissions.canRead ? brandId : null);
  const campaigns = useMemo(
    () => selectHomeAdCampaigns(ads.campaigns),
    [ads.campaigns],
  );
  const [busyCampaignId, setBusyCampaignId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDestructiveAction | null>(null);

  const openAds = useCallback((): void => {
    router.push("/(tabs)/marketing/ads" as never);
  }, [router]);

  const openCampaign = useCallback(
    (campaignId: string): void => {
      router.push(`/(tabs)/marketing/ads/${campaignId}` as never);
    },
    [router],
  );

  const pause = useCallback(
    async (campaign: HostAdCampaign): Promise<void> => {
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
    },
    [ads, brandId, permissions.canPause],
  );

  const confirmDestructive = useCallback(async (): Promise<void> => {
    if (pending === null || !permissions.canEnd) return;
    setBusyCampaignId(pending.campaign.id);
    setActionError(null);
    try {
      if (pending.kind === "cancel") {
        await cancelHostAdCampaign({
          brandId,
          campaignId: pending.campaign.id,
          idempotencyKey: randomId(),
        });
      } else {
        await endHostAdCampaign({
          brandId,
          campaignId: pending.campaign.id,
          idempotencyKey: randomId(),
        });
      }
      await ads.refetch();
      setPending(null);
    } catch {
      setActionError(
        pending.kind === "cancel"
          ? "Could not cancel this ad. Open Ads for the latest provider status."
          : "Could not end this ad. Open Ads for the latest provider status.",
      );
    } finally {
      setBusyCampaignId(null);
    }
  }, [ads, brandId, pending, permissions.canEnd]);

  if (permissions.isLoading || permissions.isError || !permissions.canRead) {
    return null;
  }

  if (ads.isLoading) {
    return (
      <View style={styles.section} testID="home-ads-loading">
        <View style={styles.skeleton} />
      </View>
    );
  }

  if (ads.isError) {
    return (
      <View style={styles.section} testID="home-ads-error">
        <GlassCard variant="base" padding={spacing.md}>
          <Text style={styles.errorTitle}>Ads need a refresh</Text>
          <Text style={styles.supporting}>
            We couldn&apos;t load delivery status. No campaign action was taken.
          </Text>
          <View style={styles.errorActions}>
            <Button
              label="Retry"
              size="sm"
              variant="secondary"
              onPress={() => void ads.refetch()}
              testID="home-ads-retry"
            />
            <Button
              label="Open Ads"
              size="sm"
              variant="ghost"
              onPress={openAds}
            />
          </View>
        </GlassCard>
      </View>
    );
  }

  if (campaigns.length === 0) return null;

  return (
    <View style={styles.section} testID="home-ads-section">
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <View style={styles.iconWrap} accessible={false}>
            <Icon name="target" size={18} color={accent.warm} />
          </View>
          <View>
            <Text accessibilityRole="header" style={styles.heading}>
              Ads
            </Text>
            <Text style={styles.headerMeta}>Delivery and actions</Text>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View all ads"
          onPress={openAds}
          style={({ pressed }) => [styles.viewAll, pressed && styles.pressed]}
          testID="home-ads-view-all"
        >
          <Text style={styles.viewAllLabel}>View all</Text>
          <Icon name="chevR" size={15} color={accent.warm} />
        </Pressable>
      </View>

      <View style={styles.cards}>
        {campaigns.map((campaign) => {
          const destructive = homeAdDestructiveAction(campaign);
          const isBusy = busyCampaignId === campaign.id;
          const spend = spendLabel(campaign);
          const needsAttention = campaign.lifecycle === "needs_attention";
          return (
            <GlassCard
              key={campaign.plan_version_id ?? campaign.id}
              variant="base"
              padding={spacing.md}
              style={needsAttention ? styles.attentionCard : undefined}
              testID={`home-ad-${campaign.id}`}
            >
              <View style={styles.cardTop}>
                <View style={styles.cardIdentity}>
                  <Text style={styles.campaignName} numberOfLines={1}>
                    {campaign.name}
                  </Text>
                  <Text style={styles.provider} numberOfLines={1}>
                    {providerLabel(campaign)}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusPill,
                    needsAttention && styles.attentionPill,
                    campaign.lifecycle === "live" && styles.livePill,
                  ]}
                >
                  <View
                    style={[
                      styles.statusDot,
                      needsAttention && styles.attentionDot,
                      campaign.lifecycle === "live" && styles.liveDot,
                    ]}
                  />
                  <Text style={styles.statusLabel}>
                    {homeAdStatusLabel(campaign)}
                  </Text>
                </View>
              </View>

              <Text style={styles.budget}>{budgetLabel(campaign)}</Text>
              {spend !== null ? (
                <Text style={styles.supporting}>{spend}</Text>
              ) : null}
              {campaign.primary_result_count > 0 ? (
                <Text style={styles.supporting}>
                  {campaign.primary_result_count.toLocaleString("en-GB")}{" "}
                  {campaign.primary_result_label}
                </Text>
              ) : null}
              {needsAttention ? (
                <Text style={styles.attentionCopy}>
                  {humanize(campaign.next_action || "Open Ads to resolve")}
                </Text>
              ) : null}

              <View style={styles.actions}>
                <Button
                  label="Details"
                  size="sm"
                  variant="ghost"
                  onPress={() => openCampaign(campaign.id)}
                  testID={`home-ad-details-${campaign.id}`}
                />
                {homeAdCanPause(campaign) && permissions.canPause ? (
                  <Button
                    label="Pause"
                    size="sm"
                    variant="secondary"
                    leadingIcon="pause"
                    loading={isBusy}
                    disabled={busyCampaignId !== null && !isBusy}
                    onPress={() => void pause(campaign)}
                    testID={`home-ad-pause-${campaign.id}`}
                  />
                ) : null}
                {destructive !== null && permissions.canEnd ? (
                  <Button
                    label={destructive === "cancel" ? "Cancel" : "End"}
                    size="sm"
                    variant="destructiveOutline"
                    disabled={busyCampaignId !== null}
                    onPress={() => {
                      setActionError(null);
                      setPending({ kind: destructive, campaign });
                    }}
                    testID={`home-ad-${destructive}-${campaign.id}`}
                  />
                ) : null}
              </View>
            </GlassCard>
          );
        })}
      </View>

      {actionError !== null && pending === null ? (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {actionError}
        </Text>
      ) : null}

      <ConfirmDialog
        visible={pending !== null}
        onClose={() => {
          if (busyCampaignId === null) {
            setPending(null);
            setActionError(null);
          }
        }}
        onConfirm={confirmDestructive}
        variant="typeToConfirm"
        confirmText={pending?.kind === "end" ? "END" : "CANCEL"}
        title={
          pending?.kind === "end"
            ? "End this ad permanently?"
            : "Cancel this ad?"
        }
        description={
          pending?.kind === "end"
            ? "Type END to stop every provider campaign in this plan. Final spend must settle before unused Ads credit is returned."
            : "Type CANCEL to stop this unspent plan and return its reserved Ads credit."
        }
        confirmLabel={pending?.kind === "end" ? "End ad" : "Cancel ad"}
        destructive
        confirmLoading={
          pending !== null && busyCampaignId === pending.campaign.id
        }
        closeDisabled={busyCampaignId !== null}
        errorMessage={pending !== null ? actionError : null}
        confirmTestID="home-ad-destructive-confirm"
        testID="home-ad-destructive-dialog"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  skeleton: {
    height: 136,
    borderRadius: radiusTokens.lg,
    backgroundColor: glass.tint.profileBase,
  },
  header: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radiusTokens.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(235, 120, 37, 0.12)",
  },
  heading: {
    ...typography.h3,
    color: textTokens.primary,
  },
  headerMeta: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  viewAll: {
    minHeight: 44,
    minWidth: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radiusTokens.sm,
  },
  viewAllLabel: {
    ...typography.bodySm,
    fontWeight: "600",
    color: accent.warm,
  },
  pressed: { opacity: 0.65 },
  cards: { gap: spacing.sm },
  attentionCard: { borderColor: semantic.warning },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  cardIdentity: { flex: 1, minWidth: 0 },
  campaignName: {
    ...typography.bodyLg,
    fontWeight: "700",
    color: textTokens.primary,
  },
  provider: {
    ...typography.caption,
    marginTop: spacing.xs,
    color: textTokens.tertiary,
  },
  statusPill: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radiusTokens.full,
    backgroundColor: glass.tint.profileElevated,
  },
  attentionPill: { backgroundColor: semantic.warningTint },
  livePill: { backgroundColor: semantic.successTint },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: radiusTokens.full,
    backgroundColor: textTokens.tertiary,
  },
  attentionDot: { backgroundColor: semantic.warning },
  liveDot: { backgroundColor: semantic.success },
  statusLabel: {
    ...typography.micro,
    color: textTokens.primary,
  },
  budget: {
    ...typography.bodySm,
    fontWeight: "600",
    marginTop: spacing.md,
    color: textTokens.primary,
  },
  supporting: {
    ...typography.caption,
    marginTop: spacing.xs,
    color: textTokens.secondary,
  },
  attentionCopy: {
    ...typography.bodySm,
    marginTop: spacing.sm,
    color: semantic.warning,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
  },
  actionError: {
    ...typography.bodySm,
    marginTop: spacing.sm,
    color: semantic.errorText,
  },
  errorTitle: {
    ...typography.bodyLg,
    color: textTokens.primary,
  },
  errorActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
