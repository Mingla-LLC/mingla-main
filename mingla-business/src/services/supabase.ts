// ORCH-1100 Wave 1A — `navigatorLock` is re-exported by @supabase/supabase-js
// from @supabase/auth-js (supabase-js index: `export * from "@supabase/auth-js"`).
// Imported from the direct dependency (supabase-js), not the transitive auth-js.
import { createClient, navigatorLock } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";

const extra = Constants.expoConfig?.extra as Record<string, string | undefined> | undefined;

const supabaseUrl =
  extra?.EXPO_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  "";

const supabaseAnonKey =
  extra?.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[mingla-business] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY missing — auth will fail until set in .env and app.config."
  );
}

// SSR-safe storage adapter. Expo Router 6 renders pages in Node during the
// web bundle pass — AsyncStorage's web shim assumes `window.localStorage`,
// so it crashes when `window` is undefined. The no-op fallback lets the
// Supabase client initialise without persistence during SSR; once the
// browser hydrates, `window` exists and AsyncStorage's localStorage shim
// works normally. On iOS/Android, `window` is provided by React Native, so
// AsyncStorage is used as before.
const ssrSafeStorage = {
  getItem: async (_key: string): Promise<string | null> => null,
  setItem: async (_key: string, _value: string): Promise<void> => undefined,
  removeItem: async (_key: string): Promise<void> => undefined,
};

const storage = typeof window === "undefined" ? ssrSafeStorage : AsyncStorage;

// ORCH-1100 Wave 1A (RC-1) — web auth-lock resilience.
//
// supabase-js coordinates session reads/refreshes across tabs with the Web Locks
// API (`navigatorLock`) on web. With many same-origin business tabs open, the
// per-origin lock `lock:sb-…-auth-token` gets orphaned (a tab unmounts mid-hold,
// React Strict Mode double-mount, or a hung storage call), and a fresh load's
// `getSession()` waits on it. The library's default `lockAcquireTimeout` is
// 5000ms — LONGER than our 3s auth bootstrap timeout (AUTH_BOOTSTRAP_TIMEOUT_MS
// in AuthContext.tsx) — so bootstrap gives up BEFORE the lock self-heals, the
// auth-gated brand-load chain never fires, and the app renders the no-brand
// degraded shell (2-tab nav + "Create brand"). The orphaned-lock recovery also
// surfaced as a raw `AbortError: Lock broken … steal` on /event/{id}/group-chat.
//
// Docs (auth-js GoTrueClientOptions, node_modules/@supabase/auth-js/.../types.d.ts):
//   - `lock?: LockFunc` — "Provide your own locking mechanism based on the
//     environment. By default, `navigatorLock` (Web Locks API) is used in browser
//     environments when `persistSession` is true."
//   - `LockFunc = (name, acquireTimeout, fn) => Promise<R>`; a positive
//     `acquireTimeout` "should throw an Error with an `isAcquireTimeout` property
//     set to true if the operation fails to be acquired after this much time (ms)".
//   - `navigatorLock` recovers an orphaned lock by stealing it after the
//     acquireTimeout; the EVICTED holder is rejected with a
//     `NavigatorLockAcquireTimeoutError` (isAcquireTimeout === true).
//
// Fix (WEB ONLY): wrap `navigatorLock` with a bounded acquire timeout SHORTER
// than the 3s bootstrap timeout, so an orphaned lock is stolen/recovered while
// bootstrap is still waiting → `getSession()` resolves → the brand chain fires.
// Swallow the benign "stolen from us" recovery rejection (and the
// LockManager-unavailable case) by running `fn` lock-free instead of letting it
// bubble as an uncaught AbortError. Native (iOS/Android) does NOT set `lock`, so
// it keeps supabase-js's default in-process `processLock` behaviour BYTE-FOR-BYTE
// — this config is gated to `Platform.OS === "web"`.
const WEB_LOCK_ACQUIRE_TIMEOUT_MS = 2300; // < AUTH_BOOTSTRAP_TIMEOUT_MS (3000)

const isAcquireTimeoutError = (error: unknown): boolean =>
  error !== null &&
  typeof error === "object" &&
  (error as { isAcquireTimeout?: unknown }).isAcquireTimeout === true;

async function webResilientLock<R>(
  name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> {
  // No LockManager (older browser / SSR) → run lock-free; cross-tab races are
  // acceptable here vs. a hard hang. supabase-js makes the same fallback choice.
  if (
    typeof globalThis === "undefined" ||
    typeof (globalThis as { navigator?: { locks?: unknown } }).navigator ===
      "undefined" ||
    typeof (globalThis as { navigator?: { locks?: unknown } }).navigator
      ?.locks === "undefined"
  ) {
    return fn();
  }
  try {
    // Ignore the caller's acquireTimeout (default 5000) — clamp to our bounded
    // value so an orphaned lock self-heals before the 3s bootstrap timeout.
    return await navigatorLock(name, WEB_LOCK_ACQUIRE_TIMEOUT_MS, fn);
  } catch (error) {
    // A bounded acquire that timed out means the lock was orphaned and stolen,
    // OR our held lock was stolen by another tab's recovery. Either way the auth
    // operation is safe to run without the cross-tab lock rather than crash the
    // surface with a raw AbortError. Re-throw anything that is NOT a lock-timeout.
    if (isAcquireTimeoutError(error)) {
      return fn();
    }
    throw error;
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    // Cycle 0b: enable URL-hash session detection on web only. The OAuth
    // redirect flow returns the session as a URL fragment (#access_token=…)
    // which Supabase auto-extracts, finalises, then clears from history.
    // Native iOS/Android use ID-token flow, no URL fragment — keep false.
    detectSessionInUrl: Platform.OS === "web",
    // ORCH-1100 Wave 1A (RC-1) — web-only bounded auth lock (see above).
    // Native omits `lock` entirely → default behaviour unchanged.
    ...(Platform.OS === "web" ? { lock: webResilientLock } : {}),
  },
});
