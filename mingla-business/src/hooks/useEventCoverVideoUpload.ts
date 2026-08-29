import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import {
  acknowledgeEventCoverVideoSourceUploaded, applyEventCoverVideoJob, cancelEventCoverVideoJob,
  compressVideoLocally, createEventCoverVideoUploadIntent, EventCoverVideoProcessingError,
  fetchEventCoverVideoStatus, fetchEventCoverVideoStatusByTarget, type EventCoverVideoApplyMode,
  type EventCoverVideoStatus, type EventCoverVideoUploadIntent, type EventCoverVideoUploadStage,
  logEventCoverVideoUploadTelemetry,
  uploadEventCoverVideoSource, waitForEventCoverVideoReady,
} from "../services/eventCoverVideoProcessingService";
import {
  deletePreparedEventCoverVideoSource, prepareEventCoverVideoSource,
  type PreparedEventCoverVideoSource,
} from "../services/eventCoverVideoPreparedSource";
import {
  clearPersistedCoverVideoJobsForUser, readPersistedCoverVideoJob,
  removePersistedCoverVideoJob, type PersistedCoverVideoJob, writePersistedCoverVideoJob,
} from "../services/eventCoverVideoJobPersistence";
import { supabase } from "../services/supabase";
import { validateNativeTrimmedEventCoverVideo } from "../utils/eventCoverNativeVideo";
import { brandKeys } from "./useBrands";
import { businessEventKeys } from "./useBusinessEvents";
import { publicEventKeys } from "./usePublicEvents";
import { eventDraftKeys } from "./useServerDraftEvents";
import { upcomingKeys } from "./upcomingKeys";

const idleStage: EventCoverVideoUploadStage = { phase: "idle", percent: 0 };
export type EventCoverVideoUploadFile = {
  uri: string; fileName?: string | null; mimeType?: string | null;
  bytes: number; durationMs: number; trimStartMs?: number; trimEndMs?: number;
};
export type CoverVideoTargetKind = "event" | "brand" | "experience" | "venue" | "venue_draft";
type ExactTarget = {
  serverTarget: "event" | "brand" | "venue" | "venue_draft";
  eventId?: string; venueId?: string; draftOwnerKey?: string;
};
const newOperationId = (): string => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
  ? crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (digit) =>
    (Number(digit) ^ Math.floor(Math.random() * 16) >> Number(digit) / 4).toString(16));
const recoverableCodes = new Set([
  "edge_error", "source_upload_failed", "transport_integrity_failed", "upload_incomplete",
  "upload_initializing", "upload_temporarily_unavailable", "upload_verification_pending",
]);
const isRecoverable = (error: unknown): boolean =>
  error instanceof EventCoverVideoProcessingError && recoverableCodes.has(error.code);
const safeUploadError = (error: unknown): Error => error instanceof EventCoverVideoProcessingError
  ? error
  : error instanceof Error && "code" in error && error.code === "unauthenticated"
  ? Object.assign(new Error("Finishing sign-in. Try again in a moment."), { code: "unauthenticated" })
  : new EventCoverVideoProcessingError(
    "video_upload_failed",
    "We couldn't finish this video upload. Try again, or choose another video.",
  );
const currentUserId = async (): Promise<string> => {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user.id) {
    throw new EventCoverVideoProcessingError("unauthenticated", "Finishing sign-in. Try again in a moment.");
  }
  return data.session.user.id;
};

export function useEventCoverVideoUpload(
  eventId: string,
  brandId: string,
  applyMode: EventCoverVideoApplyMode = "draft_auto",
  target: CoverVideoTargetKind = "event",
  identity: { venueId?: string; draftOwnerKey?: string } = {},
) {
  const queryClient = useQueryClient();
  const exactTarget = useMemo<ExactTarget>(() => target === "brand"
    ? { serverTarget: "brand" }
    : target === "venue"
    ? { serverTarget: "venue", venueId: identity.venueId }
    : target === "venue_draft"
    ? { serverTarget: "venue_draft", draftOwnerKey: identity.draftOwnerKey }
    : { serverTarget: "event", eventId }, [eventId, identity.draftOwnerKey, identity.venueId, target]);
  const persistenceKey = useMemo(() => exactTarget.serverTarget === "event"
    ? `event:${eventId}`
    : exactTarget.serverTarget === "brand"
    ? `brand:${brandId}`
    : exactTarget.serverTarget === "venue"
    ? `venue:${identity.venueId ?? "invalid"}`
    : `venue-draft:${brandId}:${identity.draftOwnerKey??"invalid"}`,
  [brandId, eventId, exactTarget.serverTarget, identity.draftOwnerKey, identity.venueId]);
  const replacementPersistenceKey = `${persistenceKey}:replacement`;
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const jobIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const [stage, setStage] = useState<EventCoverVideoUploadStage>(idleStage);
  const [status, setStatus] = useState<EventCoverVideoStatus | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [processedPosterUrl, setProcessedPosterUrl] = useState<string | null>(null);
  const [localPreviewUri, setLocalPreviewUri] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const preparationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preparationVisibleRef = useRef(false);
  const pendingPreparationStageRef = useRef<EventCoverVideoUploadStage>({ phase: "preparing", percent: 0 });

  const clearPreparationProjection = useCallback((): void => {
    if (preparationTimerRef.current !== null) clearTimeout(preparationTimerRef.current);
    preparationTimerRef.current = null;
    preparationVisibleRef.current = false;
  }, []);
  const beginPreparationProjection = useCallback((): void => {
    clearPreparationProjection();
    pendingPreparationStageRef.current = { phase: "preparing", percent: 0 };
    preparationTimerRef.current = setTimeout(() => {
      preparationTimerRef.current = null;
      preparationVisibleRef.current = true;
      setStage(pendingPreparationStageRef.current);
    }, 300);
  }, [clearPreparationProjection]);
  const projectPreparation = useCallback((next: EventCoverVideoUploadStage): void => {
    pendingPreparationStageRef.current = next;
    if (preparationVisibleRef.current) setStage(next);
  }, []);

  const invalidate = useCallback((): void => {
    if (target === "venue" || target === "venue_draft") return;
    if (exactTarget.serverTarget === "brand") {
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
  }, [brandId, eventId, exactTarget.serverTarget, queryClient, target]);

  const project = useCallback((next: EventCoverVideoStatus): void => {
    setStatus(next);
    if (next.status === "ready" || next.status === "applied") {
      setProcessedUrl(next.processedUrl);
      setProcessedPosterUrl(next.processedPosterUrl);
      setLocalPreviewUri(null);
      setStage({
        phase: next.status === "ready" && (target === "venue" || target === "venue_draft")
          ? "applying"
          : next.status,
        percent: 100,
      });
      invalidate();
    } else if (next.status === "source_uploading") {
      setStage({ phase: "ack_pending", percent: 0 });
    } else if (["source_uploaded", "processing_queued", "processing"].includes(next.status)) {
      setStage({ phase: "processing", percent: next.progressKind === "determinate" ? next.progressPercent : null });
    }
  }, [invalidate, target]);

  const persist = useCallback(async (
    userId: string, prepared: PreparedEventCoverVideoSource, operationId: string,
    jobId: string | null, sourceAcknowledged: boolean, trimStartMs: number, trimEndMs: number,
    key = persistenceKey,
  ): Promise<void> => writePersistedCoverVideoJob({
    userId, key, jobId, clientOperationId: operationId,
    sourceUri: prepared.uri, sourceFingerprint: prepared.fingerprint,
    sourceBytes: prepared.bytes, sourceDurationMs: prepared.durationMs,
    sourceFileName: prepared.fileName, sourceMimeType: prepared.mimeType,
    sourceExtension: prepared.extension, sourceSha256: prepared.sha256,
    trimStartMs, trimEndMs, sourceAcknowledged,
  }), [persistenceKey]);

  const cleanupPersisted = useCallback(async (userId: string): Promise<void> => {
    const persisted = await readPersistedCoverVideoJob(userId, persistenceKey);
    if (persisted?.sourceUri) await deletePreparedEventCoverVideoSource(persisted.sourceUri);
    await removePersistedCoverVideoJob(userId, persistenceKey);
  }, [persistenceKey]);

  const settleCanonical = useCallback(async (
    next: EventCoverVideoStatus,
    signal?: AbortSignal,
  ): Promise<EventCoverVideoStatus> => {
    project(next);
    if (next.status === "ready" && (target === "event" || target === "brand")) {
      setStage({ phase: "applying", percent: 100 });
      await applyEventCoverVideoJob(next.jobId, next.applicationVersion, next.processedUrl ?? undefined);
      const applied = await fetchEventCoverVideoStatus(next.jobId, signal);
      project(applied);
      if (applied.status === "applied" && userIdRef.current) await cleanupPersisted(userIdRef.current);
      return applied;
    }
    if (["applied", "failed", "cancelled", "superseded"].includes(next.status) && userIdRef.current) {
      await cleanupPersisted(userIdRef.current);
    }
    return next;
  }, [cleanupPersisted, project, target]);

  const watch = useCallback(async (
    jobId: string, signal: AbortSignal, generation: number,
  ): Promise<void> => {
    try {
      const ready = await waitForEventCoverVideoReady(jobId, {
        onStatus: (next) => { if (generationRef.current === generation) project(next); },
        pollIntervalMs: 2_000,
        signal,
      });
      if (generationRef.current !== generation) return;
      await settleCanonical(ready, signal);
    } catch (caught) {
      if (caught instanceof EventCoverVideoProcessingError && caught.lastStatus?.isTerminal && userIdRef.current) {
        await cleanupPersisted(userIdRef.current);
      }
      throw caught;
    }
  }, [cleanupPersisted, project, settleCanonical]);

  const uploadPrepared = useCallback(async (
    prepared: PreparedEventCoverVideoSource,
    operationId: string,
    persisted?: PersistedCoverVideoJob,
    replacing = false,
    onAccepted?: () => void,
  ): Promise<void> => {
    const userId = await currentUserId();
    userIdRef.current = userId;
    let generation = generationRef.current;
    let abort = new AbortController();
    const trimStartMs = persisted?.trimStartMs ?? 0;
    const trimEndMs = persisted?.trimEndMs ?? prepared.durationMs;
    const provisionalKey = replacementPersistenceKey;
    setError(null);
    if (!replacing) {
      generation = ++generationRef.current;
      abortRef.current?.abort();
      abortRef.current = abort;
      setLocalPreviewUri(prepared.uri);
      await persist(userId, prepared, operationId, persisted?.jobId ?? null, false, trimStartMs, trimEndMs);
      projectPreparation({ phase: "intent_pending", percent: 0 });
    } else {
      // Crash-safe replacement ordering: preserve the old target record and its
      // bytes while durably staging the candidate under a separate operation key.
      await persist(userId, prepared, operationId, null, false, trimStartMs, trimEndMs, provisionalKey);
    }
    const intentInput = {
      target: exactTarget.serverTarget, eventId: exactTarget.eventId, venueId: exactTarget.venueId,
      draftOwnerKey: exactTarget.draftOwnerKey, clientOperationId: operationId, applyMode, brandId,
      sourceBytes: prepared.bytes, sourceDurationMs: prepared.durationMs,
      sourceFileName: prepared.fileName, sourceMimeType: prepared.mimeType,
      sourceExtension: prepared.extension, sourceSha256: prepared.sha256,
      trimStartMs, trimEndMs,
    };
    let intent: EventCoverVideoUploadIntent;
    try {
      intent = await createEventCoverVideoUploadIntent(intentInput);
    } catch (caught) {
      if (replacing) {
        await removePersistedCoverVideoJob(userId, provisionalKey, { preserveSource: true });
      }
      throw caught;
    }
    if (replacing) {
      // The old watcher, persistence, and prepared bytes remain authoritative
      // until this exact point: the server has accepted/replayed the replacement.
      generation = ++generationRef.current;
      abortRef.current?.abort();
      abort = new AbortController();
      abortRef.current = abort;
      jobIdRef.current = intent.jobId;
      // Correlate the journal with the accepted job before promoting the target.
      // If target persistence fails, remount can still recover this operation.
      await persist(userId, prepared, operationId, intent.jobId, false, trimStartMs, trimEndMs, provisionalKey);
      try {
        await persist(userId, prepared, operationId, intent.jobId, false, trimStartMs, trimEndMs);
      } catch (caught) {
        setLocalPreviewUri(prepared.uri);
        onAccepted?.();
        throw caught;
      }
      setLocalPreviewUri(prepared.uri);
      onAccepted?.();
      // Once the authoritative target record points at the accepted job, old
      // record/byte cleanup is best effort and can never roll the UI back.
      try {
        await removePersistedCoverVideoJob(userId, provisionalKey, { preserveSource: true });
      } catch { /* the target record already owns the prepared source */ }
      if (persisted?.sourceUri && persisted.sourceUri !== prepared.uri) {
        try { await deletePreparedEventCoverVideoSource(persisted.sourceUri); } catch { /* orphan cleanup is retry-safe */ }
      }
    }
    clearPreparationProjection();
    jobIdRef.current = intent.jobId;
    if (!replacing) {
      await persist(userId, prepared, operationId, intent.jobId, false, trimStartMs, trimEndMs);
    }
    while ("status" in intent) {
      const pendingIntent = intent;
      project(pendingIntent.status);
      if (!pendingIntent.initializing) {
        await settleCanonical(pendingIntent.status, abort.signal);
        return;
      }
      setStage({ phase: "intent_pending", percent: 0 });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, pendingIntent.retryAfterMs);
        abort.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        }, { once: true });
      });
      const replay = await createEventCoverVideoUploadIntent(intentInput);
      if (replay.jobId !== intent.jobId) {
        throw new EventCoverVideoProcessingError("operation_conflict", "The replacement changed while it was being accepted.");
      }
      intent = replay;
      await persist(userId, prepared, operationId, intent.jobId, false, trimStartMs, trimEndMs);
    }
    let acceptedIntent = intent;
    setStatus(null);
    setStage({ phase: "uploading", percent: 0 });
    const upload = (): Promise<unknown> => uploadEventCoverVideoSource({
      bytes: prepared.bytes, fileName: prepared.fileName, jobId: acceptedIntent.jobId,
      mimeType: prepared.mimeType, uri: prepared.uri, upload: acceptedIntent.upload, signal: abort.signal,
      onProgress: (progress) => {
        if (generationRef.current === generation) setStage({ phase: "uploading", percent: progress.percent });
      },
    });
    try {
      await upload();
    } catch (uploadError) {
      const expired = uploadError instanceof EventCoverVideoProcessingError &&
        ["tus_head_http_404", "tus_head_http_410"].includes(uploadError.edgeDetail ?? "");
      if (!expired) throw uploadError;
      const refreshedIntent = await createEventCoverVideoUploadIntent({ ...intentInput, refreshTransport: true });
      if (refreshedIntent.jobId !== jobIdRef.current || "status" in refreshedIntent) {
        throw new EventCoverVideoProcessingError(
          "transport_integrity_failed",
          "We couldn't resume this upload. Choose the original video again.",
        );
      }
      acceptedIntent = refreshedIntent;
      await upload();
    }
    setStage({ phase: "ack_pending", percent: 0 });
    let acknowledged = await acknowledgeEventCoverVideoSourceUploaded({
      target: exactTarget.serverTarget, brandId, eventId: exactTarget.eventId, jobId: acceptedIntent.jobId,
    });
    while (acknowledged.status === "source_uploading") {
      project(acknowledged);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 2_000);
        abort.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        }, { once: true });
      });
      acknowledged = await acknowledgeEventCoverVideoSourceUploaded({
        target: exactTarget.serverTarget, brandId, eventId: exactTarget.eventId, jobId: acceptedIntent.jobId,
      });
    }
    project(acknowledged);
    await persist(userId, prepared, operationId, acceptedIntent.jobId, true, trimStartMs, trimEndMs);
    await watch(acceptedIntent.jobId, abort.signal, generation);
  }, [applyMode, brandId, clearPreparationProjection, exactTarget, persist, persistenceKey, project, projectPreparation, replacementPersistenceKey, settleCanonical, watch]);

  const startInternal = useCallback(async (
    file: EventCoverVideoUploadFile,
    replacing: boolean,
  ): Promise<void> => {
    let prepared: PreparedEventCoverVideoSource | null = null;
    let replacementAccepted = false;
    try {
      const userId = await currentUserId();
      userIdRef.current = userId;
      const persisted = await readPersistedCoverVideoJob(userId, persistenceKey);
      const operationId = replacing ? newOperationId() : persisted?.clientOperationId ?? newOperationId();
      if (!replacing) {
        beginPreparationProjection();
        projectPreparation({ phase: "validating", percent: 0 });
      }
      const valid = validateNativeTrimmedEventCoverVideo({
        uri: file.uri, duration: file.durationMs, fileSize: file.bytes,
        mimeType: file.mimeType, fileName: file.fileName,
      }, { maxDurationMs: 15_000, maxSourceBytes: 104_857_600, allowWebm: Platform.OS === "web" });
      if (!valid.ok) throw new EventCoverVideoProcessingError(valid.code, valid.message);
      if (!replacing) projectPreparation({ phase: "compressing", percent: null });
      const compressed = await compressVideoLocally({
        uri: file.uri, bytes: file.bytes, durationMs: file.durationMs,
        onProgress: (progress) => {
          if (!replacing) projectPreparation({ phase: "compressing", percent: progress.percent });
        },
      });
      prepared = await prepareEventCoverVideoSource({
        uri: compressed.uri, bytes: compressed.bytes, durationMs: compressed.durationMs,
        fileName: compressed.wasCompressed ? `${operationId}.mp4` : file.fileName,
        mimeType: compressed.wasCompressed ? "video/mp4" : file.mimeType, operationId,
      });
      if (!replacing&&persisted&&!persisted.sourceAcknowledged&&persisted.sourceSha256!==prepared.sha256) {
        await deletePreparedEventCoverVideoSource(prepared.uri);
        throw new EventCoverVideoProcessingError(
          "source_mismatch",
          "Choose the same video to resume this upload, or cancel it first.",
        );
      }
      await uploadPrepared(
        prepared,
        operationId,
        persisted ?? undefined,
        replacing,
        () => { replacementAccepted = true; },
      );
    } catch (caught) {
      clearPreparationProjection();
      if (abortRef.current?.signal.aborted) return;
      const next = safeUploadError(caught);
      if (replacing && !replacementAccepted) {
        if (prepared?.uri) await deletePreparedEventCoverVideoSource(prepared.uri);
        // No replacement was accepted: the old watcher/projection/persistence
        // never moved, so surface the finite error to the picker and keep it.
        throw next;
      }
      setLocalPreviewUri(null);
      logEventCoverVideoUploadTelemetry("video_cover_upload_preview_rolled_back", {
        applyMode,
        errorCode: "code" in next && typeof next.code === "string" ? next.code : "video_upload_failed",
        eventId, jobId: jobIdRef.current ?? undefined, phase: "upload_intent",
        timestamp: new Date().toISOString(),
      });
      if (isRecoverable(next)) {
        setStage({ phase: "detached", percent: 0, sourceAcknowledged: status?.sourceUploadedAt != null });
      } else {
        setError(next);
        setStage({ phase: "error", percent: 0, code: "video_upload_failed", message: next.message });
      }
    }
  }, [applyMode, beginPreparationProjection, clearPreparationProjection, eventId, persistenceKey, projectPreparation, status?.sourceUploadedAt, uploadPrepared]);

  const start = useCallback((file: EventCoverVideoUploadFile): Promise<void> => startInternal(file, false), [startInternal]);
  const replace = useCallback((file: EventCoverVideoUploadFile): Promise<void> => startInternal(file, true), [startInternal]);

  const resume = useCallback(async (): Promise<void> => {
    let persisted: PersistedCoverVideoJob | null = null;
    const generation = ++generationRef.current;
    const abort = new AbortController();
    abortRef.current?.abort();
    abortRef.current = abort;
    setStage({ phase: "reattaching", percent: 0 });
    try {
      const userId = await currentUserId();
      userIdRef.current = userId;
      persisted = await readPersistedCoverVideoJob(userId, persistenceKey);
      const provisional = await readPersistedCoverVideoJob(userId, replacementPersistenceKey);
      let recoveredReplacement: EventCoverVideoStatus | null = null;
      if (provisional) {
        recoveredReplacement = await fetchEventCoverVideoStatusByTarget({
          target: exactTarget.serverTarget, eventId: exactTarget.eventId, brandId,
          venueId: exactTarget.venueId, draftOwnerKey: exactTarget.draftOwnerKey, signal: abort.signal,
        });
        const recoveredReplacementMatchesProvisional = recoveredReplacement !== null &&
          recoveredReplacement.clientOperationId === provisional.clientOperationId &&
          (provisional.jobId === null || provisional.jobId === recoveredReplacement.jobId);
        if (
          recoveredReplacement && recoveredReplacementMatchesProvisional &&
          recoveredReplacement.jobId !== persisted?.jobId
        ) {
          const previousSourceUri = persisted?.sourceUri ?? null;
          const promoted: PersistedCoverVideoJob = {
            ...provisional,
            key: persistenceKey,
            jobId: recoveredReplacement.jobId,
          };
          // Target-first promotion is the recovery commit. Journal removal is
          // best effort and preserves the source now owned by the target record.
          await writePersistedCoverVideoJob(promoted);
          persisted = promoted;
          try {
            await removePersistedCoverVideoJob(userId, replacementPersistenceKey, { preserveSource: true });
          } catch { /* promoted target is already durable */ }
          if (previousSourceUri && previousSourceUri !== provisional.sourceUri) {
            try { await deletePreparedEventCoverVideoSource(previousSourceUri); } catch { /* orphan cleanup is retry-safe */ }
          }
        } else if (
          recoveredReplacement && recoveredReplacementMatchesProvisional &&
          provisional.jobId === recoveredReplacement.jobId &&
          persisted?.jobId === recoveredReplacement.jobId
        ) {
          // Promotion committed before the crash; remove only the duplicate
          // journal record because the target record owns the same source.
          try {
            await removePersistedCoverVideoJob(userId, replacementPersistenceKey, { preserveSource: true });
          } catch { /* retry on next mount */ }
        } else {
          // No accepted replacement is authoritative, so only now is it safe to
          // discard the provisional record and its candidate source.
          try { await removePersistedCoverVideoJob(userId, replacementPersistenceKey); } catch { /* retry on next mount */ }
        }
      }
      if (
        recoveredReplacement &&
        recoveredReplacement.clientOperationId === persisted?.clientOperationId &&
        persisted?.jobId === recoveredReplacement.jobId &&
        recoveredReplacement.status !== "source_uploading"
      ) {
        jobIdRef.current = recoveredReplacement.jobId;
        const settled = await settleCanonical(recoveredReplacement, abort.signal);
        if (!settled.isTerminal) await watch(recoveredReplacement.jobId, abort.signal, generation);
        return;
      }
      if (persisted && !persisted.sourceAcknowledged) {
        if (Platform.OS === "web") {
          jobIdRef.current = persisted.jobId;
          setStage({ phase: "detached", percent: 0, sourceAcknowledged: false });
          return;
        }
        const prepared: PreparedEventCoverVideoSource = {
          uri: persisted.sourceUri!, bytes: persisted.sourceBytes,
          durationMs: persisted.sourceDurationMs, fileName: persisted.sourceFileName!,
          mimeType: persisted.sourceMimeType!,
          extension: persisted.sourceExtension as PreparedEventCoverVideoSource["extension"],
          sha256: persisted.sourceSha256, fingerprint: persisted.sourceFingerprint!,
        };
        await uploadPrepared(prepared,persisted.clientOperationId,persisted);
        return;
      }
      if (persisted?.jobId) {
        jobIdRef.current = persisted.jobId;
        const settled = await settleCanonical(
          await fetchEventCoverVideoStatus(persisted.jobId, abort.signal), abort.signal,
        );
        if (!settled.isTerminal) await watch(persisted.jobId, abort.signal, generation);
        return;
      }
      const recovered = await fetchEventCoverVideoStatusByTarget({
        target: exactTarget.serverTarget, eventId: exactTarget.eventId, brandId,
        venueId: exactTarget.venueId, draftOwnerKey: exactTarget.draftOwnerKey, signal: abort.signal,
      });
      if (!recovered) { setStage(idleStage); return; }
      jobIdRef.current = recovered.jobId;
      const settled = await settleCanonical(recovered, abort.signal);
      if (!settled.isTerminal) await watch(recovered.jobId, abort.signal, generation);
    } catch {
      if (!abort.signal.aborted) {
        setStage(persisted
          ? { phase: "detached", percent: 0, sourceAcknowledged: persisted.sourceAcknowledged }
          : idleStage);
      }
    }
  }, [brandId, exactTarget, persistenceKey, replacementPersistenceKey, settleCanonical, uploadPrepared, watch]);

  useEffect(() => {
    void resume();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" && userIdRef.current) {
        void clearPersistedCoverVideoJobsForUser(userIdRef.current);
        userIdRef.current = null;
        abortRef.current?.abort();
      }
    });
    return () => {
      clearPreparationProjection();
      generationRef.current += 1;
      abortRef.current?.abort();
      subscription.unsubscribe();
    };
  }, [clearPreparationProjection, resume]);

  const checkNow = useCallback(async (): Promise<void> => {
    if (jobIdRef.current) await settleCanonical(await fetchEventCoverVideoStatus(jobIdRef.current));
  }, [settleCanonical]);
  const acknowledgeApplied = useCallback(async (): Promise<void> => {
    if (!jobIdRef.current || !status?.processedUrl) return;
    setStage({ phase: "applying", percent: 100 });
    await applyEventCoverVideoJob(jobIdRef.current, status.applicationVersion, status.processedUrl);
    const next = await fetchEventCoverVideoStatus(jobIdRef.current);
    project(next);
    if (next.status === "applied" && userIdRef.current) await cleanupPersisted(userIdRef.current);
  }, [cleanupPersisted, project, status]);
  const cancel = useCallback(async (): Promise<void> => {
    generationRef.current += 1;
    abortRef.current?.abort();
    if (!jobIdRef.current) {
      if (userIdRef.current) await cleanupPersisted(userIdRef.current);
      setLocalPreviewUri(null);
      setStage(idleStage);
      return;
    }
    const canonical = await cancelEventCoverVideoJob(jobIdRef.current);
    if (canonical.status === "ready" || canonical.status === "applied") {
      await settleCanonical(canonical);
      return;
    }
    project(canonical);
    if (["cancelled", "superseded", "failed"].includes(canonical.status)) {
      if (userIdRef.current) await cleanupPersisted(userIdRef.current);
      setLocalPreviewUri(null);
      setStage(idleStage);
    }
  }, [cleanupPersisted, project, settleCanonical]);

  return {
    acknowledgeApplied, cancel, checkNow, error, localPreviewUri,
    processedPosterUrl, processedUrl, replace, resume, stage, start, status,
  };
}
