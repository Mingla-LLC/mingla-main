// #4490 spec 07 I — signed-out promoter guest-list link.
// The raw token is accepted only here; PostgreSQL stores and receives its
// SHA-256 digest. Every returned row is scoped by that digest.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOKEN = /^[a-f0-9]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type RpcError = { message?: string; code?: string };
export type GuestListClient = {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: RpcError | null }>;
};
export type VenueGuestListDeps = {
  client?: () => GuestListClient;
  env?: (name: string) => string | undefined;
  hashToken?: (token: string) => Promise<string>;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function guestListTokenHashHex(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

const SAFE_CODES = new Set([
  "guest_list_link_not_found",
  "guest_list_entry_not_found",
  "guest_list_entry_arrived",
  "guest_list_date_invalid",
  "guest_list_hours_missing",
  "guest_list_closed",
  "guest_list_invalid_payload",
  "guest_list_rate_limited",
  "guest_list_night_limit",
  "already_on_list",
]);

function failure(error: RpcError): Response {
  const code = SAFE_CODES.has(error.message ?? "")
    ? error.message!
    : "guest_list_failed";
  const status = error.code === "P0002"
    ? 404
    : error.code === "PT429"
    ? 429
    : error.code === "PT409" || error.code === "23505"
    ? 409
    : error.code === "22023"
    ? 400
    : 500;
  return json(status, {
    code,
    ...(code === "guest_list_closed"
      ? { message: "The list for tonight has closed." }
      : {}),
  });
}

/**
 * The only environment names this function reads, each read literally so the
 * function secret contract can attribute them (#2241). Tests inject `deps.env`.
 */
function runtimeEnv(name: string): string | undefined {
  switch (name) {
    case "SUPABASE_SERVICE_ROLE_KEY":
      return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    case "SUPABASE_URL":
      return Deno.env.get("SUPABASE_URL");
    default:
      return undefined;
  }
}

export function createVenueGuestListHandler(deps: VenueGuestListDeps = {}) {
  const env = deps.env ?? runtimeEnv;
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json(405, { code: "method_not_allowed" });
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const action = str(body?.action);
    const token = str(body?.token).trim();
    if (!body || !TOKEN.test(token) || !["get", "add", "remove"].includes(action)) {
      return json(400, { code: "invalid_request" });
    }
    const client = deps.client
      ? deps.client()
      : createClient(
        env("SUPABASE_URL") ?? "",
        env("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { autoRefreshToken: false, persistSession: false } },
      ) as unknown as GuestListClient;
    const tokenHash = `\\x${await (deps.hashToken ?? guestListTokenHashHex)(token)}`;
    if (action === "get") {
      const { data, error } = await client.rpc(
        "issue_4490_guest_list_promoter_get",
        { p_token_hash: tokenHash },
      );
      return error ? failure(error) : json(200, { kind: "success", data });
    }
    const localDate = str(body.localDate);
    if (!DATE.test(localDate)) return json(400, { code: "invalid_request" });
    const payload: Record<string, unknown> = { localDate };
    if (action === "add") {
      const guestName = str(body.guestName).trim();
      const plusOnes = body.plusOnes ?? 0;
      if (
        guestName.length < 1 || guestName.length > 120 ||
        !Number.isInteger(plusOnes) || Number(plusOnes) < 0 || Number(plusOnes) > 10 ||
        (body.phone !== undefined && typeof body.phone !== "string")
      ) return json(400, { code: "invalid_request" });
      payload.guestName = guestName;
      payload.plusOnes = plusOnes;
      if (body.phone !== undefined) payload.phone = body.phone;
    } else {
      const entryId = str(body.entryId);
      if (!UUID.test(entryId)) return json(400, { code: "invalid_request" });
      payload.entryId = entryId;
    }
    const { data, error } = await client.rpc(
      "issue_4490_guest_list_promoter_write",
      { p_token_hash: tokenHash, p_action: action, p_payload: payload },
    );
    return error ? failure(error) : json(200, { kind: "success", data });
  };
}

if (import.meta.main) serve(createVenueGuestListHandler());
