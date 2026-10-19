/**
 * Issue #3697 — the Admin video upload queue, shared by the Creative Library
 * and the Campaign Builder's video step. Every file goes through
 * services/adminVideoUpload.js (the shared lane client); at most three upload
 * at once and the rest wait. Uploads started in this browser survive a
 * reload: on mount each saved record is checked against the server and shown
 * as the state the server reports (an upload that still needs bytes asks for
 * the same file again).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invokeWithRefresh } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import {
  MAX_CONCURRENT_UPLOADS,
  checkVideoFile,
  clearUploadRecord,
  createAdminVideoUploader,
  failureCopy,
  isVideoFile,
  listUploadRecords,
  readVideoDurationMs,
  saveUploadRecord,
} from "../../services/adminVideoUpload";

const ACTIVE = new Set(["checking", "starting", "uploading", "offline", "reconnecting", "confirming", "preparing", "saving"]);
const BYTES = new Set(["checking", "starting", "uploading", "offline", "reconnecting", "confirming"]);

let localCounter = 0;
// Uploads still running in this tab (a page change does not stop them), so a
// remount never restores one as if it had been interrupted.
const IN_FLIGHT = new Set();

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function useAdminVideoUploads({ onFinished } = {}) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [entries, setEntries] = useState([]);
  const entriesRef = useRef(entries);
  const controllers = useRef(new Map());
  const files = useRef(new Map());
  const onFinishedRef = useRef(onFinished);
  const storage = useMemo(safeStorage, []);
  const userIdRef = useRef(userId);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const uploader = useMemo(
    () =>
      createAdminVideoUploader({
        invoke: invokeWithRefresh,
        getUserId: () => userIdRef.current,
        storage,
      }),
    [storage],
  );

  const patch = useCallback((localId, next) => {
    setEntries((current) =>
      current.map((entry) => (entry.localId === localId ? { ...entry, ...(typeof next === "function" ? next(entry) : next) } : entry)),
    );
  }, []);

  const drop = useCallback((localId) => {
    const entry = entriesRef.current.find((item) => item.localId === localId);
    if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    files.current.delete(localId);
    controllers.current.get(localId)?.abort();
    controllers.current.delete(localId);
    setEntries((current) => current.filter((item) => item.localId !== localId));
  }, []);

  const runEntry = useCallback(
    async (entry, mode) => {
      const controller = new AbortController();
      controllers.current.set(entry.localId, controller);
      if (entry.record?.opId) IN_FLIGHT.add(entry.record.opId);
      let lastSaved = 0;
      const onStage = (stage) => {
        if (stage.phase === "registered") {
          IN_FLIGHT.add(stage.record.opId);
          entry.record = stage.record;
          patch(entry.localId, { record: stage.record, jobId: stage.jobId });
          return;
        }
        patch(entry.localId, (current) => {
          const next = { ...stage };
          if (stage.phase === "preparing" && !current.preparingSince) next.preparingSince = Date.now();
          return next;
        });
        // Remember how far the bytes got, so a reload can say "Paused at n%".
        if (stage.phase === "uploading" && entry.record && stage.percent - lastSaved >= 10) {
          lastSaved = stage.percent;
          saveUploadRecord(storage, { ...entry.record, lastPercent: stage.percent });
        }
      };
      try {
        const file = files.current.get(entry.localId);
        const result = mode === "follow"
          ? await uploader.follow(entry.record, { signal: controller.signal, onStage })
          : mode === "resume"
            ? await uploader.resume(entry.record, file, { signal: controller.signal, onStage })
            : await uploader.start(file, { durationMs: entry.durationMs, signal: controller.signal, onStage });
        drop(entry.localId);
        onFinishedRef.current?.({ creativeId: result.creativeId, name: entry.name });
      } catch (error) {
        if (error?.code === "source_upload_cancelled") {
          drop(entry.localId);
          return;
        }
        if (error?.code === "different_file") {
          patch(entry.localId, { phase: "needs_file", differentFile: true });
          return;
        }
        console.error("[creative-library] video upload failed:", error?.code, error?.message);
        patch(entry.localId, {
          phase: "failed",
          jobId: error?.jobId ?? entry.jobId ?? null,
          error: error?.message && error.code !== "processing_failed" ? error.message : failureCopy(error?.code),
        });
      } finally {
        controllers.current.delete(entry.localId);
        if (entry.record?.opId) IN_FLIGHT.delete(entry.record.opId);
      }
    },
    [drop, patch, storage, uploader],
  );

  // Start waiting entries while fewer than three are moving bytes.
  useEffect(() => {
    const moving = entries.filter((entry) => BYTES.has(entry.phase)).length;
    const waiting = entries.filter((entry) => entry.phase === "waiting");
    const free = Math.max(0, MAX_CONCURRENT_UPLOADS - moving);
    for (const entry of waiting.slice(0, free)) {
      patch(entry.localId, { phase: "checking" });
      void runEntry(entry, entry.mode ?? "start");
    }
  }, [entries, patch, runEntry]);

  // Restore uploads this browser started before a reload.
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    (async () => {
      for (const record of listUploadRecords(storage)) {
        if (cancelled) return;
        if (IN_FLIGHT.has(record.opId)) continue;
        if (!record.jobId) {
          clearUploadRecord(storage, record.opId);
          continue;
        }
        let job = null;
        try {
          job = await uploader.status(record.jobId);
        } catch (error) {
          console.warn("[creative-library] could not restore an upload:", error?.message);
          continue;
        }
        if (cancelled) return;
        if (!job || ["applied", "failed", "cancelled", "superseded"].includes(job.status)) {
          clearUploadRecord(storage, record.opId);
          if (job?.status === "applied") onFinishedRef.current?.({ creativeId: job.creativeId ?? null, name: record.name });
          continue;
        }
        const base = {
          localId: `restored-${(localCounter += 1)}`,
          name: record.name,
          size: record.size,
          totalBytes: record.size,
          durationMs: record.durationMs,
          lastPercent: record.lastPercent ?? null,
          jobId: record.jobId,
          record,
        };
        if (job.status === "source_uploading") {
          setEntries((current) => [{ ...base, phase: "needs_file" }, ...current]);
        } else {
          const entry = { ...base, phase: "preparing", sourceUploadedAt: job.sourceUploadedAt ?? null };
          setEntries((current) => [entry, ...current]);
          void runEntry(entry, "follow");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Restore once per signed-in admin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Leaving the page mid-transfer would stop the bytes: ask first.
  useEffect(() => {
    const uploading = entries.some((entry) => BYTES.has(entry.phase));
    if (!uploading) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [entries]);

  /** Checks picked videos (type, size, length, 5 s minimum). Returns refusal lines. */
  const addVideos = useCallback(async (picked) => {
    const refusals = [];
    const accepted = [];
    for (const file of picked) {
      if (!isVideoFile(file)) continue;
      const durationMs = await readVideoDurationMs(file);
      const refusal = checkVideoFile(file, durationMs);
      if (refusal) {
        refusals.push(refusal.line);
        continue;
      }
      const localId = `local-${(localCounter += 1)}`;
      files.current.set(localId, file);
      accepted.push({
        localId,
        name: file.name,
        size: file.size,
        totalBytes: file.size,
        durationMs,
        phase: "waiting",
        previewUrl: URL.createObjectURL(file),
        mode: "start",
      });
    }
    if (accepted.length > 0) setEntries((current) => [...accepted, ...current]);
    return { refusals, accepted: accepted.length };
  }, []);

  const cancel = useCallback(
    async (entry) => {
      controllers.current.get(entry.localId)?.abort();
      const jobId = entry.jobId ?? entry.record?.jobId ?? null;
      drop(entry.localId);
      if (entry.record?.opId) clearUploadRecord(storage, entry.record.opId);
      if (jobId) {
        try {
          await uploader.cancel(jobId);
        } catch (error) {
          console.error("[creative-library] cancel failed:", error?.message);
          throw error;
        }
      }
    },
    [drop, storage, uploader],
  );

  /** Retry: the same job if its bytes landed, otherwise a fresh upload of the same file. */
  const retry = useCallback(
    (entry) => {
      const file = files.current.get(entry.localId);
      if (entry.jobId && entry.record && !file) {
        patch(entry.localId, { phase: "preparing", error: null });
        void runEntry({ ...entry, phase: "preparing" }, "follow");
        return true;
      }
      if (!file) return false;
      patch(entry.localId, { phase: "waiting", error: null, mode: "start", percent: 0 });
      return true;
    },
    [patch, runEntry],
  );

  const chooseFileFor = useCallback(
    (entry, file) => {
      files.current.set(entry.localId, file);
      patch(entry.localId, { phase: "waiting", mode: "resume", differentFile: false, previewUrl: URL.createObjectURL(file) });
    },
    [patch],
  );

  /**
   * A server-side upload this browser has no record of (started in another
   * tab or browser): finish it with the same file, matched by the server.
   */
  const adopt = useCallback((item, file) => {
    const ext = /\.([A-Za-z0-9]+)$/.exec(item.fileName ?? "")?.[1]?.toLowerCase() ?? "mp4";
    const mime = { mov: "video/quicktime", m4v: "video/x-m4v", webm: "video/webm" }[ext] ?? "video/mp4";
    const record = {
      opId: item.clientOperationId,
      jobId: item.jobId,
      name: item.fileName ?? `video.${ext}`,
      size: item.sourceBytes,
      durationMs: item.sourceDurationMs,
      sha256: null,
      mime,
      ext,
      createdAt: item.createdAt ?? new Date().toISOString(),
    };
    const localId = `adopted-${(localCounter += 1)}`;
    files.current.set(localId, file);
    setEntries((current) => [{
      localId,
      name: record.name,
      size: record.size,
      totalBytes: record.size,
      durationMs: record.durationMs,
      jobId: item.jobId,
      record,
      phase: "waiting",
      mode: "resume",
      previewUrl: URL.createObjectURL(file),
    }, ...current]);
  }, []);

  /** "That's a different file. Start a new upload instead?" → yes. */
  const startOverWith = useCallback(
    async (entry) => {
      const file = files.current.get(entry.localId);
      await cancel(entry);
      if (file) await addVideos([file]);
    },
    [addVideos, cancel],
  );

  const active = entries.filter((entry) => ACTIVE.has(entry.phase) || entry.phase === "waiting");
  return {
    entries,
    active,
    addVideos,
    cancel,
    retry,
    remove: cancel,
    chooseFileFor,
    startOverWith,
    adopt,
    keepWaitingForFile: (entry) => {
      if (entry) patch(entry.localId, { differentFile: false });
    },
    checkAgain: async (entry) => {
      if (!entry.jobId) return;
      const job = await uploader.status(entry.jobId);
      patch(entry.localId, { status: job?.status ?? entry.status, sourceUploadedAt: job?.sourceUploadedAt ?? entry.sourceUploadedAt });
    },
  };
}
