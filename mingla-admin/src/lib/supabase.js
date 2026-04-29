import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Log prominently but don't throw — let ErrorBoundary handle it
  console.error(
    "[Mingla Admin] Missing Supabase environment variables.\n" +
    "Copy .env.example to .env and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
  );
}

export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder-key",
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);

export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_ANON_KEY = supabaseAnonKey;

// ── invokeWithRefresh — ORCH-0541 ────────────────────────────────────────────

const SESSION_REFRESH_BUFFER_MS = 60_000;

/**
 * Safely invoke a Supabase edge function through session boundaries.
 *
 * Supabase JWTs expire after 1h by default. autoRefreshToken works best in an
 * active tab; an idle tab can race-lose the refresh and send a stale Bearer,
 * which edge functions reject with 401. RPCs tend to survive longer because
 * PostgREST handles some session refresh on its own path.
 *
 * This helper:
 *   - pre-checks session expiry, refreshes if within 60s of expiring
 *   - on 401, tries ONE refresh + retry before surfacing the error
 *   - returns { data, error } identical to supabase.functions.invoke
 *
 * Use this instead of supabase.functions.invoke anywhere an admin might
 * leave a tab idle long enough for the session to age out.
 */
export async function invokeWithRefresh(functionName, options = {}) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.expires_at) {
      const expiresMs = session.expires_at * 1000;
      const timeLeft = expiresMs - Date.now();
      if (timeLeft < SESSION_REFRESH_BUFFER_MS) {
        await supabase.auth.refreshSession();
      }
    }
  } catch (err) {
    console.warn("[invokeWithRefresh] pre-refresh check failed:", err?.message);
  }

  let result = await supabase.functions.invoke(functionName, options);

  const status = result?.error?.context?.status ?? result?.error?.status;
  if (status === 401) {
    try {
      await supabase.auth.refreshSession();
      result = await supabase.functions.invoke(functionName, options);
    } catch (err) {
      console.warn("[invokeWithRefresh] 401 retry refresh failed:", err?.message);
    }
  }

  return result;
}
