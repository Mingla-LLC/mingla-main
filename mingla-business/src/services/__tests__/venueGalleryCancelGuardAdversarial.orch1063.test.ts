/**
 * #1063 [picker-cancel-guard] — TESTER adversarial regression test (different
 * angle from the implementor's happy-path suite).
 *
 * The implementor's `venueGalleryCancelGuard.orch1063.test.ts` proves the two
 * canonical shapes: cancel(`assets:null`) → silent, and a single-asset success →
 * mapped. This suite attacks the EDGES that suite does not cover:
 *   1. `{ canceled: true, assets: undefined }` — a cancel where assets is
 *      `undefined` (not `null`). The guard is on `canceled`, so this must ALSO
 *      return silently and must NOT reach `.map()` (an unguarded `undefined.map()`
 *      throws exactly like `null.map()`).
 *   2. `{ canceled: false, assets: [] }` — an empty-but-NON-null assets array on a
 *      NON-cancel result. Must map to `[]` with no throw (proves the guard keys on
 *      `canceled`, never on assets length).
 *   3. A multi-asset success — every asset mapped, and each optional field
 *      (mimeType/fileName/fileSize) null-coalesced (proves the happy path maps the
 *      real payload, not just count).
 *   4. Back-to-back cancel → success on the SAME handler — proves no cross-call
 *      state leak (each call re-reads its own result).
 *
 * FAILS-ON-REVERT: delete the `if (result.canceled) return { canceled: true,
 * assets: [] }` guard in `venueGalleryDeviceMedia.native.ts` and case (1) and
 * case (4)'s cancel leg fall through to `result.assets.map(...)` on
 * `undefined`/`null` → TypeError → those tests reject and FAIL.
 *
 * Native split: import `venueGalleryDeviceMedia.native` explicitly (bare
 * `../venueGalleryDeviceMedia` resolves to the WEB `.ts` under jest's node env).
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

type PickedAsset = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  duration?: number | null;
  type?: string | null;
};

// Deliberately looser than expo's real union so we can inject the `undefined`
// cancel shape and a null-on-non-cancel shape the production type forbids.
type LoosePickerResult =
  | { canceled: true; assets: null | undefined }
  | { canceled: false; assets: PickedAsset[] };

const mockLaunchImageLibraryAsync =
  jest.fn<(options: Record<string, unknown>) => Promise<LoosePickerResult>>();

jest.mock("../../utils/platformImagePicker", () => ({
  __esModule: true,
  launchImageLibraryAsync: mockLaunchImageLibraryAsync,
}));

import { launchGalleryImagePicker } from "../venueGalleryDeviceMedia.native";

beforeEach(() => {
  mockLaunchImageLibraryAsync.mockReset();
});

describe("#1063 adversarial — native gallery cancel guard edges", () => {
  test("cancel with assets:undefined (not null) still returns silently, no `.map()`", async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: true,
      assets: undefined,
    });
    await expect(launchGalleryImagePicker(4)).resolves.toEqual({
      canceled: true,
      assets: [],
    });
  });

  test("non-cancel with empty (non-null) assets array maps to [] with no throw", async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [] });
    await expect(launchGalleryImagePicker(4)).resolves.toEqual({
      canceled: false,
      assets: [],
    });
  });

  test("multi-asset success maps every asset and null-coalesces optional fields", async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: "file:///a.jpg",
          mimeType: "image/jpeg",
          fileName: "a.jpg",
          fileSize: 111,
        },
        // second asset omits mimeType/fileName/fileSize → must come back as null
        { uri: "file:///b.heic" },
        {
          uri: "file:///c.png",
          mimeType: "image/png",
          fileName: null,
          fileSize: 333,
        },
      ],
    });

    const result = await launchGalleryImagePicker(4);

    expect(result.canceled).toBe(false);
    expect(result.assets).toEqual([
      { uri: "file:///a.jpg", mimeType: "image/jpeg", fileName: "a.jpg", fileSize: 111 },
      { uri: "file:///b.heic", mimeType: null, fileName: null, fileSize: null },
      { uri: "file:///c.png", mimeType: "image/png", fileName: null, fileSize: 333 },
    ]);
  });

  test("back-to-back cancel then success on the same handler — no state leak", async () => {
    // First call: cancel → silent.
    mockLaunchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: null });
    // Second call: a real pick → mapped.
    mockLaunchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///z.jpg", mimeType: "image/jpeg", fileName: "z.jpg", fileSize: 9 }],
    });

    const first = await launchGalleryImagePicker(4);
    const second = await launchGalleryImagePicker(4);

    expect(first).toEqual({ canceled: true, assets: [] });
    expect(second).toEqual({
      canceled: false,
      assets: [{ uri: "file:///z.jpg", mimeType: "image/jpeg", fileName: "z.jpg", fileSize: 9 }],
    });
  });
});
