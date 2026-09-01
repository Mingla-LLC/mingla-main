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
    tenantId: TENANT_ID,
  });
  return {
    pages: [
      { id: HOME_ID, ...reverseObjectKeys(target.home) },
      { id: CONTACT_ID, ...reverseObjectKeys(target.contact) },
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
    contact: "target",
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
