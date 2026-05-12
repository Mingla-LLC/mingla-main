/**
 * useBrandCoverUpload — mutation that (a) uploads a device file OR validates
 * a Pexels/Giphy URL, and (b) patches `brands.cover_media_url` +
 * `brands.cover_media_type` via the existing `useUpdateBrand` optimistic
 * mutation.
 *
 * Composition rather than reinvention: the cover-specific work happens in
 * `brandCoverService` (upload + URL validation); the DB write reuses
 * `useUpdateBrand` so the optimistic cache invalidation contract already
 * proven for brand edits is honored here too.
 *
 * Per ORCH-0805 SPEC §7.1.
 */

import { useCallback, useState } from "react";

import {
  BRAND_COVERS_BUCKET,
  coverFromProviderRef,
  uploadBrandCover,
} from "../services/brandCoverService";
import {
  BrandCoverError,
  type BrandCoverAssetInput,
  type BrandCoverMediaType,
  type BrandCoverProviderRef,
} from "../utils/brandCoverRules";
import { useUpdateBrand } from "./useBrands";

export type BrandCoverUploadSource =
  | { kind: "upload"; asset: BrandCoverAssetInput }
  | { kind: "provider"; ref: BrandCoverProviderRef };

export interface BrandCoverUploadInput {
  brandId: string;
  accountId: string;
  existingDescription: string | null;
  previousMediaUrl: string | null;
  source: BrandCoverUploadSource;
}

export interface BrandCoverUploadResult {
  publicUrl: string;
  mediaType: BrandCoverMediaType;
}

export interface UseBrandCoverUploadResult {
  uploadCover: (input: BrandCoverUploadInput) => Promise<BrandCoverUploadResult>;
  isUploading: boolean;
  error: BrandCoverError | null;
  /** Resets the local error state. Useful when the user retries. */
  clearError: () => void;
}

const toBrandCoverError = (error: unknown): BrandCoverError => {
  if (error instanceof BrandCoverError) return error;
  if (error instanceof Error) {
    return new BrandCoverError("upload_failed", error.message);
  }
  return new BrandCoverError(
    "upload_failed",
    "Couldn't save cover. Tap to try again.",
  );
};

export const useBrandCoverUpload = (): UseBrandCoverUploadResult => {
  const updateBrand = useUpdateBrand();
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [error, setError] = useState<BrandCoverError | null>(null);

  const uploadCover = useCallback(
    async (input: BrandCoverUploadInput): Promise<BrandCoverUploadResult> => {
      setIsUploading(true);
      setError(null);
      try {
        let publicUrl: string;
        let mediaType: BrandCoverMediaType;

        if (input.source.kind === "upload") {
          const result = await uploadBrandCover(
            input.brandId,
            input.source.asset,
            { previousPublicUrl: input.previousMediaUrl },
          );
          publicUrl = result.publicUrl;
          mediaType = result.mediaType;
        } else if (input.source.kind === "provider") {
          const result = coverFromProviderRef(input.source.ref);
          publicUrl = result.publicUrl;
          mediaType = result.mediaType;
        } else {
          // Exhaustive guard
          const _exhaustive: never = input.source;
          void _exhaustive;
          throw new BrandCoverError(
            "upload_failed",
            "Unknown cover source.",
          );
        }

        await updateBrand.mutateAsync({
          brandId: input.brandId,
          accountId: input.accountId,
          existingDescription: input.existingDescription,
          patch: {
            coverMediaUrl: publicUrl,
            coverMediaType: mediaType === "image" ? "image" : "gif",
          },
        });

        return { publicUrl, mediaType };
      } catch (err) {
        const wrapped = toBrandCoverError(err);
        setError(wrapped);
        throw wrapped;
      } finally {
        setIsUploading(false);
      }
    },
    [updateBrand],
  );

  const clearError = useCallback((): void => setError(null), []);

  return { uploadCover, isUploading, error, clearError };
};

/** Re-export the bucket constant so consumers don't have to import from
 * the service layer directly. */
export { BRAND_COVERS_BUCKET };
