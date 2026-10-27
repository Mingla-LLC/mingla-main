/**
 * ISSUE-978 / #3697 [Ad Connections panel] — all-5-platform live status,
 * honest Connect/Reconnect/Verify actions, and bounded background checks.
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

import { adsErrorWords } from "../lib/systemPages";
import { useCallback, useEffect, useRef, useState } from "react";
import { PlugZap, RefreshCw } from "lucide-react";
import { SectionCard, AlertCard } from "./ui/Card";
import { Button } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Spinner } from "./ui/Spinner";
import { useToast } from "../context/ToastContext";
import { connectChannel, getConnections, parseEdgeError } from "../services/adEngineService";
import {
  AUTO_VERIFY_INTERVAL_MS,
  autoVerificationPlatforms,
  buildConnectionRows,
  createReconnectHandler,
} from "../lib/adConnections";

const STATE_BADGE = {
  connected: "success",
  verification_due: "warning",
  needs_attention: "error",
  not_connected: "default",
};

export function AdConnectionsPanel() {
  const { addToast } = useToast();
  const [connections, setConnections] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [busyPlatforms, setBusyPlatforms] = useState({});
  const [rowErrors, setRowErrors] = useState({});
  const autoVerifyAttempts = useRef({});

  const setPlatformBusy = useCallback((platform, busy) => {
    setBusyPlatforms((current) => ({ ...current, [platform]: busy }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await getConnections("consumer");
    if (error) {
      setLoadError(adsErrorWords(error.message, "Failed to load connections."));
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

  const verifyConnectedRows = useCallback(async (currentConnections) => {
    const nowMs = Date.now();
    const platforms = autoVerificationPlatforms(
      currentConnections,
      autoVerifyAttempts.current,
      nowMs,
    );
    if (platforms.length === 0) return;

    platforms.forEach((platform) => {
      autoVerifyAttempts.current[platform] = nowMs;
      setPlatformBusy(platform, true);
      setRowErrors((current) => ({ ...current, [platform]: null }));
    });

    await Promise.all(platforms.map(async (platform) => {
      try {
        const { error } = await connectChannel(platform, "status", "consumer");
        if (error) {
          const parsed = await parseEdgeError(error);
          setRowErrors((current) => ({
            ...current,
            [platform]: adsErrorWords(parsed?.message, "Provider verification failed."),
          }));
        }
      } catch (error) {
        const parsed = await parseEdgeError(error);
        setRowErrors((current) => ({
          ...current,
          [platform]: adsErrorWords(parsed?.message ?? error?.message, "Provider verification failed."),
        }));
      } finally {
        setPlatformBusy(platform, false);
      }
    }));

    // A status request may mark a formerly healthy row invalid. Re-read the
    // lane once after the bounded batch instead of guessing from responses.
    const { data, error } = await getConnections("consumer");
    if (!error) setConnections(data ?? []);
  }, [setPlatformBusy]);

  useEffect(() => {
    if (connections === null) return;
    queueMicrotask(() => verifyConnectedRows(connections));
  }, [connections, verifyConnectedRows]);

  useEffect(() => {
    const verifyWhenVisible = () => {
      if (document.visibilityState === "visible" && connections !== null) {
        void verifyConnectedRows(connections);
      }
    };
    const intervalId = window.setInterval(verifyWhenVisible, AUTO_VERIFY_INTERVAL_MS);
    document.addEventListener("visibilitychange", verifyWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", verifyWhenVisible);
    };
  }, [connections, verifyConnectedRows]);

  const reconnect = createReconnectHandler({
    connectChannelFn: connectChannel,
    lane: "consumer",
    onStart: (platform) => {
      setPlatformBusy(platform, true);
      setRowErrors((prev) => ({ ...prev, [platform]: null }));
    },
    onSuccess: async (platform, _data, action) => {
      setPlatformBusy(platform, false);
      const verified = action === "status";
      addToast({
        variant: "success",
        title: `${platform} ${verified ? "verified" : "connected"}`,
        description: verified
          ? "Provider status refreshed."
          : "Connection verified and persisted.",
      });
      await load();
    },
    onError: async (platform, error, action) => {
      const parsed = await parseEdgeError(error);
      const message = adsErrorWords(parsed?.message, action === "status" ? "Verification failed." : "Connect failed.");
      setRowErrors((prev) => ({ ...prev, [platform]: message }));
      addToast({
        variant: "error",
        title: `${platform} ${action === "status" ? "verification" : "connect"} failed`,
        description: message,
      });
      setPlatformBusy(platform, false);
    },
  });

  const rows = buildConnectionRows(connections ?? []);

  return (
    <SectionCard
      title="Ad Connections"
      subtitle="Corporate accounts that pay for ads. A connection alone does not prove app-download readiness."
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
                    <Badge variant={STATE_BADGE[row.operatorState]} dot>
                      {row.operatorLabel}
                    </Badge>
                    <span className="font-medium text-sm">{row.label}</span>
                  </div>
                  <div className="text-xs text-[var(--color-text-secondary)]">
                    {row.displayName ?? "—"}
                    {row.externalAccountId ? ` · account ${row.externalAccountId}` : ""}
                    {row.accountStatus ? ` · ${row.accountStatus}` : ""}
                    {" · "}verified {row.verifiedAgeLabel}
                  </div>
                  {row.operatorReason && (
                    <div
                      className={`text-xs mt-1 ${
                        row.operatorState === "verification_due"
                          ? "text-[var(--color-warning-700)]"
                          : row.operatorState === "needs_attention"
                            ? "text-[var(--color-error-700)]"
                            : "text-[var(--color-text-secondary)]"
                      }`}
                    >
                      {row.operatorReason}
                    </div>
                  )}
                  {rowErrors[row.platform] && (
                    <div className="text-xs mt-1 text-[var(--color-error-700)]">{rowErrors[row.platform]}</div>
                  )}
                </div>
                <Button
                  size="sm"
                  variant={row.action === "status" ? "secondary" : "primary"}
                  icon={row.action === "status" ? RefreshCw : PlugZap}
                  loading={busyPlatforms[row.platform] === true}
                  onClick={() => reconnect(row.platform, row.action)}
                >
                  {row.actionLabel}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
