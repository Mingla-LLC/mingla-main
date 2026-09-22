/**
 * Issue #3429 REWORK-1 (D-3) — web Ari attachment byte reader.
 *
 * The browser always holds the chosen or prepared file as a Blob, so the
 * upload body is that Blob's exact bytes. `fetch(uri)` is never used.
 */

export interface AriAttachmentByteSource {
  uri: string;
  webFile?: Blob;
}

export async function readAriAttachmentBytes(
  source: AriAttachmentByteSource,
): Promise<Uint8Array> {
  if (!source.webFile) throw new Error("ari_attachment_web_file_missing");
  return new Uint8Array(await source.webFile.arrayBuffer());
}

export async function readAriAttachmentSize(
  source: AriAttachmentByteSource,
): Promise<number | null> {
  return source.webFile && source.webFile.size > 0 ? source.webFile.size : null;
}

export async function ariAttachmentSourceExists(
  source: AriAttachmentByteSource,
): Promise<boolean> {
  return !!source.webFile;
}
