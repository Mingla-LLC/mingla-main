/**
 * Issue #3697 / #4238 — Admin audience inventory and the daily @usemingla sync.
 * This is the sole audience provider writer (website audiences and, since
 * #4238, customer lists and lookalikes).
 *
 * list:              active-admin read (website audiences, list audiences, terms)
 * refresh:           active-admin provider reads only (never creates)
 * sync:              service-role daily cron: website audiences, then list sync
 * removals:          service-role hourly cron: dirty refreshes + removals only
 * create_definition: Admin creates a Mingla-wide list / lookalike, or ensures a
 *                    brand's three lists
 * retire_definition: Admin retires a definition (next sync deletes it)
 * preview:           Admin count preview (counts only, never members)
 * check_terms:       Admin read-only terms check (Meta tos_accepted)
 * confirm_terms:     Admin records that they accepted terms in the provider UI.
 *                    It never calls a provider to accept anything.
 *
 * Logging: never a hash, a per-person count or a provider body
 * (I-4238-AUDIENCE-HASH-ONLY).
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
import {
  resolveTikTokClient,
  resolveTikTokGeo,
  tiktokApi,
  tiktokUploadAudienceFile,
} from "../_shared/tiktok.ts";
import { redditRequest, resolveRedditClient } from "../_shared/reddit.ts";
import { md5Hex } from "../_shared/adCreativePrepare.ts";
import {
  buildMetaListCreate,
  buildMetaLookalike,
  buildMetaTermsRead,
  buildMetaUsers,
  buildRedditUsers,
  buildSnapListCreate,
  buildSnapLookalike,
  buildSnapUsers,
  buildTikTokAudienceFile,
  buildTikTokDelete,
  buildTikTokListCreate,
  buildTikTokListUpdate,
  buildTikTokLookalike,
  listAudienceErrorCode,
  type ListTransport,
  type MemberHashRow,
  parseListFact,
  parseMetaTerms,
  syncListAudiences,
} from "../_shared/adListAudienceProvider.ts";
import type { ListPlatform } from "../_shared/adListAudienceRules.ts";

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
  // #4238 O-4: Meta's delivery verdict wins (ACTIVE -> ready).
  if (fact.providerState) return fact.providerState;
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

// ── #4238 customer lists and lookalikes ──────────────────────────────────────

const LIST_PROVIDERS: ListPlatform[] = ["meta", "snapchat", "tiktok", "reddit", "google"];

function unsupported(code: string): never {
  throw new Error(code);
}

/** Real provider transports. Tests use fakes; nothing here logs a body. */
async function listTransport(
  connection: AdConnectionRow,
): Promise<ListTransport> {
  const accountId = connection.external_account_id;
  if (connection.platform === "meta") {
    const client = resolveMetaClient(connection);
    let session = Date.now();
    const send = async (
      providerId: string,
      action: "add" | "remove",
      members: MemberHashRow[],
    ) => {
      session += 1;
      for (const [schema, hashes] of [
        ["EMAIL", members.map((m) => m.email_sha256).filter((h): h is string => !!h)],
        ["PHONE", members.map((m) => m.phone_sha256).filter((h): h is string => !!h)],
      ] as const) {
        if (hashes.length === 0) continue;
        const request = buildMetaUsers({
          audienceId: providerId,
          action,
          schema,
          hashes,
          session: {
            session_id: session,
            batch_seq: 1,
            last_batch_flag: true,
            estimated_num_total: hashes.length,
          },
        });
        await metaGraph(client, request.method as "POST" | "DELETE", request.path, request.body);
      }
    };
    const read = async (id: string) =>
      parseListFact(
        "meta",
        await metaGraph(client, "GET", id, {
          fields: "id,approximate_count_lower_bound,delivery_status,operation_status",
        }),
        id,
      );
    return {
      connectionId: connection.id,
      createList: async (name) => {
        const request = buildMetaListCreate(accountId, name);
        return parseListFact("meta", await metaGraph(client, "POST", request.path, request.body));
      },
      createLookalike: async (name, seedId, country) => {
        const request = buildMetaLookalike({ accountId, name, originAudienceId: seedId, country });
        return parseListFact("meta", await metaGraph(client, "POST", request.path, request.body));
      },
      send,
      read,
      remove: async (id) => {
        await metaGraph(client, "DELETE", id);
      },
    };
  }
  if (connection.platform === "snapchat") {
    const client = await resolveSnapchatClient(connection);
    return {
      connectionId: connection.id,
      createList: async (name) => {
        const request = buildSnapListCreate(accountId, name);
        return parseListFact("snapchat", await snapchatApi(client, "POST", request.path, request.body));
      },
      createLookalike: async (name, seedId, country) => {
        const request = buildSnapLookalike({ accountId, name, seedSegmentId: seedId, country });
        return parseListFact("snapchat", await snapchatApi(client, "POST", request.path, request.body));
      },
      send: async (providerId, action, members) => {
        for (const [schema, hashes] of [
          ["EMAIL_SHA256", members.map((m) => m.email_sha256).filter((h): h is string => !!h)],
          ["PHONE_SHA256", members.map((m) => m.phone_sha256).filter((h): h is string => !!h)],
        ] as const) {
          if (hashes.length === 0) continue;
          const request = buildSnapUsers({ segmentId: providerId, action, schema, hashes });
          await snapchatApi(client, request.method as "POST" | "DELETE", request.path, request.body);
        }
      },
      read: async (id) =>
        parseListFact("snapchat", await snapchatApi(client, "GET", `segments/${id}`), id),
      remove: async (id) => {
        await snapchatApi(client, "DELETE", `segments/${id}`);
      },
    };
  }
  if (connection.platform === "tiktok") {
    const client = resolveTikTokClient(connection);
    const upload = async (type: "EMAIL_SHA256" | "PHONE_SHA256", hashes: string[]) => {
      const file = buildTikTokAudienceFile(type, hashes);
      return await tiktokUploadAudienceFile(client, {
        calculateType: file.calculateType,
        csv: file.csv,
        signature: md5Hex(new TextEncoder().encode(file.csv)),
      });
    };
    const read = async (id: string) =>
      parseListFact(
        "tiktok",
        await tiktokApi(client, "GET", "dmp/custom_audience/get/", {
          advertiser_id: client.advertiserId,
          custom_audience_ids: [id],
        }),
        id,
      );
    return {
      connectionId: connection.id,
      // TikTok creates a list from files, so creation and the first upload
      // are one step (one calculate_type per file: email file first).
      createWithMembers: async (name, members) => {
        const emails = members.map((m) => m.email_sha256).filter((h): h is string => !!h);
        const phones = members.map((m) => m.phone_sha256).filter((h): h is string => !!h);
        const type = emails.length >= phones.length ? "EMAIL_SHA256" : "PHONE_SHA256";
        const path = await upload(type, type === "EMAIL_SHA256" ? emails : phones);
        const request = buildTikTokListCreate({
          advertiserId: client.advertiserId,
          name,
          calculateType: type,
          filePaths: [path],
        });
        return parseListFact("tiktok", await tiktokApi(client, "POST", request.path, request.body));
      },
      createList: () => unsupported("tiktok_list_create_needs_members"),
      createLookalike: async (name, seedId, country) => {
        const [locationId] = await resolveTikTokGeo(connection, [country]);
        const request = buildTikTokLookalike({
          advertiserId: client.advertiserId,
          name,
          sourceAudienceId: seedId,
          locationId,
        });
        return parseListFact("tiktok", await tiktokApi(client, "POST", request.path, request.body));
      },
      send: async (providerId, action, members) => {
        const hashes = members.map((m) => m.email_sha256).filter((h): h is string => !!h);
        if (hashes.length === 0) return;
        const path = await upload("EMAIL_SHA256", hashes);
        const request = buildTikTokListUpdate({
          advertiserId: client.advertiserId,
          audienceId: providerId,
          action: action === "add" ? "APPEND" : "REMOVE",
          filePaths: [path],
        });
        await tiktokApi(client, "POST", request.path, request.body);
      },
      read,
      remove: async (id) => {
        const request = buildTikTokDelete(client.advertiserId, id);
        await tiktokApi(client, "POST", request.path, request.body);
      },
    };
  }
  if (connection.platform === "reddit") {
    return {
      connectionId: connection.id,
      // O-3: Reddit create / lookalike paths are unverified; never guessed.
      createList: () => unsupported("reddit_audience_endpoint_unverified"),
      createLookalike: () => unsupported("reddit_audience_endpoint_unverified"),
      send: async (providerId, action, members) => {
        const client = await resolveRedditClient(connection);
        const hashes = members.map((m) => m.email_sha256).filter((h): h is string => !!h);
        if (hashes.length === 0) return;
        const request = buildRedditUsers({
          audienceId: providerId,
          action: action === "add" ? "ADD" : "REMOVE",
          hashes,
        });
        await redditRequest(client, "PATCH", request.path, request.body);
      },
      read: () => unsupported("reddit_audience_endpoint_unverified"),
      remove: () => unsupported("reddit_audience_endpoint_unverified"),
    };
  }
  // Google: Customer Match needs Data Manager credentials Mingla does not have
  // yet (N-6). The worker marks Google ineligible / terms_required before it
  // could reach this transport; if it ever does, it fails closed.
  return {
    connectionId: connection.id,
    createList: () => unsupported("google_data_manager_unavailable"),
    createLookalike: () => unsupported("google_lookalikes_unsupported"),
    send: () => unsupported("google_data_manager_unavailable"),
    read: () => unsupported("google_data_manager_unavailable"),
    remove: () => unsupported("google_data_manager_unavailable"),
  };
}

// deno-lint-ignore no-explicit-any
async function listTransports(db: any): Promise<Partial<Record<ListPlatform, ListTransport>>> {
  const { data, error } = await db.from("ad_connections").select("*")
    .eq("lane", "consumer").eq("connected", true).eq("status", "connected")
    .in("platform", LIST_PROVIDERS);
  if (error) throw error;
  const out: Partial<Record<ListPlatform, ListTransport>> = {};
  for (const row of data ?? []) {
    try {
      out[row.platform as ListPlatform] = await listTransport(row as AdConnectionRow);
    } catch (error) {
      console.error("[admin-ad-audiences] list transport unavailable", {
        platform: row.platform,
        error_code: listAudienceErrorCode(error),
      });
    }
  }
  return out;
}

// deno-lint-ignore no-explicit-any
async function redditListsEnabled(db: any): Promise<boolean> {
  const { data } = await db.from("feature_flags").select("is_enabled")
    .eq("flag_key", "ad_reddit_list_audiences_enabled").maybeSingle();
  return data?.is_enabled === true;
}

// deno-lint-ignore no-explicit-any
async function runListSync(db: any, kind: "daily" | "removals", budgetMs: number, cursor: unknown) {
  const cursorRecord = record(cursor);
  return await syncListAudiences({
    db,
    kind,
    transports: await listTransports(db),
    redditEnabled: await redditListsEnabled(db),
    budgetMs,
    cursor: typeof cursorRecord.after === "string" ? { after: cursorRecord.after } : null,
  });
}

const SOURCES = new Set(["users", "buyers", "contacts", "everyone"]);
const PAGE_TYPES = new Set(["event", "rsvp", "trip", "experience", "venue"]);

async function sha8(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].slice(0, 4).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Admin definition from a request body; validated against the table CHECKs. */
// deno-lint-ignore no-explicit-any
async function definitionFromBody(db: any, body: Record<string, unknown>): Promise<
  { ok: true; row: Record<string, unknown> } | { ok: false; detail: string }
> {
  if (typeof body.lookalike_of === "string") {
    const country = String(body.country ?? "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) return { ok: false, detail: "country_invalid" };
    const { data: seed } = await db.from("ad_list_audiences").select("*")
      .eq("audience_key", body.lookalike_of).eq("status", "active").maybeSingle();
    if (!seed || seed.kind !== "list") return { ok: false, detail: "seed_not_found" };
    return {
      ok: true,
      row: {
        audience_key: `mingla:lookalike:${await sha8(String(seed.audience_key))}_${country.toLowerCase()}`,
        owner_kind: "mingla",
        brand_id: null,
        kind: "lookalike",
        source: seed.source,
        seed_audience_id: seed.id,
        lookalike_country: country,
        display_name: `People like ${seed.display_name}`.slice(0, 90) + ` (${country})`,
      },
    };
  }
  const source = String(body.source ?? "");
  if (!SOURCES.has(source)) return { ok: false, detail: "source_invalid" };
  const filterIn = record(body.filter);
  const filter: Record<string, string> = {};
  const scope: string[] = [];
  if (filterIn.country) {
    const cc = String(filterIn.country).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return { ok: false, detail: "country_invalid" };
    filter.country = cc;
    scope.push(`cc_${cc.toLowerCase()}`);
  }
  if (filterIn.city) {
    const city = String(filterIn.city).trim().toLowerCase();
    if (!/^[a-z0-9 ._'-]{1,80}$/.test(city)) return { ok: false, detail: "city_invalid" };
    filter.city = city;
    scope.push(`city_${city.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`);
  }
  if (filterIn.page_type) {
    const pageType = String(filterIn.page_type);
    if (!PAGE_TYPES.has(pageType)) return { ok: false, detail: "page_type_invalid" };
    filter.page_type = pageType;
    scope.push(`kind_${pageType}`);
  }
  const displayName = String(body.display_name ?? "").trim();
  if (displayName.length < 1 || displayName.length > 100) {
    return { ok: false, detail: "display_name_invalid" };
  }
  return {
    ok: true,
    row: {
      audience_key: `mingla:${source}:${scope.length ? scope.join("_") : "all"}`,
      owner_kind: "mingla",
      brand_id: null,
      kind: "list",
      source,
      filter,
      display_name: displayName,
    },
  };
}

// deno-lint-ignore no-explicit-any
async function listAudienceInventory(db: any) {
  const [defs, platforms, terms, brands] = await Promise.all([
    db.from("ad_list_audiences").select(
      "id,audience_key,owner_kind,brand_id,kind,source,filter,lookalike_country,display_name,host_visible,member_count,member_count_by_country,members_refreshed_at,requested_at,last_used_at,status,created_at",
    ).order("owner_kind").order("audience_key"),
    db.from("ad_list_audience_platforms").select(
      "audience_id,platform,state,needed_count,approx_size,last_synced_at,error_code",
    ),
    db.from("ad_platform_audience_terms").select(
      "connection_id,platform,state,eligibility,checked_at,admin_confirmed_at,detail_code",
    ),
    db.from("ad_connections").select("id,platform,external_account_id")
      .eq("lane", "consumer").in("platform", LIST_PROVIDERS),
  ]);
  const error = defs.error ?? platforms.error ?? terms.error ?? brands.error;
  if (error) throw error;
  const brandIds = [...new Set((defs.data ?? []).map((row: Record<string, unknown>) => row.brand_id).filter(Boolean))];
  const { data: brandRows } = brandIds.length > 0
    ? await db.from("brands").select("id,name").in("id", brandIds)
    : { data: [] };
  const brandName = new Map((brandRows ?? []).map((row: Record<string, unknown>) => [row.id, row.name]));
  const termsByConnection = new Map((terms.data ?? []).map((row: Record<string, unknown>) => [row.connection_id, row]));
  return {
    list_audiences: (defs.data ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      brand_name: row.brand_id ? brandName.get(row.brand_id) ?? null : null,
      platforms: (platforms.data ?? []).filter((item: Record<string, unknown>) =>
        item.audience_id === row.id
      ).map((item: Record<string, unknown>) => ({
        platform: item.platform,
        state: item.state,
        needed_count: item.needed_count,
        approx_size: item.approx_size,
        error_code: item.error_code,
      })),
    })),
    // One row per consumer connection, "unknown" until checked.
    terms: (brands.data ?? []).map((connection: Record<string, unknown>) => {
      const row = (termsByConnection.get(connection.id) ?? {}) as Record<string, unknown>;
      return {
        connection_id: connection.id,
        platform: connection.platform,
        account_id: String(connection.external_account_id ?? "").replace(/^act_/, ""),
        state: row.state ?? "unknown",
        eligibility: row.eligibility ?? "unknown",
        checked_at: row.checked_at ?? null,
        admin_confirmed_at: row.admin_confirmed_at ?? null,
        detail_code: row.detail_code ?? null,
      };
    }),
  };
}

// deno-lint-ignore no-explicit-any
async function adminUserId(db: any, req: Request): Promise<string | null> {
  const header = req.headers.get("authorization") ?? "";
  const { data } = await db.auth.getUser(header.replace(/^Bearer\s+/i, ""));
  return data?.user?.id ?? null;
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
  if (
    ![
      "list",
      "refresh",
      "sync",
      "removals",
      "create_definition",
      "retire_definition",
      "preview",
      "check_terms",
      "confirm_terms",
    ].includes(String(action))
  ) {
    return json({ error: "validation_error", detail: "action_invalid" }, 400);
  }
  if ((action === "sync" || action === "removals") && !service) {
    return json({ error: "forbidden", detail: "service_role_required" }, 403);
  }
  const startedAt = Date.now();

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
      // #4238: customer lists and lookalikes, inside the cron's 55 s window.
      const lists = await runListSync(
        db,
        "daily",
        Math.max(5_000, 40_000 - (Date.now() - startedAt)),
        body.cursor,
      );
      return json({
        ok: true,
        ensured: seeds.length,
        refreshed: synced.length,
        ended: ended ?? 0,
        lists: {
          more: lists.more,
          cursor: lists.cursor,
          adds: lists.adds,
          removes: lists.removes,
          errors: lists.errors,
        },
      });
    }

    if (action === "removals") {
      // Continue an unfinished daily run first, else push removals only.
      const { data: last } = await db.from("ad_list_audience_sync_runs")
        .select("kind,more,cursor").order("started_at", { ascending: false })
        .limit(1).maybeSingle();
      const continuing = last?.kind === "daily" && last?.more === true;
      const lists = await runListSync(
        db,
        continuing ? "daily" : "removals",
        40_000,
        continuing ? last?.cursor : null,
      );
      return json({ ok: true, continued_daily: continuing, ...lists });
    }

    if (action === "create_definition") {
      if (typeof body.brand_id === "string") {
        if (!UUID_RE.test(body.brand_id)) {
          return json({ error: "validation_error", detail: "brand_id_invalid" }, 400);
        }
        const { data, error } = await db.rpc("ad_list_audience_ensure_brand", {
          p_brand_id: body.brand_id,
        });
        if (error) throw error;
        await db.from("ad_list_audiences").update({ requested_at: new Date().toISOString() })
          .eq("brand_id", body.brand_id);
        return json({ ok: true, ensured: (data ?? []).length, ...(await listAudienceInventory(db)) });
      }
      const parsed = await definitionFromBody(db, body);
      if (!parsed.ok) return json({ error: "validation_error", detail: parsed.detail }, 400);
      const created_by = await adminUserId(db, req);
      const { data: row, error } = await db.from("ad_list_audiences")
        .upsert({ ...parsed.row, created_by, status: "active", requested_at: new Date().toISOString() }, {
          onConflict: "audience_key",
        }).select("id").single();
      if (error) throw error;
      const { error: refreshError } = await db.rpc("ad_list_audience_refresh", { p_audience_id: row.id });
      if (refreshError && refreshError.code !== "PT409") throw refreshError;
      return json({ ok: true, ...(await listAudienceInventory(db)) });
    }

    if (action === "retire_definition") {
      const key = typeof body.audience_key === "string" ? body.audience_key : "";
      const { data, error } = await db.from("ad_list_audiences")
        .update({ status: "retired", updated_at: new Date().toISOString() })
        .eq("audience_key", key).select("id");
      if (error) throw error;
      if (!data?.length) return json({ error: "validation_error", detail: "audience_not_found" }, 404);
      return json({ ok: true, ...(await listAudienceInventory(db)) });
    }

    if (action === "preview") {
      // A throwaway definition, refreshed and deleted in the same request:
      // only counts leave the database.
      const parsed = await definitionFromBody(db, body);
      if (!parsed.ok) return json({ error: "validation_error", detail: parsed.detail }, 400);
      if (parsed.row.kind === "lookalike") {
        const { data: seed } = await db.from("ad_list_audiences").select("member_count_by_country")
          .eq("id", parsed.row.seed_audience_id).maybeSingle();
        const country = String(parsed.row.lookalike_country);
        const n = Number(record(seed?.member_count_by_country)[country] ?? 0);
        return json({ ok: true, member_count: n, by_country: { [country]: n } });
      }
      const previewKey = `mingla:preview:${crypto.randomUUID().replace(/-/g, "")}`;
      const { data: row, error } = await db.from("ad_list_audiences")
        .insert({ ...parsed.row, audience_key: previewKey, status: "active" })
        .select("id").single();
      if (error) throw error;
      try {
        const { data: counts, error: refreshError } = await db.rpc("ad_list_audience_refresh", {
          p_audience_id: row.id,
        });
        if (refreshError) throw refreshError;
        const { data: after } = await db.from("ad_list_audiences")
          .select("member_count_by_country").eq("id", row.id).maybeSingle();
        return json({
          ok: true,
          member_count: Number(record(counts).member_count ?? 0),
          by_country: record(after?.member_count_by_country),
        });
      } finally {
        await db.from("ad_list_audiences").delete().eq("id", row.id);
      }
    }

    if (action === "check_terms" || action === "confirm_terms") {
      const connectionId = typeof body.connection_id === "string" ? body.connection_id : "";
      if (!UUID_RE.test(connectionId)) {
        return json({ error: "validation_error", detail: "connection_id_invalid" }, 400);
      }
      const { data: connection } = await db.from("ad_connections").select("*")
        .eq("id", connectionId).maybeSingle();
      if (!connection) return json({ error: "validation_error", detail: "connection_not_found" }, 404);
      const nowIso = new Date().toISOString();
      if (action === "confirm_terms") {
        // Records the Admin's own acceptance in the provider UI. No provider
        // call is made, and nothing is accepted on anyone's behalf.
        const { error } = await db.from("ad_platform_audience_terms").upsert({
          connection_id: connectionId,
          platform: connection.platform,
          admin_confirmed_at: nowIso,
          admin_confirmed_by: await adminUserId(db, req),
          ...(connection.platform === "google" ? {} : { state: "accepted" }),
          updated_at: nowIso,
        }, { onConflict: "connection_id" });
        if (error) throw error;
        return json({ ok: true, ...(await listAudienceInventory(db)) });
      }
      let state = "unknown";
      let eligibility = "unknown";
      let detail: string | null = null;
      try {
        if (connection.platform === "meta") {
          const request = buildMetaTermsRead(connection.external_account_id);
          state = parseMetaTerms(
            await metaGraph(resolveMetaClient(connection as AdConnectionRow), "GET", request.path, request.body),
          );
        } else if (connection.platform === "google") {
          // Customer Match targeting needs more than USD 50,000 lifetime spend.
          const { data: spend } = await db.from("ad_spend_daily").select("spend_cents,currency")
            .eq("platform", "google");
          const usd = (spend ?? []).filter((row: Record<string, unknown>) => row.currency === "USD")
            .reduce((sum: number, row: Record<string, unknown>) => sum + Number(row.spend_cents ?? 0), 0);
          eligibility = usd > 5_000_000 ? "eligible" : "ineligible";
          detail = eligibility === "eligible" ? null : "google_lifetime_spend_below_50k";
        } else {
          // Snap, TikTok and Reddit have no documented terms read; a terms
          // error during sync records not_accepted.
          detail = "terms_detected_on_first_upload";
        }
      } catch (error) {
        detail = listAudienceErrorCode(error);
      }
      const { data: existing } = await db.from("ad_platform_audience_terms").select("*")
        .eq("connection_id", connectionId).maybeSingle();
      const { error } = await db.from("ad_platform_audience_terms").upsert({
        connection_id: connectionId,
        platform: connection.platform,
        state: state === "unknown" ? existing?.state ?? "unknown" : state,
        eligibility: eligibility === "unknown" ? existing?.eligibility ?? "unknown" : eligibility,
        checked_at: nowIso,
        detail_code: detail,
        updated_at: nowIso,
      }, { onConflict: "connection_id" });
      if (error) throw error;
      return json({ ok: true, ...(await listAudienceInventory(db)) });
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
    const inventory = await listAudienceInventory(db);
    return json({
      ok: true,
      audiences: (latest ?? []).map((row: Record<string, unknown>) => ({
        ...row,
        brand_name: record(row.brand).name ?? null,
        event_name: record(row.event).title ?? null,
        brand: undefined,
        event: undefined,
      })),
      ...inventory,
    });
  } catch (error) {
    console.error("[admin-ad-audiences]", publicError(error));
    return json({
      error: "audience_operation_failed",
      message: publicError(error),
    }, 502);
  }
});
