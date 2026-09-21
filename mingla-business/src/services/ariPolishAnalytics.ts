/** Issue #3429 — privacy-safe categorical Ari chat polish analytics. */

// #3429 P0 follow-up — `postHogService` imports `expo-constants` at module
// scope, which evaluates `expo-modules-core`'s EventEmitter against a native
// global that does not exist outside a device. A STATIC import here therefore
// made merely importing this module fatal for anything that mounts
// AriChatScreen without a posthog mock: ConversationDrawer imports this file,
// AriChatScreen imports ConversationDrawer, and #1486's dormant render suite
// died six tests deep on `Cannot read properties of undefined (reading
// 'EventEmitter')`. Same class as ORCH-1296 — a boot-fragile native module
// must not evaluate at import time.
//
// Resolving it at CALL time keeps these functions synchronous and `void`
// (they are fire-and-forget), and a function-scope `require` is still a static
// edge to Metro, so chunk membership is unchanged.
function capture(event: string, properties: Record<string, unknown>): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { postHogService } = require("./postHogService") as {
    postHogService: { capture: (event: string, properties: Record<string, unknown>) => void };
  };
  capture(event, properties);
}

type AriSurface = "main" | "website";
type AriAttachmentOutcome = "selected" | "ready" | "failed" | "removed" | "opened";
type AriTurnOutcome = "started" | "pending" | "accepted" | "completed" | "failed" | "stopped" | "retried" | "edited" | "discarded" | "cancelled";

export function captureAriAttachmentOutcome(args: {
  surface: AriSurface;
  outcome: AriAttachmentOutcome;
  fileType: "image" | "pdf" | "docx" | "text" | "csv" | "unsupported";
  errorCode?: string | null;
}): void {
  capture("ari_attachment_outcome", {
    surface: args.surface,
    outcome: args.outcome,
    file_type: args.fileType,
    error_code: args.errorCode?.slice(0, 80) ?? null,
  });
}

export function captureAriTurnOutcome(args: {
  surface: AriSurface;
  outcome: AriTurnOutcome;
  hasAttachments?: boolean;
  attachmentCount?: number;
  errorCode?: string | null;
}): void {
  capture("ari_turn_outcome", {
    surface: args.surface,
    outcome: args.outcome,
    has_attachments: args.hasAttachments ?? false,
    attachment_count_bucket: (args.attachmentCount ?? 0) === 0
      ? "0"
      : args.attachmentCount === 1
      ? "1"
      : "2-5",
    error_code: args.errorCode?.slice(0, 80) ?? null,
  });
}

export function captureAriActivityDisplayed(args: {
  surface: AriSurface;
  phase: string;
}): void {
  capture("ari_activity_displayed", {
    surface: args.surface,
    activity_phase: args.phase.slice(0, 80),
  });
}

export function captureAriRevealOutcome(args: {
  surface: AriSurface;
  outcome: "completed" | "skipped";
  reducedMotion: boolean;
  durationMs: number;
}): void {
  capture("ari_response_reveal", {
    surface: args.surface,
    outcome: args.outcome,
    reduced_motion: args.reducedMotion,
    duration_bucket: args.durationMs === 0 ? "instant" : args.durationMs <= 500 ? "300-500" : args.durationMs <= 900 ? "501-900" : "901-1200",
  });
}

export function captureAriTitleAction(
  surface: AriSurface,
  action: "renamed" | "regenerated" | "deleted",
): void {
  capture("ari_title_action", { surface, action });
}
