// Issue #3802 (Wave 1) — one hook for the three server-counted reads: a role
// home ("home"), the Team dashboard ("team") and Beta leads ("betaLeads").
//
// Every number these screens show comes from here, and so from the server:
// nothing is counted or typed in the page. The copy on screen belongs to the
// signed-in person; a different person never sees the previous person's.
// Nothing is kept in a store or in browser storage.
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { crmKeys } from "./useCrmConfig";
import { localToday } from "../lib/crmModel";
import * as crm from "../services/crmService";

/** How often a summary refreshes by itself while the page is visible. */
export const SUMMARY_REFRESH_MS = 60_000;

const READS = {
  home: { key: crmKeys.home, load: () => crm.fetchHomeSummary(localToday()) },
  team: { key: crmKeys.team, load: () => crm.fetchTeamSummary(localToday()) },
  betaLeads: { key: crmKeys.betaLeads, load: () => crm.listBetaLeads() },
};

/**
 * `kind`: "home" | "team" | "betaLeads". Returns
 *   { data, loading, error, refetch, patch }
 * It loads on mount and refreshes quietly when the window is focused again,
 * when the browser comes back online, and every minute while the page is
 * visible and online. A quiet refresh that fails keeps what is on screen.
 * `patch(fn)` lets a page show the server's answer to a write straight away.
 */
export function useCrmSummary(kind, { enabled = true } = {}) {
  const { access } = useAuth();
  const read = READS[kind];
  const key = read.key(access?.email);
  const [state, setState] = useState({ key, data: null, error: null, loaded: false });
  const seq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // `quiet` keeps what is on screen while the answer is on its way, and when
  // it fails.
  const load = useCallback(
    async ({ quiet = false } = {}) => {
      const mine = ++seq.current;
      try {
        const data = await read.load();
        if (!mounted.current || mine !== seq.current) return;
        setState({ key, data, error: null, loaded: true });
      } catch (error) {
        if (!mounted.current || mine !== seq.current) return;
        // A failed quiet refresh keeps what is on screen.
        if (quiet) return;
        setState({ key, data: null, error, loaded: true });
      }
    },
    [key, read]
  );

  /** Read again. Not quiet (Retry): the page shows its loading state first. */
  const refetch = useCallback(
    ({ quiet = false } = {}) => {
      if (!quiet) setState({ key, data: null, error: null, loaded: false });
      return load({ quiet });
    },
    [key, load]
  );

  useEffect(() => {
    if (!enabled) return undefined;
    // The load a page makes when it opens. Until it answers, the state on
    // hand is the initial one or another person's, and either reads as
    // "loading" below; nothing is on screen yet, so a failure is shown.
    const mine = ++seq.current;
    read.load().then(
      (data) => {
        if (mounted.current && mine === seq.current) setState({ key, data, error: null, loaded: true });
      },
      (error) => {
        if (mounted.current && mine === seq.current) setState({ key, data: null, error, loaded: true });
      }
    );
    const onFocus = () => {
      if (document.visibilityState === "visible") refetch({ quiet: true });
    };
    const onOnline = () => refetch({ quiet: true });
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("online", onOnline);
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (navigator.onLine === false) return;
      refetch({ quiet: true });
    }, SUMMARY_REFRESH_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("online", onOnline);
      clearInterval(timer);
    };
  }, [enabled, key, read, refetch]);

  const patch = useCallback(
    (fn) => {
      setState((s) => (s.key === key && s.data ? { ...s, data: fn(s.data) } : s));
    },
    [key]
  );

  // Only ever this person's copy.
  const current = state.key === key;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: !enabled || !current || !state.loaded,
    refetch,
    patch,
  };
}
