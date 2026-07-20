/**
 * ISSUE-978 [Ad Connections panel] — all-5-platform live status + one-click
 * Connect/Reconnect + staleness surfacing.
 *
 * Gap this closes (proven in #977 Lane B/E/G): admin-ad-connect ALREADY
 * connects/verifies all 5 channels (meta/tiktok/snapchat/google/reddit) and
 * upserts connected/status/token_last_verified_at/account_status on success
 * — but the admin frontend only ever exposed Meta (adEngineService had only
 * connectMeta/getMetaConnection; AdEnginePage rendered a Meta-only card).
 * This panel is the missing all-5 operator surface. Additive only — the
 * existing Meta card / campaign builder / edge functions are untouched.
 *
 * Business logic (row classification, staleness, age-humanizing, the
 * reconnect-handler factory) lives in lib/adConnections.js as plain
 * functions so it is unit-testable without a DOM (house pattern — see
 * lib/adBuilder/*.js + the node:test suite under __tests__/).
 */

import { useCallback, useEffect, useState } from "react";
import { PlugZap, RefreshCw } from "lucide-react";
import { SectionCard, AlertCard } from "./ui/Card";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Spinner } from "./ui/Spinner";
import { useToast } from "../context/ToastContext";
import { connectChannel, getConnections, parseEdgeError } from "../services/adEngineService";
import { buildConnectionRows, createReconnectHandler } from "../lib/adConnections";

const STATE_BADGE = {
  connected: "success",
  stale: "warning",
  not_connected: "default",
};

const STATE_LABEL = {
  connected: "Connected",
  stale: "Stale",
  not_connected: "Not connected",
};

export function AdConnectionsPanel() {
  const { addToast } = useToast();
  const [connections, setConnections] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [busyPlatform, setBusyPlatform] = useState(null);
  const [rowErrors, setRowErrors] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await getConnections("consumer");
    if (error) {
      setLoadError(error.message ?? "Failed to load connections.");
      setConnections([]);
    } else {
      setConnections(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // Deferred via queueMicrotask (not a direct synchronous call) — `load`
    // sets state as its first statement, and calling it inline here trips
    // react-hooks/set-state-in-effect. Same intent as the codebase's
    // existing "fetch on mount" callbacks (e.g. AdEnginePage's own
    // loadConnection/loadCampaigns), scoped to this new component only.
    queueMicrotask(load);
  }, [load]);

  const reconnect = createReconnectHandler({
    connectChannelFn: connectChannel,
    onStart: (platform) => {
      setBusyPlatform(platform);
      setRowErrors((prev) => ({ ...prev, [platform]: null }));
    },
    onSuccess: async (platform) => {
      setBusyPlatform(null);
      addToast({ variant: "success", title: `${platform} connected`, description: "Connection verified and persisted." });
      await load();
    },
    onError: async (platform, error) => {
      const parsed = await parseEdgeError(error);
      const message = parsed?.message ?? "Connect failed.";
      setRowErrors((prev) => ({ ...prev, [platform]: message }));
      addToast({ variant: "error", title: `${platform} connect failed`, description: message });
      setBusyPlatform(null);
    },
  });

  const rows = buildConnectionRows(connections ?? []);

  return (
    <SectionCard
      title="Ad Connections"
      subtitle="Live status across all 5 ad channels — one-click Connect/Reconnect. The token never reaches this browser."
      action={
        <Button variant="secondary" size="sm" icon={RefreshCw} loading={loading} onClick={load}>
          Refresh
        </Button>
      }
    >
      {loading && !connections ? (
        <div className="flex items-center gap-2 py-4">
          <Spinner size="sm" /> Loading connections…
        </div>
      ) : loadError ? (
        <AlertCard variant="error" title="Couldn't load connections">
          {loadError}
        </AlertCard>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.platform} className="border border-[var(--gray-200)] rounded-lg p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={STATE_BADGE[row.state]} dot>
                      {STATE_LABEL[row.state]}
                    </Badge>
                    <span className="font-medium text-sm">{row.label}</span>
                  </div>
                  <div className="text-xs text-[var(--color-text-secondary)]">
                    {row.displayName ?? "—"}
                    {row.externalAccountId ? ` · account ${row.externalAccountId}` : ""}
                    {row.accountStatus ? ` · ${row.accountStatus}` : ""}
                    {" · "}verified {row.verifiedAgeLabel}
                  </div>
                  {row.reason && (
                    <div
                      className={`text-xs mt-1 ${
                        row.state === "stale" ? "text-[var(--color-warning-700)]" : "text-[var(--color-text-secondary)]"
                      }`}
                    >
                      {row.reason}
                    </div>
                  )}
                  {rowErrors[row.platform] && (
                    <div className="text-xs mt-1 text-[var(--color-error-700)]">{rowErrors[row.platform]}</div>
                  )}
                </div>
                <Button
                  size="sm"
                  variant={row.state === "connected" ? "secondary" : "primary"}
                  icon={PlugZap}
                  loading={busyPlatform === row.platform}
                  onClick={() => reconnect(row.platform, "connect")}
                >
                  {row.state === "not_connected" ? "Connect" : "Reconnect"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
