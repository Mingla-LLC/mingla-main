/**
 * Issue #4238 [P0 Host ads] — "Add ad video" showed "This needs a server record
 * before media upload." for every Host, so no ad video could be added on web.
 *
 * Root cause: CoverPicker's row-id guard (`validateEventRowId`, used before the
 * video and photo pickers open) and the gallery guard in `addGalleryPhoto` let
 * only brand and venue targets through. The ad builder opens the sheet with an
 * `ad_creative` target, which has no events row, so `eventRowId` was "" and the
 * guard raised `missing_server_event_id` before any file was picked.
 *
 * Two layers, the convention this directory already uses (CoverPicker.tsx pulls
 * in expo-video / expo-image-picker / react-native-video-trim and cannot be
 * mounted under jest — see `CoverPicker.galleryDuringVideo.issue3280.test.ts`):
 *   1. REAL LOGIC — `coverTargetHasUploadIdentity` decides per target.
 *   2. SOURCE WIRING — both guards call it, and neither still carries the old
 *      brand/venue-only row-id check.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, test } from "@jest/globals";

import {
  adCreativeCoverTarget,
  coverTargetHasUploadIdentity,
  type CoverTarget,
} from "../coverTarget";
import { ariAdOwnerKey, hostAdOwnerKey } from "../../../services/eventCoverVideoEdgeContract";

const UI = join(__dirname, "..");
const coverPickerSource = readFileSync(join(UI, "CoverPicker.tsx"), "utf8");

/** Source with whole-line `//` comments removed, so prose cannot satisfy or trip a check. */
const executable = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

/** A `useCallback` body, from its declaration to the next named declaration. */
const callbackBody = (name: string, nextName: string): string => {
  const start = coverPickerSource.indexOf(`const ${name} = useCallback`);
  expect(start).toBeGreaterThan(-1);
  const end = coverPickerSource.indexOf(`const ${nextName} = useCallback`, start);
  expect(end).toBeGreaterThan(start);
  return executable(coverPickerSource.slice(start, end));
};

const BRAND = "11111111-1111-4111-8111-111111111111";
const DRAFT = "22222222-2222-4222-8222-222222222222";

const eventTarget = (eventRowId: string): CoverTarget => ({
  kind: "event",
  brandId: BRAND,
  eventRowId,
  coverMediaApplyMode: "published_manual",
} as CoverTarget);

describe("#4238 — upload identity per cover target", () => {
  test("a Host ad target (host-ad:<draftId>) may upload with no events row", () => {
    expect(coverTargetHasUploadIdentity(adCreativeCoverTarget(BRAND, hostAdOwnerKey(DRAFT)))).toBe(true);
  });

  test("an Ari ad target may upload too", () => {
    expect(coverTargetHasUploadIdentity(adCreativeCoverTarget(BRAND, ariAdOwnerKey("proposal_abc")))).toBe(true);
  });

  test("an ad target with an empty draft id (`host-ad:`) is still refused", () => {
    expect(coverTargetHasUploadIdentity(adCreativeCoverTarget(BRAND, hostAdOwnerKey("")))).toBe(false);
    expect(coverTargetHasUploadIdentity(adCreativeCoverTarget(BRAND, ""))).toBe(false);
  });

  test("an event, trip or experience with an empty row id is still refused", () => {
    expect(coverTargetHasUploadIdentity(eventTarget(""))).toBe(false);
    expect(coverTargetHasUploadIdentity(eventTarget("   "))).toBe(false);
    expect(coverTargetHasUploadIdentity({ ...eventTarget(""), kind: "trip" } as CoverTarget)).toBe(false);
    expect(coverTargetHasUploadIdentity({ ...eventTarget(""), kind: "experience" } as CoverTarget)).toBe(false);
  });

  test("an event with a server row id may upload", () => {
    expect(coverTargetHasUploadIdentity(eventTarget("33333333-3333-4333-8333-333333333333"))).toBe(true);
  });

  test("brand and venue targets are unchanged (always allowed)", () => {
    expect(coverTargetHasUploadIdentity({ kind: "brand", brandId: BRAND } as CoverTarget)).toBe(true);
    expect(coverTargetHasUploadIdentity({ kind: "venue", brandId: BRAND, venueId: "v1" } as CoverTarget)).toBe(true);
  });
});

describe("#4238 — CoverPicker guards use the per-target identity check", () => {
  test("the video/photo guard (validateEventRowId) asks coverTargetHasUploadIdentity", () => {
    const body = callbackBody("validateEventRowId", "commitGallery");
    expect(body).toContain("coverTargetHasUploadIdentity(target)");
    expect(body).toContain("missing_server_event_id");
    // The old brand/venue-only rule is what blocked every ad_creative pick.
    expect(body).not.toMatch(/if \(isBrand \|\| isVenue\) return true;/);
    expect(body).not.toContain("eventRowId.trim()");
  });

  test("the video picker runs that guard before any file is picked", () => {
    const body = callbackBody("pickVideoCover", "retryVideoCoverUpload");
    const guard = body.indexOf("validateEventRowId()");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf("setUploading(true)"));
  });

  test("the gallery guard (addGalleryPhoto) asks coverTargetHasUploadIdentity", () => {
    const start = coverPickerSource.indexOf("const addGalleryPhoto = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const body = executable(coverPickerSource.slice(start, start + 4000));
    expect(body).toContain("if (!coverTargetHasUploadIdentity(target)) {");
    expect(body).not.toMatch(/!isBrand && !isVenue && eventRowId\.trim\(\)\.length === 0/);
  });

  test("an ad_creative photo never goes to the events-row storage path with an empty row id", () => {
    // Gallery photos and the photo cover route ad_creative to brand-keyed storage.
    const gallery = callbackBody("uploadGalleryPhoto", "addGalleryPhoto");
    expect(gallery.match(/if \(isBrand \|\| isVenue \|\| isAdCreative\) \{/g)?.length).toBe(2);
    const imageCover = callbackBody("pickImageOrGifCover", "pickVideoCover");
    // TEST-MOD-APPROVED #4490 D6 — the branch is now the shared rule, which also covers venue_draft.
    expect(imageCover).toContain("if (coverTargetUploadsToBrandStorage(target)) {");
  });
});
