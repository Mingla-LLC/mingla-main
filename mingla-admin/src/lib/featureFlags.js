import { supabase } from './supabase';

const KNOWN_FLAGS = ['enable_rules_filter_tab'];

let cache = null;
let inflight = null;

// [TRANSITIONAL] Reads admin_config directly. Current RLS only allows service_role,
// so every authenticated-user attempt 401s and we fall back to all-false. That IS
// the correct production state today (flag = false). M3.4 adds admin_get_feature_flags()
// SECURITY DEFINER RPC; once that ships, switch this to call the RPC and remove the
// fallback. Exit condition: ORCH-0526 M4 flag-flip dispatch lands.
export async function loadFeatureFlags() {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const { data, error } = await supabase
        .from('admin_config')
        .select('key, value')
        .in('key', KNOWN_FLAGS);
      if (error) throw error;
      cache = Object.fromEntries(
        KNOWN_FLAGS.map((k) => {
          const row = (data || []).find((r) => r.key === k);
          if (!row) return [k, false];
          const v = row.value;
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
