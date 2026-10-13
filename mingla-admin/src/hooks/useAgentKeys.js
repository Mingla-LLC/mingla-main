// Issue #3802 (Wave 4) — what the My agent page reads: this person's keys
// (never a key itself), what an agent is told, and, for the owner, who has an
// agent connected.
//
// The copy on screen belongs to the signed-in person; a different person
// never sees the previous person's. Nothing is kept in a store or in browser
// storage, and a key is never held here: the page holds the one it was just
// given, in memory, until the person says Done or leaves.
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import * as agent from "../services/teamAgentService";

/** How often the page refreshes by itself while it is visible ("last used"). */
export const AGENT_REFRESH_MS = 30_000;

const keyFor = (email) => `agent:keys:${email || ""}`;

async function loadAll(isOwner) {
  const [mine, guide, overview] = await Promise.all([
    agent.listMyKeys(),
    // The guide is not needed to manage a key: if it cannot be read, the page
    // still works and simply says less.
    agent.fetchAgentGuide().catch(() => null),
    isOwner ? agent.fetchKeysOverview().catch(() => null) : Promise.resolve(null),
  ]);
  return { mine, guide, overview };
}

/**
 * Returns { keys, idleDays, guide, overview, loading, error, refetch }.
 * Loads on mount; refreshes quietly when the window is focused again, when
 * the browser comes back online, and every 30 seconds while the page is
 * visible and online. A quiet refresh that fails keeps what is on screen.
 */
export function useAgentKeys() {
  const { access } = useAuth();
  const isOwner = access?.role === "owner";
  const key = keyFor(access?.email);
  const [state, setState] = useState({ key, data: null, error: null, loaded: false });
  const seq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      const mine = ++seq.current;
      try {
        const data = await loadAll(isOwner);
        if (!mounted.current || mine !== seq.current) return;
        setState({ key, data, error: null, loaded: true });
      } catch (error) {
        if (!mounted.current || mine !== seq.current) return;
        if (quiet) return;
        setState({ key, data: null, error, loaded: true });
      }
    },
    [key, isOwner]
  );

  /** Read again. Not quiet (Try again): the page shows its loading state first. */
  const refetch = useCallback(
    ({ quiet = false } = {}) => {
      if (!quiet) setState({ key, data: null, error: null, loaded: false });
      return load({ quiet });
    },
    [key, load]
  );

  useEffect(() => {
    const mine = ++seq.current;
    loadAll(isOwner).then(
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
    }, AGENT_REFRESH_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("online", onOnline);
      clearInterval(timer);
    };
  }, [key, isOwner, refetch]);

  const current = state.key === key;
  const data = current ? state.data : null;
  return {
    keys: Array.isArray(data?.mine?.keys) ? data.mine.keys : [],
    idleDays: Number.isFinite(data?.mine?.idle_days) ? data.mine.idle_days : 90,
    guide: data?.guide || null,
    overview: data?.overview || null,
    isOwner,
    error: current ? state.error : null,
    loading: !current || !state.loaded,
    refetch,
  };
}
