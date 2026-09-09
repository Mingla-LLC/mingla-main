import assert from "node:assert/strict";
import test from "node:test";

import {
  classifySnapshot,
  deterministicHeroFilename,
  seedDocuments,
} from "../seed-gogi-pilot.mjs";

const TENANT_ID = "00000000-0000-4000-8000-000000000202";
const HOME_ID = "00000000-0000-4000-8000-000000000203";
const CONTACT_ID = "00000000-0000-4000-8000-000000000204";
const MEDIA_ID = "00000000-0000-4000-8000-000000000205";
const HERO_FILENAME = deterministicHeroFilename("b".repeat(64), "image/jpeg");

test("#2922 accepts the production Payload baseline without hidden renderer metadata", () => {
  const snapshot = {
    pages: [
      {
        id: HOME_ID,
        tenant: TENANT_ID,
        role: "home",
        slug: "/",
        title: "Home",
        enabled: true,
        nav_label: "Home",
        nav_order: 0,
        revision: 1,
        seo: { title: null, description: null },
        blocks: [],
      },
    ],
    settings: [
      {
        tenant: TENANT_ID,
        display_name: "Gogi Restaurant",
        short_description: null,
        logo: null,
        background_color: null,
        foreground_color: null,
        accent_color: null,
        typography: "editorial-serif",
        canonical_url: "https://gogi.sites.usemingla.com",
        seo_title: null,
        seo_description: null,
        social_image: null,
        analytics_consent_mode: "optional",
      },
    ],
    navigation: [{ tenant: TENANT_ID, pages: [] }],
    footer: [
      {
        tenant: TENANT_ID,
        address: null,
        hours_summary: null,
        legal_text: null,
        links: [],
      },
    ],
    media: [],
  };

  const plan = classifySnapshot(snapshot, {
    tenantId: TENANT_ID,
    heroFilename: HERO_FILENAME,
  });

  assert.equal(plan.state, "reconcilable");
  assert.equal(plan.states.settings, "baseline");
  /*
   * [TEST-MOD-APPROVED #3149] SUPERSEDED, wave 4 — one entry appended:
   *   "create_contact_draft",
   *   "update_navigation_draft",
   *
   * The seed describes a sixth page, so a plan against the untouched
   * production baseline reports a sixth create. This test is about what the
   * planner does with a REAL Payload baseline full of explicit nulls, and that
   * behaviour is unchanged — the plan grew by exactly the page that was added.
   *
   * SHARPENED: the assertion below is added so this keeps testing the thing it
   * is named for. A baseline of nulls must still classify as `baseline` rather
   * than as somebody's content — the failure #2922 was written about — and
   * every page absent from it must be a create rather than a refusal.
   */
  assert.deepEqual(plan.actions, [
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
  assert.equal(plan.states.home, "baseline");
  for (const role of ["about", "menu", "gallery", "contact", "reservations"]) {
    assert.equal(plan.states[role], "absent", role);
  }
});

test("#2922 never includes provisioning-owned renderer metadata in a seed mutation", () => {
  const target = seedDocuments({
    heroMediaId: MEDIA_ID,
    homeId: HOME_ID,
    contactId: CONTACT_ID,
    tenantId: TENANT_ID,
  });

  assert.equal(Object.hasOwn(target.settings, "renderer_key"), false);
});
