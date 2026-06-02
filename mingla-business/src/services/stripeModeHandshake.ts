/**
 * Stripe mode boot handshake (ORCH-1056) — mingla-business.
 *
 * On app boot, call the public `stripe-mode` Supabase edge fn and verify
 * that the backend's mode matches the publishable key bundled in this app.
 * If they disagree, throw a fatal error so the global ErrorBoundary surfaces
 * the misconfiguration instead of letting users hit a silently-collapsed
 * Stripe Connect iframe (the 2026-06-02 incident this ORCH was created to
 * eliminate — see commit history `77f1b8219..8cd547a9a`).
 *
 * Stripe docs:
 *   - https://docs.stripe.com/keys (publishable key prefixes)
 *
 * Failure modes:
 *   - Backend unreachable / non-200 → soft-warn, do NOT throw. The handshake
 *     is best-effort: the app should still function offline, and the bundled
 *     pk's prefix is itself authoritative against the rk used per-request.
 *   - Backend returns mode + prefix that match bundled pk → silently succeed.
 *   - Backend returns mode that DISAGREES with bundled pk's prefix → throw
 *     `StripeModeMismatchError`. ErrorBoundary catches it.
 */

import Constants from "expo-constants";

export class StripeModeMismatchError extends Error {
  readonly backendMode: "test" | "live";
  readonly backendPublishablePrefix: "pk_test_" | "pk_live_";
  readonly bundledPublishablePrefix: string;
  constructor(
    backendMode: "test" | "live",
    backendPublishablePrefix: "pk_test_" | "pk_live_",
    bundledPublishablePrefix: string,
  ) {
    super(
      `Stripe mode drift detected. Supabase backend is in ${backendMode} mode ` +
        `(expects ${backendPublishablePrefix} on the client), but the app was ` +
        `built with a ${bundledPublishablePrefix} publishable key. ` +
        `This will silently break Stripe Connect embedded components. ` +
        `Open /admin/stripe-mode to verify alignment and follow ` +
        `STRIPE_MODE_FLIP_RUNBOOK.md.`,
    );
    this.name = "StripeModeMismatchError";
    this.backendMode = backendMode;
    this.backendPublishablePrefix = backendPublishablePrefix;
    this.bundledPublishablePrefix = bundledPublishablePrefix;
  }
}

interface StripeModeResponse {
  mode: "test" | "live";
  publishablePrefix: "pk_test_" | "pk_live_";
}

let cachedHandshake: Promise<StripeModeResponse | null> | null = null;

function readBundledPublishableKey(): string | undefined {
  const fromExtra = (Constants.expoConfig?.extra as
    | Record<string, string>
    | undefined)?.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const fromProcessEnv = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  return fromExtra ?? fromProcessEnv;
}

function readSupabaseUrl(): string | undefined {
  const fromExtra = (Constants.expoConfig?.extra as
    | Record<string, string>
    | undefined)?.EXPO_PUBLIC_SUPABASE_URL;
  const fromProcessEnv = process.env.EXPO_PUBLIC_SUPABASE_URL;
  return fromExtra ?? fromProcessEnv;
}

function readSupabaseAnonKey(): string | undefined {
  const fromExtra = (Constants.expoConfig?.extra as
    | Record<string, string>
    | undefined)?.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const fromProcessEnv = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  return fromExtra ?? fromProcessEnv;
}

/**
 * Fetch the backend's declared Stripe mode. Returns null on transport
 * failure so callers can treat that as soft-warn (offline-friendly).
 */
async function fetchBackendStripeMode(): Promise<StripeModeResponse | null> {
  const supabaseUrl = readSupabaseUrl();
  if (!supabaseUrl) {
    console.warn(
      "[stripeModeHandshake] EXPO_PUBLIC_SUPABASE_URL unset — skipping handshake.",
    );
    return null;
  }
  const supabaseAnonKey = readSupabaseAnonKey();
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (supabaseAnonKey) {
      headers.apikey = supabaseAnonKey;
      headers.Authorization = `Bearer ${supabaseAnonKey}`;
    }
    const res = await fetch(`${supabaseUrl}/functions/v1/stripe-mode`, {
      method: "GET",
      headers,
    });
    if (!res.ok) {
      console.warn(
        `[stripeModeHandshake] backend returned ${res.status} — skipping.`,
      );
      return null;
    }
    const body = await res.json();
    if (
      typeof body?.mode !== "string" ||
      (body.mode !== "test" && body.mode !== "live") ||
      typeof body?.publishablePrefix !== "string" ||
      (body.publishablePrefix !== "pk_test_" &&
        body.publishablePrefix !== "pk_live_")
    ) {
      console.warn(
        "[stripeModeHandshake] backend response shape unexpected:",
        body,
      );
      return null;
    }
    return {
      mode: body.mode,
      publishablePrefix: body.publishablePrefix,
    };
  } catch (err) {
    console.warn(
      "[stripeModeHandshake] fetch threw — skipping handshake:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Perform the boot handshake. Idempotent — caches the result per session so
 * remounts/HMR don't re-fire the network call.
 *
 * Returns the backend response on success (handshake matched OR unreachable).
 * Throws `StripeModeMismatchError` only when backend responded AND its mode
 * disagrees with the bundled pk's prefix.
 */
export async function verifyStripeModeAlignment(): Promise<
  StripeModeResponse | null
> {
  if (cachedHandshake) return cachedHandshake;
  cachedHandshake = (async () => {
    const bundledPk = readBundledPublishableKey();
    if (!bundledPk) {
      console.warn(
        "[stripeModeHandshake] EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY unset — skipping handshake.",
      );
      return null;
    }
    const backend = await fetchBackendStripeMode();
    if (backend === null) return null;
    const bundledPrefix = bundledPk.startsWith("pk_live_")
      ? "pk_live_"
      : bundledPk.startsWith("pk_test_")
      ? "pk_test_"
      : bundledPk.slice(0, 8);
    if (backend.publishablePrefix !== bundledPrefix) {
      throw new StripeModeMismatchError(
        backend.mode,
        backend.publishablePrefix,
        bundledPrefix,
      );
    }
    return backend;
  })();
  return cachedHandshake;
}

/**
 * Test-only — clear the memoized handshake. Do not call from app code.
 */
export function __resetStripeModeHandshakeCacheForTests(): void {
  cachedHandshake = null;
}
