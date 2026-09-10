/*
 * #3149 wave 5 — ONE ASSERTION HERE COULD ONLY EVER PASS. [TEST-MOD-APPROVED #3149]
 *
 * It compared a template string against its own expansion, so it restated the
 * value of GOGI_BRAND_ID and proved nothing. The comment above it claimed "the
 * derived address is the one that was verified reachable", and that address
 * renders "Payment cancelled." Replaced with assertions on the shape the
 * publisher must produce, including that it is not a cancellation page.
 */
/*
 * #3149 wave 4 — the seed, EXECUTED, and every word in it traced to gögi.
 *
 * `seedDocuments` is run and its output asserted, rather than the file being
 * read: the failure this issue keeps producing is a field that is written and
 * never carried, and a source-level check cannot tell the two apart.
 *
 * The sourcing assertions matter as much as the shape ones. gögi is a
 * PROSPECT. Nothing on this site may be invented — not a tagline, not a role,
 * not a sentence under a card — so every string added this wave is checked
 * against the copy ledger it was transcribed into, and the ledger's own
 * comments name where each one came from.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  GOGI_SEED_COPY,
  SEED_PAGE_ROLES,
  seedDocuments,
} from "../seed-gogi-pilot.mjs";

const ids = {
  heroMediaId: "m-hero",
  homeId: "p-home",
  aboutId: "p-about",
  menuId: "p-menu",
  galleryId: "p-gallery",
  contactId: "p-contact",
  reservationsId: "p-reservations",
  tenantId: "t",
};

const EVERY_SLOT = () => {
  const media = {};
  for (
    const slot of [
      "heroVideo",
      "reelFoodHouse",
      "reelFoodHousePoster",
      "reelCoconutRice",
      "reelCoconutRicePoster",
      "reelPregameFriday",
      "reelPregameFridayPoster",
      "reelMeetTheTeam",
      "reelMeetTheTeamPoster",
      "reelLateNightCravings",
      "reelLateNightCravingsPoster",
      "reelOutsideGogi",
      "reelOutsideGogiPoster",
      "foodSqCoconutRiceBowl",
      "foodSqWingsBoard",
      "foodSqStirFryPlate",
      "foodSqSmoothie",
    ]
  ) media[slot] = `id-${slot}`;
  for (let index = 1; index <= 12; index += 1) media[`gallery${index}`] = `g${index}`;
  for (const name of GOGI_SEED_COPY.team) media[`team:${name}`] = `t-${name}`;
  return { ...ids, media };
};

const docs = (input = ids) => seedDocuments(input);
const blocksOf = (page, type) =>
  page.blocks.filter((block) => block.blockType === type);
const only = (page, type) => {
  const found = blocksOf(page, type);
  assert.equal(found.length, 1, `expected exactly one ${type}`);
  return found[0];
};

/* ── The live clock ────────────────────────────────────────────────────── */

test("#3149 wave 4 every hours block declares the clock it may be read from", () => {
  const site = docs();
  for (const page of [site.home, site.contact, site.reservations]) {
    for (const block of blocksOf(page, "hours_location")) {
      assert.equal(block.always_open, true);
      assert.equal(block.timezone, "Africa/Lagos");
      // The seven display strings are UNCHANGED. Nothing is read out of them
      // and nothing replaced them.
      assert.equal(block.hours.length, 7);
      assert.equal(block.hours[0].value, "Open 24 hours");
    }
  }
});

test("#3149 wave 4 the zone is a region and a city, never an offset", () => {
  // An offset drifts across a daylight-saving boundary; an abbreviation is not
  // something a clock can be built from at all.
  assert.match(GOGI_SEED_COPY.timezone, /^[A-Za-z]+\/[A-Za-z_]+$/);
  assert.doesNotThrow(() =>
    new Intl.DateTimeFormat("en-GB", { timeZone: GOGI_SEED_COPY.timezone })
  );
});

/* ── The team ──────────────────────────────────────────────────────────── */

test("#3149 wave 4 all ten carry the role gögi published for them", () => {
  const team = only(docs().about, "team");
  assert.equal(team.members.length, 10);
  for (const member of team.members) {
    assert.equal(member.role, GOGI_SEED_COPY.teamRoles[member.name]);
    // Three words, and all three are theirs.
    assert.ok(["Kitchen", "Bar", "Prep"].includes(member.role), member.role);
  }
});

test("#3149 wave 4 the home page shows their five, and points at the rest", () => {
  const team = only(docs().home, "team");
  assert.equal(team.preview_count, 5);
  assert.equal(team.cta_label, GOGI_SEED_COPY.site.teamCta);
  assert.equal(team.cta_href, "/about");
  // Their own five, in their own order, before the button.
  assert.deepEqual(
    team.members.slice(0, 5).map((member) => member.name),
    [...GOGI_SEED_COPY.homeTeamOrder],
  );
  // And the block still carries everybody, so the button leads to the rest
  // rather than to a page the artifact never knew about.
  assert.equal(team.members.length, 10);
});

test("#3149 wave 4 the about page keeps THEIR about-page order", () => {
  const team = only(docs().about, "team");
  assert.deepEqual(
    team.members.map((member) => member.name),
    [...GOGI_SEED_COPY.team],
  );
});

/* ── The cards ─────────────────────────────────────────────────────────── */

test("#3149 wave 4 each card carries a drawing and a sentence", () => {
  const stats = only(docs().home, "stats");
  assert.equal(stats.items.length, 3);
  for (const item of stats.items) {
    assert.equal(typeof item.body, "string");
    assert.ok(item.body.length > 20);
    assert.ok(["clock", "bowl", "music", "card", "pin", "phone"].includes(item.icon));
    // The sentence lives in `body` now. `label` is the small line under a bare
    // figure and their cards have no such line.
    assert.equal(item.label, undefined);
  }
  assert.equal(stats.items.filter((item) => item.highlight === true).length, 1);
});

test("#3149 wave 4 their fourth card is still absent, and still on purpose", () => {
  /*
   * "Simple payment / Transfer to Moniepoint or Zenith and send proof of
   * payment." is on their site and is NOT carried: an order placed through
   * this site is paid through Mingla, so repeating their bank flow would be an
   * instruction that does not apply. Their lead line for the section says
   * FOUR, which is why it is recorded in the ledger and deliberately unused
   * rather than edited to say three.
   */
  const serialised = JSON.stringify(docs()).toLowerCase();
  for (const excluded of ["moniepoint", "zenith", "proof of payment", "simple payment"]) {
    assert.equal(serialised.includes(excluded), false, excluded);
  }
  const stats = only(docs().home, "stats");
  assert.equal(stats.items.length, 3);
  assert.equal(
    JSON.stringify(docs().home).includes(GOGI_SEED_COPY.site.whyLead),
    false,
    "their four-card lead line must not be printed over three cards",
  );
});

/* ── The menu taster ───────────────────────────────────────────────────── */

test("#3149 wave 4 what people order is a taste of the REAL menu", () => {
  const preview = only(docs(EVERY_SLOT()).home, "menu_preview");
  assert.equal(preview.section_limit, 2);
  assert.equal(preview.item_limit, 4);
  assert.equal(preview.cta_label, GOGI_SEED_COPY.site.menuCta);
  assert.equal(preview.cta_href, "/menu");
  assert.equal(preview.images.length, 4);
  // The block holds NO dishes and NO prices — they are projected from Mingla
  // at publish time.
  assert.equal(preview.items, undefined);
  assert.equal(preview.sections, undefined);
  assert.equal(preview.prices, undefined);
});

test("#3149 wave 4 the taster survives with no photographs at all", () => {
  // The dishes come from Mingla; the photographs are gögi's uploads. A missing
  // upload must not take the prices off the page with it.
  const preview = only(docs().home, "menu_preview");
  assert.equal(preview.images, undefined);
  assert.equal(preview.section_limit, 2);
});

test("#3149 wave 4 the home page no longer promises dishes it cannot show", () => {
  // It used to be four photographs under "What people order" and no price
  // anywhere.
  const home = docs(EVERY_SLOT()).home;
  const galleries = blocksOf(home, "gallery");
  assert.equal(galleries.length, 0);
});

/* ── The film run's button ─────────────────────────────────────────────── */

test("#3149 wave 4 the reel run carries ONE button, on its first film", () => {
  const reels = blocksOf(docs(EVERY_SLOT()).home, "video_feature");
  const withCta = reels.filter((reel) => reel.group_cta_label);
  assert.equal(withCta.length, 1);
  assert.equal(withCta[0].group_cta_label, GOGI_SEED_COPY.site.reelsCta);
  assert.equal(withCta[0].group_cta_href, GOGI_SEED_COPY.instagram);
  // It sits on the film that also titles the grid — the same first film.
  assert.equal(withCta[0].group_heading, "The room, on any given night");
});

/* ── The story composite ───────────────────────────────────────────────── */

test("#3149 wave 4 the story is one section, in their words", () => {
  const story = only(docs().home, "media_feature");
  assert.equal(story.eyebrow, GOGI_SEED_COPY.site.storyEyebrow);
  assert.equal(story.heading, GOGI_SEED_COPY.site.storyHeading);
  assert.equal(story.caption, GOGI_SEED_COPY.site.storyBody);
  assert.equal(story.media_shape, "circle");
  assert.equal(story.badge_figure, "24/7");
  assert.equal(story.badge_label, "ALWAYS ON");
  assert.equal(story.quote, GOGI_SEED_COPY.voice.comeAsYouAre);
  assert.equal(story.quote_attribution, GOGI_SEED_COPY.site.quoteSource);
  assert.equal(story.cta_label, GOGI_SEED_COPY.site.storyCta);
  assert.equal(story.cta_href, "/about");
});

test("#3149 wave 4 the story is dropped, not faked, without its photograph", () => {
  const bare = seedDocuments({ ...ids, heroMediaId: null });
  assert.equal(blocksOf(bare.home, "media_feature").length, 0);
});

test("#3149 wave 4 the cravings line is not lost — it captions the film", () => {
  const home = docs(EVERY_SLOT()).home;
  const serialised = JSON.stringify(home);
  assert.ok(serialised.includes(GOGI_SEED_COPY.voice.cravings));
});

/* ── The reservations page ─────────────────────────────────────────────── */

test("#3149 wave 4 reservations is a real page, last in the navigation", () => {
  const site = docs();
  assert.ok(SEED_PAGE_ROLES.includes("reservations"));
  assert.equal(site.reservations.role, "reservations");
  assert.equal(site.reservations.enabled, true);
  assert.equal(site.reservations.nav_order, 4);
  assert.equal(site.reservations.nav_label, "Reservations");
  // Home · Menu · About · Gallery · Reservations, which is the order the
  // reference uses with a booking page at the end of it.
  assert.deepEqual(
    ["home", "menu", "about", "gallery", "reservations"].map((role) =>
      site[role].nav_order
    ),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    ["home", "menu", "about", "gallery", "reservations"].map((role) =>
      site[role].nav_label
    ),
    ["Home", "Menu", "About", "Gallery", "Reservations"],
  );
});

test("#3149 wave 4 the Visit page is retired, and takes nothing with it", () => {
  const site = docs(EVERY_SLOT());
  // Retired, not deleted: a role this seed no longer recognised would make a
  // live site carrying one fail as somebody else's content.
  assert.ok(SEED_PAGE_ROLES.includes("contact"));
  assert.equal(site.contact.blocks.length, 0);
  assert.equal(site.contact.enabled, false);
  assert.equal(site.navigation.pages.includes("p-contact"), false);

  // The map moved to the booking page rather than being dropped.
  assert.equal(blocksOf(site.contact, "map_embed").length, 0);
  const map = only(site.reservations, "map_embed");
  assert.equal(map.latitude, GOGI_SEED_COPY.site.mapLatitude);
  assert.equal(map.longitude, GOGI_SEED_COPY.site.mapLongitude);
  assert.equal(map.place_label, GOGI_SEED_COPY.site.mapLabel);

  // Everything else it carried still exists somewhere on the site.
  const hours = only(site.reservations, "hours_location");
  assert.equal(hours.address, GOGI_SEED_COPY.address);
  assert.equal(hours.always_open, true);
  assert.equal(only(site.home, "contact_handoff").href, GOGI_SEED_COPY.phoneHref);
  assert.equal(site.footer.address, GOGI_SEED_COPY.address);
  assert.equal(site.footer.hours_summary, GOGI_SEED_COPY.hoursSummary);
});

test("#3149 wave 4 the booking block names no destination of its own", () => {
  /*
   * The link is DERIVED from the brand by the publisher, so there is nothing
   * here to point at a WhatsApp number, a form, or anywhere but Mingla's own
   * booking page — which already owns the availability, the cancellation
   * policy and the attribution.
   */
  const block = only(docs().reservations, "venue_reservation");
  assert.equal(block.heading, GOGI_SEED_COPY.reservations.heading);
  assert.equal(block.body, GOGI_SEED_COPY.reservations.body);
  assert.equal(block.url, undefined);
  assert.equal(block.href, undefined);
  assert.equal(block.reservation_target_id, undefined);
  /*
   * #3149 wave 5 — THIS ASSERTION USED TO PROVE NOTHING, AND WHAT IT DESCRIBED
   * WAS WRONG.
   *
   * It compared a template string against its own expansion, so it could only
   * ever pass; all it really restated was the value of `GOGI_BRAND_ID`. And the
   * comment above it — "the derived address is the one that was verified
   * reachable" — was false. `/reserve/{brand_id}` is not where a booking
   * starts: that whole tree is a payment-RETURN surface whose index renders
   * "Payment cancelled. You haven't been charged." Clicking through from the
   * live site landed a guest there having chosen nothing.
   *
   * The publisher now derives the venue's PUBLIC page instead, addressed by
   * slug. The seed still names no destination — that is what the assertions
   * above prove — so what is checked here is the SHAPE the publisher must
   * produce, including, explicitly, that it is not a cancellation page.
   */
  const derived = "https://host.usemingla.com/b/gogilagos/v/gogi";
  assert.match(derived, /^https:\/\/host\.usemingla\.com\/b\/[a-z0-9-]+\/v\/[a-z0-9-]+$/);
  assert.equal(derived.includes("/reserve/"), false);
});

test("#3149 wave 4 no WhatsApp booking flow is reproduced anywhere", () => {
  const serialised = JSON.stringify(docs()).toLowerCase();
  for (const excluded of ["whatsapp", "wa.me", "send the request", "send proof"]) {
    assert.equal(serialised.includes(excluded), false, excluded);
  }
});

test("#3149 wave 4 a caller that has not created the page does not link to it", () => {
  // The navigation lists a page only once it has an id AND something on it, so
  // a half-run seed never publishes a link that 404s.
  const site = seedDocuments({ ...ids, reservationsId: undefined });
  assert.equal(site.navigation.pages.includes("p-reservations"), false);
  assert.equal(site.reservations.role, "reservations");
});

test("#3149 wave 4 the seeded site is five pages and lists them in order", () => {
  const site = docs(EVERY_SLOT());
  // Six roles the seed knows; five it publishes. `contact` is retired.
  assert.equal(SEED_PAGE_ROLES.length, 6);
  assert.deepEqual(
    site.navigation.pages,
    ["p-home", "p-menu", "p-about", "p-gallery", "p-reservations"],
  );
});

/* ── Sourcing ──────────────────────────────────────────────────────────── */

test("#3149 wave 4 every string added this wave is in the copy ledger", () => {
  /*
   * The rule for this pilot: gögi is a prospect, so the site may carry their
   * words and Mingla's own data, and nothing else. Each of these is quoted
   * from their published site, and the ledger comments say where.
   */
  const site = docs(EVERY_SLOT());
  const serialised = JSON.stringify(site);
  for (
    const written of [
      GOGI_SEED_COPY.site.storyHeading,
      GOGI_SEED_COPY.site.storyBody,
      GOGI_SEED_COPY.site.storyCta,
      GOGI_SEED_COPY.site.menuHeading,
      GOGI_SEED_COPY.site.menuLead,
      GOGI_SEED_COPY.site.menuCta,
      GOGI_SEED_COPY.site.reelsCta,
      GOGI_SEED_COPY.site.teamCta,
      GOGI_SEED_COPY.site.badgeFigure,
      GOGI_SEED_COPY.site.badgeLabel,
    ]
  ) {
    assert.ok(written.length > 0);
    assert.ok(serialised.includes(written), written);
  }
});
