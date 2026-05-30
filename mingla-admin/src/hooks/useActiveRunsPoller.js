/**
 * useActiveRunsPoller — ORCH-1013 Finding B
 *
 * Polls the run-place-intelligence-trial edge fn's `list_active_runs` action
 * every 5s and surfaces every in-progress run (status pending|running|cancelling)
 * to the <ActiveRunsControlTower /> panel. Maintains a per-run rolling buffer of
 * (timestamp, processed_count) for client-side ETA computation. Tracks terminal
 * runs for a 3s "show-then-fade" tail so cancelled / complete / failed runs
 * surface their final pill before unmounting.
 *
 * Polling is suppressed when document.visibilityState === 'hidden' so background
 * tabs don't eat edge-fn quota or distort the ETA buffer.
 *
 * Gemini pricing reference (COMMS-0003):
 * https://ai.google.dev/pricing/gemini-2-5-flash (verified 2026-05-30).
 *
 * Contract (SPEC §3 B.4):
 *   activeRuns        — runs currently active (pending|running|cancelling)
 *   terminalRuns      — runs that just terminated; auto-expire after 3s
 *   loading           — true on the first tick only
 *   error             — null until 3 consecutive poll failures
 *   refresh()         — fire a poll immediately (used by the modal after enqueue)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invokeWithRefresh } from "../lib/supabase";

const POLL_INTERVAL_MS = 5_000;
const TERMINAL_DISPLAY_MS = 3_000;
const ETA_BUFFER_CAP = 12; // 12 * 5s = 60s window
const ETA_MIN_WINDOW_MS = 30_000; // require 30s of samples before computing
const ERROR_THRESHOLD = 3;

export function useActiveRunsPoller() {
  const [activeRuns, setActiveRuns] = useState([]);
  const [terminalRuns, setTerminalRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Persistent across renders, not in state.
  const consecutiveErrorsRef = useRef(0);
  const etaBuffersRef = useRef(new Map()); // run_id -> [{ ts, processed }]
  const terminalTimersRef = useRef(new Map()); // run_id -> timeout handle
  const knownRunIdsRef = useRef(new Set()); // run_ids seen in previous tick
  const isUnmountedRef = useRef(false);

  // Stable refs to the latest tick + state so we don't restart intervals on
  // every render.
  const tickRef = useRef(null);

  function stageTerminal(run) {
    // Show the terminal card for 3s then drop it.
    setTerminalRuns((prev) => {
      // Replace any existing terminal entry for this run id.
      const filtered = prev.filter((r) => r.id !== run.id);
      return [...filtered, run];
    });
    const existing = terminalTimersRef.current.get(run.id);
    if (existing) clearTimeout(existing);
    const handle = setTimeout(() => {
      terminalTimersRef.current.delete(run.id);
      if (isUnmountedRef.current) return;
      setTerminalRuns((prev) => prev.filter((r) => r.id !== run.id));
    }, TERMINAL_DISPLAY_MS);
    terminalTimersRef.current.set(run.id, handle);
    // Drop the eta buffer for terminated runs.
    etaBuffersRef.current.delete(run.id);
  }

  async function tick() {
    if (document.visibilityState === "hidden") return;
    try {
      const { data, error: pollErr } = await invokeWithRefresh(
        "run-place-intelligence-trial",
        { body: { action: "list_active_runs" } },
      );
      if (pollErr) {
        consecutiveErrorsRef.current += 1;
        if (consecutiveErrorsRef.current >= ERROR_THRESHOLD) {
          setError("Couldn't refresh active runs (retrying)");
        }
        return;
      }
      consecutiveErrorsRef.current = 0;
      setError(null);
      const rawRuns = Array.isArray(data?.runs) ? data.runs : [];
      const now = Date.now();
      const nowIds = new Set(rawRuns.map((r) => r.id));

      // Update each active run's ETA buffer + compute liveEta.
      const enriched = rawRuns.map((run) => {
        const buf = etaBuffersRef.current.get(run.id) || [];
        const next = [...buf, { ts: now, processed: Number(run.processed_count || 0) }];
        // Cap buffer.
        while (next.length > ETA_BUFFER_CAP) next.shift();
        etaBuffersRef.current.set(run.id, next);

        let liveEtaSeconds = null;
        let liveRatePerMin = null;
        if (next.length >= 2) {
          const first = next[0];
          const last = next[next.length - 1];
          const dtMs = last.ts - first.ts;
          if (dtMs >= ETA_MIN_WINDOW_MS) {
            const dProcessed = last.processed - first.processed;
            const ratePerSec = dProcessed / (dtMs / 1000);
            if (ratePerSec > 0) {
              const remaining = Math.max(
                0,
                Number(run.total_count || 0) - Number(run.processed_count || 0),
              );
              liveEtaSeconds = remaining / ratePerSec;
              liveRatePerMin = ratePerSec * 60;
            }
          }
        }
        return { ...run, _liveEtaSeconds: liveEtaSeconds, _liveRatePerMin: liveRatePerMin };
      });

      // For every previously-known run id no longer present, fetch its terminal
      // state once and stage it in `terminalRuns`.
      const droppedIds = [...knownRunIdsRef.current].filter((id) => !nowIds.has(id));
      for (const droppedId of droppedIds) {
        try {
          const { data: statusData } = await invokeWithRefresh(
            "run-place-intelligence-trial",
            { body: { action: "run_status", run_id: droppedId } },
          );
          const terminal = statusData?.parent;
          if (terminal && ["complete", "cancelled", "failed"].includes(terminal.status)) {
            stageTerminal({
              ...terminal,
              _liveEtaSeconds: null,
              _liveRatePerMin: null,
            });
          }
        } catch {
          // silent — drop without terminal display
        }
      }

      knownRunIdsRef.current = nowIds;
      setActiveRuns(enriched);
    } catch {
      consecutiveErrorsRef.current += 1;
      if (consecutiveErrorsRef.current >= ERROR_THRESHOLD) {
        setError("Couldn't refresh active runs (retrying)");
      }
    } finally {
      if (loading) setLoading(false);
    }
  }

  // Keep latest tick function in a ref so the interval doesn't restart.
  tickRef.current = tick;

  const refresh = useCallback(async () => {
    if (tickRef.current) await tickRef.current();
  }, []);

  useEffect(() => {
    isUnmountedRef.current = false;
    // Fire-and-forget first poll.
    refresh();
    const interval = setInterval(() => {
      if (tickRef.current) tickRef.current();
    }, POLL_INTERVAL_MS);

    function onVisibility() {
      if (document.visibilityState === "visible") {
        // Resume with an immediate tick.
        if (tickRef.current) tickRef.current();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      isUnmountedRef.current = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      // Clear all terminal-display timers.
      for (const handle of terminalTimersRef.current.values()) clearTimeout(handle);
      terminalTimersRef.current.clear();
      etaBuffersRef.current.clear();
    };
    // refresh is stable (useCallback []), so interval mounts once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { activeRuns, terminalRuns, loading, error, refresh };
}

export default useActiveRunsPoller;
