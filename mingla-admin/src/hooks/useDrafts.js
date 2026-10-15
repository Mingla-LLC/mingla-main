import { useCallback, useEffect, useRef, useState } from "react";
import * as service from "../services/draftService";
import { announceDraftMutation } from "./useDraftCounts";

function changedDraft(a, b) {
  return a?.updated_at !== b?.updated_at || a?.body !== b?.body || a?.subject !== b?.subject || a?.state !== b?.state;
}

export function useDrafts({ state = "waiting", recordId = null, draftId = null, paused = false, protectedIds = null } = {}) {
  const key = `${state}:${recordId || ""}:${draftId || ""}`;
  const [snapshot, setSnapshot] = useState({ key, drafts: [], total: 0, nextCursor: null, loaded: false, error: null, stale: false, moreError: null });
  const [mutationActions, setMutationActions] = useState(() => new Map());
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState("");
  const seq = useRef(0);
  const pausedRef = useRef(paused);
  const snapshotRef = useRef(snapshot);
  const protectedRef = useRef(protectedIds || new Set());
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);
  useEffect(() => { protectedRef.current = protectedIds || new Set(); }, [protectedIds]);

  const load = useCallback(async ({ quiet = false, more = false, announce = false, ignoreProtectedIds = [] } = {}) => {
    const mine = ++seq.current;
    if (!quiet && !more) {
      setNotice("");
      setSnapshot((s) => ({ ...s, key, loaded: false, error: null, stale: false, moreError: null }));
    }
    if (more) { setLoadingMore(true); setSnapshot((s) => ({ ...s, moreError: null })); }
    try {
      const before = more && snapshotRef.current.key === key ? snapshotRef.current.nextCursor : null;
      let data = await service.listDrafts({ state, ...(recordId ? { record_id: recordId } : {}), limit: draftId ? 100 : 50, ...(before ? { cursor: before } : {}) });
      if (draftId) {
        const total = Number(data?.total || 0);
        let found = Array.isArray(data?.drafts) ? data.drafts.find((draft) => draft.id === draftId) : null;
        let cursor = data?.next_cursor || null;
        while (!found && cursor) {
          data = await service.listDrafts({ state, limit: 100, cursor });
          found = Array.isArray(data?.drafts) ? data.drafts.find((draft) => draft.id === draftId) : null;
          cursor = data?.next_cursor || null;
        }
        data = { ...data, drafts: found ? [found] : [], total, next_cursor: null };
      }
      if (mine !== seq.current) return;
      let rows = Array.isArray(data?.drafts) ? data.drafts : [];
      if (quiet && announce && snapshotRef.current.key === key && snapshotRef.current.nextCursor == null) {
        const previous = snapshotRef.current.drafts;
        const clean = (draft) => !protectedRef.current.has(draft.id) && !ignoreProtectedIds.includes(draft.id);
        const removed = previous.find((draft) => clean(draft) && !rows.some((row) => row.id === draft.id));
        const updated = rows.find((row) => {
          const local = previous.find((draft) => draft.id === row.id);
          return local && clean(local) && changedDraft(local, row);
        });
        if (removed) setNotice("Draft no longer waiting.");
        else if (updated) setNotice(`Draft updated by ${updated.created_via === "claude" ? "Claude" : "Codex"}.`);
      }
      setSnapshot((s) => ({
        key,
        drafts: more && s.key === key ? [...s.drafts, ...rows] : quiet && s.key === key
          ? rows.map((row) => {
              const local = s.drafts.find((item) => item.id === row.id);
              return local && protectedRef.current.has(row.id) && !ignoreProtectedIds.includes(row.id) && changedDraft(local, row)
                ? { ...local, serverDraft: row }
                : row;
            }).concat(s.drafts.filter((local) => protectedRef.current.has(local.id) && !ignoreProtectedIds.includes(local.id) && !rows.some((row) => row.id === local.id)).map((local) => ({ ...local, withdrawn: true })))
          : rows,
        total: Number(data?.total || 0),
        nextCursor: data?.next_cursor || null,
        loaded: true,
        error: null,
        stale: false,
        moreError: null,
      }));
    } catch (error) {
      if (mine !== seq.current) return;
      if (more) setSnapshot((s) => ({ ...s, moreError: error }));
      else if (quiet) setSnapshot((s) => ({ ...s, stale: true }));
      else setSnapshot({ key, drafts: [], total: 0, nextCursor: null, loaded: true, error, stale: false, moreError: null });
    } finally {
      if (more && mine === seq.current) setLoadingMore(false);
    }
  }, [draftId, key, recordId, state]);

  useEffect(() => {
    load();
    const refresh = () => {
      if (!pausedRef.current && mutationActions.size === 0 && document.visibilityState === "visible" && navigator.onLine !== false) load({ quiet: true, announce: true });
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, 30_000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(timer);
    };
  }, [key, load, mutationActions.size]);

  const mutate = useCallback(async (id, run, action = "updating") => {
    setMutationActions((actions) => new Map(actions).set(id, action));
    try {
      const answer = await run();
      announceDraftMutation();
      await load({ quiet: true, ignoreProtectedIds: [id] });
      return answer;
    } finally {
      setMutationActions((actions) => { const next = new Map(actions); next.delete(id); return next; });
    }
  }, [load]);

  const acceptRemote = useCallback((id) => {
    setSnapshot((current) => ({ ...current, drafts: current.drafts.map((draft) => draft.id === id && draft.serverDraft ? draft.serverDraft : draft) }));
  }, []);

  return { ...snapshot, notice, loading: snapshot.key !== key || !snapshot.loaded, loadingMore, mutationIds: new Set(mutationActions.keys()), mutationActions, refetch: load, loadMore: () => load({ more: true }), mutate, acceptRemote };
}

export function useRecordDraftCount(recordId) {
  const [count, setCount] = useState(null);
  useEffect(() => {
    if (!recordId) return undefined;
    let live = true;
    const load = async () => {
      try {
        const data = await service.listDrafts({ state: "waiting", record_id: recordId, limit: 1 });
        if (live) setCount(Number(data?.total || 0));
      } catch { if (live) setCount(null); }
    };
    const refresh = () => { if (document.visibilityState === "visible" && navigator.onLine !== false) load(); };
    load();
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("mingla:drafts-changed", refresh);
    return () => {
      live = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("mingla:drafts-changed", refresh);
    };
  }, [recordId]);
  return count;
}
