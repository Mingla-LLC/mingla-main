// ORCH-1196 — Admin API-Health hub. A board of per-service cards grouped by
// category: status dot (worst-of-layers), per-layer breakdown chips, latency,
// credit balance where available, last-checked, 24h uptime + passive rate, and
// a last-incident drill-down. Auto-refreshes every 60s.
//
// Constitutional: no fabricated data (rule 9 — `unknown` renders GREY + "No
// signal yet", never a fake green), surface errors (rule 3 — real loading /
// empty / error states). Mirrors PricingPage.jsx structure (mountedRef,
// useCallback loader, loading/empty/error).
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { RefreshCw, Activity, AlertCircle } from "lucide-react";

import { SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Skeleton } from "../components/ui/Skeleton";
import { Modal, ModalBody } from "../components/ui/Modal";
import { useToast } from "../context/ToastContext";
import { timeAgo, formatDateTime } from "../lib/formatters";
import { getApiHealth, getApiHealthIncidents } from "../services/apiHealthService";
import { statusDotClass, worstOfLayers } from "../lib/apiHealthStatus";

const LAYER_ORDER = [
  ["status_page", "Status page"],
  ["synthetic", "Synthetic"],
  ["passive", "Passive"],
  ["webhook", "Webhook"],
];

function layerChipVariant(status) {
  switch (status) {
    case "healthy":
      return "success";
    case "degraded":
      return "warning";
    case "down":
      return "error";
    default:
      return "default";
  }
}

// Pull a human balance line from whichever layer detail carries it.
function balanceLine(svc) {
  const synth = svc.layers?.synthetic?.detail || {};
  if (svc.service_key === "twilio" && synth.balance != null) {
    return `${synth.balance} ${synth.currency || "USD"}`;
  }
  if (svc.service_key === "paystack" && synth.balance != null) {
    return `${synth.balance} ${synth.currency || "NGN"} (subunits)`;
  }
  if (svc.service_key === "cloudinary" && synth.credits_limit != null && synth.credits_used != null) {
    const remaining = synth.credits_limit - synth.credits_used;
    return `${remaining.toFixed?.(0) ?? remaining} / ${synth.credits_limit} credits`;
  }
  if (svc.service_key === "pexels" && synth.rate_remaining != null) {
    return `${synth.rate_remaining} req remaining`;
  }
  return null;
}

const CATEGORY_LABELS = {
  payments: "Payments",
  ai: "AI",
  maps: "Maps & location",
  discovery: "Discovery & media",
  messaging: "Messaging",
  media: "Media",
  platform: "Platform",
  observability: "Observability",
};

function ServiceCard({ svc, onOpenIncidents }) {
  const dot = statusDotClass(svc.layers, svc.alert_state);
  const synthLatency = svc.layers?.synthetic?.latency_ms;
  const lastChecked = useMemo(() => {
    let max = null;
    for (const v of Object.values(svc.layers || {})) {
      const t = v?.checked_at ? new Date(v.checked_at).getTime() : null;
      if (t != null && (max == null || t > max)) max = t;
    }
    return max ? new Date(max).toISOString() : null;
  }, [svc.layers]);
  const noSignal = worstOfLayers(svc.layers) === null && svc.alert_state !== "alerting";
  const bal = balanceLine(svc);

  return (
    <div className="bg-[var(--color-background-primary)] border border-[var(--gray-200)] rounded-xl p-4 flex flex-col gap-3 shadow-[var(--shadow-sm)]">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
              {svc.display_name}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)]">
              {CATEGORY_LABELS[svc.category] || svc.category}
            </p>
          </div>
        </div>
        {svc.alert_state === "alerting" && (
          <Badge variant="error">Alerting</Badge>
        )}
      </div>

      {noSignal ? (
        <p className="text-xs text-[var(--color-text-tertiary)] italic">No signal yet</p>
      ) : null}

      {/* Layer breakdown */}
      <div className="flex flex-wrap gap-1.5">
        {LAYER_ORDER.map(([key, label]) => {
          const layer = svc.layers?.[key];
          if (!layer) {
            return (
              <span
                key={key}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full bg-[var(--gray-100)] text-[var(--gray-400)]"
                title={`${label}: no data`}
              >
                {label} —
              </span>
            );
          }
          return (
            <Badge key={key} variant={layerChipVariant(layer.status)} className="!text-[11px]">
              {label}
            </Badge>
          );
        })}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[var(--color-text-secondary)]">
        {synthLatency != null && (
          <div>
            <span className="text-[var(--color-text-tertiary)]">Latency</span>{" "}
            <span className="tabular-nums font-medium text-[var(--color-text-primary)]">
              {synthLatency}ms
            </span>
          </div>
        )}
        {svc.uptime_24h_pct != null && (
          <div>
            <span className="text-[var(--color-text-tertiary)]">24h uptime</span>{" "}
            <span className="tabular-nums font-medium text-[var(--color-text-primary)]">
              {svc.uptime_24h_pct}%
            </span>
          </div>
        )}
        {svc.passive_24h?.total > 0 && (
          <div>
            <span className="text-[var(--color-text-tertiary)]">Passive 24h</span>{" "}
            <span className="tabular-nums font-medium text-[var(--color-text-primary)]">
              {svc.passive_24h.success}/{svc.passive_24h.total}
            </span>
          </div>
        )}
        {bal && (
          <div>
            <span className="text-[var(--color-text-tertiary)]">Balance</span>{" "}
            <span className="tabular-nums font-medium text-[var(--color-text-primary)]">{bal}</span>
          </div>
        )}
        {svc.layers?.synthetic?.mode && (
          <div>
            <span className="text-[var(--color-text-tertiary)]">Mode</span>{" "}
            <span className="font-medium text-[var(--color-text-primary)]">
              {svc.layers.synthetic.mode}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-[var(--color-text-tertiary)] pt-1 border-t border-[var(--gray-100)]">
        <span>{lastChecked ? `Checked ${timeAgo(lastChecked)}` : "Never checked"}</span>
        <button
          type="button"
          className="text-[var(--color-brand-600)] hover:underline cursor-pointer"
          onClick={() => onOpenIncidents(svc)}
        >
          Incidents
        </button>
      </div>
    </div>
  );
}

export function ApiHealthPage() {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [data, setData] = useState(null); // { generated_at, services:[], last_probe_at }

  const [incidentsModal, setIncidentsModal] = useState(null); // { service, rows, loading }

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setLoadError(null);
    try {
      const res = await getApiHealth();
      if (!mountedRef.current) return;
      setData(res);
    } catch (err) {
      if (!mountedRef.current) return;
      setLoadError(err.message || "Could not load API health.");
    } finally {
      if (mountedRef.current && showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  // Auto-refresh every 60s (silent — no spinner flash).
  useEffect(() => {
    const id = setInterval(() => load(false), 60000);
    return () => clearInterval(id);
  }, [load]);

  const openIncidents = useCallback(async (svc) => {
    setIncidentsModal({ service: svc, rows: null, loading: true });
    try {
      const rows = await getApiHealthIncidents(svc.service_key, 50);
      if (!mountedRef.current) return;
      setIncidentsModal({ service: svc, rows: rows || [], loading: false });
    } catch (err) {
      if (!mountedRef.current) return;
      addToast({ variant: "error", title: "Couldn't load incidents", description: err.message });
      setIncidentsModal({ service: svc, rows: [], loading: false });
    }
  }, [addToast]);

  const services = data?.services ?? [];
  const grouped = useMemo(() => {
    const map = new Map();
    for (const svc of services) {
      const cat = svc.category || "platform";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(svc);
    }
    return Array.from(map.entries());
  }, [services]);

  // Stale-probe banner: probe should run hourly; > 90 min => possibly stalled.
  const lastProbeAt = data?.last_probe_at ?? null;
  const probeStale = useMemo(() => {
    if (!lastProbeAt) return false;
    return Date.now() - new Date(lastProbeAt).getTime() > 90 * 60 * 1000;
  }, [lastProbeAt]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">API health</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Live status of every external service Mingla depends on.
            {lastProbeAt ? ` Last probe ${timeAgo(lastProbeAt)}.` : " No probe has run yet."}
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => load(true)}>
          Refresh
        </Button>
      </div>

      {loadError ? (
        <AlertCard
          variant="error"
          title="Couldn't load API health"
          action={
            <Button variant="secondary" size="sm" onClick={() => load(true)}>
              Retry
            </Button>
          }
        >
          {loadError}
        </AlertCard>
      ) : null}

      {probeStale ? (
        <AlertCard variant="warning" title="Probe may be stalled">
          The hourly probe hasn't reported in over 90 minutes (last: {formatDateTime(lastProbeAt)}).
          Check the api-health-probe cron job and edge function logs.
        </AlertCard>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border border-[var(--gray-200)] rounded-xl p-4 flex flex-col gap-3">
              <Skeleton width={40} height={40} rounded="full" />
              <Skeleton width="60%" height={16} />
              <Skeleton width="80%" height={12} />
            </div>
          ))}
        </div>
      ) : services.length === 0 && !loadError ? (
        <AlertCard variant="info" title="No services registered">
          The monitored-service registry is empty. Apply the ORCH-1196 migration to seed it.
        </AlertCard>
      ) : (
        grouped.map(([cat, list]) => (
          <SectionCard key={cat} title={CATEGORY_LABELS[cat] || cat}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {list.map((svc) => (
                <ServiceCard key={svc.service_key} svc={svc} onOpenIncidents={openIncidents} />
              ))}
            </div>
          </SectionCard>
        ))
      )}

      {/* Incidents drill-down */}
      <Modal
        open={incidentsModal !== null}
        onClose={() => setIncidentsModal(null)}
        title={incidentsModal ? `${incidentsModal.service.display_name} — incidents` : ""}
        size="lg"
      >
        <ModalBody>
          {incidentsModal?.loading ? (
            <div className="flex flex-col gap-2">
              <Skeleton height={16} />
              <Skeleton height={16} width="80%" />
            </div>
          ) : (incidentsModal?.rows?.length ?? 0) === 0 ? (
            <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] py-4">
              <Activity className="w-4 h-4 text-[var(--color-text-tertiary)]" />
              No degraded/down incidents in the recent window.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {incidentsModal.rows.map((row, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 text-sm border-b border-[var(--gray-100)] pb-2"
                >
                  <AlertCircle
                    className={`w-4 h-4 shrink-0 mt-0.5 ${
                      row.status === "down" ? "text-[#ef4444]" : "text-[#f59e0b]"
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-[var(--color-text-primary)]">
                      {row.status} · {row.layer}
                      {row.http_status ? ` · HTTP ${row.http_status}` : ""}
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      {formatDateTime(row.checked_at)}
                      {row.detail?.error ? ` · ${row.detail.error}` : ""}
                      {row.detail?.description ? ` · ${row.detail.description}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ModalBody>
      </Modal>
    </div>
  );
}
