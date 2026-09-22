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

jest.mock("../../ui/Sheet", () => ({ Sheet: ({ children }: { children: unknown }) => children }));
jest.mock("lucide-react-native", () => ({ FileText: () => null, Image: () => null }));
// The sheet + dialog primitives own the real unmount windows; this runner cannot
// load them (expo-blur ships ESM), so stand in for the two constants only. Their
// real values are already guarded by deferAfterDismiss.derivation.tester.
jest.mock("../../ui/SheetMobile", () => ({ UNMOUNT_DELAY_MS: 280 }));
jest.mock("../../ui/Modal", () => ({ UNMOUNT_DELAY_MS: 200 }));

import { Platform } from "react-native";

import { AriAttachmentSourceSheet } from "../AriAttachmentSourceSheet";
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

/**
 * #3429 REWORK-1 D-0 runtime follow-on, proved on ISSUE3429-Host-Large
 * (2026-09-17): tapping "Choose photos" opened the PHPicker scene and iOS tore
 * it straight back down 0.26s later, because the add-context sheet closed its
 * own native modal in the same tick. iOS presents one modal at a time, so the
 * picker has to wait for the sheet's dismissal window (the house pattern from
 * #1360 / #1338). Nothing was attachable on iOS before this.
 */
describe("#3429 add-context sheet opens the picker after its own dismissal", () => {
  const rows = (
    node: unknown,
    found: Record<string, () => void> = {},
  ): Record<string, () => void> => {
    if (Array.isArray(node)) {
      for (const child of node) rows(child, found);
      return found;
    }
    if (typeof node !== "object" || node === null) return found;
    const element = node as { props?: Record<string, unknown> };
    const props = element.props;
    if (props) {
      const label = props.accessibilityLabel;
      if (typeof label === "string" && typeof props.onPress === "function") {
        found[label] = props.onPress as () => void;
      }
      if (props.children !== undefined) rows(props.children, found);
    }
    return found;
  };

  it("waits out the sheet's unmount window before launching each picker", () => {
    jest.useFakeTimers();
    try {
      const platform = Platform as unknown as { OS: string };
      const previous = platform.OS;
      platform.OS = "ios";
      const onClose = jest.fn();
      const onSelect = jest.fn();
      const tree = AriAttachmentSourceSheet({ visible: true, onClose, onSelect });
      platform.OS = previous;
      const press = rows(tree);
      expect(Object.keys(press).sort()).toEqual(["Choose documents", "Choose photos"]);

      press["Choose photos"]();
      expect(onClose).toHaveBeenCalledTimes(1);
      // Same tick: the sheet's own modal is still on screen, so no picker yet.
      expect(onSelect).not.toHaveBeenCalled();
      jest.advanceTimersByTime(0);
      expect(onSelect).not.toHaveBeenCalled();
      jest.runOnlyPendingTimers();
      expect(onSelect).toHaveBeenCalledWith("photos");

      press["Choose documents"]();
      expect(onSelect).toHaveBeenCalledTimes(1);
      jest.runOnlyPendingTimers();
      expect(onSelect).toHaveBeenLastCalledWith("documents");
    } finally {
      jest.useRealTimers();
    }
  });
});
