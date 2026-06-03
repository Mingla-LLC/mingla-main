/**
 * Stripe mode boot handshake (ORCH-1056) — app-mobile (consumer).
 *
 * On app boot, call the public `stripe-mode` Supabase edge fn and verify
 * that the backend's mode matches the publishable key bundled into this app.
 * If they disagree, throw a fatal error so Sentry captures + the user sees
 * the misconfiguration instead of letting Stripe PaymentSheet fail later
 * with an opaque "Could not load" error.
 *
 * Soft-warn on transport failure so offline boot still works.
 *
 * Stripe docs:
 *   - https://docs.stripe.com/keys (publishable key prefixes)
 */

import Constants from "expo-constants";
import { supabaseUrl } from "./supabase";

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
        `Stripe PaymentSheet will silently fail. See ` +
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

async function fetchBackendStripeMode(): Promise<StripeModeResponse | null> {
  if (!supabaseUrl) {
    console.warn(
      "[stripeModeHandshake] supabaseUrl unset — skipping handshake.",
    );
    return null;
  }
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/stripe-mode`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
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

/** Test-only — clear the memoized handshake. */
export function __resetStripeModeHandshakeCacheForTests(): void {
  cachedHandshake = null;
}
