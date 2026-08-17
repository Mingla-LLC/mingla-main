// Issue #1931 — `private-event-read` Edge reader (RELEASED, denying).
//
// Resolves the caller's grant capability and calls the service-only
// private_event_checkout_bundle RPC. Every success and every error response carries the
// no-store / noindex / Vary posture of base SPEC §6, and invalid or revoked responses are
// nondisclosing 404/410 classes with IDENTICAL bodies.
//
// RELEASED-SET POSTURE: readiness is FALSE, so this handler denies every request with the
// single bounded `invitation_unavailable` state (SC-46). It never widens
// business_public_events_view, the public SELECT RLS, pg_direct_event_checkout_bundle,
// public ticket views, Explorer RPCs or social-preview reads.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  denyWhenNotReady,
  privateNoStoreHeaders,
  unavailableResponse,
  type PrivateAccessDeps,
} from "../_shared/privateEventAccess.ts";

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
    if (error !== null) return false;
    return data === true;
  },
};

export const createPrivateEventReadHandler = (deps: PrivateAccessDeps = defaultDeps) =>
  async (req: Request): Promise<Response> => {
    const variant = req.headers.get("x-mingla-private-grant") === null ? "web" : "native";

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: privateNoStoreHeaders(variant) });
    }
    if (req.method !== "POST" && req.method !== "GET") {
      return unavailableResponse(variant, 405);
    }

    const denied = await denyWhenNotReady(deps, variant);
    if (denied !== null) return denied;

    return unavailableResponse(variant);
  };

if (import.meta.main) {
  Deno.serve(createPrivateEventReadHandler());
}
