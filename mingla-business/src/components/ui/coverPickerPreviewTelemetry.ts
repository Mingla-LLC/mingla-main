/**
 * #3040 B-C16 [A-16] — telemetry for a player error on the SAVED cover
 * (design H-16): `cover_preview_render_error {mediaType, host, guidPresent}`.
 * The underlying cause was inconclusive in the investigation (deleted asset,
 * missing rendition, stale player cache, network); this event is how the live
 * matrix measures which. No URL, no guid, no user data — the host name and
 * whether the path carries a provider guid only.
 */
import { reportNonFatal } from "../../diagnostics/reportNonFatal";

export const describePreviewFailure = (
  mediaUrl: string,
  mediaType: string | null | undefined,
): { mediaType: string; host: string; guidPresent: boolean } => {
  let host = "unknown";
  try {
    host = new URL(mediaUrl).host;
  } catch {
    // Not an absolute URL (a local file, a blob) — the host stays unknown.
  }
  return {
    mediaType: mediaType ?? "unknown",
    host,
    guidPresent: /\/[A-Za-z0-9-]{8,128}\//.test(mediaUrl),
  };
};

export const reportCoverPreviewRenderError = (
  mediaUrl: string,
  mediaType: string | null | undefined,
): void => {
  reportNonFatal(
    "coverPicker.previewRenderError",
    new Error("cover_preview_render_error"),
    describePreviewFailure(mediaUrl, mediaType),
  );
};
