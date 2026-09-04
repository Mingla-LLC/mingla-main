// Issue #2830. seedDocuments describes a five-page website. The caller that
// applies it only ever created two of them, and wrote a navigation naming
// pages that did not exist. Every assertion here is about the CALLER: what it
// creates, and whether the navigation it writes points at real documents.
import assert from "node:assert/strict";
import test from "node:test";

import {
  GOGI_BRAND_ID,
  GOGI_CONFIGURED_BY,
  GOGI_SOURCE,
  SEED_PAGE_ROLES,
  classifySnapshot,
  deterministicHeroFilename,
  priorSeedDocuments,
  reconcileSeed,
  seedDocuments,
} from "../seed-gogi-pilot.mjs";

const SITE_ID = "00000000-0000-4000-8000-000000000201";
const TENANT_ID = "00000000-0000-4000-8000-000000000202";
const HOME_ID = "00000000-0000-4000-8000-000000000203";
const CONTACT_ID = "00000000-0000-4000-8000-000000000204";
const MEDIA_ID = "00000000-0000-4000-8000-000000000205";
const SETTINGS_ID = "00000000-0000-4000-8000-000000000206";
const NAVIGATION_ID = "00000000-0000-4000-8000-000000000207";
const FOOTER_ID = "00000000-0000-4000-8000-000000000208";
const HERO_HASH = "b".repeat(64);
const HERO_FILENAME = deterministicHeroFilename(HERO_HASH, "image/png");
const HERO = { filename: HERO_FILENAME, sha256: HERO_HASH };

function options(overrides = {}) {
  return {
    siteId: SITE_ID,
    brandId: GOGI_BRAND_ID,
    tenantId: TENANT_ID,
    configuredBy: GOGI_CONFIGURED_BY,
    heroImage: "/tmp/gogi-pilot.png",
    heroSha256: HERO_HASH,
    source: GOGI_SOURCE,
    apply: true,
    ...overrides,
  };
}

function clone(value) {
  return structuredClone(value);
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

// Models what Payload actually does: every create gets its own id.
class MultiPageClient {
  constructor(snapshot = baselineSnapshot()) {
    this.snapshot = clone(snapshot);
    this.created = [];
    this.updated = [];
    this.nextId = 300;
  }

  async readState() {
    return clone(this.snapshot);
  }

  async uploadHero(hero) {
    this.snapshot.media.push({ id: MEDIA_ID, filename: hero.filename, state: "READY" });
    return MEDIA_ID;
  }

  async createPage(data) {
    this.created.push(clone(data));
    this.nextId += 1;
    const created = {
      ...clone(data),
      id: `00000000-0000-4000-8000-00000000${this.nextId}`,
      revision: 1,
    };
    this.snapshot.pages.push(created);
    return clone(created);
  }

  async updatePage(document, data) {
    this.updated.push(document.role);
    const updated = {
      ...document,
      ...clone(data),
      id: document.id,
      revision: document.revision + 1,
    };
    this.snapshot.pages = this.snapshot.pages.map((page) =>
      page.id === document.id ? updated : page,
    );
    return clone(updated);
  }

  async updateNavigation(document, data) {
    this.snapshot.navigation[0] = { ...document, ...clone(data), id: document.id };
    return clone(this.snapshot.navigation[0]);
  }

  async updateFooter(document, data) {
    this.snapshot.footer[0] = { ...document, ...clone(data), id: document.id };
    return clone(this.snapshot.footer[0]);
  }

  async updateSettings(document, data) {
    this.snapshot.settings[0] = { ...document, ...clone(data), id: document.id };
    return clone(this.snapshot.settings[0]);
  }
}

function documentIdsFor(pages) {
  const byRole = new Map(pages.map((page) => [page.role, page]));
  return {
    heroMediaId: MEDIA_ID,
    tenantId: TENANT_ID,
    homeId: String(byRole.get("home").id),
    aboutId: byRole.has("about") ? String(byRole.get("about").id) : "pending-about",
    menuId: byRole.has("menu") ? String(byRole.get("menu").id) : "pending-menu",
    galleryId: byRole.has("gallery") ? String(byRole.get("gallery").id) : "pending-gallery",
    contactId: byRole.has("contact") ? String(byRole.get("contact").id) : "pending-contact",
  };
}

test("the caller creates a document for every page the seed says is published", async () => {
  const client = new MultiPageClient();
  const result = await reconcileSeed(client, options(), HERO);
  assert.equal(result.state, "seeded");

  const target = seedDocuments(documentIdsFor(client.snapshot.pages));
  const publishedRoles = SEED_PAGE_ROLES.filter((role) => target[role].enabled);
  const liveRoles = client.snapshot.pages.map((page) => page.role);

  // The bug: About and Menu were described but never created.
  for (const role of publishedRoles) {
    assert.equal(
      liveRoles.includes(role),
      true,
      `${role} is published by the seed but the caller never created it`,
    );
  }
  assert.equal(new Set(liveRoles).size, liveRoles.length, "duplicate role documents");
});

test("every id in the written navigation resolves to a real page document", async () => {
  const client = new MultiPageClient();
  await reconcileSeed(client, options(), HERO);

  const navigationPages = client.snapshot.navigation[0].pages;
  const realIds = new Set(client.snapshot.pages.map((page) => String(page.id)));
  assert.notEqual(navigationPages.length, 0);
  for (const id of navigationPages) {
    assert.equal(realIds.has(String(id)), true, `navigation names a page that does not exist: ${id}`);
    assert.equal(String(id).startsWith("pending-"), false, `placeholder id reached navigation: ${id}`);
  }
});

test("navigation lists exactly the published pages, in nav order", async () => {
  const client = new MultiPageClient();
  await reconcileSeed(client, options(), HERO);

  const byId = new Map(client.snapshot.pages.map((page) => [String(page.id), page]));
  const listed = client.snapshot.navigation[0].pages.map((id) => byId.get(String(id)));
  assert.deepEqual(
    listed.map((page) => page.role),
    [...listed].sort((a, b) => a.nav_order - b.nav_order).map((page) => page.role),
  );
  for (const page of listed) {
    assert.equal(page.enabled, true, `navigation lists an unpublished page: ${page.role}`);
  }
  const publishedRoles = client.snapshot.pages
    .filter((page) => page.enabled)
    .map((page) => page.role)
    .sort();
  assert.deepEqual(listed.map((page) => page.role).sort(), publishedRoles);
});

test("no page payload carries the internal _id field over the wire", async () => {
  const client = new MultiPageClient();
  await reconcileSeed(client, options(), HERO);
  for (const payload of client.created) {
    assert.equal("_id" in payload, false, "_id was POSTed to Payload");
  }
});

test("the site an earlier version of this seed wrote is reconcilable, not foreign", () => {
  const home = { id: HOME_ID, revision: 3 };
  const contact = { id: CONTACT_ID, revision: 2 };
  const prior = priorSeedDocuments({
    heroMediaId: MEDIA_ID,
    homeId: HOME_ID,
    contactId: CONTACT_ID,
    tenantId: TENANT_ID,
  });
  const snapshot = {
    pages: [
      { ...prior.home, ...home },
      { ...prior.contact, ...contact },
    ],
    settings: [{ ...prior.settings, id: SETTINGS_ID }],
    navigation: [{ ...prior.navigation, id: NAVIGATION_ID }],
    footer: [{ ...prior.footer, id: FOOTER_ID }],
    media: [{ id: MEDIA_ID, filename: HERO_FILENAME, state: "READY" }],
  };
  const plan = classifySnapshot(snapshot, {
    tenantId: TENANT_ID,
    heroFilename: HERO_FILENAME,
  });
  assert.equal(plan.state, "reconcilable");
  assert.equal(plan.states.home, "prior_seed");
  assert.equal(plan.states.contact, "prior_seed");
  assert.deepEqual(
    plan.actions.filter((action) => action.startsWith("create_")),
    ["create_about_draft", "create_menu_draft"],
  );
});

test("a page a human edited is still refused", () => {
  const snapshot = baselineSnapshot();
  snapshot.pages[0].blocks = [{ blockType: "rich_text", heading: "our own words" }];
  snapshot.media.push({ id: MEDIA_ID, filename: HERO_FILENAME, state: "READY" });
  assert.throws(
    () => classifySnapshot(snapshot, { tenantId: TENANT_ID, heroFilename: HERO_FILENAME }),
    (error) => error.code === "EXISTING_NON_SEED_CONTENT",
  );
});
