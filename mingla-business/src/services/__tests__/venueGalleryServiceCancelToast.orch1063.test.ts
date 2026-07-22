/**
 * #1063 [picker-cancel-guard] — TESTER adversarial: user-facing SERVICE contract.
 *
 * The implementor's suite proves the native media handler returns silently on
 * cancel. THIS suite proves the actual symptom the issue is about — the false
 * "Couldn't open photos. Try again." toast — by driving the layer that produced
 * it: `venueGalleryService.pickGalleryPhotos`. It asserts the full contract:
 *
 *   A. When the picker cancels (handler resolves `{ canceled: true, assets: [] }`,
 *      the post-fix shape), `pickGalleryPhotos` returns `[]` and NEVER throws a
 *      `VenueGalleryError` → NO false toast. This is the fix's whole point.
 *   B. A genuine success still returns the mapped assets.
 *   C. A REAL failure (handler throws) STILL surfaces
 *      `VenueGalleryError("picker_failed", "Couldn't open photos. Try again.")` —
 *      proving the fix did NOT over-silence: the toast path is intact for actual
 *      errors, it just no longer fires on a plain cancel. (No `catch {}`-swallow.)
 *
 * The handler + supabase + file-reader are mocked so this exercises ONLY the
 * service's cancel/throw branching (supabase pulls expo-constants ESM under jest).
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

type GalleryDeviceMediaResult = {
  canceled: boolean;
  assets: {
    uri: string;
    mimeType?: string | null;
    fileName?: string | null;
    fileSize?: number | null;
  }[];
};

const mockLaunchGalleryImagePicker =
  jest.fn<(remainingSlots: number) => Promise<GalleryDeviceMediaResult>>();

jest.mock("../venueGalleryDeviceMedia", () => ({
  __esModule: true,
  launchGalleryImagePicker: mockLaunchGalleryImagePicker,
}));
// Cut the ESM / native import chain the service pulls in at module load.
jest.mock("../supabase", () => ({ __esModule: true, supabase: {} }));
jest.mock("../brandAvatarFileReader", () => ({
  __esModule: true,
  readBrandAvatarFileBytes: jest.fn(),
}));

import { pickGalleryPhotos, VenueGalleryError } from "../venueGalleryService";

beforeEach(() => {
  mockLaunchGalleryImagePicker.mockReset();
});

describe("#1063 adversarial — pickGalleryPhotos user-facing contract", () => {
  test("A. cancel → returns [] and throws NO VenueGalleryError (no false toast)", async () => {
    mockLaunchGalleryImagePicker.mockResolvedValue({ canceled: true, assets: [] });

    // Must resolve to [] — must NOT reject. A rejection here is the false toast.
    await expect(pickGalleryPhotos(4)).resolves.toEqual([]);
  });

  test("B. success → returns the mapped picked assets", async () => {
    mockLaunchGalleryImagePicker.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: "file:///p.jpg", mimeType: "image/jpeg", fileName: "p.jpg", fileSize: 42 },
        { uri: "file:///q.heic" },
      ],
    });

    await expect(pickGalleryPhotos(4)).resolves.toEqual([
      { uri: "file:///p.jpg", mimeType: "image/jpeg", fileName: "p.jpg", fileSize: 42 },
      { uri: "file:///q.heic", mimeType: null, fileName: null, fileSize: null },
    ]);
  });

  test("C. a GENUINE failure (handler throws) STILL surfaces the error (not over-silenced)", async () => {
    mockLaunchGalleryImagePicker.mockRejectedValue(new Error("native IO failure"));

    await expect(pickGalleryPhotos(4)).rejects.toBeInstanceOf(VenueGalleryError);
    // The message the operator would actually see — proving the toast path lives
    // for real errors even though cancel no longer trips it.
    await expect(pickGalleryPhotos(4)).rejects.toMatchObject({
      message: "Couldn't open photos. Try again.",
    });
  });
});
