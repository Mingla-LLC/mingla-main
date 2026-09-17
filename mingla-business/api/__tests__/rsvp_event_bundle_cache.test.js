// Unlisted RSVP invite link — rsvp-event-bundle cache contract (mirrors the
// #2879 event and #426 trip endpoint tests).
// fails-on-revert: point the handler at any other RPC and R-04 reds; drop the
// cache-control header and R-02/R-03 red; drop the slug validation and R-05 reds.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const HANDLER = "../rsvp-event-bundle.js";
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

const QUERY = { brandSlug: "harmattanclub", eventSlug: "members-table" };
const PAYLOAD = {
  id: "6efa617e-d4bd-4389-909d-be9db1763a75",
  brandSlug: "harmattanclub",
  eventSlug: "members-table",
  publicEventRow: { id: "6efa617e-d4bd-4389-909d-be9db1763a75", event_type: "rsvp", visibility: "hidden" },
};

test("R-01 — valid slugs return the RPC payload unchanged", async () => {
  const handler = load(async () => PAYLOAD);
  const res = mockRes();
  await handler({ query: QUERY }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), PAYLOAD);
});

test("R-02 — a hit is cached s-maxage=5, shared cache only, without SWR", async () => {
  const handler = load(async () => PAYLOAD);
  const res = mockRes();
  await handler({ query: QUERY }, res);
  const cc = res.headers["cache-control"];
  assert.match(cc, /s-maxage=5\b/);
  assert.match(cc, /max-age=0\b/);
  assert.doesNotMatch(cc, /stale-while-revalidate/);
});

test("R-03 — not found is a cached 404; an upstream failure is an uncached 502", async () => {
  const missing = load(async () => null);
  const r1 = mockRes();
  await missing({ query: QUERY }, r1);
  assert.equal(r1.statusCode, 404);
  assert.match(r1.headers["cache-control"], /s-maxage=5\b/);

  const broken = load(async () => {
    throw new Error("upstream down");
  });
  const r2 = mockRes();
  await broken({ query: QUERY }, r2);
  assert.equal(r2.statusCode, 502);
  assert.equal(r2.headers["cache-control"], "no-store");
});

test("R-04 — it asks pg_public_rsvp_by_slug with the exact slug pair", async () => {
  const seen = [];
  const handler = load(async (fn, body) => {
    seen.push([fn, body]);
    return PAYLOAD;
  });
  await handler({ query: QUERY }, mockRes());
  assert.deepEqual(seen, [[
    "pg_public_rsvp_by_slug",
    { p_brand_slug: "harmattanclub", p_event_slug: "members-table" },
  ]]);
});

test("R-05 — malformed input never reaches the RPC", async () => {
  let called = 0;
  const handler = load(async () => {
    called += 1;
    return PAYLOAD;
  });
  const cases = [
    {},
    { brandSlug: "harmattanclub" },
    { eventSlug: "members-table" },
    { brandSlug: "a/b", eventSlug: "c" },
    { brandSlug: "", eventSlug: "x" },
    { brandSlug: "harmattanclub", eventSlug: "members table" },
  ];
  for (const query of cases) {
    const res = mockRes();
    await handler({ query }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.headers["cache-control"], "no-store");
  }
  assert.equal(called, 0);
});
