// Issue #3802 (Wave 4) — owner-only connection status, loaded independently
// from the Team and roles roster so status trouble never hides access controls.
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { fetchKeysOverview } from "../services/teamAgentService";

export function useTeamAgentOverview() {
  const { access } = useAuth();
  const enabled = access?.role === "owner";
  const key = `agent:overview:${access?.email || ""}`;
  const [state, setState] = useState({ key, data: null, error: null, loaded: false });
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    fetchKeysOverview().then(
      (data) => {
        if (live && mounted.current) setState({ key, data, error: null, loaded: true });
      },
      (error) => {
        if (live && mounted.current) setState({ key, data: null, error, loaded: true });
      }
    );
    return () => {
      live = false;
    };
  }, [enabled, key, attempt]);

  const retry = useCallback(() => {
    if (!enabled) return;
    setState({ key, data: null, error: null, loaded: false });
    setAttempt((n) => n + 1);
  }, [enabled, key]);

  const current = state.key === key;
  return {
    data: enabled && current ? state.data : null,
    error: enabled && current ? state.error : null,
    loading: enabled && (!current || !state.loaded),
    retry,
  };
}
