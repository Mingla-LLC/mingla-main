/**
 * #4238 B7 — Host ads only: several videos in one pick (iOS 14+ and the
 * Android photo picker), capped at the room left in the ad.
 */
import type { CoverPickerAsset } from "../../ui/coverPickerDeviceMedia";

export const launchAdVideosPicker = async (
  options: { maxFiles: number },
): Promise<{ canceled: boolean; assets: CoverPickerAsset[] }> => {
  const ImagePicker = await import("expo-image-picker");
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["videos"],
    allowsMultipleSelection: true,
    selectionLimit: Math.max(1, options.maxFiles),
    orderedSelection: true,
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    quality: 1,
  });
  return { canceled: result.canceled, assets: (result.assets ?? []) as CoverPickerAsset[] };
};
