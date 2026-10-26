// Issue #4114 Wave 7 — chat media storage early warning.
//
// Once a day (the probe's 13:00 UTC tick) the probe asks the database how much
// the private `message-attachments` bucket holds and which of the 5, 10 and
// 20 GB thresholds it has passed without an alert yet
// (issue_4114_chat_media_storage_due). Each newly passed threshold is named in
// ONE ops alert email (the existing sendOpsAlertEmail rail and the api_health
// recipients), then recorded (issue_4114_chat_media_storage_mark_alerted) so it
// never alerts again. A send that reaches nobody is not recorded, so the next
// day tries again; a read or record failure is reported, never treated as fine.
//
// Pure: the probe passes in the database calls and the sender, so the Deno test
// drives it with fakes.
// MINGLA-INVARIANT: I-4114-CHAT-MEDIA-STORAGE-WARNING | issue #4114 | Each chat media storage threshold (5, 10, 20 GB) sends one ops alert, recorded only after a recipient accepted it.

export const CHAT_MEDIA_STORAGE_THRESHOLDS_GB: readonly number[] = [5, 10, 20];
const GIB = 1024 * 1024 * 1024;

export interface ChatMediaStorageDue {
  total_bytes: number;
  due_thresholds_gb: number[];
}

export interface ChatMediaStorageDeps {
  due(thresholdsGb: readonly number[]): Promise<{ data: ChatMediaStorageDue | null; error: string | null }>;
  send(alert: { subject: string; paragraphs: string[] }): Promise<{ succeeded: number }>;
  markAlerted(thresholdsGb: number[], totalBytes: number): Promise<{ error: string | null }>;
}

export type ChatMediaStorageOutcome =
  | { status: "quiet"; totalBytes: number }
  | { status: "alerted"; totalBytes: number; thresholdsGb: number[] }
  | { status: "send_failed"; totalBytes: number; thresholdsGb: number[] }
  | { status: "error"; stage: "read" | "record"; error: string };

export function formatGb(bytes: number): string {
  return `${(Math.max(0, bytes) / GIB).toFixed(1)} GB`;
}

export function chatMediaStorageAlertCopy(totalBytes: number, thresholdsGb: readonly number[]): {
  subject: string;
  paragraphs: string[];
} {
  const highest = Math.max(...thresholdsGb);
  return {
    subject: `[STORAGE] Chat photos and videos passed ${highest} GB`,
    paragraphs: [
      `Chat photos and videos (the message-attachments bucket) now take ${formatGb(totalBytes)}.`,
      `Passed: ${thresholdsGb.map((gb) => `${gb} GB`).join(", ")}. Each threshold alerts once.`,
      "Already in place: thumbnails first, 200 MB per person per day, and full videos deleted after 90 days.",
      "Check the Supabase usage page against the spend cap before the next threshold.",
    ],
  };
}

export async function runChatMediaStorageCheck(deps: ChatMediaStorageDeps): Promise<ChatMediaStorageOutcome> {
  const due = await deps.due(CHAT_MEDIA_STORAGE_THRESHOLDS_GB);
  if (due.error || !due.data) return { status: "error", stage: "read", error: due.error ?? "no_row" };
  const totalBytes = Number(due.data.total_bytes) || 0;
  const thresholds = [...new Set((due.data.due_thresholds_gb ?? []).map(Number))]
    .filter((gb) => Number.isFinite(gb) && gb > 0)
    .sort((a, b) => a - b);
  if (thresholds.length === 0) return { status: "quiet", totalBytes };

  const sent = await deps.send(chatMediaStorageAlertCopy(totalBytes, thresholds));
  if (sent.succeeded <= 0) return { status: "send_failed", totalBytes, thresholdsGb: thresholds };

  const marked = await deps.markAlerted(thresholds, totalBytes);
  if (marked.error) return { status: "error", stage: "record", error: marked.error };
  return { status: "alerted", totalBytes, thresholdsGb: thresholds };
}
