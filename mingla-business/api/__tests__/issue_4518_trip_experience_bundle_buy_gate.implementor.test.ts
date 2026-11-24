/**
 * issue #4518 follow-up — trip and experience page bundles carry the buy-gate
 * answers that apply to them, from our own site (one helper:
 * server/buyGateAnswers.js).
 *
 * FAILS ON REVERT: drop the `withBuyGateAnswers` call from either handler and
 * T-1 / E-1 fail (the browser must again ask the database host directly).
 * Ask for brandCanCollect on the experience bundle and E-2 fails (two owners
 * of one fact: the experience RPC already carries server `bookable`).
 */
type Rpc = (fn: string, body: Record<string, unknown>) => Promise<unknown>;

let rpcImpl: Rpc = async () => null;
jest.mock("../../server/supabaseRpc", () => ({
  requestRpcJson: (fn: string, body: Record<string, unknown>) => rpcImpl(fn, body),
  SUPABASE_URL: "x",
  SUPABASE_ANON_KEY: "y",
}));

interface Res {
  statusCode: number;
  body: string | null;
  headers: Record<string, string>;
  setHeader: (key: string, value: string) => void;
  end: (body: string) => void;
}
type Handler = (req: { query: Record<string, string> }, res: Res) => Promise<void>;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tripHandler = require("../trip-checkout-bundle.js") as Handler;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const experienceHandler = require("../experience-checkout-bundle.js") as Handler;

const makeRes = (): Res => {
  const res: Res = {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(key, value) {
      res.headers[key.toLowerCase()] = value;
    },
    end(body) {
      res.body = body;
    },
  };
  return res;
};

const EVENT_ID = "8a1c6c1e-2b55-4c0f-9a0e-0c1f2a3b4c5d";
const BRAND_ID = "c5a22049-6af1-4f55-8716-4fb01bbe1335";
const TRIP = { id: EVENT_ID, brandId: BRAND_ID, tripSlug: "weekend-away", tiers: [] };
const EXPERIENCE = {
  id: EVENT_ID,
  brandId: BRAND_ID,
  experienceSlug: "wine-crawl",
  bookable: true,
  stops: [],
  dates: [],
};
const UNRESTRICTED = { schemaVersion: 1, mode: "unrestricted", state: "unrestricted" };

const run = async (
  handler: Handler,
  query: Record<string, string>,
  impl: Rpc,
): Promise<{ res: Res; body: Record<string, unknown>; calls: string[] }> => {
  const calls: string[] = [];
  rpcImpl = async (fn, body) => {
    calls.push(fn);
    return impl(fn, body);
  };
  const res = makeRes();
  await handler({ query }, res);
  return { res, body: JSON.parse(res.body ?? "null") as Record<string, unknown>, calls };
};

const TRIP_Q = { brandSlug: "gogi", tripSlug: "weekend-away" };
const EXP_Q = { brandSlug: "lantern-vine", experienceSlug: "wine-crawl" };

describe("#4518 — trip bundle carries brandCanCollect and the unrestricted hint", () => {
  test("T-1 a public trip by a ready brand: both answers ride the cached bundle", async () => {
    const { res, body, calls } = await run(tripHandler, TRIP_Q, async (fn) => {
      if (fn === "pg_public_trip_by_slug") return TRIP;
      if (fn === "pg_brand_can_collect") return true;
      return UNRESTRICTED;
    });
    expect(res.statusCode).toBe(200);
    expect(body).toEqual({ ...TRIP, brandCanCollect: true, checkoutAccessMode: "unrestricted" });
    expect(calls).toEqual(
      expect.arrayContaining(["pg_brand_can_collect", "pg_public_ticket_checkout_access_state"]),
    );
    expect(res.headers["cache-control"]).toMatch(/s-maxage=5\b/);
  });

  test("T-2 a restricted trip sale never carries the field", async () => {
    const { body } = await run(tripHandler, TRIP_Q, async (fn) => {
      if (fn === "pg_public_trip_by_slug") return TRIP;
      if (fn === "pg_brand_can_collect") return false;
      return { schemaVersion: 1, mode: "restricted", state: "sign_in_required" };
    });
    expect(body.brandCanCollect).toBe(false);
    expect(body).not.toHaveProperty("checkoutAccessMode");
    expect(JSON.stringify(body)).not.toContain("sign_in_required");
  });

  test("T-3 failed reads add nothing and the page still loads", async () => {
    const { res, body } = await run(tripHandler, TRIP_Q, async (fn) => {
      if (fn === "pg_public_trip_by_slug") return TRIP;
      throw new Error("upstream down");
    });
    expect(res.statusCode).toBe(200);
    expect(body).toEqual(TRIP);
  });

  test("T-4 errors stay no-store and ask nothing more", async () => {
    const { res, calls } = await run(tripHandler, TRIP_Q, async () => {
      throw new Error("upstream down");
    });
    expect(res.statusCode).toBe(502);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(calls).toEqual(["pg_public_trip_by_slug"]);
  });
});

describe("#4518 — experience bundle carries the unrestricted hint only", () => {
  test("E-1 an unrestricted experience sale carries checkoutAccessMode", async () => {
    const { res, body } = await run(experienceHandler, EXP_Q, async (fn) => {
      if (fn === "pg_public_experience_by_slug") return EXPERIENCE;
      if (fn === "pg_brand_can_collect") return true;
      return UNRESTRICTED;
    });
    expect(res.statusCode).toBe(200);
    expect(body).toEqual({ ...EXPERIENCE, checkoutAccessMode: "unrestricted" });
  });

  test("E-2 never asks for, nor carries, brandCanCollect (server `bookable` owns it)", async () => {
    const { body, calls } = await run(experienceHandler, EXP_Q, async (fn) => {
      if (fn === "pg_public_experience_by_slug") return EXPERIENCE;
      if (fn === "pg_brand_can_collect") return true;
      return UNRESTRICTED;
    });
    expect(body).not.toHaveProperty("brandCanCollect");
    expect(calls).not.toContain("pg_brand_can_collect");
  });

  test("E-3 a restricted experience sale never carries the field", async () => {
    const { body } = await run(experienceHandler, EXP_Q, async (fn) => {
      if (fn === "pg_public_experience_by_slug") return EXPERIENCE;
      return { schemaVersion: 1, mode: "restricted", state: "not_invited" };
    });
    expect(body).toEqual(EXPERIENCE);
  });

  test("E-4 a failed access read adds nothing; a 404 is still cached", async () => {
    const ok = await run(experienceHandler, EXP_Q, async (fn) => {
      if (fn === "pg_public_experience_by_slug") return EXPERIENCE;
      throw new Error("upstream down");
    });
    expect(ok.body).toEqual(EXPERIENCE);
    const missing = await run(experienceHandler, EXP_Q, async () => null);
    expect(missing.res.statusCode).toBe(404);
    expect(missing.calls).toEqual(["pg_public_experience_by_slug"]);
  });
});
