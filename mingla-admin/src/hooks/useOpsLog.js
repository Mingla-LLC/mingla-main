// Issue #3980 — the agent log feed and open claims, refreshed every 15 seconds.
import { useCallback, useState } from "react";
import { useAuth } from "../context/AuthContext";
import * as ops from "../services/opsService";
import { useOpsPoll } from "./useOpsWork";

export function useOpsLog({ who = "all" } = {}) {
  const { access } = useAuth();
  const poll = useOpsPoll(() => ops.listLog({ who, limit: 50 }), { key: `${access?.email || ""}|${who}`, intervalMs: 15_000 });
  const [older, setOlder] = useState({ key: "", entries: [], next: null, loading: false, error: null });
  const key = `${access?.email || ""}|${who}`;
  const current = older.key === key ? older : { key, entries: [], next: undefined, loading: false, error: null };
  const nextBefore = current.next === undefined ? poll.data?.next_before_id ?? null : current.next;
  const loadMore = useCallback(async () => {
    if (!nextBefore) return;
    setOlder((prev) => ({ ...(prev.key === key ? prev : { key, entries: [], next: undefined }), loading: true, error: null }));
    try {
      const page = await ops.listLog({ who, limit: 50, before_id: nextBefore });
      setOlder((prev) => ({ key, entries: [...(prev.key === key ? prev.entries : []), ...(page?.entries || [])], next: page?.next_before_id ?? null, loading: false, error: null }));
    } catch (error) {
      setOlder((prev) => ({ ...prev, key, loading: false, error }));
    }
  }, [key, nextBefore, who]);
  return { ...poll, older: current.entries, nextBefore, loadMore, loadingMore: current.loading, moreError: current.error };
}
