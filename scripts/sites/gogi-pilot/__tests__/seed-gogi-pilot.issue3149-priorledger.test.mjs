/*
 * #3149 wave 4 — the prior ledger, and the guard it must not stop being.
 *
 * The live pilot holds WAVE 3's content, which shipped through the Studio REST
 * API rather than by running this seed, so nothing recorded that it shipped.
 * Wave 4 moves the target, and `classifySnapshot` matched every live page
 * against neither the new target nor the one recorded state — so it called
 * them somebody else's content and refused to touch anything. The republish
 * was blocked outright. Measured, before the fix:
 *
 *   home invalid · about invalid · menu invalid · contact invalid
 *   navigation invalid · gallery target · footer target · settings target
 *
 * The fix records wave 3's output as a SECOND entry. The danger in a fix like
 * that is obvious and is what most of this file is about: a classifier
 * loosened until it accepts anything would pass every "does it reconcile now"
 * test while silently destroying the protection that stops this seed
 * overwriting a brand's own edits. So the refusals are tested harder than the
 * acceptances.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { MEDIA_SLOTS } from "../media-slots.mjs";
import {
  PRIOR_SEED_LEDGER,
  classifySnapshot,
  deterministicHeroFilename,
  priorSeedDocuments,
  priorSeedDocumentsWave3,
  seedDocuments,
} from "../seed-gogi-pilot.mjs";

const TENANT = "00000000-0000-4000-8000-000000000901";
const MEDIA_ID = "00000000-0000-4000-8000-000000000910";
const HERO_FILENAME = deterministicHeroFilename("b".repeat(64), "image/jpeg");

/* Every slot uploaded, which is what the live site actually has. A record
   derived with no media would describe a site nobody is running. */
const MEDIA = (() => {
  const media = {};
  let index = 0;
  for (const slot of Object.keys(MEDIA_SLOTS)) {
    index += 1;
    media[slot] = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  }
  return media;
})();

const ID = {
  home: "p-home",
  about: "p-about",
  menu: "p-menu",
  gallery: "p-gallery",
  contact: "p-contact",
  reservations: "p-reservations",
};
const IDS = {
  heroMediaId: MEDIA_ID,
  tenantId: TENANT,
  homeId: ID.home,
  aboutId: ID.about,
  menuId: ID.menu,
  galleryId: ID.gallery,
  contactId: ID.contact,
};
const WAVE_3_ROLES = ["home", "about", "menu", "gallery", "contact"];

function snapshotOf(documents, roles) {
  return {
    pages: roles
      .filter((role) => documents[role]?.enabled)
      .map((role) => ({ ...documents[role], id: ID[role], revision: 3 })),
    settings: [{ ...documents.settings, id: "s1" }],
    navigation: [{ ...documents.navigation, id: "n1" }],
    footer: [{ ...documents.footer, id: "f1" }],
    media: [{ id: MEDIA_ID, filename: HERO_FILENAME, state: "READY" }],
  };
}

const classify = (snapshot) =>
  classifySnapshot(snapshot, {
    tenantId: TENANT,
    heroFilename: HERO_FILENAME,
    media: MEDIA,
  });

const wave3 = () => priorSeedDocumentsWave3({ ...IDS, media: MEDIA });

/* ── 1. The live state is recognised ───────────────────────────────────── */

test("#3149 wave 4 the WAVE 3 live content reconciles instead of being refused", () => {
  const plan = classify(snapshotOf(wave3(), WAVE_3_ROLES));
  // It used to throw EXISTING_NON_SEED_CONTENT here and the republish stopped.
  assert.equal(plan.state, "reconcilable");
  for (const role of WAVE_3_ROLES) {
    assert.ok(
      ["prior_seed", "target"].includes(plan.states[role]),
      `${role} classified ${plan.states[role]}`,
    );
  }
  // The four pages wave 4 actually changes are recognised as OUR earlier
  // output rather than as somebody else's content.
  for (const role of ["home", "about", "menu", "contact"]) {
    assert.equal(plan.states[role], "prior_seed", role);
  }
  assert.equal(plan.states.navigation, "prior_seed");
  // Gallery, footer and settings are untouched by wave 4, so wave 3's output
  // for them already IS the target.
  for (const key of ["gallery", "footer", "settings"]) {
    assert.equal(plan.states[key], "target", key);
  }
  assert.equal(plan.states.reservations, "absent");
});

test("#3149 wave 4 that reconcile updates every changed page and adds the new one", () => {
  const plan = classify(snapshotOf(wave3(), WAVE_3_ROLES));
  assert.deepEqual(plan.actions, [
    "update_home_draft",
    "update_about_draft",
    "update_menu_draft",
    "update_contact_draft",
    "create_reservations_draft",
    "update_navigation_draft",
  ]);
});

test("#3149 wave 4 Payload's own save-time normalisation does not break it", () => {
  /*
   * The live rows did not come from this seed — they were written through the
   * Studio REST API, and Payload stamps its own bookkeeping onto anything it
   * saves. If that bookkeeping reached the comparison, the record would match
   * in this file and fail against the real site, which is the worst possible
   * outcome for a fix like this.
   *
   * `compact()` already drops exactly these keys and every explicit null. This
   * proves it rather than trusting it.
   */
  let row = 0;
  const payloadise = (value) => {
    if (Array.isArray(value)) return value.map(payloadise);
    if (!value || typeof value !== "object") return value;
    const out = {};
    for (const [key, inner] of Object.entries(value)) out[key] = payloadise(inner);
    row += 1;
    out.id = `row-${row}`;
    if (out.blockType) {
      out.blockName = null;
      // Optional fields the seed never emitted, arriving back as null.
      for (const key of ["eyebrow", "group_heading", "caption", "note", "map_url", "alt"]) {
        if (!(key in out)) out[key] = null;
      }
    }
    return out;
  };
  const documents = wave3();
  const snapshot = {
    pages: WAVE_3_ROLES.filter((role) => documents[role].enabled).map((role) => ({
      ...payloadise(documents[role]),
      id: ID[role],
      tenant: TENANT,
      revision: 3,
      createdAt: "2026-09-08T10:00:00.000Z",
      updatedAt: "2026-09-09T11:00:00.000Z",
      _status: "draft",
    })),
    settings: [{ ...documents.settings, id: "s1", tenant: TENANT, logo: null }],
    navigation: [{ ...documents.navigation, id: "n1", tenant: TENANT }],
    footer: [{ ...payloadise(documents.footer), id: "f1", tenant: TENANT }],
    media: [{ id: MEDIA_ID, filename: HERO_FILENAME, state: "READY" }],
  };
  const plan = classify(snapshot);
  assert.equal(plan.state, "reconcilable");
  for (const role of ["home", "about", "menu", "contact"]) {
    assert.equal(plan.states[role], "prior_seed", role);
  }
});

/* ── 2. Recording a newer state does not displace the older one ────────── */

test("#3149 wave 4 the PRE-WAVE-2 state is still recognised", () => {
  const plan = classify(snapshotOf(priorSeedDocuments(IDS), ["home", "contact"]));
  assert.equal(plan.state, "reconcilable");
  for (const key of ["home", "contact", "navigation", "footer", "settings"]) {
    assert.equal(plan.states[key], "prior_seed", key);
  }
});

test("#3149 wave 4 the ledger holds BOTH states, oldest first, and is frozen", () => {
  assert.equal(PRIOR_SEED_LEDGER.length, 2);
  assert.equal(PRIOR_SEED_LEDGER[0], priorSeedDocuments);
  assert.equal(PRIOR_SEED_LEDGER[1], priorSeedDocumentsWave3);
  assert.ok(Object.isFrozen(PRIOR_SEED_LEDGER));
});

/* ── 3. THE GUARD. The half that matters most ──────────────────────────── */

test("#3149 wave 4 genuinely foreign content is STILL refused", () => {
  /*
   * The failure mode of this whole fix: a classifier widened until it accepts
   * anything passes every test above and quietly overwrites a brand's own
   * work. Each mutation below is a thing a human might really have done in
   * Studio, applied to a snapshot that is otherwise EXACTLY the recorded wave
   * 3 state — so the only difference between accepted and refused is the edit.
   */
  const mutations = {
    "a block nobody recorded": (documents) => {
      documents.home.blocks.push({
        blockType: "cta",
        heading: "Owner content",
        label: "Keep",
        href: "/",
      });
    },
    "altered copy in a heading": (documents) => {
      documents.home.blocks[0].heading = "Unapproved copy";
    },
    "a reordered block run": (documents) => {
      documents.home.blocks.reverse();
    },
    "one block quietly deleted": (documents) => {
      documents.home.blocks.splice(1, 1);
    },
    "an edited footer": (documents) => {
      documents.footer.legal_text = "Someone Else Ltd";
    },
    "an edited nav label": (documents) => {
      documents.about.nav_label = "Our story";
    },
    "a page switched off by hand": (documents) => {
      documents.menu.enabled = false;
    },
  };
  for (const [what, mutate] of Object.entries(mutations)) {
    const documents = wave3();
    mutate(documents);
    assert.throws(
      () => classify(snapshotOf(documents, WAVE_3_ROLES)),
      /EXISTING_NON_SEED_CONTENT/,
      `${what} was ACCEPTED — the guard is broken`,
    );
  }
});

test("#3149 wave 4 no ledger entry may ever describe the CURRENT target", () => {
  /*
   * The one edit that would silently disarm everything: repointing a frozen
   * record at today's seed. It would make every "does it reconcile" test pass
   * and every refusal above stop firing, because the live page would match a
   * record whatever it contained.
   *
   * A recorded state is a state that SHIPPED. It must differ from the target,
   * or it is not a record of anything.
   */
  const target = seedDocuments({ ...IDS, reservationsId: ID.reservations, media: MEDIA });
  for (const record of PRIOR_SEED_LEDGER) {
    const documents = record({ ...IDS, media: MEDIA });
    assert.notDeepEqual(
      documents.home.blocks,
      target.home.blocks,
      "a prior record has been repointed at the current target",
    );
  }
});

/* ── 4. The wave 3 record is wave 3's, not a copy of today's seed ──────── */

test("#3149 wave 4 the frozen record emits the WAVE 3 shape", () => {
  /*
   * These are precisely the things wave 4 changed, so they are what proves the
   * record was derived from `origin/main` rather than from the seed beside it.
   * If somebody "tidies" this record by pointing it at current helpers or
   * current copy, every one of these flips to the wave 4 value.
   */
  const documents = wave3();
  assert.deepEqual(
    documents.home.blocks.map((block) => block.blockType),
    [
      "hero",
      "marquee",
      // wave 4 replaces this with a `media_feature` composite
      "rich_text",
      "stats",
      "video_feature",
      "hours_location",
      // wave 4 replaces this with a `menu_preview`
      "gallery",
      "video_feature",
      "video_feature",
      "video_feature",
      "team",
      "contact_handoff",
    ],
  );
  // The stats card carried its sentence in `label`; wave 4 moved it to `body`
  // and added an icon. This is the ONE copy-ledger value whose shape changed,
  // and the record carries its own frozen copy for exactly this reason.
  const stats = documents.home.blocks.find((block) => block.blockType === "stats");
  assert.deepEqual(Object.keys(stats.items[0]), ["figure", "label"]);
  assert.match(stats.items[0].label, /Seven days a week/);
  assert.equal(stats.items[0].body, undefined);
  assert.equal(stats.items[0].icon, undefined);

  // Five pages, and the Visit page still carries the map wave 4 moves.
  assert.equal(documents.reservations, undefined);
  assert.deepEqual(
    documents.contact.blocks.map((block) => block.blockType),
    ["hours_location", "map_embed", "contact_handoff"],
  );
  // Nobody had a role yet, and the nav order had About before Menu.
  const team = documents.about.blocks.find((block) => block.blockType === "team");
  assert.equal(team.members[0].role, undefined);
  assert.equal(documents.about.nav_order, 1);
  assert.equal(documents.menu.nav_order, 2);
});
