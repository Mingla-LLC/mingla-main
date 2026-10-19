/**
 * coverPickerActiveMedia — #3040 B-C4 [A-4] / design truth rule T7.
 *
 * The preview shows the SAVED cover (`localCover`), never a stale
 * `processedUrl`, and never the new clip while a current cover exists — the
 * host's promise is "the current cover stays until the replacement is live".
 * The one exception is H-20: no cover exists yet, so the new local clip is
 * shown, dimmed, under "New video · not live yet".
 *
 * It used to be `localPreviewUri ?? processedUrl ?? localCover`, so a finished
 * video outranked a photo the host picked afterwards, and the green "added"
 * card stayed up for the rest of the session. PURE: no React, no React Native.
 */

export type ActiveMediaInput = {
  /** The new clip on this device (set while a job runs). */
  localPreviewUri: string | null;
  /** The finished job's output (set at ready/applied). */
  processedUrl: string | null;
  /** The hook's stage phase. */
  stagePhase: string;
  coverUrl: string | null;
  coverType: string | null;
};

export type ActiveMedia = {
  url: string | null;
  type: string | null;
  /** H-20: the preview is the new, not-yet-live clip. */
  isNewClip: boolean;
  /** The "added" confirmation may show: the saved cover IS that job's output. */
  showAddedCard: boolean;
};

const ACTIVE_PHASES = new Set([
  "picking", "reading", "validating", "compressing", "preparing", "intent_pending",
  "uploading", "ack_pending", "processing", "detached", "reattaching", "applying", "ready",
]);

export const resolveActiveMedia = (input: ActiveMediaInput): ActiveMedia => {
  const jobActive = ACTIVE_PHASES.has(input.stagePhase);
  if (input.coverUrl === null && jobActive && input.localPreviewUri !== null) {
    return { url: input.localPreviewUri, type: "video", isNewClip: true, showAddedCard: false };
  }
  return {
    url: input.coverUrl,
    type: input.coverUrl === null ? null : input.coverType,
    isNewClip: false,
    showAddedCard:
      input.stagePhase === "applied" &&
      input.processedUrl !== null &&
      input.coverUrl === input.processedUrl,
  };
};

/** Back-compat name used by the spec's test plan (T-A4). */
export const resolveActiveMediaUrl = (input: ActiveMediaInput): string | null =>
  resolveActiveMedia(input).url;
