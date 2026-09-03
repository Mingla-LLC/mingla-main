export type PreparedEventCoverVideoSource = {
  uri: string;
  bytes: number;
  durationMs: number;
  fileName: string;
  mimeType: string;
  extension: "mp4" | "mov" | "m4v" | "webm";
  sha256: string;
  fingerprint: string;
};

const allowed = new Map<string, PreparedEventCoverVideoSource["extension"]>([
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/x-m4v", "m4v"],
  ["video/webm", "webm"],
]);

// Issue #3073 — mirrors the native guard's error so the shared hook can import
// ONE symbol regardless of platform. Web reads the blob through `fetch` and the
// browser's own decoder, which is a different failure surface from the native
// trim editor, so nothing throws this here today; the type exists so the hook's
// `instanceof` branch is not silently unreachable on web.
export class EventCoverVideoSourceHasNoVideoTrackError extends Error {
  constructor() {
    super("The trimmed clip has no video track.");
    this.name = "EventCoverVideoSourceHasNoVideoTrackError";
  }
}

// A NAME check, not `instanceof`. Several suites mock this module partially, so
// the class can be `undefined` at runtime in a test — and `x instanceof
// undefined` THROWS, taking down the whole suite rather than failing one
// assertion. Same shape the repo already uses for PostgREST errors, which
// arrive as plain objects.
export const isEventCoverVideoSourceHasNoVideoTrackError = (
  error: unknown,
): boolean =>
  error !== null && typeof error === "object" &&
  (error as { name?: unknown }).name === "EventCoverVideoSourceHasNoVideoTrackError";

export const prepareEventCoverVideoSource = async (input: {
  uri: string;
  bytes: number;
  durationMs: number;
  fileName?: string | null;
  mimeType?: string | null;
  operationId: string;
}): Promise<PreparedEventCoverVideoSource> => {
  const mimeType = String(input.mimeType ?? "").toLowerCase();
  const extension = allowed.get(mimeType);
  const namedExtension = input.fileName?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (!extension || namedExtension !== extension) throw new Error("video_source_type_unknown");
  const response = await fetch(input.uri);
  if (!response.ok) throw new Error("video_source_unreadable");
  const blob = await response.blob();
  if (blob.size <= 0 || blob.size !== input.bytes) throw new Error("video_source_size_changed");
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    uri: input.uri,
    bytes: blob.size,
    durationMs: input.durationMs,
    fileName: input.fileName!,
    mimeType,
    extension,
    sha256,
    fingerprint: `${sha256}:${blob.size}`,
  };
};

export const deletePreparedEventCoverVideoSource = async (uri: string): Promise<void> => {
  if (uri.startsWith("blob:") && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(uri);
  }
};
