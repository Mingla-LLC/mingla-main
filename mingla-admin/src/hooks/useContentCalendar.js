import { useCallback, useEffect, useRef, useState } from "react";
import * as service from "../services/contentCalendarService";

export function useContentCalendar(query) {
  const key = JSON.stringify(query || {});
  const [state, setState] = useState({ key, config: null, items: [], total: 0, loaded: false, error: null, stale: false });
  const seq = useRef(0);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  const load = useCallback(async ({ quiet = false } = {}) => {
    const mine = ++seq.current;
    if (!quiet) setState((s) => ({ ...s, key, loaded: false, error: null, stale: false }));
    try {
      const [config, data] = await Promise.all([service.fetchContentConfig(), service.listContent(query)]);
      if (!live.current || mine !== seq.current) return;
      setState({ key, config, items: Array.isArray(data?.items) ? data.items : [], total: Number(data?.total || 0), loaded: true, error: null, stale: false });
    } catch (error) {
      if (!live.current || mine !== seq.current) return;
      if (quiet) setState((s) => ({ ...s, stale: true }));
      else setState((s) => ({ ...s, key, loaded: true, error, stale: false }));
    }
  }, [key, query]);
  useEffect(() => {
    load();
    const refresh = () => { if (document.visibilityState === "visible" && navigator.onLine !== false) load({ quiet: true }); };
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  const replaceItem = useCallback((item) => setState((s) => ({ ...s, items: s.items.some((row) => row.id === item.id) ? s.items.map((row) => row.id === item.id ? item : row) : [...s.items, item] })), []);
  const removeItem = useCallback((id) => setState((s) => ({ ...s, items: s.items.filter((item) => item.id !== id), total: Math.max(0, s.total - 1) })), []);
  return { ...state, loading: state.key !== key || !state.loaded, refetch: load, replaceItem, removeItem };
}
