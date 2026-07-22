import { Platform } from "react-native";

export type PlatformImagePickerAsset = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  duration?: number | null;
  type?: string | null;
};

// #1063: expo-image-picker v17 returns a DISCRIMINATED UNION — on cancel it
// resolves `{ canceled: true, assets: null }`; only a successful pick carries the
// assets array (see node_modules/expo-image-picker `ImagePickerResult`:
// `ImagePickerSuccessResult | ImagePickerCanceledResult`, whose JSDoc states
// "the `assets` is always `null`" on cancel). The old shape declared `assets` as
// an always-present array, which lied about the cancel case and let callers do an
// unguarded `assets.map()` that throws on every cancel. The native shim now
// mirrors expo's real shape so callers MUST narrow on `canceled` first.
export type PlatformImagePickerResult =
  | { canceled: true; assets: null }
  | { canceled: false; assets: PlatformImagePickerAsset[] };

export const requestMediaLibraryPermissionsAsync = async (): Promise<{
  granted: boolean;
  canAskAgain?: boolean;
  status?: string;
}> => {
  // [ORCH-1321] Android uses the system Photo Picker (launchImageLibraryAsync) which needs no permission.
  if (Platform.OS === "android") {
    return { granted: true, canAskAgain: true, status: "granted" };
  }
  const ImagePicker = await import("expo-image-picker");
  return ImagePicker.requestMediaLibraryPermissionsAsync();
};

export const requestCameraPermissionsAsync = async (): Promise<{
  granted: boolean;
  canAskAgain?: boolean;
  status?: string;
}> => {
  const ImagePicker = await import("expo-image-picker");
  return ImagePicker.requestCameraPermissionsAsync();
};

export const launchImageLibraryAsync = async (
  options: Record<string, unknown>,
): Promise<PlatformImagePickerResult> => {
  const ImagePicker = await import("expo-image-picker");
  return ImagePicker.launchImageLibraryAsync(options);
};

export const launchCameraAsync = async (
  options: Record<string, unknown>,
): Promise<PlatformImagePickerResult> => {
  const ImagePicker = await import("expo-image-picker");
  return ImagePicker.launchCameraAsync(options);
};
