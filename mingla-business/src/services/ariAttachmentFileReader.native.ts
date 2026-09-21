/**
 * Issue #3429 REWORK-1 (D-3) — native Ari attachment byte reader.
 *
 * React Native's `fetch(uri).blob()` serialises a local file as a tiny
 * multipart envelope, so Supabase stored 0-byte objects for every iOS
 * attachment. `expo-file-system` `File.arrayBuffer()` reads the real bytes
 * (house pattern: `brandCoverFileReader.native.ts`, ORCH-0786).
 *
 * ORCH-1296 — the new `File` API is imported LAZILY, inside each function that
 * needs it, never at module scope. A top-level import is evaluated at BOOT, and
 * if the native side of the module is missing or mismatched it throws before the
 * first frame — the splash brick this gate exists to stop, which an OTA update
 * can ship to every installed app. House lazy pattern:
 * `eventCoverVideoTusPatch.native.ts`.
 */

export interface AriAttachmentByteSource {
  uri: string;
  webFile?: Blob;
}

export async function readAriAttachmentBytes(
  source: AriAttachmentByteSource,
): Promise<Uint8Array> {
  const { File } = await import("expo-file-system");
  return new Uint8Array(await new File(source.uri).arrayBuffer());
}

/** Size of a local file in bytes, or null when it cannot be read. */
export async function readAriAttachmentSize(
  source: AriAttachmentByteSource,
): Promise<number | null> {
  try {
    const { File } = await import("expo-file-system");
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
    const { File } = await import("expo-file-system");
    return new File(source.uri).exists;
  } catch {
    return false;
  }
}
