import { File } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";

// ORCH-1295 — native TUS PATCH transport for the Bunny cover-video upload.
//
// TWO native footguns are avoided here:
//   1. expo-file-system's BINARY_CONTENT upload task (the prior transport) does
//      NOT forward the TUS `Upload-Offset` header → Bunny rejected the PATCH with
//      400 ("Video upload failed (400)").
//   2. `fetch(uri).blob()` silently returns a size-0 Blob on RN iOS (ORCH-0786),
//      so reading the clip that way would upload an empty body.
//
// So the bytes are read with expo-file-system's `File` API (native-reliable) and
// streamed with `expo/fetch` — a native fetch that sends the TUS headers
// (`Upload-Offset` / `Tus-Resumable` / `Content-Type: application/offset+octet-stream`)
// VERBATIM → Bunny 204. Native-module access is isolated in this `*.native.ts`
// file so Metro never bundles expo-file-system / expo/fetch into the web bundle
// (the web PATCH is driven by XHR; see eventCoverVideoTusPatch.ts for the stub).

export interface NativeTusPatchResult {
  status: number;
  bodyText: string;
}

// Reliable native byte read (replaces the iOS-empty fetch-blob). Cover videos are
// compressed to <=25 MB before upload, so reading the whole clip is acceptable.
// `File.bytes()` yields a concrete `Uint8Array<ArrayBuffer>` (a valid `BodyInit`).
export const readEventCoverVideoBytes = async (
  uri: string,
): Promise<Uint8Array<ArrayBuffer>> => new File(uri).bytes();

// Single-shot TUS PATCH of the raw bytes via expo/fetch (headers verbatim).
export const patchBunnyTusNative = async (input: {
  url: string;
  body: Uint8Array<ArrayBuffer>;
  headers: Record<string, string>;
  signal?: AbortSignal;
}): Promise<NativeTusPatchResult> => {
  const response = await expoFetch(input.url, {
    body: input.body,
    headers: input.headers,
    method: "PATCH",
    signal: input.signal,
  });
  return { status: response.status, bodyText: await response.text() };
};
