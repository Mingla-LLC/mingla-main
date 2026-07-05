import {
  pickBrowserFiles,
  revokeBrowserPickedFiles,
  type BrowserPickedFile,
} from "../../utils/browserFilePicker";

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

const readBrowserVideoDurationMs = async (uri: string): Promise<number | null> => {
  if (typeof document === "undefined") return null;
  return new Promise<number | null>((resolve) => {
    const video = document.createElement("video");
    const cleanup = (): void => {
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    };
    video.preload = "metadata";
    video.onloadedmetadata = (): void => {
      // ORCH-1308: `video.duration` is FRACTIONAL seconds, so `* 1000` yields a
      // non-integer ms (e.g. 17.971995 → 17971.995). source_duration_ms /
      // trim_end_ms are INTEGER columns — a fractional value makes the upload
      // intent INSERT fail ("invalid input syntax for type integer"). Round at
      // the read so a whole-millisecond duration flows through the whole path.
      const duration = Number.isFinite(video.duration)
        ? Math.round(video.duration * 1000)
        : null;
      cleanup();
      resolve(duration);
    };
    video.onerror = (): void => {
      cleanup();
      resolve(null);
    };
    video.src = uri;
  });
};

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

export const launchCoverVideoPicker = async (): Promise<CoverPickerResult> => {
  const result = await pickBrowserFiles({
    accept: "video/mp4,video/quicktime,video/*",
    maxFiles: 1,
  });
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
