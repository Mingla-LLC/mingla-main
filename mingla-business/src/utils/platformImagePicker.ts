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
}> => ({ granted: false, canAskAgain: false, status: "denied" });

export const requestCameraPermissionsAsync = async (): Promise<{
  granted: boolean;
  canAskAgain?: boolean;
  status?: string;
}> => ({ granted: false, canAskAgain: false, status: "denied" });

export const launchImageLibraryAsync = async (
  _options: Record<string, unknown>,
): Promise<PlatformImagePickerResult> => ({ canceled: true, assets: [] });

export const launchCameraAsync = async (
  _options: Record<string, unknown>,
): Promise<PlatformImagePickerResult> => ({ canceled: true, assets: [] });
