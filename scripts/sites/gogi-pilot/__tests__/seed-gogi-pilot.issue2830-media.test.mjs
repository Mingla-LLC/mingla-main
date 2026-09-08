// Issue #2830. gögi's own media, uploaded into Mingla and wired into the seed.
// The failure this file exists to catch is SILENT binding: a slot that resolves
// to nothing, or to the wrong file, produces a site that publishes cleanly and
// is simply missing pictures. Nothing else in the pipeline notices.
import assert from "node:assert/strict";
import test from "node:test";

import {
  GOGI_SEED_COPY,
  SEED_PAGE_ROLES,
  seedDocuments,
} from "../seed-gogi-pilot.mjs";
import { MEDIA_SLOTS } from "../media-slots.mjs";
import {
  deterministicMediaFilename,
  detectMime,
  planUploads,
} from "../upload-gogi-media.mjs";

const TENANT = "00000000-0000-4000-8000-000000000701";

function fullManifest() {
  let counter = 0;
  return Object.fromEntries(
    Object.keys(MEDIA_SLOTS).map((slot) => {
      counter += 1;
      return [slot, `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`];
    }),
  );
}

function documents(media) {
  return seedDocuments({
    heroMediaId: media.heroImage ?? "hero-media",
    homeId: "h", aboutId: "a", menuId: "m", galleryId: "g", contactId: "c",
    tenantId: TENANT,
    media,
  });
}

test("every team member gögi published has a portrait slot", () => {
  /*
   * This caught a real one: the slot map said "Madam chief chef" and the copy
   * says "Madam Chief chef". The lookup missed, her portrait vanished, and
   * every other check still passed.
   */
  const missing = GOGI_SEED_COPY.team.filter((name) => !MEDIA_SLOTS[`team:${name}`]);
  assert.deepEqual(missing, []);
});

test("the slot map binds each file exactly once", () => {
  const paths = Object.values(MEDIA_SLOTS);
  assert.equal(new Set(paths).size, paths.length, "two slots share one file");
});

test("with media, every page is published and reachable", () => {
  const docs = documents(fullManifest());
  for (const role of SEED_PAGE_ROLES) {
    assert.equal(docs[role].enabled, true, `${role} is not published`);
  }
  assert.equal(docs.navigation.pages.length, 5);
});

test("all ten portraits reach the team block", () => {
  const team = documents(fullManifest()).about.blocks.find((b) => b.blockType === "team");
  assert.equal(team.members.length, 10);
  assert.equal(team.members.filter((m) => m.media).length, 10);
  for (const member of team.members) assert.equal(member.alt, member.name);
});

test("the gallery never exceeds the contract's 12-image cap", () => {
  // A 13th image does not get trimmed, it fails artifact validation at publish.
  const gallery = documents(fullManifest()).gallery.blocks.find((b) => b.blockType === "gallery");
  assert.ok(gallery.images.length >= 1 && gallery.images.length <= 12, gallery.images.length);
});

test("a reel is placed only when BOTH its film and its still exist", () => {
  const partial = fullManifest();
  delete partial.reelPregameFridayPoster;
  const blocks = SEED_PAGE_ROLES.flatMap((role) => documents(partial)[role].blocks);
  const headings = blocks.filter((b) => b.blockType === "video_feature").map((b) => b.heading);
  assert.equal(headings.includes("Your Friday needs better decisions"), false);
  // The others are untouched.
  assert.equal(headings.includes("Meet the team"), true);
});

test("with no media at all the seed still produces a valid smaller site", () => {
  const docs = documents({});
  assert.equal(docs.home.enabled, true);
  assert.equal(docs.gallery.enabled, false, "an empty gallery must not publish");
  assert.equal(docs.navigation.pages.includes("g"), false);
  const reels = SEED_PAGE_ROLES.flatMap((r) => docs[r].blocks)
    .filter((b) => b.blockType === "video_feature");
  assert.deepEqual(reels, []);
});

test("media types are detected from bytes, not from the file extension", () => {
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8), Buffer.from([0xff, 0xd9]),
  ]);
  assert.equal(detectMime(jpeg), "image/jpeg");
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(8)]);
  assert.equal(detectMime(png), "image/png");
  const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom", "ascii"), Buffer.alloc(4)]);
  assert.equal(detectMime(mp4), "video/mp4");
  assert.throws(() => detectMime(Buffer.from("not media at all")), (e) => e.code === "UNSUPPORTED_MEDIA_TYPE");
});

test("uploading twice reuses the first upload instead of duplicating it", () => {
  const asset = { slot: "heroVideo", filename: "gogi-pilot-herovideo-abc.mp4" };
  const reuse = planUploads([asset], [
    { id: "00000000-0000-4000-8000-000000000901", filename: asset.filename, state: "READY" },
  ]);
  assert.equal(reuse[0].action, "reuse");
  assert.equal(reuse[0].mediaId, "00000000-0000-4000-8000-000000000901");

  const fresh = planUploads([asset], []);
  assert.equal(fresh[0].action, "upload");
});

test("a half-finished upload is re-driven, not treated as done", () => {
  const asset = { slot: "heroVideo", filename: "gogi-pilot-herovideo-abc.mp4" };
  const plan = planUploads([asset], [
    { id: "00000000-0000-4000-8000-000000000902", filename: asset.filename, state: "PROCESSING" },
  ]);
  assert.equal(plan[0].action, "upload");
});

test("the stored filename is content-addressed", () => {
  const a = deterministicMediaFilename("heroVideo", "a".repeat(64), "video/mp4");
  const b = deterministicMediaFilename("heroVideo", "b".repeat(64), "video/mp4");
  assert.notEqual(a, b, "two different files must not collide on one name");
  assert.equal(a, deterministicMediaFilename("heroVideo", "a".repeat(64), "video/mp4"));
  assert.match(a, /^gogi-pilot-herovideo-a{64}\.mp4$/);
});
