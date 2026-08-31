// issue #2879 A — the web read goes through the cached endpoint, and the
// endpoint is a SHIELD, never a dependency.
//
// fails-on-revert: restore fetchDirectEventBundlePayload to calling
// supabase.rpc unconditionally and B-01/B-02/B-03 red immediately.
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

// A 404 from the endpoint means "not visible anonymously", which hands off to
// the slug fallback — and that path queries a view. Without a builder here the
// fallback throws on `.select` and B-05 fails for a reason that has nothing to
// do with what it is testing.
const emptyBuilder = (): Record<string, unknown> => {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const key of ["select", "eq", "is", "in", "limit", "order", "not", "or"]) {
    builder[key] = jest.fn(chain);
  }
  builder.maybeSingle = jest.fn(async () => ({ data: null, error: null }));
  builder.single = jest.fn(async () => ({ data: null, error: null }));
  builder.then = undefined;
  return builder;
};

import { getPublicEventBySlug } from "../publicEventsService";

const EVENT_ID = "de1211d0-b8b7-4590-ba9f-cccaeb89ccc7";

// The minimum the bundle validator accepts. If this drifts, every test here
// falls back to the RPC and the suite would quietly stop testing the endpoint —
// so B-01 asserts the RPC was NOT called rather than only that a value came back.
const bundle = (): Record<string, unknown> => ({
  id: EVENT_ID,
  brandId: "brand-2879",
  brandSlug: "gogi",
  eventSlug: "we-go-again",
  name: "We Go Again",
  tickets: [],
  occurrences: [],
  // isDirectEventBundle requires a nested brand with id/slug/name. Omitting it
  // made every test here throw the malformed-body error instead of exercising
  // the path it names — B-04 passed for the wrong reason and the rest failed.
  brand: { id: "brand-2879", slug: "gogi", name: "Gogi" },
});

const fetchOk = (body: unknown, status = 200): typeof fetch =>
  jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;

describe("issue #2879 — cached bundle endpoint on web", () => {
  // This project's default jest environment is "node", so `document` does not
  // exist and isWebRuntime() would be false — the endpoint path would never be
  // exercised and every test here would silently pass by testing the RPC
  // fallback instead. Defining it explicitly makes the web/native contract a
  // stated part of the test rather than a property of the environment.
  beforeEach(() => {
    mockRpc.mockReset();
    mockFrom.mockReset();
    mockFrom.mockImplementation(() => emptyBuilder());
    (globalThis as { document?: unknown }).document = {};
  });

  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  test("B-01 — web reads the endpoint and does NOT touch Supabase", async () => {
    const f = fetchOk(bundle());
    globalThis.fetch = f;
    await getPublicEventBySlug("gogi", "we-go-again");
    expect(f).toHaveBeenCalledTimes(1);
    expect(String((f as jest.Mock).mock.calls[0][0])).toBe(
      "/api/event-checkout-bundle?brandSlug=gogi&eventSlug=we-go-again",
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("B-02 — a 502 falls back to Supabase, so the page still loads", async () => {
    globalThis.fetch = fetchOk({ error: "upstream_unavailable" }, 502);
    mockRpc.mockResolvedValue({ data: bundle(), error: null } as never);
    const result = await getPublicEventBySlug("gogi", "we-go-again");
    expect(mockRpc).toHaveBeenCalledWith("pg_direct_event_checkout_bundle", {
      p_event_id: null, p_brand_slug: "gogi", p_event_slug: "we-go-again",
    });
    expect(result).not.toBeNull();
  });

  test("B-03 — a network throw falls back too", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    mockRpc.mockResolvedValue({ data: bundle(), error: null } as never);
    const result = await getPublicEventBySlug("gogi", "we-go-again");
    expect(mockRpc).toHaveBeenCalled();
    expect(result).not.toBeNull();
  });

  test("B-04 — a MALFORMED body throws; it must not hide behind the fallback", async () => {
    globalThis.fetch = fetchOk({ totally: "wrong shape" });
    mockRpc.mockResolvedValue({ data: bundle(), error: null } as never);
    await expect(getPublicEventBySlug("gogi", "we-go-again")).rejects.toThrow(
      "invalid_direct_event_checkout_bundle",
    );
    // The whole point: a broken contract must NOT be papered over by a working
    // page. If this ever calls the RPC, the defect becomes invisible.
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("B-05 — a 404 means not-visible, and does NOT retry against Supabase", async () => {
    globalThis.fetch = fetchOk({ error: "not_found" }, 404);
    mockRpc.mockResolvedValue({ data: null, error: null } as never);
    await getPublicEventBySlug("gogi", "we-go-again");
    // 404 is the endpoint rendering the reader's null. Re-asking Supabase would
    // defeat the cache for exactly the bad-link traffic it exists to absorb.
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("B-06 — NATIVE has no `document`, so it calls Supabase directly", async () => {
    delete (globalThis as { document?: unknown }).document;
    const f = jest.fn();
    globalThis.fetch = f as unknown as typeof fetch;
    mockRpc.mockResolvedValue({ data: bundle(), error: null } as never);
    const result = await getPublicEventBySlug("gogi", "we-go-again");
    // The endpoint is a web-only shield. If native ever started reaching for a
    // relative URL it would resolve against nothing and every app install
    // would fall back on every read.
    expect(f).not.toHaveBeenCalled();
    expect(mockRpc).toHaveBeenCalled();
    expect(result).not.toBeNull();
  });
});
