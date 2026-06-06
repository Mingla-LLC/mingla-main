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

export const requestCoverMediaLibraryPermission = async (): Promise<{
  granted: boolean;
}> => {
  const ImagePicker = await import("expo-image-picker");
  return ImagePicker.requestMediaLibraryPermissionsAsync();
};

export const launchCoverImagePicker = async (): Promise<CoverPickerResult> => {
  const ImagePicker = await import("expo-image-picker");
  return ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: false,
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    quality: 1,
  });
};

export const launchCoverVideoPicker = async (): Promise<CoverPickerResult> => {
  const ImagePicker = await import("expo-image-picker");
  return ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["videos"],
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    quality: 1,
  });
};
