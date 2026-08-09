import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  acknowledgeEventCoverVideoSourceUploaded,
  applyEventCoverVideoJob,
  cancelEventCoverVideoJob,
  compressVideoLocally,
  createEventCoverVideoUploadIntent,
  type EventCoverVideoApplyMode,
  type EventCoverVideoStatus,
  type EventCoverVideoUploadStage,
  logEventCoverVideoUploadTelemetry,
  uploadEventCoverVideoSource,
  waitForEventCoverVideoReady,
} from "../services/eventCoverVideoProcessingService";
import { businessEventKeys } from "./useBusinessEvents";
import { eventDraftKeys } from "./useServerDraftEvents";
import { publicEventKeys } from "./usePublicEvents";
import { upcomingKeys } from "./upcomingKeys";
import { brandKeys } from "./useBrands";

const idleStage: EventCoverVideoUploadStage = { phase: "idle", percent: 0 };

export type EventCoverVideoUploadFile = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  bytes: number;
  durationMs: number;
  trimStartMs?: number;
  trimEndMs?: number;
};

// ORCH-0989: cover-video target. "event" (default) → events.cover_media_url;
// "brand" → brands.cover_media_url (the apply step writes brands on ready).
// META-ORCH-1059 Sub-B: "experience" is an events-table row using the SAME
// events.cover_media_* columns, so it behaves identically to "event" through
// the whole pipeline (intent/source/apply all keyed on the events-row id).
// We accept it as a distinct kind for call-site clarity, then normalize to
// "event" for every server-facing decision below.
// META-ORCH-1255(C) D-C: "venue" rides the BRAND server pipeline (brand-keyed
// processing, no events-row id) but SKIPS the on-ready apply step — that step
// writes brands.cover_media_url, which for a venue hero would clobber the
// parent brand's profile cover. The processed URL still surfaces through the
// ready-emit; the venue host persists it to venue_listings via syncHeroMedia
// (one owner per truth).
export type CoverVideoTargetKind = "event" | "brand" | "experience" | "venue";

export function useEventCoverVideoUpload(
  eventId: string,
  brandId: string,
  applyMode: EventCoverVideoApplyMode = "draft_auto",
  target: CoverVideoTargetKind = "event",
): {
  start: (file: EventCoverVideoUploadFile) => Promise<void>;
  cancel: () => Promise<void>;
  stage: EventCoverVideoUploadStage;
  status: EventCoverVideoStatus | null;
  processedUrl: string | null;
  processedPosterUrl: string | null;
  localPreviewUri: string | null;
  error: Error | null;
} {
  const queryClient = useQueryClient();
  // META-ORCH-1059 Sub-B: experiences ride the event-cover pipeline verbatim
  // (same events.cover_media_* columns + events-row id). Normalize the target
  // for every server-facing call + cache-invalidation decision.
  const serverTarget: "event" | "brand" =
    target === "brand" || target === "venue" ? "brand" : "event";
  const abortControllerRef = useRef<AbortController | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const [stage, setStage] = useState<EventCoverVideoUploadStage>(idleStage);
  const [status, setStatus] = useState<EventCoverVideoStatus | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [processedPosterUrl, setProcessedPosterUrl] = useState<string | null>(null);
  const [localPreviewUri, setLocalPreviewUri] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const invalidateEventCaches = useCallback((): void => {
    if (target === "venue") {
      // META-ORCH-1255(C) D-C: the venue target never wrote the brands row —
      // nothing brand/event-cached changed here. The venue host owns its own
      // persistence (syncHeroMedia) + cache lifecycle.
      return;
    }
    if (serverTarget === "brand") {
      // ORCH-0989: brand-target writes brands.cover_media_url — invalidate
      // brand caches, not event caches (eventId is absent).
      void queryClient.invalidateQueries({ queryKey: brandKeys.detail(brandId) });
      void queryClient.invalidateQueries({ queryKey: brandKeys.lists() });
      return;
    }
    void queryClient.invalidateQueries({ queryKey: businessEventKeys.detail(eventId) });
    void queryClient.invalidateQueries({ queryKey: businessEventKeys.list(brandId) });
    void queryClient.invalidateQueries({ queryKey: eventDraftKeys.detail(eventId) });
    void queryClient.invalidateQueries({ queryKey: eventDraftKeys.list(brandId) });
    void queryClient.invalidateQueries({ queryKey: publicEventKeys.detailById(eventId) });
    void queryClient.invalidateQueries({ queryKey: upcomingKeys.all });
  }, [brandId, eventId, queryClient, serverTarget, target]);

  const start = useCallback(
    async (file: EventCoverVideoUploadFile): Promise<void> => {
      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      jobIdRef.current = null;
      setError(null);
      setStatus(null);
      setProcessedUrl(null);
      setProcessedPosterUrl(null);
      setLocalPreviewUri(file.uri);
      setStage({ phase: "compressing", percent: 0 });

      try {
        const compressed = await compressVideoLocally({
          bytes: file.bytes,
          durationMs: file.durationMs,
          onProgress: (progress) => {
            setStage({
              phase: "compressing",
              percent: Math.min(100, Math.max(0, progress.percent)),
            });
          },
          uri: file.uri,
        });
        if (abortController.signal.aborted) return;

        const trimStartMs = file.trimStartMs ?? 0;
        const trimEndMs = file.trimEndMs ?? compressed.durationMs;
        const intent = await createEventCoverVideoUploadIntent({
          target: serverTarget,
          applyMode,
          brandId,
          // ORCH-0989: brand-target carries no eventId.
          eventId: serverTarget === "brand" ? undefined : eventId,
          sourceBytes: compressed.bytes,
          sourceDurationMs: compressed.durationMs,
          sourceFileName: file.fileName ?? null,
          sourceMimeType: file.mimeType ?? null,
          trimEndMs,
          trimStartMs,
        });
        jobIdRef.current = intent.jobId;
        setStage({ phase: "uploading", percent: 0 });

        const providerUploadResponse = await uploadEventCoverVideoSource({
          bytes: compressed.bytes,
          fileName: file.fileName,
          jobId: intent.jobId,
          mimeType: file.mimeType,
          onProgress: (progress) => {
            setStage({ phase: "uploading", percent: progress.percent });
          },
          signal: abortController.signal,
          upload: intent.upload,
          uri: compressed.uri,
        });
        if (abortController.signal.aborted) return;

        const acknowledged = await acknowledgeEventCoverVideoSourceUploaded({
          target: serverTarget,
          brandId,
          eventId: serverTarget === "brand" ? undefined : eventId,
          jobId: intent.jobId,
          providerUploadResponse,
        });
        setStatus(acknowledged);
        setStage({ phase: "processing", percent: acknowledged.progressPercent ?? 90 });

        const ready = await waitForEventCoverVideoReady(intent.jobId, {
          onStatus: (nextStatus) => {
            setStatus(nextStatus);
            if (nextStatus.status === "processing" || nextStatus.status === "processing_queued") {
              setStage({
                phase: "processing",
                percent: nextStatus.progressPercent ?? 90,
              });
            }
          },
        });
        // ORCH-0989: brand-target persists on ready via the apply fn (writes
        // brands.cover_media_url + cover_media_type='video'). Event-target
        // keeps its existing apply path (draft_auto auto-applies in the
        // webhook; published_manual applies through the event publish flow).
        // META-ORCH-1255(C) D-C: the VENUE target must NOT apply — the apply
        // fn writes brands.cover_media_url; the venue host persists the
        // processed URL to venue_listings via syncHeroMedia instead.
        if (target === "brand") {
          await applyEventCoverVideoJob(intent.jobId);
        }
        setStatus(ready);
        setProcessedUrl(ready.processedUrl);
        setProcessedPosterUrl(ready.processedPosterUrl);
        setLocalPreviewUri(null);
        setStage({ phase: "ready", percent: 100 });
        invalidateEventCaches();
      } catch (caught) {
        if (abortController.signal.aborted) return;
        const nextError =
          caught instanceof Error ? caught : new Error("Video upload failed.");
        const errorCode =
          "code" in nextError && typeof nextError.code === "string"
            ? nextError.code
            : "video_upload_failed";
        setLocalPreviewUri(null);
        logEventCoverVideoUploadTelemetry("video_cover_upload_preview_rolled_back", {
          applyMode,
          errorCode,
          eventId,
          jobId: jobIdRef.current ?? undefined,
          phase: "upload_intent",
          timestamp: new Date().toISOString(),
        });
        setError(nextError);
        setStage({
          code: "video_upload_failed",
          message: nextError.message,
          percent: 0,
          phase: "error",
        });
      }
    },
    [applyMode, brandId, eventId, invalidateEventCaches, serverTarget, target],
  );

  const cancel = useCallback(async (): Promise<void> => {
    const jobId = jobIdRef.current;
    const uploadAbortController = abortControllerRef.current;
    uploadAbortController?.abort();
    setLocalPreviewUri(null);
    if (jobId === null) {
      setStage(idleStage);
      return;
    }
    const cancelled = await cancelEventCoverVideoJob({
      jobId,
      uploadAbortController,
    });
    setStatus(cancelled);
    setStage(idleStage);
    invalidateEventCaches();
  }, [invalidateEventCaches]);

  return {
    cancel,
    error,
    localPreviewUri,
    processedUrl,
    processedPosterUrl,
    stage,
    start,
    status,
  };
}
