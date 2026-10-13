// Issue #3802 (Wave 1) — one pipeline's records and every change to them.
//
// The page that mounts this hook is the single owner of the loaded list; the
// board, the list, the by-region table and the open card all read from it.
// A pipeline is loaded whole (the server caps it at 5,000) and filtered in the
// browser. Writes are optimistic where the result is predictable (a stage
// move) and always end with the server's own copy of the record.
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { crmKeys } from "./useCrmConfig";
import { BOARD_REFRESH_MS } from "../lib/crmModel";
import * as crm from "../services/crmService";

/** Follows the browser's own online/offline signal. */
export function useOnline() {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine !== false
  );
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/**
 * `paused` stops the quiet timer (not the load): the page passes true while a
 * card field is being edited, so a refresh never lands under someone's typing.
 */
export function useCrmPipeline(pipeline, { enabled = true, paused = false } = {}) {
  const { access } = useAuth();
  // The list belongs to this person and this pipeline.
  const key = crmKeys.records(access?.email, pipeline);
  const [state, setState] = useState({
    key,
    records: [],
    truncated: false,
    loaded: false,
    error: null,
  });
  const [pendingIds, setPendingIds] = useState(() => new Set());
  const pendingRef = useRef(new Set());
  const loadSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setPending = useCallback((id, on) => {
    const next = new Set(pendingRef.current);
    if (on) next.add(id);
    else next.delete(id);
    pendingRef.current = next;
    setPendingIds(next);
  }, []);

  const refetch = useCallback(
    async ({ quiet = false } = {}) => {
      const seq = ++loadSeq.current;
      if (!quiet) setState((s) => ({ ...s, key, loaded: false, error: null }));
      try {
        const data = await crm.listRecords(pipeline);
        if (!mounted.current || seq !== loadSeq.current) return;
        // A background refresh never overwrites a card that is mid-save.
        if (quiet && pendingRef.current.size > 0) return;
        setState({
          key,
          records: Array.isArray(data?.records) ? data.records : [],
          truncated: !!data?.truncated,
          loaded: true,
          error: null,
        });
      } catch (error) {
        if (!mounted.current || seq !== loadSeq.current) return;
        // A failed background refresh keeps what is on screen.
        if (quiet) return;
        setState({ key, records: [], truncated: false, loaded: true, error });
      }
    },
    [pipeline, key]
  );

  useEffect(() => {
    if (!enabled) return undefined;
    refetch();
    const onFocus = () => {
      if (document.visibilityState === "visible") refetch({ quiet: true });
    };
    const onOnline = () => refetch({ quiet: true });
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [enabled, refetch]);

  // A quiet refresh on a timer, so a board left open does not go stale. Only
  // while the page is visible, the browser is online and nobody is typing.
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => {
      if (pausedRef.current) return;
      if (document.visibilityState !== "visible") return;
      if (navigator.onLine === false) return;
      refetch({ quiet: true });
    }, BOARD_REFRESH_MS);
    return () => clearInterval(timer);
  }, [enabled, refetch]);

  /**
   * The server's copy of one card, right now: { record, activity, ... }. Used
   * before a move, so a card someone else already moved is never moved again
   * from where it USED to be.
   */
  const checkFresh = useCallback((id) => crm.getRecord(id), []);

  /** Put the server's copy of one record into the list (or add it). */
  const applyRecord = useCallback(
    (record) => {
      if (!record || record.pipeline !== pipeline) return;
      setState((s) => {
        const at = s.records.findIndex((r) => r.id === record.id);
        const records = at < 0 ? [record, ...s.records] : s.records.map((r) => (r.id === record.id ? record : r));
        return { ...s, records };
      });
    },
    [pipeline]
  );

  const dropRecord = useCallback((id) => {
    setState((s) => ({ ...s, records: s.records.filter((r) => r.id !== id) }));
  }, []);

  /** Optimistic: the card shows in its new stage while the server answers. */
  const moveStage = useCallback(
    async (record, toStage, reason = null) => {
      setPending(record.id, true);
      setState((s) => ({
        ...s,
        records: s.records.map((r) => (r.id === record.id ? { ...r, stage: toStage } : r)),
      }));
      try {
        const res = await crm.moveStage(record.id, toStage, reason);
        if (mounted.current) applyRecord(res.record);
        return res;
      } catch (error) {
        // The card goes back where it was.
        if (mounted.current) applyRecord(record);
        throw error;
      } finally {
        if (mounted.current) setPending(record.id, false);
      }
    },
    [applyRecord, setPending]
  );

  const undoMove = useCallback(
    async (activityId) => {
      const res = await crm.undoStageMove(activityId);
      if (mounted.current) applyRecord(res.record);
      return res;
    },
    [applyRecord]
  );

  const create = useCallback(
    async (fields, requestKey) => {
      const res = await crm.createRecord(pipeline, fields, requestKey);
      if (mounted.current && res?.status === "created") applyRecord(res.record);
      return res;
    },
    [pipeline, applyRecord]
  );

  const update = useCallback(
    async (id, changes) => {
      const res = await crm.updateRecord(id, changes);
      if (mounted.current) applyRecord(res.record);
      return res;
    },
    [applyRecord]
  );

  const setOwners = useCallback(
    async (id, emails) => {
      const res = await crm.setOwners(id, emails);
      if (mounted.current) applyRecord(res.record);
      return res;
    },
    [applyRecord]
  );

  const log = useCallback(
    async (id, entry, requestKey) => {
      const res = await crm.logActivity(id, entry, requestKey);
      if (mounted.current) applyRecord(res.record);
      return res;
    },
    [applyRecord]
  );

  const remove = useCallback(
    async (id) => {
      const res = await crm.deleteRecord(id);
      if (mounted.current) dropRecord(id);
      return res;
    },
    [dropRecord]
  );

  const restore = useCallback(
    async (id) => {
      const res = await crm.restoreRecord(id);
      if (mounted.current) applyRecord(res.record);
      return res;
    },
    [applyRecord]
  );

  const current = state.key === key;
  return {
    records: current ? state.records : [],
    truncated: current && state.truncated,
    loading: !enabled || !current || !state.loaded,
    error: current ? state.error : null,
    pendingIds,
    refetch,
    checkFresh,
    setBusy: setPending,
    applyRecord,
    dropRecord,
    moveStage,
    undoMove,
    create,
    update,
    setOwners,
    log,
    remove,
    restore,
  };
}
