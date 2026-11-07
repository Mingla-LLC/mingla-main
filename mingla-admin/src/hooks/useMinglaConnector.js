// Issue #4294 — what the My agent "Claude app" card and the Company tools
// page read. Nothing is kept in a store or in browser storage; a company key
// never passes through here (it goes straight from its form to the server).
import { useCallback, useEffect, useRef, useState } from "react";
import { listCompanyTools, listConnections, recentCompanyToolCalls } from "../services/minglaConnectorService";

/** { data, error, loading, refetch } for one read. A failed read is never shown as empty. */
function useRead(load, enabled = true) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const seq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const data = await load();
      if (mounted.current && mine === seq.current) setState({ data, error: null, loading: false });
      return data;
    } catch (error) {
      if (mounted.current && mine === seq.current) setState({ data: null, error, loading: false });
      return null;
    }
  }, [load]);
  // Retry: the loading state first, then the answer.
  const refetch = useCallback(() => {
    if (!enabled) return Promise.resolve(null);
    setState((s) => ({ ...s, loading: true, error: null }));
    return run();
  }, [enabled, run]);
  useEffect(() => {
    if (!enabled) return;
    const mine = ++seq.current;
    load().then(
      (data) => {
        if (mounted.current && mine === seq.current) setState({ data, error: null, loading: false });
      },
      (error) => {
        if (mounted.current && mine === seq.current) setState({ data: null, error, loading: false });
      },
    );
  }, [enabled, load]);
  return { ...state, refetch };
}

/** The signed-in person's Claude app connections. */
export function useClaudeConnections() {
  const read = useRead(listConnections);
  const rows = Array.isArray(read.data?.connections) ? read.data.connections : [];
  return { ...read, rows };
}

/** Owner only: the company tools and the latest calls. */
export function useCompanyTools(isOwner) {
  const tools = useRead(listCompanyTools, isOwner);
  const loadCalls = useCallback(() => recentCompanyToolCalls(20), []);
  const calls = useRead(loadCalls, isOwner);
  return {
    rows: Array.isArray(tools.data?.rows) ? tools.data.rows : [],
    loading: tools.loading,
    error: tools.error,
    refetch: tools.refetch,
    calls: Array.isArray(calls.data?.calls) ? calls.data.calls : [],
    callsLoading: calls.loading,
    callsError: calls.error,
    refetchCalls: calls.refetch,
  };
}
