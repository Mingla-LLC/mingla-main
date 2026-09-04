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
  const prose = [...docs.home.blocks, ...docs.about.blocks]
    .filter((b) => b.blockType === "rich_text")
    .flatMap((b) => b.paragraphs.map((p) => p.text));
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
