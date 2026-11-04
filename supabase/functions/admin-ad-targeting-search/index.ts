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
 *   - TikTok city: tool/targeting/search FUZZY_SEARCH (city/district/DMA) →
 *     numeric location_ids (ISSUE-1289 — the old tool/region level==="CITY" filter
 *     could not see US municipalities, which are DISTRICT-level, so it silently
 *     fell back to country). TikTok interest: tool/interest_category → ids.
 *   - Google city: geoTargetConstants:suggest (countryCode-scoped, exact-name
 *            confirmation — the create path re-resolves by name at build time).
 *   - Reddit interest/community: Reddit targeting takes NAMES (the serializer
 *            accepts arbitrary community/interest names) — the query passes
 *            through as a candidate name; no unproven upstream lookup is invented.
 *   - Snapchat: city names are selected without exposing coordinates; ad-plan
 *            geocodes them server-side into the immutable compiled snapshot.
 *            SCLS interest IDs and demographics are frozen and delivered from
 *            that same snapshot.
 *
 * FAIL-OPEN (house style): a provider error / not-connected channel returns
 * 200 { results: [], warning } — a broken typeahead must never block the wizard.
 * Only auth (401/403) and input validation (400) hard-fail.
 *
 * verify_jwt = true. Active admins may search either lane; an authenticated
 * Host planner (owner_kind "host") searches the lane adLaneForOwner("host")
 * decides (#4238 D1: Mingla's consumer accounts) for a brand where
 * ad_can_host_action(..., plan) is true. A Host request naming another lane is
 * refused with lane_owner_mismatch. Authorization still precedes input
 * validation. No token ever appears in a response — shared adapters send
 * Bearer headers and normalize/scrub provider errors.
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
  type Lane,
  type Platform,
} from "../_shared/adChannel.ts";
import {
  hostSafeSearchWarning,
  resolveOwnerLane,
} from "../_shared/adChannelCore.ts";
import {
  metaSearch,
  parseMetaGeoResults,
  parseMetaInterestResults,
  resolveMetaClient,
} from "../_shared/meta.ts";
import {
  filterTikTokInterestCategories,
  resolveTikTokClient,
  tiktokFetchInterestCategories,
  tiktokResolvePlace,
} from "../_shared/tiktok.ts";
import {
  resolveGoogleClient,
  searchGoogleUserInterests,
  suggestGeoTargetCandidates,
  suggestGeoTargetConstants,
} from "../_shared/google.ts";
import {
  HOST_AD_LANGUAGES,
  searchMatch,
} from "../_shared/adTargetingMatch.ts";
import {
  resolveSnapchatClient,
  snapchatFetchInterests,
} from "../_shared/snapchat.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export interface TargetingSearchResult {
  id: string;
  name: string;
  meta: Record<string, unknown>;
}

/**
 * The kinds the wizard can search for. #4238 adds region (state/province),
 * pin (an address the server turns into a point) and language.
 */
const KINDS = ["city", "interest", "region", "pin", "language"] as const;
type Kind = (typeof KINDS)[number];

/**
 * One app's lookup: its results, plus results one level up (TikTok PROVINCE)
 * and, when both are empty, the app's whole country (TikTok, #4238).
 */
type ResolveOut = {
  results: TargetingSearchResult[];
  wider?: TargetingSearchResult[];
  country?: TargetingSearchResult;
  warning?: string;
};

function languageResults(q: string): TargetingSearchResult[] {
  const query = q.trim().toLowerCase();
  return HOST_AD_LANGUAGES
    .filter((row) =>
      row.code === query || row.name.toLowerCase().startsWith(query)
    )
    .map((row) => ({
      id: row.code,
      name: row.name,
      meta: { code: row.code, google_language_id: row.google },
    }));
}


/**
 * Pure fail-open surface for a provider error — never leaks a token (the
 * adapters normalize + scrub), always a short, user-safe note.
 */
function failOpen(
  err: unknown,
  hostCaller = false,
): { results: []; warning: string; unavailable: true } {
  // #4238 I-4238-ERROR-IS-NOT-MISSING: an app error is flagged so no caller
  // records it as "not found". The empty list keeps the old fail-open shape.
  // #4238 D6: a Host never sees provider text (it can name secrets or IDs).
  if (hostCaller) {
    return {
      results: [],
      warning: hostSafeSearchWarning(err),
      unavailable: true,
    };
  }
  const warning = err instanceof AdApiError
    ? err.message
    : err instanceof AdNotConnectedError
    ? "That channel isn't connected — connect it to search its targeting."
    : err instanceof Error
    ? err.message
    : "Search is unavailable right now.";
  return { results: [], warning, unavailable: true };
}

async function resolveMeta(
  conn: AdConnectionRow | null,
  kind: Kind,
  q: string,
  country: string | null,
): Promise<ResolveOut> {
  const client = resolveMetaClient(conn ?? undefined);
  if (kind === "language") {
    // #4238: Meta targets languages by its own locale keys (read-only search).
    const payload = await metaSearch(client, { type: "adlocale", q, limit: "10" });
    const data = Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: Record<string, unknown>[] }).data
      : [];
    return {
      results: data.flatMap((row) => {
        const key = typeof row.key === "number" || typeof row.key === "string"
          ? String(row.key)
          : "";
        const name = typeof row.name === "string" ? row.name : "";
        return key && name ? [{ id: key, name, meta: { locale_key: key } }] : [];
      }),
    };
  }
  if (kind === "city" || kind === "region") {
    // country_code disambiguation is MANDATORY (the London/Canada hazard).
    const payload = await metaSearch(client, {
      type: "adgeolocation",
      location_types: [kind === "region" ? "region" : "city"],
      q,
      limit: "15",
      ...(country ? { country_code: country } : {}),
    });
    const results = parseMetaGeoResults(payload).map((r) => ({
      id: r.key,
      name: r.region
        ? `${r.name}, ${r.region}, ${r.country_code ?? ""}`.replace(/,\s*$/, "")
        : r.name,
      meta: {
        key: r.key,
        city: r.name,
        region: r.region,
        country_code: r.country_code,
        supports_region: r.supports_region,
        type: r.type,
        level: kind === "region" ? "REGION" : String(r.type ?? "city").toUpperCase(),
      },
    }));
    return {
      results,
      ...(country
        ? {}
        : { warning: "Add a country to disambiguate the city." }),
    };
  }
  const payload = await metaSearch(client, {
    type: "adinterest",
    q,
    limit: "15",
  });
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
): Promise<ResolveOut> {
  if (kind === "language") return { results: languageResults(q) };
  if (!conn) throw new AdNotConnectedError("tiktok", "tiktok_not_connected");
  const client = resolveTikTokClient(conn);
  if (kind === "city" || kind === "region") {
    // ISSUE-1289 + #4238: tiktokResolvePlace looks the place up at its own
    // level (city via FUZZY_SEARCH city/district/DMA geo_ids), then one level
    // up (PROVINCE), then the whole country. The matcher offers the wider
    // area for the Host to accept; it is never used silently.
    const out = await tiktokResolvePlace(client, { kind, q, country });
    return {
      ...out,
      ...(kind === "city" && out.results.length === 0
        ? {
          warning: `TikTok has no city-level match for "${q}"${
            country ? ` in ${country}` : ""
          } — this campaign will target the country instead.`,
        }
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
  wantMatch = false,
): Promise<ResolveOut> {
  if (kind === "language") return { results: languageResults(q) };
  if (kind === "interest") {
    // ISSUE-992 (3b): real affinity / in-market audiences via user_interest
    // search (replaces the old deferred stub). Account/policy-gated (G-4) — a
    // fresh account may 403; the fail-open wrapper degrades honestly.
    if (!conn) throw new AdNotConnectedError("google", "google_not_connected");
    const gclient = await resolveGoogleClient(conn);
    const interests = await searchGoogleUserInterests(gclient, q);
    return {
      results: interests.map((i) => ({
        id: i.id,
        name: i.name,
        meta: { user_interest_id: i.id, taxonomy_type: i.taxonomyType },
      })),
    };
  }
  if (!country) {
    return {
      results: [],
      warning: "Add a country to resolve a Google location.",
    };
  }
  if (!conn) throw new AdNotConnectedError("google", "google_not_connected");
  const client = await resolveGoogleClient(conn);
  if (wantMatch || kind === "region") {
    // #4238: Google's own candidates in this country; the matcher picks.
    const candidates = await suggestGeoTargetCandidates(client, {
      name: q,
      countryCode: country,
    });
    const toResult = (row: typeof candidates[number]) => ({
      id: row.criterionId,
      name: row.canonicalName,
      meta: {
        criterion_id: row.criterionId,
        name: row.name,
        canonical_name: row.canonicalName,
        country_code: row.countryCode,
        target_type: row.targetType,
        level: String(row.targetType ?? "").toUpperCase(),
      },
    });
    return { results: candidates.map(toResult) };
  }
  // Exact-name confirmation (the create path re-resolves by name+country_code).
  const resolved = await suggestGeoTargetConstants(client, {
    name: q,
    countryCode: country,
  });
  if (!resolved) {
    return {
      results: [],
      warning: `Google found no ENABLED "${q}" in ${country}.`,
    };
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

async function resolveSnapchat(
  conn: AdConnectionRow | null,
  kind: Kind,
  q: string,
): Promise<ResolveOut> {
  if (kind === "language") return { results: languageResults(q) };
  if (kind === "interest") {
    // ISSUE-992 (3a): real SCLS interest-segment resolution (replaces the old
    // deferred fail-open stub).
    if (!conn) {
      throw new AdNotConnectedError("snapchat", "snapchat_not_connected");
    }
    const client = await resolveSnapchatClient(conn);
    const interests = await snapchatFetchInterests(client, q);
    return {
      results: interests.map((i) => ({
        id: i.id,
        name: i.name,
        meta: { category_id: i.id, scls: true },
      })),
    };
  }
  // ISSUE-992 (3a) city: PASSTHROUGH echo of the typed name (like Reddit). The
  // create path re-geocodes server-side (§4) so coordinates NEVER reach the
  // browser — no Mapbox call here. The chip carries { label, country } from the
  // shared Meta geo dictionary; that is enough for the create-time geocode.
  const name = q.trim();
  if (!name) return { results: [] };
  return {
    results: [{
      id: name,
      name,
      meta: {
        circle_passthrough: true,
        level: kind === "region" ? "REGION" : "CITY",
      },
    }],
  };
}

function resolveReddit(
  kind: Kind,
  q: string,
): ResolveOut {
  if (kind === "language") return { results: languageResults(q) };
  if (kind === "city" || kind === "region") {
    return {
      results: [],
      warning:
        "Reddit targets by country/metro, not city — this campaign uses the countries you picked.",
    };
  }
  // Reddit targeting takes NAMES verbatim (serializeRedditTargeting accepts
  // community/interest names). No unproven upstream lookup is invented — the
  // typed value passes through as a usable name.
  const name = q.trim();
  if (!name) return { results: [] };
  return {
    results: [{
      id: name,
      name,
      meta: { kind: "interest", passthrough: true },
    }],
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // ── AUTHORIZATION FIRST (no pre-auth probe surface). ────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    token,
  );
  if (authError || !user) return json({ error: "unauthorized" }, 401);
  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .eq("status", "active")
    .maybeSingle();
  // #4238: Host callers say who they are (owner_kind "host") and send no lane;
  // the lane comes from adLaneForOwner on the server.
  const hostCaller = body.owner_kind === "host";
  const requestedBrandId = typeof body.brand_id === "string"
    ? body.brand_id.trim()
    : "";
  if (!adminRow) {
    if (!hostCaller || !UUID_RE.test(requestedBrandId)) {
      return json({ error: "forbidden" }, 403);
    }
    const { data: canPlan, error: permissionError } = await supabase.rpc(
      "ad_can_host_action",
      {
        p_brand_id: requestedBrandId,
        p_user_id: user.id,
        p_action: "plan",
      },
    );
    if (permissionError || canPlan !== true) {
      return json({ error: "forbidden" }, 403);
    }
  }

  // ── Input validation. ────────────────────────────────────────────────────────
  const platform = body.platform;
  const laneResolution = resolveOwnerLane(
    hostCaller ? "host" : "mingla",
    body.lane,
  );
  const kind = body.kind;
  const q = typeof body.q === "string" ? body.q.trim() : "";
  const country = typeof body.country === "string" && body.country.trim()
    ? body.country.trim().toUpperCase()
    : null;
  if (!isPlatform(platform)) {
    return json({ error: "validation_error", detail: "platform_invalid" }, 400);
  }
  if (!laneResolution.ok) {
    return laneResolution.detail === "lane_owner_mismatch"
      ? json({ error: "validation_error", detail: "lane_owner_mismatch" }, 422)
      : json({ error: "validation_error", detail: "lane_invalid" }, 400);
  }
  const lane = laneResolution.lane;
  if (!isLane(lane)) {
    return json({ error: "validation_error", detail: "lane_invalid" }, 400);
  }
  if (
    typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)
  ) {
    return json({
      error: "validation_error",
      detail:
        "kind_invalid — expected 'city' | 'interest' | 'region' | 'pin' | 'language'",
    }, 400);
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

  const wantMatch = body.match === true;
  try {
    let out: ResolveOut;
    if (k === "pin") {
      // #4238: a pin is an address. Like Snapchat cities, the point is found
      // on the server when the plan is checked (ad-plan), so coordinates
      // never reach the browser (ISSUE-992). Every app shares the pin; TikTok
      // and Reddit use the wider area.
      out = {
        results: [{
          id: `pin:${q.toLowerCase()}`,
          name: q,
          meta: { pin_passthrough: true, level: "PIN", country_code: country },
        }],
      };
    } else if (p === "meta") out = await resolveMeta(conn, k, q, country);
    else if (p === "tiktok") out = await resolveTikTok(conn, k, q, country);
    else if (p === "google") {
      out = await resolveGoogle(conn, k, q, country, wantMatch);
    } else if (p === "reddit") out = resolveReddit(k, q);
    else out = await resolveSnapchat(conn, k, q); // ISSUE-992 (3a): city passthrough + SCLS interests
    return json(wantMatch ? { ...out, match: searchMatch(k, q, out) } : out);
  } catch (err) {
    // FAIL-OPEN: never block the wizard on a provider error.
    return json(failOpen(err, hostCaller));
  }
});
