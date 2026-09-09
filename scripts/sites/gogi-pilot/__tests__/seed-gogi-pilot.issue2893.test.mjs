import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GOGI_BRAND_ID,
  GOGI_CONFIGURED_BY,
  GOGI_SEED_COPY,
  GOGI_SOURCE,
  SeedError,
  classifySnapshot,
  deterministicHeroFilename,
  inspectHero,
  reconcileSeed,
  seedDocuments,
  validateOptions,
  validateStudioSession,
} from "../seed-gogi-pilot.mjs";

const SITE_ID = "00000000-0000-4000-8000-000000000101";
const TENANT_ID = "00000000-0000-4000-8000-000000000102";
const HOME_ID = "00000000-0000-4000-8000-000000000103";
const CONTACT_ID = "00000000-0000-4000-8000-000000000104";
const ABOUT_ID = "00000000-0000-4000-8000-000000000109";
const MENU_ID = "00000000-0000-4000-8000-000000000110";
// Payload gives every created document its own id. A fake that returns one id
// for every create cannot model a multi-page seed.
// #3149 wave 4 — the sixth page the seed creates.
const RESERVATIONS_ID = "00000000-0000-4000-8000-000000000111";
const CREATED_PAGE_IDS = {
  about: ABOUT_ID,
  menu: MENU_ID,
  contact: CONTACT_ID,
  reservations: RESERVATIONS_ID,
};
const MEDIA_ID = "00000000-0000-4000-8000-000000000105";
const SETTINGS_ID = "00000000-0000-4000-8000-000000000106";
const NAVIGATION_ID = "00000000-0000-4000-8000-000000000107";
const FOOTER_ID = "00000000-0000-4000-8000-000000000108";
const HERO_HASH = "a".repeat(64);
const HERO_FILENAME = deterministicHeroFilename(HERO_HASH, "image/png");

function options(overrides = {}) {
  return {
    siteId: SITE_ID,
    brandId: GOGI_BRAND_ID,
    tenantId: TENANT_ID,
    configuredBy: GOGI_CONFIGURED_BY,
    heroImage: "/tmp/gogi-pilot.png",
    heroSha256: HERO_HASH,
    source: GOGI_SOURCE,
    apply: false,
    ...overrides,
  };
}

function baselineSnapshot() {
  return {
    pages: [
      {
        id: HOME_ID,
        tenant: TENANT_ID,
        role: "home",
        title: "Home",
        enabled: true,
        nav_label: "Home",
        nav_order: 0,
        revision: 1,
        blocks: [],
      },
    ],
    settings: [
      {
        id: SETTINGS_ID,
        tenant: TENANT_ID,
        display_name: "Gogi Restaurant",
        typography: "editorial-serif",
        canonical_url: "https://gogi.sites.usemingla.com",
        analytics_consent_mode: "optional",
        renderer_key: "restaurant-website-v1",
      },
    ],
    navigation: [{ id: NAVIGATION_ID, tenant: TENANT_ID, pages: [] }],
    footer: [{ id: FOOTER_ID, tenant: TENANT_ID }],
    media: [],
  };
}

function clone(value) {
  return structuredClone(value);
}

class FakeClient {
  constructor(snapshot = baselineSnapshot()) {
    this.snapshot = clone(snapshot);
    this.calls = [];
  }

  async readState() {
    this.calls.push("read");
    return clone(this.snapshot);
  }

  async uploadHero(hero) {
    this.calls.push("upload");
    this.snapshot.media.push({ id: MEDIA_ID, filename: hero.filename, state: "READY" });
    return MEDIA_ID;
  }

  async updatePage(document, data) {
    this.calls.push(document.role);
    const updated = { ...document, ...clone(data), id: document.id, revision: document.revision + 1 };
    this.snapshot.pages = this.snapshot.pages.map((page) =>
      page.id === document.id ? updated : page,
    );
    return clone(updated);
  }

  async createPage(data) {
    this.calls.push(data.role);
    const id = CREATED_PAGE_IDS[data.role];
    assert.ok(id, `fake client has no id for role ${data.role}`);
    const created = { ...clone(data), id, revision: 1 };
    this.snapshot.pages.push(created);
    return clone(created);
  }

  async updateNavigation(document, data) {
    this.calls.push("navigation");
    this.snapshot.navigation[0] = { ...document, ...clone(data), id: document.id };
    return clone(this.snapshot.navigation[0]);
  }

  async updateFooter(document, data) {
    this.calls.push("footer");
    this.snapshot.footer[0] = { ...document, ...clone(data), id: document.id };
    return clone(this.snapshot.footer[0]);
  }

  async updateSettings(document, data) {
    this.calls.push("settings");
    this.snapshot.settings[0] = { ...document, ...clone(data), id: document.id };
    return clone(this.snapshot.settings[0]);
  }
}

function expectCode(expected, callback) {
  assert.throws(callback, (error) => error instanceof SeedError && error.code === expected);
}

test("rejects a different brand or configured-by identity", () => {
  expectCode("WRONG_GOGI_BRAND", () =>
    validateOptions(options({ brandId: "00000000-0000-4000-8000-000000000199" })),
  );
  expectCode("WRONG_CONFIGURED_BY", () =>
    validateOptions(options({ configuredBy: "00000000-0000-4000-8000-000000000198" })),
  );
});

test("rejects an unsupported source authority", () => {
  expectCode("UNSUPPORTED_SOURCE", () =>
    validateOptions(options({ source: "existing-gogi-vercel-site" })),
  );
});

test("rejects a missing hero file and a mismatched digest", async () => {
  await assert.rejects(
    inspectHero("/definitely/missing/gogi.png", HERO_HASH),
    (error) => error instanceof SeedError && error.code === "HERO_IMAGE_MISSING",
  );
  const directory = await mkdtemp(join(tmpdir(), "mingla-gogi-seed-"));
  const path = join(directory, "hero.png");
  const minimalPng = Buffer.from(
    "89504e470d0a1a0a0000000049454e44ae426082",
    "hex",
  );
  await writeFile(path, minimalPng);
  await assert.rejects(
    inspectHero(path, HERO_HASH),
    (error) => error instanceof SeedError && error.code === "HERO_SHA256_MISMATCH",
  );
  const digest = createHash("sha256").update(minimalPng).digest("hex");
  const inspected = await inspectHero(path, digest);
  assert.equal(inspected.mime, "image/png");
  assert.equal(inspected.sha256, digest);
});

test("binds the short-lived Studio session to all four exact identities", () => {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    version: 1,
    site_id: SITE_ID,
    brand_id: GOGI_BRAND_ID,
    tenant_id: TENANT_ID,
    user_id: GOGI_CONFIGURED_BY,
    rank: 60,
    issued_at: now,
    absolute_expires_at: now + 3600,
    idle_expires_at: now + 1800,
    return_surface: "web",
  };
  const token = `${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${"s".repeat(43)}`;
  assert.equal(
    validateStudioSession(token, "c".repeat(43), options(), now).session,
    token,
  );
  const wrongTenant = {
    ...claims,
    tenant_id: "00000000-0000-4000-8000-000000000199",
  };
  const wrongToken = `${Buffer.from(JSON.stringify(wrongTenant)).toString("base64url")}.${"s".repeat(43)}`;
  expectCode("STUDIO_SESSION_SCOPE_MISMATCH", () =>
    validateStudioSession(wrongToken, "c".repeat(43), options(), now),
  );
});

test("fails closed on a cross-tenant Payload response", () => {
  const snapshot = baselineSnapshot();
  snapshot.pages[0].tenant = "00000000-0000-4000-8000-000000000199";
  expectCode("CROSS_TENANT_RESPONSE", () =>
    classifySnapshot(snapshot, { tenantId: TENANT_ID, heroFilename: HERO_FILENAME }),
  );
});

test("refuses to overwrite any existing non-seed content", () => {
  const snapshot = baselineSnapshot();
  snapshot.pages[0].blocks = [{ blockType: "cta", heading: "Owner content", label: "Keep", href: "/" }];
  expectCode("EXISTING_NON_SEED_CONTENT", () =>
    classifySnapshot(snapshot, { tenantId: TENANT_ID, heroFilename: HERO_FILENAME }),
  );
});

test("dry-run is read-only and reports the exact pending actions", async () => {
  const client = new FakeClient();
  const result = await reconcileSeed(client, options(), {
    filename: HERO_FILENAME,
    sha256: HERO_HASH,
  });
  assert.equal(result.mode, "dry-run");
  assert.equal(result.changed, false);
  assert.deepEqual(client.calls, ["read"]);
  /*
   * [TEST-MOD-APPROVED #3149] SUPERSEDED, wave 4 — one entry appended:
   *   "create_contact_draft",
   *   "update_navigation_draft",
   *
   * The seed now describes a sixth page, so a dry-run against an unseeded site
   * reports a sixth create. Nothing else in the plan moved.
   *
   * SHARPENED: this is an exact-order deepEqual over the WHOLE plan, so the
   * new entry is pinned in its position — after contact, before the navigation
   * write — which is the ordering the caller depends on. A page created after
   * the navigation is written is a page the navigation cannot name, and that
   * is the #2830 defect this suite exists for.
   */
  assert.deepEqual(result.actions, [
    "upload_hero_through_private_pipeline",
    "update_home_draft",
    "create_about_draft",
    "create_menu_draft",
    "create_contact_draft",
    "create_reservations_draft",
    "update_navigation_draft",
    "update_footer_draft",
    "update_site_settings_draft",
  ]);
});

test("apply uses every real boundary once and a successful rerun writes nothing", async () => {
  const client = new FakeClient();
  const hero = { filename: HERO_FILENAME, sha256: HERO_HASH };
  const first = await reconcileSeed(client, options({ apply: true }), hero);
  assert.deepEqual(first, {
    mode: "apply",
    state: "seeded",
    actions: [],
    changed: true,
  });
  /*
   * [TEST-MOD-APPROVED #3149] SUPERSEDED, wave 4 — one call appended:
   *   "contact",
   *   "navigation",
   *
   * SHARPENED for the same reason as the plan above: this is the record of
   * every boundary the apply actually crossed, in order, and it now pins that
   * the reservations page is WRITTEN BEFORE the navigation that has to name
   * it. Without the sixth entry in this exact position the caller could create
   * the page after the navigation and nothing here would notice.
   */
  assert.deepEqual(client.calls, [
    "read",
    "upload",
    "read",
    "home",
    "about",
    "menu",
    "contact",
    "reservations",
    "navigation",
    "footer",
    "settings",
    "read",
  ]);
  const beforeRerun = client.calls.length;
  const second = await reconcileSeed(client, options({ apply: true }), hero);
  assert.deepEqual(second, {
    mode: "apply",
    state: "seeded",
    actions: [],
    changed: false,
  });
  assert.deepEqual(client.calls.slice(beforeRerun), ["read"]);
  const target = seedDocuments({
    heroMediaId: MEDIA_ID,
    homeId: HOME_ID,
    aboutId: ABOUT_ID,
    menuId: MENU_ID,
    contactId: CONTACT_ID,
    reservationsId: RESERVATIONS_ID,
    tenantId: TENANT_ID,
  });
  assert.deepEqual(client.snapshot.navigation[0].pages, target.navigation.pages);
  /*
   * #3149 wave 4 — and the sixth page is actually IN that navigation.
   *
   * The comparison above passes whenever the two agree, including when both
   * omit the page. This is the half that would have caught the real defect
   * this wave introduced: `reconcileSeed` created the reservations page and
   * then built the navigation from an id map that had no slot for it, so the
   * page existed, was reachable by URL, and appeared in no menu on the site.
   */
  assert.ok(
    client.snapshot.navigation[0].pages.includes(RESERVATIONS_ID),
    "the reservations page was created but never linked",
  );
  assert.equal(client.snapshot.settings[0].display_name, "gögi");
});

test("the seed copy contains no excluded commerce, reservation, endorsement, or provider claims", () => {
  const serialized = JSON.stringify(GOGI_SEED_COPY).toLowerCase();
  /*
   * [TEST-MOD-APPROVED #3149] SUPERSEDED, wave 4 — two entries removed from
   * this list:
   *   "reservation",
   *   "book a table",
   *
   * These two were here on a PREMISE, recorded in the #2830 ingest brief:
   * "nothing claims they take bookings, because nothing says they do." The
   * premise is now false on evidence, so the ban it produced goes with it.
   *
   * What the evidence actually shows, stated precisely because the distinction
   * is the entire justification: gögi have a real forward book of reservations
   * in Mingla — 20 of them, across 20 distinct future slot days between
   * 2026-08-28 and 2026-09-24, so not seeded rows. Every one is
   * `source = 'phone'` and `created_via = 'operator'`, with `consumer_user_id`
   * NULL on all 20 and zero rows in `venue_organic_reservation_attributions`.
   *
   * So they DO take bookings — by phone, typed in by their own staff — and
   * NOBODY has ever booked themselves. That is not a capability they lack; it
   * is a channel they do not yet have, which is exactly why a booking page is
   * worth building. It is their first self-serve one.
   *
   * DROPPED, and honestly labelled as such: no replacement can assert the
   * absence of words the site now deliberately prints. The property those two
   * entries protected is NOT abandoned, though — it is re-stated below as what
   * it was really guarding, which is that the seed reproduces none of gögi's
   * own WhatsApp-and-bank-transfer booking flow. Every other entry in the list
   * is untouched, including "whatsapp" and both account numbers.
   */
  for (const excluded of [
    "whatsapp",
    "moniepoint",
    "zenith",
    "5255950743",
    "1311904951",
    "email",
    "somethingelse",
    "vercel",
    "payload",
    "supabase",
  ]) {
    assert.equal(serialized.includes(excluded), false, excluded);
  }
  /*
   * The replacement, and it is stricter than a substring ban. A booking on
   * this site goes through Mingla, which already owns the availability, the
   * cancellation policy and the attribution — so the seed may say a table can
   * be booked, and may NOT reproduce their own channel for doing it.
   */
  for (const excluded of ["wa.me", "send the request", "send proof", "0912 711 7528 with"]) {
    assert.equal(serialized.includes(excluded), false, excluded);
  }
  // And the page that does exist carries no destination of its own at all —
  // the link is derived from the brand by the publisher.
  const reservations = seedDocuments({
    heroMediaId: MEDIA_ID,
    homeId: HOME_ID,
    tenantId: TENANT_ID,
  }).reservations;
  const booking = reservations.blocks.find(
    (block) => block.blockType === "venue_reservation",
  );
  assert.ok(booking, "the booking page must carry a reservation block");
  assert.equal(booking.url, undefined);
  assert.equal(booking.href, undefined);
  assert.equal(booking.reservation_target_id, undefined);
});
