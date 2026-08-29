// ORCH-1295 — web stub for the native TUS PATCH transport.
//
// Web never uses expo-file-system / expo/fetch: on web the Bunny TUS PATCH is
// driven by XHR (`patchTusWithXhr` in eventCoverVideoProcessingService), and
// `fetch(uri).blob()` works on web. This stub keeps the module shape symmetric
// so `import ... from "./eventCoverVideoTusPatch"` resolves on web (Metro serves
// this file; the real File/expo-fetch impl lives in the sibling *.native.ts).
// These stubs are never reached on web — the caller gates on Platform.OS.

export interface NativeTusPatchResult {
  status: number;
  bodyText: string;
}

export const readEventCoverVideoBytes = async (
  _uri: string,
): Promise<Uint8Array<ArrayBuffer>> => {
  throw new Error("Native video byte reads are unavailable on web.");
};

export const readEventCoverVideoChunk = async (
  _uri: string,
  _offset: number,
  _length: number,
): Promise<Uint8Array<ArrayBuffer>> => {
  throw new Error("Native video chunk reads are unavailable on web.");
};

export const patchBunnyTusNative = async (_input: {
  url: string;
  body: Uint8Array<ArrayBuffer>;
  headers: Record<string, string>;
  signal?: AbortSignal;
}): Promise<NativeTusPatchResult> => {
  throw new Error("Native TUS PATCH is unavailable on web.");
};
