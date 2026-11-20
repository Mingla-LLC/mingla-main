// issue #4420 (C1) — GET /e/:brandSlug/:eventSlug/calendar.ics
//
// fails-on-revert (delete the named line(s), the named test goes red):
//   - content-type text/calendar header ........................... E-01
//   - the end-time guard (offeringCalendarEntry returning null) ..... E-02
//   - the `location` hidden-address rule (`hidden ? venueName : ...`) E-04
//   - the unknown-slug / RPC-null 404 .............................. E-03
//   - the cancelled / multi-date guard (isSingleOpenDate) ......... E-05
//   - the vercel.json rewrite for calendar.ics ..................... E-07
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const HANDLER = "../event-calendar.js";
const RPC = "../../server/supabaseRpc";

const load = (rpcImpl) => {
  delete require.cache[require.resolve(RPC)];
  delete require.cache[require.resolve(HANDLER)];
  const original = Module._load;
  Module._load = function (request) {
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
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    end(b) { this.body = b; },
  };
};

const QUERY = { brandSlug: "foodiefantasybythesea", eventSlug: "foodiefantasy-by-the-sea" };
const EVENT = {
  id: "9132b8c6-1111-4222-8333-444455556666",
  name: "FoodieFantasy By The Sea",
  status: "scheduled",
  masterStartAt: "2026-12-20T14:00:00+00:00",
  masterEndAt: "2026-12-20T19:30:00+00:00",
  venueName: "Jameson Yard",
  address: "5 Wumego Cres, Lekki Phase I, Lagos",
  hideAddressUntilTicket: false,
};

const call = async (rpcImpl, query = QUERY) => {
  const res = mockRes();
  await load(rpcImpl)({ query }, res);
  return res;
};
const bundle = (event) => async (name) => (name === "pg_direct_event_checkout_bundle" ? event : null);

test("E-01 a real event returns 200 text/calendar with the right DTSTART, DTEND, LOCATION, UID", async () => {
  const res = await call(bundle(EVENT));
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "text/calendar; charset=utf-8");
  assert.equal(res.headers["content-disposition"], 'inline; filename="foodiefantasy-by-the-sea.ics"');
  assert.match(res.headers["cache-control"], /^public, max-age=0, s-maxage=\d+$/);
  assert.match(res.body, /DTSTART:20261220T140000Z\r\n/);
  assert.match(res.body, /DTEND:20261220T193000Z\r\n/);
  assert.match(res.body, /LOCATION:Jameson Yard\\, 5 Wumego Cres\\, Lekki Phase I\\, Lagos\r\n/);
  assert.match(res.body, /UID:9132b8c6-1111-4222-8333-444455556666@usemingla\.com\r\n/);
  assert.match(res.body, /URL:https:\/\/host\.usemingla\.com\/e\/foodiefantasybythesea\/foodiefantasy-by-the-sea\r\n/);
  // DTSTAMP is the creation time, not the event start (RFC 5545).
  assert.doesNotMatch(res.body, /DTSTAMP:20261220T140000Z/);
});

test("E-08 a shown address names the venue and the address; a venue-prefixed address is not doubled; trailing space trimmed", async () => {
  const shown = await call(bundle({ ...EVENT, venueName: "Jameson Yard ", address: "Lekki Phase 1, Lagos, Nigeria" }));
  assert.match(shown.body, /LOCATION:Jameson Yard\\, Lekki Phase 1\\, Lagos\\, Nigeria\r\n/);
  const prefixed = await call(bundle({ ...EVENT, venueName: "Jameson Yard ", address: "jameson yard, Lekki" }));
  assert.match(prefixed.body, /LOCATION:jameson yard\\, Lekki\r\n/);
});

test("E-02 no real end (null, or before the start) is a 404, never an invented duration", async () => {
  assert.equal((await call(bundle({ ...EVENT, masterEndAt: null }))).statusCode, 404);
  assert.equal((await call(bundle({ ...EVENT, masterEndAt: "2026-12-20T13:00:00+00:00" }))).statusCode, 404);
  assert.equal((await call(bundle({ ...EVENT, masterStartAt: null }))).statusCode, 404);
});

test("E-03 draft, private and unpublished (the readers return NULL) and unknown slugs are a 404", async () => {
  assert.equal((await call(async () => null)).statusCode, 404);
  assert.equal((await call(bundle(EVENT), { brandSlug: "x", eventSlug: "../etc" })).statusCode, 404);
  assert.equal((await call(bundle(EVENT), {})).statusCode, 404);
});

test("E-04 a hidden address leaves out the street: the venue name only", async () => {
  const res = await call(bundle({ ...EVENT, hideAddressUntilTicket: true, address: null }));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /LOCATION:Jameson Yard\r\n/);
  assert.doesNotMatch(res.body, /Wumego/);
  // and even if a reader over-supplied the street, a hidden event never prints it
  const over = await call(bundle({ ...EVENT, hideAddressUntilTicket: true }));
  assert.doesNotMatch(over.body, /Wumego/);
  // no venue name either: no LOCATION line at all
  const none = await call(bundle({ ...EVENT, hideAddressUntilTicket: true, venueName: null, address: null }));
  assert.doesNotMatch(none.body, /LOCATION:/);
});

test("E-05 cancelled, ended and multi-date events have no single date: 404", async () => {
  for (const patch of [{ status: "cancelled" }, { status: "ended" }, { isMultiDate: true }, { occurrences: [{}, {}] }]) {
    assert.equal((await call(bundle({ ...EVENT, ...patch }))).statusCode, 404, JSON.stringify(patch));
  }
});

test("E-06 an unlisted RSVP (second reader) is served; an upstream failure is a 502 that is never cached", async () => {
  const rsvp = async (name) => (name === "pg_public_rsvp_by_slug" ? EVENT : null);
  assert.equal((await call(rsvp)).statusCode, 200);
  const res = await call(async () => { throw new Error("boom"); });
  assert.equal(res.statusCode, 502);
  assert.equal(res.headers["cache-control"], "no-store");
});

test("E-07 vercel.json routes /e/:brand/:event/calendar.ics to this handler, before the page rewrite", () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../../vercel.json"), "utf8"));
  const sources = config.rewrites.map((r) => r.source);
  const ics = sources.indexOf("/e/:brandSlug/:eventSlug/calendar.ics");
  assert.ok(ics >= 0, "calendar.ics rewrite exists");
  assert.equal(config.rewrites[ics].destination, "/api/event-calendar?brandSlug=:brandSlug&eventSlug=:eventSlug");
  assert.ok(ics < sources.indexOf("/e/:brandSlug/:eventSlug"), "specific rewrite comes first");
});
