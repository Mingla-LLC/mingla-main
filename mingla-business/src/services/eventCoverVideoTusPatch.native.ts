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
// VERBATIM → Bunny 204.
//
// ORCH-1296 — the `expo-file-system` (new `File` API) and `expo/fetch` imports are
// LAZY (`await import(...)` INSIDE the functions), never top-level. Expo Router
// eagerly require()s the whole `app/` route tree at startup (native, asyncRoutes
// off), and the venue/experience routes transitively import CoverPicker → the
// cover-video service → this module. A TOP-LEVEL native import here would
// therefore EVALUATE during boot — before the native modules are fully
// registered — and throw → splash brick. (It only bricks over-the-air: a native
// build compiles the modules in and boots fine; the OTA runs new native-touching
// JS on the already-installed core.) Requiring this module at boot must only
// DEFINE functions; native is touched solely when a video actually uploads.
// Mirrors the codebase's proven lazy pattern (platformFileSystem.native.ts's
// `await import("expo-file-system/legacy")`, PostHogAnalyticsProvider's
// `await import("posthog-react-native")`).

export interface NativeTusPatchResult {
  status: number;
  bodyText: string;
}

export const readEventCoverVideoChunk = async (
  uri: string,
  offset: number,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> => {
  const { File } = await import("expo-file-system");
  const handle = new File(uri).open();
  try {
    handle.offset = offset;
    return handle.readBytes(length);
  } finally {
    handle.close();
  }
};

// Single-shot TUS PATCH of the raw bytes via expo/fetch (headers verbatim).
export const patchBunnyTusNative = async (input: {
  url: string;
  body: Uint8Array<ArrayBuffer>;
  headers: Record<string, string>;
  signal?: AbortSignal;
}): Promise<NativeTusPatchResult> => {
  const { fetch: expoFetch } = await import("expo/fetch");
  const response = await expoFetch(input.url, {
    body: input.body,
    headers: input.headers,
    method: "PATCH",
    signal: input.signal,
  });
  return { status: response.status, bodyText: await response.text() };
};
