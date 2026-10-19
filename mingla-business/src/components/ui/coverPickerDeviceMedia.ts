import {
  pickBrowserFiles,
  revokeBrowserPickedFiles,
  type BrowserPickedFile,
} from "../../utils/browserFilePicker";
import { readPickedVideoDurationMs } from "./pickedVideoDuration";

export type CoverPickerAsset = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  duration?: number | null;
  type?: string | null;
  objectUrl?: string | null;
};

type CoverPickerResult = {
  canceled: boolean;
  assets: CoverPickerAsset[];
};

const COVER_VIDEO_PICKER_OPTIONS = {
  accept: "video/mp4,video/quicktime,video/x-m4v,video/webm,.mp4,.mov,.m4v,.webm",
  maxFiles: 1,
} as const;

export const requestCoverMediaLibraryPermission = async (): Promise<{
  granted: boolean;
}> => ({ granted: typeof document !== "undefined" });

const toCoverAsset = (
  picked: BrowserPickedFile,
  extras: Partial<CoverPickerAsset> = {},
): CoverPickerAsset => ({
  duration: null,
  fileName: picked.name,
  fileSize: picked.size,
  mimeType: picked.mimeType,
  objectUrl: picked.objectUrl,
  type: picked.mimeType?.startsWith("video/") ? "video" : "image",
  uri: picked.uri,
  ...extras,
});

const readBrowserVideoDurationMs = async (
  uri: string,
): Promise<number | null> => {
  return await readPickedVideoDurationMs(uri);
};

/** Shared by other browser video pickers that use the canonical Bunny lane. */
export { readPickedVideoDurationMs } from "./pickedVideoDuration";

export const launchCoverImagePicker = async (): Promise<CoverPickerResult> => {
  const result = await pickBrowserFiles({
    accept: "image/jpeg,image/png,image/webp,image/gif",
    maxFiles: 1,
  });
  return {
    canceled: result.canceled,
    assets: result.files.map((file) => toCoverAsset(file)),
  };
};

export const launchCoverVideoPicker = async (
  options: {
    /**
     * #3040 B-C18 [A-21] — the file chooser closed with a file and its
     * duration is now being read: show design H-05 ("Reading video…") at once
     * instead of up to 8 s of silence.
     */
    onFileChosen?: () => void;
  } = {},
): Promise<CoverPickerResult> => {
  const result = await pickBrowserFiles(COVER_VIDEO_PICKER_OPTIONS);
  if (!result.canceled && result.files.length > 0) options.onFileChosen?.();
  const assets = await Promise.all(
    result.files.map(async (file) =>
      toCoverAsset(file, {
        duration: await readBrowserVideoDurationMs(file.uri),
        type: "video",
      }),
    ),
  );
  return {
    canceled: result.canceled,
    assets,
  };
};

export const revokeCoverPickedAssets = (assets: readonly CoverPickerAsset[]): void => {
  revokeBrowserPickedFiles(
    assets
      .filter((asset) => asset.objectUrl !== undefined)
      .map((asset) => ({ objectUrl: asset.objectUrl ?? null })),
  );
};
