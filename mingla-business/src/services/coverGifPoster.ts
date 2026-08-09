import * as ImageManipulator from "expo-image-manipulator";

export interface CoverGifPosterInput {
  uri: string;
  fileName?: string | null;
  width?: number | null;
  height?: number | null;
}

export interface CoverGifPosterAsset {
  uri: string;
  mimeType: "image/jpeg";
  fileName: string;
  fileSize: null;
}

export interface ExtractedCoverGifPoster {
  asset: CoverGifPosterAsset;
  cleanup: () => Promise<void>;
}

const posterFileName = (value?: string | null): string => {
  const base = typeof value === "string" && value.trim().length > 0
    ? value.trim().replace(/\.[a-z0-9]+$/i, "")
    : "cover";
  return `${base}-poster.jpg`;
};

/**
 * Decode the first visible GIF frame on-device and transcode it to a bounded
 * JPEG before any cover row is saved. A failed decode is a hard failure: an
 * animated cover without its own still must never become shareable.
 */
export const extractCoverGifPoster = async (
  input: CoverGifPosterInput,
): Promise<ExtractedCoverGifPoster> => {
  const width = typeof input.width === "number" && input.width > 1080
    ? 1080
    : undefined;
  const result = await ImageManipulator.manipulateAsync(
    input.uri,
    width === undefined ? [] : [{ resize: { width } }],
    { compress: 0.86, format: ImageManipulator.SaveFormat.JPEG },
  );
  if (!result.uri) throw new Error("gif_poster_extraction_failed");
  return {
    asset: {
      uri: result.uri,
      mimeType: "image/jpeg",
      fileName: posterFileName(input.fileName),
      fileSize: null,
    },
    cleanup: async (): Promise<void> => {
      try {
        const FileSystem = await import("expo-file-system/legacy");
        await FileSystem.deleteAsync(result.uri, { idempotent: true });
      } catch {
        // Cache cleanup is best-effort and must not change a completed upload.
      }
    },
  };
};
