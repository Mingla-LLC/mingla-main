// Issue #1931 — `private-event-access` Edge authority (RELEASED, denying).
//
// Operations: begin, verify, refresh, revoke-current, create-handoff, exchange-handoff.
// It uses the service role internally; clients never call service-only SQL.
//
// RELEASED-SET POSTURE: this handler lands with
// `issue_1931_private_event_access_ready()` FALSE. The readiness check is the FIRST
// thing evaluated on every operation — before method, shape, token or identity work —
// so every response in this release is the single bounded, nondisclosing
// `invitation_unavailable` state and the denial is attributable to readiness alone
// (SC-46 vacuity guard).
//
// FROZEN, and therefore ABSENT: the legacy `?oi=` ingress in full, and the
// legacy-exchange RPC (Amendment 6 §B.2, frozen item 5). This handler installs no
// interceptor on the live #1770 / #1817 / #1821 rail and consumes no invitation token.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  denyWhenNotReady,
  privateNoStoreHeaders,
  unavailableResponse,
  type PrivateAccessDeps,
} from "../_shared/privateEventAccess.ts";

export const PRIVATE_ACCESS_OPERATIONS = [
  "begin",
  "verify",
  "refresh",
  "revoke-current",
  "create-handoff",
  "exchange-handoff",
] as const;

export type PrivateAccessOperation = (typeof PRIVATE_ACCESS_OPERATIONS)[number];

const serviceClient = () =>
  createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

export const defaultDeps: PrivateAccessDeps = {
  readinessEnabled: async () => {
    const { data, error } = await serviceClient()
      .rpc("issue_1931_private_event_access_ready");
    if (error !== null) return false; // fail closed
    return data === true;
  },
};

export const createPrivateEventAccessHandler = (deps: PrivateAccessDeps = defaultDeps) =>
  async (req: Request): Promise<Response> => {
    const variant = req.headers.get("x-mingla-private-grant") === null ? "web" : "native";

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: privateNoStoreHeaders(variant) });
    }
    if (req.method !== "POST") {
      return unavailableResponse(variant, 405);
    }

    // RELEASED-SET GUARD — first, before any other precondition.
    const denied = await denyWhenNotReady(deps, variant);
    if (denied !== null) return denied;

    // Unreachable this release: readiness cannot become true. The operator RPC raises
    // `private_access_release_frozen` unconditionally (SC-45), so there is no path that
    // arrives here. The identity-bound begin/verify/refresh/handoff contract is carried
    // by the freeze-lift amendment.
    return unavailableResponse(variant);
  };

if (import.meta.main) {
  Deno.serve(createPrivateEventAccessHandler());
}
