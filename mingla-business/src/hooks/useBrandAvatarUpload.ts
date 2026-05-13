/**
 * useBrandAvatarUpload — mutation that (a) uploads a device-picked photo
 * through the manipulator-driven square pipeline in `brandAvatarService`,
 * and (b) patches `brands.profile_photo_url` + `brands.profile_photo_type`
 * via the existing `useUpdateBrand` optimistic mutation.
 *
 * Composition pattern lifted verbatim from `useBrandCoverUpload` (ORCH-0805)
 * with simpler input shape — single device source, no Pexels/Giphy provider
 * variant, no media-type branching (avatars are always `"image"`).
 *
 * Per ORCH-0807 SPEC §6.3.
 */

import { useCallback, useState } from "react";

import {
  BRAND_AVATARS_BUCKET,
  uploadBrandAvatar,
} from "../services/brandAvatarService";
import {
  BrandAvatarError,
  type BrandAvatarAssetInput,
} from "../utils/brandAvatarRules";
import { useUpdateBrand } from "./useBrands";

export interface BrandAvatarUploadInput {
  brandId: string;
  accountId: string;
  existingDescription: string | null;
  previousPhotoUrl: string | null;
  asset: BrandAvatarAssetInput;
}

export interface BrandAvatarUploadResult {
  publicUrl: string;
}

export interface UseBrandAvatarUploadResult {
  uploadAvatar: (
    input: BrandAvatarUploadInput,
  ) => Promise<BrandAvatarUploadResult>;
  isUploading: boolean;
  error: BrandAvatarError | null;
  /** Resets the local error state. Useful when the user retries. */
  clearError: () => void;
}

const toBrandAvatarError = (error: unknown): BrandAvatarError => {
  if (error instanceof BrandAvatarError) return error;
  if (error instanceof Error) {
    return new BrandAvatarError("upload_failed", error.message);
  }
  return new BrandAvatarError(
    "upload_failed",
    "Couldn't save photo. Tap to try again.",
  );
};

export const useBrandAvatarUpload = (): UseBrandAvatarUploadResult => {
  const updateBrand = useUpdateBrand();
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [error, setError] = useState<BrandAvatarError | null>(null);

  const uploadAvatar = useCallback(
    async (
      input: BrandAvatarUploadInput,
    ): Promise<BrandAvatarUploadResult> => {
      setIsUploading(true);
      setError(null);
      try {
        const result = await uploadBrandAvatar(
          input.brandId,
          input.asset,
          { previousPublicUrl: input.previousPhotoUrl },
        );

        await updateBrand.mutateAsync({
          brandId: input.brandId,
          accountId: input.accountId,
          existingDescription: input.existingDescription,
          patch: {
            photo: result.publicUrl,
            profilePhotoType: "image",
          },
        });

        return { publicUrl: result.publicUrl };
      } catch (err) {
        const wrapped = toBrandAvatarError(err);
        setError(wrapped);
        throw wrapped;
      } finally {
        setIsUploading(false);
      }
    },
    [updateBrand],
  );

  const clearError = useCallback((): void => setError(null), []);

  return { uploadAvatar, isUploading, error, clearError };
};

/** Re-export the bucket constant so consumers don't have to import from
 * the service layer directly. */
export { BRAND_AVATARS_BUCKET };
