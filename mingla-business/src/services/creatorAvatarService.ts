import { supabase } from "./supabase";
import { readCreatorAvatarFileBytes } from "./creatorAvatarFileReader";
import {
  CREATOR_AVATAR_MAX_BYTES,
  CreatorAvatarError,
  creatorAvatarStoragePath,
  extractCreatorAvatarStoragePath,
  generateCreatorAvatarPathToken,
  resolveCreatorAvatarContentType,
  verifyCreatorAvatarPublicUrl,
  type CreatorAvatarAssetInput,
  type CreatorAvatarMimeType,
} from "../utils/creatorAvatarRules";

export const CREATOR_AVATARS_BUCKET = "creator_avatars";

export interface CreatorAvatarUploadResult {
  publicUrl: string;
  storagePath: string;
  contentType: CreatorAvatarMimeType;
}

export interface CreatorAvatarUploadOptions {
  // When provided, the previously-persisted public URL is parsed for its
  // storage path and best-effort removed after the new upload verifies.
  previousPublicUrl?: string | null;
}

export const uploadCreatorAvatar = async (
  userId: string,
  input: CreatorAvatarAssetInput,
  options: CreatorAvatarUploadOptions = {},
): Promise<CreatorAvatarUploadResult> => {
  const contentType = resolveCreatorAvatarContentType(input);
  if (contentType === null) {
    throw new CreatorAvatarError(
      "unsupported_type",
      "Choose a JPEG, PNG, or WebP image.",
    );
  }

  const { bytes, byteLength } = await readCreatorAvatarFileBytes(input.uri);

  // ORCH-0786 — fetch(uri).blob() silently returns size-0 on RN iOS. expo-file-system is mandatory.
  if (byteLength <= 0) {
    throw new CreatorAvatarError(
      "empty_local_file",
      "We couldn't read that photo. Try another.",
    );
  }

  if (byteLength > CREATOR_AVATAR_MAX_BYTES) {
    throw new CreatorAvatarError("file_too_large", "Pick a photo under 10 MB.");
  }

  // Rotate the storage path on every upload — required so the public URL
  // string changes per pick and the native image cache cannot serve stale
  // bytes after a reload. See ORCH-0786 stale-cache follow-up.
  const pathToken = generateCreatorAvatarPathToken();
  const storagePath = creatorAvatarStoragePath(userId, contentType, pathToken);
  const { error: uploadError } = await supabase.storage
    .from(CREATOR_AVATARS_BUCKET)
    .upload(storagePath, bytes, {
      contentType,
      upsert: true,
    });

  if (uploadError !== null) {
    throw new CreatorAvatarError(
      "upload_failed",
      "Couldn't upload photo. Tap to try again.",
    );
  }

  const { data } = supabase.storage
    .from(CREATOR_AVATARS_BUCKET)
    .getPublicUrl(storagePath);

  await verifyCreatorAvatarPublicUrl(data.publicUrl);

  // Best-effort: drop the previous bytes once the new path is verified so
  // orphans do not accumulate. Never fail the upload on cleanup error.
  const previousPath = extractCreatorAvatarStoragePath(
    options.previousPublicUrl ?? null,
  );
  if (previousPath !== null && previousPath !== storagePath) {
    try {
      await supabase.storage
        .from(CREATOR_AVATARS_BUCKET)
        .remove([previousPath]);
    } catch {
      // ignore — orphan cleanup is non-blocking
    }
  }

  return {
    publicUrl: data.publicUrl,
    storagePath,
    contentType,
  };
};
