import { useEffect, useMemo, useState } from "react";
import { AlertCard } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import {
  appCertificationAction,
  parseEdgeError,
} from "../../services/adEngineService";

const PROVIDERS = ["meta", "tiktok", "snapchat", "google", "reddit"];
const LABELS = {
  meta: "Meta",
  tiktok: "TikTok",
  snapchat: "Snapchat",
  google: "Google",
  reddit: "Reddit",
};

function builderHref(appKey, os, provider) {
  const query = new URLSearchParams({
    certification: "1",
    app: appKey,
    os,
    provider,
  });
  return `#/campaign-builder?${query.toString()}`;
}

function statusVariant(status) {
  if (["approved_to_prepare", "paused_ready", "passed"].includes(status)) {
    return "success";
  }
  if (["failed", "expired"].includes(status)) return "error";
  return "warning";
}

function certificationErrorMessage(parsed) {
  return (
    parsed?.body?.detail ??
    parsed?.body?.error ??
    parsed?.message ??
    "The certification action could not be completed. Nothing else was changed."
  );
}

export function FutureAppCampaignBoundary({ appKey, os, latest }) {
  const [provider, setProvider] = useState("meta");
  const [payload, setPayload] = useState(null);
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState("");
  const [launchPhrase, setLaunchPhrase] = useState("");
  const [evidenceResult, setEvidenceResult] = useState("passed");
  const [evidenceProvenance, setEvidenceProvenance] = useState("appsflyer_api");
  const [installTimestamp, setInstallTimestamp] = useState("");

  const canary = payload?.canary ?? null;
  const providerReadiness = useMemo(
    () => latest?.results?.find((row) => row.provider === provider) ?? null,
    [latest, provider],
  );

  useEffect(() => {
    const controller = new AbortController();
    appCertificationAction(
      { action: "load", app_key: appKey, os, provider },
      { signal: controller.signal },
    ).then(async ({ data, error: invokeError }) => {
      if (controller.signal.aborted) return;
      if (invokeError) {
        const parsed = await parseEdgeError(invokeError);
        if (controller.signal.aborted) return;
        setPayload(null);
        setError(certificationErrorMessage(parsed));
        setPhase("error");
        return;
      }
      setPayload(data);
      setPhase("idle");
    });
    return () => controller.abort();
  }, [appKey, os, provider]);

  const transition = async (action, extra = {}) => {
    if (!canary || phase === "mutating") return;
    setPhase("mutating");
    setError("");
    const { data, error: invokeError } = await appCertificationAction({
      action,
      app_key: appKey,
      os,
      provider,
      expected_canary_version: canary.canary_version,
      idempotency_key: window.crypto.randomUUID(),
      reason:
        action === "launch"
          ? "Activate this approved bounded native-app certification canary."
          : action === "stop"
            ? "Stop and confirm this native-app certification canary."
            : "Record server-bound install evidence for this certification canary.",
      ...extra,
    });
    if (invokeError) {
      const parsed = await parseEdgeError(invokeError);
      setError(certificationErrorMessage(parsed));
      setPhase("error");
      return;
    }
    setPayload((current) => ({ ...current, canary: data?.canary }));
    setLaunchPhrase("");
    setPhase("idle");
  };

  const recordEvidence = () => {
    const parsedTimestamp = Date.parse(installTimestamp);
    if (!Number.isFinite(parsedTimestamp)) {
      setError("Choose the install timestamp before recording evidence.");
      return;
    }
    transition("record_evidence", {
      result: evidenceResult,
      provenance: evidenceProvenance,
      install_timestamp: new Date(parsedTimestamp).toISOString(),
    });
  };

  const busy = phase === "loading" || phase === "mutating";
  const builder = builderHref(appKey, os, provider);

  return (
    <section
      aria-labelledby="future-app-campaign-heading"
      className="space-y-4 border-t border-[var(--gray-200)] pt-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4
            id="future-app-campaign-heading"
            className="text-base font-semibold"
          >
            Native-app certification
          </h4>
          <p className="mt-1 max-w-[72ch] text-sm text-[var(--color-text-secondary)]">
            Prepare one bounded provider canary at a time. Every plan, approval,
            activation, stop, spend total, and install result is server-audited.
          </p>
        </div>
        <label className="grid gap-1 text-xs font-medium">
          Provider
          <select
            value={provider}
            onChange={(event) => {
              setPhase("loading");
              setError("");
              setPayload(null);
              setProvider(event.target.value);
            }}
            className="min-h-11 rounded-lg border border-[var(--gray-300)] bg-white px-3 text-sm"
          >
            {PROVIDERS.map((value) => (
              <option key={value} value={value}>
                {LABELS[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 rounded-xl border border-[var(--gray-200)] p-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Readiness
          </p>
          <p className="mt-1 text-sm font-semibold">
            {providerReadiness?.verdict?.replaceAll("_", " ") ?? "Needs check"}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Certification flag
          </p>
          <p className="mt-1 text-sm font-semibold">
            {payload?.enabled ? "Enabled" : "Disabled"}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--color-text-secondary)]">State</p>
          <div className="mt-1">
            {canary ? (
              <Badge variant={statusVariant(canary.status)}>
                {canary.status.replaceAll("_", " ")}
              </Badge>
            ) : (
              <span className="text-sm font-semibold">Loading</span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <AlertCard variant="error" title="Certification action unavailable">
          <span role="alert">{error}</span>
        </AlertCard>
      )}

      {canary && (
        <div className="space-y-4 rounded-xl border border-[var(--gray-200)] p-4">
          <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <p>
              <span className="font-semibold">Hard ceiling:</span>{" "}
              {canary.approved_currency ?? "—"}{" "}
              {canary.approved_spend_ceiling_cents == null
                ? "—"
                : `${Number(canary.approved_spend_ceiling_cents).toLocaleString()} minor units`}
            </p>
            <p>
              <span className="font-semibold">Recorded spend:</span>{" "}
              {canary.actual_spend_cents == null
                ? "—"
                : `${Number(canary.actual_spend_cents).toLocaleString()} minor units`}
            </p>
            <p className="break-all">
              <span className="font-semibold">Provider campaign:</span>{" "}
              {canary.safe_provider_campaign_id ?? "Not created"}
            </p>
            <p>
              <span className="font-semibold">Approval expires:</span>{" "}
              {canary.approval_expires_at
                ? new Date(canary.approval_expires_at).toLocaleString()
                : "—"}
            </p>
          </div>

          {[
            "not_started",
            "approval_required",
            "approved_to_prepare",
            "expired",
            "failed",
          ].includes(canary.status) && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--gray-50)] p-3">
              <p className="max-w-[62ch] text-xs text-[var(--color-text-secondary)]">
                The builder pins this app, OS, and provider, then freezes the
                exact targeting, currency, cap, plan hash, held funds, and owner
                approval. Approval never activates an ad.
              </p>
              <a
                href={builder}
                className="inline-flex min-h-11 items-center rounded-lg bg-[var(--color-brand-700)] px-4 text-sm font-semibold text-white"
              >
                {canary.status === "approved_to_prepare"
                  ? "Open approved canary"
                  : "Build certification plan"}
              </a>
            </div>
          )}

          {canary.status === "paused_ready" && (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <Input
                label="Type “LAUNCH CERTIFICATION” to activate this bounded canary"
                value={launchPhrase}
                onChange={(event) => setLaunchPhrase(event.target.value)}
                placeholder="LAUNCH CERTIFICATION"
              />
              <Button
                loading={phase === "mutating"}
                disabled={launchPhrase !== "LAUNCH CERTIFICATION"}
                onClick={() =>
                  transition("launch", { confirm_phrase: launchPhrase })
                }
              >
                Launch certification
              </Button>
            </div>
          )}

          {canary.status === "running" && (
            <AlertCard
              variant="warning"
              title="Certification canary is live"
              action={
                <Button
                  loading={phase === "mutating"}
                  onClick={() => transition("stop")}
                >
                  Stop and confirm provider
                </Button>
              }
            >
              Stop as soon as the bounded delivery check is complete. The server
              confirms the provider is paused and records actual spend before
              the evidence step opens.
            </AlertCard>
          )}

          {canary.status === "paused_pending_evidence" && (
            <div className="grid gap-3 rounded-lg bg-[var(--gray-50)] p-3 lg:grid-cols-4 lg:items-end">
              <label className="grid gap-1 text-xs font-medium">
                Result
                <select
                  value={evidenceResult}
                  onChange={(event) => setEvidenceResult(event.target.value)}
                  className="min-h-11 rounded-lg border border-[var(--gray-300)] bg-white px-3 text-sm"
                >
                  <option value="passed">Passed</option>
                  <option value="failed">Failed</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs font-medium">
                Provenance
                <select
                  value={evidenceProvenance}
                  onChange={(event) =>
                    setEvidenceProvenance(event.target.value)
                  }
                  className="min-h-11 rounded-lg border border-[var(--gray-300)] bg-white px-3 text-sm"
                >
                  <option value="appsflyer_api">AppsFlyer API</option>
                  <option value="provider_api">Provider API</option>
                  <option value="provider_dashboard">Provider dashboard</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs font-medium">
                Install timestamp
                <input
                  type="datetime-local"
                  value={installTimestamp}
                  onChange={(event) => setInstallTimestamp(event.target.value)}
                  className="min-h-11 rounded-lg border border-[var(--gray-300)] bg-white px-3 text-sm"
                />
              </label>
              <Button
                loading={phase === "mutating"}
                disabled={!installTimestamp}
                onClick={recordEvidence}
              >
                Record bounded evidence
              </Button>
            </div>
          )}

          {canary.status === "passed" && (
            <AlertCard variant="success" title="Provider certification passed">
              This exact app/OS/provider binding now has current server-bound
              evidence. Normal app-campaign authority remains a separate release
              decision.
            </AlertCard>
          )}
        </div>
      )}

      {busy && (
        <p role="status" className="text-xs text-[var(--color-text-secondary)]">
          {phase === "loading"
            ? "Loading certification state…"
            : "Confirming certification action with the server…"}
        </p>
      )}
    </section>
  );
}
