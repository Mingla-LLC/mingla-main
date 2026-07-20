/**
 * admin-ad-targeting-search — ISSUE-989 [Campaign Builder real targeting].
 *
 * The admin-gated, READ-ONLY targeting resolver the Campaign Builder's Audience
 * step calls to turn a typed place/interest NAME into the per-platform targeting
 * keys/IDs the create path needs. It creates NOTHING — every branch is a search.
 *
 * Body: { platform, kind: 'city' | 'interest', q, country? }
 * Returns: { results: [{ id, name, meta }], warning? }
 *
 * Per-platform resolvers reuse the exact green probe code:
 *   - Meta   city: /search?type=adgeolocation&location_types=["city"]&country_code=<cc>
 *            (country_code scoping is MANDATORY — 'London' unscoped ranks
 *            London,NJ + London,Ontario ABOVE London,England; PROVEN 2026-07-20).
 *            The same call admin-ad-preflight P6 runs green.
 *     Meta   interest: /search?type=adinterest → flexible_spec interest ids.
 *   - TikTok city: tool/region (level==="CITY") filtered by country → location_ids.
 *     TikTok interest: tool/interest_category → interest_category_ids.
 *   - Google city: geoTargetConstants:suggest (countryCode-scoped, exact-name
 *            confirmation — the create path re-resolves by name at build time).
 *   - Reddit interest/community: Reddit targeting takes NAMES (the serializer
 *            accepts arbitrary community/interest names) — the query passes
 *            through as a candidate name; no unproven upstream lookup is invented.
 *   - Snapchat: city-circle + interest-segment CONSUMPTION is not wired in the
 *            create path yet (ISSUE-989 split) — fail-open with a clear note so
 *            the builder degrades to Snap demographics + country. Snap age/gender
 *            DO travel (targeting.demographics), fixing the silent drop.
 *
 * FAIL-OPEN (house style): a provider error / not-connected channel returns
 * 200 { results: [], warning } — a broken typeahead must never block the wizard.
 * Only auth (401/403) and input validation (400) hard-fail.
 *
 * verify_jwt = true (config.toml) + in-code admin_users active gate (mirrors
 * admin-ad-connect / -preflight / -create-campaign, admin-gate FIRST). No token
 * ever appears in a response — the shared adapters send Bearer headers and
 * normalize/scrub provider errors.
 */

// @ts-ignore — Deno ESM import; types resolved at runtime.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore — Deno ESM import; types resolved at runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AdApiError,
  AdNotConnectedError,
  type AdConnectionRow,
  isLane,
  isPlatform,
  type Lane,
  type Platform,
} from "../_shared/adChannel.ts";
import {
  metaSearch,
  parseMetaGeoResults,
  parseMetaInterestResults,
  resolveMetaClient,
} from "../_shared/meta.ts";
import {
  filterTikTokCityRegions,
  filterTikTokInterestCategories,
  resolveTikTokClient,
  tiktokFetchInterestCategories,
  tiktokFetchRegions,
} from "../_shared/tiktok.ts";
import { resolveGoogleClient, suggestGeoTargetConstants } from "../_shared/google.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export interface TargetingSearchResult {
  id: string;
  name: string;
  meta: Record<string, unknown>;
}

/** The kinds the wizard can search for. */
const KINDS = ["city", "interest"] as const;
type Kind = (typeof KINDS)[number];

/**
 * Pure fail-open surface for a provider error — never leaks a token (the
 * adapters normalize + scrub), always a short, user-safe note.
 */
function failOpen(err: unknown): { results: []; warning: string } {
  const warning = err instanceof AdApiError
    ? err.message
    : err instanceof AdNotConnectedError
    ? "That channel isn't connected — connect it to search its targeting."
    : err instanceof Error
    ? err.message
    : "Search is unavailable right now.";
  return { results: [], warning };
}

async function resolveMeta(
  conn: AdConnectionRow | null,
  kind: Kind,
  q: string,
  country: string | null,
): Promise<{ results: TargetingSearchResult[]; warning?: string }> {
  const client = resolveMetaClient(conn ?? undefined);
  if (kind === "city") {
    // country_code disambiguation is MANDATORY (the London/Canada hazard).
    const payload = await metaSearch(client, {
      type: "adgeolocation",
      location_types: ["city"],
      q,
      limit: "15",
      ...(country ? { country_code: country } : {}),
    });
    const results = parseMetaGeoResults(payload).map((r) => ({
      id: r.key,
      name: r.region ? `${r.name}, ${r.region}, ${r.country_code ?? ""}`.replace(/,\s*$/, "") : r.name,
      meta: {
        key: r.key,
        city: r.name,
        region: r.region,
        country_code: r.country_code,
        supports_region: r.supports_region,
        type: r.type,
      },
    }));
    return { results, ...(country ? {} : { warning: "Add a country to disambiguate the city." }) };
  }
  const payload = await metaSearch(client, { type: "adinterest", q, limit: "15" });
  const results = parseMetaInterestResults(payload).map((r) => ({
    id: r.id,
    name: r.name,
    meta: {
      id: r.id,
      audience_size_lower_bound: r.audience_size_lower_bound,
      audience_size_upper_bound: r.audience_size_upper_bound,
    },
  }));
  return { results };
}

async function resolveTikTok(
  conn: AdConnectionRow | null,
  kind: Kind,
  q: string,
  country: string | null,
): Promise<{ results: TargetingSearchResult[]; warning?: string }> {
  if (!conn) throw new AdNotConnectedError("tiktok", "tiktok_not_connected");
  const client = resolveTikTokClient(conn);
  if (kind === "city") {
    const regions = await tiktokFetchRegions(client, { objective: "TRAFFIC" });
    const cities = filterTikTokCityRegions(regions, { country: country ?? undefined, q });
    const results = cities.map((r) => ({
      id: r.locationId,
      name: r.name ?? r.locationId,
      meta: { location_id: r.locationId, region_code: r.regionCode, level: r.level },
    }));
    return {
      results,
      ...(results.length === 0
        ? { warning: `TikTok has no city match for "${q}"${country ? ` in ${country}` : ""} — it falls back to country targeting.` }
        : {}),
    };
  }
  const categories = await tiktokFetchInterestCategories(client);
  const matched = filterTikTokInterestCategories(categories, { q });
  const results = matched.map((c) => ({
    id: c.id,
    name: c.name,
    meta: { interest_category_id: c.id, level: c.level },
  }));
  return { results };
}

async function resolveGoogle(
  conn: AdConnectionRow | null,
  kind: Kind,
  q: string,
  country: string | null,
): Promise<{ results: TargetingSearchResult[]; warning?: string }> {
  if (kind !== "city") {
    return { results: [], warning: "Google audiences (affinity / in-market) aren't wired yet — keywords carry search intent." };
  }
  if (!country) return { results: [], warning: "Add a country to resolve a Google location." };
  if (!conn) throw new AdNotConnectedError("google", "google_not_connected");
  const client = await resolveGoogleClient(conn);
  // Exact-name confirmation (the create path re-resolves by name+country_code).
  const resolved = await suggestGeoTargetConstants(client, { name: q, countryCode: country });
  if (!resolved) {
    return { results: [], warning: `Google found no ENABLED "${q}" in ${country}.` };
  }
  return {
    results: [{
      id: resolved.criterionId,
      name: resolved.canonicalName,
      meta: {
        criterion_id: resolved.criterionId,
        name: resolved.name,
        canonical_name: resolved.canonicalName,
        country_code: resolved.countryCode,
        target_type: resolved.targetType,
      },
    }],
  };
}

function resolveReddit(
  kind: Kind,
  q: string,
): { results: TargetingSearchResult[]; warning?: string } {
  if (kind === "city") {
    return { results: [], warning: "Reddit targets by country/metro, not city — this campaign uses the countries you picked." };
  }
  // Reddit targeting takes NAMES verbatim (serializeRedditTargeting accepts
  // community/interest names). No unproven upstream lookup is invented — the
  // typed value passes through as a usable name.
  const name = q.trim();
  if (!name) return { results: [] };
  return {
    results: [{ id: name, name, meta: { kind: "interest", passthrough: true } }],
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // ── ADMIN GATE FIRST (auth precedes input validation — mirrors the sibling
  //    admin-ad-* fns; no pre-auth probe surface). ──────────────────────────────
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

  // ── Input validation. ────────────────────────────────────────────────────────
  const platform = body.platform;
  const lane = body.lane ?? "consumer";
  const kind = body.kind;
  const q = typeof body.q === "string" ? body.q.trim() : "";
  const country = typeof body.country === "string" && body.country.trim()
    ? body.country.trim().toUpperCase()
    : null;
  if (!isPlatform(platform)) return json({ error: "validation_error", detail: "platform_invalid" }, 400);
  if (!isLane(lane)) return json({ error: "validation_error", detail: "lane_invalid" }, 400);
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) {
    return json({ error: "validation_error", detail: "kind_invalid — expected 'city' | 'interest'" }, 400);
  }
  if (!q) return json({ error: "validation_error", detail: "q_required" }, 400);

  const p = platform as Platform;
  const l = lane as Lane;
  const k = kind as Kind;

  // Reddit needs no connection lookup (name passthrough); everyone else loads the row.
  let conn: AdConnectionRow | null = null;
  if (p !== "reddit") {
    const { data } = await supabase
      .from("ad_connections")
      .select("*")
      .eq("platform", p)
      .eq("lane", l)
      .maybeSingle();
    conn = (data ?? null) as AdConnectionRow | null;
  }

  try {
    let out: { results: TargetingSearchResult[]; warning?: string };
    if (p === "meta") out = await resolveMeta(conn, k, q, country);
    else if (p === "tiktok") out = await resolveTikTok(conn, k, q, country);
    else if (p === "google") out = await resolveGoogle(conn, k, q, country);
    else if (p === "reddit") out = resolveReddit(k, q);
    else {
      // Snapchat — city circles + interest segments consumption deferred (ISSUE-989
      // split). Snap still gets age/gender via targeting.demographics on create.
      out = {
        results: [],
        warning: k === "city"
          ? "Snapchat city radius targeting is coming — this campaign uses the countries + age/gender you picked."
          : "Snapchat interest segments are coming — this campaign uses the countries + age/gender you picked.",
      };
    }
    return json(out);
  } catch (err) {
    // FAIL-OPEN: never block the wizard on a provider error.
    return json(failOpen(err));
  }
});
