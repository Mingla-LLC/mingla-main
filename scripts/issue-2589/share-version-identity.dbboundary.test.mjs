/**
 * #2589 — a share version identifies the CARD, and a cover change still mints.
 * Asserted at the database boundary.
 *
 * WHAT THIS PROVES, and why it is written against a real database.
 *
 * The claim is not "the mapper returns a different object". It is "the number of
 * IMMUTABLE ROWS this pipeline creates changed in exactly one direction". That
 * only means something if the rows are written by the real mint RPC with its
 * real fingerprint arithmetic, and read back out of the real table. Every
 * assertion below counts rows in `content_share_versions`.
 *
 * The four properties, and why each one needs the other three:
 *
 *   C1  a ticket sale mints NOTHING — the churn.
 *   C2  a real change to the offering STILL mints — anti-vacuity. A fingerprint
 *       that never moves is exactly as broken as one that always moves, and it
 *       is the failure mode a careless fix produces.
 *   C3  adding, changing and removing a cover EACH mint — the interaction. Today
 *       a newly added cover propagates by accident, riding on the churn C1
 *       removes; after C1 it has to ride on the cover's own identity, or a stale
 *       picture sits in a one-year immutable cache. Asserted in BOTH directions.
 *   C4  the address-privacy gate #2587 shipped is untouched by all of it.
 *
 * FAILS-ON-REVERT. Deleting the `public.issue_2589_share_version_identity_facts(...)`
 * call from the migration's fingerprint line fails C1. Deleting the whole helper
 * or making it strip more than the volatile key fails C2 and C3. C5 is the
 * negative control: it restores the shipped pre-fix arithmetic through the real
 * RPC and proves C1's detector can actually go red.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { installPreFixFingerprint, lit, startIssue2589Database } from "./pgFixture.mjs";
import { createPgRestClient } from "../issue-2587/pgRestClient.mjs";
import { refreshContentShareV1 } from "../../supabase/functions/_shared/contentShareService.ts";

/** A host that has NOT asked for address privacy — so its location is published. */
const OPEN_THEME = { business_event: { hideAddressUntilTicket: false, location: { venueName: "The Open Rooms" } } };
/** A host who HAS. #2587's gate must keep holding across everything below. */
const GATED_THEME = { business_event: { hideAddressUntilTicket: true, location: { venueName: "The Quiet Rooms" } } };
const OPEN_LOCATION = "221B Baker Street, Marylebone, London NW1 6XE, United Kingdom";
const WITHHELD_LOCATION = "Unit 4, 118 Example Row, Shoreditch, London EC2A 4NE, United Kingdom";

const STORAGE_COVER = "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/event-covers/first.jpg";
const STORAGE_COVER_TWO = "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/event-covers/second.jpg";
/**
 * A REAL Giphy delivery host shape. `media4` is one of the shards Giphy's API
 * actually returns; the allowlist used to name `media.giphy.com`, which it never
 * returns, so this URL was rejected and the share carried no card at all.
 */
const GIPHY_GIF = "https://media4.giphy.com/media/l0HlKrB02QY0f1mbm/giphy.gif";
const GIPHY_STILL = "https://media4.giphy.com/media/l0HlKrB02QY0f1mbm/giphy_s.gif";

let pg;
let db;
let mintRpcSql;

const seedOffering = ({ slug, theme, locationText }) => {
  const id = pg.scalar("SELECT gen_random_uuid()");
  const ticketId = pg.scalar("SELECT gen_random_uuid()");
  pg.exec(`
INSERT INTO public.events (id, brand_id, title, description, slug, location_text, theme,
  status, visibility, published_at, timezone, event_type, is_multi_date)
VALUES (${lit(id)}::uuid,
  (SELECT id FROM public.brands WHERE slug = 'example-host'),
  ${lit(`Title ${slug}`)}, ${lit("A public description.")}, ${lit(slug)},
  ${lit(locationText)}, ${lit(JSON.stringify(theme))}::jsonb,
  'scheduled', 'public', now(), 'Europe/London', 'event', false);
INSERT INTO public.event_dates (event_id, start_at, end_at, timezone, is_master)
VALUES (${lit(id)}::uuid, now() + interval '30 days', now() + interval '30 days 3 hours', 'Europe/London', true);
INSERT INTO public.ticket_types (id, event_id, price_cents, currency, display_order)
VALUES (${lit(ticketId)}::uuid, ${lit(id)}::uuid, 2500, 'GBP', 1);
INSERT INTO public.issue_2589_remaining (ticket_type_id, remaining) VALUES (${lit(ticketId)}::uuid, 120);
`);
  return { id, ticketId };
};

/** Mints the link through the REAL RPC so the version chain exists. */
const mintPlaceholder = (eventId, slug) => pg.scalar(`SELECT public.upsert_content_share_version(
  'event'::text, NULL::uuid, ${lit(`event:${eventId}`)}::text,
  ${lit(JSON.stringify({ eventId, serverCreated: true }))}::jsonb,
  '{}'::jsonb,
  ${lit(JSON.stringify({ schemaVersion: 1, kind: "event", title: "Placeholder", route: { eventSlug: slug } }))}::jsonb,
  NULL,
  ${lit(JSON.stringify({ kind: "event", brandSlug: "example-host", eventSlug: slug, webPath: `/e/example-host/${slug}` }))}::jsonb)`);

const versionsFor = (shortCode) => pg.rows(`
  SELECT v.version, v.facts, v.media_identity, v.version_fingerprint
  FROM public.content_share_versions v
  JOIN public.content_share_links l ON l.id = v.link_id
  WHERE l.short_code = ${lit(shortCode)}
  ORDER BY v.version`);

const setCover = (eventId, { url, type, poster }) => pg.exec(`
  UPDATE public.events SET cover_media_url = ${lit(url)}, cover_media_type = ${lit(type)},
    cover_media_poster_url = ${lit(poster)} WHERE id = ${lit(eventId)}::uuid`);

const sellTickets = (ticketId, remaining) => pg.exec(
  `UPDATE public.issue_2589_remaining SET remaining = ${remaining} WHERE ticket_type_id = ${lit(ticketId)}::uuid`,
);

/** One public read of `/s/<code>`, which is what re-derives and may mint. */
const publicRead = async (shortCode) => {
  const response = await refreshContentShareV1(db, shortCode);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.contentShare;
};

/**
 * THE CHURN DETECTOR. Runs one public read and reports how many immutable rows
 * it created. Reads the table, not the return value of the code that wrote it.
 */
const versionsMintedBy = async (shortCode, act) => {
  const before = versionsFor(shortCode).length;
  if (act) await act();
  const envelope = await publicRead(shortCode);
  const after = versionsFor(shortCode);
  return { minted: after.length - before, envelope, versions: after };
};

/** #2587's detector, reused verbatim in intent: value-blind, table-level. */
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
    throw new Error(`#2589 privacy regression: ${leaks.map((row) => `${row.short_code} v${row.version} facts.${row.fact_key}`).join(", ")}`);
  }
};

test.before(async () => {
  pg = await startIssue2589Database();
  mintRpcSql = pg.verbatim2589.mintRpc;
  pg.exec("INSERT INTO public.brands (name, slug) VALUES ('Example Host', 'example-host');");
  db = createPgRestClient(pg);
});

test.after(() => { if (pg) pg.stop(); });

test("C0 the volatile fact is really present and really moves — otherwise every claim below is vacuous", async () => {
  const { id, ticketId } = seedOffering({ slug: "churn-event", theme: OPEN_THEME, locationText: OPEN_LOCATION });
  const link = mintPlaceholder(id, "churn-event");

  const first = await publicRead(link.shortCode);
  assert.equal(first.facts.availability, "120 left", JSON.stringify(first.facts));

  sellTickets(ticketId, 119);
  const second = await publicRead(link.shortCode);
  // Still DISPLAYED, and still live: the fix does not delete this fact, it only
  // stops it deciding whether a new immutable version exists.
  assert.equal(second.facts.availability, "119 left", JSON.stringify(second.facts));
});

test("C1 a ticket sale mints NO new version — the churn", async () => {
  const rows = pg.rows(`SELECT id FROM public.events WHERE slug = 'churn-event'`);
  const eventId = rows[0].id;
  const ticketId = pg.rows(`SELECT id FROM public.ticket_types WHERE event_id = ${lit(eventId)}::uuid`)[0].id;
  const link = pg.rows(`SELECT short_code FROM public.content_share_links WHERE source_key = ${lit(`event:${eventId}`)}`)[0];

  // Baseline: an unchanged read mints nothing. If this ever fails, C1's zero
  // below would be meaningless.
  const idle = await versionsMintedBy(link.short_code);
  assert.equal(idle.minted, 0, "an unchanged public read minted a version");

  // Five sales in a row. Before #2589 each of these minted a brand-new immutable
  // version and a brand-new image URL nobody's CDN had ever seen; the live link
  // that motivated this issue burned 88 of them in four days for one identical
  // picture.
  let total = 0;
  for (const remaining of [118, 117, 116, 115, 114]) {
    const result = await versionsMintedBy(link.short_code, () => sellTickets(ticketId, remaining));
    total += result.minted;
    assert.equal(result.envelope.facts.availability, `${remaining} left`);
  }
  assert.equal(total, 0, "a ticket sale still mints immutable versions");
});

test("C2 ANTI-VACUITY — a real change to the offering still mints exactly one version", async () => {
  const eventId = pg.rows(`SELECT id FROM public.events WHERE slug = 'churn-event'`)[0].id;
  const link = pg.rows(`SELECT short_code FROM public.content_share_links WHERE source_key = ${lit(`event:${eventId}`)}`)[0];

  const titled = await versionsMintedBy(link.short_code, () => {
    pg.exec(`UPDATE public.events SET title = 'A genuinely different title' WHERE id = ${lit(eventId)}::uuid`);
  });
  assert.equal(titled.minted, 1, "a changed title did not mint a version — the fingerprint is frozen");
  assert.equal(titled.envelope.facts.title, "A genuinely different title");

  const described = await versionsMintedBy(link.short_code, () => {
    pg.exec(`UPDATE public.events SET description = 'A genuinely different description.' WHERE id = ${lit(eventId)}::uuid`);
  });
  assert.equal(described.minted, 1, "a changed description did not mint a version");

  const relocated = await versionsMintedBy(link.short_code, () => {
    pg.exec(`UPDATE public.events SET location_text = 'A different public address' WHERE id = ${lit(eventId)}::uuid`);
  });
  assert.equal(relocated.minted, 1, "a changed location did not mint a version");
  assert.equal(relocated.envelope.facts.venue, "A different public address");
});

test("C3 the cover's identity mints — added, changed AND removed", async () => {
  const { id, ticketId } = seedOffering({ slug: "cover-event", theme: OPEN_THEME, locationText: OPEN_LOCATION });
  const link = mintPlaceholder(id, "cover-event");
  await publicRead(link.shortCode);

  // Sanity: the offering starts with no cover, so "added" is a real transition.
  const start = versionsFor(link.shortCode).at(-1);
  assert.equal(start.media_identity, null, JSON.stringify(start));

  // ADDED. This is the interaction the churn fix could have broken: before
  // #2589 a newly added cover propagated by riding on the version churn. It now
  // has to mint on its own, or a stale picture sits in a one-year immutable
  // cache.
  const added = await versionsMintedBy(link.shortCode, () => setCover(id, { url: STORAGE_COVER, type: "image", poster: null }));
  assert.equal(added.minted, 1, "adding a cover did not mint a version — the new picture would never propagate");
  assert.equal(added.envelope.media.posterUrl, STORAGE_COVER);

  // CHANGED.
  const changed = await versionsMintedBy(link.shortCode, () => setCover(id, { url: STORAGE_COVER_TWO, type: "image", poster: null }));
  assert.equal(changed.minted, 1, "changing the cover did not mint a version");
  assert.equal(changed.envelope.media.posterUrl, STORAGE_COVER_TWO);

  // REMOVED — the other direction, asserted rather than assumed.
  const removed = await versionsMintedBy(link.shortCode, () => setCover(id, { url: null, type: null, poster: null }));
  assert.equal(removed.minted, 1, "removing the cover did not mint a version");
  assert.equal(removed.envelope.media, null);
  assert.equal(versionsFor(link.shortCode).at(-1).media_identity, null);

  // And a sale on THIS link still mints nothing, so C3's mints are the cover's
  // and not a side effect of anything else moving.
  const sale = await versionsMintedBy(link.shortCode, () => sellTickets(ticketId, 90));
  assert.equal(sale.minted, 0);
});

test("C4 a Giphy-hosted GIF cover produces a card, from its STILL, not its animation", async () => {
  const { id } = seedOffering({ slug: "giphy-event", theme: OPEN_THEME, locationText: OPEN_LOCATION });
  const link = mintPlaceholder(id, "giphy-event");
  await publicRead(link.shortCode);

  const applied = await versionsMintedBy(link.shortCode, () => setCover(id, { url: GIPHY_GIF, type: "gif", poster: GIPHY_STILL }));
  assert.equal(applied.minted, 1, "a Giphy cover did not mint a version");

  const media = applied.envelope.media;
  assert.notEqual(media, null, "a real Giphy host still produces no media — the allowlist is still wrong");
  assert.equal(media.kind, "gif");
  assert.equal(media.url, GIPHY_GIF);
  // THE STILL-FRAME OUTCOME, asserted rather than the animation: what the card
  // composes is `posterUrl`, and for a Giphy cover that is Giphy's own `_s`
  // still. Social previews do not animate; a GIF share is a first frame by
  // design, and this is the assertion that pins that.
  assert.equal(media.posterUrl, GIPHY_STILL);
  assert.notEqual(media.posterUrl, media.url);
  assert.equal(versionsFor(link.shortCode).at(-1).media_identity.posterUrl, GIPHY_STILL);
});

test("C5 NEGATIVE CONTROL — the churn detector goes red on the genuine shipped defect", async () => {
  const eventId = pg.rows(`SELECT id FROM public.events WHERE slug = 'churn-event'`)[0].id;
  const ticketId = pg.rows(`SELECT id FROM public.ticket_types WHERE event_id = ${lit(eventId)}::uuid`)[0].id;
  const link = pg.rows(`SELECT short_code FROM public.content_share_links WHERE source_key = ${lit(`event:${eventId}`)}`)[0];

  // Restore the arithmetic that is in production today — the real defect, in the
  // real RPC, not a mock and not a malformed fixture — and prove C1's detector
  // can actually fail. Without this, C1's zero could mean "the volatile fact
  // never moved" instead of "the volatile fact no longer counts".
  installPreFixFingerprint(pg, mintRpcSql);
  try {
    // The very first read after the revert re-mints once because the fingerprint
    // TEXT changed; step past it, then measure a pure sale.
    await publicRead(link.short_code);
    const sale = await versionsMintedBy(link.short_code, () => sellTickets(ticketId, 61));
    assert.equal(sale.minted, 1, "the pre-#2589 arithmetic did not churn — the negative control proves nothing");
  } finally {
    pg.exec(mintRpcSql);
  }

  // Restored: a sale mints nothing again. Same link, same read, same table.
  await publicRead(link.short_code);
  const afterRestore = await versionsMintedBy(link.short_code, () => sellTickets(ticketId, 60));
  assert.equal(afterRestore.minted, 0, "the fix did not restore cleanly");
});

test("C6 PRIVACY DID NOT REGRESS — a gated offering still captures no location, across all of the above", async () => {
  const { id, ticketId } = seedOffering({ slug: "gated-event", theme: GATED_THEME, locationText: WITHHELD_LOCATION });
  const link = mintPlaceholder(id, "gated-event");

  // Drive the gated offering through every transition #2589 introduced, so the
  // gate is asserted against the new mint arithmetic and not only the old one.
  await publicRead(link.shortCode);
  await versionsMintedBy(link.shortCode, () => setCover(id, { url: STORAGE_COVER, type: "image", poster: null }));
  await versionsMintedBy(link.shortCode, () => setCover(id, { url: GIPHY_GIF, type: "gif", poster: GIPHY_STILL }));
  await versionsMintedBy(link.shortCode, () => sellTickets(ticketId, 5));
  await versionsMintedBy(link.shortCode, () => {
    pg.exec(`UPDATE public.events SET title = 'Gated, retitled' WHERE id = ${lit(id)}::uuid`);
  });

  for (const row of versionsFor(link.shortCode)) {
    assert.equal(Object.prototype.hasOwnProperty.call(row.facts, "venue"), false, `v${row.version}: ${JSON.stringify(row.facts)}`);
    assert.equal(JSON.stringify(row.facts).includes(WITHHELD_LOCATION), false, `v${row.version}`);
  }
  // The ungated twin still publishes its location — a gate that strips
  // everything is an outage wearing a privacy fix's clothes.
  const openVenue = pg.scalar(`SELECT (v.facts->>'venue')
    FROM public.content_share_versions v
    JOIN public.content_share_links l ON l.id = v.link_id
    WHERE l.source_key = (SELECT 'event:' || id FROM public.events WHERE slug = 'churn-event')
    ORDER BY v.version DESC LIMIT 1`);
  assert.equal(typeof openVenue, "string");
  assert.equal(openVenue.length > 0, true);

  assertNoWithheldLocationStored();
});

test("C7 NEGATIVE CONTROL — the privacy detector goes red on a genuine leaking row", () => {
  const eventId = pg.rows(`SELECT id FROM public.events WHERE slug = 'gated-event'`)[0].id;
  // Mint a REAL leaking version through the REAL RPC: the exact pre-#2587 shape,
  // holding the exact withheld string. If C6's detector cannot see this, C6's
  // green means nothing.
  pg.scalar(`SELECT public.upsert_content_share_version(
    'event'::text, NULL::uuid, ${lit(`event:${eventId}`)}::text,
    ${lit(JSON.stringify({ eventId, serverCreated: true }))}::jsonb, '{}'::jsonb,
    ${lit(JSON.stringify({ schemaVersion: 1, kind: "event", title: "Leaking", venue: WITHHELD_LOCATION, route: { eventSlug: "gated-event" } }))}::jsonb,
    NULL,
    ${lit(JSON.stringify({ kind: "event", brandSlug: "example-host", eventSlug: "gated-event", webPath: "/e/example-host/gated-event" }))}::jsonb)`);

  assert.throws(assertNoWithheldLocationStored, (error) => {
    assert.match(error.message, /^#2589 privacy regression: /);
    assert.match(error.message, /facts\.venue/);
    return true;
  });
});
