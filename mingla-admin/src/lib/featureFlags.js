import { supabase } from './supabase';

// ORCH-0553: added 'enable_refresh_tab' — gates Refresh tab + (on AIValidation) extracted Seeding tab.
const KNOWN_FLAGS = ['enable_rules_filter_tab', 'enable_refresh_tab'];

let cache = null;
let inflight = null;

// Reads admin_config flags via admin_get_feature_flags() SECURITY DEFINER RPC.
// RPC gate: active row in admin_users for the caller's auth.email(). Non-admins
// get a Postgres error, which we convert to all-false so the UI renders its
// flag-off state gracefully rather than crashing.
export async function loadFeatureFlags() {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { data, error } = await supabase.rpc('admin_get_feature_flags', {
        p_keys: KNOWN_FLAGS,
      });
      if (error) throw error;
      const flags = data && typeof data === 'object' ? data : {};
      cache = Object.fromEntries(
        KNOWN_FLAGS.map((k) => {
          const v = flags[k];
          return [k, v === true || v === 'true' || v === '"true"'];
        })
      );
      return cache;
    } catch (err) {
      console.warn('[featureFlags] read failed, defaulting all flags to false:', err.message);
      cache = Object.fromEntries(KNOWN_FLAGS.map((k) => [k, false]));
      return cache;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export async function isFlagEnabled(key) {
  const flags = await loadFeatureFlags();
  return !!flags[key];
}

export function clearFlagCache() {
  cache = null;
  inflight = null;
}
