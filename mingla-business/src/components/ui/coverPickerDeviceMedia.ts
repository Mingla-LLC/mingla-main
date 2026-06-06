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
}> => ({ granted: false });

export const launchCoverImagePicker = async (): Promise<CoverPickerResult> => ({
  canceled: true,
  assets: [],
});

export const launchCoverVideoPicker = async (): Promise<CoverPickerResult> => ({
  canceled: true,
  assets: [],
});
