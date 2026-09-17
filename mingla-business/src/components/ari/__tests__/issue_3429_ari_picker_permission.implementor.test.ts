/**
 * #3429 REWORK-1 D-0 implementor proof.
 *
 * On iOS and Android Metro resolves `./ariAttachmentPicker` to the `.native`
 * file. The mock below reproduces exactly that resolution, so if the native
 * picker ever imports its permission error through its own platform-neutral
 * specifier again, it imports itself, the class is undefined, and a denied
 * photo permission crashes instead of producing the recovery error.
 */

const mockRequestPermission = jest.fn();
const mockLaunchLibrary = jest.fn();

jest.mock("expo-document-picker", () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));
jest.mock("../../../utils/platformImagePicker", () => ({
  requestMediaLibraryPermissionsAsync: () => mockRequestPermission(),
  launchImageLibraryAsync: (options: unknown) => mockLaunchLibrary(options),
}));
// Emulate Metro's native platform resolution of the neutral specifier.
jest.mock("../ariAttachmentPicker", () => jest.requireActual("../ariAttachmentPicker.native"));

import { pickAriAttachmentFiles } from "../ariAttachmentPicker";
import { AriAttachmentPickerPermissionError } from "../ariAttachmentPickerShared";

describe("#3429 D-0 native photo permission denial", () => {
  beforeEach(() => {
    mockRequestPermission.mockReset();
    mockLaunchLibrary.mockReset();
  });

  it("rejects with the shared permission error (openable Settings) instead of crashing", async () => {
    mockRequestPermission.mockResolvedValue({ granted: false, canAskAgain: false, status: "denied" });
    let caught: unknown = null;
    try {
      await pickAriAttachmentFiles("photos", 5);
    } catch (error: unknown) {
      caught = error;
    }
    expect(typeof AriAttachmentPickerPermissionError).toBe("function");
    expect(caught).toBeInstanceOf(AriAttachmentPickerPermissionError);
    expect((caught as AriAttachmentPickerPermissionError).canOpenSettings).toBe(true);
    expect(mockLaunchLibrary).not.toHaveBeenCalled();
  });

  it("reports canOpenSettings false while the OS can still ask again", async () => {
    mockRequestPermission.mockResolvedValue({ granted: false, canAskAgain: true, status: "undetermined" });
    await expect(pickAriAttachmentFiles("photos", 5)).rejects.toMatchObject({
      name: "AriAttachmentPickerPermissionError",
      canOpenSettings: false,
    });
  });

  it("returns picked photos with their dimensions and never a zero size", async () => {
    mockRequestPermission.mockResolvedValue({ granted: true, canAskAgain: true, status: "granted" });
    mockLaunchLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///photo.heic", fileName: "photo.heic", mimeType: "image/heic", fileSize: 0, width: 4032, height: 3024 }],
    });
    await expect(pickAriAttachmentFiles("photos", 5)).resolves.toEqual([
      { uri: "file:///photo.heic", name: "photo.heic", mimeType: "image/heic", size: null, width: 4032, height: 3024 },
    ]);
  });
});
