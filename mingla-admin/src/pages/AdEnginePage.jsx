/**
 * Admin Ads control center.
 *
 * Provider connections, app readiness, and preflight live here. All campaign
 * creation goes through the immutable-plan Campaign Builder; all lifecycle,
 * spend, and reporting actions live on Campaigns. This page intentionally has
 * no quick-create or direct-launch bypass.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Megaphone, RefreshCw, Rocket } from "lucide-react";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../context/ToastContext";
import { loadFeatureFlags } from "../lib/featureFlags";
import { AdConnectionsPanel } from "../components/AdConnectionsPanel";
import { AppDownloadReadinessPanel } from "../components/app-readiness/AppDownloadReadinessPanel";
import {
  listAdCreatives,
  loadAdsOperationsOverview,
  parseEdgeError,
  runPreflight,
} from "../services/adEngineService";
import { PageHeader } from "../components/ui/PageHeader";
import { Tabs } from "../components/ui/Tabs";
import { CampaignsPage } from "./CampaignsPage";

const PREFLIGHT_BADGE = {
  green: "success",
  amber: "warning",
  red: "error",
  not_connected: "default",
};

const ADS_TABS = [
  { id: "overview", label: "Overview" },
  { id: "campaigns", label: "Campaigns" },
  { id: "creative-library", label: "Creative Library" },
  { id: "connections", label: "Connections" },
];

const PROCESSING_LABEL = {
  not_started: "Not prepared",
  partial: "Partly prepared",
  preparing: "Preparing",
  ready: "Provider ready",
  needs_attention: "Needs attention",
};

const PROCESSING_VARIANT = {
  ready: "success",
  preparing: "warning",
  partial: "warning",
  needs_attention: "error",
  not_started: "default",
};

const AD_PLATFORMS = ["meta", "tiktok", "snapchat", "google", "reddit"];

function sentenceCase(value) {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function tabFromHash() {
  const query = window.location.hash.split("?")[1] ?? "";
  const requested = new URLSearchParams(query).get("tab") ?? "overview";
  return ADS_TABS.some((tab) => tab.id === requested) ? requested : "overview";
}

function formatMinor(currency, minor) {
  if (!/^[A-Z]{3}$/.test(currency ?? "") || !Number.isFinite(Number(minor))) {
    return "—";
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(Number(minor) / 100);
  } catch {
    return `${currency} ${(Number(minor) / 100).toFixed(2)}`;
  }
}

function evidenceVariant(state) {
  if (state === "current" || state === "verified") return "success";
  if (state === "not_required") return "default";
  if (state === "missing" || state === "needs_attention") return "error";
  return "warning";
}

function observedAtLabel(value) {
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toLocaleString()
    : "not observed";
}

function AdsOperationsOverview({ onOpenCampaigns, onOpenConnections }) {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await loadAdsOperationsOverview();
    setSnapshot(loadError ? null : data);
    setError(loadError?.message ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Initial server snapshot; state transitions live inside the async loader.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (loading && !snapshot) {
    return (
      <SectionCard title="Operations snapshot">
        <div className="flex items-center gap-2 py-4">
          <Spinner size="sm" /> Loading governed Ads evidence…
        </div>
      </SectionCard>
    );
  }

  if (error) {
    return (
      <AlertCard variant="error" title="Ads operations snapshot unavailable">
        <p>{error}</p>
        <Button className="mt-3" size="sm" variant="secondary" onClick={load}>
          Retry
        </Button>
      </AlertCard>
    );
  }

  const campaigns = snapshot?.campaigns ?? {};
  const queues = snapshot?.queues ?? {};
  const delivery = snapshot?.delivery_evidence ?? {};
  const connections = snapshot?.connections ?? [];
  const connectionByPlatform = new Map(
    connections.map((connection) => [connection.platform, connection]),
  );
  const alertCount =
    Number(campaigns.needs_attention ?? 0) +
    Number(queues.staff_review ?? 0) +
    Number(queues.mingla_recovery ?? 0) +
    Number(queues.settlement_attention ?? 0);

  return (
    <>
      <SectionCard
        title="Operations snapshot"
        subtitle="Live evidence from campaigns, queues, provider connections, spend and attributed results."
        action={
          <Button
            size="sm"
            variant="secondary"
            icon={RefreshCw}
            loading={loading}
            onClick={load}
          >
            Refresh
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ["All campaigns", campaigns.total ?? 0],
            ["Live", campaigns.live ?? 0],
            ["Paused", campaigns.paused ?? 0],
            ["Ended", campaigns.ended ?? 0],
            ["Needs attention", campaigns.needs_attention ?? 0],
          ].map(([label, value]) => (
            <button
              type="button"
              key={label}
              className="rounded-xl border border-[var(--gray-200)] p-3 text-left hover:border-[var(--color-brand-500)]"
              onClick={onOpenCampaigns}
            >
              <div className="text-xs uppercase text-[var(--color-text-tertiary)]">
                {label}
              </div>
              <div className="mt-1 text-2xl font-semibold">{value}</div>
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Action queue"
        subtitle="Every count links to the governed campaign workspace; no provider action runs from this summary."
      >
        {alertCount === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            No campaign, review, recovery or settlement action is currently
            recorded.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            {[
              ["Campaign attention", campaigns.needs_attention ?? 0],
              ["Staff review", queues.staff_review ?? 0],
              ["Create recovery", queues.mingla_recovery ?? 0],
              ["Settlement attention", queues.settlement_attention ?? 0],
            ].map(([label, value]) => (
              <button
                type="button"
                key={label}
                className="flex items-center justify-between rounded-xl border border-[var(--gray-200)] p-3 text-left hover:border-[var(--color-brand-500)]"
                onClick={onOpenCampaigns}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <AlertTriangle size={15} /> {label}
                </span>
                <Badge variant={Number(value) > 0 ? "warning" : "default"}>
                  {value}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <SectionCard
          title="Spend by provider currency"
          subtitle="Currencies are separated and never cross-summed. A missing feed stays visibly empty."
        >
          {(snapshot?.spend_by_currency ?? []).length === 0 ? (
            <p className="text-sm text-[var(--color-text-secondary)]">
              No provider spend has been observed yet.
            </p>
          ) : (
            <div className="space-y-2">
              {snapshot.spend_by_currency.map((row) => (
                <div
                  key={row.currency}
                  className="flex items-center justify-between rounded-lg border border-[var(--gray-200)] p-3"
                >
                  <div>
                    <div className="font-semibold">
                      {formatMinor(row.currency, row.spend_cents)}
                    </div>
                    <div className="text-xs text-[var(--color-text-secondary)]">
                      {Number(row.impressions ?? 0).toLocaleString()}{" "}
                      impressions · {Number(row.clicks ?? 0).toLocaleString()}{" "}
                      clicks
                    </div>
                  </div>
                  <Badge>{row.currency}</Badge>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Attributed results"
          subtitle="Recorded Mingla outcomes only; result value remains separated by source currency."
        >
          <div className="text-2xl font-semibold">
            {Number(snapshot?.results?.total ?? 0).toLocaleString()}
          </div>
          <div className="mb-3 text-xs uppercase text-[var(--color-text-tertiary)]">
            total attributed results
          </div>
          <div className="flex flex-wrap gap-2">
            {(snapshot?.results?.by_type ?? []).map((row) => (
              <Badge key={row.event_type} variant="info">
                {sentenceCase(row.event_type)} · {row.count}
              </Badge>
            ))}
          </div>
          {(snapshot?.results?.value_by_currency ?? []).length > 0 && (
            <div className="mt-3 space-y-1 text-sm">
              {snapshot.results.value_by_currency.map((row) => (
                <div key={row.currency} className="flex justify-between gap-3">
                  <span>{row.currency} attributed value</span>
                  <strong>{formatMinor(row.currency, row.value_cents)}</strong>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Provider and automation evidence"
        subtitle="Verification and delivery freshness come from recorded provider observations. This does not claim the external scheduler configuration was inspected."
        action={
          <Button size="sm" variant="secondary" onClick={onOpenConnections}>
            Manage connections
          </Button>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--gray-50)] p-3 text-sm">
          <span className="font-medium">Delivery evidence</span>
          <Badge variant={evidenceVariant(delivery.evidence_state)}>
            {sentenceCase(delivery.evidence_state)}
          </Badge>
          <span className="text-[var(--color-text-secondary)]">
            {Number(delivery.active_campaigns ?? 0)} active ·{" "}
            {Number(delivery.missing_spend_campaigns ?? 0)} missing spend feed ·{" "}
            {Number(delivery.stale_campaigns ?? 0)} stale
          </span>
          <span className="basis-full text-xs text-[var(--color-text-tertiary)]">
            Status observed {observedAtLabel(delivery.latest_status_synced_at)}{" "}
            · Spend observed {observedAtLabel(delivery.latest_spend_synced_at)}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
          {AD_PLATFORMS.map((platform) => {
            const connection = connectionByPlatform.get(platform);
            const state = connection?.verification_state ?? "not_connected";
            return (
              <button
                type="button"
                key={platform}
                className="rounded-lg border border-[var(--gray-200)] p-3 text-left hover:border-[var(--color-brand-500)]"
                onClick={onOpenConnections}
              >
                <div className="font-medium">{sentenceCase(platform)}</div>
                <Badge className="mt-2" variant={evidenceVariant(state)}>
                  {sentenceCase(state)}
                </Badge>
                <div className="mt-2 text-xs text-[var(--color-text-secondary)]">
                  {connection?.currency ?? "Currency unavailable"}
                </div>
                <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
                  Verified {observedAtLabel(connection?.token_last_verified_at)}
                </div>
              </button>
            );
          })}
        </div>
      </SectionCard>
    </>
  );
}

function CreativeLibraryPanel() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    listAdCreatives().then(({ data, error: loadError }) => {
      if (!mounted) return;
      setRows(data?.creatives ?? []);
      setError(loadError?.message ?? null);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <SectionCard
      title="Creative Library"
      subtitle="Canonical ad media, processing truth, placement fit and reusable provider handoff start here. Infrastructure IDs stay hidden from operators."
      action={
        <Button
          size="sm"
          icon={Rocket}
          onClick={() => {
            window.location.hash = "#/campaign-builder?step=creative";
          }}
        >
          Build a campaign
        </Button>
      }
    >
      {error ? (
        <AlertCard variant="error" title="Creative Library unavailable">
          {error}
        </AlertCard>
      ) : rows === null ? (
        <div className="flex items-center gap-2 py-4">
          <Spinner size="sm" /> Loading creatives…
        </div>
      ) : rows.length === 0 ? (
        <div className="space-y-2 text-sm text-[var(--color-text-secondary)]">
          <p>No canonical ad creatives have been recorded yet.</p>
          <p>
            Images can be added in Campaign Builder. Video must first complete
            Mingla&apos;s shared resumable media flow; the builder will then list
            the ready canonical video without exposing storage or provider IDs.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((creative) => {
            const preview = creative.preview_url;
            const processingLabel =
              PROCESSING_LABEL[creative.processing_summary] ??
              sentenceCase(creative.processing_summary);
            const rightsLabel =
              creative.rights?.state === "confirmed"
                ? `Rights confirmed · ${sentenceCase(creative.rights.basis)}`
                : creative.rights?.state === "missing"
                  ? "Rights missing on latest plan"
                  : "Rights attested when used";
            return (
              <article
                key={creative.id}
                className="overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)]"
              >
                <div className="flex aspect-video items-center justify-center bg-[var(--gray-100)]">
                  {preview ? (
                    <img
                      src={preview}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Megaphone
                      aria-hidden="true"
                      className="h-8 w-8 text-[var(--color-text-tertiary)]"
                    />
                  )}
                </div>
                <div className="space-y-3 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {creative.name || "Untitled creative"}
                      </p>
                      <p className="text-xs text-[var(--color-text-secondary)]">
                        {sentenceCase(creative.kind)} ·{" "}
                        {creative.source_summary}
                        {creative.duration_seconds
                          ? ` · ${creative.duration_seconds}s`
                          : ""}
                      </p>
                      {creative.kind === "video" && (
                        <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
                          {creative.house_reuse_allowed
                            ? "Eligible for Mingla house campaigns"
                            : "Host-only media · house reuse not approved"}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant={PROCESSING_VARIANT[creative.processing_summary]}
                    >
                      {processingLabel}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(creative.placement_formats ?? []).length > 0 ? (
                      creative.placement_formats.map((format) => (
                        <Badge key={format} variant="default">
                          {format}
                        </Badge>
                      ))
                    ) : (
                      <Badge variant="warning">Placement fit pending</Badge>
                    )}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <div>
                      <dt className="text-[var(--color-text-tertiary)]">
                        Plan version
                      </dt>
                      <dd className="font-medium">{creative.version_label}</dd>
                    </div>
                    <div>
                      <dt className="text-[var(--color-text-tertiary)]">
                        Campaign use
                      </dt>
                      <dd className="font-medium">
                        {creative.usage?.campaign_count ?? 0} total ·{" "}
                        {creative.usage?.active_campaign_count ?? 0} active
                      </dd>
                    </div>
                  </dl>
                  <p
                    className={`text-xs ${
                      creative.rights?.state === "missing"
                        ? "text-[var(--color-warning-700)]"
                        : "text-[var(--color-text-secondary)]"
                    }`}
                  >
                    {rightsLabel}
                    {creative.ai_generated ? " · AI-generated" : ""}
                  </p>
                  {(creative.provider_readiness ?? []).length > 0 && (
                    <div>
                      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">
                        Provider copies
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {creative.provider_readiness.map((row) => (
                          <Badge
                            key={`${row.platform}:${row.lane}`}
                            variant={
                              row.status === "ready"
                                ? "success"
                                : ["failed", "timed_out"].includes(row.status)
                                  ? "error"
                                  : "warning"
                            }
                          >
                            {sentenceCase(row.platform)} ·{" "}
                            {sentenceCase(row.status)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 border-t border-[var(--gray-100)] pt-2">
                    <p className="text-[11px] text-[var(--color-text-tertiary)]">
                      {creative.usage?.last_used_at
                        ? `Last used ${new Date(creative.usage.last_used_at).toLocaleDateString()}`
                        : `Added ${new Date(creative.created_at).toLocaleDateString()}`}
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        window.location.hash = `#/campaign-builder?step=creative&creative=${encodeURIComponent(creative.id)}`;
                      }}
                    >
                      Reuse
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

export function AdEnginePage() {
  const { addToast } = useToast();
  const [preflightRows, setPreflightRows] = useState(null);
  const [preflightRunning, setPreflightRunning] = useState(false);
  const [appDownloadReadinessEnabled, setAppDownloadReadinessEnabled] =
    useState(false);
  const [activeTab, setActiveTab] = useState(tabFromHash);

  useEffect(() => {
    const applyHash = () => setActiveTab(tabFromHash());
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  const changeTab = (tab) => {
    setActiveTab(tab);
    window.location.hash =
      tab === "overview" ? "#/ad-engine" : `#/ad-engine?tab=${tab}`;
  };

  useEffect(() => {
    let mounted = true;
    loadFeatureFlags().then((flags) => {
      if (mounted) {
        setAppDownloadReadinessEnabled(
          flags.enable_app_download_readiness === true,
        );
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handlePreflight = async () => {
    setPreflightRunning(true);
    const { data, error } = await runPreflight();
    if (error) {
      const parsed = await parseEdgeError(error);
      addToast({
        variant: "error",
        title: "Preflight failed",
        description: String(parsed?.message ?? ""),
      });
    } else {
      setPreflightRows(data?.rows ?? []);
    }
    setPreflightRunning(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        titleId="ads-console-heading"
        title="Ads"
        description="One governed workspace for campaigns, creative, provider connections, spend, results and settlement."
        actions={
          <Button
            size="sm"
            icon={Rocket}
            onClick={() => {
              window.location.hash = "#/campaign-builder";
            }}
          >
            New campaign
          </Button>
        }
        tabs={
          <Tabs tabs={ADS_TABS} activeTab={activeTab} onChange={changeTab} />
        }
      />

      {activeTab === "campaigns" && <CampaignsPage embedded />}
      {activeTab === "creative-library" && <CreativeLibraryPanel />}

      {activeTab === "connections" && (
        <>
          <AdConnectionsPanel />

          {appDownloadReadinessEnabled ? (
            <AppDownloadReadinessPanel />
          ) : (
            <section
              aria-label="App-download readiness"
              className="rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-4 text-sm text-[var(--color-text-secondary)]"
            >
              App-download readiness is being connected. No campaigns can be
              created here.
            </section>
          )}
        </>
      )}

      {activeTab === "overview" && (
        <>
          <section
            aria-labelledby="governed-campaign-operations-heading"
            className="space-y-1"
          >
            <h2
              id="governed-campaign-operations-heading"
              className="text-lg font-semibold"
            >
              Governed campaign operations
            </h2>
            <p className="text-sm text-[var(--color-text-secondary)]">
              The five-stage builder creates one immutable plan. Campaign
              lifecycle, spend, results and settlement stay in this Ads area.
            </p>
          </section>

          <AdsOperationsOverview
            onOpenCampaigns={() => changeTab("campaigns")}
            onOpenConnections={() => changeTab("connections")}
          />

          <SectionCard
            title="Channel preflight"
            subtitle="Verify current account, billing, identity, market, pixel, and provider readiness before opening the builder."
            action={
              <Button
                variant="secondary"
                size="sm"
                icon={Megaphone}
                loading={preflightRunning}
                onClick={handlePreflight}
              >
                Run preflight
              </Button>
            }
          >
            {!preflightRows && !preflightRunning && (
              <p className="text-sm text-[var(--color-text-secondary)]">
                Not run yet.
              </p>
            )}
            {preflightRunning && (
              <div className="flex items-center gap-2 py-2">
                <Spinner size="sm" /> Probing channels…
              </div>
            )}
            {preflightRows && !preflightRunning && (
              <div className="space-y-3">
                {preflightRows.map((row) => (
                  <div
                    key={row.platform}
                    className="border border-[var(--gray-200)] rounded-lg p-3"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Badge
                        variant={PREFLIGHT_BADGE[row.overall] ?? "default"}
                        dot
                      >
                        {row.platform}
                      </Badge>
                      <span className="text-xs text-[var(--color-text-secondary)]">
                        {row.overall}
                      </span>
                    </div>
                    <ul className="space-y-1">
                      {row.checks.map((check) => (
                        <li key={check.id} className="text-xs flex gap-2">
                          <Badge
                            variant={
                              check.status === "pass"
                                ? "success"
                                : check.status === "warn"
                                  ? "warning"
                                  : check.status === "n/a"
                                    ? "default"
                                    : "error"
                            }
                          >
                            {check.id}
                          </Badge>
                          <span>
                            {check.label}
                            {check.detail ? ` — ${check.detail}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Campaign work"
            subtitle="One engine, one immutable plan, and no direct provider-write shortcut."
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                type="button"
                className="rounded-xl border border-[var(--gray-200)] p-4 text-left hover:border-[var(--color-brand-500)]"
                onClick={() => {
                  window.location.hash = "#/campaign-builder";
                }}
              >
                <div className="font-semibold">Build a campaign</div>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  Destination, targeting, budget, media, review, and paused
                  provider creation stay bound to one plan version.
                </p>
              </button>
              <button
                type="button"
                className="rounded-xl border border-[var(--gray-200)] p-4 text-left hover:border-[var(--color-brand-500)]"
                onClick={() => {
                  changeTab("campaigns");
                }}
              >
                <div className="font-semibold">Manage campaigns</div>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  Review, launch, pause, spend, results, stop, settlement, and
                  audit evidence live together.
                </p>
              </button>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}
