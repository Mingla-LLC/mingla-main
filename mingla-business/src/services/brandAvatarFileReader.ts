/**
 * brandAvatarFileReader — reads a manipulated avatar file into a Uint8Array
 * via expo-file-system (RN iOS-safe).
 *
 * Mirrors `brandCoverFileReader` verbatim. Reasoning: `fetch(uri).blob()` on
 * RN iOS silently returns size-0 blobs for some content:// URIs; the
 * expo-file-system File.arrayBuffer() reads actual bytes. ORCH-0786
 * precedent.
 *
 * Per ORCH-0807 SPEC §6.2 (composition step inside `brandAvatarService`).
 */

import { File } from "expo-file-system";

import { BrandAvatarError } from "../utils/brandAvatarRules";

export interface BrandAvatarFileBytes {
  bytes: Uint8Array;
  byteLength: number;
}

const toUint8Array = (buffer: ArrayBuffer): Uint8Array => new Uint8Array(buffer);

export const readBrandAvatarFileBytes = async (
  uri: string,
): Promise<BrandAvatarFileBytes> => {
  try {
    const buffer = await new File(uri).arrayBuffer();
    const bytes = toUint8Array(buffer);
    return {
      bytes,
      byteLength: bytes.byteLength,
    };
  } catch {
    throw new BrandAvatarError(
      "upload_failed",
      "We couldn't read that file. Try another.",
    );
  }
};
