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

  async updateHome(document, data) {
    this.calls.push("home");
    const updated = { ...document, ...clone(data), id: document.id, revision: document.revision + 1 };
    this.snapshot.pages = this.snapshot.pages.map((page) =>
      page.id === document.id ? updated : page,
    );
    return clone(updated);
  }

  async createContact(data) {
    this.calls.push("contact");
    const created = { ...clone(data), id: CONTACT_ID, revision: 1 };
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
  assert.deepEqual(result.actions, [
    "upload_hero_through_private_pipeline",
    "update_home_draft",
    "create_contact_draft",
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
  assert.deepEqual(client.calls, [
    "read",
    "upload",
    "read",
    "home",
    "contact",
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
    contactId: CONTACT_ID,
    tenantId: TENANT_ID,
  });
  assert.deepEqual(client.snapshot.navigation[0].pages, target.navigation.pages);
  assert.equal(client.snapshot.settings[0].display_name, "gögi");
});

test("the seed copy contains no excluded commerce, reservation, endorsement, or provider claims", () => {
  const serialized = JSON.stringify(GOGI_SEED_COPY).toLowerCase();
  for (const excluded of [
    "whatsapp",
    "moniepoint",
    "zenith",
    "5255950743",
    "1311904951",
    "reservation",
    "book a table",
    "email",
    "somethingelse",
    "vercel",
    "payload",
    "supabase",
  ]) {
    assert.equal(serialized.includes(excluded), false, excluded);
  }
});
