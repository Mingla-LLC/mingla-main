/**
 * Issue #3318 — a photo added under Additional photos was silently discarded
 * when its upload failed.
 *
 * 2026-09-14: the picker handed back a photo, the upload never reached the
 * server, and ~60 s later the add's catch branch showed "Cover upload failed.
 * Try again." The photo was gone — no tile, no retry, no report. The add only
 * put a photo in the gallery AFTER a successful upload.
 *
 * REAL LOGIC: `coverPickerGalleryAdd` is imported and driven for real.
 * CoverPicker.tsx cannot mount under jest (expo-video / expo-image-picker /
 * react-native-video-trim — see `CoverPicker.selectedState.test.ts`), so the
 * pipeline lives in that module and CoverPicker's use of it is pinned by the
 * SOURCE WIRING block at the bottom.
 *
 *   T1  upload rejects → failed tile kept → Retry re-uploads the same file →
 *       success commits a gallery containing it
 *   T2  upload never settles → failed within the deadline, tile kept
 *   T4  the host re-seeds the gallery without the pending photo → it survives
 *   T5  no failure copy ever says "cover"
 *   T6  a failure is reported with its stage (and the video-job flag)
 *
 * FAILS-ON-REVERT: proven in the #3318 implementation record.
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import { describe, expect, jest, test } from "@jest/globals";
import type { OfferingGalleryImage } from "@mingla/offering-rendering";

import {
  commitGalleryWithCover,
  createGalleryAddController,
  galleryAddDeadlineMs,
  galleryAddFailureReason,
  galleryPhotoErrorMessage,
  GalleryAddDeadlineError,
  type GalleryAddAsset,
  type GalleryAddControllerDeps,
  type GalleryAddFailure,
  type GalleryAddStage,
  type GalleryPhotoTile,
} from "../coverPickerGalleryAdd";
import {
  StorageUploadError,
  StorageUploadTimeoutError,
  withStorageCause,
} from "../../../services/storageUploadWithRetry";
import { EventCoverMediaError } from "../../../utils/eventCoverMediaRules";
import { BrandCoverError } from "../../../utils/brandCoverRules";

const PHOTO: GalleryAddAsset = {
  uri: "file:///picked/IMG_0412.jpg",
  mimeType: "image/jpeg",
  fileName: "IMG_0412.jpg",
  fileSize: 2_400_000,
  type: "image",
};

const SAVED: OfferingGalleryImage = {
  url: "https://cdn.example.test/event_covers/brand/event/abc.jpg",
  posterUrl: "https://cdn.example.test/event_covers/brand/event/abc.jpg",
  type: "image",
  alt: null,
  credit: null,
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

/** A host that behaves like CoverPicker: a gallery ref the commit appends to. */
const harness = (overrides: Partial<GalleryAddControllerDeps> = {}) => {
  const gallery: { current: OfferingGalleryImage[] } = { current: [] };
  const tiles: { current: readonly GalleryPhotoTile[] } = { current: [] };
  const toasts: string[] = [];
  const reports: GalleryAddFailure[] = [];
  const uploads: GalleryAddAsset[] = [];
  const commits: OfferingGalleryImage[][] = [];
  let videoJobActive = false;
  const upload = jest.fn<GalleryAddControllerDeps["upload"]>();
  const controller = createGalleryAddController({
    upload: (asset, onStage) => {
      uploads.push(asset);
      return upload(asset, onStage);
    },
    commit: (item) => {
      gallery.current = [...gallery.current, item];
      commits.push(gallery.current);
    },
    onTilesChange: (next) => {
      tiles.current = next;
    },
    notify: (message) => toasts.push(message),
    report: (failure) => reports.push(failure),
    isVideoJobActive: () => videoJobActive,
    makeKey: (() => {
      let n = 0;
      return () => `tile-${(n += 1)}`;
    })(),
    ...overrides,
  });
  return {
    controller,
    upload,
    gallery,
    tiles,
    toasts,
    reports,
    uploads,
    commits,
    setVideoJobActive: (value: boolean) => {
      videoJobActive = value;
    },
  };
};

describe("T1 — a failed upload keeps the photo, and Retry saves the same file", () => {
  test("the photo is a tile while it uploads, and stays one when the upload rejects", async () => {
    const h = harness();
    const first = deferred<OfferingGalleryImage>();
    h.upload.mockReturnValueOnce(first.promise);

    const adding = h.controller.add(PHOTO);
    // Straight after the pick: a pending tile from the LOCAL file.
    expect(h.tiles.current).toEqual([
      { key: "tile-1", localUri: PHOTO.uri, status: "uploading", message: null },
    ]);
    expect(h.controller.isUploading()).toBe(true);

    first.reject(withStorageCause(
      new EventCoverMediaError("upload_failed", "Failed to fetch"),
      new StorageUploadError("Failed to fetch", true, false, 2),
    ));
    await adding;

    expect(h.tiles.current).toHaveLength(1);
    expect(h.tiles.current[0]).toMatchObject({ key: "tile-1", localUri: PHOTO.uri, status: "failed" });
    expect(h.tiles.current[0].message).toMatch(/photo/i);
    expect(h.gallery.current).toEqual([]);
    expect(h.controller.isUploading()).toBe(false);
  });

  test("Retry uploads the SAME file with no re-pick, and success commits a gallery containing it", async () => {
    const h = harness();
    h.upload.mockRejectedValueOnce(new EventCoverMediaError("upload_failed", "boom"));
    await h.controller.add(PHOTO);
    expect(h.tiles.current[0].status).toBe("failed");

    h.upload.mockResolvedValueOnce(SAVED);
    await h.controller.retry("tile-1");

    expect(h.uploads).toHaveLength(2);
    expect(h.uploads[1]).toBe(h.uploads[0]);
    expect(h.uploads[1].uri).toBe(PHOTO.uri);
    expect(h.gallery.current).toEqual([SAVED]);
    expect(h.commits).toEqual([[SAVED]]);
    expect(h.tiles.current).toEqual([]);
    expect(h.toasts[h.toasts.length - 1]).toBe("Photo added.");
  });

  test("the commit appends to the gallery as it is at commit time, not at pick time", async () => {
    const h = harness();
    const pending = deferred<OfferingGalleryImage>();
    h.upload.mockReturnValueOnce(pending.promise);
    const adding = h.controller.add(PHOTO);
    const other: OfferingGalleryImage = { url: "https://cdn.example.test/gif.gif", type: "gif" };
    h.gallery.current = [other]; // e.g. a GIF added from the GIFs tab mid-upload
    pending.resolve(SAVED);
    await adding;
    expect(h.gallery.current).toEqual([other, SAVED]);
  });

  test("Remove drops a failed tile and frees its file; a late result for a removed photo is ignored", async () => {
    const release = jest.fn();
    const h = harness();
    h.upload.mockRejectedValueOnce(new EventCoverMediaError("upload_failed", "boom"));
    await h.controller.add({ ...PHOTO, release });
    h.controller.remove("tile-1");
    expect(h.tiles.current).toEqual([]);
    expect(release).toHaveBeenCalledTimes(1);

    const late = deferred<OfferingGalleryImage>();
    h.upload.mockReturnValueOnce(late.promise);
    const adding = h.controller.add({ ...PHOTO, release });
    h.controller.remove("tile-2");
    late.resolve(SAVED);
    await adding;
    expect(h.gallery.current).toEqual([]);
    expect(release).toHaveBeenCalledTimes(2);
  });

  test("one upload at a time: add and Retry are refused while a photo uploads", async () => {
    const h = harness();
    h.upload.mockRejectedValueOnce(new EventCoverMediaError("upload_failed", "boom"));
    await h.controller.add(PHOTO);
    const pending = deferred<OfferingGalleryImage>();
    h.upload.mockReturnValueOnce(pending.promise);
    const adding = h.controller.add({ ...PHOTO, uri: "file:///picked/2.jpg" });
    await h.controller.retry("tile-1");
    await h.controller.add({ ...PHOTO, uri: "file:///picked/3.jpg" });
    expect(h.upload).toHaveBeenCalledTimes(2);
    pending.resolve(SAVED);
    await adding;
  });
});

describe("T2 — an upload that never settles fails within the deadline and keeps the tile", () => {
  test("the add resolves at the deadline with a failed tile, even though the request never settles", async () => {
    jest.useFakeTimers();
    try {
      const h = harness();
      h.upload.mockReturnValueOnce(new Promise<OfferingGalleryImage>(() => undefined));
      let settled = false;
      const adding = h.controller.add(PHOTO).then(() => {
        settled = true;
      });
      const deadline = galleryAddDeadlineMs(PHOTO.fileSize);

      await jest.advanceTimersByTimeAsync(deadline - 1);
      expect(settled).toBe(false);
      expect(h.tiles.current[0].status).toBe("uploading");

      await jest.advanceTimersByTimeAsync(1);
      await adding;
      expect(settled).toBe(true);
      expect(h.tiles.current).toEqual([
        expect.objectContaining({ key: "tile-1", status: "failed", localUri: PHOTO.uri }),
      ]);
      expect(h.reports[0]).toMatchObject({ reason: "deadline" });
      expect(h.controller.isUploading()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test("the deadline is two storage attempts for the file plus a minute, and bounded", () => {
    // 2.4 MB → 26 s per attempt → 52 s + 60 s.
    expect(galleryAddDeadlineMs(2_400_000)).toBe(112_000);
    // Unknown size → the storage maximum.
    expect(galleryAddDeadlineMs(null)).toBe(240_000);
    expect(galleryAddDeadlineMs(500_000_000)).toBe(240_000);
  });

  test("a result that lands after the deadline is ignored — nothing commits behind a failed tile", async () => {
    jest.useFakeTimers();
    try {
      const h = harness();
      const late = deferred<OfferingGalleryImage>();
      h.upload.mockReturnValueOnce(late.promise);
      const adding = h.controller.add(PHOTO);
      await jest.advanceTimersByTimeAsync(galleryAddDeadlineMs(PHOTO.fileSize));
      await adding;
      late.resolve(SAVED);
      await flush();
      expect(h.gallery.current).toEqual([]);
      expect(h.tiles.current[0].status).toBe("failed");
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("T4 — a host re-seed cannot wipe a photo that has not saved", () => {
  test("the pending photo survives a re-seed that does not contain it, then saves into the re-seeded gallery", async () => {
    const h = harness();
    const pending = deferred<OfferingGalleryImage>();
    h.upload.mockReturnValueOnce(pending.promise);
    const adding = h.controller.add(PHOTO);

    // CoverPicker's `initialCoverGallery` effect: the host passes a new array.
    const seeded: OfferingGalleryImage[] = [
      { url: "https://cdn.example.test/from-server.jpg", type: "image" },
    ];
    h.gallery.current = seeded;

    expect(h.controller.tiles()).toEqual([
      expect.objectContaining({ localUri: PHOTO.uri, status: "uploading" }),
    ]);
    pending.resolve(SAVED);
    await adding;
    expect(h.gallery.current).toEqual([...seeded, SAVED]);
  });

  test("a failed photo survives a re-seed too", async () => {
    const h = harness();
    h.upload.mockRejectedValueOnce(new EventCoverMediaError("upload_failed", "boom"));
    await h.controller.add(PHOTO);
    h.gallery.current = [];
    expect(h.controller.tiles()).toEqual([expect.objectContaining({ status: "failed" })]);
  });

  test("unmounting frees failed photos but still saves an in-flight one that lands", async () => {
    const releaseFailed = jest.fn();
    const releaseInFlight = jest.fn();
    const h = harness();
    h.upload.mockRejectedValueOnce(new EventCoverMediaError("upload_failed", "boom"));
    await h.controller.add({ ...PHOTO, release: releaseFailed });

    const pending = deferred<OfferingGalleryImage>();
    h.upload.mockReturnValueOnce(pending.promise);
    const adding = h.controller.add({ ...PHOTO, uri: "file:///picked/2.jpg", release: releaseInFlight });
    h.controller.dispose();
    expect(releaseFailed).toHaveBeenCalledTimes(1);
    // Its bytes may still be being read: not freed until the request settles.
    expect(releaseInFlight).not.toHaveBeenCalled();

    const toastsBefore = h.toasts.length;
    pending.resolve(SAVED);
    await adding;
    expect(h.gallery.current).toEqual([SAVED]);
    expect(releaseInFlight).toHaveBeenCalledTimes(1);
    expect(h.toasts.length).toBe(toastsBefore);
  });
});

describe("T5 — failure copy is about the photo, never the cover", () => {
  const STAGES: GalleryAddStage[] = ["pick", "read", "upload", "verify"];
  const EVENT_CODES = [
    "permission_denied",
    "unsupported_type",
    "file_too_large",
    "video_too_long",
    "video_duration_unknown",
    "upload_failed",
    "display_failed",
    "missing_server_event_id",
    "persist_mismatch",
  ] as const;
  const BRAND_CODES = [
    "permission_denied",
    "unsupported_type",
    "file_too_large",
    "empty_local_file",
    "upload_failed",
    "display_failed",
    "provider_search_failed",
    "provider_invalid_url",
  ] as const;
  const failures: unknown[] = [
    ...EVENT_CODES.map((code) => new EventCoverMediaError(code, "Cover upload failed. Try again.")),
    ...BRAND_CODES.map((code) => new BrandCoverError(code, "Couldn't upload cover. Tap to try again.")),
    new StorageUploadTimeoutError(26_000),
    new StorageUploadError("Failed to fetch", true, false, 2),
    new StorageUploadError("new row violates row-level security policy", false, false, 1),
    withStorageCause(
      new BrandCoverError("upload_failed", "Couldn't upload cover. Tap to try again."),
      new StorageUploadError("timeout", true, true, 2),
    ),
    new GalleryAddDeadlineError(112_000),
    new Error("Cover upload failed"),
    "cover",
    null,
    undefined,
    { message: "cover" },
  ];
  // The words the sheet's toast reads as an error (CoverPickerSheet `inferKind`).
  const ERROR_SIGNALS = /fail|error|permission|couldn't|could not|too large|30 mb|needs a server|try again/i;

  test("no failure, at any stage, for any target size, produces copy that mentions the cover", () => {
    for (const failure of failures) {
      for (const stage of STAGES) {
        for (const maxMegabytes of [null, 8, 30]) {
          const copy = galleryPhotoErrorMessage(failure, stage, { maxMegabytes });
          expect(copy).not.toMatch(/cover/i);
          expect(copy).toMatch(/^[A-Z].*\.$/);
          expect(copy).toMatch(ERROR_SIGNALS);
        }
      }
    }
  });

  test("a service's own cover-worded message is never passed through", () => {
    const brand = new BrandCoverError("upload_failed", "Couldn't upload cover. Tap to try again.");
    expect(galleryPhotoErrorMessage(brand, "upload")).toBe("Couldn't upload this photo. Tap Retry.");
    expect(galleryPhotoErrorMessage(new BrandCoverError("file_too_large", "x"), "read", { maxMegabytes: 8 })).toBe(
      "That photo is too large. Choose one under 8 MB.",
    );
  });

  test("a network failure and a timeout say so, and a failed tile's copy is the same sentence", async () => {
    expect(galleryPhotoErrorMessage(new StorageUploadTimeoutError(1), "upload")).toMatch(/connection/i);
    const h = harness();
    h.upload.mockRejectedValueOnce(withStorageCause(
      new EventCoverMediaError("upload_failed", "Cover upload failed. Try again."),
      new StorageUploadError("Failed to fetch", true, false, 2),
    ));
    await h.controller.add(PHOTO);
    expect(h.tiles.current[0].message).toBe("Couldn't upload this photo. Check your connection, then tap Retry.");
    expect(h.toasts).toEqual(["Couldn't upload this photo. Check your connection, then tap Retry."]);
  });
});

describe("T6 — a failure is reported with the stage it failed at", () => {
  const failAt = (stage: "read" | "upload" | "verify", error: unknown): GalleryAddControllerDeps["upload"] =>
    async (_asset, onStage) => {
      onStage("read");
      if (stage !== "read") onStage("upload");
      if (stage === "verify") onStage("verify");
      throw error;
    };

  const STAGE_CASES: Array<["read" | "upload" | "verify", Error, string]> = [
    ["read", new EventCoverMediaError("upload_failed", "We couldn't read that file."), "upload_failed"],
    ["upload", withStorageCause(new EventCoverMediaError("upload_failed", "x"), new StorageUploadTimeoutError(26_000)), "timeout"],
    ["verify", new EventCoverMediaError("display_failed", "x"), "display_failed"],
  ];
  test.each(STAGE_CASES)("a failure at %s is reported at that stage", async (stage, error, reason) => {
    const h = harness();
    h.upload.mockImplementationOnce(failAt(stage, error));
    await h.controller.add(PHOTO);
    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]).toMatchObject({ stage, reason, attempt: 1, videoJobActive: false });
    expect(h.reports[0].error).toBe(error);
  });

  test("the report says whether a cover video job was running, and counts Retry attempts", async () => {
    const h = harness();
    h.setVideoJobActive(true);
    h.upload.mockRejectedValueOnce(new EventCoverMediaError("upload_failed", "x"));
    await h.controller.add(PHOTO);
    h.setVideoJobActive(false);
    h.upload.mockRejectedValueOnce(new EventCoverMediaError("upload_failed", "x"));
    await h.controller.retry("tile-1");
    expect(h.reports.map((r) => [r.videoJobActive, r.attempt])).toEqual([
      [true, 1],
      [false, 2],
    ]);
  });

  test("a failure before a file is in hand is reported at stage pick, with photo copy and no tile", () => {
    const h = harness();
    h.controller.failBeforeUpload(new EventCoverMediaError("permission_denied", "denied"));
    h.controller.failBeforeUpload(new Error("PHPhotosErrorDomain error 3164"));
    expect(h.reports.map((r) => [r.stage, r.reason])).toEqual([
      ["pick", "permission_denied"],
      ["pick", "unknown"],
    ]);
    expect(h.toasts).toEqual([
      "Photo library permission is needed to add a photo.",
      "Couldn't open that photo. Try again.",
    ]);
    expect(h.tiles.current).toEqual([]);
  });

  test("storage failures classify by what the network did", () => {
    expect(galleryAddFailureReason(new StorageUploadTimeoutError(1))).toBe("timeout");
    expect(galleryAddFailureReason(new StorageUploadError("x", true, true, 2))).toBe("timeout");
    expect(galleryAddFailureReason(new StorageUploadError("x", true, false, 2))).toBe("network");
    expect(galleryAddFailureReason(new StorageUploadError("x", false, false, 1))).toBe("server_rejected");
  });
});

describe("the gallery emit reads the cover as it is NOW", () => {
  test("a commit after a cover change carries the new cover", () => {
    type Patch = { coverMediaUrl: string | null; coverGallery?: OfferingGalleryImage[] };
    const refs = {
      cover: { current: { coverMediaUrl: "https://cdn.example.test/old.jpg" } as Patch },
      gallery: { current: [] as OfferingGalleryImage[] },
    };
    const emitted: Patch[] = [];
    refs.cover.current = { coverMediaUrl: "https://video.example.test/ready.mp4" };
    commitGalleryWithCover([SAVED], refs, () => undefined, (patch: Patch) => {
      emitted.push(patch);
    });
    expect(emitted).toEqual([{ coverMediaUrl: "https://video.example.test/ready.mp4", coverGallery: [SAVED] }]);
    expect(refs.gallery.current).toEqual([SAVED]);
  });
});

// ----- Source wiring: CoverPicker uses the module, and the Cover step seeds a stable gallery

const UI = join(__dirname, "..");
const coverPickerSource = readFileSync(join(UI, "CoverPicker.tsx"), "utf8");
const step4Source = readFileSync(join(UI, "..", "event", "CreatorStep4Cover.tsx"), "utf8");

const executable = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

const callbackBody = (name: string, nextName: string): string => {
  const start = coverPickerSource.indexOf(`const ${name} = useCallback`);
  expect(start).toBeGreaterThan(-1);
  const end = coverPickerSource.indexOf(`const ${nextName} = useCallback`, start);
  expect(end).toBeGreaterThan(start);
  return executable(coverPickerSource.slice(start, end));
};

describe("issue #3318 source wiring", () => {
  test("addGalleryPhoto hands the picked photo to the controller and never shows the cover error", () => {
    const body = callbackBody("addGalleryPhoto", "retryGalleryPhoto");
    expect(body).toContain("await galleryAdd.add({");
    expect(body).toContain("...asset,");
    expect(body).toContain("galleryAdd.failBeforeUpload(");
    expect(body).not.toContain("showUploadError");
    expect(body).not.toContain("ensureMediaPermission");
    expect(body).not.toContain("commitGallery(");
    // The picked file is freed by the controller, not in this `finally`.
    expect(body).not.toMatch(/finally \{[^}]*revokeCoverPickedAssets/);
    expect(body).toContain("release: () => revokeCoverPickedAssets(pickedAssets),");
  });

  test("the controller is created once per mount, reports through the telemetry module, and is disposed on unmount", () => {
    const code = executable(coverPickerSource);
    expect(code).toContain("const [galleryAdd] = useState<GalleryAddController>(() =>");
    expect(code).toContain("report: (failure) => reportGalleryAddFailure(failure, target.kind),");
    expect(code).toContain("onTilesChange: (tiles) => setGalleryTiles(tiles),");
    expect(code).toContain("return () => galleryAdd.dispose();");
    expect(code).toContain("isVideoJobActive: () => activeVideoUpload,");
  });

  test("the upload tells the controller its stage, and uses the bounded retrying storage runner, on both routes", () => {
    const body = callbackBody("uploadGalleryPhoto", "addGalleryPhoto");
    expect(body).toContain("{ previousPublicUrl: null, onStage, uploadWithRetry: galleryStorageUpload },");
    expect((body.match(/\{ onStage, uploadWithRetry: galleryStorageUpload \}/g) ?? []).length).toBe(2);
    expect(body).toContain("uploadWithRetry: galleryStorageUpload,");
    expect(executable(coverPickerSource)).toContain(
      "const galleryStorageUpload = createStorageUploadWithRetry();",
    );
  });

  test("the commit appends to the CURRENT gallery ref, and both emit paths delegate to the module", () => {
    const code = executable(coverPickerSource);
    expect(code).toContain("commitGallery([...galleryRef.current, item]);");
    expect(callbackBody("emitChange", "persistReadyVideo")).toContain(
      "await emitCoverWithGallery(patch, emitRefs, setLocalCover, onCoverChange);",
    );
    expect(callbackBody("commitGallery", "appendGalleryItem")).toContain(
      "commitGalleryWithCover(next, emitRefs, setGallery, onCoverChange);",
    );
  });

  test("the cover spinner is the cover's own upload; the section renders tiles and its own busy state", () => {
    const code = executable(coverPickerSource);
    expect(code).toContain("uploading={uploading}");
    expect(code).not.toContain("uploading={uploading || galleryUploading}");
    expect(code).toContain("coverBusy={uploading || galleryUploading}");
    expect(code).toContain("loading={uploading}");
    expect(code).toContain('testID="cover-gallery-uploading"');
    expect(code).toContain('testID="cover-gallery-pending-tile"');
    expect(code).toContain('testID="cover-gallery-failed-tile"');
    expect(code).toContain("tiles={galleryTiles}");
    expect(code).toContain("const atCap = gallery.length + tiles.length >= max;");
  });

  test("the Cover step seeds an unknown gallery with ONE stable array", () => {
    const code = executable(step4Source);
    expect(code).toContain("coverGallery: draft.coverGallery ?? EMPTY_COVER_GALLERY,");
    expect(code).not.toContain("coverGallery: draft.coverGallery ?? [],");
    expect(code).toMatch(/^const EMPTY_COVER_GALLERY: OfferingGalleryImage\[\] = Object\.freeze\(\[\]\)/m);
  });
});

// ----- Issue #3319: Additional photos only on hosts that save them -----------
//
// The shared cover sheet rendered "Additional photos" (and the GIF/Photos "Add
// to: Gallery" option) on EVERY host. Venue listing, venue claim, venue deck
// readiness, brand edit, brand creation and both Ari proposal-card mounts never
// read `coverGallery` from the emitted patch: a photo added there uploaded,
// showed "Photo added.", and was never saved. Only event rows have an
// additional-photos column. Decision (#3318 spec S7): hide it — `galleryEnabled`
// defaults to false, and hosts that save the gallery opt in. A structural rule
// across every host, pinned against each host's actual `<CoverPickerSheet …/>`.

const SRC = join(__dirname, "..", "..", "..");
const read = (relative: string): string => readFileSync(join(SRC, relative), "utf8");

/** Every `<CoverPickerSheet …/>` element in a file, comments stripped. */
const sheetMounts = (relative: string): string[] => {
  const source = executable(read(relative));
  const mounts: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf("<CoverPickerSheet", from);
    if (start === -1) break;
    const end = source.indexOf("/>", start);
    expect(end).toBeGreaterThan(start);
    mounts.push(source.slice(start, end));
    from = end;
  }
  return mounts;
};

/** The host saves the gallery: these hosts' `onCoverChange` reads `coverGallery`. */
const SAVING_HOSTS: Array<[string, number, RegExp]> = [
  // event wizard, RSVP wizard and published-event edit all render this step
  ["components/event/CreatorStep4Cover.tsx", 1, /coverGallery:\s*\n?\s*draft\.coverGallery === undefined/],
  ["components/experience/ExperienceCoverStep.tsx", 1, /onCoverChange=\{onCoverChange\}/],
  ["components/trip/TripCreatorStep1Basics.tsx", 1, /coverGallery: patch\.coverGallery \?\? \[\]/],
  ["components/trip/EditPublishedTripScreen.tsx", 1, /coverGallery: patch\.coverGallery \?\? \[\]/],
];

/** The host does NOT save the gallery. */
const NON_SAVING_HOSTS: Array<[string, number]> = [
  ["components/venue/VenueCoverStep.tsx", 1],
  ["components/venue/claim/ClaimStepCover.tsx", 1],
  ["components/venue/VenueDeckReadinessSetup.tsx", 1],
  ["components/brand/BrandEditView.tsx", 1],
  ["components/brand/BrandCreationFlow.tsx", 1],
  ["components/ari/ToolProposalCard.tsx", 2],
];

describe("issue #3319 — Additional photos only where they are saved", () => {
  test.each(SAVING_HOSTS)("%s saves the gallery and opts in on every mount", (file, count, savesGallery) => {
    const mounts = sheetMounts(file);
    expect(mounts).toHaveLength(count);
    for (const mount of mounts) expect(mount).toMatch(/\bgalleryEnabled\b(?!=\{false\})/);
    expect(executable(read(file))).toMatch(savesGallery);
  });

  test("the experience wizard publishes the gallery the step's patch carries", () => {
    expect(executable(read("components/experience/ExperienceCreatorWizard.tsx"))).toContain(
      "coverGallery: cover.coverGallery ?? [],",
    );
  });

  test.each(NON_SAVING_HOSTS)("%s does not save a gallery and does not opt in", (file, count) => {
    const mounts = sheetMounts(file);
    expect(mounts).toHaveLength(count);
    for (const mount of mounts) expect(mount).not.toMatch(/galleryEnabled/);
    expect(executable(read(file))).not.toMatch(/coverGallery|cover_media_gallery/);
  });

  test("every CoverPickerSheet mount in the app is classified above", () => {
    const classified = new Set([...SAVING_HOSTS.map(([file]) => file), ...NON_SAVING_HOSTS.map(([file]) => file)]);
    const found: string[] = [];
    const walk = (relative: string): void => {
      for (const entry of readdirSync(join(SRC, relative), { withFileTypes: true })) {
        const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__" && entry.name !== "node_modules") walk(child);
        } else if (entry.name.endsWith(".tsx") && executable(read(child)).includes("<CoverPickerSheet")) {
          found.push(child);
        }
      }
    };
    walk("");
    const mounts = found.filter((file) => file !== "components/ui/CoverPickerSheet.tsx");
    expect(mounts.length).toBeGreaterThanOrEqual(SAVING_HOSTS.length + NON_SAVING_HOSTS.length);
    for (const file of mounts) expect(classified).toContain(file);
  });

  test("the sheet and the picker default the gallery OFF and forward the flag", () => {
    const sheet = executable(read("components/ui/CoverPickerSheet.tsx"));
    expect(sheet).toContain("galleryEnabled = false,");
    expect(sheet).toContain("galleryEnabled={galleryEnabled}");
    const picker = executable(read("components/ui/CoverPicker.tsx"));
    expect(picker).toContain("galleryEnabled = false,");
  });

  test("the picker renders neither the section nor the Add-to row without the flag", () => {
    const picker = executable(read("components/ui/CoverPicker.tsx"));
    expect(picker).toMatch(/\{galleryEnabled \? \(\s*<AdditionalPhotosSection\b/);
    expect((picker.match(/<AdditionalPhotosSection\b/g) ?? []).length).toBe(1);
    expect(picker).toMatch(
      /\{galleryEnabled && \(activeTab === "gif" \|\| activeTab === "stock"\) \? \(\s*<View style=\{styles\.addTargetRow\}/,
    );
    expect((picker.match(/styles\.addTargetRow\}/g) ?? []).length).toBe(1);
  });
});
