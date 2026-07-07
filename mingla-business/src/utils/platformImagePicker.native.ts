import { Platform } from "react-native";

export type PlatformImagePickerAsset = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  duration?: number | null;
  type?: string | null;
};

export type PlatformImagePickerResult = {
  canceled: boolean;
  assets: PlatformImagePickerAsset[];
};

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
