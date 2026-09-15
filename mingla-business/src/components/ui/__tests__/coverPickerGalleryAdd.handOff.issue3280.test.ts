/**
 * #3280 (defect 1) keeps #3318/#3335 intact — a failed Additional photo
 * survives the cover sheet coming back fresh after the native trim editor.
 *
 * The fresh sheet is a new mount of the picker, and a new mount has a new photo
 * controller. Unmounting drops failed photos and frees their files (that is
 * #3318's contract for a sheet the organiser closes). A sheet that closes ONLY
 * because the trim editor was shown must not do that: the old controller hands
 * its failed photos over, and the new one shows them with the same message and
 * a working Retry on the same file.
 *
 * REAL LOGIC: `coverPickerGalleryAdd` is driven for real; only the upload is a
 * test double.
 *
 * Fails on revert of coverPickerGalleryAdd.ts: `handOffFailed` / `adoptFailed`
 * do not exist, so the tile is lost with its file.
 */
import { describe, expect, jest, test } from "@jest/globals";
import type { OfferingGalleryImage } from "@mingla/offering-rendering";

import {
  createGalleryAddController,
  type GalleryAddAsset,
  type GalleryAddControllerDeps,
  type GalleryPhotoTile,
} from "../coverPickerGalleryAdd";

const SAVED: OfferingGalleryImage = {
  url: "https://cdn.example.test/event_covers/brand/event/abc.jpg",
  posterUrl: "https://cdn.example.test/event_covers/brand/event/abc.jpg",
  type: "image",
  alt: null,
  credit: null,
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

const mountController = (upload: GalleryAddControllerDeps["upload"]) => {
  const tiles: { current: readonly GalleryPhotoTile[] } = { current: [] };
  const commits: OfferingGalleryImage[] = [];
  const controller = createGalleryAddController({
    upload,
    commit: (item) => commits.push(item),
    onTilesChange: (next) => {
      tiles.current = next;
    },
    notify: () => undefined,
    report: () => undefined,
    isVideoJobActive: () => false,
    makeKey: (() => {
      let n = 0;
      return () => `tile-${(n += 1)}`;
    })(),
  });
  controller.attach();
  return { controller, tiles, commits };
};

describe("#3280 — failed photos move to the fresh sheet", () => {
  test("hand-off keeps the file; the next mount shows the tile and Retry uploads the same file", async () => {
    const release = jest.fn();
    const photo: GalleryAddAsset = {
      uri: "file:///picked/IMG_0412.jpg",
      mimeType: "image/jpeg",
      fileSize: 2_400_000,
      release,
    };

    const first = mountController(() => Promise.reject(new Error("Network request failed")));
    await first.controller.add(photo);
    await flush();
    expect(first.tiles.current).toEqual([
      expect.objectContaining({ key: "tile-1", status: "failed", localUri: photo.uri }),
    ]);
    const message = first.tiles.current[0].message;
    expect(message).not.toBeNull();

    // The sheet closes for the fresh sheet: hand off, then unmount.
    const handedOff = first.controller.handOffFailed();
    first.controller.dispose();
    expect(handedOff).toEqual([
      expect.objectContaining({ key: "tile-1", asset: photo, message, attempts: 1 }),
    ]);
    // The file is NOT freed: the photo is still on its way to the fresh sheet.
    expect(release).not.toHaveBeenCalled();
    expect(first.controller.tiles()).toEqual([]);

    const uploads: GalleryAddAsset[] = [];
    const second = mountController((asset) => {
      uploads.push(asset);
      return Promise.resolve(SAVED);
    });
    second.controller.adoptFailed(handedOff);
    expect(second.tiles.current).toEqual([
      { key: "tile-1", localUri: photo.uri, status: "failed", message },
    ]);

    // Adopting the same hand-off twice never duplicates the tile.
    second.controller.adoptFailed(handedOff);
    expect(second.controller.tiles()).toHaveLength(1);

    await second.controller.retry("tile-1");
    await flush();
    expect(uploads).toEqual([photo]);
    expect(second.commits).toEqual([SAVED]);
    expect(second.controller.tiles()).toEqual([]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  test("an uploading photo is not handed off (it still saves on its own)", async () => {
    let finish: (item: OfferingGalleryImage) => void = () => undefined;
    const first = mountController(
      () =>
        new Promise<OfferingGalleryImage>((resolve) => {
          finish = resolve;
        }),
    );
    void first.controller.add({ uri: "file:///picked/IMG_0413.jpg", fileSize: 1_000_000 });
    await flush();
    expect(first.controller.handOffFailed()).toEqual([]);
    expect(first.controller.isUploading()).toBe(true);
    finish(SAVED);
    await flush();
    expect(first.commits).toEqual([SAVED]);
  });
});
