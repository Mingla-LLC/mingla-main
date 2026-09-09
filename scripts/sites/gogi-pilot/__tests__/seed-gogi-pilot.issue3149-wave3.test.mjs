/*
 * #3149 wave 3 — the four new sections, on gögi's own pages, in gögi's own
 * words. EXECUTED.
 *
 * Every string asserted below is transcribed from gögi's own published site
 * (https://gogi-lagos-phi.vercel.app), read 2026-09-09. The rule this guards
 * is the same one the pilot has followed since #2830: gögi are a prospect, so
 * nothing on their website may be written for them. A ticker phrase, a figure,
 * a quotation and a map label are all copy.
 *
 * It RUNS `seedDocuments` rather than reading the file, because the shape that
 * reaches Payload is the only thing that matters — a block Payload never
 * receives saves cleanly and publishes nothing.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { GOGI_SEED_COPY, seedDocuments } from "../seed-gogi-pilot.mjs";

const TENANT_ID = "00000000-0000-4000-8000-000000000801";
const HOME_ID = "00000000-0000-4000-8000-000000000802";
const ABOUT_ID = "00000000-0000-4000-8000-000000000803";
const MENU_ID = "00000000-0000-4000-8000-000000000804";
const GALLERY_ID = "00000000-0000-4000-8000-000000000805";
const CONTACT_ID = "00000000-0000-4000-8000-000000000806";
const HERO_ID = "00000000-0000-4000-8000-000000000807";

function everyAsset() {
  const media = {};
  let counter = 900;
  const slot = (name) => {
    media[name] = `00000000-0000-4000-8000-${String(counter++).padStart(12, "0")}`;
  };
  for (
    const name of [
      "heroVideo",
      "reelFoodHouse",
      "reelFoodHousePoster",
      "reelPregameFriday",
      "reelPregameFridayPoster",
      "reelLateNightCravings",
      "reelLateNightCravingsPoster",
      "reelOutsideGogi",
      "reelOutsideGogiPoster",
      "reelMeetTheTeam",
      "reelMeetTheTeamPoster",
      "reelCoconutRice",
      "reelCoconutRicePoster",
      "foodSqCoconutRiceBowl",
      "foodSqWingsBoard",
      "foodSqStirFryPlate",
      "foodSqSmoothie",
    ]
  ) slot(name);
  for (let index = 1; index <= 12; index += 1) slot(`gallery${index}`);
  return media;
}

const seeded = (media = everyAsset()) =>
  seedDocuments({
    heroMediaId: HERO_ID,
    homeId: HOME_ID,
    aboutId: ABOUT_ID,
    menuId: MENU_ID,
    galleryId: GALLERY_ID,
    contactId: CONTACT_ID,
    tenantId: TENANT_ID,
    media,
  });

const only = (page, blockType) => {
  const found = page.blocks.filter((block) => block.blockType === blockType);
  assert.equal(found.length, 1, `expected exactly one ${blockType}`);
  return found[0];
};

test("#3149 wave 3 the ticker sits DIRECTLY under the hero", () => {
  const home = seeded().home;
  assert.equal(home.blocks[0].blockType, "hero");
  assert.equal(home.blocks[1].blockType, "marquee");
});

test("#3149 wave 3 the ticker is their five phrases, in their order", () => {
  const marquee = only(seeded().home, "marquee");
  assert.deepEqual(marquee.phrases.map((row) => row.text), [
    "24/7 food house",
    "Come as you are",
    "Day or night, open for a bite",
    "69 Admiralty Way",
    "Find gögi",
  ]);
});

test("#3149 wave 3 the ticker carries no punctuation of its own", () => {
  // The separator is drawn by the stylesheet. A dot typed into the copy would
  // be printed twice on the page.
  for (const row of only(seeded().home, "marquee").phrases) {
    assert.ok(!row.text.includes("·"), `separator in the copy: ${row.text}`);
    assert.ok(!row.text.includes("◆"), `separator in the copy: ${row.text}`);
    assert.ok(row.text.trim() === row.text);
  }
});

test("#3149 wave 3 the stats row is their heading and their eyebrow", () => {
  const stats = only(seeded().home, "stats");
  assert.equal(stats.eyebrow, "Why people keep coming back");
  assert.equal(stats.heading, "No closing time");
});

test("#3149 wave 3 the stats row carries THREE of their four cards", () => {
  const stats = only(seeded().home, "stats");
  assert.deepEqual(stats.items.map((row) => row.figure), [
    "Open 24 hours",
    "Bowls that travel",
    "Pregame Fridays",
  ]);
  /*
   * [TEST-MOD-APPROVED #3149] SUPERSEDED, wave 4:
   *   assert.equal(
   *     stats.items[0].label,
   *     "Seven days a week, all year. There is no “sorry, we’re closed” at gögi.",
   *   );
   *
   * The sentence did not change; the field holding it did. On their site each
   * of these is a CARD — icon, title, sentence — and `label` is the small line
   * under a bare figure, which their cards do not have. The sentence moved to
   * `body`, where wave 4 put it.
   *
   * SHARPENED: the same string is still pinned, AND `label` is now asserted
   * ABSENT, so a later edit cannot quietly print the sentence twice by
   * restoring the old field beside the new one.
   */
  assert.equal(
    stats.items[0].body,
    "Seven days a week, all year. There is no “sorry, we’re closed” at gögi.",
  );
  assert.equal(stats.items[0].label, undefined);
  // And the drawing that reads as their icon font's glyph, from the closed
  // list this runtime can actually draw.
  assert.equal(stats.items[0].icon, "clock");
});

test("#3149 wave 3 their bank-transfer card is DELIBERATELY absent", () => {
  /*
   * Their fourth card explains transferring to Moniepoint or Zenith and
   * sending proof of payment. An order placed through this site is paid
   * through Mingla, so repeating that flow would be an instruction that does
   * not apply — the same reason their "Paying" section is absent from the
   * Visit page.
   */
  const documents = seeded();
  const serialised = JSON.stringify(documents);
  for (const word of ["Moniepoint", "Zenith", "proof of payment"]) {
    assert.ok(!serialised.includes(word), `payment copy leaked: ${word}`);
  }
});

test("#3149 wave 3 nothing claims a count the page does not carry", () => {
  // Their lead line for that section reads "Four things that make gögi gögi."
  // and this carries three, so the line is left out rather than edited.
  const stats = only(seeded().home, "stats");
  assert.equal(stats.body, undefined);
  assert.ok(!JSON.stringify(seeded()).includes("Four things"));
});

test("#3149 wave 3 the pull quote is on About, attributed as theirs", () => {
  const quote = only(seeded().about, "pull_quote");
  assert.equal(quote.quote, GOGI_SEED_COPY.voice.findGogi);
  assert.equal(quote.attribution, "gögi, on Instagram");
});

test("#3149 wave 3 the quoted line is MOVED out of the prose, not copied", () => {
  /*
   * It was the first paragraph of the About story. Printing it as prose AND as
   * a pulled quotation three lines apart reads as a mistake by whoever wrote
   * the page, so the paragraph is gone and the quotation is what remains.
   */
  const about = seeded().about;
  const prose = about.blocks
    .filter((block) => block.blockType === "rich_text")
    .flatMap((block) =>
      block.content.root.children.flatMap((paragraph) =>
        paragraph.children.map((node) => node.text)
      )
    );
  assert.ok(!prose.includes(GOGI_SEED_COPY.voice.findGogi));
  assert.deepEqual(prose, [GOGI_SEED_COPY.voice.comeAsYouAre]);
});

test("#3149 wave 3 the quotation follows the writing, as theirs does", () => {
  const types = seeded().about.blocks.map((block) => block.blockType);
  assert.equal(types[0], "rich_text");
  assert.equal(types[1], "pull_quote");
});

test("#3149 wave 3 the home story keeps its own words untouched", () => {
  /*
   * [TEST-MOD-APPROVED #3149] SUPERSEDED, wave 4:
   *   const story = only(home, "rich_text");
   *   assert.match(
   *     story.content.root.children[0].children[0].text,
   *     /show up exactly as you are/,
   *   );
   *
   * The words are the same words. The home story is a `media_feature`
   * composite now — their own shape: prose, the line pulled out beside it, a
   * circular crop with a badge, and a button — so "show up exactly as you are"
   * moved from the FIRST PARAGRAPH into the `quote` field, which is where
   * their page has it.
   *
   * SHARPENED: the original pinned one line of prose. This pins the line, the
   * source under it, the prose that is now their real heading and paragraph,
   * and — still — that no separate `pull_quote` block appears on this page,
   * because the quotation lives inside the section rather than as a second
   * band under it.
   */
  const home = seeded().home;
  assert.equal(home.blocks.some((b) => b.blockType === "pull_quote"), false);
  const story = only(home, "media_feature");
  assert.match(story.quote, /show up exactly as you are/);
  assert.equal(story.quote_attribution, "gögi, on Instagram");
  assert.equal(story.heading, "A room that never closes");
  assert.match(story.caption, /does not shut/);
});

/*
 * [TEST-MOD-APPROVED #3149] SUPERSEDED, wave 4 — the map's PAGE, in nine
 * assertions across this file. Each read `seeded().contact` or
 * `documents.contact`; they now read the reservations page:
 *
 *   const map = only(seeded()[MAP_PAGE], "map_embed");            (x4)
 *   const contact = seeded()[MAP_PAGE];
 *   const types = seeded()[MAP_PAGE].blocks.map((block) => block.blockType);
 *   assert.equal(only(documents[MAP_PAGE], "map_embed").heading, "Admiralty Way");
 *   only(documents[MAP_PAGE], "map_embed").place_label,
 *   const map = only(documents[MAP_PAGE], "map_embed");
 *
 * The Visit page is retired and its map moved to the Reservations page —
 * someone who has just asked for a table is exactly the person who needs to
 * find the door. Not one assertion ABOUT the map changed: the coordinates, the
 * refusal to carry a place name, the sourcing of its words, its absent eyebrow
 * and its position relative to the hours block are all still pinned, on the
 * page that now holds it.
 *
 * SHARPENED: `MAP_PAGE` is named once here, so the page the map lives on is a
 * single fact rather than nine copies of one, and the retired page is asserted
 * to carry NO map — which is what would catch the map being duplicated onto
 * both pages instead of moved.
 */
const MAP_PAGE = "reservations";

test("#3149 wave 4 the retired Visit page carries no map of its own", () => {
  const site = seeded();
  assert.equal(
    site.contact.blocks.filter((block) => block.blockType === "map_embed").length,
    0,
  );
  assert.equal(site.contact.blocks.length, 0);
  assert.equal(site.contact.enabled, false);
});

test("#3149 wave 3 the Visit page carries a map with COORDINATES", () => {
  const map = only(seeded()[MAP_PAGE], "map_embed");
  assert.equal(typeof map.latitude, "number");
  assert.equal(typeof map.longitude, "number");
  assert.equal(map.latitude, 6.4471033);
  assert.equal(map.longitude, 3.4680182);
  assert.ok(map.latitude >= -90 && map.latitude <= 90);
  assert.ok(map.longitude >= -180 && map.longitude <= 180);
});

test("#3149 wave 3 the map says the STREET, which is what is sourced", () => {
  /*
   * gögi publish no coordinates — their own site's Restaurant structured data
   * carries a postal address and no `geo`, and OpenStreetMap has no house
   * number on Admiralty Way. The label therefore names the street rather than
   * a door number nobody has surveyed.
   */
  const map = only(seeded()[MAP_PAGE], "map_embed");
  assert.equal(map.place_label, "Admiralty Way, Lekki Phase 1, Lagos");
  assert.ok(!map.place_label.startsWith("69"));
});

test("#3149 wave 3 the map hands no place NAME to anything", () => {
  const map = only(seeded()[MAP_PAGE], "map_embed");
  for (const key of ["query", "address", "search", "embed_url"]) {
    assert.equal(key in map, false, `${key} must not be seeded`);
  }
  // The directions link is coordinates too: a free-text destination resolves
  // silently, and has resolved to the wrong country before.
  assert.match(map.directions_url, /destination=6\.4471033,3\.4680182$/);
  assert.ok(!map.directions_url.includes("Admiralty"));
});

test("#3149 wave 3 the map's words are theirs", () => {
  const map = only(seeded()[MAP_PAGE], "map_embed");
  assert.equal(map.heading, "Admiralty Way");
  assert.equal(
    map.body,
    "gögi is on the main Admiralty Way strip in Lekki Phase 1. It is a small frontage — look for the 24/7 food house sign.",
  );
});

test("#3149 wave 3 the map carries NO eyebrow — the page already has that line", () => {
  /*
   * Theirs reads "Getting here" over this section, and the hours block above
   * it already carries exactly that. Printing it twice on one page is worse
   * than printing it once, and a second one would have to be invented.
   */
  /*
   * [TEST-MOD-APPROVED #3149] SUPERSEDED, wave 4:
   *   assert.equal(map.eyebrow, undefined);
   *   assert.equal(only(contact, "hours_location").eyebrow, "Getting here");
   *
   * The RULE is unchanged and is what this test is named for: a page never
   * prints the same eyebrow twice, and a second one is never invented to fill
   * a gap. What changed is which block on the page holds gögi's "Getting here".
   *
   * On the retired Visit page the hours block carried it, so the map went
   * without. On the Reservations page the hours block carries none, so the
   * line goes back over the map — which is where their own site prints it. The
   * omission was always a collision, never a judgement that the map should be
   * unlabelled.
   *
   * SHARPENED: the no-duplicate check below is the real assertion and is
   * untouched, and the map's eyebrow is now pinned to their exact words rather
   * than merely pinned as absent.
   */
  const contact = seeded()[MAP_PAGE];
  const map = only(contact, "map_embed");
  assert.equal(map.eyebrow, "Getting here");
  assert.equal(only(contact, "hours_location").eyebrow, undefined);
  const eyebrows = contact.blocks.map((block) => block.eyebrow).filter(Boolean);
  assert.equal(new Set(eyebrows).size, eyebrows.length, "an eyebrow twice");
});

test("#3149 wave 3 the map sits between the hours and the phone number", () => {
  /*
   * [TEST-MOD-APPROVED #3149] SUPERSEDED, wave 4:
   *   assert.deepEqual(types, ["hours_location", "map_embed", "contact_handoff"]);
   *
   * A different page, so a different run of blocks. The ORDERING PROPERTY is
   * the same one and is why this test exists: the map comes after the hours,
   * because "when" is what someone reads before "where".
   *
   * SHARPENED: the page now reads book, then when, then where — and the
   * assertion pins all three in order, so a block inserted between the
   * booking control and the practical detail under it would fail here.
   */
  const types = seeded()[MAP_PAGE].blocks.map((block) => block.blockType);
  assert.deepEqual(types, ["venue_reservation", "hours_location", "map_embed"]);
  assert.ok(
    types.indexOf("map_embed") > types.indexOf("hours_location"),
    "when comes before where",
  );
});

test("#3149 wave 3 the home run of three films is still ONE run", () => {
  /*
   * The renderer turns CONSECUTIVE video_feature blocks into a single grid.
   * Two new sections were inserted into this page, and a block landing between
   * the films would silently turn the grid back into three full-width banners.
   */
  const types = seeded().home.blocks.map((block) => block.blockType);
  const runs = [];
  for (const type of types) {
    const last = runs[runs.length - 1];
    if (last && last.type === type) last.count += 1;
    else runs.push({ type, count: 1 });
  }
  assert.deepEqual(
    runs.filter((run) => run.type === "video_feature").map((run) => run.count),
    [1, 3],
  );
});

test("#3149 wave 3 the copy-free sections survive a seed with NO media", () => {
  /*
   * This is the shape that is actually live: one hero photograph and nothing
   * else uploaded. None of the four new sections needs an image, so all of
   * them must still be there.
   */
  const documents = seeded({});
  assert.ok(only(documents.home, "marquee").phrases.length === 5);
  assert.equal(only(documents.home, "stats").heading, "No closing time");
  assert.equal(only(documents.about, "pull_quote").attribution, "gögi, on Instagram");
  assert.equal(only(documents[MAP_PAGE], "map_embed").heading, "Admiralty Way");
});

test("#3149 wave 3 the gallery page is still empty without photographs", () => {
  // Nothing new was added there, and a page with nothing on it is not
  // published — that guard must not have been quietly defeated.
  assert.equal(seeded({}).gallery.blocks.length, 0);
});

test("#3149 wave 3 the new copy is quoted from the ledger, not inlined", () => {
  /*
   * Every new string is read from `GOGI_SEED_COPY.site`, the transcription
   * block, so a future edit changes the sourcing note beside it rather than a
   * literal buried three hundred lines away.
   */
  const documents = seeded();
  assert.deepEqual(
    only(documents.home, "marquee").phrases.map((row) => row.text),
    [...GOGI_SEED_COPY.site.marquee],
  );
  assert.deepEqual(
    only(documents.home, "stats").items,
    GOGI_SEED_COPY.site.pillars.map((pillar) => ({ ...pillar })),
  );
  assert.equal(
    only(documents[MAP_PAGE], "map_embed").place_label,
    GOGI_SEED_COPY.site.mapLabel,
  );
});

test("#3149 wave 3 every new section stays inside the contract's limits", () => {
  const documents = seeded();
  const marquee = only(documents.home, "marquee");
  assert.ok(marquee.phrases.length >= 2 && marquee.phrases.length <= 12);
  for (const row of marquee.phrases) assert.ok(row.text.length <= 80);
  const stats = only(documents.home, "stats");
  assert.ok(stats.items.length >= 1 && stats.items.length <= 6);
  for (const row of stats.items) {
    assert.ok(row.figure.length <= 60, row.figure);
    /*
     * [TEST-MOD-APPROVED #3149] SUPERSEDED, wave 4:
     *   assert.ok(row.label.length <= 240, row.label);
     *
     * `label` is unset on every card now — the sentence lives in `body`, whose
     * Studio field is capped at 300 rather than 240. Asserting a length on an
     * undefined value throws rather than failing usefully.
     *
     * SHARPENED: BOTH fields are bounded, each against its own real cap, and
     * whichever one a card happens to use is checked. A seed that exceeded
     * either would be rejected on save as an opaque validation failure, which
     * is the whole point of this test.
     */
    if (typeof row.label === "string") assert.ok(row.label.length <= 240, row.label);
    if (typeof row.body === "string") assert.ok(row.body.length <= 300, row.body);
    assert.ok(
      typeof row.label === "string" || typeof row.body === "string",
      `${row.figure} carries no line under it at all`,
    );
  }
  assert.ok(only(documents.about, "pull_quote").quote.length <= 600);
  const map = only(documents[MAP_PAGE], "map_embed");
  assert.ok(map.place_label.length <= 200);
  assert.ok(map.body.length <= 500);
  assert.ok(map.directions_url.startsWith("https://"));
  for (const page of Object.values(documents)) {
    if (Array.isArray(page.blocks)) assert.ok(page.blocks.length <= 40);
  }
});
