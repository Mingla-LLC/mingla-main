// Issue #1931 — shared released-set authority for the Private event access surface.
//
// RELEASED SET ONLY. Every handler in this family lands with
// `issue_1931_private_event_access_ready()` FALSE and must deny. The readiness check is
// the FIRST thing each handler evaluates, before any other precondition, so a denial is
// attributable to readiness alone (SC-46's vacuity guard).
//
// FROZEN and deliberately absent from this module: the legacy `?oi=` ingress in full —
// the vercel.json rewrite, `api/private-event-legacy-ingress`, the legacy-exchange RPC
// and the zero-authority resume handle (Amendment 6 §B.2, frozen item 5). Nothing here
// reads the legacy invitation query key, and nothing here reads or writes a #1770 row.
//
// #1931 hardcodes NO hostname. Per Amendment 6 §D.1 the origin authority in the
// Supabase Edge (Deno) layer is PRODUCTION_BUSINESS_WEB_ORIGIN, imported read-only.

export const PRIVATE_ACCESS_UNAVAILABLE = "invitation_unavailable" as const;
export const PRIVATE_ACCESS_NOT_READY = "private_access_not_ready" as const;

/**
 * Nondisclosing response headers required on EVERY private response, success or error
 * (base SPEC §6, Amendment 1 §1.3). Private bytes and private JSON are never cached, never
 * indexed, and never revalidated from a shared cache.
 */
export const privateNoStoreHeaders = (variant: "web" | "native"): Record<string, string> => ({
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
  Expires: "0",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex,nofollow,noarchive",
  Vary: variant === "web" ? "Cookie" : "X-Mingla-Private-Grant",
});

export type PrivateAccessDeps = {
  /** Reads public.issue_1931_private_event_access_ready() through the service role. */
  readinessEnabled: () => Promise<boolean>;
};

/**
 * The single bounded, nondisclosing failure shape. Missing, malformed, wrong-event,
 * expired, revoked, removed, superseded, deleted, ended/cancelled, wrong-account and
 * capability-off all collapse to the SAME body and the same status, so no caller can
 * distinguish them (base SPEC SC-2).
 */
export const unavailableResponse = (variant: "web" | "native", status = 404): Response =>
  new Response(JSON.stringify({ error: PRIVATE_ACCESS_UNAVAILABLE }), {
    status,
    headers: { ...privateNoStoreHeaders(variant), "Content-Type": "application/json" },
  });

/**
 * Released-set guard. Returns a denial Response when the capability is off, or null when
 * the caller may proceed. In THIS release readiness is false by construction and the
 * operator RPC is unconditionally unable to make it true, so this always denies.
 */
export const denyWhenNotReady = async (
  deps: PrivateAccessDeps,
  variant: "web" | "native",
): Promise<Response | null> => {
  const ready = await deps.readinessEnabled();
  if (ready) return null;
  return unavailableResponse(variant);
};

// NOTE: there is deliberately NO legacy-query-token helper here. Reading the legacy
// invitation query key is frozen item 5. #1931's own strict-grep gate fails the build if
// any released file in this family reads or matches that key (SC-55(b)).
