import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
// #3040 — the lane's numeric contract (one source for every layer). Imported
// from the shared package, never from the processing service, so suites that
// mock the service partially still read real limits.
import { VIDEO_LIMITS } from "@mingla/video-upload";
import {
  acknowledgeEventCoverVideoSourceUploaded, applyEventCoverVideoJob, cancelEventCoverVideoJob,
  compressVideoLocally, createEventCoverVideoUploadIntent, EventCoverVideoProcessingError,
  fetchEventCoverVideoStatus, fetchEventCoverVideoStatusByTarget, type EventCoverVideoApplyMode,
  type EventCoverVideoStatus, type EventCoverVideoUploadIntent, type EventCoverVideoUploadStage,
  EVENT_COVER_SOURCE_CEILING_MS,
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
import { preparedSourceStillExists } from "../services/eventCoverVideoSourcePresence";
import { isActiveLaneStatus, LANE_CODES } from "../services/eventCoverVideoEdgeContract";
import { supabase } from "../services/supabase";
import { validateNativeTrimmedEventCoverVideo } from "../utils/eventCoverNativeVideo";
import {
  coverVideoProcessingTiming, trackProviderProgress, type ProviderProgressTracker,
} from "../utils/eventCoverVideoSlo";
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

// Issue #3119 — the 100 MB source cap used to be applied to the file the host
// PICKED, one line before `compressVideoLocally` — the step whose whole job is
// shrinking exactly that file. So the caps split in two. PICK_CEILING is a
// sanity bound on what a phone can be asked to transcode at all; SOURCE_MAX is
// the real contract with the upload pipeline and is checked against the
// COMPRESSED result.
const EVENT_COVER_PICK_CEILING_BYTES = 524_288_000; // 500 MB
// #3040 B-C20 — from the shared limits table (100 MiB, unchanged value).
const EVENT_COVER_SOURCE_MAX_BYTES = VIDEO_LIMITS.SOURCE_MAX_BYTES;
export type EventCoverVideoUploadFile = {
  uri: string; fileName?: string | null; mimeType?: string | null;
  bytes: number; durationMs: number; trimStartMs?: number; trimEndMs?: number;
};
// #3040 — `ad_creative` (Host Ads and Ari): a non-superseding, owner-keyed
// lane target whose READY job the server turns into an ad creative row.
export type CoverVideoTargetKind = "event" | "brand" | "experience" | "venue" | "venue_draft" | "ad_creative";
type ExactTarget = {
  serverTarget: "event" | "brand" | "venue" | "venue_draft" | "ad_creative";
  eventId?: string; venueId?: string; draftOwnerKey?: string;
};
const newOperationId = (): string => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
  ? crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (digit) =>
    (Number(digit) ^ Math.floor(Math.random() * 16) >> Number(digit) / 4).toString(16));
// #3040 B-C9 [A-9] — "recoverable" means our side or the network failed and the
// SAME operation can continue. Offline is told apart from server trouble by
// the device itself (`isDeviceOffline`), never inferred from the error kind.
const recoverableCodes = new Set([
  "edge_error", "source_upload_failed", "transport_integrity_failed", "upload_incomplete",
  "upload_initializing", "upload_temporarily_unavailable", "upload_verification_pending",
  "internal_error", "network_offline", LANE_CODES.transportRefreshFailed,
  LANE_CODES.transportLeaseExtendFailed, LANE_CODES.transportHasBytes,
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
  "video_compression_failed", "video_compression_stalled",
  // #3040 — answers no retry can change.
  LANE_CODES.clientVersionRequired, "source_file_gone", "ad_video_too_short",
  LANE_CODES.creativeSourceUntrusted, "video_source_type_unsupported", "video_file_too_large",
]);
// #3040 B-C9 — three automatic retries (1 s, 3 s, 9 s) before the card admits
// an interruption (design H-11). During them the card says "Reconnecting…".
export const EVENT_COVER_VIDEO_RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000, 9_000];
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
// the backstop for a server that never produces one. It sits 60s BEYOND the
// server deadline so a healthy server always wins the race.
export const EVENT_COVER_VIDEO_ACK_DEADLINE_MS = 150_000;
const ACK_POLL_INTERVAL_MS = 2_000;
// issue #3040 — the client half of invariant 2 ("no unbounded wait anywhere").
//
// `waitForEventCoverVideoReady` is a `while (true)` that only exits on a
// TERMINAL job status or an abort. Crossing this bound is NOT a failure and must
// never be rendered as one: the job is alive server-side and the server now
// owns its outcome (the reaper applies or expires a READY job, #3040 E-9). We
// simply stop WATCHING and hand the user the "Check now" affordance.
//
// #3040 B-C20 — 11 minutes: the server's processing stall bound (10 min after
// the last byte) plus one reaper tick, so the client stops watching only after
// the server has had its chance to decide.
export const EVENT_COVER_VIDEO_WATCH_DEADLINE_MS = VIDEO_LIMITS.WATCH_DEADLINE_MS;
// #3040 AD-05 — how long the ad flow waits on server materialization before it
// shows "Video is ready, but not saved to the ad" with "Try saving again".
export const AD_CREATIVE_MATERIALIZE_PATIENCE_MS = 20_000;
const AD_CREATIVE_MATERIALIZE_POLL_MS = 2_000;
// issue #3073 — `prepareEventCoverVideoSource` refuses a source whose ISO-BMFF
// handler boxes carry no video track. Matched by NAME, and defined right here
// rather than imported: several suites mock `../services/eventCoverVideoPreparedSource`
// partially, so a newly imported symbol is `undefined` at runtime in those
// tests — and calling it THROWS, taking the whole suite down.
const isMissingVideoTrackError = (error: unknown): boolean =>
  error !== null && typeof error === "object" &&
  (error as { name?: unknown }).name === "EventCoverVideoSourceHasNoVideoTrackError";

// #3040 B-C19/B-C12 — prepare's plain-string failures, in host words.
const PREPARE_ERROR_COPY: Record<string, { code: string; message: string }> = {
  video_source_type_unsupported: {
    code: "video_source_type_unsupported",
    message: "We can't use this file type. Use MP4, MOV, M4V or WebM.",
  },
  video_source_type_unknown: {
    code: "video_source_type_unsupported",
    message: "We can't use this file type. Use MP4, MOV, M4V or WebM.",
  },
  video_source_too_large: {
    code: "video_file_too_large",
    message: "Videos must be under 100 MB. Try a shorter clip, or export it at a lower quality.",
  },
};

const safeUploadError = (error: unknown): Error => {
  if (isMissingVideoTrackError(error)) {
    return new EventCoverVideoProcessingError(
      "source_video_track_missing",
      "That clip came back without any video. Trim it again, or pick a different video.",
    );
  }
  if (error instanceof EventCoverVideoProcessingError) return error;
  if (error instanceof Error && "code" in error && error.code === "unauthenticated") {
    return Object.assign(new Error("Finishing sign-in. Try again in a moment."), { code: "unauthenticated" });
  }
  const mapped = error instanceof Error ? PREPARE_ERROR_COPY[error.message] : undefined;
  if (mapped !== undefined) return new EventCoverVideoProcessingError(mapped.code, mapped.message);
  return new EventCoverVideoProcessingError(
    "video_upload_failed",
    "We couldn't finish this video upload. Try again, or choose another video.",
  );
};
const errorCodeOf = (error: Error): string =>
  "code" in error && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : "video_upload_failed";
const currentUserId = async (): Promise<string> => {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user.id) {
    throw new EventCoverVideoProcessingError("unauthenticated", "Finishing sign-in. Try again in a moment.");
  }
  return data.session.user.id;
};
const sleep = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(new Error("aborted"));
  }, { once: true });
});

export type EventCoverVideoUploadOptions = {
  /**
   * #3040 B-C9 / design T4 — true while the DEVICE reports no network
   * (NetInfo on native, `navigator.onLine` on web). Only then does a
   * recoverable failure read as "offline" (H-10); otherwise it is our side
   * (H-11). Supplied by the picker so this hook never mounts NetInfo itself.
   */
  isDeviceOffline?: () => boolean;
};


// #3040 rework (P2) — best effort with one retry; a failure is logged, never
// swallowed (the replaced ad video would otherwise join the library).
const cancelReplacedAdVideo = async (jobId: string): Promise<void> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await cancelEventCoverVideoJob(jobId);
      return;
    } catch (caught) {
      if (attempt === 1) {
        console.warn("[cover-video] the replaced ad video could not be cancelled", {
          jobId,
          error: caught instanceof Error ? caught.name : "error",
        });
      }
    }
  }
};

export function useEventCoverVideoUpload(
  eventId: string,
  brandId: string,
  applyMode: EventCoverVideoApplyMode = "draft_auto",
  target: CoverVideoTargetKind = "event",
  identity: { venueId?: string; draftOwnerKey?: string } = {},
  options: EventCoverVideoUploadOptions = {},
) {
  const queryClient = useQueryClient();
  const exactTarget = useMemo<ExactTarget>(() => target === "brand"
    ? { serverTarget: "brand" }
    : target === "venue"
    ? { serverTarget: "venue", venueId: identity.venueId }
    : target === "venue_draft"
    ? { serverTarget: "venue_draft", draftOwnerKey: identity.draftOwnerKey }
    : target === "ad_creative"
    ? { serverTarget: "ad_creative", draftOwnerKey: identity.draftOwnerKey }
    : { serverTarget: "event", eventId }, [eventId, identity.draftOwnerKey, identity.venueId, target]);
  // #3040 E-3a — an ad video is never a draft auto-apply.
  const laneApplyMode: EventCoverVideoApplyMode = target === "ad_creative" ? "published_manual" : applyMode;
  const persistenceKey = useMemo(() => exactTarget.serverTarget === "event"
    ? `event:${eventId}`
    : exactTarget.serverTarget === "brand"
    ? `brand:${brandId}`
    : exactTarget.serverTarget === "venue"
    ? `venue:${identity.venueId ?? "invalid"}`
    : exactTarget.serverTarget === "ad_creative"
    ? `ad-creative:${brandId}:${identity.draftOwnerKey ?? "invalid"}`
    : `venue-draft:${brandId}:${identity.draftOwnerKey??"invalid"}`,
  [brandId, eventId, exactTarget.serverTarget, identity.draftOwnerKey, identity.venueId]);
  const replacementPersistenceKey = `${persistenceKey}:replacement`;
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const jobIdRef = useRef<string | null>(null);
  // issue #2974 — the generation `uploadPrepared` claimed for the CURRENT
  // delegated flow (see `resume`).
  const delegatedGenerationRef = useRef<number | null>(null);
  const userIdRef = useRef<string | null>(null);
  // #3040 B-C2 [A-2] — the transfer THIS mount is running, or null. A job in
  // `source_uploading` that no live transfer here owns is NOT "confirming": its
  // bytes may be partial, so it projects as `detached`, never `ack_pending`.
  const transferRef = useRef<AbortController | null>(null);
  // True only while `uploadPrepared` polls the acknowledgement after the LAST
  // byte. It is the one route into `ack_pending` (design truth rule T3).
  const acknowledgingRef = useRef(false);
  // #3040 B-C3 [A-3/T6] — jobs this mount started, or resumed from this
  // device's own persisted record. Only these may ever be emitted as a cover.
  const ownedJobIdsRef = useRef<Set<string>>(new Set());
  // #3040 B-C9 — the prepared source this mount still holds (web blob or
  // native cache file), so an offline pause or an interruption can continue
  // without asking the host to pick again.
  const retainedPreparedRef = useRef<{ prepared: PreparedEventCoverVideoSource; operationId: string } | null>(null);
  const lastUploadProgressRef = useRef<{ confirmedBytes?: number; totalBytes?: number; percent: number | null }>({ percent: 0 });
  const isDeviceOfflineRef = useRef(options.isDeviceOffline);
  isDeviceOfflineRef.current = options.isDeviceOffline;
  const [stage, setStage] = useState<EventCoverVideoUploadStage>(idleStage);
  // issue #3074 — the deadline below must judge the CURRENT phase.
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
  // #3040 D2 — the last provider reading per job, to tell a moving % from a frozen one.
  const providerProgressRef = useRef<ProviderProgressTracker | null>(null);

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
  // #3040 B-C10 — the phase the FLOW is in, even while the 300 ms preparation
  // projection is still hiding it from the card. Unmount reads this.
  const flowPhaseRef = useRef<string>("idle");
  const projectPreparation = useCallback((next: EventCoverVideoUploadStage): void => {
    pendingPreparationStageRef.current = next;
    flowPhaseRef.current = next.phase;
    if (preparationVisibleRef.current) setStage(next);
  }, []);

  const invalidate = useCallback((): void => {
    if (target === "venue" || target === "venue_draft" || target === "ad_creative") return;
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
      // #3040 B-C2 [A-2] / design T3 — "Confirming upload" only while THIS
      // mount is acknowledging bytes it sent in full. A job left mid-transfer
      // (another mount, a reload, an interruption) is honestly `detached`.
      if (acknowledgingRef.current && transferRef.current !== null) {
        setStage({ phase: "ack_pending", percent: 0 });
      } else {
        setStage({
          phase: "detached", percent: 0, sourceAcknowledged: false,
          reason: Platform.OS === "web" ? "repick" : "interrupted",
        });
      }
    } else if (["source_uploaded", "processing_queued", "processing"].includes(next.status)) {
      // #3040 D2 / H-08 — a provider % only while it is real AND moving;
      // otherwise null, which the card renders as indeterminate + elapsed.
      const tracked = trackProviderProgress(
        providerProgressRef.current, next.jobId,
        next.progressKind === "determinate" ? next.progressPercent : null,
      );
      providerProgressRef.current = tracked.tracker;
      setStage({
        phase: "processing", percent: tracked.percent,
        timing: coverVideoProcessingTiming(next.sourceUploadedAt),
      });
    } else if (["failed", "cancelled", "superseded"].includes(next.status)) {
      // issue #3074 — a terminal NON-success moves the stage too. `cancelled`
      // and `superseded` return the sheet to idle; only `failed` becomes an
      // error card, carrying the provider's own failure code.
      setStage(next.status === "failed"
        ? {
          phase: "error",
          percent: 0,
          code: next.failureCode ?? "video_upload_failed",
          message: next.failureMessage
            ?? "We couldn't finish this video. Choose another video, or try again.",
          canRetry: true,
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

  // #3040 AD-03/AD-05 — an `ad_creative` job is applied only once the server
  // has created its creative row (E-6c). A 503 `creative_materialize_pending`
  // is "still saving", polled for a bounded time and then handed to the host
  // as "ready, not saved yet" with a re-apply that needs no re-upload.
  const applyReady = useCallback(async (next: EventCoverVideoStatus): Promise<void> => {
    if (target !== "ad_creative") {
      await applyEventCoverVideoJob(next.jobId, next.applicationVersion, next.processedUrl ?? undefined);
      return;
    }
    const giveUpAt = Date.now() + AD_CREATIVE_MATERIALIZE_PATIENCE_MS;
    for (;;) {
      try {
        await applyEventCoverVideoJob(next.jobId, next.applicationVersion, next.processedUrl ?? undefined);
        return;
      } catch (caught) {
        const pending = caught instanceof EventCoverVideoProcessingError &&
          caught.code === LANE_CODES.creativeMaterializePending;
        if (!pending || Date.now() >= giveUpAt) throw caught;
        await sleep(AD_CREATIVE_MATERIALIZE_POLL_MS);
      }
    }
  }, [target]);

  const settleCanonical = useCallback(async (
    next: EventCoverVideoStatus,
    signal?: AbortSignal,
  ): Promise<EventCoverVideoStatus> => {
    project(next);
    if (next.status === "ready" && (target === "event" || target === "brand" || target === "experience" || target === "ad_creative")) {
      setStage({ phase: "applying", percent: 100 });
      if (target === "ad_creative") await applyReady(next);
      else await applyEventCoverVideoJob(next.jobId, next.applicationVersion, next.processedUrl ?? undefined);
      const applied = await fetchEventCoverVideoStatus(next.jobId, signal);
      project(applied);
      if (applied.status === "applied" && userIdRef.current) await cleanupPersisted(userIdRef.current);
      return applied;
    }
    if (["applied", "failed", "cancelled", "superseded"].includes(next.status) && userIdRef.current) {
      await cleanupPersisted(userIdRef.current);
    }
    return next;
  }, [applyReady, cleanupPersisted, project, target]);

  const watch = useCallback(async (
    jobId: string, signal: AbortSignal, generation: number,
  ): Promise<void> => {
    // issue #3040 — bound the WATCH, not the job.
    const watchdog = new AbortController();
    const stopWatching = (): void => watchdog.abort();
    // An ALREADY-aborted caller signal never emits another "abort" event.
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
        // Not a failure. The job is still running server-side and the server
        // owns its outcome; surface the honest "still working" card.
        if (generationRef.current === generation) {
          // (reason omitted = "watching": the server owns the job from here.)
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
    // #3040 B-C5 [A-5] — a persisted record's trim applies ONLY to the same
    // operation on the same bytes. A replacement (or any new clip) is trimmed
    // by ITS OWN duration; it used to inherit the old clip's window, so a
    // shorter replacement was refused as "longer than the source".
    const sameOperation = persisted !== undefined && persisted.clientOperationId === operationId &&
      persisted.sourceSha256 === prepared.sha256;
    const trimStartMs = sameOperation ? persisted.trimStartMs : 0;
    const trimEndMs = sameOperation ? persisted.trimEndMs : prepared.durationMs;
    const provisionalKey = replacementPersistenceKey;
    retainedPreparedRef.current = { prepared, operationId };
    setError(null);
    if (!replacing) {
      generation = ++generationRef.current;
      delegatedGenerationRef.current = generation;
      abortRef.current?.abort();
      abortRef.current = abort;
      setLocalPreviewUri(prepared.uri);
      await persist(userId, prepared, operationId, sameOperation ? persisted.jobId : null, false, trimStartMs, trimEndMs);
      projectPreparation({ phase: "intent_pending", percent: 0 });
    } else {
      // Crash-safe replacement ordering: preserve the old target record and its
      // bytes while durably staging the candidate under a separate operation key.
      await persist(userId, prepared, operationId, null, false, trimStartMs, trimEndMs, provisionalKey);
    }
    const intentInput = {
      target: exactTarget.serverTarget, eventId: exactTarget.eventId, venueId: exactTarget.venueId,
      draftOwnerKey: exactTarget.draftOwnerKey, clientOperationId: operationId, applyMode: laneApplyMode, brandId,
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
        // issue #2974 — no job exists, so drop the record AND its staged bytes.
        await cleanupPersisted(userId);
      }
      throw caught;
    }
    ownedJobIdsRef.current.add(intent.jobId);
    if (replacing) {
      // #3040 rework (P2) — ad videos never supersede each other on the
      // server (each is its own library item), so the one this replaces is
      // cancelled here, the moment the replacement is accepted. The server
      // cancels it only while it has no creative row, and a cancelled job can
      // never become one, so the replaced video never reaches the library.
      const replacedJobId = jobIdRef.current;
      if (exactTarget.serverTarget === "ad_creative" && replacedJobId !== null && replacedJobId !== intent.jobId) {
        void cancelReplacedAdVideo(replacedJobId);
      }
      // The old watcher, persistence, and prepared bytes remain authoritative
      // until this exact point: the server has accepted/replayed the replacement.
      generation = ++generationRef.current;
      delegatedGenerationRef.current = generation;
      abortRef.current?.abort();
      abort = new AbortController();
      abortRef.current = abort;
      jobIdRef.current = intent.jobId;
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
      await sleep(pendingIntent.retryAfterMs, abort.signal);
      const replay = await createEventCoverVideoUploadIntent(intentInput);
      if (replay.jobId !== intent.jobId) {
        throw new EventCoverVideoProcessingError("operation_conflict", "The replacement changed while it was being accepted.");
      }
      intent = replay;
      await persist(userId, prepared, operationId, intent.jobId, false, trimStartMs, trimEndMs);
    }
    let acceptedIntent = intent;
    setStatus(null);
    lastUploadProgressRef.current = { percent: prepared.bytes <= VIDEO_LIMITS.TUS_CHUNK_NATIVE_BYTES && Platform.OS !== "web" ? null : 0, totalBytes: prepared.bytes, confirmedBytes: 0 };
    flowPhaseRef.current = "uploading";
    setStage({ phase: "uploading", ...lastUploadProgressRef.current });
    const upload = (): Promise<unknown> => uploadEventCoverVideoSource({
      bytes: prepared.bytes, fileName: prepared.fileName, jobId: acceptedIntent.jobId,
      mimeType: prepared.mimeType, uri: prepared.uri, upload: acceptedIntent.upload,
      // issue #3075 — the TRANSFER runs on its own controller, deliberately not
      // the one unmount aborts. Unmount must end this instance's WATCH (a
      // subscription nobody is reading any more) without stopping the bytes.
      signal: transferAbort.signal,
      onProgress: (progress) => {
        // #3040 B-C8 / T1-T2 — byte-true, server-confirmed; null when the
        // transfer cannot report steps (one native chunk or less).
        lastUploadProgressRef.current = {
          percent: progress.indeterminate === true && progress.final !== true ? null : progress.percent,
          confirmedBytes: progress.bytesSent,
          totalBytes: progress.bytesTotal,
        };
        if (generationRef.current === generation) setStage({ phase: "uploading", ...lastUploadProgressRef.current });
      },
    });
    // issue #3075 — one live transfer per operation, however many sheets mount.
    const uploadSlotKey = `${persistenceKey}:${operationId}`;
    claimUploadSlot(uploadSlotKey, transferAbort);
    transferRef.current = transferAbort;
    try {
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
      // #3040 B-C2 — every byte is server-confirmed (the final HEAD agreed):
      // only now may the card say "Confirming upload".
      acknowledgingRef.current = true;
      flowPhaseRef.current = "ack_pending";
      setStage({ phase: "ack_pending", percent: 0 });
      // issue #2967 — bounded acknowledgement.
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
        await sleep(ACK_POLL_INTERVAL_MS, abort.signal);
        acknowledged = await acknowledgeEventCoverVideoSourceUploaded({
          target: exactTarget.serverTarget, brandId, eventId: exactTarget.eventId, jobId: acceptedIntent.jobId,
        });
      }
      acknowledgingRef.current = false;
      project(acknowledged);
      if (["failed", "cancelled", "superseded"].includes(acknowledged.status)) {
        // issue #2967 — the server ended the job DURING acknowledgement.
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
    } finally {
      acknowledgingRef.current = false;
      if (transferRef.current === transferAbort) transferRef.current = null;
    }
    await persist(userId, prepared, operationId, acceptedIntent.jobId, true, trimStartMs, trimEndMs);
    await watch(acceptedIntent.jobId, abort.signal, generation);
  }, [brandId, cleanupPersisted, clearPreparationProjection, exactTarget, laneApplyMode, persist, persistenceKey, project, projectPreparation, replacementPersistenceKey, settleCanonical, watch]);

  // #3040 B-C9 — one failure, classified once. Offline needs the device's own
  // word for it (design T4); our-side failures retry 1 s / 3 s / 9 s first.
  const isOfflineFailure = useCallback((failure: Error): boolean =>
    errorCodeOf(failure) === "network_offline" || isDeviceOfflineRef.current?.() === true, []);

  const detachRecoverable = useCallback((failure: Error, sourceAcknowledged: boolean): void => {
    const progress = lastUploadProgressRef.current;
    setStage({
      phase: "detached", percent: 0, sourceAcknowledged,
      reason: isOfflineFailure(failure) ? "offline" : "interrupted",
      confirmedBytes: progress.confirmedBytes, totalBytes: progress.totalBytes,
    });
  }, [isOfflineFailure]);

  // #3040 B-C9/B-C11 — the same operation, continued after a recoverable
  // failure: re-read the durable record (it names the accepted job) and replay
  // the intent, which hands back a fresh transport; the transfer resumes from
  // the server's offset. Retries never re-run a replacement's acceptance.
  const continueRetained = useCallback(async (): Promise<boolean> => {
    const retained = retainedPreparedRef.current;
    if (retained === null) return false;
    const userId = await currentUserId();
    const persisted = await readPersistedCoverVideoJob(userId, persistenceKey);
    await uploadPrepared(retained.prepared, retained.operationId, persisted ?? undefined);
    return true;
  }, [persistenceKey, uploadPrepared]);

  const runWithRetries = useCallback(async (
    first: () => Promise<void>,
    attemptGeneration: () => number,
  ): Promise<void> => {
    try {
      await first();
      return;
    } catch (caught) {
      let failure = safeUploadError(caught);
      for (let attempt = 0; attempt < EVENT_COVER_VIDEO_RETRY_DELAYS_MS.length; attempt += 1) {
        if (!isRecoverable(failure) || isOfflineFailure(failure)) throw failure;
        const generation = attemptGeneration();
        if (stageRef.current.phase === "uploading") {
          setStage({ phase: "uploading", ...lastUploadProgressRef.current, retrying: true });
        }
        await sleep(EVENT_COVER_VIDEO_RETRY_DELAYS_MS[attempt]);
        // A cancel, a newer pick or unmount took the sheet meanwhile.
        if (generationRef.current !== generation) throw failure;
        try {
          if (await continueRetained()) return;
          throw failure;
        } catch (retryError) {
          failure = safeUploadError(retryError);
        }
      }
      throw failure;
    }
  }, [continueRetained, isOfflineFailure]);

  const startInternal = useCallback(async (
    file: EventCoverVideoUploadFile,
    replacing: boolean,
  ): Promise<void> => {
    let prepared: PreparedEventCoverVideoSource | null = null;
    let replacementAccepted = false;
    // Issue #3073 — who is allowed to silence this attempt's failure: a cancel
    // that lands during preparation bumps the generation.
    const startGeneration = generationRef.current;
    const abortedBeforeStart = abortRef.current?.signal.aborted === true ? abortRef.current : null;
    let handedToUpload = false;
    try {
      // issue #2974 — the create-event wizard holds a client-only draft id
      // until the lazy server promotion lands; never send it to upload-intent.
      if (exactTarget.serverTarget === "event" && !isServerRowId(exactTarget.eventId)) {
        throw new EventCoverVideoProcessingError(
          "event_not_ready",
          "This event is still being created. Give it a moment, then add the cover again.",
        );
      }
      // #3040 AD-06 / I-AD-VIDEO-MIN-5S — an ad video under 5 s never leaves
      // the device. The picker refuses it first; this is the backstop.
      if (target === "ad_creative" && file.durationMs > 0 && file.durationMs < VIDEO_LIMITS.AD_MIN_DURATION_MS) {
        throw new EventCoverVideoProcessingError(
          "ad_video_too_short",
          "Ad videos need at least 5 seconds. Choose another video.",
        );
      }
      const userId = await currentUserId();
      userIdRef.current = userId;
      let persisted = await readPersistedCoverVideoJob(userId, persistenceKey);
      let operationId = replacing ? newOperationId() : persisted?.clientOperationId ?? newOperationId();
      if (!replacing) {
        beginPreparationProjection();
        projectPreparation({ phase: "validating", percent: 0 });
      }
      const valid = validateNativeTrimmedEventCoverVideo({
        uri: file.uri, duration: file.durationMs, fileSize: file.bytes,
        mimeType: file.mimeType, fileName: file.fileName,
      }, {
        maxDurationMs: EVENT_COVER_SOURCE_CEILING_MS,
        // issue #3119 — the generous pick-time ceiling, NOT the pipeline cap.
        maxSourceBytes: EVENT_COVER_PICK_CEILING_BYTES,
        // #3040 — WebM is in the lane's limits line on every platform.
        allowWebm: true,
      });
      if (!valid.ok) throw new EventCoverVideoProcessingError(valid.code, valid.message);
      if (!replacing) projectPreparation({ phase: "compressing", percent: null });
      const compressed = await compressVideoLocally({
        uri: file.uri, bytes: file.bytes, durationMs: file.durationMs,
        // issue #3128 — if compressing stalls or fails and the original already
        // fits the pipeline, upload it untouched.
        maxUncompressedBytes: EVENT_COVER_SOURCE_MAX_BYTES,
        onProgress: (progress) => {
          if (!replacing) projectPreparation({ phase: "compressing", percent: progress.percent });
        },
      });
      // issue #3119 — the pipeline cap belongs HERE, on what we upload.
      if (compressed.bytes > EVENT_COVER_SOURCE_MAX_BYTES) {
        throw new EventCoverVideoProcessingError(
          "video_file_too_large",
          "This clip is still too big after compressing. Try a shorter clip, or record at a lower resolution.",
        );
      }
      // #3040 B-C7 [A-7] — optimizing is over the moment compression resolves;
      // the copy-and-fingerprint step is "Checking file", never a frozen 100%.
      if (!replacing) projectPreparation({ phase: "preparing", percent: 0 });
      try {
        prepared = await prepareEventCoverVideoSource({
          uri: compressed.uri, bytes: compressed.bytes, durationMs: compressed.durationMs,
          fileName: compressed.wasCompressed ? `${operationId}.mp4` : file.fileName,
          mimeType: compressed.wasCompressed ? "video/mp4" : file.mimeType, operationId,
          // B-C7 — the compressor's own cache file is renamed, never copied.
          ownedTemporary: compressed.wasCompressed,
        });
      } catch (preparationError) {
        // Issue #3073 — the compressor can hand back a file with sound and no
        // picture; upload the original exactly as #3128 does.
        if (!compressed.wasCompressed || !isMissingVideoTrackError(preparationError)) throw preparationError;
        if (file.bytes > EVENT_COVER_SOURCE_MAX_BYTES) {
          throw new EventCoverVideoProcessingError(
            "video_compression_failed",
            "Your phone couldn’t shrink this clip, and it’s over 100 MB as it is. Try a shorter clip, or record at a lower resolution.",
          );
        }
        if (!replacing) projectPreparation({ phase: "preparing", percent: 0 });
        prepared = await prepareEventCoverVideoSource({
          uri: file.uri, bytes: file.bytes, durationMs: file.durationMs,
          fileName: file.fileName, mimeType: file.mimeType, operationId,
        });
      }
      if (!replacing && persisted && !persisted.sourceAcknowledged && persisted.sourceSha256 !== prepared.sha256) {
        // #3040 B-C9 [A-18] / design H-12 — a DIFFERENT clip is a new operation.
        // It used to be refused ("Choose the same video to resume") and the host
        // had no way out; now the old job is cancelled and its record dropped.
        const staleJobId = persisted.jobId;
        abortActiveTransfersFor(persistenceKey);
        if (staleJobId !== null) {
          try { await cancelEventCoverVideoJob(staleJobId); } catch { /* the reaper ends an abandoned job */ }
        }
        // Keep the freshly prepared bytes (the record's own source goes).
        await removePersistedCoverVideoJob(userId, persistenceKey, { preserveSource: true });
        if (persisted.sourceUri && persisted.sourceUri !== prepared.uri) {
          try { await deletePreparedEventCoverVideoSource(persisted.sourceUri); } catch { /* orphan cleanup is retry-safe */ }
        }
        persisted = null;
        operationId = newOperationId();
      }
      handedToUpload = true;
      const preparedSource = prepared;
      const persistedForUpload = persisted ?? undefined;
      const flowOperationId = operationId;
      await runWithRetries(
        () => uploadPrepared(
          preparedSource,
          flowOperationId,
          persistedForUpload,
          replacing,
          () => { replacementAccepted = true; },
        ),
        () => generationRef.current,
      );
    } catch (caught) {
      clearPreparationProjection();
      // Issue #3073 — see `abortedBeforeStart` above.
      const installed = abortRef.current;
      const abortedDuringAttempt = installed !== null && installed !== abortedBeforeStart && installed.signal.aborted;
      const cancelledDuringPreparation = !handedToUpload && generationRef.current !== startGeneration;
      if (abortedDuringAttempt || cancelledDuringPreparation) return;
      const next = safeUploadError(caught);
      if (replacing && !replacementAccepted) {
        if (prepared?.uri) await deletePreparedEventCoverVideoSource(prepared.uri);
        // No replacement was accepted: the old watcher/projection/persistence
        // never moved, so surface the finite error to the picker and keep it.
        throw next;
      }
      setLocalPreviewUri(null);
      const code = errorCodeOf(next);
      logEventCoverVideoUploadTelemetry("video_cover_upload_preview_rolled_back", {
        applyMode: laneApplyMode,
        errorCode: code,
        eventId, jobId: jobIdRef.current ?? undefined, phase: "upload_intent",
        timestamp: new Date().toISOString(),
      });
      if (isRecoverable(next)) {
        detachRecoverable(next, status?.sourceUploadedAt != null);
        return;
      }
      // #3040 B-C9 [A-18] — a terminal failure after the intent drops the
      // durable record and its operation id, so the next pick (any clip) is a
      // NEW operation instead of a "choose the same video" dead end.
      // Only a DEFINITE answer (a terminal code) drops it: a local failure
      // (say, a storage write) leaves the record for the next mount to recover.
      if (isTerminalUploadError(next) && userIdRef.current) {
        try { await cleanupPersisted(userIdRef.current); } catch { /* best effort */ }
      }
      if (code === "source_file_gone" && jobIdRef.current) {
        try { await cancelEventCoverVideoJob(jobIdRef.current); } catch { /* the reaper ends it */ }
      }
      setError(next);
      // #3040 A-19 — the stage carries the REAL code (it used to be a literal).
      setStage({
        phase: "error", percent: 0, code, message: next.message,
        canRetry: code !== LANE_CODES.clientVersionRequired,
      });
    }
  }, [beginPreparationProjection, cleanupPersisted, clearPreparationProjection, detachRecoverable, eventId, exactTarget, laneApplyMode, persistenceKey, projectPreparation, runWithRetries, status?.sourceUploadedAt, target, uploadPrepared]);

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
    // issue #3074 — the deadline. Overrides a resume still on "Reconnecting…".
    const reattachDeadline = setTimeout(() => {
      if (stageRef.current.phase !== "reattaching") return;
      if (generationRef.current !== generation) return;
      void (async () => {
        try {
          const jobId = jobIdRef.current ?? persisted?.jobId ?? null;
          const byTarget = jobId === null;
          const canonical = jobId !== null
            ? await fetchEventCoverVideoStatus(jobId, abort.signal)
            : await fetchEventCoverVideoStatusByTarget({
              target: exactTarget.serverTarget, eventId: exactTarget.eventId, brandId,
              venueId: exactTarget.venueId, draftOwnerKey: exactTarget.draftOwnerKey,
              signal: abort.signal, activeOnly: true,
            });
          if (stageRef.current.phase !== "reattaching") return;
          if (generationRef.current !== generation) return;
          // D-11 — a job found by TARGET (not this device's own job id) is
          // only resumed while it is still active, exactly like the main
          // path: a server that ignores activeOnly must not resurrect a
          // finished video.
          if (canonical === null || (byTarget && !isActiveLaneStatus(canonical.status))) {
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
    const leaveReattaching = (): void => { clearTimeout(reattachDeadline); };
    try {
      const userId = await currentUserId();
      userIdRef.current = userId;
      persisted = await readPersistedCoverVideoJob(userId, persistenceKey);
      if (persisted?.jobId) ownedJobIdsRef.current.add(persisted.jobId);
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
          // Target-first promotion is the recovery commit.
          await writePersistedCoverVideoJob(promoted);
          persisted = promoted;
          ownedJobIdsRef.current.add(recoveredReplacement.jobId);
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
          try {
            await removePersistedCoverVideoJob(userId, replacementPersistenceKey, { preserveSource: true });
          } catch { /* retry on next mount */ }
        } else {
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
          // #3040 B-C10 / design H-12 (web) — the browser kept no bytes across
          // the reload. Say so; never claim the video uploaded.
          jobIdRef.current = persisted.jobId;
          setStage({ phase: "detached", percent: 0, sourceAcknowledged: false, reason: "repick" });
          return;
        }
        // #3040 B-C11 [A-11] — the OS may have purged the prepared copy. A
        // resume from a missing file can only fail, so end it honestly.
        if (!(await preparedSourceStillExists(persisted.sourceUri))) {
          const goneJobId = persisted.jobId;
          if (goneJobId !== null) {
            try { await cancelEventCoverVideoJob(goneJobId); } catch { /* the reaper ends it */ }
          }
          await cleanupPersisted(userId);
          leaveReattaching();
          setStage({
            phase: "error", percent: 0, code: "source_file_gone",
            message: "Your phone cleared the copy we were uploading, so we can't continue from here. Pick the same video and we'll start it fresh.",
            canRetry: true,
          });
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
      // #3040 B-C3 [A-3/A-6] / design T6 — with no record of its own, the sheet
      // only re-attaches to a job STILL IN FLIGHT for this target. An applied,
      // failed, cancelled or superseded latest job is never re-announced: that
      // is how a replaced video came back as the cover on reopen.
      const recovered = await fetchEventCoverVideoStatusByTarget({
        target: exactTarget.serverTarget, eventId: exactTarget.eventId, brandId,
        venueId: exactTarget.venueId, draftOwnerKey: exactTarget.draftOwnerKey, signal: abort.signal,
        activeOnly: true,
      });
      if (!recovered || !isActiveLaneStatus(recovered.status)) { setStage(idleStage); return; }
      jobIdRef.current = recovered.jobId;
      const settled = await settleCanonical(recovered, abort.signal);
      if (!settled.isTerminal) await watch(recovered.jobId, abort.signal, generation);
    } catch (caught) {
      // issue #3074 — whatever the outcome, the spinner is over.
      leaveReattaching();
      const ownerGeneration = delegated
        ? delegatedGenerationRef.current ?? generation
        : generation;
      if (generationRef.current !== ownerGeneration) return;
      if (abortRef.current?.signal.aborted === true) return;
      const next = safeUploadError(caught);
      const code = errorCodeOf(next);
      if (isTerminalUploadError(next)) {
        if (userIdRef.current) await cleanupPersisted(userIdRef.current);
        if (code === "source_file_gone" && jobIdRef.current) {
          try { await cancelEventCoverVideoJob(jobIdRef.current); } catch { /* the reaper ends it */ }
        }
        setError(next);
        setStage({
          phase: "error", percent: 0, code, message: next.message,
          canRetry: code !== LANE_CODES.clientVersionRequired,
        });
        return;
      }
      if (persisted) {
        detachRecoverable(next, persisted.sourceAcknowledged);
        return;
      }
      setStage(idleStage);
    }
  }, [brandId, cleanupPersisted, detachRecoverable, exactTarget, persistenceKey, replacementPersistenceKey, settleCanonical, uploadPrepared, watch]);

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
      // #3040 B-C10 [A-10] — on WEB the browser keeps no bytes across a
      // remount, so a job that never received a byte cannot be continued:
      // cancel it (best effort) and drop the record, instead of leaving a 0-byte
      // job that a later open would mistake for "Finishing upload".
      const phaseAtUnmount = ["idle", "reattaching"].includes(stageRef.current.phase)
        ? flowPhaseRef.current
        : stageRef.current.phase;
      const noBytesYet = ["reading", "validating", "compressing", "preparing", "intent_pending"].includes(phaseAtUnmount) ||
        (phaseAtUnmount === "uploading" && (lastUploadProgressRef.current.confirmedBytes ?? 0) === 0);
      if (Platform.OS === "web" && noBytesYet) {
        const orphanJobId = jobIdRef.current;
        const orphanUserId = userIdRef.current;
        abortActiveTransfersFor(persistenceKey);
        if (orphanJobId !== null) void cancelEventCoverVideoJob(orphanJobId).catch(() => undefined);
        if (orphanUserId !== null) void removePersistedCoverVideoJob(orphanUserId, persistenceKey).catch(() => undefined);
      }
      // issue #3075 — bumping the generation is what makes this instance stop
      // WRITING (every setStage/progress callback is generation-guarded), and
      // that is all unmount should do. It used to abort the controller too,
      // which killed the transfer itself. Explicit cancel, a superseding upload,
      // and SIGNED_OUT still abort — see `abortRef` at those call sites.
      generationRef.current += 1;
      // Ends this instance's WATCH. The transfer runs on its own controller and
      // is deliberately left alone — see issue #3075 above.
      abortRef.current?.abort();
      subscription.unsubscribe();
    };
  }, [clearPreparationProjection, persistenceKey, resume]);

  const checkNow = useCallback(async (): Promise<void> => {
    if (jobIdRef.current) await settleCanonical(await fetchEventCoverVideoStatus(jobIdRef.current));
  }, [settleCanonical]);
  const acknowledgeApplied = useCallback(async (): Promise<void> => {
    if (!jobIdRef.current || !status?.processedUrl) return;
    setStage({ phase: "applying", percent: 100 });
    if (status !== null) await applyReady(status);
    const next = await fetchEventCoverVideoStatus(jobIdRef.current);
    project(next);
    if (next.status === "applied" && userIdRef.current) await cleanupPersisted(userIdRef.current);
  }, [applyReady, cleanupPersisted, project, status]);
  // #3040 B-C9/B-C2 — "Resume upload" (H-10) and "Continue upload" (H-11):
  // continue the SAME operation from the server's offset. With the source
  // still in hand here it replays at once; otherwise native resumes from its
  // durable record. Never a no-op: a source that is gone ends on H-12.
  const continueUpload = useCallback(async (): Promise<void> => {
    if (retainedPreparedRef.current !== null) {
      try {
        await runWithRetries(async () => {
          if (!(await continueRetained())) throw new EventCoverVideoProcessingError("source_file_gone", "Choose the video again.");
        }, () => generationRef.current);
      } catch (caught) {
        // A cancel (or a newer pick) aborted this flow: it owns the sheet now.
        if (abortRef.current?.signal.aborted === true) return;
        const next = safeUploadError(caught);
        if (isRecoverable(next)) detachRecoverable(next, false);
        else {
          setError(next);
          setStage({ phase: "error", percent: 0, code: errorCodeOf(next), message: next.message, canRetry: true });
        }
      }
      return;
    }
    await resume();
  }, [continueRetained, detachRecoverable, resume, runWithRetries]);
  // #3040 B-C4 [A-4] / design T7 — new media wins. A photo, GIF, stock pick or
  // Remove clears the finished video's preview and its "added" state, so a
  // stale `processedUrl` can never outrank the cover the host just chose.
  const resetAppliedPreview = useCallback((): void => {
    if (stageRef.current.phase !== "applied") return;
    setProcessedUrl(null);
    setProcessedPosterUrl(null);
    setStage(idleStage);
  }, []);
  // issue #3075 — an explicit cancel is the one gesture that DOES stop the
  // transfer, so it aborts the operation's slot as well as this instance's
  // watch. Unmount is not a cancel.
  const cancel = useCallback(async (): Promise<void> => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortActiveTransfersFor(persistenceKey);
    abortActiveTransfersFor(replacementPersistenceKey);
    retainedPreparedRef.current = null;
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
  }, [cleanupPersisted, persistenceKey, project, replacementPersistenceKey, settleCanonical]);

  // #3040 B-C3 — true only for a job this mount started or resumed from its
  // own record; the picker emits a finished video as the cover only then.
  const ownsJob = useCallback((jobId: string | null | undefined): boolean =>
    typeof jobId === "string" && ownedJobIdsRef.current.has(jobId), []);

  return {
    acknowledgeApplied, cancel, checkNow, continueUpload, error, localPreviewUri, ownsJob,
    processedPosterUrl, processedUrl, replace, resetAppliedPreview, resume, stage, start, status,
    creativeId: status?.creativeId ?? null,
  };
}
