// Issue #4275 test support: a deterministic fake PostgREST behind globalThis.fetch.
// It answers the single and batch ranked lookups from one data set with the same
// rules as the SQL, and counts every request, so old and new paths can be compared
// and fan-out can be measured. Not product code; never imported at deploy time.

export const USER = { lat: 35.78, lng: -78.64 };

type Place = Record<string, unknown> & {
  id: string; lat: number; lng: number; types: string[]; primary_type: string; signals: string[];
};

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makePlace(tag: string, index: number, signals: string[], types: string[], primaryType: string): Place {
  // A tight cloud around the user, so every stop is inside every radius used here.
  const dLat = ((hash(`${tag}${index}lat`) % 1000) / 1000 - 0.5) * 0.02;
  const dLng = ((hash(`${tag}${index}lng`) % 1000) / 1000 - 0.5) * 0.02;
  const id = `00000000-0000-4000-8000-${String(hash(`${tag}${index}`)).padStart(12, "0")}`;
  return {
    id,
    signals,
    google_place_id: `g-${tag}-${index}`,
    name: `${tag} ${index}`,
    address: `${index} ${tag} St`,
    lat: USER.lat + dLat,
    lng: USER.lng + dLng,
    rating: 4.2,
    review_count: 100 + index,
    price_level: null,
    price_range_start_cents: 2000,
    price_range_end_cents: 4000,
    opening_hours: null,
    website: null,
    stored_photo_urls: [`https://example.test/${tag}/${index}.jpg`],
    photos: [{ big: "payload" }],
    types,
    primary_type: primaryType,
    utc_offset_minutes: -300,
    city_id: null,
    city: "Test City",
    country: "US",
    ai_signal_scores: { romantic: { reasoning: `why ${tag} ${index}` } },
  };
}

const VIBES = ["romantic", "icebreakers", "lively", "scenic", "picnic_friendly"];

function buildPool(): Place[] {
  const pool: Place[] = [];
  const add = (tag: string, count: number, signal: string, types: string[], primaryType: string) => {
    for (let i = 0; i < count; i += 1) pool.push(makePlace(tag, i, [signal, ...VIBES], types, primaryType));
  };
  add("nature", 60, "nature", ["park", "hiking_area"], "park");
  add("groceries", 120, "groceries", ["grocery_store"], "grocery_store");
  add("flowers", 120, "flowers", ["florist"], "florist");
  add("casual", 60, "casual_food", ["restaurant"], "restaurant");
  add("fine", 60, "fine_dining", ["restaurant"], "restaurant");
  add("brunch", 40, "brunch", ["restaurant"], "restaurant");
  add("drinks", 40, "drinks", ["bar"], "bar");
  add("play", 40, "play", ["amusement_center"], "amusement_center");
  add("theatre", 40, "theatre", ["performing_arts_theater"], "performing_arts_theater");
  add("movies", 30, "movies", ["movie_theater"], "movie_theater");
  add("art", 30, "creative_arts", ["art_gallery"], "art_gallery");
  add("museum", 30, "creative_arts", ["museum"], "museum");
  // Failure shapes the photo gate must drop.
  const noPhoto = makePlace("nophoto", 0, ["nature", ...VIBES], ["park"], "park");
  noPhoto.stored_photo_urls = [];
  const failedPhoto = makePlace("failedphoto", 0, ["nature", ...VIBES], ["park"], "park");
  failedPhoto.stored_photo_urls = ["__backfill_failed__"];
  pool.push(noPhoto, failedPhoto);
  return pool;
}

function rank(place: Place, rankSignal: string): number {
  return hash(`${place.id}:${rankSignal}`) % 200;
}

export function rankedLookup(pool: Place[], args: Record<string, any>): Array<{ place_id: string; rank_score: number }> {
  return pool
    .filter((p) =>
      p.signals.includes(args.p_filter_signal) &&
      p.signals.includes(args.p_rank_signal) &&
      p.lat >= args.p_lat_min && p.lat <= args.p_lat_max &&
      p.lng >= args.p_lng_min && p.lng <= args.p_lng_max &&
      (!args.p_required_types || p.types.some((t) => args.p_required_types.includes(t))) &&
      ((!args.p_primary_type_required && !args.p_grocery_floral_tag) ||
        (args.p_primary_type_required?.includes(p.primary_type)) ||
        (args.p_grocery_floral_tag && ["grocery_store", "supermarket"].includes(p.primary_type) && p.types.includes("florist")))
    )
    .map((p) => ({ place_id: p.id, rank_score: rank(p, args.p_rank_signal) }))
    .sort((a, b) => b.rank_score - a.rank_score || a.place_id.localeCompare(b.place_id))
    .slice(0, args.p_limit);
}

const hydrate = (place: Place): Record<string, unknown> => {
  const { signals: _signals, photos: _photos, ...row } = place;
  return row;
};

export interface FakeBackend {
  counts: Record<string, number>;
  /** Largest batch of ranked requests seen. */
  maxBatch: () => number;
  /** Every near-batch size, in order. */
  batchSizes: number[];
  install: () => void;
  uninstall: () => void;
  reset: () => void;
}

export function createFakeBackend(options: { batchRpcLive?: boolean; hydrateRpcLive?: boolean } = {}): FakeBackend {
  const batchRpcLive = options.batchRpcLive ?? true;
  const hydrateRpcLive = options.hydrateRpcLive ?? true;
  const pool = buildPool();
  const byId = new Map(pool.map((p) => [p.id, p]));
  const counts: Record<string, number> = {};
  const batchSizes: number[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const notFound = (name: string) =>
    json({ code: "PGRST202", message: `Could not find the function public.${name}`, details: null, hint: null }, 404);

  const fake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input));
    const bodyText = init?.body ? String(init.body) : request ? await request.clone().text() : "";
    const path = url.pathname;
    const count = (key: string) => {
      counts[key] = (counts[key] ?? 0) + 1;
    };

    if (path.includes("/auth/v1/user")) {
      count("auth_get_user");
      return json({ id: "x" });
    }
    if (path.endsWith("/rpc/fetch_local_signal_ranked")) {
      count("ranked_single");
      return json(rankedLookup(pool, JSON.parse(bodyText)));
    }
    if (path.endsWith("/rpc/fetch_local_signal_ranked_batch")) {
      count("ranked_batch");
      if (!batchRpcLive) return notFound("fetch_local_signal_ranked_batch");
      const { p_requests: requests } = JSON.parse(bodyText) as { p_requests: Array<Record<string, unknown>> };
      batchSizes.push(requests.length);
      return json(requests.flatMap((args, request_index) =>
        rankedLookup(pool, args).map((row) => ({ request_index, ...row }))
      ));
    }
    if (path.endsWith("/rpc/fetch_feed_places_by_ids")) {
      count("hydrate_rpc");
      if (!hydrateRpcLive) return notFound("fetch_feed_places_by_ids");
      const { p_ids: ids } = JSON.parse(bodyText) as { p_ids: string[] };
      return json(ids.map((id) => byId.get(id)).filter(Boolean).map((p) => hydrate(p as Place)));
    }
    if (path.endsWith("/place_pool")) {
      const idFilter = url.searchParams.get("id") ?? "";
      const ids = idFilter.replace(/^in\.\(/, "").replace(/\)$/, "").split(",").map((id) => id.replaceAll('"', ""));
      const select = url.searchParams.get("select") ?? "";
      if (select.includes("stored_photo_urls")) {
        count("hydrate_select");
        return json(ids.map((id) => byId.get(id)).filter(Boolean).map((p) => hydrate(p as Place)));
      }
      count("place_pool_other");
      return json([]);
    }
    count(`other:${path}`);
    return json([]);
  };

  return {
    counts,
    batchSizes,
    maxBatch: () => Math.max(0, ...batchSizes),
    install: () => {
      globalThis.fetch = fake as typeof fetch;
    },
    uninstall: () => {
      // Not the real fetch: the handler's background teaser work may still be
      // running, and a test must never reach the network.
      globalThis.fetch = (() => Promise.resolve(json([]))) as typeof fetch;
    },
    reset: () => {
      for (const key of Object.keys(counts)) delete counts[key];
      batchSizes.length = 0;
    },
  };
}

export function curatedRequest(body: Record<string, unknown>): Request {
  return new Request("http://local.test/generate-curated-experiences", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
    body: JSON.stringify({
      location: USER,
      travelMode: "driving",
      travelConstraintType: "time",
      travelConstraintValue: 60,
      skipDescriptions: true,
      batchSeed: 7,
      dateOption: "this_weekend",
      ...body,
    }),
  });
}

/** Ids, tagline and match score carry Math.random noise; everything else must match. */
export function comparableCards(cards: Array<Record<string, unknown>>): unknown {
  return cards.map(({ id: _id, tagline: _tagline, matchScore: _matchScore, ...rest }) => rest);
}

export const SIX_TYPES = ["adventurous", "first-date", "romantic", "group-fun", "take-a-stroll", "picnic-dates"];
export const LIMITS = [5, 10, 200, 10000];

export function setCuratedEnv(): void {
  Deno.env.set("SUPABASE_URL", "http://fake.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  Deno.env.set("SUPABASE_ANON_KEY", "anon-key");
  Deno.env.delete("OPENAI_API_KEY");
}
