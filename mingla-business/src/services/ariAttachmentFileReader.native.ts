/**
 * Issue #3429 REWORK-1 (D-3) — native Ari attachment byte reader.
 *
 * React Native's `fetch(uri).blob()` serialises a local file as a tiny
 * multipart envelope, so Supabase stored 0-byte objects for every iOS
 * attachment. `expo-file-system` `File.arrayBuffer()` reads the real bytes
 * (house pattern: `brandCoverFileReader.native.ts`, ORCH-0786).
 */

import { File } from "expo-file-system";

export interface AriAttachmentByteSource {
  uri: string;
  webFile?: Blob;
}

export async function readAriAttachmentBytes(
  source: AriAttachmentByteSource,
): Promise<Uint8Array> {
  return new Uint8Array(await new File(source.uri).arrayBuffer());
}

/** Size of a local file in bytes, or null when it cannot be read. */
export async function readAriAttachmentSize(
  source: AriAttachmentByteSource,
): Promise<number | null> {
  try {
    const file = new File(source.uri);
    if (!file.exists) return null;
    return file.size > 0 ? file.size : null;
  } catch {
    return null;
  }
}

/** True while the local prepared output still exists and can be re-uploaded. */
export async function ariAttachmentSourceExists(
  source: AriAttachmentByteSource,
): Promise<boolean> {
  try {
    return new File(source.uri).exists;
  } catch {
    return false;
  }
}
