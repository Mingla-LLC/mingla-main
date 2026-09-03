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
// Issue #3074 — "Reconnecting to your video…" must be a PHASE, never a resting
// place. Observed on 2026-09-03 sitting there for 39 minutes against a job that
// had been terminally `failed` for 39 minutes: the resume path took a branch
// that never reached a settle, and nothing else was watching. The #2974 comment
// in the catch below documents an EARLIER trigger for the same stall, which is
// the argument for a deadline rather than a third per-trigger patch — whatever
// the branch, the sheet lands on the job's canonical status.
const REATTACH_DEADLINE_MS = 12_000;
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
// issue #2974 — a definite server answer is NOT a reason to keep waiting. Every
// code here comes from a 4xx or from a terminal job state: retrying it produces
// the identical answer forever. The picker must show a real, actionable error
// instead of a spinner, and the local upload record must be dropped so the next
// attempt starts clean instead of "reconnecting" to a job that never existed.
const terminalCodes = new Set([
  "event_not_ready", "forbidden", "malformed_response", "not_found",
  "operation_conflict", "provider_not_configured", "source_ack_deadline_exceeded",
  "source_ack_timeout", "source_mismatch", "source_over_cap",
  "source_transport_expired", "source_video_track_missing", "validation_error",
]);
// Issue #3075 — one live transfer per operation, module-scoped so it spans hook
// instances. A JOIN was the obvious shape and it is wrong: a remount would await
// the ORIGINAL transfer, so a wedged one — an interrupted acknowledgement, say —
// would block the remount from ever making progress, which is exactly what
// #2715's adversarial remount test catches. Supersede instead: the newest owner
// aborts the previous transfer for the same operation and takes over.
const activeUploadControllers = new Map<string, AbortController>();

const claimUploadSlot = (key: string, controller: AbortController): void => {
  const previous = activeUploadControllers.get(key);
  if (previous !== undefined && previous !== controller) previous.abort();
  activeUploadControllers.set(key, controller);
};

const releaseUploadSlot = (key: string, controller: AbortController): void => {
  if (activeUploadControllers.get(key) === controller) {
    activeUploadControllers.delete(key);
  }
};

// Slots are keyed `${persistenceKey}:${operationId}`; a cancel knows only the
// target it is cancelling for, not the operation id.
const abortActiveTransfersFor = (persistenceKeyPrefix: string): void => {
  for (const [key, controller] of activeUploadControllers) {
    if (key.startsWith(`${persistenceKeyPrefix}:`)) {
      controller.abort();
      activeUploadControllers.delete(key);
    }
  }
};

const isTerminalUploadError = (error: unknown): boolean =>
  error instanceof EventCoverVideoProcessingError && terminalCodes.has(error.code);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isServerRowId = (value: string | undefined): boolean =>
  typeof value === "string" && UUID_PATTERN.test(value);
// issue #2967 — the client half of the acknowledgement bound. The server owns
// the precise, named failure (`source_ack_deadline_exceeded` at 90s); this is
// the backstop for a server that never produces one — an older deployed edge
// revision, or anything that keeps answering 200/`source_uploading`. It sits
// 60s BEYOND the server deadline so a healthy server always wins the race and
// the user gets the specific failure code rather than this generic one. A
// client that loops forever on a server response is a defect even when the
// server behaves.
export const EVENT_COVER_VIDEO_ACK_DEADLINE_MS = 150_000;
const ACK_POLL_INTERVAL_MS = 2_000;
// issue #3040 — the client half of invariant 2 ("no unbounded wait anywhere").
//
// `waitForEventCoverVideoReady` is a `while (true)` that only exits on a
// TERMINAL job status or an abort. Now that acknowledgement no longer waits for
// the encode (#3039), the encode is where the user's time actually goes — and a
// job that wedges upstream would hold this loop open for as long as the sheet
// is mounted.
//
// Crossing this bound is NOT a failure and must never be rendered as one: the
// job is alive server-side and finishes on its own (an event `draft_auto` job
// is auto-applied by the webhook; every other target applies on the next
// visit). We simply stop WATCHING and hand the user the "Check now" affordance
// the `detached` stage already provides. Nothing is cancelled and nothing is
// destroyed.
//
// WHY 10 MINUTES: the slowest cover video that ever reached `applied` in
// production took 93s (#2905, job fddc283b) against a median of 18s, and #3039
// showed Bunny legitimately taking minutes rather than seconds on a cold
// library. 10 minutes is ~6.5x the slowest observed encode, and it is far
// inside the reaper's 12h stall deadline so the server always owns the real
// verdict.
export const EVENT_COVER_VIDEO_WATCH_DEADLINE_MS = 600_000;
// issue #3073 — `prepareEventCoverVideoSource` refuses a source whose ISO-BMFF
// handler boxes carry no video track (the trim editor can return an audio-only
// MP4). Translating it HERE, at the single point every start-path error already
// funnels through, keeps the prepare call itself a plain direct call — which is
// what ORCH-1308 gate D reads to prove the source is prepared before allocation.
// Matched by NAME, and defined right here rather than imported. Several suites
// mock `../services/eventCoverVideoPreparedSource` partially, so a newly
// imported symbol is `undefined` at runtime in those tests — and calling it (or
// using it as an `instanceof` right-hand side) THROWS, taking the whole suite
// down instead of failing one assertion. Owning the predicate locally means no
// mock can reach it. Same reasoning as the repo's PostgREST error checks, which
// duck-type because those errors arrive as plain objects.
const isMissingVideoTrackError = (error: unknown): boolean =>
  error !== null && typeof error === "object" &&
  (error as { name?: unknown }).name === "EventCoverVideoSourceHasNoVideoTrackError";

const safeUploadError = (error: unknown): Error =>
  isMissingVideoTrackError(error)
  ? new EventCoverVideoProcessingError(
    "source_video_track_missing",
    "That clip came back without any video. Trim it again, or pick a different video.",
  )
  : error instanceof EventCoverVideoProcessingError
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
  // issue #2974 — the generation `uploadPrepared` claimed for the CURRENT
  // delegated flow. `resume()` cannot know it up front (uploadPrepared bumps
  // generationRef itself), and without it resume cannot tell "my delegate
  // failed" from "a newer flow took over" — the ambiguity that made resume's
  // error handler a no-op and stranded the sheet on "Reconnecting to your
  // video…". Reset to null on every resume; set by uploadPrepared on its bump.
  const delegatedGenerationRef = useRef<number | null>(null);
  const userIdRef = useRef<string | null>(null);
  const [stage, setStage] = useState<EventCoverVideoUploadStage>(idleStage);
  // issue #3074 — the deadline below must judge the CURRENT phase, not a flag
  // set optimistically when a branch was entered. The 39-minute stall was a
  // resume that DID hand off to real work (`uploadPrepared`) and then never
  // settled, so "we delegated" is not evidence the spinner is gone.
  const stageRef = useRef<EventCoverVideoUploadStage>(idleStage);
  stageRef.current = stage;
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
    } else if (["failed", "cancelled", "superseded"].includes(next.status)) {
      // issue #3074 — a terminal NON-success used to set `status` and leave the
      // STAGE untouched, so a sheet that was mid-"Reconnecting to your video…"
      // learned the job had failed and went on rendering the spinner anyway.
      // Measured in the field: 39 minutes on the spinner against a job that had
      // been `failed` for 39 minutes. Every other terminal outcome above moves
      // the stage; this branch is the one that did not.
      //
      // `cancelled` and `superseded` are not the host's problem — a superseding
      // upload owns the sheet now, and a cancel was deliberate — so they return
      // the sheet to idle rather than shouting an error at it. Only `failed`
      // becomes an error card, carrying the provider's own failure code so the
      // picker can name it and offer the job code.
      setStage(next.status === "failed"
        ? {
          phase: "error",
          percent: 0,
          code: next.failureCode ?? "video_upload_failed",
          message: next.failureMessage
            ?? "We couldn't finish this video. Choose another video, or try again.",
        }
        : idleStage);
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
    // issue #3040 — bound the WATCH, not the job. `waitForEventCoverVideoReady`
    // is a `while (true)`; this controller ends our subscription to it after
    // EVENT_COVER_VIDEO_WATCH_DEADLINE_MS while leaving the server job
    // completely untouched.
    const watchdog = new AbortController();
    const stopWatching = (): void => watchdog.abort();
    // An ALREADY-aborted caller signal never emits another "abort" event, so a
    // listener alone would leave the watchdog live and this wait would never
    // settle — the caller's promise hangs forever. That is reachable in
    // production (the sheet is closed in the same tick the acknowledgement
    // resolves, so `watch` is entered with a dead signal) and it is exactly what
    // #2715's "interrupted acknowledgement + remount" case drives.
    if (signal.aborted) watchdog.abort();
    else signal.addEventListener("abort", stopWatching, { once: true });
    let deadlineReached = false;
    const timer = setTimeout(() => {
      deadlineReached = true;
      watchdog.abort();
    }, EVENT_COVER_VIDEO_WATCH_DEADLINE_MS);
    try {
      const ready = await waitForEventCoverVideoReady(jobId, {
        onStatus: (next) => { if (generationRef.current === generation) project(next); },
        pollIntervalMs: 2_000,
        signal: watchdog.signal,
      });
      if (generationRef.current !== generation) return;
      await settleCanonical(ready, signal);
    } catch (caught) {
      if (deadlineReached && !signal.aborted) {
        // Not a failure. The job is still running server-side and will finish
        // without us; surface the honest "still working" card with its real
        // Check-now control instead of spinning forever.
        if (generationRef.current === generation) {
          setStage({ phase: "detached", percent: 0, sourceAcknowledged: true });
        }
        return;
      }
      if (caught instanceof EventCoverVideoProcessingError && caught.lastStatus?.isTerminal && userIdRef.current) {
        await cleanupPersisted(userIdRef.current);
      }
      throw caught;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", stopWatching);
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
    // issue #3075 — see `signal:` on the upload call below.
    const transferAbort = new AbortController();
    const trimStartMs = persisted?.trimStartMs ?? 0;
    const trimEndMs = persisted?.trimEndMs ?? prepared.durationMs;
    const provisionalKey = replacementPersistenceKey;
    setError(null);
    if (!replacing) {
      generation = ++generationRef.current;
      delegatedGenerationRef.current = generation;
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
      } else if (isTerminalUploadError(caught)) {
        // issue #2974 — the record above was written BEFORE the intent call, so
        // a terminal rejection (e.g. 400 `event_id_invalid_uuid`) leaves a local
        // upload record pointing at a job the server never created. Every later
        // attempt then tries to "reconnect" to that phantom instead of starting
        // fresh — which is what turned a one-off error into a permanently
        // wedged sheet. No job exists, so drop the record AND its staged bytes.
        await cleanupPersisted(userId);
      }
      throw caught;
    }
    if (replacing) {
      // The old watcher, persistence, and prepared bytes remain authoritative
      // until this exact point: the server has accepted/replayed the replacement.
      generation = ++generationRef.current;
      delegatedGenerationRef.current = generation;
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
      mimeType: prepared.mimeType, uri: prepared.uri, upload: acceptedIntent.upload,
      // issue #3075 — the TRANSFER runs on its own controller, deliberately not
      // the one unmount aborts. Unmount must end this instance's WATCH (a
      // subscription nobody is reading any more) without stopping the bytes.
      signal: transferAbort.signal,
      onProgress: (progress) => {
        if (generationRef.current === generation) setStage({ phase: "uploading", percent: progress.percent });
      },
    });
    // issue #3075 — one live transfer per operation, however many sheets mount.
    const uploadSlotKey = `${persistenceKey}:${operationId}`;
    claimUploadSlot(uploadSlotKey, transferAbort);
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
    } finally {
      releaseUploadSlot(uploadSlotKey, transferAbort);
    }
    setStage({ phase: "ack_pending", percent: 0 });
    // issue #2967 — this loop used to be `while (status === "source_uploading")`
    // with a 2s sleep, no iteration cap, no elapsed cap and no failure exit.
    // Paired with a server that answered 200 + `source_uploading` forever
    // whenever Bunny's storageSize stayed zero, it was a literal infinite loop
    // and `ack_pending` is the "Finishing upload…" spinner the user stared at.
    const ackDeadlineAt = Date.now() + EVENT_COVER_VIDEO_ACK_DEADLINE_MS;
    let acknowledged = await acknowledgeEventCoverVideoSourceUploaded({
      target: exactTarget.serverTarget, brandId, eventId: exactTarget.eventId, jobId: acceptedIntent.jobId,
    });
    while (acknowledged.status === "source_uploading") {
      if (Date.now() >= ackDeadlineAt) {
        throw new EventCoverVideoProcessingError(
          "source_ack_timeout",
          "We couldn't confirm this upload with the video service. Try again, or choose another video.",
          { lastStatus: acknowledged, phase: "source_uploaded" },
        );
      }
      project(acknowledged);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ACK_POLL_INTERVAL_MS);
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
    if (["failed", "cancelled", "superseded"].includes(acknowledged.status)) {
      // issue #2967 — the server ended the job DURING acknowledgement (its own
      // 90s deadline, an expired TUS transport, or a cancel). Settle canonical
      // truth and surface it. Never persist `sourceAcknowledged: true` for an
      // acknowledgement that did not happen, and never fall through to watch().
      await settleCanonical(acknowledged, abort.signal);
      throw new EventCoverVideoProcessingError(
        acknowledged.failureCode ?? acknowledged.status,
        acknowledged.status === "cancelled"
          ? "Video upload was cancelled."
          : acknowledged.status === "superseded"
          ? "A newer video was selected."
          : "We couldn't confirm this upload with the video service. Try again, or choose another video.",
        { lastStatus: acknowledged, phase: "source_uploaded" },
      );
    }
    await persist(userId, prepared, operationId, acceptedIntent.jobId, true, trimStartMs, trimEndMs);
    await watch(acceptedIntent.jobId, abort.signal, generation);
  }, [applyMode, brandId, cleanupPersisted, clearPreparationProjection, exactTarget, persist, persistenceKey, project, projectPreparation, replacementPersistenceKey, settleCanonical, watch]);

  const startInternal = useCallback(async (
    file: EventCoverVideoUploadFile,
    replacing: boolean,
  ): Promise<void> => {
    let prepared: PreparedEventCoverVideoSource | null = null;
    let replacementAccepted = false;
    try {
      // issue #2974 — the create-event wizard holds a client-only `d_<ts36>`
      // draft id until the lazy server promotion lands. Sending it to
      // upload-intent is a hard 400 `event_id_invalid_uuid` and NO job row is
      // ever created, so nothing downstream can recover. `CreatorStep4Cover`
      // promotes the draft the moment the Cover step mounts; this is the
      // backstop for the window before that resolves. It is a FINITE, named
      // error the picker renders — never a spinner.
      if (exactTarget.serverTarget === "event" && !isServerRowId(exactTarget.eventId)) {
        throw new EventCoverVideoProcessingError(
          "event_not_ready",
          "This event is still being created. Give it a moment, then add the cover again.",
        );
      }
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
          // issue #2974 — names the control that actually exists in the sheet.
          // The old copy said "cancel it first" while no cancel affordance was
          // reachable from the error card at all.
          "Choose the same video to resume this upload, or tap Discard upload to start over.",
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
  }, [applyMode, beginPreparationProjection, clearPreparationProjection, eventId, exactTarget, persistenceKey, projectPreparation, status?.sourceUploadedAt, uploadPrepared]);

  const start = useCallback((file: EventCoverVideoUploadFile): Promise<void> => startInternal(file, false), [startInternal]);
  const replace = useCallback((file: EventCoverVideoUploadFile): Promise<void> => startInternal(file, true), [startInternal]);

  const resume = useCallback(async (): Promise<void> => {
    let persisted: PersistedCoverVideoJob | null = null;
    let delegated = false;
    const generation = ++generationRef.current;
    delegatedGenerationRef.current = null;
    const abort = new AbortController();
    abortRef.current?.abort();
    abortRef.current = abort;
    setStage({ phase: "reattaching", percent: 0 });
    // issue #3074 — the deadline. The ONLY thing that disarms it is the sheet
    // actually leaving the spinner: if any later phase is showing when this
    // fires, the resume is visibly working and is left alone. A resume that is
    // still on "Reconnecting to your video…" gets overridden by the truth,
    // whichever branch it is stuck in — including a delegated upload that never
    // settles, which is the branch the 39-minute stall was in.
    const reattachDeadline = setTimeout(() => {
      if (stageRef.current.phase !== "reattaching") return;
      if (generationRef.current !== generation) return;
      void (async () => {
        try {
          const jobId = jobIdRef.current ?? persisted?.jobId ?? null;
          const canonical = jobId !== null
            ? await fetchEventCoverVideoStatus(jobId, abort.signal)
            : await fetchEventCoverVideoStatusByTarget({
              target: exactTarget.serverTarget, eventId: exactTarget.eventId, brandId,
              venueId: exactTarget.venueId, draftOwnerKey: exactTarget.draftOwnerKey,
              signal: abort.signal,
            });
          if (stageRef.current.phase !== "reattaching") return;
          if (generationRef.current !== generation) return;
          if (canonical === null) {
            setStage(idleStage);
            return;
          }
          jobIdRef.current = canonical.jobId;
          await settleCanonical(canonical, abort.signal);
        } catch {
          // A failed truth-fetch must still leave the sheet actionable.
          if (stageRef.current.phase === "reattaching" && generationRef.current === generation) setStage(idleStage);
        }
      })();
    }, REATTACH_DEADLINE_MS);
    // Only the error path disarms the timer outright — every success path is
    // already covered by the phase check inside it.
    const leaveReattaching = (): void => { clearTimeout(reattachDeadline); };
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
        delegated = true;
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
    } catch (caught) {
      // issue #3074 — whatever the outcome, the spinner is over.
      leaveReattaching();
      // issue #2974 — this guard used to read `abort.signal.aborted` on the
      // controller resume created. When resume delegates to `uploadPrepared`,
      // that function installs its OWN controller and aborts this one first, so
      // the guard was ALWAYS true on a delegated failure and this handler did
      // nothing at all — leaving the sheet on "Reconnecting to your video…"
      // with no Cancel and no Replace button, forever, for a hard 400. Ask the
      // controller that is CURRENTLY installed instead: it is aborted only when
      // a newer flow, a cancel, or unmount genuinely superseded this resume.
      const ownerGeneration = delegated
        ? delegatedGenerationRef.current ?? generation
        : generation;
      if (generationRef.current !== ownerGeneration) return;
      if (abortRef.current?.signal.aborted === true) return;
      const next = safeUploadError(caught);
      if (isTerminalUploadError(next)) {
        // A definite server answer. Drop the local record (it can only point at
        // a job that cannot be resumed) and show the finite error.
        if (userIdRef.current) await cleanupPersisted(userIdRef.current);
        setError(next);
        setStage({
          phase: "error", percent: 0,
          code: "code" in next && typeof next.code === "string" ? next.code : "video_upload_failed",
          message: next.message,
        });
        return;
      }
      setStage(persisted
        ? { phase: "detached", percent: 0, sourceAcknowledged: persisted.sourceAcknowledged }
        : idleStage);
    }
  }, [brandId, cleanupPersisted, exactTarget, persistenceKey, replacementPersistenceKey, settleCanonical, uploadPrepared, watch]);

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
      // issue #3075 — bumping the generation is what makes this instance stop
      // WRITING (every setStage/progress callback is generation-guarded), and
      // that is all unmount should do. It used to abort the controller too,
      // which killed the transfer itself. The bytes must keep moving: the job
      // is already durable server-side and locally persisted, and
      // `runSingleFlightUpload` stops a remounted sheet from starting a second
      // transfer for the same operation. Explicit cancel, a superseding upload,
      // and SIGNED_OUT still abort — see `abortRef` at those call sites.
      generationRef.current += 1;
      // Ends this instance's WATCH. The transfer runs on its own controller and
      // is deliberately left alone — see issue #3075 above.
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
  // issue #3075 — an explicit cancel is the one gesture that DOES stop the
  // transfer, so it aborts the operation's slot as well as this instance's
  // watch. Unmount is not a cancel.
  const cancel = useCallback(async (): Promise<void> => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortActiveTransfersFor(persistenceKey);
    abortActiveTransfersFor(replacementPersistenceKey);
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
