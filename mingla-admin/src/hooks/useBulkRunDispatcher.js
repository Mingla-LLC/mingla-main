/**
 * useBulkRunDispatcher — ORCH-1013 Finding B
 *
 * Client-side dispatcher for the "Run remainder on all un-evaluated cities"
 * bulk action. Enforces:
 *   - Hard cap: inFlight ≤ 3 at all times (I-PROPOSED-INTEL-BULK-DISPATCHER-CAP-3).
 *   - 2s stagger between consecutive `starting` transitions
 *     (I-PROPOSED-INTEL-BULK-DISPATCHER-STAGGER-2S).
 *   - Auto-queue: when a running run completes (drops from list_active_runs),
 *     the dispatcher picks up the next `pending` city.
 *
 * Per SPEC §3 B.6 + §7-D2: tab-close loses pending cities. Server has no
 * intelligence_run_queue; that's a future ORCH if the operator demands it.
 * In-flight runs are server-durable (place_intelligence_runs row); the control
 * tower hydrates them on reopen.
 *
 * Gemini pricing reference (COMMS-0003):
 * issue #3526 — pricing comes from the server's cost_model; this hook holds
 * no rate of its own.
 *
 * Contract (SPEC §3 B.6):
 *   state.queue       — [{ city_id, city_name, remaining_count, status,
 *                          run_id?, error?, started_at? }]
 *   state.inFlight    — count of queue entries with status in {starting, running}
 *   enqueue(cities)   — append cities to the queue and start the tick loop
 *   cancelAll()       — flip every `pending` to `skipped_concurrent`; does NOT
 *                       cancel in-flight runs (operator uses per-card cancel)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invokeWithRefresh } from "../lib/supabase";
import { extractFunctionError } from "../lib/edgeFunctionError";
import { needsHighCostConfirmation } from "../services/intelligenceCostModel.js";

const MAX_CONCURRENT = 3;
const STAGGER_MS = 2_000;
const TICK_INTERVAL_MS = 500;

function countInFlight(queue) {
  return queue.filter((c) => c.status === "starting" || c.status === "running")
    .length;
}

export function useBulkRunDispatcher({ onToast, costModel } = {}) {
  // issue #3526 P0-1 — the dispatcher used to compute
  //   const estCost = remaining * 0.004;  const confirmHighCost = estCost > 5;
  // from two hardcoded numbers. When the server moved to $0.0089 the flag went
  // out false for cities the server priced above its guard, the call came back
  // 400 cost_above_guard, and the code below marks the city `failed` WITHOUT
  // retrying — so Baltimore (1,205 remaining) could not be started at all.
  // Both numbers now come from the server's cost_model.
  const costModelRef = useRef(costModel ?? null);
  costModelRef.current = costModel ?? null;
  const [state, setState] = useState({ queue: [], inFlight: 0 });
  const queueRef = useRef([]);
  const tickIntervalRef = useRef(null);
  const startingInFlightRef = useRef(false); // guard re-entry during a `starting` POST

  function syncState() {
    setState({
      queue: [...queueRef.current],
      inFlight: countInFlight(queueRef.current),
    });
  }

  function ensureTick() {
    if (tickIntervalRef.current) return;
    tickIntervalRef.current = setInterval(tick, TICK_INTERVAL_MS);
  }

  function stopTick() {
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
  }

  async function startCity(city) {
    // Mark `starting` synchronously so the next tick sees the inFlight bump.
    const idx = queueRef.current.findIndex((c) => c.city_id === city.city_id);
    if (idx < 0) return;
    queueRef.current[idx] = {
      ...queueRef.current[idx],
      status: "starting",
      started_at: Date.now(),
    };
    syncState();

    try {
      const confirmHighCost = needsHighCostConfirmation(
        Math.max(0, city.remaining_count),
        costModelRef.current,
      );
      if (confirmHighCost === null) {
        // No cost model means we cannot price the run, and a guess is what made
        // this button dead in the first place. Fail loudly instead of sending a
        // flag we have not computed.
        const i0 = queueRef.current.findIndex((c) => c.city_id === city.city_id);
        if (i0 >= 0) {
          queueRef.current[i0] = {
            ...queueRef.current[i0],
            status: "failed",
            error: "Cost model unavailable from the server — cannot price this run.",
          };
        }
        if (onToast) {
          onToast({
            variant: "warning",
            title: `Couldn't start ${city.city_name}`,
            description: "Cost model unavailable from the server — reload the page.",
          });
        }
        syncState();
        return;
      }
      const { data, error: startErr } = await invokeWithRefresh(
        "run-place-intelligence-trial",
        {
          body: {
            action: "start_run",
            city_id: city.city_id,
            mode: "remainder",
            confirm_high_cost: confirmHighCost,
          },
        },
      );
      if (startErr) {
        // Pull the error code if present (e.g. concurrent_run = 409).
        let code = null;
        try {
          if (startErr.context?.json) {
            const j = await startErr.context.json();
            code = j?.error ?? null;
          }
        } catch {
          // ignore
        }
        const msg = await extractFunctionError(startErr, "start_run failed");
        const newStatus = code === "concurrent_run" ? "skipped_concurrent" : "failed";
        const i2 = queueRef.current.findIndex((c) => c.city_id === city.city_id);
        if (i2 >= 0) {
          queueRef.current[i2] = {
            ...queueRef.current[i2],
            status: newStatus,
            error: msg,
          };
        }
        if (onToast) {
          onToast({
            variant: "warning",
            title: `Couldn't start ${city.city_name}`,
            description: msg,
          });
        }
        syncState();
        return;
      }
      const runId = data?.runId ?? null;
      const i2 = queueRef.current.findIndex((c) => c.city_id === city.city_id);
      if (i2 >= 0) {
        queueRef.current[i2] = {
          ...queueRef.current[i2],
          status: "running",
          run_id: runId,
        };
      }
      syncState();
    } catch (err) {
      const i2 = queueRef.current.findIndex((c) => c.city_id === city.city_id);
      if (i2 >= 0) {
        queueRef.current[i2] = {
          ...queueRef.current[i2],
          status: "failed",
          error: err?.message || "Unknown error",
        };
      }
      if (onToast) {
        onToast({
          variant: "warning",
          title: `Couldn't start ${city.city_name}`,
          description: err?.message || "Unknown error",
        });
      }
      syncState();
    }
  }

  async function reconcileRunningWithPoller() {
    // Best-effort: poll list_active_runs and flip any `running` queue entries
    // whose run_id no longer appears to `complete`. This unblocks the next
    // `pending` city in the queue.
    try {
      const { data, error: pErr } = await invokeWithRefresh(
        "run-place-intelligence-trial",
        { body: { action: "list_active_runs" } },
      );
      if (pErr) return;
      const liveRunIds = new Set((data?.runs || []).map((r) => r.id));
      let changed = false;
      for (let i = 0; i < queueRef.current.length; i++) {
        const c = queueRef.current[i];
        if (c.status === "running" && c.run_id && !liveRunIds.has(c.run_id)) {
          queueRef.current[i] = { ...c, status: "complete" };
          changed = true;
        }
      }
      if (changed) syncState();
    } catch {
      // silent
    }
  }

  async function tick() {
    if (startingInFlightRef.current) return;

    // First, reconcile any `running` rows that have finished server-side.
    await reconcileRunningWithPoller();

    const inFlight = countInFlight(queueRef.current);
    if (inFlight >= MAX_CONCURRENT) return;

    // Find last start timestamp (for stagger gating).
    const lastStartedAt = queueRef.current.reduce((max, c) => {
      const ts = Number(c.started_at || 0);
      return ts > max ? ts : max;
    }, 0);
    const now = Date.now();
    if (now - lastStartedAt < STAGGER_MS && lastStartedAt > 0) return;

    const next = queueRef.current.find((c) => c.status === "pending");
    if (!next) {
      // Nothing pending. If nothing in flight either, stop the tick.
      if (inFlight === 0) stopTick();
      return;
    }

    startingInFlightRef.current = true;
    try {
      await startCity(next);
    } finally {
      startingInFlightRef.current = false;
    }
  }

  const enqueue = useCallback((cities) => {
    if (!Array.isArray(cities) || cities.length === 0) return;
    const existingIds = new Set(queueRef.current.map((c) => c.city_id));
    const incoming = cities
      .filter((c) => c?.city_id && !existingIds.has(c.city_id))
      .map((c) => ({
        city_id: c.city_id,
        city_name: c.city_name,
        remaining_count: Number(c.remaining_count || 0),
        status: "pending",
      }));
    queueRef.current = [...queueRef.current, ...incoming];
    syncState();
    ensureTick();
  }, []);

  const cancelAll = useCallback(() => {
    queueRef.current = queueRef.current.map((c) =>
      c.status === "pending" ? { ...c, status: "skipped_concurrent" } : c,
    );
    syncState();
  }, []);

  useEffect(() => {
    return () => {
      stopTick();
    };
  }, []);

  return { state, enqueue, cancelAll };
}

export default useBulkRunDispatcher;
