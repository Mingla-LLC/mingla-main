import {
  PREPARE_READ_CHUNK_BYTES,
  Sha256,
  yieldToUiThread,
} from "../services/eventCoverVideoPreparedSource.native";

/**
 * #4607 — Hermes does not expose Web Crypto. Hash in bounded chunks with the
 * app's existing pure-JS SHA-256 implementation so a maximum-size photo does
 * not monopolize the native UI thread.
 */
export async function siteMediaChecksum(bytes: Uint8Array): Promise<string> {
  const sha256 = new Sha256();
  for (let offset = 0; offset < bytes.byteLength; offset += PREPARE_READ_CHUNK_BYTES) {
    sha256.update(bytes.subarray(offset, offset + PREPARE_READ_CHUNK_BYTES));
    if (offset + PREPARE_READ_CHUNK_BYTES < bytes.byteLength) {
      await yieldToUiThread();
    }
  }
  return sha256.digest();
}
