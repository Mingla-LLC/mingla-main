// Issue #3802 (Wave 1) — the lists the Hosts and Creators boards are built
// from (stages, ICPs, channels, regions, teammates), loaded once per signed-in
// person and shared by every screen that needs them.
//
// The cache is keyed by the signed-in person: a different person, or a sign
// out, never sees the previous person's copy.
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { fetchConfig } from "../services/crmService";

/**
 * One key per entity; nothing else names these caches. `config` keys the
 * shared configuration cache below; `records` keys the list a pipeline page
 * holds (hooks/useCrmPipeline.js), so one person's list is never shown to the
 * next person who signs in on the same browser.
 */
export const crmKeys = {
  config: (email) => `crm:config:${email || ""}`,
  records: (email, pipeline) => `crm:records:${email || ""}:${pipeline}`,
};

let cache = { key: null, promise: null };

function loadConfig(key) {
  if (cache.key !== key || !cache.promise) {
    const promise = fetchConfig();
    cache = { key, promise };
    // A failed load is not remembered: the next ask tries again.
    promise.catch(() => {
      if (cache.promise === promise) cache = { key: null, promise: null };
    });
  }
  return cache.promise;
}

export function useCrmConfig() {
  const { access } = useAuth();
  const key = crmKeys.config(access?.email);
  const [state, setState] = useState({ key: null, config: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    loadConfig(key).then(
      (config) => {
        if (live) setState({ key, config, error: null });
      },
      (error) => {
        if (live) setState({ key, config: null, error });
      }
    );
    return () => {
      live = false;
    };
  }, [key, attempt]);

  const retry = useCallback(() => {
    cache = { key: null, promise: null };
    setState({ key: null, config: null, error: null });
    setAttempt((n) => n + 1);
  }, []);

  const current = state.key === key;
  return {
    config: current ? state.config : null,
    error: current ? state.error : null,
    loading: !current || (!state.config && !state.error),
    retry,
  };
}
