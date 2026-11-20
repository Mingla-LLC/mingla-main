/**
 * #4238 B7 — Host ads only: several videos in one pick (web). Covers for
 * events, brands and venues keep the single-file `launchCoverVideoPicker`.
 * Its own module so it loads with the ad builder's video runtime, never at boot.
 */
import { pickBrowserFiles } from "../../../utils/browserFilePicker";
import type { CoverPickerAsset } from "../../ui/coverPickerDeviceMedia";
import { readPickedVideoDurationMs } from "../../ui/pickedVideoDuration";

const AD_VIDEO_ACCEPT = "video/mp4,video/quicktime,video/x-m4v,video/webm,.mp4,.mov,.m4v,.webm";

export const launchAdVideosPicker = async (
  options: { maxFiles: number },
): Promise<{ canceled: boolean; assets: CoverPickerAsset[] }> => {
  const result = await pickBrowserFiles({
    accept: AD_VIDEO_ACCEPT,
    multiple: true,
    maxFiles: Math.max(1, options.maxFiles),
  });
  const assets = await Promise.all(
    result.files.map(async (file): Promise<CoverPickerAsset> => ({
      duration: await readPickedVideoDurationMs(file.uri),
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.mimeType,
      objectUrl: file.objectUrl,
      type: "video",
      uri: file.uri,
    })),
  );
  return { canceled: result.canceled, assets };
};
