/**
 * ORCH-1321 [android-media-permission-strip] —
 * I-PROPOSED-1321-NO-ANDROID-MEDIA-PERMISSIONS (runtime proof).
 *
 * Google Play rejected the BUSINESS app under the Photo & Video Permissions
 * policy. The fix strips READ_MEDIA_* / READ_EXTERNAL_STORAGE from the manifest
 * and routes the gallery pick through the Android Photo Picker, which needs no
 * permission. So each media-library permission wrapper MUST short-circuit on
 * Android (return granted:true WITHOUT calling the underlying expo-image-picker
 * requestMediaLibraryPermissionsAsync) while iOS STILL requests the permission.
 *
 * FAILS-ON-REVERT: delete the `if (Platform.OS === 'android') return {granted:true}`
 * short-circuit from either wrapper and its Android "was-not-called" assertion
 * fails (the wrapper would fall through to the real ImagePicker call).
 */
import {
  describe,
  expect,
  test,
  beforeEach,
  jest,
} from "@jest/globals";
import { Platform } from "react-native";

import { requestMediaLibraryPermissionsAsync } from "../platformImagePicker.native";
import { requestCoverMediaLibraryPermission } from "../../components/ui/coverPickerDeviceMedia.native";

const mockRequestMediaLibraryPermissionsAsync = jest.fn<
  () => Promise<{ granted: boolean; canAskAgain?: boolean; status?: string }>
>();

jest.mock("react-native", () => ({
  // Mutable so each test can flip the platform the wrappers read at call time.
  Platform: { OS: "ios" },
}));

jest.mock("expo-image-picker", () => ({
  __esModule: true,
  requestMediaLibraryPermissionsAsync: mockRequestMediaLibraryPermissionsAsync,
}));

const setPlatform = (os: string): void => {
  (Platform as unknown as { OS: string }).OS = os;
};

beforeEach(() => {
  mockRequestMediaLibraryPermissionsAsync.mockReset();
  mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({
    granted: true,
    canAskAgain: true,
    status: "granted",
  });
});

describe("ORCH-1321 platformImagePicker.native requestMediaLibraryPermissionsAsync", () => {
  test("Android returns granted WITHOUT calling ImagePicker (Photo Picker needs no permission)", async () => {
    setPlatform("android");
    const result = await requestMediaLibraryPermissionsAsync();
    expect(result.granted).toBe(true);
    expect(mockRequestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  });

  test("iOS DOES call ImagePicker.requestMediaLibraryPermissionsAsync", async () => {
    setPlatform("ios");
    await requestMediaLibraryPermissionsAsync();
    expect(mockRequestMediaLibraryPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});

describe("ORCH-1321 coverPickerDeviceMedia.native requestCoverMediaLibraryPermission", () => {
  test("Android returns granted WITHOUT calling ImagePicker", async () => {
    setPlatform("android");
    const result = await requestCoverMediaLibraryPermission();
    expect(result.granted).toBe(true);
    expect(mockRequestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
  });

  test("iOS DOES call ImagePicker.requestMediaLibraryPermissionsAsync", async () => {
    setPlatform("ios");
    await requestCoverMediaLibraryPermission();
    expect(mockRequestMediaLibraryPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});
