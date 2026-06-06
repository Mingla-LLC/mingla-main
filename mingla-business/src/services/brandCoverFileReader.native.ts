/**
 * brandCoverFileReader — reads the chosen device file into a Uint8Array via
 * expo-file-system (RN iOS-safe).
 *
 * Why expo-file-system instead of `fetch(uri).blob()`? Per ORCH-0786 — the
 * RN iOS implementation of `fetch(uri).blob()` silently returns a size-0
 * blob for some content:// URIs, surfacing as "empty upload" minutes later
 * with no actionable error. expo-file-system's `File.arrayBuffer()` reads
 * actual bytes.
 *
 * Per ORCH-0805 SPEC §6.2.
 */

import { File } from "expo-file-system";

import { BrandCoverError } from "../utils/brandCoverRules";

export interface BrandCoverFileBytes {
  bytes: Uint8Array;
  byteLength: number;
}

const toUint8Array = (buffer: ArrayBuffer): Uint8Array => new Uint8Array(buffer);

export const readBrandCoverFileBytes = async (
  uri: string,
): Promise<BrandCoverFileBytes> => {
  try {
    const buffer = await new File(uri).arrayBuffer();
    const bytes = toUint8Array(buffer);
    return {
      bytes,
      byteLength: bytes.byteLength,
    };
  } catch {
    throw new BrandCoverError(
      "upload_failed",
      "We couldn't read that file. Try another.",
    );
  }
};
