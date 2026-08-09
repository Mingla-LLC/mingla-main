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
  fileSize: number;
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

const loadImage = (uri: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = (): void => resolve(image);
    image.onerror = (): void => reject(new Error("gif_poster_extraction_failed"));
    image.src = uri;
  });

/** Browser first-frame extraction. The selected GIF is a local blob URL, so
 * drawing it to a canvas does not depend on a provider's CORS policy. */
export const extractCoverGifPoster = async (
  input: CoverGifPosterInput,
): Promise<ExtractedCoverGifPoster> => {
  const image = await loadImage(input.uri);
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    throw new Error("gif_poster_extraction_failed");
  }
  const scale = Math.min(1, 1080 / sourceWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("gif_poster_extraction_failed");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) => value === null
        ? reject(new Error("gif_poster_extraction_failed"))
        : resolve(value),
      "image/jpeg",
      0.86,
    ),
  );
  const uri = URL.createObjectURL(blob);
  return {
    asset: {
      uri,
      mimeType: "image/jpeg",
      fileName: posterFileName(input.fileName),
      fileSize: blob.size,
    },
    cleanup: async (): Promise<void> => URL.revokeObjectURL(uri),
  };
};
