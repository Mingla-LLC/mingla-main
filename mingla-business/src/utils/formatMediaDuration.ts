export function formatMediaDuration(durationMs: number | null | undefined): string | null {
  if (durationMs === null || durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return null;
  const total = Math.floor(durationMs / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export type FileSizeTranslator = (key: "format.kb" | "format.mb", variables: { n: string | number }) => string;

export function formatFileSize(sizeBytes: number | null | undefined, translate?: FileSizeTranslator): string {
  const bytes = Number(sizeBytes ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return translate?.("format.kb", { n: 0 }) ?? "0 KB";
  if (bytes < 1024 * 1024) {
    const n = Math.max(1, Math.round(bytes / 1024)).toLocaleString();
    return translate?.("format.kb", { n }) ?? `${n} KB`;
  }
  const mb = bytes / 1024 / 1024;
  const n = mb >= 10 ? Math.round(mb) : mb.toFixed(1);
  return translate?.("format.mb", { n }) ?? `${n} MB`;
}
