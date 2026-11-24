// #4490 venue-waitlist — a guest joins a venue's waitlist with no account.
//
// POST { action, ... }. Signed-out guests send the project anon key only; a
// signed-in guest sends their user JWT (the entry is then theirs too). Every
// database call is a service-role RPC; the entry opens only with its private
// token (returned once by `join`, kept in the URL fragment of
// /visit/waitlist/<id>#t=<token>) or for its own signed-in guest.
//
//   join   { venueId, partySize, date: "YYYY-MM-DD", from?: "HH:MM",
//            to?: "HH:MM", guest: { name, email?, phone?, phoneCountryIso? } }
//          -> entry + { token, visitPath }   ("Tell me if a table opens"
//             with from/to; "Join tonight's waitlist" without)
//   get    { waitlistId, token? }            -> entry
//   leave  { waitlistId, token? }            -> entry (status "left")
//
// Entry: { waitlistId, status waiting|notified|seated|left|expired|lost,
// position, partySize, desiredDate, desiredFrom, desiredTo,
// quotedWaitMinutes, notifiedAt, offeredSlotAt, expiresAt, guestName,
// createdAt, venue{id,name,slug,brandSlug,brandName,timezone} }.
// Rate limited per IP (and per user) like the other guest functions.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { ClaimLinkAdmin } from "../_shared/claimLink.ts";
import {
  NO_VENUE_CLAIM,
  venueClaimFor,
  venueFlagOn,
  withClaim,
} from "../_shared/venueAppHandoff.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
export const WAITLIST_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const ACTIONS = new Set(["join", "get", "leave"]);
const WINDOW_MS = 10 * 60 * 1000;
const MAX_JOINS = 10;
const MAX_READS = 120;
const windows = new Map<string, { count: number; resetAt: number }>();

// Codes the guest page may show (each maps to plain words on the client).
const SAFE_CODES = [
  "waitlist_invalid",
  "waitlist_guest_invalid",
  "waitlist_closed",
  "waitlist_date_invalid",
  "waitlist_party_too_large",
  "waitlist_already_joined",
  "waitlist_not_found",
];

type RpcError = { message?: string; code?: string };
export type WaitlistClient = {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: RpcError | null }>;
  auth: {
    getUser: (
      jwt: string,
    ) => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
};

export type WaitlistDeps = {
  client?: () => WaitlistClient;
  env?: (name: string) => string | undefined;
  newToken?: () => string;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const str = (v: unknown): string => typeof v === "string" ? v.trim() : "";

export function safeCode(error: RpcError | null | undefined): string {
  const message = error?.message ?? "";
  return SAFE_CODES.find((code) => message === code) ?? "waitlist_failed";
}

function failure(error: RpcError): Response {
  const code = safeCode(error);
  if (code === "waitlist_failed") {
    console.error("[venue-waitlist] rpc failed", error.code ?? "");
    return json(500, { code });
  }
  const status = error.code === "22023"
    ? 400
    : error.code === "P0002"
    ? 404
    : error.code === "PT409"
    ? 409
    : 422;
  return json(status, { code });
}

function rateLimited(key: string, max: number): boolean {
  const now = Date.now();
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > max;
}

function jwtRole(token: string): string | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(
      atob(
        part.replace(/-/g, "+").replace(/_/g, "/").padEnd(
          Math.ceil(part.length / 4) * 4,
          "=",
        ),
      ),
    );
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

export function randomWaitlistToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** The Postgres bytea literal of SHA-256(token) (only the hash is stored). */
export async function waitlistTokenHashParam(token: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  );
  return `\\x${
    [...digest].map((b) => b.toString(16).padStart(2, "0")).join("")
  }`;
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

export function createVenueWaitlistHandler(deps: WaitlistDeps = {}) {
  const env = deps.env ?? runtimeEnv;
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") return json(405, { code: "method_not_allowed" });
    const body = await req.json().catch(() => null) as
      | Record<string, unknown>
      | null;
    const action = str(body?.action);
    if (!body || !ACTIONS.has(action)) {
      return json(400, { code: "invalid_request" });
    }
    let client: WaitlistClient;
    if (deps.client) {
      client = deps.client();
    } else {
      const url = env("SUPABASE_URL") ?? "";
      const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      if (!url || !serviceKey) return json(500, { code: "unavailable" });
      client = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      }) as unknown as WaitlistClient;
    }
    // Caller: a verified user JWT, else a signed-out guest (anon key).
    const jwt = (req.headers.get("authorization") ?? "").replace(
      /^Bearer\s+/i,
      "",
    ).trim();
    let userId: string | null = null;
    if (jwt && jwtRole(jwt) === "authenticated") {
      const { data, error } = await client.auth.getUser(jwt);
      if (error || !data?.user?.id) return json(401, { code: "auth_invalid" });
      userId = data.user.id;
    }
    const ip =
      (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
      "unknown";
    if (
      rateLimited(
        `${action}:${userId ?? ip}`,
        action === "join" ? MAX_JOINS : MAX_READS,
      )
    ) {
      return json(429, { code: "rate_limited" });
    }

    if (action === "join") {
      const venueId = str(body.venueId);
      const date = str(body.date);
      const from = body.from === undefined || body.from === null
        ? null
        : str(body.from);
      const to = body.to === undefined || body.to === null
        ? null
        : str(body.to);
      const guest = body.guest;
      if (
        !UUID.test(venueId) || !DATE.test(date) ||
        !Number.isInteger(body.partySize) ||
        (from !== null && !TIME.test(from)) ||
        (to !== null && !TIME.test(to)) ||
        (from === null) !== (to === null) ||
        !guest || typeof guest !== "object" || Array.isArray(guest) ||
        Object.keys(guest).some((k) =>
          !["name", "email", "phone", "phoneCountryIso"].includes(k)
        )
      ) {
        return json(400, { code: "invalid_request" });
      }
      const token = (deps.newToken ?? randomWaitlistToken)();
      const { data, error } = await client.rpc("pg_join_venue_waitlist", {
        p_venue_id: venueId,
        p_party_size: body.partySize,
        p_desired_date: date,
        p_desired_from: from,
        p_desired_to: to,
        p_guest: guest,
        p_token_hash: await waitlistTokenHashParam(token),
        p_user_id: userId,
      });
      if (error) return failure(error);
      const entry = data as Record<string, unknown>;
      // #4490 Explorer W1: the app handoff link (only while VENUE_APP_HANDOFF is on).
      const claim = await venueClaimFor(
        client as unknown as ClaimLinkAdmin,
        await venueFlagOn(client, "VENUE_APP_HANDOFF"),
        "venue_waitlist",
        String(entry.waitlistId ?? ""),
      );
      return json(200, {
        kind: "success",
        data: {
          ...entry,
          token,
          visitPath: `/visit/waitlist/${String(entry.waitlistId ?? "")}`,
          claim,
        },
      });
    }

    // get / leave: the entry's token, or the signed-in guest who joined.
    const waitlistId = str(body.waitlistId);
    const token = str(body.token);
    if (!UUID.test(waitlistId) || (token && !WAITLIST_TOKEN_RE.test(token))) {
      return json(400, { code: "invalid_request" });
    }
    if (!token && !userId) {
      return json(401, { code: "waitlist_token_required" });
    }
    const { data, error } = await client.rpc(
      action === "get"
        ? "pg_get_venue_waitlist_entry"
        : "pg_leave_venue_waitlist",
      {
        p_waitlist_id: waitlistId,
        p_token_hash: token ? await waitlistTokenHashParam(token) : null,
        p_user_id: userId,
      },
    );
    if (error) return failure(error);
    if (action === "get") {
      const claim = data
        ? await venueClaimFor(
          client as unknown as ClaimLinkAdmin,
          await venueFlagOn(client, "VENUE_APP_HANDOFF"),
          "venue_waitlist",
          waitlistId,
        )
        : NO_VENUE_CLAIM;
      return json(200, { kind: "success", data: withClaim(data, claim) });
    }
    return json(200, { kind: "success", data });
  };
}

if (import.meta.main) {
  serve(createVenueWaitlistHandler());
}
