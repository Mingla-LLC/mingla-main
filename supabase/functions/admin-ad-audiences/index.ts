/**
 * Issue #3697 — Admin audience inventory and daily @usemingla sync.
 *
 * list: active-admin read only
 * refresh: active-admin provider reads only (never creates)
 * sync: service-role cron only; creates missing Meta/Snap/TikTok audiences and
 *       refreshes provider sizes. This is the sole audience provider writer.
 */

// @ts-ignore Deno runtime import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno runtime import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type AudienceProviderFact,
  audienceProviderFact,
  buildAudienceProviderRequest,
} from "../_shared/adAudienceProvider.ts";
import {
  type AudienceSyncSeed,
  audienceSyncSeedsForEvent,
} from "../_shared/adAudienceSyncPlan.ts";
import type { PaidSocialPlatform } from "../_shared/adAudienceStages.ts";
import type { AdConnectionRow } from "../_shared/adChannel.ts";
import { AdApiError, AdNotConnectedError } from "../_shared/adChannel.ts";
import { metaGraph, resolveMetaClient } from "../_shared/meta.ts";
import { resolveSnapchatClient, snapchatApi } from "../_shared/snapchat.ts";
import { resolveTikTokClient, tiktokApi } from "../_shared/tiktok.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PAID_SOCIAL = ["meta", "snapchat", "tiktok"] as const;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE_PLAN_STATES = [
  "ready_for_funding",
  "funding_pending",
  "funded_held",
  "staff_review_required",
  "staff_approved",
  "creating_paused_objects",
  "platform_review",
  "scheduled",
  "live",
  "partially_ready",
  "partially_live",
];

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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function sameSecret(candidate: string, expected: string): boolean {
  if (!candidate || candidate.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= candidate.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return diff === 0;
}

function isServiceRequest(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return sameSecret(bearer, SERVICE_KEY);
}

// deno-lint-ignore no-explicit-any
async function isActiveAdmin(db: any, req: Request): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const { data: { user }, error } = await db.auth.getUser(
    header.slice(7).trim(),
  );
  if (error || !user?.email) return false;
  const { data } = await db.from("admin_users").select("id")
    .eq("email", user.email).eq("status", "active").maybeSingle();
  return !!data;
}

function platform(value: unknown): PaidSocialPlatform | null {
  return PAID_SOCIAL.includes(value as PaidSocialPlatform)
    ? value as PaidSocialPlatform
    : null;
}

function pixelId(connection: AdConnectionRow): string {
  const extra = record(connection.extra);
  const value = connection.platform === "meta"
    ? extra.dataset_id ?? extra.pixel_id
    : extra.pixel_id;
  return typeof value === "string" ? value.trim() : "";
}

function publicError(error: unknown): string {
  if (error instanceof AdApiError) {
    return String(error.toJSON().message ?? error.code).slice(0, 1000);
  }
  if (error instanceof AdNotConnectedError) return error.detail;
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    1000,
  );
}

async function createAudience(
  connection: AdConnectionRow,
  seed: AudienceSyncSeed,
): Promise<AudienceProviderFact> {
  const request = buildAudienceProviderRequest({
    platform: seed.platform,
    accountId: connection.external_account_id,
    name: seed.definition.name,
    definition: seed.definition,
  });
  if (seed.platform === "meta") {
    const payload = await metaGraph(
      resolveMetaClient(connection),
      request.method,
      request.path,
      request.body,
    );
    return audienceProviderFact("meta", payload);
  }
  if (seed.platform === "snapchat") {
    const payload = await snapchatApi(
      await resolveSnapchatClient(connection),
      request.method,
      request.path,
      request.body,
    );
    return audienceProviderFact("snapchat", payload);
  }
  const payload = await tiktokApi(
    resolveTikTokClient(connection),
    request.method,
    request.path,
    request.body,
  );
  return audienceProviderFact("tiktok", payload);
}

async function readAudience(
  connection: AdConnectionRow,
  audienceId: string,
): Promise<AudienceProviderFact> {
  if (connection.platform === "meta") {
    const payload = await metaGraph(
      resolveMetaClient(connection),
      "GET",
      audienceId,
      {
        fields:
          "id,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,operation_status",
      },
    );
    return audienceProviderFact("meta", payload, audienceId);
  }
  if (connection.platform === "snapchat") {
    const payload = await snapchatApi(
      await resolveSnapchatClient(connection),
      "GET",
      `segments/${audienceId}`,
    );
    return audienceProviderFact("snapchat", payload, audienceId);
  }
  const client = resolveTikTokClient(connection);
  const payload = await tiktokApi(
    client,
    "GET",
    "dmp/custom_audience/get/",
    {
      advertiser_id: client.advertiserId,
      custom_audience_ids: [audienceId],
      page: 1,
      page_size: 1,
    },
  );
  return audienceProviderFact("tiktok", payload, audienceId);
}

function localStatus(
  fact: AudienceProviderFact,
): "creating" | "ready" | "too_small" {
  if (!fact.providerReady || fact.approxSize === null) return "creating";
  return fact.approxSize < 1000 ? "too_small" : "ready";
}

// deno-lint-ignore no-explicit-any
async function recordFact(db: any, rowId: string, fact: AudienceProviderFact) {
  const { data, error } = await db.rpc("ad_audience_record_sync", {
    p_id: rowId,
    p_platform_audience_id: fact.platformAudienceId,
    p_approx_size: fact.approxSize,
    p_status: localStatus(fact),
    p_error: null,
    p_synced_at: new Date().toISOString(),
  });
  if (error) throw error;
  return data;
}

// deno-lint-ignore no-explicit-any
async function recordFailure(
  db: any,
  row: Record<string, unknown>,
  error: unknown,
) {
  await db.rpc("ad_audience_record_sync", {
    p_id: row.id,
    p_platform_audience_id: row.platform_audience_id ?? "",
    p_approx_size: row.approx_size ?? null,
    p_status: "error",
    p_error: publicError(error),
    p_synced_at: new Date().toISOString(),
  });
}

// deno-lint-ignore no-explicit-any
async function connectionsByPlatform(
  db: any,
): Promise<Map<string, AdConnectionRow>> {
  const { data, error } = await db.from("ad_connections").select("*")
    .eq("lane", "consumer").eq("connected", true).eq("status", "connected")
    .in("platform", [...PAID_SOCIAL]);
  if (error) throw error;
  return new Map(
    (data ?? []).map((row: Record<string, unknown>) => [
      String(row.platform),
      row as unknown as AdConnectionRow,
    ]),
  );
}

// deno-lint-ignore no-explicit-any
async function syncSeeds(db: any): Promise<AudienceSyncSeed[]> {
  const { data: plans, error: planError } = await db.from("ad_plans")
    .select("id,current_version_id,state")
    .in("state", ACTIVE_PLAN_STATES)
    .not("current_version_id", "is", null);
  if (planError) throw planError;
  const versionIds = [
    ...new Set(
      (plans ?? []).map((row: Record<string, unknown>) =>
        String(row.current_version_id)
      )
        .filter((id: string) => UUID_RE.test(id)),
    ),
  ];
  if (versionIds.length === 0) return [];
  const { data: versions, error: versionError } = await db
    .from("ad_plan_versions")
    .select("id,canonical_plan,destination_snapshot")
    .in("id", versionIds);
  if (versionError) throw versionError;

  const eventIds = [
    ...new Set(
      (versions ?? []).map((row: Record<string, unknown>) =>
        String(record(row.destination_snapshot).event_id ?? "")
      ).filter((id: string) => UUID_RE.test(id)),
    ),
  ];
  const { data: dateRows } = eventIds.length > 0
    ? await db.from("event_dates").select("event_id,end_at").in(
      "event_id",
      eventIds,
    )
    : { data: [] };
  const endsByEvent = new Map<string, string>();
  for (const row of dateRows ?? []) {
    const eventId = String(row.event_id);
    const end = typeof row.end_at === "string" ? row.end_at : "";
    if (
      end &&
      (!endsByEvent.has(eventId) || end > String(endsByEvent.get(eventId)))
    ) {
      endsByEvent.set(eventId, end);
    }
  }

  const connections = await connectionsByPlatform(db);
  const seeds: AudienceSyncSeed[] = [];
  for (const row of versions ?? []) {
    const canonical = record(row.canonical_plan);
    const destination = record(row.destination_snapshot);
    const audience = record(canonical.audience_intent);
    const countries = Array.isArray(audience.countries)
      ? [
        ...new Set(
          audience.countries.map((value) => String(value).trim().toUpperCase()),
        ),
      ]
      : [];
    if (countries.length !== 1 || !/^[A-Z]{2}$/.test(countries[0])) continue;
    const eventId = String(destination.event_id ?? "");
    const brandId = String(destination.brand_id ?? "");
    const brandSlug = String(destination.brand_slug ?? "");
    const eventSlug = String(destination.entity_slug ?? "");
    const pageType = String(destination.page_type ?? "");
    if (
      !UUID_RE.test(eventId) || !UUID_RE.test(brandId) || !brandSlug ||
      !eventSlug || !["event", "rsvp", "trip", "experience"].includes(pageType)
    ) continue;
    const platforms = Array.isArray(canonical.platforms)
      ? canonical.platforms.map(platform).filter((
        value,
      ): value is PaidSocialPlatform => value !== null)
      : [];
    for (const provider of platforms) {
      const connection = connections.get(provider);
      const providerPixelId = connection ? pixelId(connection) : "";
      if (!connection || !providerPixelId) continue;
      seeds.push(...audienceSyncSeedsForEvent({
        platform: provider,
        market: countries[0],
        brandId,
        brandSlug,
        eventId,
        eventSlug,
        pageType: pageType as "event" | "rsvp" | "trip" | "experience",
        pixelId: providerPixelId,
        eventEndsAt: endsByEvent.get(eventId) ?? null,
      }));
    }
  }
  const seen = new Set<string>();
  return seeds.filter((seed) => {
    const key = [
      seed.platform,
      seed.code,
      seed.scope,
      seed.market,
      seed.brandId,
      seed.eventId,
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// deno-lint-ignore no-explicit-any
async function refreshRows(db: any, rows: Record<string, unknown>[]) {
  const connections = await connectionsByPlatform(db);
  const results = [];
  for (const row of rows) {
    const provider = platform(row.platform);
    const id = typeof row.platform_audience_id === "string"
      ? row.platform_audience_id.trim()
      : "";
    const connection = provider ? connections.get(provider) : null;
    if (!provider || !connection || !id) continue;
    try {
      results.push(
        await recordFact(
          db,
          String(row.id),
          await readAudience(connection, id),
        ),
      );
    } catch (error) {
      await recordFailure(db, row, error);
    }
  }
  return results;
}

// Supabase query builders are thenables. Build a fresh one after a provider
// refresh instead of awaiting the same builder twice and risking stale rows.
// deno-lint-ignore no-explicit-any
function audienceListQuery(
  db: any,
  filters: {
    platform: PaidSocialPlatform | null;
    market: string | null;
    brandId: string | null;
    eventId: string | null;
  },
) {
  let query = db.from("ad_audiences").select(
    "*,brand:brands(name),event:events(title)",
  ).order("platform").order("code").order("created_at");
  if (filters.platform) query = query.eq("platform", filters.platform);
  if (filters.market) query = query.eq("market", filters.market);
  if (filters.brandId) query = query.eq("brand_id", filters.brandId);
  if (filters.eventId) query = query.eq("event_id", filters.eventId);
  return query;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body: Record<string, unknown>;
  try {
    body = record(await req.json());
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const service = isServiceRequest(req);
  const admin = service ? false : await isActiveAdmin(db, req);
  if (!service && !admin) return json({ error: "unauthorized" }, 401);

  const action = body.action ?? "list";
  if (!["list", "refresh", "sync"].includes(String(action))) {
    return json({ error: "validation_error", detail: "action_invalid" }, 400);
  }
  if (action === "sync" && !service) {
    return json({ error: "forbidden", detail: "service_role_required" }, 403);
  }

  try {
    if (action === "sync") {
      const seeds = await syncSeeds(db);
      const connections = await connectionsByPlatform(db);
      const synced = [];
      for (const seed of seeds) {
        const { data: row, error: upsertError } = await db.rpc(
          "ad_audience_upsert",
          {
            p_platform: seed.platform,
            p_code: seed.code,
            p_name: seed.definition.name,
            p_scope: seed.scope,
            p_market: seed.market,
            p_brand_id: seed.brandId,
            p_event_id: seed.eventId,
            p_rule: seed.definition.rule,
            p_window_days: seed.definition.windowDays,
          },
        );
        if (upsertError || !row) {
          throw upsertError ?? new Error("audience_upsert_failed");
        }
        const connection = connections.get(seed.platform);
        if (!connection) {
          await recordFailure(
            db,
            row,
            new Error(`${seed.platform}_not_connected`),
          );
          continue;
        }
        try {
          let id = typeof row.platform_audience_id === "string"
            ? row.platform_audience_id.trim()
            : "";
          if (!id) {
            const created = await createAudience(connection, seed);
            id = created.platformAudienceId;
            await recordFact(db, String(row.id), created);
          }
          synced.push(
            await recordFact(
              db,
              String(row.id),
              await readAudience(connection, id),
            ),
          );
        } catch (error) {
          await recordFailure(db, row, error);
        }
      }
      const { data: ended } = await db.rpc("ad_audience_end_expired", {
        p_now: new Date().toISOString(),
      });
      return json({
        ok: true,
        ensured: seeds.length,
        refreshed: synced.length,
        ended: ended ?? 0,
      });
    }

    const requestedPlatform = platform(body.platform);
    if (body.platform && !requestedPlatform) {
      return json(
        { error: "validation_error", detail: "platform_invalid" },
        400,
      );
    }
    let marketFilter: string | null = null;
    if (typeof body.market === "string" && body.market.trim()) {
      const market = body.market.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(market)) {
        return json(
          { error: "validation_error", detail: "market_invalid" },
          400,
        );
      }
      marketFilter = market;
    }
    const ids: { brand_id: string | null; event_id: string | null } = {
      brand_id: null,
      event_id: null,
    };
    for (const field of ["brand_id", "event_id"] as const) {
      if (typeof body[field] === "string" && body[field].trim()) {
        if (!UUID_RE.test(body[field].trim())) {
          return json(
            { error: "validation_error", detail: `${field}_invalid` },
            400,
          );
        }
        ids[field] = body[field].trim();
      }
    }
    const filters = {
      platform: requestedPlatform,
      market: marketFilter,
      brandId: ids.brand_id,
      eventId: ids.event_id,
    };
    const { data: rows, error } = await audienceListQuery(db, filters);
    if (error) throw error;
    if (action === "refresh") await refreshRows(db, rows ?? []);
    const { data: latest, error: latestError } = action === "refresh"
      ? await audienceListQuery(db, filters)
      : { data: rows, error: null };
    if (latestError) throw latestError;
    const { data: buyerFlag } = await db.from("feature_flags")
      .select("is_enabled").eq("flag_key", "ad_buyer_list_sync_enabled")
      .maybeSingle();
    return json({
      ok: true,
      audiences: (latest ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        brand_name: record(row.brand).name ?? null,
        event_name: record(row.event).title ?? null,
        brand: undefined,
        event: undefined,
      })),
      buyer_list_sync_enabled: buyerFlag?.is_enabled === true,
    });
  } catch (error) {
    console.error("[admin-ad-audiences]", publicError(error));
    return json({
      error: "audience_operation_failed",
      message: publicError(error),
    }, 502);
  }
});
