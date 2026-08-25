/**
 * #2587 — the share capture must not publish a withheld location. DB boundary.
 *
 * WHAT THIS PROVES, and why it is written against a real database rather than
 * a fake. The defect was graded "latent" twice and shipped anyway. Both wrong
 * gradings came from asking something other than the thing that serves the
 * public: once an origin that 404s, once a hand-written stub. So every claim
 * here is asserted on a row read back out of `content_share_versions`, written
 * by the real mint RPC, with the privacy verdict produced by the real deployed
 * predicate. Nothing in this file decides whether an address is withheld.
 *
 * FAILS-ON-REVERT: deleting the `withheld ? ... :` guards in
 * `mapAuthoritativeShareFacts`, or the `issue_2489_address_withheld` read in
 * `loadAuthoritativeContentShare`, makes G1, G3 and G6 fail. G2 is the
 * anti-vacuity twin: a gate that strips every location is an outage, not a
 * fix, and G2 goes red if the location stops being captured for an offering
 * whose host never asked for privacy. G4 is a negative control — a genuine
 * leak, minted through the real RPC into the real table — and it proves the
 * detector used by G1/G3 can actually fail.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startFixtureDatabase, extractVerbatim, VERBATIM_SOURCES, ROOT, lit } from "./pgFixture.mjs";
import { createPgRestClient } from "./pgRestClient.mjs";
import { refreshContentShareV1 } from "../../supabase/functions/_shared/contentShareService.ts";

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const EDGE_MODULE = "supabase/functions/_shared/contentShare.ts";

/** The full, combined location string a host asked to keep back until purchase. */
const WITHHELD = "Unit 4, 118 Example Row, Shoreditch, London EC2A 4NE, United Kingdom";
/** The same offering's venue name — public on the gated read models today. */
const VENUE_NAME = "The Example Rooms";
/** A second offering whose host never turned the toggle on. */
const DISCLOSED = "221B Baker Street, Marylebone, London NW1 6XE, United Kingdom";

const gatedTheme = { business_event: { hideAddressUntilTicket: true, location: { venueName: VENUE_NAME, address: WITHHELD } } };
const openTheme = { business_event: { hideAddressUntilTicket: false, location: { venueName: "The Open Rooms", address: DISCLOSED } } };

let pg;
let db;

const seedOffering = ({ slug, eventType, locationText, destinationText, theme }) => {
  const id = pg.scalar(`SELECT gen_random_uuid()`);
  pg.exec(`
INSERT INTO public.events (id, brand_id, title, description, slug, location_text, destination_text, theme,
  status, visibility, published_at, timezone, event_type, is_multi_date)
VALUES (${lit(id)}::uuid,
  (SELECT id FROM public.brands WHERE slug = 'example-host'),
  ${lit(`Title ${slug}`)}, ${lit("A public description.")}, ${lit(slug)},
  ${lit(locationText)}, ${lit(destinationText ?? null)}, ${lit(JSON.stringify(theme))}::jsonb,
  'scheduled', 'public', now(), 'Europe/London', ${lit(eventType)}, false);
INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
VALUES (${lit(id)}::uuid, now() + interval '30 days', now() + interval '30 days 3 hours', 'Europe/London', true);
`);
  return id;
};

/** Mints a link + version through the REAL RPC, with caller-supplied facts. */
const mint = (kind, eventId, facts) => pg.scalar(`SELECT public.upsert_content_share_version(
  ${lit(kind)}::text, NULL::uuid, ${lit(`${kind}:${eventId}`)}::text,
  ${lit(JSON.stringify({ eventId, serverCreated: true }))}::jsonb,
  '{}'::jsonb, ${lit(JSON.stringify(facts))}::jsonb, NULL,
  ${lit(JSON.stringify({ kind, brandSlug: "example-host", eventSlug: facts.route.eventSlug, webPath: `/e/example-host/${facts.route.eventSlug}` }))}::jsonb)`);

const storedVersions = (shortCode) => pg.rows(`
  SELECT v.version, v.facts
  FROM public.content_share_versions v
  JOIN public.content_share_links l ON l.id = v.link_id
  WHERE l.short_code = ${lit(shortCode)}
  ORDER BY v.version`);

/**
 * THE DETECTOR. Deliberately value-blind and deliberately harsh: it asks the
 * database which offerings are gated, then fails if ANY stored version of a
 * gated offering's link carries a fact equal to that offering's location_text.
 * It reads the table, not the return value of the code that wrote it.
 */
const assertNoWithheldLocationStored = () => {
  const leaks = pg.rows(`
    SELECT l.short_code, v.version, k.fact_key
    FROM public.content_share_versions v
    JOIN public.content_share_links l ON l.id = v.link_id
    JOIN public.events e ON e.id = (l.source_reference->>'eventId')::uuid
    CROSS JOIN LATERAL (VALUES ('venue'), ('destination'), ('area')) AS k(fact_key)
    WHERE public.issue_2489_address_withheld(e.theme)
      AND e.location_text IS NOT NULL
      AND (v.facts->>k.fact_key) = e.location_text`);
  if (leaks.length > 0) {
    throw new Error(`#2587 leak: ${leaks.map((row) => `${row.short_code} v${row.version} facts.${row.fact_key}`).join(", ")}`);
  }
};

test.before(async () => {
  pg = await startFixtureDatabase();
  pg.exec("INSERT INTO public.brands (name, slug) VALUES ('Example Host', 'example-host');");
  db = createPgRestClient(pg);
});

test.after(() => { if (pg) pg.stop(); });

test("G1 a gated offering's first capture stores no withheld location, and the ungated twin is untouched", async () => {
  const gatedId = seedOffering({ slug: "gated-event", eventType: "event", locationText: WITHHELD, theme: gatedTheme });
  const openId = seedOffering({ slug: "open-event", eventType: "event", locationText: DISCLOSED, theme: openTheme });

  // A first capture is a refresh of a link whose version chain is empty of the
  // fact under test; mint a placeholder version so the link exists, then let
  // the production path re-derive. The placeholder carries no location at all,
  // so G1 cannot pass by inheriting one.
  const gated = mint("event", gatedId, { schemaVersion: 1, kind: "event", title: "Placeholder", route: { eventSlug: "gated-event" } });
  const open = mint("event", openId, { schemaVersion: 1, kind: "event", title: "Placeholder", route: { eventSlug: "open-event" } });

  assert.equal((await refreshContentShareV1(db, gated.shortCode)).status, 200);
  assert.equal((await refreshContentShareV1(db, open.shortCode)).status, 200);

  const gatedFacts = storedVersions(gated.shortCode).at(-1).facts;
  const openFacts = storedVersions(open.shortCode).at(-1).facts;

  // SC-1 — asserted on the payload actually stored, not on a return value.
  assert.equal(Object.prototype.hasOwnProperty.call(gatedFacts, "venue"), false, JSON.stringify(gatedFacts));
  assert.equal(JSON.stringify(gatedFacts).includes(WITHHELD), false);

  // Anti-vacuity. A gate that strips everything is an outage.
  assert.equal(openFacts.venue, DISCLOSED);

  assertNoWithheldLocationStored();
});

test("G2 the ungated twin keeps its location across the exact same code path", () => {
  const rows = pg.rows(`
    SELECT (v.facts->>'venue') AS venue, e.location_text
    FROM public.content_share_versions v
    JOIN public.content_share_links l ON l.id = v.link_id
    JOIN public.events e ON e.id = (l.source_reference->>'eventId')::uuid
    WHERE NOT public.issue_2489_address_withheld(e.theme) AND v.facts->>'kind' = 'event'
      AND (v.facts->>'title') <> 'Placeholder'`);
  assert.equal(rows.length > 0, true, "no ungated capture exists — the twin would be vacuous");
  for (const row of rows) assert.equal(row.venue, row.location_text);
});

test("G3 an already-poisoned gated link self-cleans on its next public read", async () => {
  const id = seedOffering({ slug: "poisoned-event", eventType: "event", locationText: WITHHELD, theme: gatedTheme });
  // Reproduce the live state EXACTLY: the pre-fix capture wrote the full
  // location string into facts.venue and froze it.
  const link = mint("event", id, {
    schemaVersion: 1, kind: "event", title: "Poisoned", venue: WITHHELD,
    timezone: "Europe/London", route: { eventSlug: "poisoned-event" },
  });
  assert.equal(storedVersions(link.shortCode).at(-1).facts.venue, WITHHELD, "seed did not reproduce the leak");

  // One public read. `/s/<code>` re-derives facts on every read (#2589 F-5),
  // which is the property the remediation plan depends on.
  const response = await refreshContentShareV1(db, link.shortCode);
  assert.equal(response.status, 200);

  const versions = storedVersions(link.shortCode);
  assert.equal(versions.length, 2, "the re-read did not mint a corrected version");
  assert.equal(versions[0].facts.venue, WITHHELD, "history is immutable; v1 still holds the leak");
  assert.equal(Object.prototype.hasOwnProperty.call(versions[1].facts, "venue"), false, JSON.stringify(versions[1].facts));
  assert.equal(response.body.contentShare.facts.venue, undefined);
  assert.equal(JSON.stringify(response.body.contentShare).includes(WITHHELD), false);
});

test("G4 NEGATIVE CONTROL — the detector fails on a genuine leak, for the right reason", () => {
  // G3 deliberately left a real leaking row in the real table: version 1 of the
  // poisoned link, written by the real mint RPC, holding the real withheld
  // string. If the detector cannot see that, G1's and G3's green means nothing.
  assert.throws(assertNoWithheldLocationStored, (error) => {
    assert.match(error.message, /^#2587 leak: /);
    assert.match(error.message, / v1 facts\.venue/);
    return true;
  });
});

test("G5 the verdict comes from the deployed predicate, and there is only one of it", () => {
  // (a) The predicate this fixture loaded is byte-identical to #2489's.
  const migrationText = extractVerbatim(VERBATIM_SOURCES.predicate.file, VERBATIM_SOURCES.predicate.startsWith, VERBATIM_SOURCES.predicate.endsWith);
  assert.equal(pg.verbatim.predicate, migrationText);
  assert.match(migrationText, /LANGUAGE sql\s+IMMUTABLE/);

  // (b) The share capture asked the database, with the offering's own theme.
  // `jsonb` does not preserve key order, so compare canonically.
  const canonical = (value) => JSON.stringify(value, (_key, item) => (item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item));
  const asked = db.rpcCalls.filter((call) => call.name === "issue_2489_address_withheld");
  assert.equal(asked.length > 0, true, "the capture never consulted the shared predicate");
  const themesAsked = new Set(asked.map((call) => canonical(call.args.p_theme)));
  assert.equal(themesAsked.has(canonical(gatedTheme)), true, [...themesAsked].join("\n"));
  assert.equal(themesAsked.has(canonical(openTheme)), true, [...themesAsked].join("\n"));

  // (c) Exactly one definition of the rule exists in the database.
  const definitions = pg.rows(`
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosrc LIKE '%hideAddressUntilTicket%'`);
  assert.deepEqual(definitions.map((row) => row.proname), ["issue_2489_address_withheld"]);

  // (d) It was NOT re-implemented in TypeScript. This is the structural half of
  // I-PROPOSED-2589-ONE-LOCATION-AUTHORITY: #2589 F-12 found the rule had
  // already drifted into three places, and a copy here is how it drifts again.
  const edge = read(EDGE_MODULE);
  assert.equal(edge.includes("hideAddressUntilTicket"), false, "the flag name is being read in TypeScript");
  assert.equal(edge.includes("issue_2489_address_withheld"), true);
  assert.match(edge, /db\.rpc\("issue_2489_address_withheld",\s*\{\s*p_theme:/);
});

test("G6 every location fact the share path can emit is gated, not just the event venue", async () => {
  const cases = [
    { kind: "rsvp_event", eventType: "rsvp", slug: "gated-rsvp", factKey: "venue" },
    { kind: "trip", eventType: "trip", slug: "gated-trip", factKey: "destination" },
    { kind: "experience", eventType: "experience", slug: "gated-experience", factKey: "area" },
  ];
  for (const item of cases) {
    const id = seedOffering({ slug: item.slug, eventType: item.eventType, locationText: WITHHELD, theme: gatedTheme });
    const link = mint(item.kind, id, { schemaVersion: 1, kind: item.kind, title: "Placeholder", route: { eventSlug: item.slug } });
    assert.equal((await refreshContentShareV1(db, link.shortCode)).status, 200, item.kind);
    const facts = storedVersions(link.shortCode).at(-1).facts;
    assert.equal(Object.prototype.hasOwnProperty.call(facts, item.factKey), false, `${item.kind}: ${JSON.stringify(facts)}`);
    assert.equal(JSON.stringify(facts).includes(WITHHELD), false, item.kind);
  }

  // A trip's own destination field is NOT the withheld address and must survive.
  const tripId = seedOffering({ slug: "gated-trip-with-destination", eventType: "trip", locationText: WITHHELD, destinationText: "Lisbon, Portugal", theme: gatedTheme });
  const tripLink = mint("trip", tripId, { schemaVersion: 1, kind: "trip", title: "Placeholder", route: { eventSlug: "gated-trip-with-destination" } });
  assert.equal((await refreshContentShareV1(db, tripLink.shortCode)).status, 200);
  assert.equal(storedVersions(tripLink.shortCode).at(-1).facts.destination, "Lisbon, Portugal");
});

test("G7 a predicate read that fails takes the share down rather than disclosing", async () => {
  const id = seedOffering({ slug: "unreadable-gate", eventType: "event", locationText: WITHHELD, theme: gatedTheme });
  const link = mint("event", id, { schemaVersion: 1, kind: "event", title: "Placeholder", route: { eventSlug: "unreadable-gate" } });
  const before = storedVersions(link.shortCode).length;

  const failing = createPgRestClient(pg);
  const realRpc = failing.rpc;
  failing.rpc = async (name, args) => (name === "issue_2489_address_withheld"
    ? { data: null, error: { message: "simulated transport failure" } }
    : realRpc.call(failing, name, args));

  const response = await refreshContentShareV1(failing, link.shortCode);
  assert.equal(response.status, 503);
  assert.equal(storedVersions(link.shortCode).length, before, "a failed gate read still minted a version");
});
