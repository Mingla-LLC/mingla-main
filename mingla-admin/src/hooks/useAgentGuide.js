// Issue #3802 (Wave 4) — the shared, signed-in-person guide cache. It is
// independent from key polling: a guide failure never disables key controls,
// and prompt strips never load key inventory.
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { validAgentGuide } from "../lib/agentPrompts";
import { fetchAgentGuide } from "../services/teamAgentService";

let cache = { key: null, data: null, promise: null };

function readGuide(key) {
  if (cache.key === key && cache.data) return Promise.resolve(cache.data);
  if (cache.key === key && cache.promise) return cache.promise;
  const promise = fetchAgentGuide().then((data) => {
    if (!validAgentGuide(data)) {
      const error = new Error("The guide answer was incomplete.");
      error.token = "unknown";
      throw error;
    }
    if (cache.key === key && cache.promise === promise) cache = { key, data, promise: null };
    return data;
  });
  cache = { key, data: null, promise };
  promise.catch(() => {
    if (cache.key === key && cache.promise === promise) cache = { key: null, data: null, promise: null };
  });
  return promise;
}

export function useAgentGuide() {
  const { access } = useAuth();
  const key = `agent:guide:${access?.email || ""}`;
  const cached = cache.key === key ? cache.data : null;
  const [state, setState] = useState({ key, data: cached, error: null, loaded: !!cached });
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  const autoRetried = useRef(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    readGuide(key).then(
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
    if (cache.key === key) cache = { key: null, data: null, promise: null };
    setState({ key, data: null, error: null, loaded: false });
    setAttempt((n) => n + 1);
  }, [key]);

  const current = state.key === key;
  const error = current ? state.error : null;
  useEffect(() => {
    if (!error) return undefined;
    const onOnline = () => {
      if (autoRetried.current === key) return;
      autoRetried.current = key;
      retry();
    };
    window.addEventListener("online", onOnline, { once: true });
    return () => window.removeEventListener("online", onOnline);
  }, [error, key, retry]);

  return {
    data: current ? state.data : null,
    error,
    loading: !current || !state.loaded,
    retry,
  };
}
