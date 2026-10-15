// Issue #3802 (Wave 4) — the signed-in person's latest 100 agent actions.
// One read per load or retry; pagination is local so equal timestamps cannot
// make a row disappear.
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { fetchMyAgentActivity } from "../services/teamAgentService";

export function useMyAgentActivity() {
  const { access } = useAuth();
  const key = `agent:activity:${access?.email || ""}`;
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
    let live = true;
    fetchMyAgentActivity(100, null).then(
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
  }, [key, attempt]);

  const retry = useCallback(() => {
    setState({ key, data: null, error: null, loaded: false });
    setAttempt((n) => n + 1);
  }, [key]);

  const current = state.key === key;
  const data = current ? state.data : null;
  return {
    calls: Array.isArray(data?.calls) ? data.calls : [],
    more: data?.more === true,
    error: current ? state.error : null,
    loading: !current || !state.loaded,
    retry,
  };
}
