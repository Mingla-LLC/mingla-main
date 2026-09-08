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
  tenantId: "t",
};

const roles = ["home", "about", "menu", "gallery", "contact"];

test("seeds the five pages gögi's own site has", () => {
  const docs = seedDocuments(ids);
  assert.deepEqual(roles.map((role) => docs[role].role), roles);
  assert.deepEqual(
    roles.map((role) => docs[role].nav_label),
    ["Home", "About", "Menu", "Gallery", "Visit"],
  );
  // Four, not five: Gallery has no blocks until media is uploaded, and the
  // test below pins that an empty page is not published. Listing it here would
  // be a navigation link to a page the runtime will not route.
  assert.equal(docs.navigation.pages.length, 4);
  assert.equal(docs.navigation.pages.includes(ids.galleryId), false);
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
    assert.equal(member.role, undefined);
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
  assert.ok(types.includes("gallery"), "the what-people-order strip");
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
  const strip = partial.home.blocks.find((block) => block.blockType === "gallery");
  // Present, but only with the crops that actually uploaded — never a
  // placeholder and never an empty block.
  assert.ok(strip.images.length >= 1);
  assert.ok(strip.images.every((image) => typeof image.media === "string"));
});

test("#2830 a home page with no media at all still publishes", () => {
  const bare = seedDocuments({ ...ids, media: {} });
  const types = bare.home.blocks.map((block) => block.blockType);
  assert.ok(!types.includes("gallery"), "no empty strip");
  assert.ok(!types.includes("video_feature"), "no reel without its film");
  assert.ok(types.includes("hero") && types.includes("contact_handoff"));
});
