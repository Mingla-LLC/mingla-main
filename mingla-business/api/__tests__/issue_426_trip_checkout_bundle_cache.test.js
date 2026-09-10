// #426 G1 — trip-checkout-bundle cache contract (mirrors issue #2879 tests).
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const HANDLER = "../trip-checkout-bundle.js";
const RPC = "../../server/supabaseRpc";

const load = (rpcImpl) => {
  const key = require.resolve(RPC);
  const handlerKey = require.resolve(HANDLER);
  delete require.cache[key];
  delete require.cache[handlerKey];
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "../server/supabaseRpc") {
      return { requestRpcJson: rpcImpl, SUPABASE_URL: "x", SUPABASE_ANON_KEY: "y" };
    }
    return original.apply(this, arguments);
  };
  try {
    return require(HANDLER);
  } finally {
    Module._load = original;
  }
};

const mockRes = () => {
  const headers = {};
  return {
    statusCode: 0,
    body: null,
    headers,
    setHeader(k, v) {
      headers[k.toLowerCase()] = v;
    },
    end(b) {
      this.body = b;
    },
  };
};

test("trip B-01 — valid slugs return the RPC payload", async () => {
  const handler = load(async () => ({ id: "trip-1", tripSlug: "weekend-away" }));
  const res = mockRes();
  await handler({ query: { brandSlug: "gogi", tripSlug: "weekend-away" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { id: "trip-1", tripSlug: "weekend-away" });
});

test("trip B-02 — hit is cached s-maxage=5 without SWR", async () => {
  const handler = load(async () => ({ id: "trip-1" }));
  const res = mockRes();
  await handler({ query: { brandSlug: "gogi", tripSlug: "weekend-away" } }, res);
  const cc = res.headers["cache-control"];
  assert.match(cc, /s-maxage=5\b/);
  assert.match(cc, /max-age=0\b/);
  assert.doesNotMatch(cc, /stale-while-revalidate/);
});

test("trip B-03 — not-found cached; failure never cached", async () => {
  const missing = load(async () => null);
  const r1 = mockRes();
  await missing({ query: { brandSlug: "gogi", tripSlug: "weekend-away" } }, r1);
  assert.equal(r1.statusCode, 404);
  assert.match(r1.headers["cache-control"], /s-maxage=5\b/);

  const broken = load(async () => {
    throw new Error("upstream down");
  });
  const r2 = mockRes();
  await broken({ query: { brandSlug: "gogi", tripSlug: "weekend-away" } }, r2);
  assert.equal(r2.statusCode, 502);
  assert.equal(r2.headers["cache-control"], "no-store");
});

test("trip B-04 — RPC args use p_event_slug for the trip slug", async () => {
  let seen = null;
  const handler = load(async (_fn, body) => {
    seen = body;
    return { id: "trip-1" };
  });
  const res = mockRes();
  await handler({ query: { brandSlug: "gogi", tripSlug: "weekend-away" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, {
    p_brand_slug: "gogi",
    p_event_slug: "weekend-away",
  });
});

test("trip B-05 — malformed input never reaches the RPC", async () => {
  let called = 0;
  const handler = load(async () => {
    called += 1;
    return { id: "trip-1" };
  });
  const cases = [
    {},
    { brandSlug: "gogi" },
    { brandSlug: "a/b", tripSlug: "c" },
    { brandSlug: "", tripSlug: "x" },
  ];
  for (const query of cases) {
    const res = mockRes();
    await handler({ query }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.headers["cache-control"], "no-store");
  }
  assert.equal(called, 0);
});
