// @mingla/video-upload — the ONE web TUS uploader for the shared video lane.
//
// MINGLA-INVARIANT: I-VIDEO-ONE-UPLOADER | issue #3040 | exactly one web TUS implementation exists; Host web and Admin both import this package
// MINGLA-INVARIANT: I-VIDEO-OTA-PURE-JS | issue #3040 | this package contains no native code and imports no react-native or expo module
//
// Plain ES module JavaScript with no dependencies. It runs in browsers (Host
// web through Metro, Admin through Vite) and under Node for tests. It never
// touches a native module, so shipping it can never change a native build.

import { VIDEO_LIMITS } from "./limits.js";

export { VIDEO_LIMITS };

/** A typed failure. `code` is stable; `detail` names the exact transport step. */
export class VideoUploadError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = "VideoUploadError";
    this.code = code;
    this.detail = detail;
  }
}

const cancelled = () =>
  new VideoUploadError("source_upload_cancelled", "Video upload was cancelled.", "aborted");

/**
 * The duration a RAW (untrimmed) clip is declared with. A clip that runs past
 * one minute by no more than the tolerance is declared as exactly one minute.
 * Everything else is returned rounded to a whole millisecond (the lane's
 * duration columns are integers). Platform-agnostic: web and native agree.
 */
export const resolveRawClipDurationMs = (ms) => {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return 0;
  const rounded = Math.round(ms);
  if (
    rounded > VIDEO_LIMITS.MAX_DURATION_MS &&
    rounded <= VIDEO_LIMITS.MAX_DURATION_MS + VIDEO_LIMITS.SOURCE_DURATION_TOLERANCE_MS
  ) {
    return VIDEO_LIMITS.MAX_DURATION_MS;
  }
  return rounded;
};

/** True when an ad video is shorter than the 5 s ad minimum. */
export const isAdVideoTooShort = (durationMs) =>
  typeof durationMs === "number" &&
  Number.isFinite(durationMs) &&
  durationMs > 0 &&
  durationMs < VIDEO_LIMITS.AD_MIN_DURATION_MS;

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// TUS Upload-Metadata values are base64. A tiny pure UTF-8 + base64 encoder
// works on every runtime (Hermes has no global btoa for non-Latin-1 input).
const toBase64 = (input) => {
  const bytes = [];
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? BASE64_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? BASE64_ALPHABET[b2 & 63] : "=";
  }
  return out;
};

/** TUS `Upload-Metadata` header value: `filetype`, then `title`, then `sha256`. */
export const tusMetadata = (metadata) => {
  const filetype = metadata?.filetype ?? "video/mp4";
  const parts = [`filetype ${toBase64(filetype)}`];
  const title = metadata?.title;
  if (typeof title === "string" && title.length > 0) parts.push(`title ${toBase64(title)}`);
  const sha256 = metadata?.sha256;
  if (typeof sha256 === "string" && sha256.length > 0) parts.push(`sha256 ${toBase64(sha256)}`);
  return parts.join(",");
};

/**
 * SHA-256 of a Blob/File as lowercase hex. Refuses a blob over the source cap
 * BEFORE reading it, so an oversized pick never pulls 100+ MB into memory.
 */
export const sha256OfBlob = async (blob, subtle = globalThis.crypto?.subtle) => {
  if (!blob || typeof blob.size !== "number") {
    throw new VideoUploadError("source_unreadable", "The video could not be read.", "no_blob");
  }
  if (blob.size > VIDEO_LIMITS.SOURCE_MAX_BYTES) {
    throw new VideoUploadError(
      "source_too_large",
      "This video is over 100 MB.",
      `bytes_${blob.size}`,
    );
  }
  if (!subtle || typeof subtle.digest !== "function") {
    throw new VideoUploadError("source_unreadable", "This browser can't check the video.", "no_subtle_crypto");
  }
  const digest = await subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

/** The server-confirmed TUS offset (HEAD). Abort through `signal`. */
export const headTusOffset = async ({ url, headers = {}, signal, fetchImpl }) => {
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (signal?.aborted) throw cancelled();
  let response;
  try {
    response = await doFetch(url, {
      method: "HEAD",
      headers: { ...headers, "Tus-Resumable": "1.0.0" },
      signal,
    });
  } catch {
    if (signal?.aborted) throw cancelled();
    throw new VideoUploadError(
      "source_upload_failed",
      "Connection interrupted. Resume when you're back online.",
      "tus_head_transport_failed",
    );
  }
  if (!response.ok) {
    throw new VideoUploadError(
      "transport_integrity_failed",
      "We couldn't resume this upload. Choose the original video again.",
      `tus_head_http_${response.status}`,
    );
  }
  const offset = Number(response.headers.get("Upload-Offset"));
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new VideoUploadError(
      "transport_integrity_failed",
      "We couldn't resume this upload. Choose the original video again.",
      "tus_head_offset_invalid",
    );
  }
  return offset;
};

/**
 * One TUS PATCH through XMLHttpRequest (the only browser API with upload
 * progress). `onProgress(loaded)` reports bytes HANDED TO THE NETWORK for this
 * chunk — never server-confirmed bytes, so callers must not show it as 100.
 */
export const patchTusChunkXhr = ({ url, headers = {}, blob, offset, onProgress, signal, XhrImpl }) =>
  new Promise((resolve, reject) => {
    const Xhr = XhrImpl ?? globalThis.XMLHttpRequest;
    if (typeof Xhr !== "function") {
      reject(new VideoUploadError("source_upload_failed", "This browser can't upload videos.", "no_xhr"));
      return;
    }
    if (signal?.aborted) {
      reject(cancelled());
      return;
    }
    const xhr = new Xhr();
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.("abort", onAbort);
      fn(value);
    };
    const onAbort = () => {
      try { xhr.abort(); } catch { /* the request may already be finished */ }
      settle(reject, cancelled());
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
    if (xhr.upload) {
      xhr.upload.onprogress = (event) => {
        if (typeof onProgress === "function" && Number.isFinite(event?.loaded)) onProgress(event.loaded);
      };
    }
    xhr.onerror = () =>
      settle(
        reject,
        new VideoUploadError(
          "source_upload_failed",
          "We couldn't upload this video. Check your connection and resume.",
          "tus_patch_transport_failed",
        ),
      );
    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 204) {
        const header = typeof xhr.getResponseHeader === "function" ? xhr.getResponseHeader("Upload-Offset") : null;
        const serverOffset = header === null || header === undefined ? null : Number(header);
        settle(resolve, Number.isSafeInteger(serverOffset) ? serverOffset : null);
        return;
      }
      settle(
        reject,
        new VideoUploadError(
          "source_upload_failed",
          "We couldn't upload this video. Check your connection and resume.",
          `tus_patch_http_${xhr.status}`,
        ),
      );
    };
    xhr.open("PATCH", url);
    const merged = {
      ...headers,
      "Content-Type": "application/offset+octet-stream",
      "Tus-Resumable": "1.0.0",
      "Upload-Offset": String(offset),
    };
    for (const [key, value] of Object.entries(merged)) {
      // Browsers forbid script-set Content-Length; they derive it from the body.
      if (key.toLowerCase() === "content-length") continue;
      xhr.setRequestHeader(key, value);
    }
    xhr.send(blob);
  });

/**
 * Truthful upload percent (A-8). Counts only server-confirmed bytes plus the
 * bytes of the chunk currently on the wire, scaled to 99. It can never reach
 * 100: only `uploadSourceWeb` reports 100, and only after the final PATCH
 * response AND a HEAD whose offset equals the total.
 */
export const projectUploadPercent = ({ confirmedBytes, inflightLoaded = 0, total }) => {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const done = Math.max(0, Math.min(total, (confirmedBytes ?? 0) + Math.max(0, inflightLoaded ?? 0)));
  return Math.max(0, Math.min(99, Math.floor((99 * done) / total)));
};

/**
 * Upload a browser File/Blob to a server-issued TUS resource, resuming from
 * the server's offset. Every chunk is confirmed by a HEAD before it counts.
 *
 * `transport` = `{ url, headers }` exactly as the lane's upload intent issued
 * them (opaque, forwarded verbatim). `onProgress` receives
 * `{ percent, confirmedBytes, totalBytes, final }`.
 */
export const uploadSourceWeb = async ({
  file,
  transport,
  signal,
  onProgress,
  chunkBytes = VIDEO_LIMITS.TUS_CHUNK_WEB_BYTES,
  fetchImpl,
  XhrImpl,
}) => {
  if (signal?.aborted) throw cancelled();
  const total = file?.size;
  if (!Number.isFinite(total) || total <= 0) {
    throw new VideoUploadError("source_upload_failed", "Video file was empty.", "empty_source");
  }
  if (total > VIDEO_LIMITS.SOURCE_MAX_BYTES) {
    throw new VideoUploadError("source_too_large", "This video is over 100 MB.", `bytes_${total}`);
  }
  const emit = (confirmedBytes, inflightLoaded, final = false) => {
    if (typeof onProgress !== "function") return;
    onProgress({
      percent: final ? 100 : projectUploadPercent({ confirmedBytes, inflightLoaded, total }),
      confirmedBytes,
      totalBytes: total,
      final,
    });
  };
  const head = () => headTusOffset({ url: transport.url, headers: transport.headers, signal, fetchImpl });
  let offset = await head();
  if (offset > total) {
    throw new VideoUploadError(
      "transport_integrity_failed",
      "We couldn't resume this upload. Choose the original video again.",
      "tus_offset_beyond_source",
    );
  }
  emit(offset, 0);
  while (offset < total) {
    const length = Math.min(chunkBytes, total - offset);
    const chunkStart = offset;
    await patchTusChunkXhr({
      url: transport.url,
      headers: transport.headers,
      blob: file.slice(chunkStart, chunkStart + length),
      offset: chunkStart,
      signal,
      XhrImpl,
      onProgress: (loaded) => emit(chunkStart, Math.min(loaded, length)),
    });
    const serverOffset = await head();
    if (serverOffset <= chunkStart || serverOffset > total) {
      throw new VideoUploadError(
        "transport_integrity_failed",
        "We couldn't resume this upload. Choose the original video again.",
        "tus_offset_not_advanced",
      );
    }
    offset = serverOffset;
    if (offset < total) emit(offset, 0);
  }
  // Final PATCH answered AND the HEAD says every byte is there: only now 100.
  emit(total, 0, true);
  return { confirmedBytes: total, totalBytes: total };
};
