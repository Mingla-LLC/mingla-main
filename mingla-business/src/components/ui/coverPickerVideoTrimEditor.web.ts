/**
 * ORCH-1001 [Business web white-page crash] — web stub for the native-only
 * video trim editor.
 *
 * The web build has no native VideoTrim TurboModule, so importing
 * `react-native-video-trim` here would crash the whole bundle at eval time
 * (see coverPickerVideoTrimEditor.native.ts). Metro resolves THIS file for the
 * web export, keeping the native package out of the web bundle entirely.
 *
 * The caller never invokes this on web — it gates on `Platform.OS !== "web"`
 * and falls back to uploading the raw clip, which the server (Cloudinary)
 * trims/compresses to a browser-safe <=29s MP4. This no-op exists only to
 * satisfy the shared import contract and resolves to `null` (no trim applied).
 */
import type { VideoTrimFinishPayload } from "./coverPickerVideoTrimUpload";

export const trimVideoWithDedicatedEditor = (
  _uri: string,
  _maxDurationMs: number,
): Promise<VideoTrimFinishPayload | null> => Promise.resolve(null);
