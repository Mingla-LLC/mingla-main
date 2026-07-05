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

// ORCH-1311 — read a picked video's duration ROBUSTLY.
// A gallery clip picked on Android web is a content-URI-backed File; reading its
// duration through a single `loadedmetadata` read failed on-device ("Could not
// read this video's duration") — reproduced 2/2 on the Samsung — even though the
// SAME clip's bytes report a finite duration when loaded in memory. Two failure
// modes are handled: (1) `video.duration` reports Infinity/0 until a seek forces
// the browser to compute the real value (common for many MP4 encodings); (2) the
// first metadata read misses (transient on a just-resumed tab after the OS photo
// picker) and a retry succeeds. A single attempt is capped so a stuck load never
// hangs the pick; the whole read retries once. ORCH-1308 rounding is preserved
// (INTEGER source_duration_ms/trim_end_ms — never emit a fractional ms).
const VIDEO_DURATION_ATTEMPT_TIMEOUT_MS = 6000;

const readBrowserVideoDurationOnce = (uri: string): Promise<number | null> => {
  if (typeof document === "undefined") return Promise.resolve(null);
  return new Promise<number | null>((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    const finiteMs = (): number | null =>
      Number.isFinite(video.duration) && video.duration > 0
        ? Math.round(video.duration * 1000)
        : null;
    const finish = (value: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.ondurationchange = null;
      video.ontimeupdate = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };
    const readIfReady = (): void => {
      const ms = finiteMs();
      if (ms !== null) finish(ms);
    };
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = (): void => {
      const ms = finiteMs();
      if (ms !== null) {
        finish(ms);
        return;
      }
      // Infinity/0 until seek — force the browser to resolve the real duration.
      video.ondurationchange = readIfReady;
      video.ontimeupdate = readIfReady;
      try {
        video.currentTime = Number.MAX_SAFE_INTEGER;
      } catch {
        finish(null);
      }
    };
    video.onerror = (): void => finish(null);
    const timer = setTimeout(
      () => finish(finiteMs()),
      VIDEO_DURATION_ATTEMPT_TIMEOUT_MS,
    );
    video.src = uri;
  });
};

const readBrowserVideoDurationMs = async (uri: string): Promise<number | null> => {
  const first = await readBrowserVideoDurationOnce(uri);
  if (first !== null && first > 0) return first;
  // Retry once — a just-resumed tab (post OS picker) occasionally misses the
  // first metadata read for a content-URI-backed clip.
  return readBrowserVideoDurationOnce(uri);
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
