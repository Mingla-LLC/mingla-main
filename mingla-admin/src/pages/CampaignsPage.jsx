/**
 * ISSUE-864 WP4 [Full Rooms Ad Engine] — the campaign surface (list + detail).
 *
 * This is where LAUNCH lives (never in the builder — SC-10 /
 * I-PROPOSED-864-CREATE-PAUSED). Per campaign:
 *  - DUAL badges: advertiser status + delivery (effective) status
 *  - Launch (with the blueprint §1.8 confirm modal + pacing copy) / Pause
 *  - the 200+warning states from admin-ad-campaign-action rendered, never
 *    swallowed (PENDING_BILLING_INFO / BALANCE_EXCEED / DISAPPROVED…)
 *  - Sync (admin-ad-campaign-sync) per campaign + sweep
 *  - detail (?campaignId=): ad sets + ads with review_status + review_detail
 *    rendered through the blueprint §1.9b cause→fix map (verbatim platform
 *    text ALWAYS shown alongside our mapping).
 */

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  MessageSquareWarning,
  Pause,
  RefreshCw,
  Rocket,
  XCircle,
} from "lucide-react";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { HighRiskActionModal } from "../components/entity/HighRiskActionModal";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../context/ToastContext";
import {
  adPlanAction,
  campaignAction,
  getCampaignConversions,
  getCampaignDetail,
  getStayCampaignRollup,
  listCampaigns,
  parseEdgeError,
  syncCampaigns,
} from "../services/adEngineService";
import {
  DELIVERY_BADGE_VARIANTS,
  mapReviewDetail,
} from "../lib/adBuilder/reviewDetailMap";
import { launchConfirmCopy } from "../lib/adBuilder/budgetRules";
import { PLATFORM_LABELS } from "../lib/adBuilder/channelPlan";
import { LAUNCH_CONFIRM_PHRASE } from "../lib/adLaunchConfirm";
// ISSUE-865 PR1 WP-4 — pure ROI math (ROAS/cost-per-result only from REAL spend).
import { toCampaignRoiView } from "../lib/adRoi";
import {
  canLaunchCampaign,
  canPauseCampaign,
  formatCampaignMoney,
  scheduleWindowLabel,
  spendCapProgress,
} from "../lib/adSpendCap";
import { loadFeatureFlags } from "../lib/featureFlags";
import { PageHeader } from "../components/ui/PageHeader";

function formatMinor(currency, minor) {
  const value = Number(minor);
  if (!/^[A-Z]{3}$/.test(currency) || !Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(value / 100);
  } catch {
    return `${currency} ${(value / 100).toFixed(2)}`;
  }
}

function providerEstimateLabel(estimate) {
  if (
    estimate?.state === "available" &&
    Number.isFinite(estimate.lower_bound) &&
    Number.isFinite(estimate.upper_bound)
  ) {
    return `${estimate.lower_bound.toLocaleString()}–${estimate.upper_bound.toLocaleString()} potential reach`;
  }
  return String(estimate?.state ?? "unavailable").replaceAll("_", " ");
}

function CurrencyRows({ values }) {
  const rows =
    values && typeof values === "object" ? Object.entries(values) : [];
  if (rows.length === 0) return <span>—</span>;
  return (
    <div className="space-y-1">
      {rows.map(([currency, minor]) => (
        <div key={currency}>{formatMinor(currency, minor)}</div>
      ))}
    </div>
  );
}

function campaignIdFromHash() {
  const query = window.location.hash.split("?")[1] ?? "";
  return new URLSearchParams(query).get("campaignId");
}

function providerMoneyAuthority(campaign) {
  const providerCurrency =
    typeof campaign?.provider_currency === "string" &&
    /^[A-Z]{3}$/.test(campaign.provider_currency)
      ? campaign.provider_currency
      : null;
  const frozenProviderCap = Number(campaign?.provider_budget_cents);
  const providerCapCents =
    Number.isSafeInteger(frozenProviderCap) && frozenProviderCap > 0
      ? frozenProviderCap
      : null;
  const frozenProviderDelivery = Number(
    campaign?.provider_delivery_budget_cents,
  );
  const providerDeliveryCents =
    Number.isSafeInteger(frozenProviderDelivery) && frozenProviderDelivery > 0
      ? frozenProviderDelivery
      : null;
  const cadence =
    campaign?.lifetime_budget_cents != null ? "lifetime" : "daily";
  return {
    providerCurrency,
    providerCapCents,
    providerDeliveryCents,
    cadence,
  };
}

function campaignsForPlan(campaigns, campaign) {
  const versionId = campaign?.plan_version_id;
  const planHash = campaign?.plan_hash;
  if (!versionId || !/^[0-9a-f]{64}$/.test(planHash ?? "")) return [];
  return campaigns.filter(
    (row) => row.plan_version_id === versionId && row.plan_hash === planHash,
  );
}

function canLaunchWithProviderMoney(campaign, campaigns) {
  const planCampaigns = campaignsForPlan(campaigns, campaign);
  return (
    canLaunchCampaign(campaign?.status) &&
    planCampaigns.length > 0 &&
    planCampaigns.every((row) => {
      const authority = providerMoneyAuthority(row);
      return (
        authority.providerCurrency !== null &&
        authority.providerCapCents !== null &&
        authority.providerDeliveryCents !== null &&
        authority.providerDeliveryCents <= authority.providerCapCents
      );
    })
  );
}

export function CampaignsPage() {
  const { addToast } = useToast();
  const [adsConsoleEnabled, setAdsConsoleEnabled] = useState(true);
  const [adsConsoleReady, setAdsConsoleReady] = useState(false);
  const [campaigns, setCampaigns] = useState(null);
  const [reviewQueue, setReviewQueue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedId, setSelectedId] = useState(campaignIdFromHash());
  const [rowBusy, setRowBusy] = useState({});
  const [rowWarning, setRowWarning] = useState({});
  const [launchTarget, setLaunchTarget] = useState(null);
  const [reviewTarget, setReviewTarget] = useState(null);
  // ISSUE-865 PR1 WP-4 — per-campaign conversions & ROI (the detail panel feed).
  const [roiPayload, setRoiPayload] = useState(null);
  const [roiLoading, setRoiLoading] = useState(false);
  const [stayRollup, setStayRollup] = useState(null);
  const [stayRollupLoading, setStayRollupLoading] = useState(false);
  const [stayRollupError, setStayRollupError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data, error }, reviewResult] = await Promise.all([
      listCampaigns(),
      adPlanAction({ action: "review_queue" }),
    ]);
    if (error) {
      addToast({
        variant: "error",
        title: "Campaign list failed",
        description: error.message,
      });
      setCampaigns([]);
    } else {
      setCampaigns(data ?? []);
    }
    if (reviewResult.error) {
      const parsed = await parseEdgeError(reviewResult.error);
      addToast({
        variant: "error",
        title: "Host review queue failed",
        description: String(
          parsed?.message ?? "The review queue could not load.",
        ),
      });
      setReviewQueue([]);
    } else {
      setReviewQueue(reviewResult.data?.queue ?? []);
    }
    setLoading(false);
  }, [addToast]);

  const handleReview = async ({ item, decision, reason }) => {
    const version = item?.version;
    if (!version?.id || !version?.plan_hash)
      throw new Error("Plan binding is missing");
    const { error } = await adPlanAction({
      action: "review",
      plan_version_id: version.id,
      plan_hash: version.plan_hash,
      decision,
      reason,
    });
    if (error) {
      const parsed = await parseEdgeError(error);
      throw new Error(String(parsed?.message ?? "Review failed"));
    }
    addToast({
      variant: decision === "approved" ? "success" : "warning",
      title:
        decision === "approved"
          ? "Plan approved. The Host can resume it."
          : decision === "changes_requested"
            ? "Changes requested. Held funds were released."
            : "Plan rejected. Held funds were released.",
    });
    await load();
  };

  const loadDetail = useCallback(
    async (campaignId) => {
      if (!campaignId) {
        setDetail(null);
        return;
      }
      setDetailLoading(true);
      const { data, error } = await getCampaignDetail(campaignId);
      if (error) {
        addToast({
          variant: "error",
          title: "Campaign detail failed",
          description: error.message,
        });
        setDetail(null);
      } else {
        setDetail(data ?? null);
      }
      setDetailLoading(false);
    },
    [addToast],
  );

  useEffect(() => {
    // Initial remote snapshot; state transitions live inside the async loader.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    let mounted = true;
    loadFeatureFlags().then((flags) => {
      if (!mounted) return;
      setAdsConsoleEnabled(flags.enable_ads_console !== false);
      setAdsConsoleReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const onHashChange = () => setSelectedId(campaignIdFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    // Route selection drives the remote detail snapshot.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  // ISSUE-865 PR1 WP-4 — load the campaign's conversions & ROI rollup.
  const loadConversions = useCallback(
    async (campaignId) => {
      if (!campaignId) {
        setRoiPayload(null);
        return;
      }
      setRoiLoading(true);
      const { data, error } = await getCampaignConversions(campaignId);
      if (error) {
        addToast({
          variant: "error",
          title: "Conversions failed",
          description: error.message,
        });
        setRoiPayload(null);
      } else {
        setRoiPayload(data);
      }
      setRoiLoading(false);
    },
    [addToast],
  );

  useEffect(() => {
    // Route selection drives the remote conversion snapshot.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConversions(selectedId);
  }, [selectedId, loadConversions]);

  const selectedCampaign =
    (campaigns ?? []).find((campaign) => campaign.id === selectedId) ?? detail;
  const selectedProviderMoney = providerMoneyAuthority(selectedCampaign);
  const roi = toCampaignRoiView(roiPayload, {
    spendCurrency: selectedProviderMoney.providerCurrency,
  });

  useEffect(() => {
    if (!selectedId || detail?.dest_page_type !== "venue") {
      // Clear detail derived from the previous route selection.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStayRollup(null);
      setStayRollupError(null);
      return;
    }
    let active = true;
    setStayRollupLoading(true);
    setStayRollupError(null);
    void getStayCampaignRollup(selectedId).then(({ data, error }) => {
      if (!active) return;
      setStayRollup(error ? null : data);
      setStayRollupError(error?.message ?? null);
      setStayRollupLoading(false);
    });
    return () => {
      active = false;
    };
  }, [detail?.dest_page_type, selectedId]);

  const handleAction = async (campaign, action, extras = {}) => {
    setRowBusy((prev) => ({ ...prev, [campaign.id]: action }));
    const { data, error } = await campaignAction(campaign.id, action, extras);
    if (error) {
      const parsed = await parseEdgeError(error);
      const detail = String(
        typeof parsed?.body?.detail === "string"
          ? parsed.body.detail
          : (parsed?.body?.detail?.message ?? parsed?.message ?? ""),
      );
      addToast({
        variant: "error",
        title: `${action} failed`,
        description: detail,
      });
      setRowBusy((prev) => ({ ...prev, [campaign.id]: null }));
      return { ok: false, detail };
    }
    if (data?.warning) {
      // The 200 + warning contract: launched, but delivery is gated upstream.
      setRowWarning((prev) => ({ ...prev, [campaign.id]: data.warning }));
      addToast({
        variant: "warning",
        title: "Launched with warning",
        description: data.warning,
      });
    } else {
      setRowWarning((prev) => ({ ...prev, [campaign.id]: null }));
      if (action === "launch") {
        addToast({
          variant: "success",
          title: `Live on ${PLATFORM_LABELS[campaign.platform] ?? campaign.platform}. It'll be in review before it starts delivering.`,
        });
      } else {
        addToast({ variant: "success", title: "Paused. Spending stopped." });
      }
    }
    await load();
    if (selectedId === campaign.id) await loadDetail(campaign.id);
    setRowBusy((prev) => ({ ...prev, [campaign.id]: null }));
    return { ok: true, data };
  };

  const handleSync = async (campaignId) => {
    setRowBusy((prev) => ({ ...prev, [campaignId ?? "all"]: "sync" }));
    const { error } = await syncCampaigns(campaignId);
    if (error) {
      const parsed = await parseEdgeError(error);
      addToast({
        variant: "error",
        title: "Sync failed",
        description: String(parsed?.message ?? ""),
      });
    } else {
      addToast({ variant: "success", title: "Status synced" });
      await load();
      if (selectedId) await loadDetail(selectedId);
    }
    setRowBusy((prev) => ({ ...prev, [campaignId ?? "all"]: null }));
  };

  if (adsConsoleReady && !adsConsoleEnabled) {
    return (
      <div className="space-y-6">
        <PageHeader title="Campaigns" />
        <AlertCard variant="info" title="Ads console is off">
          Campaigns is gated by{" "}
          <code className="text-xs">enable_ads_console</code>. Turn it on in
          admin_config, or use{" "}
          <a className="underline" href="#/ad-engine">
            Ad Engine
          </a>{" "}
          for connections.
        </AlertCard>
      </div>
    );
  }

  const launchPlanCampaigns = launchTarget
    ? campaignsForPlan(campaigns ?? [], launchTarget)
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        description="Everything is created paused — launching is the explicit act that starts spend. Provider spend feeds enforce the frozen account-currency cap and end date; unresolved or stale spend pauses delivery for safety."
        actions={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              loading={rowBusy.all === "sync"}
              onClick={() => handleSync()}
            >
              Sync all
            </Button>
            <Button
              size="sm"
              icon={Rocket}
              onClick={() => {
                window.location.hash = "#/campaign-builder";
              }}
            >
              New campaign
            </Button>
          </div>
        }
      />
      <SectionCard
        title="Host plans awaiting staff review"
        subtitle="The first three campaigns for each Host, plus flagged plans, stop here before any provider object is created. Funds are held, not spent."
      >
        {loading && reviewQueue === null ? (
          <div className="flex items-center gap-2 py-4">
            <Spinner size="sm" /> Loading review queue…
          </div>
        ) : !reviewQueue || reviewQueue.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            No Host plans need review.
          </p>
        ) : (
          <div className="space-y-3">
            {reviewQueue.map((item) => {
              const plan = item.plan ?? {};
              const version = item.version ?? {};
              const canonical = version.canonical_plan ?? {};
              const providers = (item.provider_allocations ?? [])
                .map((row) => row.platform)
                .join(", ");
              return (
                <div
                  key={plan.id}
                  className="rounded-xl border border-[var(--gray-200)] p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">
                        {canonical.name || "Untitled Host campaign"}
                      </div>
                      <div className="text-xs text-[var(--color-text-secondary)]">
                        Brand {plan.brand_id} ·{" "}
                        {providers || "No provider allocation"} ·{" "}
                        {formatMinor(
                          version.host_currency,
                          version.host_budget_cents,
                        )}{" "}
                        held
                      </div>
                      <div className="mt-1 text-[10px] font-mono break-all text-[var(--color-text-tertiary)]">
                        Plan {version.plan_hash}
                      </div>
                    </div>
                    <Badge variant="warning">STAFF REVIEW</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {(plan.review_reasons ?? []).map((reason) => (
                      <Badge key={reason} variant="info">
                        {String(reason).replaceAll("_", " ")}
                      </Badge>
                    ))}
                    {(item.targeting_snapshots ?? []).map((row) => (
                      <Badge
                        key={row.platform}
                        variant={
                          row.verdict === "exact" ? "success" : "warning"
                        }
                      >
                        {row.platform}: {row.verdict}
                      </Badge>
                    ))}
                  </div>
                  {(item.targeting_snapshots ?? []).length > 0 && (
                    <div className="rounded-lg border border-[var(--gray-200)] p-3 text-xs space-y-2">
                      <p className="font-semibold">
                        Provider audience estimates
                      </p>
                      {(item.targeting_snapshots ?? []).map((row) => (
                        <div
                          key={`estimate-${row.platform}`}
                          className="rounded-md bg-[var(--gray-50)] px-2 py-1.5"
                        >
                          <p className="font-medium">
                            {PLATFORM_LABELS[row.platform] ?? row.platform} ·{" "}
                            {providerEstimateLabel(row.provider_estimate)}
                          </p>
                          <p className="text-[var(--color-text-secondary)]">
                            Observed{" "}
                            {row.estimate_observed_at
                              ? new Date(
                                  row.estimate_observed_at,
                                ).toLocaleString()
                              : "time unavailable"}{" "}
                            ·{" "}
                            {row.provider_estimate?.source ??
                              "source unavailable"}
                          </p>
                          {row.provider_estimate?.state !== "available" && (
                            <p className="text-[var(--color-text-secondary)]">
                              {String(
                                row.provider_estimate?.detail ??
                                  "provider estimate unavailable",
                              ).replaceAll("_", " ")}
                            </p>
                          )}
                        </div>
                      ))}
                      <p className="text-amber-700">
                        Do not add platform estimates. Audiences overlap across
                        providers, so a cross-platform total would be
                        misleading.
                      </p>
                    </div>
                  )}
                  {canonical.measurement && (
                    <div className="rounded-lg bg-[var(--gray-50)] p-3 text-xs space-y-1">
                      <p className="font-semibold">Measurement contract</p>
                      <p>
                        {(canonical.measurement.result_hierarchy ?? [])
                          .map((value) => String(value).replaceAll("_", " "))
                          .join(" → ")}{" "}
                        ·{" "}
                        {String(canonical.measurement.quality).replaceAll(
                          "_",
                          " ",
                        )}
                      </p>
                      <p className="text-[var(--color-text-secondary)]">
                        Browser pixels and platform sharing are consent-gated;
                        trusted Mingla results remain aggregate-only when
                        sharing is withheld.
                      </p>
                    </div>
                  )}
                  {canonical.media_rights && (
                    <div className="rounded-lg bg-[var(--gray-50)] p-3 text-xs space-y-1">
                      <p className="font-semibold">Media rights</p>
                      <p>
                        {String(canonical.media_rights.rights_basis).replaceAll(
                          "_",
                          " ",
                        )}{" "}
                        ·{" "}
                        {canonical.media_rights.ai_generated
                          ? "AI-generated"
                          : "not marked AI-generated"}
                      </p>
                      <p className="text-[var(--color-text-secondary)]">
                        Paid-ad use attested; Mingla house reuse not authorized.
                      </p>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      icon={CheckCircle2}
                      onClick={() =>
                        setReviewTarget({ item, decision: "approved" })
                      }
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={MessageSquareWarning}
                      onClick={() =>
                        setReviewTarget({ item, decision: "changes_requested" })
                      }
                    >
                      Request changes
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      icon={XCircle}
                      onClick={() =>
                        setReviewTarget({ item, decision: "rejected" })
                      }
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
      <SectionCard>
        {loading ? (
          <div className="flex items-center gap-2 py-4">
            <Spinner size="sm" /> Loading campaigns…
          </div>
        ) : !campaigns || campaigns.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            No campaigns yet — build one in the Campaign Builder. It will start
            paused.
          </p>
        ) : (
          <div className="space-y-2">
            {campaigns.map((campaign) => (
              <div
                key={campaign.id}
                className={[
                  "border rounded-lg p-3 flex flex-wrap items-center gap-3",
                  selectedId === campaign.id
                    ? "border-[var(--color-brand-500)] ring-1 ring-[var(--color-brand-500)]"
                    : "border-[var(--gray-200)]",
                ].join(" ")}
              >
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="font-medium text-sm truncate hover:underline text-left"
                    onClick={() => {
                      window.location.hash = `#/campaigns?campaignId=${campaign.id}`;
                    }}
                  >
                    {campaign.name}
                  </button>
                  <div className="text-xs text-[var(--color-text-secondary)]">
                    {PLATFORM_LABELS[campaign.platform] ?? campaign.platform} ·{" "}
                    {campaign.objective} ·{" "}
                    {formatCampaignMoney(
                      campaign.currency,
                      campaign.daily_budget_cents,
                    )}
                    /day
                    {campaign.cap_cents != null && (
                      <>
                        {" "}
                        · cap{" "}
                        {formatCampaignMoney(
                          campaign.currency,
                          campaign.cap_cents,
                        )}
                      </>
                    )}
                    {" · "}
                    <a
                      className="underline inline-flex items-center gap-1"
                      href={campaign.dest_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      destination <ExternalLink size={10} />
                    </a>
                  </div>
                  {scheduleWindowLabel({
                    startsAt: campaign.starts_at,
                    endsAt: campaign.ends_at,
                  }) && (
                    <div className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">
                      {scheduleWindowLabel({
                        startsAt: campaign.starts_at,
                        endsAt: campaign.ends_at,
                      })}
                    </div>
                  )}
                  {rowWarning[campaign.id] && (
                    <div className="text-xs text-[var(--color-warning-700)] mt-1">
                      {rowWarning[campaign.id]}
                    </div>
                  )}
                </div>
                {/* DUAL badges: advertiser status + delivery status. */}
                <Badge
                  variant={campaign.status === "ACTIVE" ? "success" : "default"}
                >
                  {campaign.status}
                </Badge>
                <Badge
                  variant={
                    DELIVERY_BADGE_VARIANTS[campaign.delivery_status] ?? "info"
                  }
                >
                  {campaign.delivery_status ?? "unknown"}
                </Badge>
                {canLaunchWithProviderMoney(campaign, campaigns) && (
                  <Button
                    size="sm"
                    icon={Rocket}
                    loading={rowBusy[campaign.id] === "launch"}
                    onClick={() => setLaunchTarget(campaign)}
                  >
                    Launch plan
                  </Button>
                )}
                {canLaunchCampaign(campaign.status) &&
                  !canLaunchWithProviderMoney(campaign, campaigns) && (
                    <Badge variant="error">Provider money unresolved</Badge>
                  )}
                {canPauseCampaign(campaign.status) && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={Pause}
                    loading={rowBusy[campaign.id] === "pause"}
                    onClick={() => handleAction(campaign, "pause")}
                  >
                    Pause
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={RefreshCw}
                  loading={rowBusy[campaign.id] === "sync"}
                  onClick={() => handleSync(campaign.id)}
                >
                  Sync
                </Button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── Detail (?campaignId=) — review_detail with the §1.9b cause→fix map ── */}
      {selectedId && (
        <SectionCard
          title="Campaign detail"
          subtitle="Review verdicts with cause and fix — the verbatim platform text is always shown."
        >
          {detailLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Spinner size="sm" /> Loading detail…
            </div>
          ) : !detail ? (
            <p className="text-sm text-[var(--color-text-secondary)]">
              Campaign not found.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-semibold text-sm">{detail.name}</span>
                <Badge
                  variant={detail.status === "ACTIVE" ? "success" : "default"}
                >
                  {detail.status}
                </Badge>
                <Badge
                  variant={
                    DELIVERY_BADGE_VARIANTS[detail.delivery_status] ?? "info"
                  }
                >
                  {detail.delivery_status ?? "unknown"}
                </Badge>
                <span className="text-xs text-[var(--color-text-secondary)]">
                  synced{" "}
                  {detail.status_synced_at
                    ? new Date(detail.status_synced_at).toLocaleString()
                    : "never"}
                </span>
              </div>

              {(detail.ad_sets ?? []).map((adSet) => (
                <div
                  key={adSet.id}
                  className="border border-[var(--gray-200)] rounded-xl p-3 space-y-2"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium">{adSet.name}</span>
                    <Badge
                      variant={
                        adSet.status === "ACTIVE" ? "success" : "default"
                      }
                    >
                      {adSet.status}
                    </Badge>
                    {adSet.external_status && (
                      <Badge
                        variant={
                          DELIVERY_BADGE_VARIANTS[adSet.external_status] ??
                          "info"
                        }
                      >
                        {adSet.external_status}
                      </Badge>
                    )}
                    {adSet.optimization_goal && (
                      <span className="text-[var(--color-text-tertiary)]">
                        {adSet.optimization_goal}
                      </span>
                    )}
                  </div>
                  {(adSet.ads ?? []).map((ad) => {
                    const cards = mapReviewDetail({
                      platform: detail.platform,
                      ad,
                      deliveryStatus:
                        ad.review_status ?? detail.delivery_status,
                    });
                    return (
                      <div
                        key={ad.id}
                        className="pl-3 border-l-2 border-[var(--gray-100)] space-y-2"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span>{ad.name}</span>
                          <Badge
                            variant={
                              ad.status === "ACTIVE" ? "success" : "default"
                            }
                          >
                            {ad.status}
                          </Badge>
                          {ad.review_status && (
                            <Badge
                              variant={
                                DELIVERY_BADGE_VARIANTS[ad.review_status] ??
                                "info"
                              }
                            >
                              review: {ad.review_status}
                            </Badge>
                          )}
                        </div>
                        {cards.map((card, i) => (
                          <AlertCard
                            key={i}
                            variant={card.severity}
                            title={card.title}
                          >
                            {card.body}
                            {card.action && (
                              <div className="mt-1 text-xs font-medium">
                                [{card.action}]
                              </div>
                            )}
                          </AlertCard>
                        ))}
                        {ad.review_detail && (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-[var(--color-text-tertiary)]">
                              Raw review detail (verbatim)
                            </summary>
                            <pre className="mt-1 p-2 rounded-lg bg-[var(--gray-50)] overflow-x-auto text-[10px]">
                              {JSON.stringify(ad.review_detail, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      )}

      {selectedId && detail?.dest_page_type === "venue" && (
        <SectionCard
          title="Stay booking funnel"
          subtitle="Only bookings attributed to this Stay campaign are included. Money stays in its original brand currency."
        >
          {stayRollupLoading ? (
            <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
              <Spinner size="sm" /> Loading Stay bookings…
            </div>
          ) : stayRollupError ? (
            <AlertCard variant="error" title="Stay bookings could not load">
              {stayRollupError}
            </AlertCard>
          ) : !stayRollup ? (
            <p className="text-sm text-[var(--color-text-secondary)]">
              Stay booking data is unavailable.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  ["Visits", stayRollup.visits],
                  ["Reservation requests", stayRollup.reservationRequests],
                  ["Approved requests", stayRollup.approvedRequests],
                  ["Confirmed bookings", stayRollup.confirmedBookings],
                  ["Cancellations", stayRollup.cancellations],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="border border-[var(--gray-200)] rounded-lg p-3"
                  >
                    <div className="text-[var(--color-text-tertiary)] text-xs uppercase">
                      {label}
                    </div>
                    <div className="text-xl font-semibold">
                      {Number(value) || 0}
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  ["Gross bookings", stayRollup.grossByCurrency],
                  ["Refunds", stayRollup.refundsByCurrency],
                  ["Net bookings", stayRollup.netByCurrency],
                ].map(([label, values]) => (
                  <div
                    key={label}
                    className="border border-[var(--gray-200)] rounded-lg p-3"
                  >
                    <div className="text-[var(--color-text-tertiary)] text-xs uppercase mb-1">
                      {label}
                    </div>
                    <div className="text-lg font-semibold">
                      <CurrencyRows values={values} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {/* toward #3697 Wave 3 — spend vs hard cap (real spend from rollup; never fabricate). */}
      {selectedId &&
        (() => {
          const { providerCurrency: currency, providerCapCents: capCents } =
            providerMoneyAuthority(selectedCampaign);
          // While ROI reloads, ignore the previous campaign's spend (stale %).
          const spendCents = roiLoading ? null : (roi?.spendCents ?? null);
          const progress = spendCapProgress({ spendCents, capCents });
          return (
            <SectionCard
              title="Spend vs hard cap"
              subtitle={
                "Provider spend sync writes account-currency totals for every enabled platform. The server pauses delivery at 98% of the frozen provider cap."
              }
            >
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="border border-[var(--gray-200)] rounded-lg p-3">
                  <div className="text-[var(--color-text-tertiary)] text-xs uppercase">
                    Spend
                  </div>
                  <div className="text-xl font-semibold">
                    {spendCents == null
                      ? "—"
                      : formatCampaignMoney(currency, spendCents)}
                  </div>
                </div>
                <div className="border border-[var(--gray-200)] rounded-lg p-3">
                  <div className="text-[var(--color-text-tertiary)] text-xs uppercase">
                    Hard cap
                  </div>
                  <div className="text-xl font-semibold">
                    {capCents == null
                      ? "—"
                      : formatCampaignMoney(currency, capCents)}
                  </div>
                </div>
                <div className="border border-[var(--gray-200)] rounded-lg p-3">
                  <div className="text-[var(--color-text-tertiary)] text-xs uppercase">
                    Used
                  </div>
                  <div className="text-xl font-semibold">
                    {progress.pctLabel}
                  </div>
                </div>
                <div className="border border-[var(--gray-200)] rounded-lg p-3">
                  <div className="text-[var(--color-text-tertiary)] text-xs uppercase">
                    Schedule
                  </div>
                  <div className="text-sm font-medium">
                    {scheduleWindowLabel({
                      startsAt: selectedCampaign?.starts_at,
                      endsAt: selectedCampaign?.ends_at,
                    }) ?? "—"}
                  </div>
                </div>
              </div>
              {typeof progress.barRatio === "number" && (
                <div className="mt-3 h-2 rounded-full bg-[var(--gray-100)] overflow-hidden">
                  <div
                    className={[
                      "h-full rounded-full transition-all",
                      progress.atPauseThreshold
                        ? "bg-[var(--color-warning-600)]"
                        : "bg-[var(--color-brand-500)]",
                    ].join(" ")}
                    style={{ width: `${Math.round(progress.barRatio * 100)}%` }}
                  />
                </div>
              )}
              {progress.atPauseThreshold && (
                <p className="mt-2 text-xs text-[var(--color-warning-700)]">
                  At or past 98% of the provider hard cap — launch and spend
                  sync will keep every provider object paused.
                </p>
              )}
            </SectionCard>
          );
        })()}

      {/* ISSUE-865 PR1 WP-4 — Conversions & ROI (below Ad sets & ads). Reads the
          per-campaign ad_campaign_conversion_rollup RPC. Spend/ROAS are shown ONLY
          when a real spend figure exists (spend_cents) — never fabricated. */}
      {selectedId && (
        <SectionCard
          title="Conversions & ROI"
          subtitle="Attributed conversions this campaign drove. ROAS appears only when real provider spend and attributed value share one currency — never estimated or mixed."
        >
          {roiLoading ? (
            <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
              <Spinner size="sm" /> Loading conversions…
            </div>
          ) : !roi || !roi.hasData ? (
            <div className="text-[var(--color-text-secondary)] text-sm">
              No attributed conversions yet. When someone clicks this
              campaign&apos;s ad and purchases or RSVPs on Mingla, the
              conversion is measured and shows up here.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="border border-[var(--gray-200)] rounded-lg p-3">
                  <div className="text-[var(--color-text-tertiary)] text-xs uppercase">
                    Conversions
                  </div>
                  <div className="text-xl font-semibold">{roi.conversions}</div>
                </div>
                <div className="border border-[var(--gray-200)] rounded-lg p-3">
                  <div className="text-[var(--color-text-tertiary)] text-xs uppercase">
                    Attributed value
                  </div>
                  <div className="text-xl font-semibold">
                    <CurrencyRows values={roi.valueByCurrency} />
                  </div>
                </div>
                <div className="border border-[var(--gray-200)] rounded-lg p-3">
                  <div className="text-[var(--color-text-tertiary)] text-xs uppercase">
                    Spend
                  </div>
                  <div className="text-xl font-semibold">
                    {roi.spendCents === null
                      ? "—"
                      : formatCampaignMoney(roi.spendCurrency, roi.spendCents)}
                  </div>
                </div>
                <div className="border border-[var(--gray-200)] rounded-lg p-3">
                  <div className="text-[var(--color-text-tertiary)] text-xs uppercase">
                    ROAS
                  </div>
                  <div className="text-xl font-semibold">
                    {roi.roas === null ? "—" : `${roi.roas.toFixed(2)}×`}
                  </div>
                </div>
              </div>

              {roi.spendCents === null && (
                <div className="text-[var(--color-text-tertiary)] text-xs">
                  Spend appears after the hourly feed writes the first
                  ad_spend_daily row.
                </div>
              )}

              {roi.spendCents !== null && roi.roas === null && (
                <div className="text-[var(--color-text-tertiary)] text-xs">
                  ROAS is unavailable because provider spend and attributed
                  value do not share one verified currency. No cross-currency
                  minor units are combined.
                </div>
              )}

              <div className="border border-[var(--gray-200)] rounded-xl overflow-hidden">
                <div className="grid grid-cols-4 gap-2 px-3 py-2 bg-[var(--gray-50)] text-[var(--color-text-tertiary)] text-xs uppercase">
                  <div>Platform</div>
                  <div className="text-right">Conversions</div>
                  <div className="text-right">Value</div>
                  <div className="text-right">Sent / Failed</div>
                </div>
                {roi.byPlatform.map((p) => (
                  <div
                    key={p.platform}
                    className="grid grid-cols-4 gap-2 px-3 py-2 border-t border-[var(--gray-200)] text-sm"
                  >
                    <div>{PLATFORM_LABELS[p.platform] ?? p.platform}</div>
                    <div className="text-right">{p.conversions}</div>
                    <div className="text-right">—</div>
                    <div className="text-right text-[var(--color-text-secondary)]">
                      {p.sent} / {p.failed}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {/* Launch confirm — Wave 5 / #3704: type LAUNCH + reason (server-enforced). */}
      <HighRiskActionModal
        open={launchTarget !== null}
        onClose={() => setLaunchTarget(null)}
        title="Launch this campaign?"
        description={
          launchTarget
            ? launchConfirmCopy({
                channelCount: launchPlanCampaigns.length,
                providerDeliveryBudgets: launchPlanCampaigns.map((campaign) => {
                  const authority = providerMoneyAuthority(campaign);
                  return {
                    currency: authority.providerCurrency,
                    amountCents: authority.providerDeliveryCents,
                    cadence: authority.cadence,
                  };
                }),
                providerHardCaps: launchPlanCampaigns.map((campaign) => {
                  const authority = providerMoneyAuthority(campaign);
                  return {
                    currency: authority.providerCurrency,
                    amountCents: authority.providerCapCents,
                  };
                }),
                hasMeta: launchPlanCampaigns.some(
                  (campaign) => campaign.platform === "meta",
                ),
              })
            : undefined
        }
        confirmLabel="Launch"
        confirmPhrase={LAUNCH_CONFIRM_PHRASE}
        requireReason
        reasonLabel="Why are you launching? (audit log)"
        successMessage={null}
        onConfirm={async ({ reason }) => {
          const target = launchTarget;
          if (!target) throw new Error("No campaign selected");
          const result = await handleAction(target, "launch", {
            confirm_phrase: LAUNCH_CONFIRM_PHRASE,
            reason,
          });
          if (!result.ok) {
            throw new Error(result.detail || "Launch failed");
          }
        }}
      />
      <HighRiskActionModal
        open={reviewTarget !== null}
        onClose={() => setReviewTarget(null)}
        title={
          reviewTarget?.decision === "approved"
            ? "Approve this exact Host plan?"
            : reviewTarget?.decision === "changes_requested"
              ? "Request changes to this plan?"
              : "Reject this Host plan?"
        }
        description={
          reviewTarget?.decision === "approved"
            ? "Approval lets the Host resume this immutable plan and create provider objects. It does not launch anything from Admin."
            : "The pre-create hold will be released back to Ads credit. The Host can revise from the preserved plan history; no provider object exists."
        }
        confirmLabel={
          reviewTarget?.decision === "approved"
            ? "Approve plan"
            : reviewTarget?.decision === "changes_requested"
              ? "Request changes"
              : "Reject plan"
        }
        confirmPhrase={
          reviewTarget?.decision === "approved"
            ? "APPROVE"
            : reviewTarget?.decision === "changes_requested"
              ? "CHANGES"
              : "REJECT"
        }
        requireReason
        reasonLabel="Staff review reason (audit log)"
        successMessage={null}
        onConfirm={async ({ reason }) => {
          if (!reviewTarget) throw new Error("No plan selected");
          await handleReview({ ...reviewTarget, reason });
          setReviewTarget(null);
        }}
      />
    </div>
  );
}
