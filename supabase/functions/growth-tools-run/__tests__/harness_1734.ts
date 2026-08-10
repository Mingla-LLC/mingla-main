// ISSUE-1734 [growth-tools shared platform] — shared TEST HARNESS for the
// dual-lane suites. NOT a test file (no .test.ts suffix — deno test ignores
// it); imported by the run/events/trips/pricing/report/gate suites.
//
// Stubs globalThis.fetch with:
//   • GoTrue GET /auth/v1/user            — token → user map (forged → 401)
//   • PostgREST /rest/v1/rpc/*            — scripted biz_is_brand_member_for_read
//   • PostgREST tables                    — in-memory rows for tool_leads,
//     tool_competitors, venue_listings, place_pool, place_scores with a mini
//     filter engine (eq/is.null/gte/neq/ilike + order/limit + select
//     projection incl. json-path aliases) and trigger/unique-index emulation
//     for tool_competitors (cap-5 + duplicate website)
//   • generativelanguage.googleapis.com   — scripted structured/grounded
//     responses + per-kind call counters (grounded = body carries "tools")
//   • api.resend.com                      — send recorder
//   • open-meteo / pexels                 — scripted failures (best-effort paths)
//   • any other URL                       — a tiny venue-site HTML page
//
// The stub speaks just enough PostgREST for supabase-js v2: GET arrays
// (maybeSingle post-processes), HEAD + Content-Range counts, POST insert with
// return=representation projection, PATCH/DELETE with 204.

export const STUB_URL = "https://stub.local";

Deno.env.set("SUPABASE_URL", STUB_URL);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub-service-role-key");
Deno.env.set("GEMINI_API_KEY", "stub-gemini-key");
Deno.env.set("RESEND_API_KEY", "stub-resend-key");

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;

export interface GeminiOptions {
  /** Parsed-JSON payload the STRUCTURED pass should produce (wrapped in candidates). */
  structuredPayload?: unknown;
  /** Parsed-JSON payload the GROUNDED pass should produce. */
  groundedPayload?: unknown;
  /** Non-200 HTTP status for the structured / grounded pass. */
  structuredStatus?: number;
  groundedStatus?: number;
  /** Reject the fetch with an AbortError (simulates a hung socket hitting its timeout). */
  abortStructured?: boolean;
  abortGrounded?: boolean;
}

export interface StubOptions {
  /** token → userId (any other bearer is a forged/expired JWT → 401). */
  users?: Record<string, string>;
  /** Membership oracle; return "error" to make the RPC fail (fail-closed test). */
  membership?: (brandId: string, userId: string) => boolean | "error";
  toolLeads?: Row[];
  toolCompetitors?: Row[];
  venueListings?: Row[];
  gemini?: GeminiOptions;
  /** Force the tool_leads HEAD count (quota/limiter) to error → fail-open path. */
  quotaCountError?: boolean;
}

export interface Stub {
  state: {
    toolLeads: Row[];
    toolCompetitors: Row[];
    venueListings: Row[];
    geminiCalls: { structured: number; grounded: number };
    resendSends: Row[];
    /** status transitions per tool_leads row id, in order. */
    statusLog: Record<string, string[]>;
    /** every intercepted request (leak checks assert on select-lists here). */
    requests: { method: string; url: string }[];
  };
  options: StubOptions;
  restore(): void;
}

function jsonRes(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// ── mini PostgREST filter/projection engine ──────────────────────────────────
const NON_FILTER_KEYS = new Set([
  "select",
  "order",
  "limit",
  "offset",
  "apikey",
  "on_conflict",
  "columns",
]);

function rowMatches(row: Row, params: URLSearchParams): boolean {
  for (const [key, value] of params.entries()) {
    if (NON_FILTER_KEYS.has(key)) continue;
    if (value === "is.null") {
      if (row[key] !== null && row[key] !== undefined) return false;
    } else if (value.startsWith("eq.")) {
      if (String(row[key]) !== value.slice(3)) return false;
    } else if (value.startsWith("gte.")) {
      if (!(String(row[key] ?? "") >= value.slice(4))) return false;
    } else if (value.startsWith("neq.")) {
      if (String(row[key]) === value.slice(4)) return false;
    } else if (value.startsWith("ilike.")) {
      // Pool searches in tests never match — good enough for the harness.
      return false;
    }
  }
  return true;
}

// Projection incl. PostgREST json-path aliases (alias:col->a->>b).
function projectRow(row: Row, select: string | null): Row {
  if (!select || select === "*") return { ...row };
  const out: Row = {};
  for (const rawCol of select.split(",")) {
    const col = rawCol.trim();
    let alias = col;
    let path = col;
    const colonIdx = col.indexOf(":");
    if (colonIdx > 0) {
      alias = col.slice(0, colonIdx);
      path = col.slice(colonIdx + 1);
    }
    if (path.includes("->")) {
      const segments = path.split(/->>|->/);
      // deno-lint-ignore no-explicit-any
      let v: any = row;
      for (const seg of segments) v = v == null ? undefined : v[seg];
      out[alias] = v === undefined ? null : v;
    } else {
      out[alias] = path in row ? row[path] : null;
      if (alias !== path) out[alias] = row[path] ?? null;
    }
  }
  return out;
}

function applyOrderLimit(rows: Row[], params: URLSearchParams): Row[] {
  let out = [...rows];
  const order = params.get("order");
  if (order) {
    const [col, dir] = order.split(".");
    out.sort((a, b) => {
      const av = String(a[col] ?? "");
      const bv = String(b[col] ?? "");
      return dir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv);
    });
  }
  const limit = params.get("limit");
  if (limit) out = out.slice(0, Number(limit));
  return out;
}

// ── install ──────────────────────────────────────────────────────────────────
export function installStub(options: StubOptions = {}): Stub {
  const realFetch = globalThis.fetch;
  const state: Stub["state"] = {
    toolLeads: (options.toolLeads ?? []).map((r) => ({ ...r })),
    toolCompetitors: (options.toolCompetitors ?? []).map((r) => ({ ...r })),
    venueListings: (options.venueListings ?? []).map((r) => ({ ...r })),
    geminiCalls: { structured: 0, grounded: 0 },
    resendSends: [],
    statusLog: {},
    requests: [],
  };
  for (const r of state.toolLeads) {
    state.statusLog[r.id] = [r.status];
  }

  const tables: Record<string, Row[]> = {
    tool_leads: state.toolLeads,
    tool_competitors: state.toolCompetitors,
    venue_listings: state.venueListings,
    place_pool: [],
    place_scores: [],
  };

  function handleTable(
    table: string,
    method: string,
    params: URLSearchParams,
    bodyText: string,
  ): Response {
    const rows = tables[table];
    if (!rows) return jsonRes([], 200);

    if (method === "HEAD") {
      if (table === "tool_leads" && options.quotaCountError) {
        return new Response(null, { status: 500 });
      }
      const n = rows.filter((r) => rowMatches(r, params)).length;
      return new Response(null, {
        status: 200,
        headers: { "Content-Range": `*/${n}` },
      });
    }
    if (method === "GET") {
      const matched = applyOrderLimit(
        rows.filter((r) => rowMatches(r, params)),
        params,
      );
      const select = params.get("select");
      return jsonRes(matched.map((r) => projectRow(r, select)));
    }
    if (method === "POST") {
      let inserted: Row;
      try {
        const parsed = JSON.parse(bodyText);
        inserted = Array.isArray(parsed) ? { ...parsed[0] } : { ...parsed };
      } catch {
        return jsonRes({ message: "bad body" }, 400);
      }
      if (!inserted.id) inserted.id = crypto.randomUUID();
      if (!inserted.created_at) inserted.created_at = new Date().toISOString();
      if (table === "tool_competitors") {
        // Trigger + unique-index emulation (P-45).
        const venue = state.venueListings.find((v) =>
          v.id === inserted.venue_listing_id
        );
        if (!venue) return jsonRes({ message: "venue_not_found" }, 400);
        if (venue.brand_id !== inserted.brand_id) {
          return jsonRes({ message: "brand_mismatch" }, 400);
        }
        const siblings = rows.filter((r) =>
          r.venue_listing_id === inserted.venue_listing_id
        );
        if (siblings.length >= 5) {
          return jsonRes({ message: "competitor_watch_cap" }, 400);
        }
        const site = String(inserted.website ?? "").trim().toLowerCase();
        if (
          siblings.some((r) =>
            String(r.website ?? "").trim().toLowerCase() === site
          )
        ) {
          return jsonRes({
            code: "23505",
            message:
              'duplicate key value violates unique constraint "uq_tool_competitors_venue_site"',
          }, 409);
        }
      }
      if (table === "tool_leads") {
        if (!("lane" in inserted)) inserted.lane = "web"; // column DEFAULT
        state.statusLog[inserted.id] = [inserted.status];
      }
      rows.push(inserted);
      const select = params.get("select");
      return jsonRes(projectRow(inserted, select), 201);
    }
    if (method === "PATCH") {
      let patch: Row;
      try {
        patch = JSON.parse(bodyText);
      } catch {
        return jsonRes({ message: "bad body" }, 400);
      }
      for (const r of rows) {
        if (rowMatches(r, params)) {
          if (
            table === "tool_leads" && typeof patch.status === "string" &&
            patch.status !== r.status
          ) {
            (state.statusLog[r.id] ??= []).push(patch.status);
          }
          Object.assign(r, patch);
        }
      }
      return new Response(null, { status: 204 });
    }
    if (method === "DELETE") {
      const keep = rows.filter((r) => !rowMatches(r, params));
      rows.length = 0;
      rows.push(...keep);
      return new Response(null, { status: 204 });
    }
    return jsonRes({ message: "unsupported" }, 405);
  }

  globalThis.fetch =
    ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url;
      const method =
        (init?.method ?? (input instanceof Request ? input.method : "GET"))
          .toUpperCase();
      const bodyText = init?.body ? String(init.body) : "";
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : {}),
      );
      state.requests.push({ method, url });

      // ── Gemini ──
      if (url.includes("generativelanguage.googleapis.com")) {
        const grounded = bodyText.includes('"tools"');
        const g = options.gemini ?? {};
        if (grounded) state.geminiCalls.grounded += 1;
        else state.geminiCalls.structured += 1;
        const abort = grounded ? g.abortGrounded : g.abortStructured;
        if (abort) {
          return Promise.reject(
            new DOMException("The signal has been aborted", "AbortError"),
          );
        }
        const status = grounded
          ? (g.groundedStatus ?? 500)
          : (g.structuredStatus ?? 200);
        if (status !== 200) {
          return Promise.resolve(jsonRes({ error: "stub" }, status));
        }
        const payload = grounded ? g.groundedPayload : g.structuredPayload;
        return Promise.resolve(jsonRes({
          candidates: [{
            content: { parts: [{ text: JSON.stringify(payload ?? {}) }] },
          }],
        }));
      }

      // ── Resend ──
      if (url.includes("api.resend.com")) {
        const b = bodyText ? JSON.parse(bodyText) : {};
        state.resendSends.push(b);
        return Promise.resolve(jsonRes({ id: "msg" }));
      }

      // ── Open-Meteo / Pexels: scripted unavailability (best-effort paths). ──
      if (url.includes("open-meteo.com") || url.includes("api.pexels.com")) {
        return Promise.resolve(jsonRes({ error: "stub-down" }, 500));
      }

      // ── Supabase stack ──
      if (url.startsWith(STUB_URL)) {
        const u = new URL(url);
        if (u.pathname === "/auth/v1/user") {
          const auth = headers.get("authorization") ?? "";
          const token = auth.replace(/^Bearer\s+/i, "");
          const userId = (options.users ?? {})[token];
          if (!userId) {
            return Promise.resolve(
              jsonRes({ code: 401, msg: "invalid JWT" }, 401),
            );
          }
          return Promise.resolve(jsonRes({
            id: userId,
            aud: "authenticated",
            role: "authenticated",
            email: "member@usemingla.com",
          }));
        }
        if (u.pathname.startsWith("/rest/v1/rpc/")) {
          const fn = u.pathname.slice("/rest/v1/rpc/".length);
          if (fn === "biz_is_brand_member_for_read") {
            const params = bodyText ? JSON.parse(bodyText) : {};
            const oracle = options.membership ?? (() => true);
            const verdict = oracle(
              String(params.p_brand_id),
              String(params.p_user_id),
            );
            if (verdict === "error") {
              return Promise.resolve(
                jsonRes({ message: "membership rpc down" }, 500),
              );
            }
            return Promise.resolve(jsonRes(verdict === true));
          }
          return Promise.resolve(jsonRes([]));
        }
        if (u.pathname.startsWith("/rest/v1/")) {
          const table = u.pathname.slice("/rest/v1/".length);
          return Promise.resolve(
            handleTable(table, method, u.searchParams, bodyText),
          );
        }
        return Promise.resolve(jsonRes({ message: "not_found" }, 404));
      }

      // ── Anything else = the venue's own website (site fetch). ──
      return Promise.resolve(
        new Response(
          "<html><head><title>Stub Venue — great food in Test City</title>" +
            '<meta name="description" content="A lovely test venue with a menu and prices."/></head>' +
            "<body>Menu from $10. Call us.</body></html>",
          { status: 200, headers: { "Content-Type": "text/html" } },
        ),
      );
    }) as typeof fetch;

  return {
    state,
    options,
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

// ── canned Gemini payloads (minimal-valid per engine) ────────────────────────
export const VENUES_PASS1_PAYLOAD = {
  vibe_card: {
    vibes: ["cosy"],
    occasions: ["date night"],
    signature_mention: "the terrace",
  },
  scores: {
    overall: 72,
    grade: "B",
    first_impression: 70,
    findability: 75,
    mobile: 68,
    menu_offers: 74,
    occasion_signal: 73,
    reasons: {
      first_impression: "Clean hero.",
      findability: "Good title.",
      mobile: "Viewport present.",
      menu_offers: "Menu linked.",
      occasion_signal: "Occasions clear.",
    },
  },
  google_listing: { lines: ["Shows up for 'test venue'"] },
  fixes: [{
    title: "Add prices",
    why: "Trust",
    change: "Show prices",
    impact: "high",
  }],
  rewritten_hero: { before_excerpt: "Welcome", after_copy: "Eat well tonight" },
  ai_read: "A solid venue site.",
};

export const EVENTS_SYNTH_PAYLOAD = {
  baseline_low: 40,
  baseline_high: 80,
  confidence: "medium",
  headline_read: "A solid Saturday crowd is likely.",
  narrative: "Good runway and demand.",
  factors: [{
    key: "day",
    label: "Saturday night",
    status: "help",
    detail: "Best night out.",
  }],
  fixes: [{
    title: "Post teasers",
    why: "Reach",
    change: "3 reels",
    effort: "this_week",
  }],
  listing_preview: {
    title: "Test Night",
    tagline: "The big one",
    vibe_tags: ["fun"],
    why_go: ["Great lineup"],
    best_for: ["friends"],
  },
};

export const TRIPS_SYNTH_PAYLOAD = {
  cover_narrative: "A beautiful escape.",
  organic_bookings_low: 4,
  organic_bookings_high: 8,
  confidence: "medium",
  headline_read: "This trip prices at a healthy margin.",
  itinerary: [{
    day: 1,
    title: "Arrive",
    summary: "Settle in and explore.",
    stay: "Stub Hotel",
    activities: ["Walk"],
  }],
  factors: [{
    key: "season",
    label: "In season",
    status: "help",
    detail: "Great month.",
  }],
  fixes: [{
    title: "Early-bird",
    why: "Fill",
    change: "Tiered price",
    effort: "this_week",
  }],
  listing_preview: {
    title: "Test Trip",
    tagline: "Go now",
    vibe_tags: ["chill"],
    why_go: ["Sun"],
    best_for: ["groups"],
    included: ["Stay"],
    excluded: ["Flights"],
  },
};

export const PRICING_SYNTH_PAYLOAD = {
  headline_verdict: "Your time isn't in your price.",
  narrative: "Count the hours and reprice.",
  confidence: "medium",
  premium_framing: "An intimate, expert-led experience.",
  value_points: ["Expertise"],
  factors: [{
    key: "time",
    label: "Unpriced time",
    status: "hurt",
    detail: "5 hrs/event.",
  }],
  fixes: [{
    title: "Raise to 45",
    why: "Market",
    change: "Phase it",
    effort: "this_week",
  }],
};

// ── canned inputs ────────────────────────────────────────────────────────────
export const VENUES_INPUT = {
  name: "Stub Venue",
  city: "Test City",
  website: "https://stub-venue-site.example",
};

export function eventsInput(): Row {
  const d = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  return {
    title: "Test Night",
    category: "music",
    city: "Test City",
    venue_name: "Stub Venue",
    date: d,
    start_time: "20:00",
    indoor_outdoor: "indoor",
    ticket_price: 20,
    capacity: 200,
    budget: 100,
    audience_size: 500,
    lineup: "DJ Stub",
    currency: "USD",
  };
}

export function tripsInput(): Row {
  const d = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  return {
    title: "Test Trip",
    destination: "Test City, Testland",
    departure: "",
    start_date: d,
    nights: 3,
    group_size: 10,
    vibe: "balanced",
    vibe_note: null,
    includes: { stay: true, activities: true, meals: true, transport: true },
    currency: "USD",
  };
}

export const PRICING_INPUT = {
  description: "A hands-on pasta workshop",
  category: "workshop",
  city: "Test City",
  seats: 10,
  current_price: 25,
  events_per_month: 4,
  currency: "USD",
  venue_cost: 100,
  materials_cost: 50,
  own_hours: 5,
  hourly_rate: 40,
};

// ── shared identities ────────────────────────────────────────────────────────
export const USER_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
export const USER_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
export const BRAND_A = "cccccccc-3333-4333-8333-cccccccccccc";
export const BRAND_B = "dddddddd-4444-4444-8444-dddddddddddd";
export const TOKEN_A = "token-user-a";
export const TOKEN_B = "token-user-b";
export const VENUE_A = "eeeeeeee-5555-4555-8555-eeeeeeeeeeee";
export const VENUE_B = "ffffffff-6666-4666-8666-ffffffffffff";

/** users/membership wiring for the standard two-brand world. */
export function twoBrandWorld(): StubOptions {
  return {
    users: { [TOKEN_A]: USER_A, [TOKEN_B]: USER_B },
    membership: (brandId, userId) =>
      (brandId === BRAND_A && userId === USER_A) ||
      (brandId === BRAND_B && userId === USER_B),
    venueListings: [
      { id: VENUE_A, brand_id: BRAND_A, name: "Venue A", city: "Test City" },
      { id: VENUE_B, brand_id: BRAND_B, name: "Venue B", city: "Test City" },
    ],
  };
}

/** POST helper against an imported handler. */
export async function post(
  handler: (req: Request) => Promise<Response>,
  body: unknown,
  bearer?: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: Row }> {
  const res = await handler(
    new Request(`${STUB_URL}/functions/v1/stub`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    }),
  );
  let parsed: Row = {};
  try {
    parsed = await res.json();
  } catch {
    parsed = {};
  }
  return { status: res.status, body: parsed };
}
