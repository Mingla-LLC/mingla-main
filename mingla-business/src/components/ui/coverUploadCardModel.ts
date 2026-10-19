/**
 * coverUploadCardModel — #3040 B-C15 / Appendix A §1.3, §5, §7.
 *
 * The approved design's Host cover sheet, as pure data: which state a video
 * upload is in (H-04 … H-20, AD-xx), what its card says, which step of the
 * truthful stepper is lit, what the progress bar may claim, and which actions
 * the card offers. `CoverPicker` renders it; nothing here renders.
 *
 * Lives beside CoverPicker rather than inside it for the reason the other
 * `coverPicker*.ts` rules do: CoverPicker.tsx pulls in expo-video /
 * expo-image-picker / react-native-video-trim and cannot be mounted under jest.
 * PURE by contract — no React, no React Native, type-only imports.
 *
 * Design truth rules enforced here (Appendix A §1.3):
 *   T1  a % is never shown at 100 while the phase is unchanged.
 *   T2  upload % is server-confirmed bytes ÷ total, held at 99 until the end.
 *   T3  "Confirming upload" only when every byte is confirmed (`ack_pending`).
 *   T4  "offline" copy only when the device reports no network.
 *   T5  every retry-type action does something (see `coverPickerRetryRule`).
 */

import type {
  EventCoverVideoStatus,
  EventCoverVideoUploadStage,
} from "../../services/eventCoverVideoProcessingService";
import { UPDATE_REQUIRED_COPY } from "../../services/eventCoverVideoEdgeContract";

export type CoverKind = "video" | "photo" | "empty";
export type CardTone = "neutral" | "warning" | "error" | "ok";
export type UploadStep = "optimize" | "check" | "upload" | "finish";

export type CardActionId =
  | "choose_different"
  | "cancel"
  | "cancel_upload"
  | "check_now"
  | "check_again"
  | "resume_upload"
  | "continue_upload"
  | "choose_again"
  | "try_again"
  | "discard"
  | "trim"
  | "choose_another"
  | "update_app"
  | "save_as_cover"
  | "try_saving_again"
  | "discard_video";

export type CardAction = {
  id: CardActionId;
  label: string;
  variant: "primary" | "secondary" | "ghost";
};

export type CardProgress =
  | { kind: "determinate"; percent: number }
  | { kind: "indeterminate" }
  | { kind: "frozen"; percent: number }
  | { kind: "none" };

export type UploadCardModel = {
  /** Design state id (H-04 … H-20, AD-03, AD-05, AD-06). */
  stateId: string;
  title: string;
  sub: string | null;
  body: string;
  tone: CardTone;
  progress: CardProgress;
  /** "{a} of {b} MB · About {s} s left" style meta row, when byte-true. */
  meta: string | null;
  steps: readonly UploadStep[] | null;
  currentStep: UploadStep | null;
  actions: CardAction[];
  role: "alert" | null;
  /** Where the elapsed timer counts from, if the card shows one. */
  elapsedFrom: "none" | "stage" | "sourceUploaded";
  /** The sheet footer should offer a plain "Close" (needs-action states). */
  footerClose: boolean;
  /** The card is a needs-action state (H-12 / H-19 / AD-05): hide Remove cover. */
  needsAction: boolean;
};

export type UploadCardContext = {
  isNative: boolean;
  hasCover: boolean;
  /** Host Ads / Ari ad video (`ad_creative`, video-only sheet). */
  videoOnly: boolean;
  /** An event in `draft_auto`: the webhook applies it without the host. */
  finishesWithoutYou: boolean;
  /** Milliseconds the current phase has been showing (20 s / 60 s rules). */
  phaseElapsedMs: number;
  /** Upload throughput estimate in bytes/second, when one is known. */
  bytesPerSecond?: number | null;
  /** The new clip's length, for the "New video · 0:42" sub line. */
  newClipDurationMs?: number | null;
  newClipBytes?: number | null;
};

export const NATIVE_STEPS: readonly UploadStep[] = ["optimize", "check", "upload", "finish"];
export const WEB_STEPS: readonly UploadStep[] = ["check", "upload", "finish"];
export const STEP_LABEL: Record<UploadStep, string> = {
  optimize: "Optimize",
  check: "Check",
  upload: "Upload",
  finish: "Finish",
};

const SLOW_PHASE_MS = 20_000;
const LONGER_PROCESSING_MS = 60_000;

/** "0:42", "1:24" — the design's m:ss. */
export const formatClock = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** "7.1" — megabytes with one decimal, the design's meta unit. */
export const formatMegabytes = (bytes: number): string =>
  (Math.max(0, bytes) / (1024 * 1024)).toFixed(1);

/**
 * "About 20 s left": rounded to 5 s steps, hidden over 10 minutes or without
 * a rate (design H-06 truth rule).
 */
export const formatEta = (remainingBytes: number, bytesPerSecond: number | null | undefined): string | null => {
  if (!bytesPerSecond || bytesPerSecond <= 0 || remainingBytes <= 0) return null;
  const seconds = remainingBytes / bytesPerSecond;
  if (!Number.isFinite(seconds) || seconds > 600) return null;
  return `About ${Math.max(5, Math.ceil(seconds / 5) * 5)} s left`;
};

/** The provider/encode failures that a retry cannot fix (design H-14d). */
const PROVIDER_TERMINAL_CODES = new Set([
  "provider_failed",
  "processed_duration_over_cap",
  "processed_size_over_cap",
  "processed_mime_invalid",
  "derivative_invalid",
  "source_identity_mismatch",
  "provider_asset_missing",
  "processing_stalled",
  "source_video_track_missing",
]);

const newClipSub = (ctx: UploadCardContext, withBytes = false): string => {
  const parts = [ctx.videoOnly ? "New ad video" : "New video"];
  if (typeof ctx.newClipDurationMs === "number" && ctx.newClipDurationMs > 0) {
    parts.push(formatClock(ctx.newClipDurationMs));
  }
  if (withBytes && typeof ctx.newClipBytes === "number" && ctx.newClipBytes > 0) {
    parts.push(`${formatMegabytes(ctx.newClipBytes)} MB`);
  }
  return parts.join(" · ");
};

const stepsFor = (ctx: UploadCardContext): readonly UploadStep[] => (ctx.isNative ? NATIVE_STEPS : WEB_STEPS);

const action = (id: CardActionId, label: string, variant: CardAction["variant"]): CardAction => ({ id, label, variant });

const active = (
  ctx: UploadCardContext,
  cancelId: "cancel" | "cancel_upload",
): CardAction[] => [
  action("choose_different", ctx.videoOnly ? "Replace video" : "Choose a different video", "secondary"),
  action(cancelId, cancelId === "cancel_upload" ? "Cancel upload" : "Cancel", "ghost"),
];

const base = (partial: Partial<UploadCardModel> & Pick<UploadCardModel, "stateId" | "title" | "body">): UploadCardModel => ({
  sub: null,
  tone: "neutral",
  progress: { kind: "none" },
  meta: null,
  steps: null,
  currentStep: null,
  actions: [],
  role: null,
  elapsedFrom: "none",
  footerClose: false,
  needsAction: false,
  ...partial,
});

/** "Your current cover stays…" — only when there IS a current cover. */
const keepsCover = (ctx: UploadCardContext): string =>
  ctx.hasCover ? " Your current cover is still in place." : "";

/**
 * The card for a video upload stage, or null when no card shows (idle, and
 * applied — the status row announces H-15).
 */
export const videoUploadCardModel = (
  stage: EventCoverVideoUploadStage,
  status: EventCoverVideoStatus | null,
  ctx: UploadCardContext,
): UploadCardModel | null => {
  const steps = stepsFor(ctx);
  switch (stage.phase) {
    case "idle":
    case "applied":
      return null;
    case "compressing":
      return base({
        stateId: "H-04",
        title: "Optimizing video",
        sub: newClipSub(ctx),
        body: "Making it smaller so it uploads faster. Keep Mingla open for this step.",
        // T1 — the compressor's frame %, capped below 100 while still compressing.
        progress: stage.percent === null
          ? { kind: "indeterminate" }
          : { kind: "determinate", percent: Math.min(99, Math.max(0, stage.percent)) },
        steps, currentStep: "optimize",
        actions: active(ctx, "cancel"),
      });
    case "picking":
    case "reading":
    case "validating":
    case "preparing":
      return base({
        stateId: "H-05",
        title: "Checking file",
        sub: stage.phase === "reading" ? (ctx.videoOnly ? "New ad video" : "New video") : newClipSub(ctx, true),
        body: ctx.phaseElapsedMs >= SLOW_PHASE_MS
          ? "Big file — this can take a minute on some phones."
          : "Securing a copy so the upload can pick up where it left off.",
        progress: { kind: "indeterminate" },
        steps, currentStep: "check",
        actions: active(ctx, "cancel"),
        elapsedFrom: "stage",
      });
    case "intent_pending":
      return base({
        stateId: "H-06",
        title: "Starting upload",
        sub: newClipSub(ctx, true),
        body: "You can close this. The upload keeps going while Mingla is open, and resumes from here if it's interrupted.",
        progress: { kind: "indeterminate" },
        steps, currentStep: "upload",
        actions: active(ctx, "cancel_upload"),
      });
    case "uploading": {
      const total = stage.totalBytes ?? ctx.newClipBytes ?? null;
      const confirmed = stage.confirmedBytes ?? 0;
      const mb = total !== null && total > 0 ? `${formatMegabytes(confirmed)} of ${formatMegabytes(total)} MB` : null;
      const eta = stage.retrying === true
        ? "Reconnecting…"
        : total !== null ? formatEta(total - confirmed, ctx.bytesPerSecond) : null;
      return base({
        stateId: "H-06",
        title: "Uploading",
        sub: newClipSub(ctx),
        body: "You can close this. The upload keeps going while Mingla is open, and resumes from here if it's interrupted.",
        // T2 — byte-true only; a transfer that cannot report steps is indeterminate.
        progress: stage.percent === null
          ? { kind: "indeterminate" }
          : { kind: "determinate", percent: Math.min(99, Math.max(0, stage.percent)) },
        meta: [mb, eta].filter((part): part is string => part !== null).join(" · ") || null,
        steps, currentStep: "upload",
        actions: active(ctx, "cancel_upload"),
      });
    }
    case "ack_pending": {
      const total = ctx.newClipBytes ?? null;
      const slow = ctx.phaseElapsedMs >= SLOW_PHASE_MS;
      return base({
        stateId: "H-07",
        title: "Confirming upload",
        sub: total !== null ? `${formatMegabytes(total)} of ${formatMegabytes(total)} MB sent` : null,
        body: slow
          ? "Still confirming. This usually takes a few seconds."
          : "Making sure every byte arrived safely.",
        progress: { kind: "indeterminate" },
        steps, currentStep: "upload",
        actions: [
          ...(slow ? [action("check_now", "Check now", "secondary")] : []),
          ...active(ctx, "cancel_upload"),
        ],
      });
    }
    case "processing": {
      if (stage.timing === "breached") {
        return base({
          stateId: "H-09",
          title: "Taking longer than usual",
          sub: "Preparing at Mingla",
          body: ctx.hasCover
            ? "We've flagged the delay and we're still working on it. Your current cover stays in place."
            : "We've flagged the delay and we're still working on it.",
          tone: "warning",
          progress: { kind: "indeterminate" },
          steps, currentStep: "finish",
          actions: [action("check_again", "Check again", "secondary"), ...active(ctx, "cancel")],
          elapsedFrom: "sourceUploaded",
        });
      }
      const sinceUpload = status?.sourceUploadedAt ? Date.now() - Date.parse(status.sourceUploadedAt) : 0;
      const tail = ctx.videoOnly
        ? "You can close this. The video will be attached to this ad when it's ready."
        : !ctx.hasCover
          ? "Your video is uploaded. You can close this."
          : ctx.finishesWithoutYou
            ? "Your video is uploaded. You can close this — your current cover stays until the new one is ready. We'll swap it in automatically."
            : "Your video is uploaded. You can close this — your current cover stays until the new one is ready. We'll swap it in next time you open this.";
      return base({
        stateId: "H-08",
        title: "Preparing at Mingla",
        sub: stage.timing === "delayed" || sinceUpload >= LONGER_PROCESSING_MS ? "Taking a little longer" : "Usually about 30 seconds",
        body: tail,
        // The provider's % only when it reports a real value above 0.
        progress: stage.percent !== null && stage.percent > 0
          ? { kind: "determinate", percent: Math.min(99, stage.percent) }
          : { kind: "indeterminate" },
        steps, currentStep: "finish",
        actions: active(ctx, "cancel"),
        elapsedFrom: "sourceUploaded",
      });
    }
    case "reattaching":
      return base({
        stateId: "reattaching",
        title: "Reconnecting to your video…",
        body: "Checking the latest progress without starting over.",
        progress: { kind: "indeterminate" },
      });
    case "applying":
      return ctx.videoOnly
        ? base({
          stateId: "AD-03",
          title: "Saving to your ad",
          body: "Checking how it fits each platform.",
          progress: { kind: "indeterminate" },
          steps, currentStep: "finish",
        })
        : base({
          stateId: "applying",
          title: "Applying cover…",
          body: "The video is ready. Saving it to the right cover now.",
          progress: { kind: "indeterminate" },
          steps, currentStep: "finish",
        });
    case "detached": {
      const total = stage.totalBytes ?? null;
      const confirmed = stage.confirmedBytes ?? 0;
      const pct = total !== null && total > 0 ? Math.min(99, Math.floor((confirmed / total) * 100)) : null;
      const at = pct !== null && total !== null ? `${pct}% · ${formatMegabytes(confirmed)} of ${formatMegabytes(total)} MB` : null;
      if (stage.sourceAcknowledged) {
        // The watch deadline passed; the server owns the job from here.
        return base({
          stateId: "H-09",
          title: "Taking longer than usual",
          sub: "Preparing at Mingla",
          body: ctx.hasCover
            ? "We've flagged the delay and we're still working on it. Your current cover stays in place."
            : "We've flagged the delay and we're still working on it.",
          tone: "warning",
          progress: { kind: "indeterminate" },
          steps, currentStep: "finish",
          actions: [action("check_again", "Check again", "secondary"), ...active(ctx, "cancel")],
        });
      }
      if (stage.reason === "offline") {
        return base({
          stateId: "H-10",
          title: "Upload paused",
          sub: at !== null ? `Stopped at ${at}` : null,
          body: pct !== null
            ? `You're offline. It'll pick up from ${pct}% when you reconnect.`
            : "You're offline. It'll pick up from here when you reconnect.",
          tone: "warning",
          progress: { kind: "frozen", percent: pct ?? 0 },
          steps, currentStep: "upload",
          actions: [action("resume_upload", "Resume upload", "secondary"), action("cancel_upload", "Cancel upload", "ghost")],
        });
      }
      if (stage.reason === "repick" || !ctx.isNative) {
        return base({
          stateId: "H-12",
          title: "Choose the video again",
          sub: pct !== null ? `Upload stopped at ${pct}%` : null,
          body: "This tab was closed or reloaded before the upload finished. Choose the video again to finish it.",
          tone: "warning",
          progress: { kind: "frozen", percent: pct ?? 0 },
          actions: [action("choose_again", "Choose the video again", "primary"), action("cancel_upload", "Cancel upload", "ghost")],
          role: "alert",
          footerClose: true,
          needsAction: true,
        });
      }
      return base({
        stateId: "H-11",
        title: "Upload interrupted",
        sub: at !== null ? `Saved at ${at}` : null,
        body: "Something went wrong on our side. Your progress is saved — continue from where it stopped.",
        tone: "warning",
        progress: { kind: "frozen", percent: pct ?? 0 },
        steps, currentStep: "upload",
        actions: [action("continue_upload", "Continue upload", "secondary"), action("cancel_upload", "Cancel upload", "ghost")],
      });
    }
    case "ready":
      return ctx.videoOnly
        ? base({
          stateId: "AD-05",
          title: "Video is ready, but not saved to the ad",
          body: "Your upload is safe — no need to upload it again.",
          tone: "warning",
          actions: [action("try_saving_again", "Try saving again", "primary"), action("discard_video", "Discard video", "ghost")],
          role: "alert",
          footerClose: true,
          needsAction: true,
        })
        : base({
          stateId: "H-19",
          title: "New video is ready",
          sub: "But we couldn't save it as your cover",
          body: "Nothing to re-upload. Tap to save it again.",
          tone: "warning",
          actions: [action("save_as_cover", "Save as cover", "primary"), action("discard", "Discard", "ghost")],
          role: "alert",
          footerClose: true,
          needsAction: true,
        });
    case "error":
      return errorCardModel(stage.code, stage.message, ctx);
  }
};

/** The H-13 / H-14 / AD-06 family for a stage error code. */
export const errorCardModel = (
  code: string,
  // The hook's own sentence. The design copy below replaces it on the card;
  // it stays available to telemetry and the notice row.
  _message: string,
  ctx: UploadCardContext,
): UploadCardModel => {
  if (code === "client_version_required") {
    return base({
      stateId: "H-14e",
      title: UPDATE_REQUIRED_COPY.title,
      body: UPDATE_REQUIRED_COPY.body,
      tone: "error",
      actions: ctx.isNative ? [action("update_app", "Update app", "primary")] : [],
      role: "alert",
    });
  }
  if (code === "source_file_gone") {
    return base({
      stateId: "H-12",
      title: "Choose the video again",
      body: ctx.isNative
        ? "Your phone cleared the copy we were uploading, so we can't continue from here. Pick the same video and we'll start it fresh."
        : "This tab was closed or reloaded before the upload finished. Choose the video again to finish it.",
      tone: "warning",
      actions: [action("choose_again", "Choose the video again", "primary"), action("cancel_upload", "Cancel upload", "ghost")],
      role: "alert",
      footerClose: true,
      needsAction: true,
    });
  }
  if (code === "ad_video_too_short") {
    return base({
      stateId: "AD-06",
      title: "This video is too short",
      sub: "Ad videos need at least 5 seconds",
      body: "Instagram, Facebook and TikTok won't run shorter clips.",
      tone: "error",
      actions: [action("choose_another", "Choose another video", "primary")],
      role: "alert",
    });
  }
  if (code === "video_source_type_unsupported") {
    return base({
      stateId: "H-14c",
      title: "We can't use this file type",
      body: "Use MP4, MOV, M4V or WebM.",
      tone: "error",
      actions: [action("choose_another", "Choose another video", "primary")],
      role: "alert",
    });
  }
  if (code === "video_file_too_large" || code === "video_compression_failed") {
    return base({
      stateId: "H-14b",
      title: "This video is over 100 MB",
      sub: ctx.videoOnly ? "Ad videos must be under 100 MB" : "Covers must be under 100 MB",
      body: "Try a shorter clip, or export it at a lower quality.",
      tone: "error",
      actions: [action("choose_another", "Choose another video", "primary")],
      role: "alert",
    });
  }
  if (PROVIDER_TERMINAL_CODES.has(code)) {
    return base({
      stateId: "H-14d",
      title: "Mingla couldn't prepare this video",
      body: "The file may be damaged. Try exporting it again, or pick another clip.",
      tone: "error",
      actions: [action("choose_another", "Choose another video", "primary")],
      role: "alert",
    });
  }
  return base({
    stateId: "H-13",
    title: "Couldn't finish this upload",
    body: `Something went wrong while preparing your new video.${keepsCover(ctx)}`,
    tone: "error",
    actions: [action("try_again", "Try again", "secondary"), action("discard", "Discard", "ghost")],
    role: "alert",
  });
};

/** A refusal made at PICK time, before any byte leaves the device (H-14a/b/c, AD-06). */
export type PickRefusal =
  | { kind: "too_long"; durationMs: number }
  | { kind: "too_large"; bytes: number }
  | { kind: "unsupported" }
  | { kind: "too_short"; durationMs: number };

export const pickRefusalCardModel = (refusal: PickRefusal, ctx: UploadCardContext): UploadCardModel => {
  switch (refusal.kind) {
    case "too_long":
      return base({
        stateId: "H-14a",
        title: `This video is ${formatClock(refusal.durationMs)} long`,
        sub: ctx.videoOnly ? "Ad videos can be up to 1 minute" : "Covers can be up to 1 minute",
        body: `Trim it to the best minute, or pick a shorter clip.${ctx.hasCover ? " Your current cover didn't change." : ""}`,
        tone: "error",
        actions: ctx.isNative
          ? [action("trim", "Trim to 1 minute", "primary"), action("choose_another", "Choose another video", "secondary")]
          : [action("choose_another", "Choose another video", "primary")],
        role: "alert",
      });
    case "too_large":
      return base({
        stateId: "H-14b",
        title: `This video is ${Math.round(refusal.bytes / (1024 * 1024))} MB`,
        sub: ctx.videoOnly ? "Ad videos must be under 100 MB" : "Covers must be under 100 MB",
        body: "Try a shorter clip, or export it at a lower quality.",
        tone: "error",
        actions: [action("choose_another", "Choose another video", "primary")],
        role: "alert",
      });
    case "unsupported":
      return base({
        stateId: "H-14c",
        title: "We can't use this file type",
        body: "Use MP4, MOV, M4V or WebM.",
        tone: "error",
        actions: [action("choose_another", "Choose another video", "primary")],
        role: "alert",
      });
    case "too_short":
      return base({
        stateId: "AD-06",
        title: `This video is ${Math.max(1, Math.floor(refusal.durationMs / 1000))} seconds long`,
        sub: "Ad videos need at least 5 seconds",
        body: "Instagram, Facebook and TikTok won't run shorter clips.",
        tone: "error",
        actions: [action("choose_another", "Choose another video", "primary")],
        role: "alert",
      });
  }
};

/** The status row (H-01 … H-03, H-15, AD-01, AD-04) shown when no card does. */
export type StatusRowModel = {
  stateId: string;
  title: string;
  body: string;
  tone: "ok" | "neutral" | "warning";
};

export const coverStatusRowModel = (input: {
  coverKind: CoverKind;
  /** The cover guests see now (published event, brand, venue). */
  isLive: boolean;
  videoOnly: boolean;
  /** H-15: a job this mount started was applied in the last 3 s. */
  justApplied: boolean;
  /** AD-04: "Fits Meta and TikTok. Snapchat needs 1080×1920." */
  adFitSummary?: string | null;
}): StatusRowModel => {
  const saved = input.isLive ? "This is the cover guests see now." : "This is the cover saved to your draft.";
  if (input.videoOnly) {
    return input.coverKind === "video"
      ? {
        stateId: "AD-04",
        title: "Ad video ready",
        body: input.adFitSummary ?? "Saved to this ad. Nothing goes to ad platforms until you fund and confirm the plan.",
        tone: "ok",
      }
      : {
        stateId: "AD-01",
        title: "Add the video for this ad",
        body: "Vertical 9:16 works on the most platforms. Nothing goes to ad platforms until you fund and confirm the plan.",
        tone: "neutral",
      };
  }
  switch (input.coverKind) {
    case "empty":
      return {
        stateId: "H-01",
        title: "Add a cover",
        body: "It's the first thing guests see. A short video or a photo both work.",
        tone: "neutral",
      };
    case "photo":
      return {
        stateId: "H-02",
        title: "Photo cover ready",
        body: `${saved} Replacing it won't remove the current photo until the new one is ready.`,
        tone: "ok",
      };
    case "video":
      return {
        stateId: input.justApplied ? "H-15" : "H-03",
        title: input.justApplied ? "New video cover is live" : "Video cover ready",
        body: `${saved} Replacing it won't remove the current video until the new one is ready.`,
        tone: "ok",
      };
  }
};

/** The limits block under the actions (design D4). */
export const coverLimitsLines = (coverKind: CoverKind, videoOnly: boolean): string[] => {
  const video = "MP4, MOV, M4V or WebM · Up to 1 minute · Under 100 MB";
  const photo = "JPEG, PNG, WebP or GIF · Under 30 MB";
  if (videoOnly) return ["MP4, MOV, M4V or WebM · 5 seconds to 1 minute · Under 100 MB"];
  if (coverKind === "video") return [video, "Mingla prepares a browser-safe version automatically."];
  if (coverKind === "photo") return [photo];
  return [`Video: ${video}`, `Photo: ${photo}`];
};

/** Footer label by state (Appendix A §5, last row). */
export const coverSheetFooterLabel = (input: {
  jobActive: boolean;
  needsAction: boolean;
  hasCover: boolean;
  videoOnly: boolean;
}): "Close — keep working" | "Use this cover" | "Use this ad video" | "Done" | "Close" => {
  if (input.needsAction) return "Close";
  if (input.jobActive) return "Close — keep working";
  if (input.hasCover) return input.videoOnly ? "Use this ad video" : "Use this cover";
  return "Done";
};

/** H-16 — a player error on the SAVED cover (never the in-flight local clip). */
export type RenderErrorCopy = {
  title: string;
  body: string;
  action: { id: "reloadPreview"; label: "Load preview again" };
};

export const resolveRenderErrorCopy = (
  mediaType: "video" | "photo",
  failures = 1,
): RenderErrorCopy => ({
  title: "We couldn't load the preview",
  body: failures >= 2
    ? mediaType === "video"
      ? "Still not loading. If guests report the same, replace the video."
      : "Still not loading. If guests report the same, replace the photo."
    : mediaType === "video"
      ? "Your video cover is still saved. This is usually a connection hiccup — try loading it again."
      : "Your photo cover is still saved. This is usually a connection hiccup — try loading it again.",
  action: { id: "reloadPreview", label: "Load preview again" },
});

/** The most a "Load preview again" spinner may run (H-16). */
export const RELOAD_PREVIEW_MAX_MS = 8_000;
