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
