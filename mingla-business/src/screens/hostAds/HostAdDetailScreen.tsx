/**
 * toward #3697 Wave 7c / 8 — Host ad campaign detail (spend vs cap,
 * pause / Cancel-before-spend / End-after-spend — never both).
 *
 * #4420 B2: Pause on a live ad asks once ("Pause this ad?") before the pause
 * call runs; Keep running calls nothing.
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";

import { Banner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { GlassCard } from "../../components/ui/GlassCard";
import { IconChrome } from "../../components/ui/IconChrome";
import { color, radius, size, space, type } from "../../constants/designSystem";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useHostAdPermissions } from "../../hooks/useHostAdPermissions";
import { ScrollView } from "../../wrappers/SmartScrollView";
import {
  cancelHostAdCampaign,
  endHostAdCampaign,
  getHostAdCampaign,
  type HostAdCampaignDetail,
  pauseHostAdCampaign,
  resumeHostAdCampaignPlan,
} from "../../services/hostAdCampaignService";
import {
  hostAdCostPerLabel,
  hostAdCountingLines,
  hostAdEventLabel,
  hostAdResultLabel,
  hostAdStatusLabel,
  humanize,
  platformName,
} from "../../components/marketing/ads/hostAdCopy";
import { useStickyFooterOffset } from "../../hooks/useStickyFooterOffset";
import { AdResultsSection } from "../../components/marketing/ads/results/AdResultsSection";
import { formatHostAdMoneyCents } from "../../components/marketing/ads/hostAdMoney";
import {
  hostAdLiveEditAttempt,
  type HostAdLiveEditAttempt,
  HostAdLiveEditCard,
  hostAdLiveEditDoneNote,
  hostAdLiveEditError,
} from "../../components/marketing/ads/HostAdLiveEditCard";
import {
  hostAdLearningAlert,
  hostAdPacingAlert,
} from "../../components/marketing/ads/hostAdAlerts";
import {
  changeHostAdLive,
  duplicateHostAdPlan,
} from "../../services/hostAdPlanService";
import { hostAdDetailMoneyLine } from "../../services/hostAdLifecycle";
import {
  hostAdCostPerResultLine,
  hostAdDetailCostPerResult,
} from "../../components/marketing/ads/results/adResultsSeries";
import {
  goBackToAds,
  hostAdScrollBottomPadding,
} from "../../components/marketing/ads/hostAdBuilderRules";
import { formatCurrency } from "../../utils/currency";
import { randomId, randomUuid } from "../../utils/randomId";

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (
    Array.isArray(value) &&
    typeof value[0] === "string" &&
    value[0].length > 0
  ) {
    return value[0];
  }
  return null;
}

export default function HostAdDetailRoute(): React.ReactElement {
  // #4238: keep the last buttons clear of the bottom nav and the floating
  // action button at full scroll on phones (business web and native).
  const scrollBottomPadding = hostAdScrollBottomPadding(useStickyFooterOffset());
  const brand = useCurrentBrand();
  const brandId = brand?.id ?? null;
  const permissions = useHostAdPermissions(brandId);
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const campaignId = firstParam(params.id);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [resumeConfirmVisible, setResumeConfirmVisible] = useState(false);
  // #4420 B2: a live ad pauses only after the host confirms once.
  const [pauseConfirmVisible, setPauseConfirmVisible] = useState(false);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [resumePhrase, setResumePhrase] = useState("");
  const [destructiveAction, setDestructiveAction] = useState<
    "cancel" | "end" | null
  >(null);
  const [destructiveError, setDestructiveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<HostAdCampaignDetail | null>(null);

  const load = useCallback(async () => {
    if (brandId === null || campaignId === null || !permissions.canRead) return;
    setError(null);
    try {
      const res = await getHostAdCampaign(brandId, campaignId);
      setPayload(res);
    } catch {
      setError("Could not load this ad.");
      setPayload(null);
    }
  }, [brandId, campaignId, permissions.canRead]);

  useEffect(() => {
    void load();
  }, [load]);

  // #4238 wave D: budget and end date, once a day. r8 P1-2: one key per
  // edit attempt (reused by a second tap or a retry), and never two saves
  // in flight at once.
  const liveEditAttempt = useRef<HostAdLiveEditAttempt | null>(null);
  const liveEditInFlight = useRef(false);
  // #4238 r9 P3: the result shows inside the card, next to Save.
  const [liveEditResult, setLiveEditResult] = useState<
    { kind: "done" | "error"; text: string } | null
  >(null);
  const onLiveEdit = useCallback(
    async (input: { newBudgetCents: number | null; newEndsAt: string | null }) => {
      const planId = payload?.plan_id;
      if (brandId === null || !planId || !permissions.canFund) return;
      if (liveEditInFlight.current) return;
      liveEditInFlight.current = true;
      const attempt = hostAdLiveEditAttempt(
        liveEditAttempt.current,
        { planId, ...input },
        randomUuid,
      );
      liveEditAttempt.current = attempt;
      setBusy(true);
      setLiveEditResult(null);
      try {
        const result = await changeHostAdLive({
          brandId,
          planId,
          newBudgetCents: input.newBudgetCents,
          newEndsAt: input.newEndsAt,
          idempotencyKey: attempt.key,
        });
        liveEditAttempt.current = null;
        setLiveEditResult({ kind: "done", text: hostAdLiveEditDoneNote(result) });
        await load();
      } catch (cause) {
        const failure = cause !== null && typeof cause === "object"
          ? (cause as { code?: unknown; detail?: unknown })
          : null;
        setLiveEditResult({
          kind: "error",
          text: hostAdLiveEditError(
            failure && "code" in failure ? String(failure.code) : null,
            typeof failure?.detail === "string" ? failure.detail : null,
            payload?.plan_currency ?? null,
          ),
        });
      } finally {
        liveEditInFlight.current = false;
        setBusy(false);
      }
    },
    [brandId, load, payload?.plan_currency, payload?.plan_id, permissions.canFund],
  );

  // #4238 wave D: the same setup as a new draft for the next event.
  const onDuplicate = useCallback(async () => {
    const planId = payload?.plan_id;
    if (brandId === null || !planId || !permissions.canPlan) return;
    setBusy(true);
    setError(null);
    try {
      const draftId = await duplicateHostAdPlan({
        brandId,
        planId,
        newDraftId: randomUuid(),
      });
      router.push(
        `/(tabs)/marketing/ads/create?draft_id=${draftId}&step=promote` as never,
      );
    } catch {
      setError("We couldn't copy this ad just now. Try again in a minute.");
    } finally {
      setBusy(false);
    }
  }, [brandId, payload?.plan_id, permissions.canPlan, router]);

  const onPause = useCallback(async () => {
    if (brandId === null || campaignId === null || !permissions.canPause)
      return;
    setBusy(true);
    setError(null);
    setPauseError(null);
    try {
      await pauseHostAdCampaign({ brandId, campaignId });
      setPauseConfirmVisible(false);
      await load();
    } catch {
      setPauseError("Could not pause this ad.");
    } finally {
      setBusy(false);
    }
  }, [brandId, campaignId, load, permissions.canPause]);

  const onResume = useCallback(async () => {
    if (
      brandId === null ||
      campaignId === null ||
      !permissions.canLaunch ||
      resumePhrase !== "LAUNCH"
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await resumeHostAdCampaignPlan({
        campaignId,
        reason: "Host resumed paused ad plan from Ads detail",
      });
      setResumeConfirmVisible(false);
      setResumePhrase("");
      await load();
    } catch {
      setError(
        "Could not resume this ad. Check its schedule, credit and review status.",
      );
    } finally {
      setBusy(false);
    }
  }, [brandId, campaignId, load, permissions.canLaunch, resumePhrase]);

  const onEnd = useCallback(async () => {
    if (brandId === null || campaignId === null || !permissions.canEnd) return;
    setBusy(true);
    setError(null);
    try {
      await endHostAdCampaign({
        brandId,
        campaignId,
        idempotencyKey: randomId(),
      });
      setDestructiveAction(null);
      await load();
    } catch {
      setDestructiveError("Could not end this ad. Refresh and try again.");
    } finally {
      setBusy(false);
    }
  }, [brandId, campaignId, load, permissions.canEnd]);

  const onCancel = useCallback(async () => {
    if (brandId === null || campaignId === null || !permissions.canEnd) return;
    setBusy(true);
    setError(null);
    try {
      await cancelHostAdCampaign({
        brandId,
        campaignId,
        idempotencyKey: randomId(),
      });
      setDestructiveAction(null);
      await load();
    } catch {
      setDestructiveError("Could not cancel this ad. Refresh and try again.");
    } finally {
      setBusy(false);
    }
  }, [brandId, campaignId, load, permissions.canEnd]);

  if (brandId === null || campaignId === null) {
    return (
      <View style={styles.host}>
        <EmptyState
          illustration="users"
          title="Ad not found"
          description="Pick a brand and open an ad from the Ads list."
          testID="ads-detail-missing"
        />
      </View>
    );
  }

  if (permissions.isLoading) {
    return (
      <View style={styles.host} testID="ads-detail-permission-loading">
        <ActivityIndicator color={color.text2} />
      </View>
    );
  }

  if (permissions.isError || !permissions.canRead) {
    return (
      <View style={styles.host}>
        <EmptyState
          illustration="users"
          title="Ads access required"
          description="Ask a brand owner to grant Ads view access for this brand."
          testID="ads-detail-permission-denied"
        />
      </View>
    );
  }

  if (payload === null && error === null) {
    return (
      <View style={styles.host} testID="ads-detail-skeleton">
        <ActivityIndicator color={color.text2} />
      </View>
    );
  }

  if (payload === null) {
    return (
      <View style={styles.host}>
        <EmptyState
          illustration="users"
          title="Couldn't load ad"
          description={error ?? "Try again."}
          testID="ads-detail-error"
          cta={{ label: "Retry", onPress: () => void load() }}
        />
      </View>
    );
  }

  const c = payload.campaign;
  const name = String(c.name ?? "Ad");
  const status = payload.plan_state ?? String(c.status ?? "");
  const currencyCandidate = payload.plan_currency ?? c.currency;
  const currency =
    typeof currencyCandidate === "string" &&
    /^[A-Z]{3}$/.test(currencyCandidate)
      ? currencyCandidate
      : null;
  const cap = Number(
    payload.plan_cap_cents ?? c.cap_cents ?? c.daily_budget_cents ?? 0,
  );
  const spent = payload.host_spend_equivalent_cents;
  const hasProviderSpend = payload.provider_spend_by_currency.some(
    (row) => Number(row.spend_cents) > 0,
  );
  const settlements = Array.isArray(payload.settlements)
    ? payload.settlements
    : [];
  const isLive =
    ["LIVE", "PARTIALLY_LIVE"].includes(status.toUpperCase()) ||
    payload.plan_campaigns.some(
      (row) => String(row.status).toUpperCase() === "ACTIVE",
    );
  const isEnded =
    status.toUpperCase() === "ENDED" ||
    payload.plan_campaigns.every((row) =>
      ["ARCHIVED", "DELETED"].includes(String(row.status).toUpperCase()),
    );
  // Phase 3: Cancel before spend; End after — a card never shows both.
  const canCancel = !isEnded && !hasProviderSpend;
  const canEnd = !isEnded && hasProviderSpend;
  const conversions = Number(payload.results?.conversions ?? 0);
  const resultHierarchy = Array.isArray(
    payload.measurement?.manifest?.result_hierarchy,
  )
    ? payload.measurement.manifest.result_hierarchy
    : [];
  // #4238 D3: plain result words ("ticket sales", "page visits", "results").
  const primaryResultLabel = hostAdResultLabel(
    String(resultHierarchy[0] ?? "results"),
  );
  const costPerLabel = hostAdCostPerLabel(String(resultHierarchy[0] ?? "results"));
  const capUsed =
    spent !== null && cap > 0
      ? Math.min(100, Math.round((spent / cap) * 100))
      : null;
  // #4238: total spend ÷ total results, from the same totals the charts use.
  const costPerResult = hostAdDetailCostPerResult({
    hostSpendCents: spent,
    hostCurrency: currency,
    conversions,
    daily: payload.daily ?? [],
  });
  const latestPauseReason = payload.timeline.find(
    (event) =>
      event.action === "pause" &&
      event.provider_response &&
      typeof event.provider_response.reason === "string",
  )?.provider_response?.reason;
  const endState = isEnded
    ? status.toUpperCase() === "DELETED"
      ? "Cancelled before anything was spent. All your Ads credit is back."
      : "Ended. Any money your ad didn't spend is back in your Ads credit."
    : latestPauseReason === "destination_unavailable"
      ? "We paused your ad because the page it sends people to has ended or isn't public any more. Publish the page again, then resume."
      : latestPauseReason === "destination_check_failed"
        ? "We paused your ad because we couldn't check that your page is still public. Your money is safe; we'll try again shortly."
        : latestPauseReason === "end_date_passed"
          ? "Your ad reached its end date, so we paused it."
          : latestPauseReason === "spend_fetch_failed"
            ? "We paused your ad because we couldn't check how much it has spent. Your money is safe; we'll try again shortly."
            : spent !== null && cap > 0 && spent >= Math.floor(cap * 0.98)
              ? "Your ad has used its budget, so we paused it. It won't spend more than you set."
              : null;

  return (
    <View style={styles.host} testID="ads-detail-screen">
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: scrollBottomPadding },
        ]}
      >
        <IconChrome
          icon="chevL"
          onPress={() => goBackToAds(router)}
          accessibilityLabel="Back to Ads"
          testID="ads-detail-back"
        />

        <GlassCard variant="elevated" padding={space[6]}>
          <Text style={styles.kicker}>
            {payload.plan_campaigns
              .map((row) => platformName(String(row.platform)))
              .join(" · ")}
          </Text>
          <Text style={styles.title}>{name}</Text>
          <Text style={styles.status} testID="ads-detail-status">
            {hostAdStatusLabel(status)}
          </Text>
          <Text style={styles.metric}>
            {currency
              ? hostAdDetailMoneyLine({
                  spentCents: spent,
                  capCents: cap,
                  currency,
                  planState: payload.plan_state ?? null,
                })
              : "We can't confirm exchange rates right now, so you can't fund or launch ads for the moment. Try again later."}
          </Text>
          {payload.host_spend_equivalent_quality === "frozen_plan_fx" ? (
            <Text style={styles.muted}>
              We use the exchange rate fixed when you confirmed this ad.
            </Text>
          ) : null}
          {payload.provider_spend_by_currency.length > 0 ? (
            <Text style={styles.muted}>
              What the apps say they spent:{" "}
              {payload.provider_spend_by_currency
                .flatMap((row) => {
                  // #4238: same "USD 137.00" style as the Results card.
                  const money = formatHostAdMoneyCents(
                    row.spend_cents,
                    row.currency,
                  );
                  return money ? [money] : [];
                })
                .join(" · ")}
            </Text>
          ) : null}
          {(() => {
            const startedAt =
              typeof c.starts_at === "string"
                ? c.starts_at
                : typeof c.created_at === "string"
                  ? c.created_at
                  : null;
            const nowIso = new Date().toISOString();
            const learning = hostAdLearningAlert({
              name,
              live: isLive,
              startedAt,
              nowIso,
              timezone: payload.time_zone,
            });
            const pacing = hostAdPacingAlert({
              live: isLive,
              spentCents: spent,
              dailyCents: payload.plan_campaigns.reduce(
                (sum, row) => sum + Number(row.daily_budget_cents ?? 0),
                0,
              ) || null,
              capCents: cap > 0 ? cap : null,
              startedAt,
              nowIso,
              timezone: payload.time_zone,
              currency,
            });
            return (
              <>
                {learning ? (
                  <Banner
                    tone="info"
                    title={learning.title}
                    body={learning.body}
                    style={styles.banner}
                    testID="ads-detail-learning"
                  />
                ) : null}
                {pacing ? (
                  <Banner
                    tone="warning"
                    title={pacing.title}
                    body={pacing.body}
                    style={styles.banner}
                    testID="ads-detail-pacing"
                  />
                ) : null}
              </>
            );
          })()}
          {!isEnded && currency && payload.plan_id && permissions.canFund ? (
            <HostAdLiveEditCard
              currency={currency}
              currentTotalCents={cap}
              spentCents={spent}
              currentEndsAt={
                payload.plan_campaigns
                  .map((row) => row.ends_at)
                  .filter((value): value is string => typeof value === "string")
                  .sort()
                  .pop() ?? null
              }
              timezone={payload.time_zone}
              lastEditAt={payload.last_live_edit_at ?? null}
              nowIso={new Date().toISOString()}
              busy={busy}
              result={liveEditResult}
              onSubmit={onLiveEdit}
            />
          ) : null}
          {payload.plan_id && permissions.canPlan ? (
            <Button
              label="Duplicate"
              variant="secondary"
              size="md"
              disabled={busy}
              onPress={() => void onDuplicate()}
              accessibilityLabel="Duplicate this ad"
              testID="ads-detail-duplicate"
              style={styles.duplicate}
            />
          ) : null}
          {capUsed !== null ? (
            <Text style={styles.progress}>{capUsed}% of budget used</Text>
          ) : null}
        </GlassCard>

        {endState ? (
          <GlassCard variant="elevated" padding={space[4]}>
            <Text style={styles.sectionTitle}>What happened</Text>
            <Text style={styles.body}>{endState}</Text>
          </GlassCard>
        ) : null}

        {settlements.length > 0 ? (
          <GlassCard variant="elevated" padding={space[6]}>
            <Text style={styles.sectionTitle}>Getting your money back</Text>
            <Text style={styles.muted}>
              We return unspent Ads credit once every app confirms your ad has
              stopped and tells us its final spend. This can take a few days.
            </Text>
            {settlements.map((settlement) => {
              const platform = payload.plan_campaigns.find(
                (row) => row.id === settlement.campaign_id,
              )?.platform;
              return (
                <View key={settlement.id} style={styles.timelineRow}>
                  <Text style={styles.body}>
                    {platform ? platformName(String(platform)) : "App"} ·{" "}
                    {hostAdStatusLabel(settlement.state)}
                  </Text>
                  <Text style={styles.muted}>
                    Final spend on the app:{" "}
                    {settlement.final_provider_spend_cents === null
                      ? "pending"
                      : formatCurrency(
                          settlement.final_provider_spend_cents,
                          settlement.provider_currency,
                          true,
                        )}
                  </Text>
                  <Text style={styles.muted}>
                    In your currency:{" "}
                    {settlement.final_host_spend_cents === null
                      ? "pending"
                      : formatCurrency(
                          settlement.final_host_spend_cents,
                          settlement.host_currency,
                          true,
                        )}
                  </Text>
                  <Text style={styles.muted}>
                    Money back after:{" "}
                    {settlement.settle_after
                      ? new Date(settlement.settle_after).toLocaleString()
                      : "waiting for the app to confirm"}
                  </Text>
                </View>
              );
            })}
          </GlassCard>
        ) : null}

        <GlassCard variant="elevated" padding={space[6]}>
          <Text style={styles.sectionTitle}>Results</Text>
          <AdResultsSection
            daily={payload.daily ?? []}
            byPlatformSpend={payload.by_platform_spend ?? []}
            dailyError={payload.daily_error === "unavailable"}
            hostCurrency={currency}
            budgetCents={cap > 0 ? cap : null}
            resultKind={String(resultHierarchy[0] ?? "results")}
            notes={[
              `We count ${primaryResultLabel} for this ad.`,
              hostAdCountingLines(resultHierarchy).sharing,
              ...(payload.measurement?.platform_withheld_conversion_count > 0
                ? [
                    `${payload.measurement.platform_withheld_conversion_count} result(s) counted by Mingla but not shared with the ad apps, because those buyers didn't agree to sharing.`,
                  ]
                : []),
            ]}
            placements={payload.by_placement}
            onRetry={() => void load()}
          />
          <Text style={styles.muted} testID="ads-detail-cost-per-result">
            {hostAdCostPerResultLine(costPerLabel, costPerResult)}
          </Text>
        </GlassCard>

        <GlassCard variant="elevated" padding={space[6]}>
          <Text style={styles.sectionTitle}>Your video</Text>
          {payload.creatives.length === 0 ? (
            <Text style={styles.body}>No video added yet.</Text>
          ) : (
            payload.creatives.map((creative) => (
              <View key={creative.id} style={styles.timelineRow}>
                <Text style={styles.body}>
                  {creative.ad_creatives?.name ?? creative.name}
                </Text>
                <Text style={styles.muted}>
                  {humanize(String(creative.ad_creatives?.kind ?? "video"))} ·{" "}
                  {hostAdStatusLabel(creative.review_status ?? creative.status)}
                </Text>
                {creative.review_status?.toUpperCase().includes("REJECT") ? (
                  <Text style={styles.error}>
                    The app turned this video down. Ask Ari why, then add a
                    different video.
                  </Text>
                ) : null}
              </View>
            ))
          )}
        </GlassCard>

        <GlassCard variant="elevated" padding={space[6]}>
          <Text style={styles.sectionTitle}>Timeline</Text>
          {payload.timeline.length === 0 ? (
            <Text style={styles.body}>No status changes yet.</Text>
          ) : (
            payload.timeline.map((event) => (
              <View key={event.id} style={styles.timelineRow}>
                <Text style={styles.body}>
                  {hostAdEventLabel(event.action)}
                  {event.to_status ? ` · ${hostAdStatusLabel(event.to_status)}` : ""}
                </Text>
                <Text style={styles.muted}>
                  {new Date(event.created_at).toLocaleString()}
                </Text>
              </View>
            ))
          )}
          {payload.credit_events.map((event) => (
            <View key={event.id} style={styles.timelineRow}>
              <Text style={styles.body}>
                {hostAdEventLabel(event.entry_kind)} ·{" "}
                {formatCurrency(event.amount_cents, event.currency, true)}
              </Text>
              <Text style={styles.muted}>
                {new Date(event.created_at).toLocaleString()}
              </Text>
            </View>
          ))}
        </GlassCard>

        {error !== null ? (
          <Text style={styles.error} testID="ads-detail-action-error">
            {error}
          </Text>
        ) : null}

        <Button
          label={
            payload.creatives.some((creative) =>
              creative.review_status?.toUpperCase().includes("REJECT"),
            )
              ? "Ask Ari to help fix the rejection"
              : "Ask Ari about this ad"
          }
          variant="secondary"
          size="lg"
          fullWidth
          onPress={() => router.push("/(tabs)/ari" as never)}
          accessibilityLabel="Ask Ari about this ad"
          testID="ads-detail-ask-ari"
        />

        {resumeConfirmVisible ? (
          <GlassCard variant="elevated" padding={space[6]}>
            <Text style={styles.sectionTitle}>Restart your ad?</Text>
            <Text style={styles.muted}>
              Type LAUNCH to restart your ad on every app. It will start
              spending again from the money you set aside.
            </Text>
            <TextInput
              value={resumePhrase}
              onChangeText={setResumePhrase}
              placeholder="LAUNCH"
              placeholderTextColor={color.text3}
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.confirmInput}
              accessibilityLabel="Type LAUNCH to restart this ad"
              testID="ads-detail-resume-phrase"
            />
            <View style={styles.actions}>
              <Button
                label="Not now"
                variant="secondary"
                size="md"
                style={styles.actionBtn}
                onPress={() => {
                  setResumeConfirmVisible(false);
                  setResumePhrase("");
                }}
                accessibilityLabel="Cancel resume"
              />
              <Button
                label={busy ? "Working…" : "Resume all platforms"}
                variant="primary"
                size="md"
                style={styles.actionBtn}
                disabled={busy || resumePhrase !== "LAUNCH"}
                onPress={() => void onResume()}
                accessibilityLabel="Confirm resume"
                testID="ads-detail-resume-confirm"
              />
            </View>
          </GlassCard>
        ) : null}

        {!isEnded &&
        currency &&
        (permissions.canLaunch ||
          permissions.canPause ||
          permissions.canEnd) ? (
          <View style={styles.actions}>
            {isLive && permissions.canPause ? (
              <Button
                label={busy ? "Working…" : "Pause"}
                variant="secondary"
                size="md"
                style={styles.actionBtn}
                disabled={busy}
                onPress={() => {
                  setPauseError(null);
                  setPauseConfirmVisible(true);
                }}
                accessibilityLabel="Pause ad"
                testID="ads-detail-pause"
              />
            ) : null}
            {!isLive &&
            permissions.canLaunch &&
            ["PAUSED", "PAUSE_REQUESTED"].includes(status.toUpperCase()) ? (
              <Button
                label={busy ? "Working…" : "Resume"}
                variant="secondary"
                size="md"
                style={styles.actionBtn}
                disabled={busy}
                onPress={() => setResumeConfirmVisible(true)}
                accessibilityLabel="Resume ad"
                testID="ads-detail-resume"
              />
            ) : null}
            {canCancel && permissions.canEnd ? (
              <Button
                label={busy ? "Working…" : "Cancel ad"}
                variant="dangerText"
                size="md"
                style={styles.actionBtn}
                disabled={busy}
                onPress={() => {
                  setDestructiveError(null);
                  setDestructiveAction("cancel");
                }}
                accessibilityLabel="Cancel ad"
                testID="ads-detail-cancel"
              />
            ) : null}
            {canEnd && permissions.canEnd ? (
              <Button
                label={busy ? "Working…" : "End ad"}
                variant="dangerText"
                size="md"
                style={styles.actionBtn}
                disabled={busy}
                onPress={() => {
                  setDestructiveError(null);
                  setDestructiveAction("end");
                }}
                accessibilityLabel="End ad"
                testID="ads-detail-end"
              />
            ) : null}
          </View>
        ) : null}
      </ScrollView>
      <ConfirmDialog
        visible={pauseConfirmVisible}
        onClose={() => {
          if (!busy) {
            setPauseConfirmVisible(false);
            setPauseError(null);
          }
        }}
        onConfirm={onPause}
        variant="simple"
        title="Pause this ad?"
        description="It stops showing straight away."
        confirmLabel="Pause ad"
        cancelLabel="Keep running"
        confirmLoading={busy}
        closeDisabled={busy}
        errorMessage={pauseError}
        confirmTestID="ads-detail-pause-confirm"
        cancelTestID="ads-detail-pause-keep"
        testID="ads-detail-pause-dialog"
      />
      <ConfirmDialog
        visible={destructiveAction !== null}
        onClose={() => {
          if (!busy) {
            setDestructiveAction(null);
            setDestructiveError(null);
          }
        }}
        onConfirm={destructiveAction === "end" ? onEnd : onCancel}
        variant="typeToConfirm"
        confirmText={destructiveAction === "end" ? "END" : "CANCEL"}
        title={
          destructiveAction === "end"
            ? "End this ad permanently?"
            : "Cancel this ad?"
        }
        description={
          destructiveAction === "end"
            ? "Type END to stop your ad on every app. Any money it didn't spend goes back to your Ads credit once each app confirms its final spend."
            : "Type CANCEL to stop this ad. Nothing has been spent, so the money you set aside goes back to your Ads credit."
        }
        confirmLabel={destructiveAction === "end" ? "End ad" : "Cancel ad"}
        destructive
        confirmLoading={busy}
        closeDisabled={busy}
        errorMessage={destructiveError}
        confirmTestID="ads-detail-destructive-confirm"
        testID="ads-detail-destructive-dialog"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginTop: space[3],
  },
  duplicate: {
    marginTop: space[4],
    alignSelf: "flex-start",
  },
  host: {
    flex: 1,
    backgroundColor: color.canvas,
  },
  scroll: {
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: space[9],
    gap: space[4],
  },
  kicker: {
    ...type.label,
    color: color.text3,
    textTransform: "uppercase",
  },
  title: {
    ...type.h1,
    color: color.text1,
    marginTop: space[1],
  },
  status: {
    ...type.small,
    color: color.text2,
    marginTop: space[1],
  },
  metric: {
    ...type.body,
    color: color.text1,
    marginTop: space[4],
  },
  progress: {
    ...type.caption,
    color: color.text2,
    marginTop: space[1],
  },
  sectionTitle: {
    ...type.h2,
    color: color.text1,
    marginBottom: space[2],
  },
  body: {
    ...type.small,
    color: color.text1,
  },
  muted: {
    ...type.caption,
    color: color.text3,
  },
  metricGrid: {
    flexDirection: "row",
    gap: space[2],
    marginBottom: space[4],
  },
  metricCell: {
    flex: 1,
  },
  metricNumber: {
    ...type.stat,
    color: color.text1,
  },
  metricLabel: {
    ...type.caption,
    color: color.text2,
  },
  resultRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: space[2],
    paddingVertical: space[1],
  },
  timelineRow: {
    gap: space[1],
    paddingVertical: space[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.lineStrong,
  },
  dest: {
    ...type.caption,
    color: color.text3,
    marginTop: space[2],
  },
  error: {
    ...type.caption,
    color: color.text2,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
    marginTop: space[4],
  },
  confirmInput: {
    ...type.body,
    color: color.text1,
    marginTop: space[4],
    paddingHorizontal: space[4],
    minHeight: size.input,
    paddingVertical: space[2],
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.input,
  },
  actionBtn: {
    flex: 1,
  },
});
