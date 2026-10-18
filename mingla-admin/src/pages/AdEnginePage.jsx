/**
 * Admin Ads control center.
 *
 * Provider connections, app readiness, and preflight live here. All campaign
 * creation goes through the immutable-plan Campaign Builder; all lifecycle,
 * spend, and reporting actions live on Campaigns. This page intentionally has
 * no quick-create or direct-launch bypass.
 */

import { useCallback, useEffect, useState } from "react";
import { Megaphone, RefreshCw, Rocket } from "lucide-react";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../context/ToastContext";
import { loadFeatureFlags } from "../lib/featureFlags";
import { formatCampaignMoney } from "../lib/adSpendCap";
import { AdConnectionsPanel } from "../components/AdConnectionsPanel";
import { AppDownloadReadinessPanel } from "../components/app-readiness/AppDownloadReadinessPanel";
import {
  connectMeta,
  getMetaConnection,
  parseEdgeError,
  runPreflight,
} from "../services/adEngineService";
import { PageHeader } from "../components/ui/PageHeader";
import { Tabs } from "../components/ui/Tabs";
import { CampaignsPage } from "./CampaignsPage";
import { listAdCreatives } from "../services/adEngineService";

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

function tabFromHash() {
  const query = window.location.hash.split("?")[1] ?? "";
  const requested = new URLSearchParams(query).get("tab") ?? "overview";
  return ADS_TABS.some((tab) => tab.id === requested) ? requested : "overview";
}

function CreativeLibraryPanel() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    listAdCreatives().then(({ data, error: loadError }) => {
      if (!mounted) return;
      setRows(data ?? []);
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
          Add through campaign
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
        <p className="text-sm text-[var(--color-text-secondary)]">
          No creatives yet. Add a local file in the governed campaign flow.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((creative) => {
            const preview =
              creative.poster_url ??
              (creative.kind === "image" ? creative.source_url : null);
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
                <div className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {creative.name || "Untitled creative"}
                      </p>
                      <p className="text-xs text-[var(--color-text-secondary)]">
                        {creative.kind} ·{" "}
                        {creative.aspect_ratio || "ratio pending"}
                        {creative.duration_seconds
                          ? ` · ${creative.duration_seconds}s`
                          : ""}
                      </p>
                    </div>
                    <Badge
                      variant={
                        creative.status === "active" ? "success" : "warning"
                      }
                    >
                      {creative.status}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-[var(--color-text-tertiary)]">
                    Added {new Date(creative.created_at).toLocaleString()}
                  </p>
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
  const [connection, setConnection] = useState(null);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState(null);
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

  const loadConnection = useCallback(async () => {
    setConnectionLoading(true);
    const { data, error } = await getMetaConnection();
    if (error) setConnectError({ message: error.message });
    setConnection(data ?? null);
    setConnectionLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConnection();
  }, [loadConnection]);

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

  const handleConnect = async () => {
    setConnecting(true);
    setConnectError(null);
    const { data, error } = await connectMeta("connect");
    if (error) {
      const parsed = await parseEdgeError(error);
      setConnectError({
        status: parsed?.status,
        code: parsed?.body?.error,
        message:
          typeof parsed?.body?.detail === "string"
            ? parsed.body.detail
            : (parsed?.body?.detail?.message ??
              parsed?.message ??
              "Connect failed."),
        trace: parsed?.body?.detail?.trace_id ?? null,
      });
    } else {
      setConnection(data?.connection ?? null);
      addToast({
        variant: "success",
        title: "Meta connected",
        description: "Connection verified and persisted.",
      });
    }
    setConnecting(false);
  };

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

  const extra = connection?.extra ?? {};
  const isConnected =
    Boolean(connection?.connected) && connection?.status === "connected";
  const isInvalid = connection?.status === "invalid";
  const billingWarning =
    isConnected &&
    (connection?.account_status !== "ACTIVE" ||
      extra?.has_payment_method === false);
  const floors = extra?.minimum_budgets ?? null;
  const floorMoney = (cents) =>
    formatCampaignMoney(connection?.currency, cents);

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

          <SectionCard
            title="Meta connection — detail"
            subtitle="System User credentials remain in Edge Function secrets, never in the browser or database."
            action={
              <Button
                variant="secondary"
                size="sm"
                icon={RefreshCw}
                loading={connecting}
                onClick={handleConnect}
              >
                {isConnected ? "Reconnect" : "Connect Meta"}
              </Button>
            }
          >
            {connectionLoading ? (
              <div className="flex items-center gap-2 py-4">
                <Spinner size="sm" /> Loading connection…
              </div>
            ) : (
              <div className="space-y-3">
                {!connection && !connectError && (
                  <AlertCard variant="info" title="Not configured">
                    Connect the Meta account after its app, System User, Page
                    task, and billing setup are ready. Verification fails
                    closed.
                  </AlertCard>
                )}
                {isInvalid && (
                  <AlertCard variant="error" title="Meta connection invalid">
                    Re-verify the System User token, then reconnect. Builder
                    create remains disabled while the connection is invalid.
                  </AlertCard>
                )}
                {connectError && (
                  <AlertCard
                    variant="error"
                    title={`Connect failed${connectError.code ? ` — ${connectError.code}` : ""}`}
                  >
                    {connectError.message}
                    {connectError.trace ? (
                      <div className="text-xs mt-1">
                        fbtrace_id: {connectError.trace}
                      </div>
                    ) : null}
                  </AlertCard>
                )}
                {isConnected && (
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <Badge variant="success" dot>
                      Connected
                    </Badge>
                    <span>{connection.display_name}</span>
                    <span className="text-[var(--color-text-secondary)]">
                      account {connection.external_account_id} ·{" "}
                      {connection.currency ?? "currency unavailable"} ·{" "}
                      {connection.account_status ?? "status unavailable"}
                    </span>
                    {floors && (
                      <span className="text-xs text-[var(--color-text-secondary)]">
                        floors: impressions {floorMoney(floors.imp)} · video{" "}
                        {floorMoney(floors.video_views)} · clicks{" "}
                        {floorMoney(floors.high_freq)} · conversion{" "}
                        {floorMoney(floors.low_freq)} /day
                      </span>
                    )}
                  </div>
                )}
                {billingWarning && (
                  <AlertCard variant="warning" title="Billing not ready">
                    Add a payment method in Meta Ads Manager before building. A
                    provider campaign without billing cannot deliver.
                  </AlertCard>
                )}
              </div>
            )}
          </SectionCard>
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
