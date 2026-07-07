/**
 * ORCH-1321 [android-media-permission-strip] — DEAD-TAP regression (tester adversarial).
 *
 * DIFFERENT ANGLE from the two existing ORCH-1321 tests:
 *   - implementor unit  (src/utils/__tests__/orch1321AndroidMediaPermissionSkip.test.ts):
 *       mocks the permission as granted:true and only asserts the wrapper "was not
 *       called" on Android — it never drives the DOWNSTREAM launcher, so it cannot
 *       catch a dead tap.
 *   - config gate  (.github/scripts/strict-grep/orch-1321-no-android-media-permissions.mjs):
 *       asserts app.json declares no media/storage permission — config integrity only.
 *
 * This test attacks the #1 correctness risk directly: NO DEAD TAP. It simulates the
 * POST-STRIP Android reality — with READ_MEDIA_* removed from the manifest, the
 * underlying ImagePicker.requestMediaLibraryPermissionsAsync would resolve
 * granted:FALSE on Android 13+. We mock it to granted:false and drive the ACTUAL
 * consumer gate predicate (`if (!permission.granted) { bail } else { launch }`)
 * end-to-end through the REAL wrappers, proving the flow still REACHES
 * launchImageLibraryAsync (the Android Photo Picker) — i.e. the gallery button does
 * NOT dead-tap — precisely because the wrapper short-circuits to granted on Android.
 *
 * This canonical gate shape is shared by CoverPicker.ensureMediaPermission,
 * IntakeFilePickerChooserSheet, ExperienceStopPhotoSheet, TripDayMediaSheet,
 * MenuSnapInput, ActivitiesSnapInput, and BrandAvatarPickerSheet.
 *
 * FAILS-ON-REVERT: delete the `if (Platform.OS === 'android') return {granted:true}`
 * short-circuit from either wrapper → on Android the wrapper falls through to the
 * (denied) real API → the gate bails → launchImageLibraryAsync is NEVER reached →
 * the "reached_picker" assertion fails (the dead tap the fix prevents).
 *
 * iOS parity is also pinned: on iOS the real permission MUST still be requested,
 * a DENIED result MUST still block the picker, and a GRANTED result proceeds —
 * unchanged behavior (NSPhotoLibraryUsageDescription flow intact).
 */
import {
  describe,
  expect,
  test,
  beforeEach,
  jest,
} from "@jest/globals";
import { Platform } from "react-native";

import {
  requestMediaLibraryPermissionsAsync,
  launchImageLibraryAsync,
} from "../../../utils/platformImagePicker.native";
import {
  requestCoverMediaLibraryPermission,
  launchCoverImagePicker,
} from "../coverPickerDeviceMedia.native";

const mockRequestMediaLibraryPermissionsAsync = jest.fn<
  () => Promise<{ granted: boolean; canAskAgain?: boolean; status?: string }>
>();
const mockLaunchImageLibraryAsync = jest.fn<
  () => Promise<{ canceled: boolean; assets: unknown[] }>
>();

jest.mock("react-native", () => ({
  // Mutable so each test flips the platform the wrappers read at call time.
  Platform: { OS: "ios" },
}));

jest.mock("expo-image-picker", () => ({
  __esModule: true,
  requestMediaLibraryPermissionsAsync: mockRequestMediaLibraryPermissionsAsync,
  launchImageLibraryAsync: mockLaunchImageLibraryAsync,
  // launchCoverImagePicker reads this enum member — must exist on the mock.
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: "compatible" },
}));

const setPlatform = (os: string): void => {
  (Platform as unknown as { OS: string }).OS = os;
};

beforeEach(() => {
  mockRequestMediaLibraryPermissionsAsync.mockReset();
  mockLaunchImageLibraryAsync.mockReset();
  // POST-STRIP Android reality: with READ_MEDIA_* stripped from the manifest, the
  // underlying OS media-library request would resolve DENIED on Android 13+.
  mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({
    granted: false,
    canAskAgain: false,
    status: "denied",
  });
  mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] });
});

type PickOutcome = "reached_picker" | "blocked";

// Mirrors the canonical consumer gate predicate used across the gallery sites.
const runPlatformGalleryPick = async (): Promise<PickOutcome> => {
  const permission = await requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return "blocked"; // ← on Android this would be the DEAD TAP
  await launchImageLibraryAsync({ mediaTypes: ["images"] });
  return "reached_picker";
};

// Mirrors CoverPicker.ensureMediaPermission → pickImageOrGifCover → launchCoverImagePicker.
const runCoverGalleryPick = async (): Promise<PickOutcome> => {
  const permission = await requestCoverMediaLibraryPermission();
  if (!permission.granted) return "blocked";
  await launchCoverImagePicker();
  return "reached_picker";
};

describe("ORCH-1321 Android gallery pick — NO DEAD TAP after the permission strip", () => {
  test("platformImagePicker gate reaches the Photo Picker on Android despite an OS-denied media permission", async () => {
    setPlatform("android");
    const outcome = await runPlatformGalleryPick();
    expect(outcome).toBe("reached_picker");
    // The Android Photo Picker opened — the button did not dead-tap.
    expect(mockLaunchImageLibraryAsync).toHaveBeenCalledTimes(1);
    // The stripped media-library permission was never even requested.
    expect(mockRequestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  });

  test("CoverPicker cover gate reaches the Photo Picker on Android (ensureMediaPermission truthy)", async () => {
    setPlatform("android");
    const outcome = await runCoverGalleryPick();
    expect(outcome).toBe("reached_picker");
    expect(mockLaunchImageLibraryAsync).toHaveBeenCalledTimes(1);
    expect(mockRequestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe("ORCH-1321 iOS parity — real permission still gates the pick (unchanged)", () => {
  test("iOS requests the real permission and a DENIED result correctly blocks the picker", async () => {
    setPlatform("ios");
    const outcome = await runPlatformGalleryPick();
    expect(outcome).toBe("blocked"); // permission-honest: denied on iOS blocks the pick
    expect(mockRequestMediaLibraryPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockLaunchImageLibraryAsync).not.toHaveBeenCalled();
  });

  test("iOS granted → the pick proceeds to the picker", async () => {
    setPlatform("ios");
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValueOnce({
      granted: true,
      canAskAgain: true,
      status: "granted",
    });
    const outcome = await runPlatformGalleryPick();
    expect(outcome).toBe("reached_picker");
    expect(mockRequestMediaLibraryPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockLaunchImageLibraryAsync).toHaveBeenCalledTimes(1);
  });
});
