/**
 * Issue #3697 — Admin raw video upload into the Creative Library.
 *
 * Admin is a second client of the shared #3040 video lane, never a second
 * uploader: the bytes go through `packages/video-upload` (the one web TUS
 * implementation, imported by relative path exactly like packages/brand-assets),
 * and the lane's own edge functions own the job from intent to ready. The
 * library row is made by the server from the finished job; this file never
 * sends a media URL or a provider id anywhere.
 *
 * Invariant I-VIDEO-ONE-UPLOADER (declared in packages/video-upload/__tests__/videoUpload.test.mjs)
 * Invariant I-AD-VIDEO-MIN-5S (declared in supabase/functions/event-cover-video-upload-intent/__tests__/issue_3040_ad_min_duration.test.ts)
 *
 * Every check that can refuse a file (type, size, length, the 5 s ad minimum)
 * runs at pick, before any network call. The module has no Supabase import:
 * the page injects the authenticated `invoke`, so it runs under node:test.
 */

import {
  VIDEO_LIMITS,
  VideoUploadError,
  resolveRawClipDurationMs,
  sha256OfBlob,
  uploadSourceWeb,
} from "../../../packages/video-upload/index.js";

export { VIDEO_LIMITS };

/** Lane-accepted video types, by MIME and by extension. */
const VIDEO_TYPES = Object.freeze({
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
  "video/webm": "webm",
});
const VIDEO_EXTENSIONS = Object.freeze({
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
});

export const ADMIN_VIDEO_ACCEPT =
  "video/mp4,video/quicktime,video/x-m4v,video/webm,.mp4,.mov,.m4v,.webm";

/** localStorage key prefix for an upload this browser started (resume). */
export const UPLOAD_STORAGE_PREFIX = "mingla.admin.videoUpload.";
export const MAX_CONCURRENT_UPLOADS = 3;
export const ACK_POLL_MS = 2000;
export const STATUS_POLL_MS = 3000;
const RETRY_DELAYS_MS = [1000, 3000, 9000];
const TERMINAL = new Set(["applied", "failed", "cancelled", "superseded"]);

function extensionOf(name) {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(name ?? ""));
  return match ? match[1].toLowerCase() : "";
}

/** `{ mime, ext }` for a lane video, by MIME first, then by extension. */
export function resolveVideoType(file) {
  const mime = String(file?.type ?? "").toLowerCase();
  if (VIDEO_TYPES[mime]) return { mime, ext: VIDEO_TYPES[mime] };
  const ext = extensionOf(file?.name);
  if (VIDEO_EXTENSIONS[ext]) return { mime: VIDEO_EXTENSIONS[ext], ext };
  return null;
}

export function isVideoFile(file) {
  const mime = String(file?.type ?? "").toLowerCase();
  return mime.startsWith("video/") || resolveVideoType(file) !== null;
}

/** "1:48" from milliseconds. */
export function formatClock(ms) {
  const total = Math.max(0, Math.round(Number(ms) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function formatMegabytes(bytes) {
  const mb = Number(bytes) / (1024 * 1024);
  if (!Number.isFinite(mb)) return "0";
  return mb >= 10 ? String(Math.round(mb)) : mb.toFixed(1);
}

/**
 * The pick-time refusal for one video, or null when it may upload. The line
 * is the design's AlertCard copy (§8.1), naming the file.
 */
export function checkVideoFile(file, durationMs) {
  const name = file?.name || "This file";
  const type = resolveVideoType(file);
  if (!type) {
    return { code: "type_not_supported", line: `${name} isn't a supported type.` };
  }
  if (!(Number(file?.size) > 0)) {
    return { code: "empty", line: `${name} is empty.` };
  }
  if (file.size > VIDEO_LIMITS.SOURCE_MAX_BYTES) {
    return {
      code: "too_large",
      line: `${name} is ${formatMegabytes(file.size)} MB. Videos must be under 100 MB.`,
    };
  }
  if (!(typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0)) {
    return {
      code: "duration_unknown",
      line: `${name} couldn't be read. Try exporting it again as MP4.`,
    };
  }
  const declared = resolveRawClipDurationMs(durationMs);
  if (declared > VIDEO_LIMITS.MAX_DURATION_MS) {
    return {
      code: "too_long",
      line: `${name} is ${formatClock(durationMs)} long. Videos can be up to 1 minute.`,
    };
  }
  if (declared < VIDEO_LIMITS.AD_MIN_DURATION_MS) {
    const seconds = Math.max(0, Math.round((durationMs / 1000) * 10) / 10);
    return {
      code: "too_short",
      line: `${name} is ${seconds} s long. Videos need at least 5 seconds.`,
    };
  }
  return null;
}

/**
 * Reads a video's duration from `<video>` metadata (browser only). Resolves
 * null when the browser cannot read it within the budget.
 */
export function readVideoDurationMs(file, { timeoutMs = 8000, doc = globalThis.document, url = globalThis.URL } = {}) {
  return new Promise((resolve) => {
    if (!doc || !url?.createObjectURL) {
      resolve(null);
      return;
    }
    const video = doc.createElement("video");
    const src = url.createObjectURL(file);
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      try { url.revokeObjectURL(src); } catch { /* already released */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      const seconds = Number(video.duration);
      finish(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null);
    };
    video.onerror = () => finish(null);
    video.src = src;
  });
}

// ── Durable resume records (this browser only). ─────────────────────────────

export function saveUploadRecord(storage, record) {
  try {
    storage?.setItem(`${UPLOAD_STORAGE_PREFIX}${record.opId}`, JSON.stringify(record));
  } catch (error) {
    console.warn("[adminVideoUpload] could not save the resume record:", error?.message);
  }
}

export function clearUploadRecord(storage, opId) {
  try {
    storage?.removeItem(`${UPLOAD_STORAGE_PREFIX}${opId}`);
  } catch (error) {
    console.warn("[adminVideoUpload] could not clear the resume record:", error?.message);
  }
}

export function listUploadRecords(storage) {
  const out = [];
  try {
    for (let i = 0; i < (storage?.length ?? 0); i += 1) {
      const key = storage.key(i);
      if (!key || !key.startsWith(UPLOAD_STORAGE_PREFIX)) continue;
      try {
        const record = JSON.parse(storage.getItem(key) ?? "null");
        if (record && typeof record.opId === "string") out.push(record);
      } catch {
        storage.removeItem(key);
      }
    }
  } catch (error) {
    console.warn("[adminVideoUpload] could not read resume records:", error?.message);
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** A picked file is the same upload only when size AND hash match. */
export function isSameFile(record, file, sha256) {
  if (!record || Number(record.size) !== Number(file?.size)) return false;
  // A record adopted from the server (started in another browser) has no
  // local hash; the lane checks the file's identity on the replayed intent.
  if (record.sha256 === null || record.sha256 === undefined) return true;
  return record.sha256 === sha256;
}

// ── The lane client. ─────────────────────────────────────────────────────────

export class AdminVideoUploadError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "AdminVideoUploadError";
    this.code = code;
    Object.assign(this, extra);
  }
}

async function edgeErrorBody(error) {
  try {
    if (error?.context && typeof error.context.json === "function") {
      return await error.context.json();
    }
  } catch {
    return null;
  }
  return null;
}

/** Plain-language copy for a lane failure code (never a raw code on screen). */
export function failureCopy(code) {
  switch (code) {
    case "ad_video_too_short":
      return "Videos need at least 5 seconds.";
    case "source_too_large":
      return "Videos must be under 100 MB.";
    case "source_duration_out_of_range":
    case "duration_over_cap":
      return "Videos can be up to 1 minute.";
    case "source_type_not_allowed":
      return "Use MP4, MOV, M4V or WebM.";
    case "different_file":
      return "That's a different file. Start a new upload instead?";
    case "processing_timeout":
      return "Taking longer than usual · we're on it";
    case "source_upload_cancelled":
      return "Upload cancelled.";
    default:
      return "Couldn't prepare this video. The file may be damaged. Try exporting it again as MP4 under 100 MB.";
  }
}

/**
 * The upload pipeline for one file. `deps.invoke(name, { body })` must return
 * `{ data, error }` like supabase.functions.invoke.
 */
export function createAdminVideoUploader(deps) {
  const {
    invoke,
    getUserId,
    storage = globalThis.localStorage,
    sha256 = sha256OfBlob,
    upload = uploadSourceWeb,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
    randomUUID = () => globalThis.crypto.randomUUID(),
    isOnline = () => globalThis.navigator?.onLine !== false,
    waitForOnline = () =>
      new Promise((resolve) => globalThis.addEventListener?.("online", resolve, { once: true })),
  } = deps;

  const call = async (name, body) => {
    const { data, error } = await invoke(name, { body });
    if (!error) return { data, status: 200 };
    const payload = await edgeErrorBody(error);
    const status = error?.context?.status ?? error?.status ?? null;
    return { data: null, error: payload ?? { error: error.message }, status };
  };

  const fail = (payload, fallbackCode) => {
    const code = typeof payload?.detail === "string"
      ? payload.detail
      : typeof payload?.error === "string" ? payload.error : fallbackCode;
    throw new AdminVideoUploadError(code, failureCopy(code), { payload });
  };

  async function requestIntent(record, signal) {
    const userId = await getUserId();
    if (!userId) throw new AdminVideoUploadError("signed_out", "Sign in again to upload.");
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (signal?.aborted) throw new VideoUploadError("source_upload_cancelled", "Upload cancelled.");
      const result = await call("event-cover-video-upload-intent", {
        target: "ad_creative",
        brandId: null,
        draftOwnerKey: `admin-library:${userId}`,
        applyMode: "published_manual",
        clientOperationId: record.opId,
        sourceFileName: record.name,
        sourceMimeType: record.mime,
        sourceExtension: record.ext,
        sourceSha256: record.sha256,
        sourceBytes: record.size,
        sourceDurationMs: record.durationMs,
        trimStartMs: 0,
        trimEndMs: record.durationMs,
      });
      if (result.error) fail(result.error, "intent_failed");
      const data = result.data ?? {};
      if (data.initializing) {
        await sleep(Math.max(250, Math.min(2000, Number(data.retryAfterMs) || 1000)));
        continue;
      }
      return data;
    }
    throw new AdminVideoUploadError("intent_failed", failureCopy("intent_failed"));
  }

  async function sendBytes(file, uploadInfo, record, { signal, onStage }) {
    const startedAt = now();
    let startBytes = null;
    for (let attempt = 0; ; attempt += 1) {
      try {
        await upload({
          file,
          transport: { url: uploadInfo.url, headers: { ...(uploadInfo.fields ?? {}) } },
          signal,
          onProgress: (progress) => {
            if (startBytes === null) startBytes = progress.confirmedBytes;
            const elapsed = (now() - startedAt) / 1000;
            const sent = progress.confirmedBytes - startBytes;
            const rate = elapsed > 1 && sent > 0 ? sent / elapsed : null;
            onStage?.({
              phase: "uploading",
              percent: progress.percent,
              confirmedBytes: progress.confirmedBytes,
              totalBytes: progress.totalBytes,
              secondsLeft: rate ? Math.ceil((progress.totalBytes - progress.confirmedBytes) / rate) : null,
            });
          },
        });
        return;
      } catch (error) {
        if (error?.code === "source_upload_cancelled" || signal?.aborted) throw error;
        if (error?.code === "source_too_large") throw error;
        if (!isOnline()) {
          onStage?.({ phase: "offline" });
          await waitForOnline();
          attempt -= 1;
          continue;
        }
        if (attempt >= RETRY_DELAYS_MS.length) throw error;
        onStage?.({ phase: "reconnecting" });
        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  async function confirmBytes(jobId, signal) {
    const deadline = now() + VIDEO_LIMITS.ACK_DEADLINE_MS;
    while (now() < deadline) {
      if (signal?.aborted) throw new VideoUploadError("source_upload_cancelled", "Upload cancelled.");
      const result = await call("event-cover-video-source-uploaded", { target: "ad_creative", jobId });
      if (result.error) fail(result.error, "source_upload_failed");
      const status = result.data?.status;
      if (result.data?.verification !== "pending" && status && status !== "source_uploading") {
        return result.data;
      }
      await sleep(ACK_POLL_MS);
    }
    throw new AdminVideoUploadError("ack_timeout", failureCopy("ack_timeout"));
  }

  async function applyReady(job, signal) {
    const deadline = now() + VIDEO_LIMITS.WATCH_DEADLINE_MS;
    let current = job;
    while (now() < deadline) {
      if (signal?.aborted) throw new VideoUploadError("source_upload_cancelled", "Upload cancelled.");
      const result = await call("event-cover-video-apply", {
        jobId: current.jobId,
        expectedVersion: current.applicationVersion ?? 0,
        expectedProcessedUrl: current.processedUrl ?? "",
      });
      if (!result.error) {
        const creativeId = result.data?.creativeId;
        if (typeof creativeId === "string") return creativeId;
      } else if (result.error?.error === "creative_source_untrusted") {
        fail(result.error, "creative_source_untrusted");
      }
      // creative_materialize_pending (503) or a version race (409): the
      // server owns materialization; read the job again and retry.
      await sleep(STATUS_POLL_MS);
      const refreshed = await call("event-cover-video-status", { jobId: current.jobId });
      if (refreshed.error) fail(refreshed.error, "status_failed");
      current = refreshed.data ?? current;
      if (typeof current.creativeId === "string" && current.status === "applied") {
        return current.creativeId;
      }
      if (["failed", "cancelled", "superseded"].includes(current.status)) {
        fail({ error: current.failureCode ?? current.status }, "processing_failed");
      }
    }
    throw new AdminVideoUploadError("processing_timeout", failureCopy("processing_timeout"));
  }

  async function watch(jobId, { signal, onStage }) {
    const deadline = now() + VIDEO_LIMITS.WATCH_DEADLINE_MS;
    while (now() < deadline) {
      if (signal?.aborted) throw new VideoUploadError("source_upload_cancelled", "Upload cancelled.");
      const result = await call("event-cover-video-status", { jobId });
      if (result.error) fail(result.error, "status_failed");
      const job = result.data ?? {};
      if (job.status === "ready") return job;
      if (job.status === "applied") return job;
      if (TERMINAL.has(job.status)) {
        fail({ error: job.failureCode ?? job.status }, "processing_failed");
      }
      onStage?.({ phase: "preparing", status: job.status, sourceUploadedAt: job.sourceUploadedAt ?? null });
      await sleep(STATUS_POLL_MS);
    }
    throw new AdminVideoUploadError("processing_timeout", failureCopy("processing_timeout"));
  }

  /** Drives one record from intent to a library row. Returns `{ jobId, creativeId }`. */
  async function run(file, record, { signal, onStage }) {
    onStage?.({ phase: "starting" });
    const intent = await requestIntent(record, signal);
    const jobId = intent.jobId;
    if (typeof jobId !== "string") throw new AdminVideoUploadError("intent_failed", failureCopy("intent_failed"));
    saveUploadRecord(storage, { ...record, jobId });
    onStage?.({ phase: "registered", jobId, record: { ...record, jobId } });
    try {
      if (intent.upload?.url) {
        await sendBytes(file, intent.upload, record, { signal, onStage });
        onStage?.({ phase: "confirming" });
        await confirmBytes(jobId, signal);
      }
      onStage?.({ phase: "preparing", status: "processing" });
      const job = await watch(jobId, { signal, onStage });
      onStage?.({ phase: "saving" });
      const creativeId = job.status === "applied" && typeof job.creativeId === "string"
        ? job.creativeId
        : await applyReady(job, signal);
      clearUploadRecord(storage, record.opId);
      return { jobId, creativeId };
    } catch (error) {
      // A finished outcome (failed / cancelled) never resurfaces after reload.
      if (!["source_upload_failed", "transport_integrity_failed"].includes(error?.code)) {
        clearUploadRecord(storage, record.opId);
      }
      error.jobId = jobId;
      throw error;
    }
  }

  return {
    /**
     * Starts a new upload. The refusal checks have already run at pick
     * (checkVideoFile); they run again here so no caller can skip them.
     */
    async start(file, { durationMs, signal, onStage } = {}) {
      const refusal = checkVideoFile(file, durationMs);
      if (refusal) throw new AdminVideoUploadError(refusal.code, refusal.line, { refusal });
      const type = resolveVideoType(file);
      onStage?.({ phase: "checking" });
      const digest = await sha256(file);
      const record = {
        opId: randomUUID(),
        name: file.name || `video.${type.ext}`,
        size: file.size,
        lastModified: file.lastModified ?? null,
        sha256: digest,
        mime: type.mime,
        ext: type.ext,
        durationMs: resolveRawClipDurationMs(durationMs),
        createdAt: new Date(now()).toISOString(),
      };
      if (!record.name.toLowerCase().endsWith(`.${type.ext}`)) record.name = `${record.name}.${type.ext}`;
      saveUploadRecord(storage, record);
      return run(file, record, { signal, onStage });
    },

    /** Continues an interrupted upload with the same file (size + hash). */
    async resume(record, file, { signal, onStage } = {}) {
      onStage?.({ phase: "checking" });
      const digest = await sha256(file);
      if (!isSameFile(record, file, digest)) {
        throw new AdminVideoUploadError("different_file", failureCopy("different_file"));
      }
      return run(file, { ...record, sha256: digest }, { signal, onStage });
    },

    /** Follows a job this browser started whose bytes already arrived. */
    async follow(record, { signal, onStage } = {}) {
      const job = await watch(record.jobId, { signal, onStage });
      onStage?.({ phase: "saving" });
      const creativeId = job.status === "applied" && typeof job.creativeId === "string"
        ? job.creativeId
        : await applyReady(job, signal);
      clearUploadRecord(storage, record.opId);
      return { jobId: record.jobId, creativeId };
    },

    async status(jobId) {
      const result = await call("event-cover-video-status", { jobId });
      if (result.error) {
        if (result.status === 404) return null;
        fail(result.error, "status_failed");
      }
      return result.data;
    },

    async cancel(jobId, opId) {
      if (opId) clearUploadRecord(storage, opId);
      if (!jobId) return null;
      const result = await call("event-cover-video-cancel", { jobId });
      if (result.error) fail(result.error, "cancel_failed");
      return result.data;
    },
  };
}
