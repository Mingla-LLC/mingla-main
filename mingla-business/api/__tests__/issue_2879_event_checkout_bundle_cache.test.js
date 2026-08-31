// issue #2879 A — implementor happy-path + the cache contract.
// fails-on-revert: delete the `cache-control` header and B-02/B-03 red;
// remove the exactly-one-addressing-mode check and B-05 reds.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const HANDLER = "../event-checkout-bundle.js";
const RPC = "../../server/supabaseRpc";

// Swap the RPC module for a stub without touching the network.
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
  try { return require(HANDLER); } finally { Module._load = original; }
};

const mockRes = () => {
  const headers = {};
  return {
    statusCode: 0,
    body: null,
    headers,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    end(b) { this.body = b; },
  };
};

const EVENT_ID = "de1211d0-b8b7-4590-ba9f-cccaeb89ccc7";

test("B-01 — a valid event id returns the bundle", async () => {
  const handler = load(async () => ({ id: EVENT_ID, tickets: [] }));
  const res = mockRes();
  await handler({ query: { eventId: EVENT_ID } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { id: EVENT_ID, tickets: [] });
});

test("B-02 — a hit is cached for FIVE seconds, shared-cache only", async () => {
  const handler = load(async () => ({ id: EVENT_ID }));
  const res = mockRes();
  await handler({ query: { eventId: EVENT_ID } }, res);
  const cc = res.headers["cache-control"];
  assert.ok(cc, "no cache-control header — the endpoint would shield nothing");
  assert.match(cc, /s-maxage=5\b/, `expected s-maxage=5, got: ${cc}`);
  // max-age=0 keeps it out of the BROWSER cache: one viewer must not be
  // pinned to a stale number for longer than everyone else.
  assert.match(cc, /max-age=0\b/, `expected max-age=0, got: ${cc}`);
  assert.doesNotMatch(cc, /stale-while-revalidate/,
    "stale-while-revalidate pushes worst-case staleness past the 5s agreed");
});

test("B-03 — a NOT-FOUND is cached too; a FAILURE never is", async () => {
  const missing = load(async () => null);
  const r1 = mockRes();
  await missing({ query: { eventId: EVENT_ID } }, r1);
  assert.equal(r1.statusCode, 404);
  assert.match(r1.headers["cache-control"], /s-maxage=5\b/,
    "a bad link under a crowd is exactly the traffic this must absorb");

  const broken = load(async () => { throw new Error("upstream down"); });
  const r2 = mockRes();
  await broken({ query: { eventId: EVENT_ID } }, r2);
  assert.equal(r2.statusCode, 502);
  assert.equal(r2.headers["cache-control"], "no-store",
    "caching an error would serve a 5s outage for 5s after it ended");
});

test("B-04 — slug addressing works and reaches the RPC with the right args", async () => {
  let seen = null;
  const handler = load(async (_fn, body) => { seen = body; return { id: EVENT_ID }; });
  const res = mockRes();
  await handler({ query: { brandSlug: "gogi", eventSlug: "we-go-again" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen, {
    p_event_id: null, p_brand_slug: "gogi", p_event_slug: "we-go-again",
  });
});

test("B-05 — exactly one addressing mode; malformed input never reaches the RPC", async () => {
  let called = 0;
  const handler = load(async () => { called += 1; return { id: EVENT_ID }; });
  const cases = [
    ["neither", {}],
    ["both at once", { eventId: EVENT_ID, brandSlug: "gogi", eventSlug: "we-go-again" }],
    ["non-uuid id", { eventId: "'; DROP TABLE tickets;--" }],
    ["slug with a slash", { brandSlug: "a/b", eventSlug: "c" }],
    ["empty slug", { brandSlug: "", eventSlug: "x" }],
    ["half a slug pair", { brandSlug: "gogi" }],
  ];
  for (const [name, query] of cases) {
    const res = mockRes();
    await handler({ query }, res);
    assert.equal(res.statusCode, 400, `${name} should be refused`);
    assert.equal(res.headers["cache-control"], "no-store", `${name} must not be cached`);
  }
  assert.equal(called, 0, "malformed input reached the RPC");
});

test("B-06 — repeated query keys arrive as arrays and take the first", async () => {
  let seen = null;
  const handler = load(async (_fn, body) => { seen = body; return { id: EVENT_ID }; });
  const res = mockRes();
  await handler({ query: { eventId: [EVENT_ID, "junk"] } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(seen.p_event_id, EVENT_ID);
});
