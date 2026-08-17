// Issue #1931 — `private-event-media` authorization-aware streaming proxy
// (RELEASED, denying).
//
// When live it validates grant/epoch on EVERY request, fetches only the exact asset
// recorded for that event, streams bytes without redirecting or exposing the origin URL,
// supports Range, and emits no-store headers. Revocation or epoch mismatch returns a
// no-store 410. It never returns a raw provider URL or a signed origin URL.
//
// RELEASED-SET POSTURE: readiness is FALSE, so every request denies (SC-46). No byte is
// served and no origin is contacted in this release.
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

export const createPrivateEventMediaHandler = (deps: PrivateAccessDeps = defaultDeps) =>
  async (req: Request): Promise<Response> => {
    const variant = req.headers.get("x-mingla-private-grant") === null ? "web" : "native";

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: privateNoStoreHeaders(variant) });
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return unavailableResponse(variant, 405);
    }

    const denied = await denyWhenNotReady(deps, variant);
    if (denied !== null) return denied;

    return unavailableResponse(variant);
  };

if (import.meta.main) {
  Deno.serve(createPrivateEventMediaHandler());
}
