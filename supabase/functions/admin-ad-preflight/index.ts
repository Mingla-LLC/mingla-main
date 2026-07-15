/**
 * admin-ad-preflight — ISSUE-862 WP1 [Full Rooms Ad Engine].
 *
 * The channel-health service (PIPELINE_BLUEPRINT §1.0 / §4.1, as corrected by
 * SPEC A4.e): one call per (platform, lane) answering "if I launch right now,
 * will an ad actually run?" — P1 token · P2 billing/funding · P3 identity ·
 * P4 pixel · P5 review/access tier · P6 market reachability.
 *
 * Meta is implemented fully (per A4.e corrections):
 *   P1 token      — GET /me/adaccounts contains the configured account
 *   P2 billing    — account_status ACTIVE + funding source present
 *   P3 identity   — GET /me/accounts contains the Page with an ADVERTISE task
 *                   (A4.e.1 — NOT promote_pages) + B6 app-Live validate-only
 *                   adcreatives probe (A4.e.2, error 1885183 → meta_app_not_live)
 *   P4 pixel      — last_fired_time epoch-0/null ⇒ WARN (LINK_CLICKS-only until
 *                   the pixel fires — A4.e.5; not a create blocker)
 *   P5 tier       — n/a for Meta (own-account system-user token)
 *   P6 market     — Targeting Search GET /search?type=adgeolocation callable
 *                   (A4.e.6 / PROOF M-P9)
 *
 * Other channels are fail-closed stubs: single-platform request → 424
 * <platform>_not_connected; all-platform sweep → per-row not_connected entries.
 *
 * Body: { platform?, lane?='consumer' } — omit platform for all five.
 * verify_jwt = true + in-code admin_users active gate. READ-ONLY (writes nothing).
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import; types resolved at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AdApiError,
  type AdConnectionRow,
  AdNotConnectedError,
  isLane,
  isPlatform,
  PLATFORMS,
  type Platform,
} from "../_shared/adChannel.ts";
import {
  metaCheckPageAdvertiseTask,
  metaFetchAccount,
  metaFetchPixelLastFired,
  metaGraph,
  metaValidateOnlyCreativeProbe,
  resolveMetaClient,
} from "../_shared/meta.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type CheckStatus = "pass" | "fail" | "warn" | "n/a";

interface PreflightCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string | null;
}

interface PreflightRow {
  platform: Platform;
  lane: string;
  overall: "green" | "amber" | "red" | "not_connected";
  checks: PreflightCheck[];
  checked_at: string;
}

function stubRow(platform: Platform, lane: string): PreflightRow {
  return {
    platform,
    lane,
    overall: "not_connected",
    checks: [{
      id: "P1",
      label: "Token valid",
      status: "fail",
      detail:
        `${platform}_not_connected — adapter ships in a later WP (WP2 google / WP5 snapchat / WP6 reddit / WP7 tiktok); fail-close until then.`,
    }],
    checked_at: new Date().toISOString(),
  };
}

async function metaPreflight(
  conn: AdConnectionRow | null,
  lane: string,
): Promise<PreflightRow> {
  const checks: PreflightCheck[] = [];
  const push = (id: string, label: string, status: CheckStatus, detail: string | null = null) =>
    checks.push({ id, label, status, detail });

  let client;
  try {
    // Lane-correct resolution (QA P2-3): with no persisted row, the credential
    // probed is the LANE's env name, never a consumer fallback.
    client = resolveMetaClient(conn ?? null, lane as "consumer" | "business");
  } catch (err) {
    const detail = err instanceof AdNotConnectedError
      ? "Token secret unset — set the Supabase Edge Function secret and connect."
      : err instanceof Error
      ? err.message
      : String(err);
    push("P1", "Token valid", "fail", detail);
    return {
      platform: "meta",
      lane,
      overall: "not_connected",
      checks,
      checked_at: new Date().toISOString(),
    };
  }

  // P1 — token authenticates AND can see the configured ad account.
  try {
    const payload = await metaGraph(client, "GET", "me/adaccounts", {
      fields: "id",
      limit: "100",
    });
    const rows = Array.isArray(payload.data) ? payload.data as Record<string, unknown>[] : [];
    const found = rows.some((r) => String(r.id) === `act_${client.config.adAccountId}`);
    push(
      "P1",
      "Token valid",
      found ? "pass" : "fail",
      found ? null : "Token authenticates but cannot see the configured ad account.",
    );
  } catch (err) {
    push("P1", "Token valid", "fail", err instanceof Error ? err.message : String(err));
    return {
      platform: "meta",
      lane,
      overall: "red",
      checks,
      checked_at: new Date().toISOString(),
    };
  }

  // P2 — billing/funding.
  try {
    const account = await metaFetchAccount(client);
    const ok = account.accountStatus === "ACTIVE" && account.hasPaymentMethod;
    push(
      "P2",
      "Billing / funding present",
      ok ? "pass" : "fail",
      ok ? null : `account_status=${account.accountStatus ?? "unknown"}, payment method ${
        account.hasPaymentMethod ? "present" : "MISSING"
      } — launched campaigns park at PENDING_BILLING_INFO until billing is added.`,
    );
  } catch (err) {
    push("P2", "Billing / funding present", "fail", err instanceof Error ? err.message : String(err));
  }

  // P3 — identity: Page + ADVERTISE task (A4.e.1) and app-Live (A4.e.2).
  try {
    const page = await metaCheckPageAdvertiseTask(client);
    push(
      "P3",
      "Page granted with ADVERTISE task",
      page.ok ? "pass" : "fail",
      page.ok ? null : "meta_page_not_assigned — assign the Page to the system user in Business Settings.",
    );
  } catch (err) {
    push("P3", "Page granted with ADVERTISE task", "fail", err instanceof Error ? err.message : String(err));
  }
  try {
    const probe = await metaValidateOnlyCreativeProbe(client);
    push(
      "B6",
      "Developer app is Live",
      probe.appLive ? "pass" : "fail",
      probe.appLive ? null : "meta_app_not_live (error 1885183) — switch the app to Live in the App Dashboard.",
    );
  } catch (err) {
    push("B6", "Developer app is Live", "fail", err instanceof Error ? err.message : String(err));
  }

  // P4 — pixel signal (WARN, not a blocker: LINK_CLICKS still works — A4.e.5).
  try {
    const pixel = await metaFetchPixelLastFired(client);
    push(
      "P4",
      "Pixel firing",
      pixel.hasSignal ? "pass" : "warn",
      pixel.hasSignal
        ? null
        : "Pixel has never fired — LANDING_PAGE_VIEWS / OFFSITE_CONVERSIONS / VALUE are gated (422 pixel_no_signal); LINK_CLICKS is the honest goal until #865 wires the pixel.",
    );
  } catch (err) {
    push("P4", "Pixel firing", "warn", err instanceof Error ? err.message : String(err));
  }

  // P5 — access tier: n/a on Meta (own-account system-user token, no App Review).
  push("P5", "Review / access tier", "n/a", "Own-account system-user token — no tier gate.");

  // P6 — market reachability: Targeting Search callable (PROOF M-P9).
  try {
    await metaGraph(client, "GET", "search", {
      type: "adgeolocation",
      q: "london",
      location_types: ["city"],
      limit: "1",
    });
    push("P6", "Market reachable (Targeting Search)", "pass", null);
  } catch (err) {
    push(
      "P6",
      "Market reachable (Targeting Search)",
      "fail",
      err instanceof AdApiError ? err.message : err instanceof Error ? err.message : String(err),
    );
  }

  const anyHardFail = checks.some((c) => c.status === "fail");
  const anyWarn = checks.some((c) => c.status === "warn");
  return {
    platform: "meta",
    lane,
    overall: anyHardFail ? "red" : anyWarn ? "amber" : "green",
    checks,
    checked_at: new Date().toISOString(),
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    body = {};
  }

  const lane = body.lane ?? "consumer";
  if (!isLane(lane)) return json({ error: "validation_error", detail: "lane_invalid" }, 400);
  const platform = body.platform;
  if (platform !== undefined && !isPlatform(platform)) {
    return json({ error: "validation_error", detail: "platform_invalid" }, 400);
  }

  // ── ADMIN GATE (SPEC §4.4). ──────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return json({ error: "unauthorized" }, 401);
  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .eq("status", "active")
    .maybeSingle();
  if (!adminRow) return json({ error: "forbidden" }, 403);

  // Single non-meta platform → fail-close 424 (stub until its WP lands).
  if (platform !== undefined && platform !== "meta") {
    return json({
      error: `${platform}_not_connected`,
      detail: stubRow(platform, lane).checks[0].detail,
    }, 424);
  }

  const { data: metaConn } = await supabase
    .from("ad_connections")
    .select("*")
    .eq("platform", "meta")
    .eq("lane", lane)
    .maybeSingle();
  const metaConnection = (metaConn ?? null) as AdConnectionRow | null;

  if (platform === "meta") {
    const row = await metaPreflight(metaConnection, lane);
    return json({ rows: [row] });
  }

  // All five channels.
  const rows: PreflightRow[] = [];
  for (const p of PLATFORMS) {
    if (p === "meta") rows.push(await metaPreflight(metaConnection, lane));
    else rows.push(stubRow(p, lane));
  }
  return json({ rows });
});
