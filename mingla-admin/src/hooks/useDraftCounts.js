import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import * as drafts from "../services/draftService";

export const DRAFT_REFRESH_MS = 30_000;
const DraftCountContext = createContext(null);
const listeners = new Set();

export function announceDraftMutation() {
  for (const listener of listeners) listener();
  if (typeof window !== "undefined") window.dispatchEvent(new Event("mingla:drafts-changed"));
}

export function useDraftCounts({ enabled = true } = {}) {
  const { access } = useAuth();
  const key = access?.email || "";
  const [state, setState] = useState({ key, data: null, error: null, loaded: false });
  const seq = useRef(0);
  const pending = useRef("");
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!enabled || pending.current === key) return;
    pending.current = key;
    const mine = ++seq.current;
    try {
      const data = await drafts.fetchDraftCounts();
      if (mine === seq.current) setState({ key, data, error: null, loaded: true });
    } catch (error) {
      if (mine === seq.current && !quiet) setState({ key, data: null, error, loaded: true });
    } finally {
      if (pending.current === key) pending.current = "";
    }
  }, [enabled, key]);

  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const refresh = () => {
      if (document.visibilityState === "visible" && navigator.onLine !== false) load({ quiet: true });
    };
    listeners.add(refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, DRAFT_REFRESH_MS);
    return () => {
      listeners.delete(refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(timer);
    };
  }, [enabled, load]);

  const current = state.key === key;
  return { data: current ? state.data : null, error: current ? state.error : null, loading: !current || !state.loaded, refetch: load };
}

export function DraftCountProvider({ value, children }) {
  return createElement(DraftCountContext.Provider, { value }, children);
}

export function useDraftCountValue() {
  return useContext(DraftCountContext) || { data: null, error: null, loading: true, refetch: () => {} };
}
