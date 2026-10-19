/**
 * #3040 B-C13b [A-13b] — the trimmer is a keyframe stream copy, so the file it
 * writes can run up to one GOP past the window the host dragged. Measure the
 * real output with `react-native-compressor`'s `getVideoMetaData` (already in
 * every shipped binary; no new native module). Lazy, runtime-gated require so
 * the native module is never evaluated at boot (orch-1001 / orch-1296). The
 * raw value may be seconds or milliseconds by platform; the caller normalises
 * it. A failure returns null and the caller declares the trim window.
 */
declare const require: (moduleName: string) => {
  getVideoMetaData?: (filePath: string) => Promise<{ duration?: unknown }>;
};

export const measureTrimmedVideoDurationMs = async (uri: string): Promise<number | null> => {
  try {
    const { getVideoMetaData } = require("react-native-compressor");
    if (typeof getVideoMetaData !== "function") return null;
    const meta = await getVideoMetaData(uri);
    return typeof meta?.duration === "number" && Number.isFinite(meta.duration) ? meta.duration : null;
  } catch {
    return null;
  }
};
