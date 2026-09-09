import assert from "node:assert/strict";
import test from "node:test";

import {
  classifySnapshot,
  deterministicHeroFilename,
  seedDocuments,
} from "../seed-gogi-pilot.mjs";

const TENANT_ID = "00000000-0000-4000-8000-000000000501";
const HOME_ID = "00000000-0000-4000-8000-000000000502";
const CONTACT_ID = "00000000-0000-4000-8000-000000000503";
const ABOUT_ID = "00000000-0000-4000-8000-000000000505";
const MENU_ID = "00000000-0000-4000-8000-000000000506";
// #3149 wave 4 — the sixth page, which this fixture must carry for the same
// reason it carries About and Menu.
const RESERVATIONS_ID = "00000000-0000-4000-8000-000000000507";
const MEDIA_ID = "00000000-0000-4000-8000-000000000504";
const HERO_DIGEST = "b".repeat(64);
const HERO_FILENAME = deterministicHeroFilename(HERO_DIGEST, "image/jpeg");

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .reverse()
      .map((key) => [key, reverseObjectKeys(value[key])]),
  );
}

function targetSnapshot() {
  const target = seedDocuments({
    heroMediaId: MEDIA_ID,
    homeId: HOME_ID,
    contactId: CONTACT_ID,
    aboutId: ABOUT_ID,
    menuId: MENU_ID,
    reservationsId: RESERVATIONS_ID,
    tenantId: TENANT_ID,
  });
  return {
    // Gallery is absent on purpose: with no media it has no blocks, so the seed
    // never creates it.
    /*
     * [TEST-MOD-APPROVED #3149] SUPERSEDED, wave 4 — one page appended to this
     * fixture:
     *   { id: CONTACT_ID, ...reverseObjectKeys(target.contact) },
     *   ],
     *
     * A FIXTURE GAP, not a changed rule. This snapshot is meant to be "the
     * seed's own output, with every object's keys reversed", and the seed now
     * writes six pages. Left at five it was no longer that, and the planner
     * correctly reported the missing page — which surfaced here as an opaque
     * EXISTING_NON_SEED_CONTENT rather than as a useful failure.
     *
     * SHARPENED: the reversal now also covers `venue_reservation` and an
     * `hours_location` carrying the wave 4 live-clock fields, so the
     * key-ordering guarantee this test exists for is proved over the new block
     * shapes too, including a boolean and a nested array.
     */
    pages: [
      { id: HOME_ID, ...reverseObjectKeys(target.home) },
      { id: ABOUT_ID, ...reverseObjectKeys(target.about) },
      { id: MENU_ID, ...reverseObjectKeys(target.menu) },
      { id: CONTACT_ID, ...reverseObjectKeys(target.contact) },
      { id: RESERVATIONS_ID, ...reverseObjectKeys(target.reservations) },
    ],
    settings: [{ id: "settings-1", ...reverseObjectKeys(target.settings) }],
    navigation: [{ id: "navigation-1", ...reverseObjectKeys(target.navigation) }],
    footer: [{ id: "footer-1", ...reverseObjectKeys(target.footer) }],
    media: [{
      id: MEDIA_ID,
      filename: HERO_FILENAME,
      state: "READY",
    }],
  };
}

test("#2939 accepts Payload key ordering when every canonical value is unchanged", () => {
  const plan = classifySnapshot(targetSnapshot(), {
    tenantId: TENANT_ID,
    heroFilename: HERO_FILENAME,
  });
  assert.equal(plan.state, "seeded");
  assert.deepEqual(plan.actions, []);
  assert.deepEqual(plan.states, {
    media: "target",
    home: "target",
    about: "target",
    menu: "target",
    gallery: "absent",
    contact: "target",
    reservations: "target",
    navigation: "target",
    footer: "target",
    settings: "target",
  });
});

test("#2939 still rejects changed content and changed array order", () => {
  const changedCopy = targetSnapshot();
  changedCopy.pages[0].blocks[0].heading = "Unapproved copy";
  assert.throws(
    () => classifySnapshot(changedCopy, {
      tenantId: TENANT_ID,
      heroFilename: HERO_FILENAME,
    }),
    /EXISTING_NON_SEED_CONTENT/,
  );

  const changedOrder = targetSnapshot();
  changedOrder.pages[0].blocks.reverse();
  assert.throws(
    () => classifySnapshot(changedOrder, {
      tenantId: TENANT_ID,
      heroFilename: HERO_FILENAME,
    }),
    /EXISTING_NON_SEED_CONTENT/,
  );
});
