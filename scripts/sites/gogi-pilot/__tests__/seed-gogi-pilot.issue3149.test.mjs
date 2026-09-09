/*
 * #3149 — gögi's own eyebrows, EXECUTED.
 *
 * Every line asserted here is transcribed from gögi's own published site
 * (https://gogi-lagos-phi.vercel.app). Nothing below is invented, and a block
 * they do not label is asserted to carry NO eyebrow — a placeholder in that
 * slot is Mingla writing copy on a restaurant's own website.
 *
 * This RUNS `seedDocuments` rather than reading the source. Six defects on
 * #2830 shipped green off tests that read code as text and failed on the first
 * real call; the shape that reaches Payload is the only thing that matters.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { seedDocuments } from "../seed-gogi-pilot.mjs";

const TENANT_ID = "00000000-0000-4000-8000-000000000701";
const HOME_ID = "00000000-0000-4000-8000-000000000702";
const ABOUT_ID = "00000000-0000-4000-8000-000000000703";
const MENU_ID = "00000000-0000-4000-8000-000000000704";
const GALLERY_ID = "00000000-0000-4000-8000-000000000705";
const CONTACT_ID = "00000000-0000-4000-8000-000000000706";
const HERO_ID = "00000000-0000-4000-8000-000000000707";

/*
 * The media slots the seed asks for. Every reel, poster, dish crop and gallery
 * photograph is present, because a block whose media has not uploaded is
 * DROPPED — and a run of three reels that silently became one would make the
 * grid-heading assertions below pass while proving nothing.
 */
function everyAsset() {
  const media = {};
  let counter = 800;
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

const find = (page, blockType, heading) => {
  const found = page.blocks.filter((block) =>
    block.blockType === blockType &&
    (heading === undefined || block.heading === heading)
  );
  assert.equal(
    found.length,
    1,
    `expected exactly one ${blockType} "${heading}", found ${found.length}`,
  );
  return found[0];
};

/*
 * Transcribed from gögi's published site. The seed must produce EXACTLY this
 * and nothing else — an extra eyebrow is invented copy just as surely as a
 * wrong one is.
 */
const TRANSCRIBED = [
  ["home", "rich_text", "Come as you are", "The place"],
  ["home", "video_feature", "Day or night, open for a bite", "Admiralty Way"],
  ["home", "gallery", "What people order", "The menu"],
  ["home", "team", "Meet the team", "The kitchen"],
  ["home", "contact_handoff", "Call gögi", "Come through"],
  ["about", "rich_text", "Find gögi", "The idea"],
  ["about", "team", "The team", "The kitchen"],
  ["menu", "menu_board", "The menu", "Everything, with prices"],
  ["gallery", "gallery", "In the room", "Photos"],
  ["contact", "hours_location", "Visit gögi", "Getting here"],
];

test("#3149 every transcribed eyebrow reaches the seeded block", () => {
  const documents = seeded();
  for (const [role, blockType, heading, eyebrow] of TRANSCRIBED) {
    const block = find(documents[role], blockType, heading);
    assert.equal(
      block.eyebrow,
      eyebrow,
      `${role}/${blockType} "${heading}" should read "${eyebrow}"`,
    );
  }
});

test("#3149 the home run of three films is titled off its FIRST film", () => {
  const home = seeded().home;
  const reels = home.blocks.filter((block) =>
    block.blockType === "video_feature"
  );
  /*
   * FOUR films on home: the lone "Day or night" feature, then the run of
   * three. The run is what renders as a grid, and it is the last three.
   */
  assert.equal(reels.length, 4);
  const run = reels.slice(1);
  assert.equal(run[0].heading, "Your Friday needs better decisions");
  assert.equal(run[0].eyebrow, "Straight from @gogilagos");
  assert.equal(run[0].group_heading, "The room, on any given night");
  // Only the first speaks for the group, or the page prints the same heading
  // three times.
  for (const later of run.slice(1)) {
    assert.equal(later.group_heading, undefined);
    assert.equal(later.eyebrow, undefined);
  }
});

test("#3149 the gallery run is the SAME films under their own title", () => {
  const gallery = seeded().gallery;
  const reels = gallery.blocks.filter((block) =>
    block.blockType === "video_feature"
  );
  assert.equal(reels.length, 3);
  assert.equal(reels[0].heading, "Your Friday needs better decisions");
  assert.equal(reels[0].eyebrow, "Films");
  assert.equal(reels[0].group_heading, "Six minutes of gögi");
  for (const later of reels.slice(1)) {
    assert.equal(later.group_heading, undefined);
    assert.equal(later.eyebrow, undefined);
  }
});

test("#3149 the two runs are titled differently, from one shared film", () => {
  // The same three uploads head both runs. If the title lived on the film
  // rather than on the run, one of these two would be wrong.
  const documents = seeded();
  const first = (page) =>
    page.blocks.filter((block) => block.blockType === "video_feature").at(-3);
  assert.notEqual(
    first(documents.home).group_heading,
    first(documents.gallery).group_heading,
  );
  assert.equal(
    first(documents.home).video,
    first(documents.gallery).video,
  );
});

test("#3149 a block gögi did not label carries NO eyebrow", () => {
  const documents = seeded();
  /*
   * Their site has no clean counterpart for the home hours block, so it gets
   * nothing — a missing line is honest, an invented one is not. The same goes
   * for the contact page's phone handoff and the lone films on About and Menu.
   */
  const unlabelled = [
    find(documents.home, "hours_location", "Open day and night"),
    find(documents.contact, "contact_handoff", "Call gögi"),
    find(documents.about, "video_feature", "Meet the team"),
    find(documents.menu, "video_feature", "Coconut rice, but make it gögi"),
  ];
  for (const block of unlabelled) {
    assert.equal(block.eyebrow, undefined);
    assert.ok(!("eyebrow" in block), "the key must be absent, not empty");
  }
});

test("#3149 the hero is never given one — it owns the page's headline", () => {
  const hero = find(seeded().home, "hero");
  assert.ok(!("eyebrow" in hero));
  assert.ok(!("group_heading" in hero));
});

test("#3149 exactly the transcribed eyebrows exist, and no others", () => {
  // The guard against a later edit quietly re-introducing a placeholder.
  const documents = seeded();
  const found = [];
  for (const role of ["home", "about", "menu", "gallery", "contact"]) {
    for (const block of documents[role].blocks) {
      if (block.eyebrow !== undefined) {
        found.push([role, block.blockType, block.heading, block.eyebrow]);
      }
    }
  }
  const expected = [
    ...TRANSCRIBED,
    [
      "home",
      "video_feature",
      "Your Friday needs better decisions",
      "Straight from @gogilagos",
    ],
    ["gallery", "video_feature", "Your Friday needs better decisions", "Films"],
  ];
  assert.deepEqual(
    found.map((row) => row.join(" | ")).sort(),
    expected.map((row) => row.join(" | ")).sort(),
  );
});

test("#3149 group_heading exists on exactly the two run heads", () => {
  const documents = seeded();
  const found = [];
  for (const role of ["home", "about", "menu", "gallery", "contact"]) {
    for (const block of documents[role].blocks) {
      if (block.group_heading !== undefined) {
        found.push(`${role} | ${block.group_heading}`);
      }
    }
  }
  assert.deepEqual(found.sort(), [
    "gallery | Six minutes of gögi",
    "home | The room, on any given night",
  ]);
});

test("#3149 every eyebrow is short enough for the CMS field", () => {
  // The Studio field is capped at 60. A seed that exceeds it would be rejected
  // on save, which the seed reports as an opaque validation failure.
  const documents = seeded();
  for (const role of ["home", "about", "menu", "gallery", "contact"]) {
    for (const block of documents[role].blocks) {
      if (typeof block.eyebrow === "string") {
        assert.ok(
          block.eyebrow.length <= 60,
          `${role}/${block.blockType} eyebrow is ${block.eyebrow.length} chars`,
        );
      }
      if (typeof block.group_heading === "string") {
        assert.ok(block.group_heading.length <= 120);
      }
    }
  }
});

test("#3149 a seed with no media still carries the eyebrows it can", () => {
  /*
   * The seed runs today with one hero photograph and grows. Blocks whose media
   * is missing DROP, and what survives must keep its words — this is the shape
   * that is actually live.
   */
  const documents = seeded({});
  assert.equal(find(documents.home, "rich_text").eyebrow, "The place");
  assert.equal(find(documents.home, "team").eyebrow, "The kitchen");
  assert.equal(find(documents.menu, "menu_board").eyebrow, "Everything, with prices");
  assert.equal(find(documents.contact, "hours_location").eyebrow, "Getting here");
  // No films uploaded means no run, so nothing titles one.
  for (const role of ["home", "about", "menu", "gallery"]) {
    for (const block of documents[role].blocks) {
      assert.equal(block.group_heading, undefined);
    }
  }
});
