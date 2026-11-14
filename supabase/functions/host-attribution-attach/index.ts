// #4238 W3-3 (D7) + W4-3 — host-attribution-attach.
//
// Called once by the Host app (web and native) right after a host signs in.
// It records the host's ad match context and answers whether this is the
// host's first sign-in, from the server's own record (the M-2 trigger queues
// host_signup:<uid> when the Host account row is created), so the Host app no
// longer guesses from a 30-second created_at window.
//
// verify_jwt = true (config.toml) AND the user is resolved here from the JWT.
// The body never names a user: any user id in it is ignored.
//
// POST body (all optional):
//   { click_id, fbp, fbc, ttp, scid, tracking_opt_out, page_url,
//     surface: "web" | "ios" | "android",
//     install_attribution: { media_source, campaign, af_sub1, af_sub2, af_sub3 } }
// IP and user agent come from the request headers. With tracking_opt_out the
// cookies and click id are dropped and the conversion records the opt-out.
// A native surface stores only its install attribution: a Host app sign-up is
// never reported to the ad networks as a website event (AppsFlyer measures it).
//
// Steps:
//   1. upsert ad_match_contexts(host_user, <uid>) — the first row wins;
//   2. ad_attribution_touches.user_id = <uid> for that click id while null;
//   3. when host_signup:<uid> exists and a channel is still pending, fire it
//      (after the response when the runtime allows).
// Response: { ok: true, host_signup_event_id: string | null, new_host: boolean | null }
//   new_host = this host's sign-up row exists AND this call created the
//   host's context row (true exactly once per host); null when the context
//   could not be written (the app falls back to its own check).
//
// MINGLA-INVARIANT reference: I-4238-HOST-FUNNEL-ONCE (issue_4238_attach.test.ts).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import {
  fireHostFunnelConversion,
  type MatchSurface,
  parseHostAdContext,
  scheduleHostFunnelTask,
  upsertAdMatchContext,
} from "../_shared/hostFunnelConversion.ts";
import type { FireAdConversionDeps } from "../_shared/adConversionFire.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;
const rateBuckets = new Map<string, number[]>();

export function attachRateLimited(key: string, now: number): boolean {
  const hits = (rateBuckets.get(key) ?? []).filter((t) =>
    now - t < RATE_WINDOW_MS
  );
  hits.push(now);
  rateBuckets.set(key, hits);
  return hits.length > RATE_MAX;
}

const INSTALL_KEYS = [
  "media_source",
  "campaign",
  "af_sub1",
  "af_sub2",
  "af_sub3",
] as const;

/** The Host app's saved AppsFlyer install fields, bounded strings only. */
export function parseInstallAttribution(
  raw: unknown,
): Record<string, string> | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const key of INSTALL_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) {
      out[key] = value.trim().slice(0, 200);
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function parseSurface(raw: unknown): MatchSurface {
  return raw === "ios" || raw === "android" ? raw : "web";
}

// deno-lint-ignore no-explicit-any
type Db = any;

export interface AttachDeps {
  db?: Db;
  fire?: FireAdConversionDeps;
  waitUntil?: ((task: Promise<unknown>) => void) | null;
  now?: () => number;
}

const PENDING_COLUMNS = [
  "meta_capi_status",
  "tiktok_events_status",
  "snap_capi_status",
  "reddit_capi_status",
  "google_ads_status",
] as const;

export async function handleAttach(
  req: Request,
  deps: AttachDeps = {},
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "unauthorized" }, 401);

  let db: Db = deps.db ?? null;
  if (!db) {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ error: "server_misconfigured" }, 500);
    db = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  const { data: authData, error: authError } = await db.auth.getUser(token);
  const userId: string | null = authData?.user?.id ?? null;
  if (authError || !userId) return json({ error: "unauthorized" }, 401);

  const now = deps.now ?? (() => Date.now());
  if (attachRateLimited(userId, now())) {
    return json({ ok: false, rate_limited: true }, 429);
  }

  let body: Record<string, unknown> = {};
  try {
    const raw = await req.json();
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      body = raw as Record<string, unknown>;
    }
  } catch {
    body = {};
  }

  const surface = parseSurface(body.surface);
  const parsed = parseHostAdContext(body, req);
  // A native sign-in carries no browser cookies or click id.
  const ad = parsed && surface !== "web"
    ? {
      ...parsed,
      clickId: null,
      fbp: null,
      fbc: null,
      ttp: null,
      scid: null,
      pageUrl: null,
      clientIpAddress: null,
      clientUserAgent: null,
    }
    : parsed;
  const installAttribution = surface === "web"
    ? null
    : parseInstallAttribution(body.install_attribution);

  const stored = await upsertAdMatchContext(db, {
    subjectType: "host_user",
    subjectId: userId,
    surface,
    ad,
    installAttribution,
  });

  if (ad?.clickId) {
    try {
      await db
        .from("ad_attribution_touches")
        .update({ user_id: userId })
        .eq("click_id", ad.clickId)
        .is("user_id", null);
    } catch (err) {
      console.error(
        "[host-attribution-attach] touch user link failed (non-fatal)",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const eventId = `host_signup:${userId}`;
  let signupRow: Record<string, unknown> | null = null;
  try {
    const { data } = await db
      .from("ad_conversions")
      .select(`event_id,${PENDING_COLUMNS.join(",")}`)
      .eq("event_id", eventId)
      .maybeSingle();
    signupRow = (data ?? null) as Record<string, unknown> | null;
  } catch {
    signupRow = null;
  }

  if (
    signupRow && stored.ok &&
    PENDING_COLUMNS.some((column) => signupRow?.[column] === "pending")
  ) {
    await scheduleHostFunnelTask(
      fireHostFunnelConversion(db, {
        kind: "host_signup",
        eventId,
        subjectType: "host_user",
        subjectId: userId,
      }, deps.fire),
      deps.waitUntil === undefined ? undefined : deps.waitUntil,
    );
  }

  return json({
    ok: true,
    host_signup_event_id: signupRow ? eventId : null,
    // null = unknown (the context could not be written, e.g. M-2 not applied
    // yet): the Host app then keeps its own fallback instead of losing the
    // registration event.
    new_host: stored.ok ? signupRow !== null && stored.created : null,
  });
}

if (import.meta.main) {
  serve((req) => handleAttach(req));
}
