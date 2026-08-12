import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle, Clock3, RefreshCw, WifiOff } from "lucide-react";
import { SectionCard, AlertCard } from "./ui/Card";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Tabs } from "./ui/Tabs";
import { runAppIdentityPreflight, parseEdgeError } from "../services/adEngineService";
import {
  APP_IDENTITY_PRESENTATION,
  FRESHNESS_MS,
  deriveReadinessState,
  formatFreshness,
  reasonCopy,
  shouldRestoreCompletionFocus,
  transportErrorCopy,
  validateIdentityPreflightResponse,
} from "../lib/adAppIdentityReadiness";

const TABS = [{ id: "explorer", label: "Explorer" }, { id: "business", label: "Business" }];
const initialEntry = () => ({ phase: "not_checked", result: null, error: null, stopped: false });
const STATUS = {
  not_checked: ["Not checked", "default", Clock3], loading: ["Checking", "info", RefreshCw],
  ready: ["Identity ready", "success", CheckCircle], blocked: ["Blocked", "error", AlertCircle],
  error: ["Check failed", "error", AlertCircle], offline: ["Offline", "warning", WifiOff],
  stale: ["Recheck needed", "warning", AlertTriangle],
};

function statusBadge(state, previous = false) {
  const [label, variant, Icon] = previous ? ["Previous result", "warning", Clock3] : STATUS[state];
  return <Badge variant={variant}><Icon aria-hidden="true" className="h-3.5 w-3.5" />{label}</Badge>;
}

function ProviderRow({ provider, state, result, appKey }) {
  const presentation = APP_IDENTITY_PRESENTATION[appKey];
  const row = result?.providers?.find((item) => item.provider === provider) ?? null;
  const previous = ["loading", "error", "offline", "stale"].includes(state) && Boolean(row);
  const ready = state === "ready" && row?.verdict === "ready";
  const blocked = state === "blocked" && row?.verdict === "blocked";
  const badgeState = ready ? "ready" : blocked ? "blocked" : state === "loading" && !row ? "loading" : "not_checked";
  const expectedType = provider === "meta" ? "Facebook Page + Instagram" : presentation.tiktokType;
  const reason = blocked ? reasonCopy(row?.reason_code, { appKey, provider, username: presentation.username, expectedType: presentation.tiktokType }) : null;
  const expected = row?.expected_identity;
  const matched = row?.matched_identity;
  return (
    <section className="grid grid-cols-1 gap-3 p-4 md:grid-cols-[minmax(140px,.8fr)_minmax(280px,1.5fr)_minmax(180px,.9fr)] md:gap-4" aria-labelledby={`identity-${appKey}-${provider}`}>
      <div className="space-y-2">
        <h4 id={`identity-${appKey}-${provider}`} className="text-sm leading-5 font-semibold">{provider === "meta" ? "Meta" : "TikTok"}</h4>
        {previous ? statusBadge(state, true) : statusBadge(badgeState)}
      </div>
      <dl className="space-y-1 text-[13px] leading-5 min-w-0">
        <div><dt className="font-medium inline">Expected </dt><dd className="inline">@{presentation.username} · {provider === "tiktok" && expectedType === "TT_USER" ? "direct TikTok account" : provider === "tiktok" ? "Business Center-authorized TikTok account" : expectedType}</dd></div>
        <div><dt className="font-medium inline">IDs </dt><dd className="inline font-mono text-xs leading-4 text-[var(--color-text-secondary)] break-all">{provider === "meta" ? `Page ${expected?.page_id ?? "—"} · Instagram ${expected?.instagram_user_id ?? "—"}` : (expected?.identity_id ?? "—")}</dd></div>
        <div className="min-h-5"><dt className="font-medium inline">Result </dt><dd className="inline text-sm leading-5">{ready ? (provider === "meta" ? "Exact Page and Instagram identity matched and authorized." : "Exact TikTok identity matched, available, and authorized.") : blocked ? reason.detail : previous ? "Previous result · Not current." : state === "loading" ? "Checking…" : "No current result."}</dd></div>
        {blocked && <div><dt className="sr-only">Reason</dt><dd className="font-medium text-[var(--color-error-700)]">{reason.title} <span className="font-mono text-xs break-all">({row?.reason_code ?? "unknown"})</span></dd></div>}
        {matched?.availability && <div><dt className="font-medium inline">Availability </dt><dd className="inline">{matched.availability}</dd></div>}
      </dl>
      <dl className="space-y-1 text-[13px] leading-5 min-w-0">
        <div><dt className="font-medium">Shared payer</dt><dd className="font-mono text-xs leading-4 text-[var(--color-text-secondary)] break-all">{row?.payer?.external_account_id ?? "—"}</dd></div>
        <div><dt className="sr-only">Payer status</dt><dd>{row?.payer ? `Connected · ${row.payer.status}` : "No current payer result."}</dd></div>
      </dl>
    </section>
  );
}

export function AppIdentityReadinessPanel() {
  const [appKey, setAppKey] = useState("explorer");
  const [entries, setEntries] = useState({ explorer: initialEntry(), business: initialEntry() });
  const [online, setOnline] = useState(() => navigator.onLine);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [announcement, setAnnouncement] = useState("");
  const controllers = useRef({});
  const requestIds = useRef({ explorer: 0, business: 0 });
  const mounted = useRef(true);
  const actionRef = useRef(null);
  const completionFocus = useRef(null);

  const entry = entries[appKey];
  const state = deriveReadinessState(entry, { online, nowMs });
  const presentation = APP_IDENTITY_PRESENTATION[appKey];

  useEffect(() => {
    mounted.current = true;
    const activeControllers = controllers.current;
    return () => {
      mounted.current = false;
      completionFocus.current = null;
      Object.values(activeControllers).forEach((controller) => controller?.abort());
    };
  }, []);

  useEffect(() => {
    const updateOnline = () => { setOnline(navigator.onLine); setNowMs(Date.now()); };
    const refresh = () => setNowMs(Date.now());
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  useEffect(() => {
    if (!entry.result) return undefined;
    const expiresAt = Date.parse(entry.result.checked_at) + FRESHNESS_MS + 1;
    const timer = window.setTimeout(() => setNowMs(Date.now()), Math.max(0, expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [appKey, entry.result]);

  useEffect(() => {
    const pending = completionFocus.current;
    if (!pending) return;
    const action = actionRef.current;
    const canFocus = shouldRestoreCompletionFocus({
      pending,
      appKey,
      currentRequestId: requestIds.current[appKey],
      phase: entry.phase,
      state,
      online,
      errorStatus: entry.error?.status,
      buttonDisabled: !action || action.disabled,
    });
    completionFocus.current = null;
    if (canFocus) action.focus();
  }, [appKey, entry.error?.status, entry.phase, online, state]);

  const handleTabChange = (next) => {
    if (next === appKey) return;
    const outgoing = appKey;
    if (completionFocus.current?.appKey === outgoing) completionFocus.current = null;
    if (entries[outgoing].phase === "loading") {
      controllers.current[outgoing]?.abort();
      requestIds.current[outgoing] += 1;
      setEntries((current) => ({
        ...current,
        [outgoing]: { ...current[outgoing], phase: current[outgoing].result ? "error" : "not_checked", stopped: true, error: null },
      }));
      setAnnouncement(`${APP_IDENTITY_PRESENTATION[outgoing].shortLabel} check stopped. Showing ${APP_IDENTITY_PRESENTATION[next].shortLabel}.`);
    }
    setAppKey(next);
    setNowMs(Date.now());
  };

  const runCheck = async () => {
    if (!navigator.onLine) { setOnline(false); return; }
    const requestedAppKey = appKey;
    if (completionFocus.current?.appKey === requestedAppKey) completionFocus.current = null;
    controllers.current[requestedAppKey]?.abort();
    const controller = new AbortController();
    controllers.current[requestedAppKey] = controller;
    const requestId = ++requestIds.current[requestedAppKey];
    setEntries((current) => ({ ...current, [requestedAppKey]: { ...current[requestedAppKey], phase: "loading", error: null, stopped: false } }));
    const { data, error } = await runAppIdentityPreflight(requestedAppKey, { signal: controller.signal });
    if (!mounted.current || controller.signal.aborted || requestIds.current[requestedAppKey] !== requestId) return;
    if (error) {
      const parsed = await parseEdgeError(error);
      if (!mounted.current || requestIds.current[requestedAppKey] !== requestId) return;
      completionFocus.current = { appKey: requestedAppKey, requestId };
      setEntries((current) => ({ ...current, [requestedAppKey]: { ...current[requestedAppKey], phase: "error", error: { status: parsed?.status }, stopped: false } }));
      setAnnouncement(`${APP_IDENTITY_PRESENTATION[requestedAppKey].shortLabel} identity check failed.`);
      return;
    }
    const accepted = validateIdentityPreflightResponse(data, requestedAppKey);
    if (!accepted) {
      completionFocus.current = { appKey: requestedAppKey, requestId };
      setEntries((current) => ({ ...current, [requestedAppKey]: { ...current[requestedAppKey], phase: "error", error: { status: 500 }, stopped: false } }));
      setAnnouncement(`${APP_IDENTITY_PRESENTATION[requestedAppKey].shortLabel} identity check failed.`);
      return;
    }
    setNowMs(Date.now());
    completionFocus.current = { appKey: requestedAppKey, requestId };
    setEntries((current) => ({ ...current, [requestedAppKey]: { phase: accepted.overall, result: accepted, error: null, stopped: false } }));
    setAnnouncement(`${APP_IDENTITY_PRESENTATION[requestedAppKey].shortLabel} identity check ${accepted.overall === "ready" ? "is ready" : "is blocked"}.`);
  };

  const support = useMemo(() => {
    if (entry.stopped) return "Check stopped when you switched apps. Run it again.";
    if (state === "not_checked") return "Run a read-only check to confirm the exact public identities for this app.";
    if (state === "loading") return entry.result ? "Checking again. The result below is from the previous check and is not current." : "Checking Meta and TikTok…";
    if (state === "ready") return "Both public identities matched exactly under the shared corporate payers.";
    if (state === "blocked") return "At least one public identity did not pass the exact-match safety check. Nothing was treated as ready.";
    if (state === "offline") return `You’re offline. Reconnect, then recheck.${entry.result ? " The previous result is not current." : ""}`;
    if (state === "stale") return "This result is more than 15 minutes old and is no longer current. Recheck before relying on it.";
    return transportErrorCopy(entry.error?.status);
  }, [entry, state]);

  const freshness = !entry.result ? (state === "loading" ? "Check started now." : "Not checked yet.") :
    formatFreshness(entry.result.checked_at, { nowMs, mode: state === "stale" ? "stale" : ["loading", "error", "offline"].includes(state) ? "previous" : "current" });
  const isTransportError = state === "error" || state === "offline";

  return (
    <SectionCard title="App identity readiness">
      <div className="space-y-4" aria-busy={state === "loading"}>
        <p id="app-identity-clarification" className="max-w-[72ch] text-sm leading-5 text-[var(--color-text-secondary)]">This checks the public identity and shared payer only. Native app campaigns are not enabled yet.</p>
        <Tabs tabs={TABS} activeTab={appKey} onChange={handleTabChange} className="[&_button]:min-h-11 [&_button]:flex-1 [&_button]:focus-visible:outline-none [&_button]:focus-visible:ring-2 [&_button]:focus-visible:ring-[var(--color-brand-700)] [&_button]:focus-visible:ring-offset-2 [&_button]:focus-visible:ring-offset-[var(--color-background-primary)] [&_button[aria-selected=true]]:text-[var(--color-brand-700)] [&_button[aria-selected=true]]:border-[var(--color-brand-700)]" />
        <div role="tabpanel" id={`tabpanel-${appKey}`} aria-labelledby={`tab-${appKey}`} aria-describedby="app-identity-clarification" className="space-y-4 min-w-0">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
            <div className="space-y-2 min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h4 className="text-sm leading-5 font-semibold">{presentation.label} · @{presentation.username}</h4>{statusBadge(state)}</div>
              <p className="text-sm leading-5 text-[var(--color-text-secondary)]">{support}</p>
              <p className="text-xs leading-4 text-[var(--color-text-secondary)]">{freshness}</p>
            </div>
          </div>
          {isTransportError && <AlertCard variant={state === "offline" ? "warning" : "error"} title={state === "offline" ? "Offline" : "Check failed"} className="max-w-[72ch]" ><span role={state === "error" ? "alert" : undefined}>{support}</span></AlertCard>}
          <div className="divide-y divide-[var(--gray-200)] overflow-hidden rounded-lg border border-[var(--gray-200)]">
            <ProviderRow provider="meta" state={state} result={entry.result} appKey={appKey} />
            <ProviderRow provider="tiktok" state={state} result={entry.result} appKey={appKey} />
          </div>
          <Button ref={actionRef} variant="secondary" icon={RefreshCw} loading={state === "loading"} disabled={state === "offline" || entry.error?.status === 403} onClick={runCheck} className="min-h-11 w-full md:w-auto focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-[var(--color-background-primary)]">
            {state === "loading" ? "Checking…" : state === "not_checked" ? "Run identity check" : "Recheck"}
          </Button>
          <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</div>
        </div>
      </div>
    </SectionCard>
  );
}
