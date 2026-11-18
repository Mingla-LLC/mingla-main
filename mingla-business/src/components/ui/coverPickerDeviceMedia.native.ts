import { Platform } from "react-native";
export { readPickedVideoDurationMs } from "./pickedVideoDuration";

type CoverPickerAsset = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  duration?: number | null;
  type?: string | null;
};

type CoverPickerResult = {
  canceled: boolean;
  assets: CoverPickerAsset[];
};

const normalizePickerResult = (result: {
  canceled: boolean;
  assets?: CoverPickerAsset[] | null;
}): CoverPickerResult => ({
  canceled: result.canceled,
  assets: result.assets ?? [],
});

export const requestCoverMediaLibraryPermission = async (): Promise<{
  granted: boolean;
}> => {
  // [ORCH-1321] Android uses the system Photo Picker (launchImageLibraryAsync) which needs no permission.
  if (Platform.OS === "android") {
    return { granted: true };
  }
  const ImagePicker = await import("expo-image-picker");
  return ImagePicker.requestMediaLibraryPermissionsAsync();
};

export const launchCoverImagePicker = async (): Promise<CoverPickerResult> => {
  const ImagePicker = await import("expo-image-picker");
  return normalizePickerResult(await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: false,
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    quality: 1,
  }));
};

export const launchCoverVideoPicker = async (
  // #3040 B-C18 — web-only hook (the native picker returns the duration).
  _options: { onFileChosen?: () => void } = {},
): Promise<CoverPickerResult> => {
  const ImagePicker = await import("expo-image-picker");
  return normalizePickerResult(await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["videos"],
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    quality: 1,
  }));
};

/**
 * #4238 B7 — Host ads only: several videos in one pick (iOS 14+ and the
 * Android photo picker), capped at the room left in the ad.
 */
export const launchAdVideosPicker = async (
  options: { maxFiles: number },
): Promise<CoverPickerResult> => {
  const ImagePicker = await import("expo-image-picker");
  return normalizePickerResult(await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["videos"],
    allowsMultipleSelection: true,
    selectionLimit: Math.max(1, options.maxFiles),
    orderedSelection: true,
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    quality: 1,
  }));
};

export const revokeCoverPickedAssets =(_assets: readonly CoverPickerAsset[]): void => {};
