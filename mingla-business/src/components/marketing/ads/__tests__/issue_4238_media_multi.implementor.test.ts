// MINGLA-INVARIANT: I-4238-AD-MEDIA-MULTI | issue #4238 | B7/B8: the Host ad media step adds several videos in one pick, each uploading in its own background slot with its own owner key (no shared single-video sheet), fills the ad up to 5 and sends the rest to the library, asks before re-uploading a clip the library already has, and removing from the ad never deletes from the library.
/**
 * #4238 B7/B8/B9/B10 — Tinoe's Yard trial (18 Nov 2026).
 *
 * FAILS-ON-REVERT:
 *  - B7: a pick of several files must plan several uploads (not one).
 *  - B8: the builder must not hold one shared ad-video sheet state again.
 *  - no duplicate rows: a repeat pick of a library clip asks, never uploads.
 *  - remove / multi-remove only edit this ad's ids.
 *  - B9: the words check uses the apps this ad runs on.
 *  - B10: the rights refusal points at the rights box.
 *
 * Real logic is tested for real (`hostAdMediaQueue`, `adTileFitLine`); the
 * screen wiring is checked in its source, the convention this directory uses
 * for HostAdCreateScreen (it pulls in native modules jest cannot mount).
 */
import { readFileSync } from "fs";
import { join } from "path";

import { describe, expect, test } from "@jest/globals";

import {
  HOST_AD_MEDIA_MAX,
  hostAdAddToAd,
  hostAdCreativeNameFor,
  hostAdElapsedLabel,
  hostAdLibraryMatch,
  hostAdPickFingerprint,
  hostAdPickRefusal,
  hostAdRemoveFromAd,
  hostAdUploadOwnerKey,
  hostAdUploadPhaseFor,
  planHostAdPick,
  type HostAdPickedVideo,
} from "../hostAdMediaQueue";
import { adTileFitLine } from "../../../../utils/adVideoFit";
import { AD_CREATIVE_OWNER_KEY_PATTERN } from "../../../../services/eventCoverVideoEdgeContract";

const clip = (name: string, seconds: number, size = 20_000_000): HostAdPickedVideo => ({
  uri: `blob:${name}`,
  fileName: name,
  mimeType: "video/mp4",
  fileSize: size,
  durationMs: seconds * 1000,
});

const SCREEN = readFileSync(
  join(__dirname, "../../../../screens/hostAds/HostAdCreateScreen.tsx"),
  "utf8",
);
const executable = SCREEN.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");

describe("B7 — several videos in one pick", () => {
  test("five new clips into an empty ad all upload, all into the ad", () => {
    const plan = planHostAdPick({
      files: ["TY01.mp4", "TY02.mp4", "TY03.mp4", "TY04.mp4", "TY05.mp4"].map((n) => clip(n, 15)),
      adCount: 0,
      library: [],
      inFlight: [],
      isWeb: true,
    });
    expect(plan.toAd.map((f) => f.fileName)).toEqual(["TY01.mp4", "TY02.mp4", "TY03.mp4", "TY04.mp4", "TY05.mp4"]);
    expect(plan.toLibrary).toEqual([]);
  });

  test("past the limit of 5 the rest go to the library, in pick order", () => {
    const plan = planHostAdPick({
      files: ["A.mp4", "B.mp4", "C.mp4"].map((n) => clip(n, 20)),
      adCount: 4,
      library: [],
      inFlight: [],
      isWeb: true,
    });
    expect(plan.toAd.map((f) => f.fileName)).toEqual(["A.mp4"]);
    expect(plan.toLibrary.map((f) => f.fileName)).toEqual(["B.mp4", "C.mp4"]);
    expect(HOST_AD_MEDIA_MAX).toBe(5);
  });

  test("each file is checked before any byte leaves: short, long, type, size, unreadable", () => {
    expect(hostAdPickRefusal(clip("x.mp4", 3), { isWeb: true })).toBe("too_short");
    expect(hostAdPickRefusal(clip("x.mp4", 75), { isWeb: true })).toBe("too_long");
    expect(hostAdPickRefusal(clip("x.mp4", 60.5), { isWeb: true })).toBeNull();
    expect(hostAdPickRefusal({ ...clip("x.3gp", 20), mimeType: "video/3gpp" }, { isWeb: true })).toBe("unsupported");
    expect(hostAdPickRefusal(clip("x.mp4", 20, 200_000_000), { isWeb: true })).toBe("too_large");
    // Native compresses first, so size is checked after, not at pick.
    expect(hostAdPickRefusal(clip("x.mp4", 20, 200_000_000), { isWeb: false })).toBeNull();
    expect(hostAdPickRefusal({ ...clip("x.mp4", 20), durationMs: null }, { isWeb: true })).toBe("unreadable");
    const plan = planHostAdPick({ files: [clip("short.mp4", 3), clip("ok.mp4", 10)], adCount: 0, library: [], inFlight: [], isWeb: true });
    expect(plan.refused.map((r) => r.reason)).toEqual(["too_short"]);
    expect(plan.toAd.map((f) => f.fileName)).toEqual(["ok.mp4"]);
  });

  test("every upload gets its own valid owner key, so jobs run side by side", () => {
    const draft = "22222222-2222-4222-8222-222222222222";
    const a = hostAdUploadOwnerKey(draft, "abc123def4");
    const b = hostAdUploadOwnerKey(draft, "zz99yy88xx");
    expect(a).not.toBe(b);
    expect(AD_CREATIVE_OWNER_KEY_PATTERN.test(a)).toBe(true);
    expect(AD_CREATIVE_OWNER_KEY_PATTERN.test(b)).toBe(true);
    expect(hostAdUploadOwnerKey(draft, "a/b:c")).toBe(`host-ad:${draft}-abc`);
  });

  test("lane stages read as tile phases", () => {
    expect(hostAdUploadPhaseFor({ phase: "uploading", percent: 42.4 })).toEqual({ phase: "uploading", percent: 42, canRetry: false });
    expect(hostAdUploadPhaseFor({ phase: "uploading", percent: 100 }).percent).toBe(99);
    expect(hostAdUploadPhaseFor({ phase: "processing", percent: null }).phase).toBe("preparing");
    expect(hostAdUploadPhaseFor({ phase: "applied", percent: 100 }).phase).toBe("ready");
    expect(hostAdUploadPhaseFor({ phase: "error", percent: 0, canRetry: false })).toEqual({ phase: "failed", percent: null, canRetry: false });
    expect(hostAdUploadPhaseFor({ phase: "detached", percent: 0 }).canRetry).toBe(true);
    expect(hostAdElapsedLabel(1_000, 43_000)).toBe("0:42");
    expect(hostAdElapsedLabel(null, 5_000)).toBe("0:00");
  });

  test("the screen picks several files and mounts one upload slot per clip at its root", () => {
    expect(executable).toContain("launchAdVideosPicker(");
    expect(executable).toContain("planHostAdPick(");
    expect(executable).toMatch(/uploads\.map\(\(item\) => \(\s*<HostAdVideoUploadSlot/);
  });
});

describe("B8 — Add never reopens the last video", () => {
  test("the builder holds no single ad-video sheet state any more", () => {
    expect(executable).not.toContain("CoverPickerSheet");
    expect(executable).not.toContain("adVideoPatch");
    expect(executable).not.toContain("adVideoPickerVisible");
  });
});

describe("no duplicate creative rows", () => {
  const library = [
    { id: "c-ty06", name: "TY06", kind: "video" as const, duration_seconds: 20 },
    { id: "c-flyer", name: "Flyer", kind: "image" as const, duration_seconds: null },
  ];

  test("a pick that repeats a library clip asks instead of uploading", () => {
    const plan = planHostAdPick({ files: [clip("TY06.mp4", 20.4), clip("TY07.mp4", 15)], adCount: 1, library, inFlight: [], isWeb: true });
    expect(plan.duplicates.map((d) => d.clip.id)).toEqual(["c-ty06"]);
    expect(plan.toAd.map((f) => f.fileName)).toEqual(["TY07.mp4"]);
  });

  test("a different length or a photo of the same name is not the same clip", () => {
    expect(hostAdLibraryMatch(clip("TY06.mp4", 30), library)).toBeNull();
    expect(hostAdLibraryMatch(clip("Flyer.mp4", 10), library)).toBeNull();
    expect(hostAdCreativeNameFor("TY06.mp4")).toBe("TY06");
  });

  test("the same file twice in one pick, or while it uploads, uploads once", () => {
    const twice = planHostAdPick({ files: [clip("A.mp4", 10), clip("A.mp4", 10)], adCount: 0, library: [], inFlight: [], isWeb: true });
    expect(twice.toAd).toHaveLength(1);
    expect(twice.repeats).toHaveLength(1);
    const again = planHostAdPick({ files: [clip("A.mp4", 10)], adCount: 1, library: [], inFlight: [hostAdPickFingerprint(clip("A.mp4", 10))], isWeb: true });
    expect(again.toAd).toHaveLength(0);
    expect(again.repeats).toHaveLength(1);
  });
});

describe("remove and multi-remove", () => {
  test("removing edits only this ad's ids; the library is untouched", () => {
    expect(hostAdRemoveFromAd(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
    expect(hostAdRemoveFromAd(["a", "b", "c"], ["a", "c"])).toEqual(["b"]);
    expect(hostAdRemoveFromAd(["a"], ["zzz"])).toEqual(["a"]);
  });

  test("adding back keeps order, skips repeats and stops at 5", () => {
    expect(hostAdAddToAd(["a"], ["b", "a", "c"])).toEqual(["a", "b", "c"]);
    expect(hostAdAddToAd(["1", "2", "3", "4"], ["5", "6"])).toEqual(["1", "2", "3", "4", "5"]);
  });

  test("archive is a confirmed server archive with undo, never a delete", () => {
    expect(executable).toContain("archiveHostAdCreatives(");
    expect(executable).toContain("restoreHostAdCreatives(");
    expect(executable).toMatch(/visible=\{sheet === "archive"\}[\s\S]{0,400}destructive/);
    const service = readFileSync(join(__dirname, "../../../../services/hostAdCreativeLibraryService.ts"), "utf8");
    expect(service).toContain('"creative_archive"');
    expect(service).toContain('"creative_unarchive"');
    expect(service).not.toMatch(/creative_purge/);
  });
});

describe("per-app fit on each tile", () => {
  const fit = [
    { platform: "meta", fits: true, needs: [] },
    { platform: "tiktok", fits: true, needs: [] },
    { platform: "snapchat", fits: false, needs: ["1080×1920"] },
    { platform: "google", fits: false, needs: ["a landscape version"] },
  ];

  test("judged only against this ad's apps", () => {
    expect(adTileFitLine(fit, ["meta", "tiktok"])).toEqual({ text: "Fits Facebook & Instagram and TikTok", warn: false });
    expect(adTileFitLine([...fit.slice(0, 2), { platform: "reddit", fits: true, needs: [] }], ["meta", "tiktok", "reddit"])).toEqual({
      text: "Fits all 3 apps",
      warn: false,
    });
    expect(adTileFitLine(fit, ["meta"])).toEqual({ text: "Fits Facebook & Instagram", warn: false });
    expect(adTileFitLine(fit, ["meta", "snapchat"])).toEqual({ text: "Snapchat needs 1080×1920", warn: true });
    expect(adTileFitLine(fit, ["reddit"])).toBeNull();
    expect(adTileFitLine(undefined, ["meta"])).toBeNull();
  });
});

describe("B9 and B10", () => {
  test("B9: the words check reads the apps this ad runs on", () => {
    expect(executable).toMatch(/hostAdCopyError\(planApps\.length > 0 \? planApps : activeApps,/);
    expect(executable).not.toMatch(/hostAdCopyError\(activeApps,/);
  });

  test("B10: the rights refusal points at the rights box, not at an app", () => {
    expect(executable).toMatch(/code === "media_rights_attestation_required"\)\s*\{[\s\S]{0,400}setRightsMissing\(true\)/);
    expect(executable).toContain('hb("review.rightsMissing")');
  });
});
