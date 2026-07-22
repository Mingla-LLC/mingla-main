/**
 * #1063 [picker-cancel-guard] — venue gallery cancel guard regression test.
 *
 * PROVES: when the native photo picker is dismissed, expo-image-picker v17
 * resolves `{ canceled: true, assets: null }`, and the venue-gallery native
 * media handler (`launchGalleryImagePicker`) must return SILENTLY —
 * `{ canceled: true, assets: [] }` — with NO throw. The throw is exactly what
 * `venueGalleryService.pickGalleryPhotos` catches and turns into the false
 * "Couldn't open photos. Try again." toast that fired on every Cancel.
 *
 * FAILS-ON-REVERT: delete the `if (result.canceled) return { canceled: true,
 * assets: [] }` guard in `venueGalleryDeviceMedia.native.ts` and the handler
 * falls through to `result.assets.map(...)` on `null` → a TypeError is thrown →
 * the first test below rejects instead of resolving and FAILS.
 *
 * The handler is the NATIVE split, so this test imports `venueGalleryDeviceMedia.native`
 * explicitly (bare `../venueGalleryDeviceMedia` resolves to the WEB `.ts` under
 * jest's node env) and mocks the `platformImagePicker` shim to return the exact
 * shapes expo produces on cancel vs a successful pick.
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

// expo-image-picker v17's real discriminated union: assets is `null` on cancel.
type MockPickerResult =
  | { canceled: true; assets: null }
  | { canceled: false; assets: PickedAsset[] };

const mockLaunchImageLibraryAsync =
  jest.fn<(options: Record<string, unknown>) => Promise<MockPickerResult>>();

jest.mock("../../utils/platformImagePicker", () => ({
  __esModule: true,
  launchImageLibraryAsync: mockLaunchImageLibraryAsync,
}));

// Imported AFTER the mock is registered; the `.native` suffix forces the native
// split (the file under test) rather than the web `.ts`.
import { launchGalleryImagePicker } from "../venueGalleryDeviceMedia.native";

beforeEach(() => {
  mockLaunchImageLibraryAsync.mockReset();
});

describe("#1063 venue gallery native picker — cancel returns silently", () => {
  test("Cancel (`{ canceled: true, assets: null }`) resolves silently, no throw, no `.map()` on null", async () => {
    // The exact shape expo-image-picker v17 hands back when the operator taps Cancel.
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });

    // Must RESOLVE (not reject) — a rejection is what surfaced the false toast.
    await expect(launchGalleryImagePicker(4)).resolves.toEqual({
      canceled: true,
      assets: [],
    });
  });

  test("a successful pick still maps the selected assets (happy path unchanged)", async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: "file:///photos/a.jpg",
          mimeType: "image/jpeg",
          fileName: "a.jpg",
          fileSize: 1234,
          duration: null,
          type: "image",
        },
      ],
    });

    const result = await launchGalleryImagePicker(4);

    expect(result.canceled).toBe(false);
    expect(result.assets).toEqual([
      {
        uri: "file:///photos/a.jpg",
        mimeType: "image/jpeg",
        fileName: "a.jpg",
        fileSize: 1234,
      },
    ]);
  });
});
