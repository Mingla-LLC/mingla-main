import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  acknowledgeEventCoverVideoSourceUploaded,
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

export function useEventCoverVideoUpload(
  eventId: string,
  brandId: string,
  applyMode: EventCoverVideoApplyMode = "draft_auto",
): {
  start: (file: EventCoverVideoUploadFile) => Promise<void>;
  cancel: () => Promise<void>;
  stage: EventCoverVideoUploadStage;
  status: EventCoverVideoStatus | null;
  processedUrl: string | null;
  localPreviewUri: string | null;
  error: Error | null;
} {
  const queryClient = useQueryClient();
  const abortControllerRef = useRef<AbortController | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const [stage, setStage] = useState<EventCoverVideoUploadStage>(idleStage);
  const [status, setStatus] = useState<EventCoverVideoStatus | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [localPreviewUri, setLocalPreviewUri] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const invalidateEventCaches = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: businessEventKeys.detail(eventId) });
    void queryClient.invalidateQueries({ queryKey: businessEventKeys.list(brandId) });
    void queryClient.invalidateQueries({ queryKey: eventDraftKeys.detail(eventId) });
    void queryClient.invalidateQueries({ queryKey: eventDraftKeys.list(brandId) });
    void queryClient.invalidateQueries({ queryKey: publicEventKeys.detailById(eventId) });
    void queryClient.invalidateQueries({ queryKey: upcomingKeys.all });
  }, [brandId, eventId, queryClient]);

  const start = useCallback(
    async (file: EventCoverVideoUploadFile): Promise<void> => {
      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      jobIdRef.current = null;
      setError(null);
      setStatus(null);
      setProcessedUrl(null);
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
          applyMode,
          brandId,
          eventId,
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
          brandId,
          eventId,
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
        setStatus(ready);
        setProcessedUrl(ready.processedUrl);
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
    [applyMode, brandId, eventId, invalidateEventCaches],
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
    stage,
    start,
    status,
  };
}
