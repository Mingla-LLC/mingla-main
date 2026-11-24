/**
 * #4238 W6b — one Host ad (design v9, on the #4420 Graphite Glass kit).
 *
 * The answer first: what the ad got (tickets, sign-ups or page visits, in
 * what the Host paid, counted by Mingla within 7 days of a tap), then why
 * it is in the state it is in (the TRUE reason: sold out, event passed,
 * budget used, you ended it, credit ran out, not on sale yet, bookings
 * closed, page not public), then the one thing to do next.
 *
 * Money: every amount is what the Host pays (credit ÷ 0.85, the 15% Mingla
 * fee inside); "goes to the ads" is the small line under it. The server
 * keeps Ads credit; edits go back as credit (hostAdCreditFromPay).
 *
 * Ari's one suggestion sends ONLY its suggestion_id (never an amount); the
 * confirm sheet shows the server's money. A change that restarts learning
 * asks once and then sends acknowledge_learning_reset.
 *
 * #4420 B2: Pause on a live ad asks once ("Pause this ad?") before the pause
 * call runs; Keep running calls nothing.
 *
 * #4238 rework 5 (native P1-1): every confirm and sheet belongs to ONE ad.
 * The screen is keyed by brand + route ad, so moving to another ad (a
 * notification, a link, a brand switch) mounts a fresh screen with nothing
 * open. Each confirm also records the ad it was opened for
 * (hostAdConfirmKey) and its submit refuses unless the screen still shows
 * that ad, so a confirm can never act on a different ad than the one the
 * Host read. The server acts only on the campaign_id / plan_id it is sent
 * (host-ad-campaign rejects a missing or invalid campaign_id), and the
 * client only ever sends the confirmed ad's ids.
 *
 * #4238 rework 5 (native P1-2): on phones the next-step dock (resume, top
 * up, fix a rejected ad, promote again) is pinned above the floating tab bar
 * (the builder's Next bar pattern), and the scroll clears it.
 */

import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, type LayoutChangeEvent, StyleSheet, Text, View } from "react-native";

import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { IconChrome } from "../../components/ui/IconChrome";
import { Material } from "../../components/ui/Material";
import { color, radius, space, type } from "../../constants/designSystem";
import { useAdCreditWallet } from "../../hooks/marketing/useAdCreditWallet";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useBrandListState } from "../../hooks/useBrandListShim";
import { useHostAdPermissions } from "../../hooks/useHostAdPermissions";
import { useCurrentBrandStore } from "../../store/currentBrandStore";
import { cachedHostAdSetup } from "../../components/marketing/ads/hostAdSetupCache";
import { loadHostAdPlanService } from "./hostAdKitService";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { useStickyFooterOffset } from "../../hooks/useStickyFooterOffset";
import { useNetInfoSafe } from "../../lib/netinfoSafe";
import { ScrollView } from "../../wrappers/SmartScrollView";
import {
  cancelHostAdCampaign,
  endHostAdCampaign,
  getHostAdCampaign,
  type HostAdCampaignDetail,
  pauseHostAdCampaign,
  resolveHostAdCampaignForPlan,
  resumeHostAdCampaignPlan,
} from "../../services/hostAdCampaignService";
import {
  acceptHostAdLastTickets,
  changeHostAdLive,
  duplicateHostAdPlan,
} from "../../services/hostAdPlanService";
import { platformNames } from "../../components/marketing/ads/hostAdCopy";
import { formatHostAdMoneyCents } from "../../components/marketing/ads/hostAdMoney";
import { AdResultsSection } from "../../components/marketing/ads/results/AdResultsSection";
import {
  builderStyles as bs,
  BuilderCard,
  BuilderLabel,
  BuilderList,
  Blocker,
  Note,
  Segmented,
  ValueRow,
} from "../../components/marketing/ads/HostAdBuilderBits";
import {
  goBackToAds,
  hostAdScrollBottomPadding,
} from "../../components/marketing/ads/hostAdBuilderRules";
import { hostAdRunDay } from "../../components/marketing/ads/hostAdAlerts";
import { hostAdLiveEditAttempt, type HostAdLiveEditAttempt } from "../../components/marketing/ads/HostAdLiveEditCard";
import {
  hm,
  hostAdAriRefusal,
  hostAdCountingLine,
  hostAdLearningWho,
  hostAdPauseConfirmWords,
  hostAdReasonLine,
  hostAdReasonShort,
  hostAdUnit,
} from "../../components/marketing/ads/hostAdManageCopy";
import {
  hostAdAppMinimumFromDetail,
  hostAdBrandLinkDecision,
  hostAdBudgetCard,
  hostAdConfirmKey,
  hostAdConfirmStillBound,
  hostAdCreativeRejected,
  hostAdDetailDailyCredit,
  hostAdGoalFromResult,
  hostAdHostCanResume,
  hostAdLatestStopCode,
  hostAdRejectionClass,
  hostAdResults,
  hostAdRoleBlock,
  hostAdTrueStopReason,
  type HostAdStopReason,
} from "../../components/marketing/ads/hostAdManageModel";
import {
  HostAdEditBudgetSheet,
  type HostAdEditSubmit,
  HostAdShareSheet,
  HostAdSuggestionCard,
  HostAdSuggestionConfirmSheet,
  hostAdShareMessage,
} from "../../components/marketing/ads/HostAdManageSheets";
import { HostAdTopUpSheet } from "../../components/marketing/ads/HostAdTopUpSheet";
import { randomId, randomUuid } from "../../utils/randomId";
import { HELP_SUPPORT_PERSON_ROUTE } from "../../constants/supportHostFacing";
import { hostAdGoalName } from "../../components/marketing/ads/hostAdBuilderCopy";
import { hostAdMinimumPayCents, hostAdPayFromCredit } from "../../components/marketing/ads/hostAdBuilderModel";

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && typeof value[0] === "string" && value[0].length > 0) return value[0];
  return null;
}

type Phase = "running" | "learning" | "review" | "paused" | "ended" | "rejected";

function errorCode(cause: unknown): { code: string | null; detail: string | null } {
  if (cause !== null && typeof cause === "object") {
    const failure = cause as { code?: unknown; detail?: unknown };
    return {
      code: typeof failure.code === "string" ? failure.code : null,
      detail: typeof failure.detail === "string" ? failure.detail : null,
    };
  }
  return { code: null, detail: null };
}

function StatusChip(props: { phase: Phase; label: string }): React.ReactElement {
  const tone =
    props.phase === "running"
      ? color.successText
      : props.phase === "learning" || props.phase === "review"
        ? color.infoText
        : props.phase === "paused"
          ? color.warningText
          : props.phase === "rejected"
            ? color.errorText
            : color.text3;
  return (
    <View style={styles.chip} accessibilityLabel={props.label} testID="ads-detail-status">
      <View style={[styles.chipDot, { backgroundColor: tone }]} />
      <Text style={styles.chipText}>{props.label}</Text>
    </View>
  );
}

/**
 * #4238 rework 5 (native P1-1): one screen instance per ad. A new route ad
 * (or `by`, or brand) remounts the body, so no confirm, sheet, error or
 * half-typed edit from the previous ad survives the move.
 */
export default function HostAdDetailRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string | string[]; by?: string | string[] }>();
  const brandId = useCurrentBrand()?.id ?? "";
  const adScreenKey = `${brandId}|${firstParam(params.id) ?? ""}|${firstParam(params.by) ?? ""}`;
  return <HostAdDetailBody key={adScreenKey} />;
}

function HostAdDetailBody(): React.ReactElement {
  const stickyFooterOffset = useStickyFooterOffset();
  const scrollBottomPadding = hostAdScrollBottomPadding(stickyFooterOffset);
  const [dockHeight, setDockHeight] = useState(0);
  const { isWideDesktop } = useResponsiveLayout();
  const network = useNetInfoSafe();
  const offline = network?.isConnected === false;
  const brand = useCurrentBrand();
  const brandId = brand?.id ?? null;
  const permissions = useHostAdPermissions(brandId);
  const wallet = useAdCreditWallet(brandId);
  const params = useLocalSearchParams<{ id?: string | string[]; by?: string | string[]; brand?: string | string[] }>();
  const linkBrandId = firstParam(params.brand);
  const brandList = useBrandListState();
  const setCurrentBrandId = useCurrentBrandStore((st) => st.setCurrentBrandId);
  // W6c: a notice for another brand switches to it (when the person is on
  // that brand's team) before the ad is looked up; otherwise it says so.
  const linkDecision = hostAdBrandLinkDecision({
    linkBrandId,
    currentBrandId: brandId,
    memberBrandIds: brandList.brands.map((item) => item.id),
    listStatus: brandList.isLoading ? "loading" : brandList.status === "ready" ? "ready" : "error",
  });
  useEffect(() => {
    if (linkDecision === "switch" && linkBrandId) setCurrentBrandId(linkBrandId);
  }, [linkBrandId, linkDecision, setCurrentBrandId]);
  const routeId = firstParam(params.id);
  const byPlan = firstParam(params.by) === "plan";
  const router = useRouter();
  const [campaignId, setCampaignId] = useState<string | null>(byPlan ? null : routeId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<HostAdCampaignDetail | null>(null);
  const [tab, setTab] = useState<"overview" | "numbers">("overview");
  const [pauseConfirmVisible, setPauseConfirmVisible] = useState(false);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [resumeVisible, setResumeVisible] = useState(false);
  const [destructive, setDestructive] = useState<"cancel" | "end" | null>(null);
  const [destructiveError, setDestructiveError] = useState<string | null>(null);
  const [editVisible, setEditVisible] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [needsLearningConfirm, setNeedsLearningConfirm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [ariVisible, setAriVisible] = useState(false);
  const [ariError, setAriError] = useState<string | null>(null);
  const [ariDismissed, setAriDismissed] = useState<string | null>(null);
  const [topUpCents, setTopUpCents] = useState<number | null>(null);
  const [shareVisible, setShareVisible] = useState(false);
  const editAttempt = useRef<HostAdLiveEditAttempt | null>(null);
  const inFlight = useRef(false);
  // #4238 rework 5 (native P1-1): the ad on screen now, and the ad the open
  // confirm was opened for. A submit runs only while the two match; after
  // this screen unmounts the current ad is null, so a stale submit refuses.
  const adKey = hostAdConfirmKey({ brandId, campaignId, planId: payload?.plan_id });
  const currentAdKey = useRef<string | null>(adKey);
  currentAdKey.current = adKey;
  useEffect(
    () => () => {
      currentAdKey.current = null;
    },
    [],
  );
  const [boundAdKey, setBoundAdKey] = useState<string | null>(null);
  const bindConfirm = useCallback((): void => setBoundAdKey(currentAdKey.current), []);
  const closeConfirms = useCallback((): void => {
    setPauseConfirmVisible(false);
    setResumeVisible(false);
    setDestructive(null);
    setEditVisible(false);
    setNeedsLearningConfirm(false);
    setAriVisible(false);
    setTopUpCents(null);
    setShareVisible(false);
    setBoundAdKey(null);
    editAttempt.current = null;
  }, []);
  // The ad behind the screen changed (a plan link resolving to another
  // campaign, a reload with another plan): nothing stays open.
  useEffect(() => {
    closeConfirms();
  }, [adKey, closeConfirms]);
  /** False (and every confirm closed, nothing sent) when the ad changed since the confirm opened. */
  const confirmStillBound = useCallback(
    (bound: string | null): boolean => {
      if (hostAdConfirmStillBound(bound, currentAdKey.current)) return true;
      closeConfirms();
      setError(hm("detail.actionFailed"));
      return false;
    },
    [closeConfirms],
  );
  // W6c: the apps' one-ad-set minimum (pay terms) for the edit sheet's floor.
  const [appsMinimumDailyPay, setAppsMinimumDailyPay] = useState<number | null>(null);
  const editApps = (payload?.plan_campaigns ?? []).map((row) => String(row.platform));
  const editAppsKey = editApps.join(",");
  const editGoal = hostAdGoalFromResult(String(payload?.measurement?.manifest?.result_hierarchy?.[0] ?? ""));
  useEffect(() => {
    if (!editVisible || brandId === null || editAppsKey === "") return;
    let live = true;
    loadHostAdPlanService()
      .then(({ loadHostAdSetup }) => cachedHostAdSetup(brandId, loadHostAdSetup))
      .then((setup) => {
        if (!live) return;
        const rows = editAppsKey.split(",").map((app) => hostAdMinimumPayCents(setup.minimums, app, editGoal));
        // One unknown app means the floor is unknown: the server still checks.
        setAppsMinimumDailyPay(rows.some((value) => value === null) ? null : rows.reduce<number>((sum, value) => sum + (value ?? 0), 0));
      })
      .catch(() => {
        if (live) setAppsMinimumDailyPay(null);
      });
    return () => {
      live = false;
    };
  }, [brandId, editAppsKey, editGoal, editVisible]);

  // A notice links to the plan; find its campaign once.
  useEffect(() => {
    if (!byPlan || brandId === null || routeId === null || !permissions.canRead || linkDecision !== "stay") return;
    let live = true;
    resolveHostAdCampaignForPlan(brandId, routeId)
      .then((id) => {
        if (!live) return;
        if (id === null) goBackToAds(router);
        else setCampaignId(id);
      })
      .catch(() => {
        if (live) setError(hm("detail.loadTitle"));
      });
    return () => {
      live = false;
    };
  }, [brandId, byPlan, linkDecision, permissions.canRead, routeId, router]);

  const load = useCallback(async () => {
    if (brandId === null || campaignId === null || !permissions.canRead) return;
    setError(null);
    try {
      setPayload(await getHostAdCampaign(brandId, campaignId));
    } catch {
      setError(hm("detail.loadTitle"));
      setPayload(null);
    }
  }, [brandId, campaignId, permissions.canRead]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (work: () => Promise<void>, onFail: (cause: unknown) => void): Promise<void> => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      try {
        await work();
      } catch (cause) {
        onFail(cause);
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [],
  );

  const onPause = useCallback(async () => {
    if (brandId === null || campaignId === null || !permissions.canPause) return;
    if (!confirmStillBound(boundAdKey)) return;
    setBusy(true);
    setPauseError(null);
    try {
      await pauseHostAdCampaign({ brandId, campaignId });
      setPauseConfirmVisible(false);
      await load();
    } catch {
      setPauseError(hm("detail.actionFailed"));
    } finally {
      setBusy(false);
    }
  }, [boundAdKey, brandId, campaignId, confirmStillBound, load, permissions.canPause]);

  const onResume = useCallback(async () => {
    if (campaignId === null || !permissions.canLaunch) return;
    if (!confirmStillBound(boundAdKey)) return;
    await run(
      async () => {
        await resumeHostAdCampaignPlan({ campaignId, reason: "Host resumed paused ad plan from Ads detail" });
        setResumeVisible(false);
        await load();
      },
      () => setError(hm("detail.actionFailed")),
    );
  }, [boundAdKey, campaignId, confirmStillBound, load, permissions.canLaunch, run]);

  const onStop = useCallback(async () => {
    if (brandId === null || campaignId === null || !permissions.canEnd || destructive === null) return;
    if (!confirmStillBound(boundAdKey)) return;
    const action = destructive;
    setDestructiveError(null);
    await run(
      async () => {
        const input = { brandId, campaignId, idempotencyKey: randomId() };
        if (action === "end") await endHostAdCampaign(input);
        else await cancelHostAdCampaign(input);
        setDestructive(null);
        await load();
      },
      () => setDestructiveError(hm("detail.actionFailed")),
    );
  }, [boundAdKey, brandId, campaignId, confirmStillBound, destructive, load, permissions.canEnd, run]);

  const onDuplicate = useCallback(async (step: "promote" | "creative") => {
    const planId = payload?.plan_id;
    if (brandId === null || !planId || !permissions.canPlan) return;
    await run(
      async () => {
        const draftId = await duplicateHostAdPlan({ brandId, planId, newDraftId: randomUuid() });
        router.push(`/(tabs)/marketing/ads/create?draft_id=${draftId}&step=${step}` as never);
      },
      () => setError(hm("detail.copyFailed")),
    );
  }, [brandId, payload?.plan_id, permissions.canPlan, router, run]);

  const onEdit = useCallback(async (input: HostAdEditSubmit) => {
    const planId = payload?.plan_id;
    if (brandId === null || !planId || !permissions.canFund) return;
    if (!confirmStillBound(boundAdKey)) return;
    const attempt = hostAdLiveEditAttempt(
      editAttempt.current,
      { planId, newBudgetCents: input.newBudgetCredit, newEndsAt: input.newEndsAt },
      randomUuid,
    );
    editAttempt.current = attempt;
    setEditError(null);
    await run(
      async () => {
        await changeHostAdLive({
          brandId,
          planId,
          newBudgetCents: input.newBudgetCredit,
          newEndsAt: input.newEndsAt,
          idempotencyKey: attempt.key,
          acknowledgeLearningReset: input.acknowledgeLearningReset,
        });
        editAttempt.current = null;
        setNeedsLearningConfirm(false);
        setEditVisible(false);
        setNotice(hm("edit.saved"));
        await load();
      },
      (cause) => {
        const { code, detail } = errorCode(cause);
        if (code === "host_ad_live_edit_learning_reset") {
          setNeedsLearningConfirm(true);
          return;
        }
        const appMin = code === "host_ad_live_edit_below_app_minimum" ? hostAdAppMinimumFromDetail(detail) : null;
        const currency = payload?.plan_currency ?? "";
        setEditError(
          appMin
            ? hm("edit.appMinimum", {
                app: platformNames([appMin.platform]),
                amount: formatHostAdMoneyCents(appMin.dailyPay, currency) ?? "",
              })
            : hostAdAriRefusal(code) ?? hm("detail.actionFailed"),
        );
      },
    );
  }, [boundAdKey, brandId, confirmStillBound, load, payload?.plan_currency, payload?.plan_id, permissions.canFund, run]);

  const onApplySuggestion = useCallback(async () => {
    const planId = payload?.plan_id;
    const suggestion = payload?.suggestion ?? null;
    if (brandId === null || !planId || suggestion === null) return;
    if (!confirmStillBound(boundAdKey)) return;
    setAriError(null);
    await run(
      async () => {
        if (suggestion.apply_action === "accept_last_tickets") {
          await acceptHostAdLastTickets({ brandId, planId, suggestionId: suggestion.suggestion_id });
          setNotice(hm("detail.lastTicketsOn"));
        } else {
          await changeHostAdLive({
            brandId,
            planId,
            suggestionId: suggestion.suggestion_id,
            idempotencyKey: `host_suggest_${suggestion.suggestion_id}`.slice(0, 120),
          });
          setNotice(hm("ari.done"));
        }
        setAriVisible(false);
        await load();
      },
      (cause) => {
        const { code } = errorCode(cause);
        setAriError(hostAdAriRefusal(code) ?? hm("detail.actionFailed"));
        if (code === "ad_suggestion_stale") void load();
      },
    );
  }, [boundAdKey, brandId, confirmStillBound, load, payload?.plan_id, payload?.suggestion, run]);

  const shell = (child: React.ReactElement): React.ReactElement => <View style={styles.host}>{child}</View>;

  if (linkDecision === "notMember") {
    return shell(
      <EmptyState illustration="users" title={hm("detail.notOnTeam")} description={hm("detail.notOnTeamBody")} testID="ads-detail-not-on-team" />,
    );
  }
  if (linkDecision === "wait" || linkDecision === "switch") {
    return (
      <View style={styles.host} testID="ads-detail-switching-brand">
        <ActivityIndicator color={color.text2} />
      </View>
    );
  }
  if (brandId === null || routeId === null) {
    return shell(
      <EmptyState illustration="users" title={hm("detail.notFound")} description={hm("detail.notFoundBody")} testID="ads-detail-missing" />,
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
    return shell(
      <EmptyState illustration="users" title={hm("detail.noAccess")} description={hm("detail.noAccessNoName")} testID="ads-detail-permission-denied" />,
    );
  }
  if (payload === null && error === null) {
    return (
      <View style={styles.host} testID="ads-detail-skeleton">
        <View style={styles.skel}>
          <View style={[styles.skelBlock, { height: 200 }]} />
          <View style={[styles.skelBlock, { height: 90 }]} />
          <View style={[styles.skelBlock, { height: 160 }]} />
        </View>
      </View>
    );
  }
  if (payload === null) {
    return shell(
      <EmptyState
        illustration="users"
        title={hm("detail.loadTitle")}
        description={hm("detail.loadBody")}
        testID="ads-detail-error"
        cta={{ label: hm("detail.tryAgain"), onPress: () => void load() }}
      />,
    );
  }

  // ── Derive the state ────────────────────────────────────────────────────
  const c = payload.campaign;
  const name = String(c.name ?? hm("detail.title"));
  const state = String(payload.plan_state ?? c.status ?? "").toLowerCase();
  const currency =
    typeof (payload.plan_currency ?? c.currency) === "string" &&
    /^[A-Z]{3}$/.test(String(payload.plan_currency ?? c.currency))
      ? String(payload.plan_currency ?? c.currency)
      : null;
  const money = (cents: number): string => (currency ? formatHostAdMoneyCents(cents, currency) ?? "" : "");
  const capCredit = Number(payload.plan_cap_cents ?? c.cap_cents ?? 0) || 0;
  const spentCredit = payload.host_spend_equivalent_cents;
  const hasSpend = payload.provider_spend_by_currency.some((row) => Number(row.spend_cents) > 0);
  const anyActive = payload.plan_campaigns.some((row) => String(row.status).toUpperCase() === "ACTIVE");
  const deleted = state === "deleted";
  const ended =
    deleted ||
    ["ended", "settling", "stop_requested", "settlement_attention_required"].includes(state) ||
    (payload.plan_campaigns.length > 0 &&
      payload.plan_campaigns.every((row) => ["ARCHIVED", "DELETED"].includes(String(row.status).toUpperCase())));
  const paused = !ended && ["paused", "pause_requested"].includes(state);
  const creatives = payload.creatives ?? [];
  const rejectedCreatives = creatives.filter((row) => hostAdCreativeRejected(row));
  const allRejected = state === "platform_rejected" || (creatives.length > 0 && rejectedCreatives.length === creatives.length);
  const partRejected = !allRejected && rejectedCreatives.length > 0;
  const review = !ended && !paused && !allRejected && !anyActive && /review|scheduled|pending|ready/.test(state);
  const live = !ended && !paused && !allRejected && (anyActive || ["live", "partially_live"].includes(state));
  const learning = live && payload.learning?.state === "learning";
  const phase: Phase = ended ? "ended" : allRejected ? "rejected" : paused ? "paused" : review ? "review" : learning ? "learning" : "running";
  const stopCode = hostAdLatestStopCode(payload.timeline);
  const hostStopped = payload.timeline.some(
    (row) => ["end", "cancel", "pause"].includes(row.action) && typeof row.provider_response?.reason !== "string",
  );
  const reason: HostAdStopReason | null = hostAdTrueStopReason({
    state: ended ? "ended" : paused ? "paused" : live ? "running" : review ? "review" : "other",
    deleted,
    code: stopCode,
    spentCredit,
    capCredit,
    hostEnded: hostStopped,
  });
  const hierarchy = Array.isArray(payload.measurement?.manifest?.result_hierarchy)
    ? payload.measurement.manifest.result_hierarchy
    : [];
  const goal = hostAdGoalFromResult(String(hierarchy[0] ?? ""));
  const results = hostAdResults({
    goal,
    spentCredit,
    tickets: payload.results?.tickets,
    signUps: payload.results?.sign_ups,
    clicks7d: payload.results?.clicks_7d,
    conversions: payload.results?.conversions,
    salesValue: currency ? payload.results?.value_cents?.[currency] ?? null : null,
  });
  // #4238 rework 1 (tester P1-2/P1-3): the plan's daily in the brand's money
  // (server plan_daily_credit_cents), never a sum of the campaigns' raw
  // daily_budget_cents (null for ad-group budgets, and in the ad account's money).
  const dailyCredit = hostAdDetailDailyCredit(payload.plan_daily_credit_cents);
  const budget = hostAdBudgetCard({ dailyCredit, capCredit, spentCredit });
  const endsAt =
    payload.plan_campaigns
      .map((row) => row.ends_at)
      .filter((value): value is string => typeof value === "string")
      .sort()
      .pop() ?? null;
  const tz = payload.time_zone ?? null;
  const publicPageUrl = typeof payload.public_page_url === "string" && payload.public_page_url ? payload.public_page_url : null;
  const dateText = (iso: string): string =>
    new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", ...(tz ? { timeZone: tz } : {}) });
  const apps = platformNames(payload.plan_campaigns.map((row) => String(row.platform)));
  const caps = payload.capabilities ?? null;
  const block = (action: "pause" | "end" | "change_live" | "launch" | "plan", allowed: boolean) =>
    hostAdRoleBlock({ action, allowedByRole: allowed, capabilities: caps });
  const pauseBlock = block("pause", permissions.canPause);
  const endBlock = block("end", permissions.canEnd);
  const editBlock = block("change_live", permissions.canFund);
  const launchBlock = block("launch", permissions.canLaunch);
  const askName = [pauseBlock, endBlock, editBlock]
    .map((b) => (b.blocked ? b.askName : null))
    .find((v): v is string => typeof v === "string") ?? null;
  const teamReadOnly = pauseBlock.blocked && endBlock.blocked;
  const nextEditAt =
    payload.next_live_edit_at && Date.parse(payload.next_live_edit_at) > Date.now() ? payload.next_live_edit_at : null;
  const suggestion =
    payload.suggestion && payload.suggestion.suggestion_id !== ariDismissed && !ended ? payload.suggestion : null;
  const held = budget.stillHeldPay;
  const backPay = payload.settlements.reduce((sum, row) => sum + Math.max(0, Number(row.released_host_cents ?? 0)), 0);
  const settling = payload.settlements.some((row) => row.settled_at === null);
  const runDay = hostAdRunDay(typeof c.starts_at === "string" ? c.starts_at : null, new Date().toISOString(), tz);

  // ── Status line ─────────────────────────────────────────────────────────
  const statusLabel =
    phase === "ended" || phase === "paused"
      ? reason
        ? hm("status.with", { status: hm(`status.${phase}`), reason: hostAdReasonShort(reason) })
        : hm(`status.${phase}`)
      : phase === "review"
        ? hm("status.inReview")
        : phase === "rejected"
          ? hm("status.rejected")
          : partRejected
            ? hm("status.partRejected", { count: rejectedCreatives.length })
            : hm(`status.${phase}`);
  const statusLine =
    reason !== null
      ? hostAdReasonLine(reason, ended)
      : review
        ? hm("detail.inReview")
        : learning
          ? hm("detail.learning", { day: Math.min(7, payload.days_live ?? runDay ?? 1), who: hostAdLearningWho(goal) })
          : live
            ? hm("detail.runningOn", { apps })
            : null;
  const rejectedNote =
    allRejected || partRejected ? (
      <Note
        tone={allRejected ? "error" : "warn"}
        testID="ads-detail-rejected"
        text={[
          allRejected
            ? hm("detail.rejectedTitle", { app: apps })
            : hm("detail.partRejectedTitle", { app: apps, count: rejectedCreatives.length }),
          ...(() => {
            const cls = hostAdRejectionClass(rejectedCreatives[0]?.review_detail);
            return cls ? [hm(`reject.${cls}`), hm(`reject.${cls}Fix`)] : [hm("detail.rejectedGeneral")];
          })(),
        ].join(" ")}
        actions={
          <>
            {permissions.canPlan ? (
              <Button label={hm("detail.changeVideo")} variant="secondary" size="sm" onPress={() => void onDuplicate("creative")} testID="ads-detail-change-video" />
            ) : null}
            <Button label={hm("detail.help")} variant="ghost" size="sm" onPress={() => router.push(HELP_SUPPORT_PERSON_ROUTE as never)} testID="ads-detail-help" />
          </>
        }
      />
    ) : null;

  // ── Cards ───────────────────────────────────────────────────────────────
  const hasNumbers = results.spentPay > 0;
  const head =
    goal === "sales"
      ? results.salesValue !== null
        ? hm("detail.headSales", { spent: money(results.spentPay), count: results.count, sales: money(results.salesValue) })
        : hm("detail.headSalesNoValue", { spent: money(results.spentPay), count: results.count })
      : goal === "signups"
        ? hm("detail.headSignups", { spent: money(results.spentPay), count: results.count })
        : hm("detail.headVisits", { spent: money(results.spentPay), count: results.count });
  const summary = (
    <BuilderCard accessibilityLabel={hm("detail.results")} testID="ads-detail-results">
      <BuilderLabel>{hm("detail.results")}</BuilderLabel>
      {!hasNumbers ? (
        <Text style={bs.small} testID="ads-detail-results-none">
          {allRejected || deleted ? hm("detail.nothingSpent", { amount: money(budget.totalPay) }) : hm("detail.resultsNone")}
        </Text>
      ) : (
        <>
          <Text style={styles.head} testID="ads-detail-head">{head}</Text>
          <View style={styles.tiles}>
            <View style={styles.tile}>
              <Text style={bs.caption}>{hm("detail.tileSpent")}</Text>
              <Text style={styles.stat} testID="ads-detail-spent">{money(results.spentPay)}</Text>
            </View>
            <View style={styles.tile}>
              <Text style={bs.caption}>{hm(goal === "sales" ? "detail.tileTickets" : goal === "signups" ? "detail.tileSignups" : "detail.tileVisits")}</Text>
              <Text style={styles.stat} testID="ads-detail-count">{String(results.count)}</Text>
            </View>
            <View style={styles.tile}>
              <Text style={bs.caption}>{hm("detail.tilePer", { unit: hostAdUnit(goal, true) })}</Text>
              <Text style={styles.stat} testID="ads-detail-each">{results.eachPay === null ? "—" : money(results.eachPay)}</Text>
            </View>
            {results.salesValue !== null ? (
              <View style={styles.tile}>
                <Text style={bs.caption}>{hm("detail.tileSales")}</Text>
                <Text style={styles.stat}>{money(results.salesValue)}</Text>
              </View>
            ) : null}
          </View>
          {ended && results.returnX !== null && results.salesValue !== null ? (
            <Text style={bs.body}>
              {hm("detail.returnLine", { spent: money(results.spentPay), sales: money(results.salesValue), times: results.returnX.toFixed(1) })}
            </Text>
          ) : null}
          <Text style={bs.caption} testID="ads-detail-counting">
            {`${hostAdCountingLine(goal)} ${hm("detail.toAds", { amount: money(results.spentCredit) })}`}
          </Text>
          {ended && results.count > 0 && publicPageUrl ? (
            <View style={bs.actions}>
              <Button label={hm("detail.share")} variant="secondary" size="md" onPress={() => setShareVisible(true)} testID="ads-detail-share" />
            </View>
          ) : null}
        </>
      )}
    </BuilderCard>
  );
  const numbers = (
    <BuilderCard accessibilityLabel={hm("detail.dayByDay")} testID="ads-detail-numbers">
      <BuilderLabel>{hm("detail.dayByDay")}</BuilderLabel>
      <Text style={bs.caption} testID="ads-detail-day-by-day-terms">{hm("detail.dayByDayTerms")}</Text>
      <AdResultsSection
        daily={payload.daily ?? []}
        byPlatformSpend={payload.by_platform_spend ?? []}
        dailyError={payload.daily_error === "unavailable"}
        hostCurrency={currency}
        budgetCents={capCredit > 0 ? capCredit : null}
        resultKind={String(hierarchy[0] ?? "results")}
        notes={[hostAdCountingLine(goal)]}
        placements={payload.by_placement}
        onRetry={() => void load()}
      />
    </BuilderCard>
  );
  const budgetCard =
    !ended && !allRejected && currency ? (
      <BuilderCard accessibilityLabel={hm("detail.budget")} testID="ads-detail-budget">
        <BuilderLabel>{hm("detail.budget")}</BuilderLabel>
        <View style={bs.kv}>
          {budget.dailyPay !== null ? (
            <View style={bs.kvRow}>
              <Text style={bs.kvKey}>{hm("detail.payADay")}</Text>
              <Text style={bs.kvVal} testID="ads-detail-pay-a-day">{money(budget.dailyPay)}</Text>
            </View>
          ) : null}
          <View style={bs.kvRow}>
            <Text style={bs.kvKey}>{hm("detail.payTotal")}</Text>
            <Text style={bs.kvVal}>{money(budget.totalPay)}</Text>
          </View>
          <View style={bs.kvRow}>
            <Text style={bs.kvKey}>{hm("detail.ends")}</Text>
            <Text style={bs.kvVal}>{endsAt ? dateText(endsAt) : hm("detail.noEnd")}</Text>
          </View>
          <View style={bs.kvRow}>
            <Text style={bs.kvKey}>{hm("detail.stillHeld")}</Text>
            <Text style={bs.kvVal} testID="ads-detail-held">{money(held)}</Text>
          </View>
        </View>
        {budget.dailyToAds !== null ? (
          <Text style={bs.caption}>{hm("detail.aDayToAds", { amount: money(budget.dailyToAds) })}</Text>
        ) : null}
        {payload.plan_id ? (
          editBlock.blocked ? (
            <Text style={bs.caption} testID="ads-detail-edit-blocked">
              {editBlock.askName ? hm("detail.team", { name: editBlock.askName }) : hm("detail.teamNoName")}
            </Text>
          ) : (
            <>
              <Button
                label={hm("detail.edit")}
                variant="secondary"
                size="md"
                fullWidth
                disabled={busy || offline || nextEditAt !== null}
                onPress={() => {
                  setEditError(null);
                  setNeedsLearningConfirm(false);
                  bindConfirm();
                  setEditVisible(true);
                }}
                testID="ads-detail-edit"
              />
              {nextEditAt ? (
                <Text style={bs.caption} testID="ads-detail-edit-wait">
                  {hm("detail.nextEdit", { when: dateText(nextEditAt) })}
                </Text>
              ) : null}
            </>
          )
        ) : null}
      </BuilderCard>
    ) : null;
  const refundCard = ended ? (
    <BuilderCard accessibilityLabel={hm("detail.money")} testID="ads-detail-money">
      <BuilderLabel>{hm("detail.money")}</BuilderLabel>
      <View style={bs.kv}>
        <View style={bs.kvRow}>
          <Text style={bs.kvKey}>{hm("detail.tileSpent")}</Text>
          <Text style={bs.kvVal}>{money(results.spentPay)}</Text>
        </View>
        <View style={bs.kvRow}>
          <Text style={bs.kvKey}>{hm("detail.back")}</Text>
          <Text style={bs.kvVal} testID="ads-detail-back">{money(backPay > 0 ? hostAdPayFromCredit(backPay) : held)}</Text>
        </View>
      </View>
      {settling ? <Note tone="info" text={hm("detail.backPending")} /> : null}
    </BuilderCard>
  ) : null;

  const ariCard =
    suggestion && suggestion.kind !== "accept_last_tickets" && suggestion.kind !== "new_video" ? (
      <HostAdSuggestionCard
        suggestion={suggestion}
        goal={goal}
        money={money}
        dateText={dateText}
        canApply={!editBlock.blocked && !offline}
        blockedReason={editBlock.blocked ? (editBlock.askName ? hm("detail.team", { name: editBlock.askName }) : hm("detail.teamNoName")) : null}
        onReview={() => {
          setAriError(null);
          bindConfirm();
          setAriVisible(true);
        }}
        onAddVideo={() => void onDuplicate("creative")}
        onDismiss={() => setAriDismissed(suggestion.suggestion_id)}
      />
    ) : null;
  const smart =
    suggestion?.kind === "accept_last_tickets" ? (
      <Note
        tone="info"
        text={hm("detail.lastTicketsOffer")}
        testID="ads-detail-last-tickets"
        actions={
          !editBlock.blocked && !offline ? (
            <Button
              label={hm("detail.lastTicketsAccept")}
              variant="secondary"
              size="sm"
              loading={busy}
              onPress={() => {
                setAriError(null);
                bindConfirm();
                setAriVisible(true);
              }}
              testID="ads-detail-last-tickets-accept"
            />
          ) : undefined
        }
      />
    ) : suggestion?.kind === "new_video" ? (
      <Note
        tone="warn"
        text={hm("detail.tired")}
        testID="ads-detail-tired"
        actions={
          permissions.canPlan ? (
            <Button label={hm("detail.addVideo")} variant="secondary" size="sm" onPress={() => void onDuplicate("creative")} testID="ads-detail-tired-video" />
          ) : undefined
        }
      />
    ) : null;

  const canCancel = !ended && !hasSpend;
  const actions = ended || allRejected ? null : teamReadOnly ? (
    <View style={bs.stack} testID="ads-detail-team">
      <Note tone="info" text={askName ? hm("detail.team", { name: askName }) : hm("detail.teamNoName")} />
      <View style={bs.actions}>
        <Button label={hm("detail.pause")} variant="secondary" size="md" style={styles.flex} disabled onPress={() => undefined} testID="ads-detail-pause" />
        <Button label={hm("detail.end")} variant="dangerText" size="md" style={styles.flex} disabled onPress={() => undefined} testID="ads-detail-end" />
      </View>
    </View>
  ) : (
    <View style={bs.actions} testID="ads-detail-actions">
      {live && !pauseBlock.blocked ? (
        <Button
          label={hm("detail.pause")}
          variant="secondary"
          size="md"
          style={styles.flex}
          disabled={busy || offline}
          onPress={() => {
            setPauseError(null);
            bindConfirm();
            setPauseConfirmVisible(true);
          }}
          accessibilityLabel={hm("confirm.pauseTitle")}
          testID="ads-detail-pause"
        />
      ) : null}
      {!endBlock.blocked ? (
        <Button
          label={canCancel ? hm("detail.cancel") : hm("detail.end")}
          variant="dangerText"
          size="md"
          style={styles.flex}
          disabled={busy || offline}
          onPress={() => {
            setDestructiveError(null);
            bindConfirm();
            setDestructive(canCancel ? "cancel" : "end");
          }}
          testID={canCancel ? "ads-detail-cancel" : "ads-detail-end"}
        />
      ) : null}
    </View>
  );
  const dupRow =
    !ended && payload.plan_id && permissions.canPlan && !offline ? (
      <BuilderList>
        <ValueRow
          label={hm("detail.duplicate")}
          value={hm("detail.duplicateSub")}
          onPress={() => void onDuplicate("promote")}
          testID="ads-detail-duplicate"
        />
      </BuilderList>
    ) : null;
  const canResume = paused && hostAdHostCanResume(reason) && !launchBlock.blocked;
  const dock = canResume ? (
    <View style={bs.stack}>
      {(payload.days_live ?? 8) <= 7 ? <Blocker text={hm("detail.resumeLearning")} /> : null}
      <Button
        label={hm("detail.resume")}
        variant="primary"
        fullWidth
        disabled={busy || offline}
        onPress={() => {
          bindConfirm();
          setResumeVisible(true);
        }}
        testID="ads-detail-resume"
      />
    </View>
  ) : paused && reason === "creditOut" && wallet.canView ? (
    <Button label={hm("detail.topUp")} variant="primary" fullWidth disabled={offline} onPress={() => setTopUpCents(budget.dailyPay ?? budget.totalPay)} testID="ads-detail-topup" />
  ) : allRejected ? (
    <View style={styles.stackedDock} testID="ads-detail-rejected-dock">
      <Button label={hm("detail.askAri")} variant="secondary" fullWidth onPress={() => router.push(`/(tabs)/ari?brandId=${encodeURIComponent(brandId)}` as never)} testID="ads-detail-ask-ari" />
      {permissions.canPlan ? (
        <Button label={hm("detail.changeVideo")} variant="primary" fullWidth onPress={() => void onDuplicate("creative")} testID="ads-detail-rejected-change" />
      ) : null}
    </View>
  ) : ended && payload.plan_id && permissions.canPlan ? (
    <Button label={hm("detail.promoteAgain")} variant="primary" fullWidth disabled={busy || offline} onPress={() => void onDuplicate("promote")} testID="ads-detail-promote-again" />
  ) : null;

  const hero = (
    <View style={styles.hero} testID="ads-detail-hero">
      <StatusChip phase={phase} label={statusLabel} />
      <Text style={styles.title} accessibilityRole="header">{name}</Text>
      <Text style={styles.sub}>{`${hostAdGoalName(goal)} · ${apps}`}</Text>
    </View>
  );
  const top = (
    <>
      {offline ? <Note tone="info" text={hm("detail.offline")} testID="ads-detail-offline" /> : null}
      {notice ? <Note tone="ok" text={notice} testID="ads-detail-notice" /> : null}
      {error ? <Note tone="error" text={error} testID="ads-detail-action-error" /> : null}
      {rejectedNote ?? (statusLine ? <Text style={bs.body} testID="ads-detail-why">{statusLine}</Text> : null)}
      {smart}
    </>
  );
  const segment = hasNumbers && !isWideDesktop ? (
    <Segmented
      value={tab}
      options={[
        { id: "overview", label: hm("detail.overview") },
        { id: "numbers", label: hm("detail.numbers") },
      ]}
      onChange={setTab}
      accessibilityLabel={hm("detail.view")}
      testID="ads-detail-tabs"
    />
  ) : null;

  // #4238 rework 5 (native P1-2): on phones the next-step dock is pinned above
  // the floating tab bar, and the scroll reserves its measured height plus
  // breathing room so the last card never hides behind it.
  const pinnedDock = !isWideDesktop && dock !== null;
  const phoneBottomPadding = pinnedDock ? Math.max(scrollBottomPadding, dockHeight + space[6]) : scrollBottomPadding;
  const onDockLayout = (event: LayoutChangeEvent): void => {
    const next = Math.ceil(event.nativeEvent.layout.height);
    if (next !== dockHeight) setDockHeight(next);
  };
  const pauseWords = hostAdPauseConfirmWords({ capCredit, spentCredit, currency });

  return (
    <View style={styles.host} testID="ads-detail-screen">
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: phoneBottomPadding }]}>
        <IconChrome icon="chevL" onPress={() => goBackToAds(router)} accessibilityLabel={hm("detail.back2")} testID="ads-detail-back" />
        {isWideDesktop ? (
          <View style={styles.desk}>
            <View style={styles.deskMain}>
              {hero}
              {top}
              {summary}
              {hasNumbers ? numbers : null}
            </View>
            <View style={styles.deskSide}>
              {ariCard}
              {budgetCard}
              {refundCard}
              {actions}
              {dupRow}
              {dock}
            </View>
          </View>
        ) : (
          <View style={styles.phone}>
            {hero}
            {segment}
            {tab === "numbers" && hasNumbers ? (
              numbers
            ) : (
              <>
                {top}
                {ariCard}
                {summary}
                {budgetCard}
                {refundCard}
                {actions}
                {dupRow}
              </>
            )}
          </View>
        )}
      </ScrollView>
      {pinnedDock ? (
        <View style={styles.dockWrap} onLayout={onDockLayout} testID="ads-detail-dock">
          <Material kind="chrome" style={[styles.dock, { paddingBottom: Math.max(space[6], stickyFooterOffset) }]}>
            {dock}
          </Material>
        </View>
      ) : null}
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
        title={pauseWords.title}
        description={pauseWords.description}
        confirmLabel={pauseWords.confirmLabel}
        cancelLabel={pauseWords.cancelLabel}
        confirmLoading={busy}
        closeDisabled={busy}
        errorMessage={pauseError}
        confirmTestID="ads-detail-pause-confirm"
        cancelTestID="ads-detail-pause-keep"
        testID="ads-detail-pause-dialog"
      />
      <ConfirmDialog
        visible={resumeVisible}
        onClose={() => {
          if (!busy) setResumeVisible(false);
        }}
        onConfirm={onResume}
        variant="simple"
        title={hm("confirm.resumeTitle")}
        description={hm("confirm.resumeBody")}
        confirmLabel={hm("confirm.resume")}
        cancelLabel={hm("confirm.notNow")}
        confirmLoading={busy}
        closeDisabled={busy}
        confirmTestID="ads-detail-resume-confirm"
        testID="ads-detail-resume-dialog"
      />
      <ConfirmDialog
        visible={destructive !== null}
        onClose={() => {
          if (!busy) {
            setDestructive(null);
            setDestructiveError(null);
          }
        }}
        onConfirm={onStop}
        variant="simple"
        title={destructive === "end" ? hm("confirm.endTitle") : hm("confirm.cancelTitle")}
        description={
          destructive === "end"
            ? hm("confirm.endBody", { amount: money(held) })
            : hm("confirm.cancelBody", { amount: money(budget.totalPay) })
        }
        confirmLabel={destructive === "end" ? hm("confirm.end") : hm("confirm.cancel")}
        cancelLabel={destructive === "end" ? hm("confirm.keepRunning") : hm("confirm.keepIt")}
        destructive
        confirmLoading={busy}
        closeDisabled={busy}
        errorMessage={destructiveError}
        confirmTestID="ads-detail-destructive-confirm"
        testID="ads-detail-destructive-dialog"
      />
      {currency && payload.plan_id ? (
        <HostAdEditBudgetSheet
          visible={editVisible}
          currency={currency}
          money={money}
          capCredit={capCredit}
          dailyCredit={dailyCredit}
          minDailyPay={appsMinimumDailyPay}
          spentCredit={spentCredit}
          walletCredit={wallet.data?.wallet?.balance_cents ?? null}
          currentEndsAt={endsAt}
          timezone={tz}
          nowIso={new Date().toISOString()}
          learning={learning}
          daysLive={payload.days_live ?? runDay}
          busy={busy}
          needsLearningConfirm={needsLearningConfirm}
          error={editError}
          onTopUp={(cents) => setTopUpCents(cents)}
          onClose={() => {
            if (!busy) setEditVisible(false);
          }}
          onSubmit={(input) => void onEdit(input)}
        />
      ) : null}
      {suggestion ? (
        <HostAdSuggestionConfirmSheet
          visible={ariVisible}
          suggestion={suggestion}
          money={money}
          dateText={dateText}
          busy={busy}
          error={ariError}
          onClose={() => {
            if (!busy) setAriVisible(false);
          }}
          onApply={() => void onApplySuggestion()}
        />
      ) : null}
      {currency && topUpCents !== null ? (
        <HostAdTopUpSheet
          visible
          brandId={brandId}
          currency={currency}
          neededCents={topUpCents}
          showNeed={editVisible}
          limits={wallet.data?.top_up_limits ?? null}
          returnPath="/marketing/ads"
          money={money}
          onClose={() => setTopUpCents(null)}
          onApplied={() => {
            setTopUpCents(null);
            void wallet.refetch();
            void load();
          }}
        />
      ) : null}
      {publicPageUrl ? (
        <HostAdShareSheet
          visible={shareVisible}
          url={publicPageUrl}
          title={name}
          message={hostAdShareMessage({ event: name, goal, count: results.count, soldOut: reason === "soldOut" })}
          onClose={() => setShareVisible(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: color.canvas },
  scroll: { paddingHorizontal: space[4], paddingTop: space[4], paddingBottom: space[9], gap: space[6] },
  phone: { gap: space[6] },
  desk: { flexDirection: "row", alignItems: "flex-start", gap: space[8] },
  deskMain: { flex: 1, minWidth: 0, gap: space[6] },
  deskSide: { width: 360, gap: space[6] },
  flex: { flex: 1 },
  // #4238 rework 6: stacked full-width buttons so a long label never truncates.
  stackedDock: { gap: space[3] },
  hero: {
    gap: space[3],
    padding: space[6],
    borderRadius: radius.xxl,
    backgroundColor: color.card2,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: space[2],
    paddingVertical: space[1],
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    backgroundColor: color.fill.tile,
  },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { ...type.caption, color: color.text1 },
  title: { ...type.h1, color: color.text1 },
  sub: { ...type.small, color: color.text2 },
  head: { ...type.h2, color: color.text1 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  tile: {
    flexBasis: "46%",
    flexGrow: 1,
    gap: space[1],
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: color.fill.input,
  },
  stat: { ...type.stat, color: color.text1 },
  skel: { padding: space[4], gap: space[4] },
  dockWrap: { position: "absolute", left: 0, right: 0, bottom: 0 },
  dock: {
    paddingTop: space[4],
    paddingHorizontal: space[4],
    gap: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  skelBlock: { borderRadius: radius.xl, backgroundColor: color.fill.tile },
});
