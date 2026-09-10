import test from "node:test";
import assert from "node:assert/strict";
import { GOGI_SEED_COPY, seedDocuments } from "../seed-gogi-pilot.mjs";

/**
 * #2830 — the pilot seeds gögi's site, not a two-page stub.
 *
 * The live pilot had two pages, three blocks and one photograph, and looked
 * nothing like the real thing. The renderer was never the limit; this file was.
 */
const ids = {
  heroMediaId: "hero",
  homeId: "p-home",
  aboutId: "p-about",
  menuId: "p-menu",
  galleryId: "p-gallery",
  contactId: "p-contact",
  reservationsId: "p-reservations",
  tenantId: "t",
};

/*
 * [TEST-MOD-APPROVED #3149] SUPERSEDED, wave 4:
 *   const roles = ["home", "about", "menu", "gallery", "contact"];
 *
 * The site is still five pages. Visit is retired and Reservations takes its
 * place, and Menu and About swap so the navigation reads as the reference's
 * does. This list is in NAV ORDER, which is what the assertion below checks.
 */
const roles = ["home", "menu", "about", "gallery", "reservations"];

test("seeds the five pages gögi's own site has", () => {
  const docs = seedDocuments(ids);
  assert.deepEqual(roles.map((role) => docs[role].role), roles);
  /*
   * [TEST-MOD-APPROVED #3149] SUPERSEDED, wave 4:
   *   assert.deepEqual(
   *     roles.map((role) => docs[role].nav_label),
   *     ["Home", "About", "Menu", "Gallery", "Visit"],
   *   );
   *
   * SHARPENED: the labels are still pinned exactly, and the ORDER they render
   * in is now pinned too — `nav_order` is what the navigation sorts by, and a
   * label list alone would pass even if every page claimed position 0.
   */
  assert.deepEqual(
    roles.map((role) => docs[role].nav_label),
    ["Home", "Menu", "About", "Gallery", "Reservations"],
  );
  assert.deepEqual(roles.map((role) => docs[role].nav_order), [0, 1, 2, 3, 4]);
  // Four, not five: Gallery has no blocks until media is uploaded, and the
  // test below pins that an empty page is not published. Listing it here would
  // be a navigation link to a page the runtime will not route.
  assert.equal(docs.navigation.pages.length, 4);
  assert.equal(docs.navigation.pages.includes(ids.galleryId), false);
  // And the retired page is not listed either, for the same reason.
  assert.equal(docs.navigation.pages.includes(ids.contactId), false);
});

test("a page with no blocks is NOT published", () => {
  // Gallery has no images until media is uploaded, so it must not appear in
  // the navigation as a link to an empty page.
  const docs = seedDocuments(ids);
  assert.equal(docs.gallery.blocks.length, 0);
  assert.equal(docs.gallery.enabled, false);
  assert.equal(docs.home.enabled, true);
});

test("media DEGRADES rather than fabricates", () => {
  const without = seedDocuments(ids);
  assert.ok(!without.home.blocks.some((b) => b.blockType === "video_feature"));

  const withMedia = seedDocuments({
    ...ids,
    media: {
      heroVideo: "v1",
      reelFoodHouse: "v2",
      reelFoodHousePoster: "i2",
      gallery1: "g1",
      gallery2: "g2",
    },
  });
  const hero = withMedia.home.blocks.find((b) => b.blockType === "hero");
  assert.equal(hero.video, "v1");
  assert.ok(withMedia.home.blocks.some((b) => b.blockType === "video_feature"));
  assert.equal(withMedia.gallery.enabled, true);
  assert.equal(withMedia.gallery.blocks[0].images.length, 2);
});

test("a reel is only seeded when BOTH its video and poster exist", () => {
  const posterOnly = seedDocuments({ ...ids, media: { reelFoodHousePoster: "i2" } });
  assert.ok(!posterOnly.home.blocks.some((b) => b.blockType === "video_feature"));
  const videoOnly = seedDocuments({ ...ids, media: { reelFoodHouse: "v2" } });
  assert.ok(!videoOnly.home.blocks.some((b) => b.blockType === "video_feature"));
});

test("the team is published by nickname, with no invented portraits", () => {
  const team = seedDocuments(ids).about.blocks.find((b) => b.blockType === "team");
  assert.equal(team.members.length, 10);
  assert.equal(team.members[0].name, "Mr slice it all");
  // Real names are published nowhere and no portrait is claimed.
  for (const member of team.members) {
    assert.equal(member.media, undefined);
    /*
     * [TEST-MOD-APPROVED #3149] SUPERSEDED, wave 4:
     *   assert.equal(member.role, undefined);
     *
     * This meant "we did not make one up", at a time when gögi's roles were
     * not carried. They publish one for all ten on their own About page —
     * Kitchen, Bar or Prep — so an empty role is now the invention, not a
     * filled one.
     *
     * SHARPENED rather than dropped. The rule the line encoded is unchanged
     * and is enforced harder: a role must be a value gögi PUBLISHED, matched
     * against the transcription ledger by name, and it must be one of their
     * three words. Nothing can be typed here that they did not write. Real
     * NAMES are still asserted absent above — that half never moved.
     */
    assert.equal(member.role, GOGI_SEED_COPY.teamRoles[member.name]);
    assert.ok(
      ["Kitchen", "Bar", "Prep"].includes(member.role),
      `${member.name} carries a role gögi never published: ${member.role}`,
    );
  }
});

test("the menu page carries no items of its own", () => {
  const menu = seedDocuments(ids).menu.blocks[0];
  assert.equal(menu.blockType, "menu_board");
  assert.equal(menu.items, undefined);
  assert.equal(menu.sections, undefined);
});

test("contact is phone and Instagram, because they publish no email", () => {
  const docs = seedDocuments(ids);
  const serialised = JSON.stringify(docs);
  assert.ok(!/mailto:/.test(serialised));
  assert.ok(serialised.includes(GOGI_SEED_COPY.phoneHref));
  assert.ok(docs.footer.links.some((l) => l.href === GOGI_SEED_COPY.instagram));
});

test("every quoted line is one of theirs from the fact ledger", () => {
  const docs = seedDocuments(ids);
  // rich_text now carries a Lexical `content` document, because that is the
  // field the CMS actually has. The invariant is unchanged: every line of
  // prose on the site must be one gogi themselves published.
  const prose = [...docs.home.blocks, ...docs.about.blocks]
    .filter((b) => b.blockType === "rich_text")
    .flatMap((b) =>
      b.content.root.children.flatMap((paragraph) =>
        paragraph.children.map((node) => node.text)
      )
    );
  assert.ok(prose.length > 0, "no prose extracted — the shape changed again");
  for (const line of prose) {
    assert.ok(
      Object.values(GOGI_SEED_COPY.voice).includes(line),
      `unsourced line on the site: ${line}`,
    );
  }
});

test("gögi's own register is applied", () => {
  const settings = seedDocuments(ids).settings;
  assert.equal(settings.typography, "condensed-display");
  assert.equal(settings.accent_color, "#cda052");
});

/*
 * #2830 — the home page carries the sections gögi's own home page carries.
 *
 * The reels run is load-bearing in a way that is easy to break by accident:
 * the renderer turns CONSECUTIVE video_feature blocks into one grid, so a
 * block inserted between them silently becomes three full-width banners
 * instead — the exact layout this replaced. That is asserted here, at the
 * source of the ordering, because nothing downstream would complain.
 */
const everySlot = (extra = {}) => {
  const media = {};
  for (const slot of [
    "heroVideo",
    "foodSqCoconutRiceBowl", "foodSqWingsBoard", "foodSqStirFryPlate", "foodSqSmoothie",
    "reelFoodHouse", "reelFoodHousePoster",
    "reelPregameFriday", "reelPregameFridayPoster",
    "reelLateNightCravings", "reelLateNightCravingsPoster",
    "reelOutsideGogi", "reelOutsideGogiPoster",
  ]) media[slot] = `id-${slot}`;
  return { ...ids, media: { ...media, ...extra } };
};

test("#2830 the home page carries the food strip, the films and the people", () => {
  const home = seedDocuments(everySlot()).home;
  const types = home.blocks.map((block) => block.blockType);
  /*
   * [TEST-MOD-APPROVED #3149] SUPERSEDED, wave 4:
   *   assert.ok(types.includes("gallery"), "the what-people-order strip");
   *
   * "What people order" was four photographs and no price anywhere. It is a
   * `menu_preview` now: their real sections and real prices, projected from
   * Mingla, with the photographs beside them.
   *
   * SHARPENED. The original only asked that SOMETHING stood there. This pins
   * the block that must stand there, that a `gallery` no longer does — so the
   * bare strip cannot come back unnoticed — and that the photographs survived
   * the change rather than being dropped along with it.
   */
  assert.ok(types.includes("menu_preview"), "the what-people-order taster");
  assert.equal(types.includes("gallery"), false, "the bare photo strip is gone");
  const preview = home.blocks.find((block) => block.blockType === "menu_preview");
  assert.equal(preview.images.length, 4, "their four dish crops");
  assert.ok(types.includes("team"), "the people");
  assert.equal(types.filter((type) => type === "video_feature").length, 4);
});

test("#2830 the home reels stay CONSECUTIVE, so they render as one grid", () => {
  const types = seedDocuments(everySlot()).home.blocks.map((b) => b.blockType);
  const runs = [];
  for (const type of types) {
    const last = runs[runs.length - 1];
    if (last && last.type === type) last.count += 1;
    else runs.push({ type, count: 1 });
  }
  const reelRuns = runs.filter((run) => run.type === "video_feature");
  // One lone feature, and one run of three. Not four separate banners.
  assert.deepEqual(reelRuns.map((run) => run.count), [1, 3]);
});

test("#2830 the food strip is dropped rather than shown short", () => {
  const partial = seedDocuments(everySlot({ foodSqWingsBoard: undefined }));
  /*
   * [TEST-MOD-APPROVED #3149] SUPERSEDED, wave 4:
   *   const strip = partial.home.blocks.find((block) => block.blockType === "gallery");
   *
   * Same rule, new block: the photographs hang off the `menu_preview` now.
   *
   * SHARPENED in a way that matters more than it used to. The dishes and
   * prices come from MINGLA and the photographs come from gögi's uploads, so
   * a missing upload must not take the prices off the page with it. That is
   * asserted here for the first time — with three of four crops present, and
   * again with NONE, where the block must survive carrying no images at all
   * rather than disappearing.
   */
  const strip = partial.home.blocks.find(
    (block) => block.blockType === "menu_preview",
  );
  // Present, but only with the crops that actually uploaded — never a
  // placeholder and never an empty block.
  assert.ok(strip.images.length >= 1);
  assert.equal(strip.images.length, 3);
  assert.ok(strip.images.every((image) => typeof image.media === "string"));
  const none = seedDocuments(ids).home.blocks.find(
    (block) => block.blockType === "menu_preview",
  );
  assert.ok(none, "the menu taster must outlive its photographs");
  assert.equal(none.images, undefined);
  assert.equal(none.section_limit, 2);
});

test("#2830 a home page with no media at all still publishes", () => {
  const bare = seedDocuments({ ...ids, media: {} });
  const types = bare.home.blocks.map((block) => block.blockType);
  assert.ok(!types.includes("gallery"), "no empty strip");
  assert.ok(!types.includes("video_feature"), "no reel without its film");
  assert.ok(types.includes("hero") && types.includes("contact_handoff"));
});
