/**
 * issue #4518 N1 — the Buy button's two answers travel with the page bundle,
 * from our own site.
 *
 * FAILS ON REVERT: drop `withBuyGateAnswers` and G-1 fails (the browser must
 * again ask the database host directly before it can enable buying). Answer a
 * restricted sale from the shared cache and G-3 fails. Let a failed read
 * invent an answer and G-4 fails.
 */
type Rpc = (fn: string, body: Record<string, unknown>) => Promise<unknown>;

let rpcImpl: Rpc = async () => null;
jest.mock("../../server/supabaseRpc", () => ({
  requestRpcJson: (fn: string, body: Record<string, unknown>) => rpcImpl(fn, body),
  SUPABASE_URL: "x",
  SUPABASE_ANON_KEY: "y",
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const handler = require("../event-checkout-bundle.js") as (
  req: { query: Record<string, string> },
  res: Res,
) => Promise<void>;

interface Res {
  statusCode: number;
  body: string | null;
  headers: Record<string, string>;
  setHeader: (key: string, value: string) => void;
  end: (body: string) => void;
}

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

const EVENT_ID = "de1211d0-b8b7-4590-ba9f-cccaeb89ccc7";
const BRAND_ID = "c5a22049-6af1-4f55-8716-4fb01bbe1335";
const BUNDLE = { id: EVENT_ID, brandId: BRAND_ID, tickets: [] };

const run = async (impl: Rpc): Promise<{ res: Res; body: Record<string, unknown>; calls: [string, unknown][] }> => {
  const calls: [string, unknown][] = [];
  rpcImpl = async (fn, body) => {
    calls.push([fn, body]);
    return impl(fn, body);
  };
  const res = makeRes();
  await handler({ query: { eventId: EVENT_ID } }, res);
  return { res, body: JSON.parse(res.body ?? "null") as Record<string, unknown>, calls };
};

describe("#4518 — the page bundle carries the buy-gate answers", () => {
  test("G-1 a public sale by a ready brand: both answers are in the bundle", async () => {
    const { res, body, calls } = await run(async (fn) => {
      if (fn === "pg_direct_event_checkout_bundle") return BUNDLE;
      if (fn === "pg_brand_can_collect") return true;
      return { schemaVersion: 1, mode: "unrestricted", state: "unrestricted" };
    });
    expect(res.statusCode).toBe(200);
    expect(body).toEqual({ ...BUNDLE, brandCanCollect: true, checkoutAccessMode: "unrestricted" });
    expect(calls).toEqual(
      expect.arrayContaining([
        ["pg_brand_can_collect", { p_brand_id: BRAND_ID }],
        ["pg_public_ticket_checkout_access_state", { p_event_id: EVENT_ID }],
      ]),
    );
    // Still the shared five-second cache, so three reads protect every viewer.
    expect(res.headers["cache-control"]).toMatch(/s-maxage=5\b/);
  });

  test("G-2 a brand that cannot collect is carried as false, verbatim", async () => {
    const { body } = await run(async (fn) => {
      if (fn === "pg_direct_event_checkout_bundle") return BUNDLE;
      if (fn === "pg_brand_can_collect") return false;
      return { mode: "unrestricted", state: "unrestricted" };
    });
    expect(body.brandCanCollect).toBe(false);
  });

  test("G-3 a restricted sale is NEVER answered from the shared cache", async () => {
    const { body } = await run(async (fn) => {
      if (fn === "pg_direct_event_checkout_bundle") return BUNDLE;
      if (fn === "pg_brand_can_collect") return true;
      return { schemaVersion: 1, mode: "restricted", state: "sign_in_required" };
    });
    expect(body).not.toHaveProperty("checkoutAccessMode");
    expect(JSON.stringify(body)).not.toContain("sign_in_required");
  });

  test("G-4 a read that fails adds nothing, and the page still loads", async () => {
    const { res, body } = await run(async (fn) => {
      if (fn === "pg_direct_event_checkout_bundle") return BUNDLE;
      throw new Error("upstream down");
    });
    expect(res.statusCode).toBe(200);
    expect(body).toEqual(BUNDLE);
  });

  test("G-5 an answer of the wrong shape adds nothing", async () => {
    const { body } = await run(async (fn) => {
      if (fn === "pg_direct_event_checkout_bundle") return BUNDLE;
      if (fn === "pg_brand_can_collect") return "true";
      return null;
    });
    expect(body).toEqual(BUNDLE);
  });

  test("G-6 a missing event is still a 404 and asks nothing more", async () => {
    const { res, calls } = await run(async () => null);
    expect(res.statusCode).toBe(404);
    expect(calls.map(([fn]) => fn)).toEqual(["pg_direct_event_checkout_bundle"]);
  });
});
