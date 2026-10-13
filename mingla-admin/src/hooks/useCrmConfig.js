// Issue #3802 (Wave 1) — the lists the Hosts and Creators boards are built
// from (stages, ICPs, channels, regions, teammates), loaded once per signed-in
// person and shared by every screen that needs them.
//
// The cache is keyed by the signed-in person: a different person, or a sign
// out, never sees the previous person's copy.
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { fetchConfig } from "../services/crmService";

/** A summary key for one person: the same shape as the two keys below. */
function summaryKey(kind, email) {
  return ["crm", kind, email || ""].join(":");
}

/**
 * One key per entity; nothing else names these caches. `config` keys the
 * shared configuration cache below; `records` keys the list a pipeline page
 * holds (hooks/useCrmPipeline.js), so one person's list is never shown to the
 * next person who signs in on the same browser. `home`, `team` and
 * `betaLeads` key what hooks/useCrmSummary.js holds for a role home, the Team
 * dashboard and the Beta leads page.
 */
export const crmKeys = {
  config: (email) => `crm:config:${email || ""}`,
  records: (email, pipeline) => `crm:records:${email || ""}:${pipeline}`,
  home: (email) => summaryKey("home", email),
  team: (email) => summaryKey("team", email),
  betaLeads: (email) => summaryKey("beta-leads", email),
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
