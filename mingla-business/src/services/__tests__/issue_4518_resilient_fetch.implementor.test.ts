// MINGLA-INVARIANT: I-HOST-WEB-HAS-A-SECOND-ROAD-TO-THE-DATABASE | issue #4518 | on Host web a read that cannot connect to the database host is answered through the same-origin road, the rest of the visit stays on that road, and a write is never sent twice.
/**
 * issue #4518 N3 / N5 — a phone that cannot reach the database host can still
 * buy: the "database host is down" rehearsal.
 *
 * FAILS ON REVERT: make `createResilientFetch` a pass-through and R-1, R-2 and
 * R-6 fail (the read rejects instead of being answered). Replay writes and
 * R-3 fails. Accept any 200 as proof of the second road and R-4 fails.
 */
import {
  SAME_ORIGIN_PREFIX,
  createResilientFetch,
  currentDatabaseRoute,
  isReplaySafe,
  onDatabaseRouteEvent,
  reportablePath,
  resetDatabaseRoute,
  type RouteEvent,
} from "../resilientFetch";

const DIRECT = "https://db.example.co";

type Call = { url: string; method: string };

const json = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
  }) as unknown as Response;

const html = (): Response =>
  ({
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "text/html" : null) },
  }) as unknown as Response;

/** A network where the database host is unreachable but our own site is not. */
function blockedNetwork(options: { sameOrigin: "database" | "appShell" | "down" } = { sameOrigin: "database" }) {
  const calls: Call[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.startsWith(DIRECT)) throw new TypeError("Failed to fetch");
    if (options.sameOrigin === "down") throw new TypeError("Failed to fetch");
    if (options.sameOrigin === "appShell") return html();
    return json({ road: "sameOrigin", url });
  };
  return { calls, fetchImpl };
}

const make = (fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) =>
  createResilientFetch(() => fetchImpl, { directOrigin: DIRECT, enabled: true });

let events: RouteEvent[] = [];
let unsubscribe: () => void = () => undefined;

beforeEach(() => {
  resetDatabaseRoute();
  events = [];
  unsubscribe = onDatabaseRouteEvent((event) => events.push(event));
});
afterEach(() => unsubscribe());

describe("#4518 — the database host is unreachable, our own site is not", () => {
  test("R-1 the payment-readiness read is answered through our own site", async () => {
    const { calls, fetchImpl } = blockedNetwork();
    const response = await make(fetchImpl)(`${DIRECT}/rest/v1/rpc/pg_brand_can_collect`, {
      method: "POST",
      body: "{}",
    });
    expect(await response.json()).toMatchObject({ road: "sameOrigin" });
    expect(calls.map((c) => c.url)).toEqual([
      `${DIRECT}/rest/v1/rpc/pg_brand_can_collect`,
      `${SAME_ORIGIN_PREFIX}/auth/v1/health`,
      `${SAME_ORIGIN_PREFIX}/rest/v1/rpc/pg_brand_can_collect`,
    ]);
    expect(currentDatabaseRoute()).toBe("sameOrigin");
    expect(events).toEqual([{ outcome: "rescued", path: "/rest/v1/rpc/pg_brand_can_collect" }]);
  });

  test("R-2 the sale-access read and a table read are answered too", async () => {
    const { fetchImpl } = blockedNetwork();
    const f = make(fetchImpl);
    const access = await f(`${DIRECT}/rest/v1/rpc/pg_public_ticket_checkout_access_state`, { method: "POST" });
    const table = await f(`${DIRECT}/rest/v1/brand_follows?select=id`);
    expect(await access.json()).toMatchObject({ road: "sameOrigin" });
    expect(await table.json()).toMatchObject({ road: "sameOrigin" });
  });

  test("R-3 a checkout start is NEVER sent twice; the buyer's retry takes the working road", async () => {
    const { calls, fetchImpl } = blockedNetwork();
    const f = make(fetchImpl);
    const url = `${DIRECT}/functions/v1/ticket-checkout-create`;
    await expect(f(url, { method: "POST", body: "{}" })).rejects.toThrow("Failed to fetch");
    const posts = (): Call[] => calls.filter((c) => c.url.endsWith("ticket-checkout-create"));
    expect(posts()).toEqual([{ url, method: "POST" }]);
    // The road switched, so the retry the buyer taps goes through our site.
    expect(currentDatabaseRoute()).toBe("sameOrigin");
    const retry = await f(url, { method: "POST", body: "{}" });
    expect(await retry.json()).toMatchObject({ road: "sameOrigin" });
    expect(posts()).toHaveLength(2);
    expect(posts()[1].url).toBe(`${SAME_ORIGIN_PREFIX}/functions/v1/ticket-checkout-create`);
  });

  test("R-4 an app-shell HTML page on the second road is not mistaken for the database", async () => {
    const { fetchImpl } = blockedNetwork({ sameOrigin: "appShell" });
    await expect(
      make(fetchImpl)(`${DIRECT}/rest/v1/rpc/pg_brand_can_collect`, { method: "POST" }),
    ).rejects.toThrow("Failed to fetch");
    expect(currentDatabaseRoute()).toBe("direct");
    expect(events).toEqual([{ outcome: "unreachable", path: "/rest/v1/rpc/pg_brand_can_collect" }]);
  });

  test("R-5 fully offline: the error surfaces, the road does not switch", async () => {
    const { fetchImpl } = blockedNetwork({ sameOrigin: "down" });
    await expect(make(fetchImpl)(`${DIRECT}/rest/v1/brands?select=id`)).rejects.toThrow("Failed to fetch");
    expect(currentDatabaseRoute()).toBe("direct");
    expect(events.map((e) => e.outcome)).toEqual(["unreachable"]);
  });

  test("R-6 once rescued, later calls skip the dead road entirely", async () => {
    const { calls, fetchImpl } = blockedNetwork();
    const f = make(fetchImpl);
    await f(`${DIRECT}/rest/v1/brands?select=id`);
    calls.length = 0;
    await f(`${DIRECT}/rest/v1/events?select=id`);
    expect(calls.map((c) => c.url)).toEqual([`${SAME_ORIGIN_PREFIX}/rest/v1/events?select=id`]);
    expect(events).toHaveLength(1);
  });
});

describe("#4518 — nothing changes when the connection is fine, or off web", () => {
  test("R-7 a healthy direct call is untouched and never probes", async () => {
    const calls: string[] = [];
    const f = make(async (input) => {
      calls.push(String(input));
      return json({ road: "direct" });
    });
    await f(`${DIRECT}/rest/v1/rpc/pg_brand_can_collect`, { method: "POST" });
    expect(calls).toEqual([`${DIRECT}/rest/v1/rpc/pg_brand_can_collect`]);
    expect(currentDatabaseRoute()).toBe("direct");
    expect(events).toEqual([]);
  });

  test("R-8 disabled (native) is a plain pass-through that rejects as before", async () => {
    const { calls, fetchImpl } = blockedNetwork();
    const f = createResilientFetch(() => fetchImpl, { directOrigin: DIRECT, enabled: false });
    await expect(f(`${DIRECT}/rest/v1/brands`)).rejects.toThrow("Failed to fetch");
    expect(calls).toHaveLength(1);
  });

  test("R-9 a request the caller cancelled is not treated as a dead connection", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const f = make(async (input) => {
      calls.push(String(input));
      controller.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    await expect(f(`${DIRECT}/rest/v1/brands`, { signal: controller.signal })).rejects.toThrow("aborted");
    expect(calls).toHaveLength(1);
    expect(events).toEqual([]);
  });

  test("R-10 a URL that is not the database is never rewritten", async () => {
    const { calls, fetchImpl } = blockedNetwork();
    await make(fetchImpl)("https://elsewhere.example/api").catch(() => undefined);
    expect(calls.map((c) => c.url)).toEqual(["https://elsewhere.example/api"]);
  });
});

describe("#4518 — which requests may be replayed, and what is reported", () => {
  test("R-11 reads are replay-safe; writes are not", () => {
    expect(isReplaySafe("GET", "/rest/v1/brands")).toBe(true);
    expect(isReplaySafe("HEAD", "/storage/v1/object/public/x")).toBe(true);
    expect(isReplaySafe("POST", "/rest/v1/rpc/pg_brand_can_collect")).toBe(true);
    expect(isReplaySafe("POST", "/rest/v1/rpc/get_brand_follower_count")).toBe(true);
    expect(isReplaySafe("POST", "/rest/v1/rpc/biz_event_ticket_checkout_access_add_self")).toBe(false);
    expect(isReplaySafe("POST", "/functions/v1/ticket-checkout-create")).toBe(false);
    expect(isReplaySafe("POST", "/auth/v1/token")).toBe(false);
    expect(isReplaySafe("PATCH", "/rest/v1/brands")).toBe(false);
    expect(isReplaySafe("DELETE", "/rest/v1/brand_follows")).toBe(false);
  });

  test("R-12 the reported path carries no ids and no query string", () => {
    expect(
      reportablePath("/storage/v1/object/public/event_covers/c5a22049-6af1-4f55-8716-4fb01bbe1335/a.png?token=secret"),
    ).toBe("/storage/v1/object/public/event_covers/:id/a.png");
  });
});
