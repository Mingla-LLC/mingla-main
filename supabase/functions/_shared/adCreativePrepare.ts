import type { AdConnectionRow, Platform } from "./adChannel.ts";
import {
  bytesToBase64,
  CreativeByteSourceError,
  CreativeUploadError,
  mintSnapAccessToken,
  scrubCreativeSecrets,
  SNAP_API_BASE,
  SNAP_CHUNK_BYTES,
  SNAP_MAX_CHUNKS,
  SNAP_SINGLE_SHOT_MAX_BYTES,
  TIKTOK_API_BASE,
} from "./adCreative.ts";
import type { AdCreativeRow, CreativeUploadDeps } from "./adCreative.ts";
// #3040 — the trusted Bunny byte source (CDN identity, public DNS, bounded
// fetch, byte probe) lives in its own dependency-light module so the video
// lane can verify an ad video without importing every provider adapter.
// Everything it exports is re-exported here unchanged.
import {
  constantTimeEqual,
  CreativeTrustError,
  probeTrustedVideoSources,
  type TrustedFetchDeps,
  type VerifiedCreativeBytes,
} from "./adCreativeTrustedSource.ts";
export {
  assertCreativeCdnConfigured,
  CreativeTrustError,
  probeTrustedVideoSources,
} from "./adCreativeTrustedSource.ts";
export type {
  TrustedFetchDeps,
  TrustedVideoProbe,
  VerifiedCreativeBytes,
} from "./adCreativeTrustedSource.ts";
import { normalizeMetaError, resolveMetaClient } from "./meta.ts";
import { resolveGoogleClient } from "./google.ts";
import type { GoogleClient } from "./google.ts";

export type PreparationPlatform = "meta" | "snapchat" | "tiktok" | "google";
export type PreparationState =
  | "not_started"
  | "uploading"
  | "processing"
  | "ready"
  | "failed"
  | "timed_out";

export interface PrepareBeginRow {
  ref_id: string;
  won: boolean;
  decision:
    | "initiate"
    | "check_existing"
    | "return_not_started"
    | "return_active"
    | "return_ready"
    | "return_terminal"
    | "action_not_applicable"
    | "identity_conflict";
  current_attempt_id: string | null;
  current_attempt_count: number;
  current_status:
    | "pending"
    | "uploading"
    | "processing"
    | "ready"
    | "failed"
    | "timed_out";
  current_external_ref: string | null;
  current_external_ref_extra: Record<string, unknown>;
  current_content_hash: string;
  current_attempt_started_at: string | null;
  current_provider_ref_recorded_at: string | null;
  current_last_checked_at: string | null;
  current_deadline_at: string | null;
  current_error_code: string | null;
  current_retryable: boolean;
  current_provider_terminal_attempt_id: string | null;
  current_provider_terminal_at: string | null;
  current_provider_terminal_code: string | null;
  current_trace_id: string | null;
}

export class ProviderRateLimitError extends Error {
  readonly platform: PreparationPlatform;
  readonly retryAfterSeconds: number;

  constructor(platform: PreparationPlatform, retryAfterSeconds: number) {
    super(`${platform} rate limited the preparation check.`);
    this.name = "ProviderRateLimitError";
    this.platform = platform;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function boundedRetryAfterSeconds(
  value: string | null,
  now = Date.now(),
): number {
  const numeric = Number(value);
  if (value !== null && value.trim() !== "" && Number.isFinite(numeric)) {
    return Math.min(60, Math.max(1, Math.ceil(numeric)));
  }
  const date = value ? Date.parse(value) : NaN;
  if (Number.isFinite(date)) {
    return Math.min(60, Math.max(1, Math.ceil((date - now) / 1000)));
  }
  return 10;
}

export async function verifyCreativeBytes(
  asset: AdCreativeRow & { poster_content_hash?: string | null },
  deps: TrustedFetchDeps = {},
): Promise<VerifiedCreativeBytes> {
  if (!asset.poster_content_hash) {
    throw new CreativeTrustError(
      "creative_poster_identity_missing",
      422,
      "This video must be recorded again before it can be prepared.",
    );
  }
  const probed = await probeTrustedVideoSources(asset, deps);
  const { videoHash, posterHash } = probed;
  if (
    !constantTimeEqual(videoHash, asset.content_hash) ||
    !constantTimeEqual(posterHash, asset.poster_content_hash)
  ) {
    throw new CreativeTrustError(
      "creative_identity_changed",
      409,
      "The creative bytes changed after validation. Record a new creative before preparing it.",
    );
  }
  return probed.bytes;
}

export interface ProviderLifecycleHooks {
  saveProviderRef(
    ref: string,
    extra?: Record<string, unknown>,
  ): Promise<boolean>;
  mergeProviderExtra(extra: Record<string, unknown>): Promise<boolean>;
  markProcessing(): Promise<boolean>;
}

export interface ProviderCheckResult {
  state: "processing" | "ready" | "terminal";
  terminalCode?: string;
  retryAfterSeconds?: number;
  preview?: Record<string, unknown> | null;
  // ISSUE-997 D1: a provider whose stable media id is only learned at READY time
  // (Google/YouTube returns the youtube_video_id only once state === "PROCESSED")
  // returns it here so the prepare endpoint folds it into external_ref_extra on the
  // READY transition. Providers that record their full extra at initiate
  // (Meta/Snap/TikTok) never set this — it is a strict no-op for them.
  mergeExtra?: Record<string, unknown>;
}

export interface PrepareProviderAdapter {
  initiate(
    asset: AdCreativeRow,
    connection: AdConnectionRow,
    bytes: VerifiedCreativeBytes,
    hooks: ProviderLifecycleHooks,
    deps?: CreativeUploadDeps,
  ): Promise<void>;
  resume?(
    asset: AdCreativeRow,
    connection: AdConnectionRow,
    bytes: VerifiedCreativeBytes,
    ref: string,
    extra: Record<string, unknown>,
    hooks: ProviderLifecycleHooks,
    deps?: CreativeUploadDeps,
  ): Promise<void>;
  check(
    ref: string,
    extra: Record<string, unknown>,
    connection: AdConnectionRow,
    deps?: CreativeUploadDeps,
  ): Promise<ProviderCheckResult>;
}

async function responseJson(
  response: Response,
): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function metaRequest(
  connection: AdConnectionRow,
  path: string,
  init: RequestInit,
  deps: CreativeUploadDeps,
): Promise<Record<string, unknown>> {
  const client = resolveMetaClient(connection);
  const response = await (deps.fetchImpl ?? fetch)(
    `${client.config.graphBase}/${client.config.apiVersion}/${
      path.replace(/^\//, "")
    }`,
    {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${client.token}`,
      },
    },
  );
  const payload = await responseJson(response);
  if (!response.ok || payload.error) {
    const normalized = normalizeMetaError(payload);
    throw new CreativeUploadError("meta", "meta_api_error", normalized.message);
  }
  return payload;
}

async function uploadMetaPoster(
  connection: AdConnectionRow,
  posterBytes: Uint8Array,
  hooks: ProviderLifecycleHooks,
  deps: CreativeUploadDeps,
): Promise<void> {
  const poster = await metaRequest(
    connection,
    `act_${connection.external_account_id}/adimages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bytes: bytesToBase64(posterBytes) }),
    },
    deps,
  );
  const images = poster.images && typeof poster.images === "object"
    ? poster.images as Record<string, unknown>
    : {};
  let thumbnail = "";
  for (const value of Object.values(images)) {
    if (
      value && typeof value === "object" &&
      typeof (value as Record<string, unknown>).hash === "string"
    ) {
      thumbnail = String((value as Record<string, unknown>).hash);
      break;
    }
  }
  if (!thumbnail) {
    throw new CreativeUploadError(
      "meta",
      "meta_poster_hash_missing",
      "Meta returned no poster hash.",
    );
  }
  if (!await hooks.mergeProviderExtra({ thumbnail_image_hash: thumbnail })) {
    return;
  }
  await hooks.markProcessing();
}

const metaPrepareAdapter: PrepareProviderAdapter = {
  initiate: async (asset, connection, bytes, hooks, deps = {}) => {
    const form = new FormData();
    form.append(
      "source",
      new Blob([bytes.video as BlobPart], {
        type: asset.mime_type ?? "video/mp4",
      }),
      `${asset.name}.mp4`,
    );
    form.append("name", asset.name);
    const created = await metaRequest(
      connection,
      `act_${connection.external_account_id}/advideos`,
      { method: "POST", body: form },
      deps,
    );
    const videoId = typeof created.id === "string" ? created.id : "";
    if (!videoId) {
      throw new CreativeUploadError(
        "meta",
        "meta_video_id_missing",
        "Meta returned no video id.",
      );
    }
    if (!await hooks.saveProviderRef(videoId)) return;

    await uploadMetaPoster(connection, bytes.poster, hooks, deps);
  },
  resume: async (_asset, connection, bytes, _ref, extra, hooks, deps = {}) => {
    if (typeof extra.thumbnail_image_hash === "string") return;
    await uploadMetaPoster(connection, bytes.poster, hooks, deps);
  },
  check: async (ref, _extra, connection, deps = {}) => {
    const payload = await metaRequest(connection, `${ref}?fields=status`, {
      method: "GET",
    }, deps);
    const status = payload.status && typeof payload.status === "object"
      ? (payload.status as Record<string, unknown>).video_status
      : null;
    if (status === "ready") return { state: "ready" };
    if (status === "error") {
      return {
        state: "terminal",
        terminalCode: "meta_video_processing_failed",
      };
    }
    return { state: "processing", retryAfterSeconds: 10 };
  },
};

function requiredToken(connection: AdConnectionRow): string {
  const token = (Deno.env.get(connection.token_env_var) ?? "").trim();
  if (!token) {
    throw new CreativeUploadError(
      connection.platform,
      "provider_not_connected",
      "Provider connection is unavailable.",
    );
  }
  return token;
}

async function snapRequest(
  path: string,
  token: string,
  init: RequestInit,
  deps: CreativeUploadDeps,
): Promise<{ payload: Record<string, unknown>; response: Response }> {
  const response = await (deps.fetchImpl ?? fetch)(`${SNAP_API_BASE}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  const payload = await responseJson(response);
  if (response.status === 429) {
    throw new ProviderRateLimitError(
      "snapchat",
      boundedRetryAfterSeconds(response.headers.get("retry-after")),
    );
  }
  const requestStatus = payload.request_status;
  if (
    !response.ok || (requestStatus !== undefined && requestStatus !== "SUCCESS")
  ) {
    throw new CreativeUploadError(
      "snapchat",
      "snapchat_api_error",
      "Snapchat rejected the media request.",
    );
  }
  return { payload, response };
}

function snapMedia(payload: Record<string, unknown>): Record<string, unknown> {
  const media = payload.media;
  if (!Array.isArray(media) || !media[0] || typeof media[0] !== "object") {
    return {};
  }
  const wrapper = media[0] as Record<string, unknown>;
  return wrapper.media && typeof wrapper.media === "object"
    ? wrapper.media as Record<string, unknown>
    : {};
}

const snapPrepareAdapter: PrepareProviderAdapter = {
  initiate: async (asset, connection, bytes, hooks, deps = {}) => {
    const token = await mintSnapAccessToken(deps);
    const account = connection.external_account_id;
    const { payload } = await snapRequest(
      `/adaccounts/${account}/media`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media: [{ name: asset.name, type: "VIDEO", ad_account_id: account }],
        }),
      },
      deps,
    );
    const mediaId = String(snapMedia(payload).id ?? "");
    if (!mediaId) {
      throw new CreativeUploadError(
        "snapchat",
        "snapchat_media_id_missing",
        "Snapchat returned no media id.",
      );
    }
    if (!await hooks.saveProviderRef(mediaId)) return;

    const fileName = `${asset.name}.mp4`;
    if (bytes.video.byteLength <= SNAP_SINGLE_SHOT_MAX_BYTES) {
      const form = new FormData();
      form.append("file", new Blob([bytes.video as BlobPart]), fileName);
      await snapRequest(`/media/${mediaId}/upload`, token, {
        method: "POST",
        body: form,
      }, deps);
    } else {
      const chunkCount = Math.ceil(bytes.video.byteLength / SNAP_CHUNK_BYTES);
      if (chunkCount > SNAP_MAX_CHUNKS) {
        throw new CreativeUploadError(
          "snapchat",
          "snapchat_video_too_large",
          "Snapchat video exceeds the upload ceiling.",
        );
      }
      const { payload: initPayload } = await snapRequest(
        `/media/${mediaId}/multipart-upload-v2?action=INIT&file_name=${
          encodeURIComponent(fileName)
        }&file_size=${bytes.video.byteLength}`,
        token,
        { method: "POST" },
        deps,
      );
      const result =
        initPayload.result && typeof initPayload.result === "object"
          ? initPayload.result as Record<string, unknown>
          : {};
      const uploadId = String(result.upload_id ?? initPayload.upload_id ?? "");
      if (!uploadId) {
        throw new CreativeUploadError(
          "snapchat",
          "snapchat_upload_id_missing",
          "Snapchat returned no upload id.",
        );
      }
      for (let index = 0; index < chunkCount; index++) {
        const chunk = bytes.video.subarray(
          index * SNAP_CHUNK_BYTES,
          (index + 1) * SNAP_CHUNK_BYTES,
        );
        const form = new FormData();
        form.append("file", new Blob([chunk as BlobPart]), fileName);
        await snapRequest(
          `/media/${mediaId}/multipart-upload-v2?action=ADD&part_number=${
            index + 1
          }&upload_id=${encodeURIComponent(uploadId)}`,
          token,
          { method: "POST", body: form },
          deps,
        );
      }
      await snapRequest(
        `/media/${mediaId}/multipart-upload-v2?action=FINALIZE&upload_id=${
          encodeURIComponent(uploadId)
        }`,
        token,
        { method: "POST" },
        deps,
      );
    }
    await hooks.markProcessing();
  },
  check: async (ref, _extra, _connection, deps = {}) => {
    const token = await mintSnapAccessToken(deps);
    const { payload, response } = await snapRequest(`/media/${ref}`, token, {
      method: "GET",
    }, deps);
    const status = snapMedia(payload).media_status;
    if (status === "READY") return { state: "ready" };
    if (status === "ERROR") {
      return { state: "terminal", terminalCode: "snapchat_media_error" };
    }
    const retryAfter = Number(response.headers.get("retry-after") ?? "10");
    return {
      state: "processing",
      retryAfterSeconds: Number.isFinite(retryAfter)
        ? Math.min(60, Math.max(5, retryAfter))
        : 10,
    };
  },
};

export function md5Hex(bytes: Uint8Array): string {
  const rotate = (value: number, amount: number): number =>
    (value << amount) | (value >>> (32 - amount));
  const length = bytes.length;
  const paddedLength = (((length + 8) >>> 6) + 1) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[length] = 0x80;
  const bitLength = length * 8;
  for (let i = 0; i < 8; i++) {
    data[paddedLength - 8 + i] = Math.floor(bitLength / 2 ** (8 * i)) & 0xff;
  }
  const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const constants = Array.from(
    { length: 64 },
    (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0,
  );
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const words = new Int32Array(16);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const at = offset + i * 4;
      words[i] = data[at] | (data[at + 1] << 8) | (data[at + 2] << 16) |
        (data[at + 3] << 24);
    }
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const next = d;
      d = c;
      c = b;
      const shift = shifts[Math.floor(i / 16) * 4 + (i % 4)];
      b = (b + rotate((a + f + constants[i] + words[g]) | 0, shift)) | 0;
      a = next;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  return [a0, b0, c0, d0]
    .flatMap((
      word,
    ) => [
      word & 0xff,
      (word >>> 8) & 0xff,
      (word >>> 16) & 0xff,
      (word >>> 24) & 0xff,
    ])
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function tiktokRequest(
  path: string,
  token: string,
  init: RequestInit,
  deps: CreativeUploadDeps,
): Promise<Record<string, unknown>> {
  const response = await (deps.fetchImpl ?? fetch)(
    `${TIKTOK_API_BASE}${path}`,
    {
      ...init,
      headers: { ...(init.headers ?? {}), "Access-Token": token },
    },
  );
  const payload = await responseJson(response);
  if (!response.ok || payload.code !== 0) {
    throw new CreativeUploadError(
      "tiktok",
      "tiktok_api_error",
      "TikTok rejected the video request.",
    );
  }
  return payload.data && typeof payload.data === "object"
    ? payload.data as Record<string, unknown>
    : {};
}

function firstRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return value[0] && typeof value[0] === "object"
      ? value[0] as Record<string, unknown>
      : {};
  }
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function matchingTikTokRecord(
  value: unknown,
  requestedVideoId: string,
): Record<string, unknown> {
  const records = Array.isArray(value) ? value : [value];
  for (const candidate of records) {
    if (
      candidate && typeof candidate === "object" &&
      (candidate as Record<string, unknown>).video_id === requestedVideoId
    ) {
      return candidate as Record<string, unknown>;
    }
  }
  return {};
}

function validTikTokPreviewUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

// ISSUE-997 C: a TikTok SINGLE_VIDEO ad-object needs a cover image_id alongside
// the video_id. Capture it PREPARE-SIDE (Seth-approved D-C1) from the already-
// trusted poster bytes — mirroring how metaPrepareAdapter uploads the poster and
// merges thumbnail_image_hash (uploadMetaPoster). Keeping the upload inside
// prepare preserves the #1184 invariant that create is a pure READY-ref consumer
// and never re-uploads provider media inline.
async function uploadTiktokCover(
  connection: AdConnectionRow,
  posterBytes: Uint8Array,
  asset: AdCreativeRow,
  hooks: ProviderLifecycleHooks,
  deps: CreativeUploadDeps,
): Promise<void> {
  const token = requiredToken(connection);
  const form = new FormData();
  form.append("advertiser_id", connection.external_account_id);
  form.append("upload_type", "UPLOAD_BY_FILE");
  form.append("file_name", `${asset.name}-cover.jpg`);
  form.append("image_signature", md5Hex(posterBytes));
  form.append(
    "image_file",
    new Blob([posterBytes as BlobPart], { type: "image/jpeg" }),
    `${asset.name}-cover.jpg`,
  );
  const data = await tiktokRequest(
    "/file/image/ad/upload/",
    token,
    { method: "POST", body: form },
    deps,
  );
  const record = firstRecord(data.list ?? data);
  const coverImageId = typeof record.image_id === "string"
    ? record.image_id
    : "";
  if (!coverImageId) {
    throw new CreativeUploadError(
      "tiktok",
      "tiktok_cover_image_id_missing",
      "TikTok returned no cover image_id.",
    );
  }
  if (!await hooks.mergeProviderExtra({ cover_image_id: coverImageId })) return;
  await hooks.markProcessing();
}

const tiktokPrepareAdapter: PrepareProviderAdapter = {
  initiate: async (asset, connection, bytes, hooks, deps = {}) => {
    const token = requiredToken(connection);
    const form = new FormData();
    form.append("advertiser_id", connection.external_account_id);
    form.append("upload_type", "UPLOAD_BY_FILE");
    form.append("file_name", `${asset.name}.mp4`);
    form.append("video_signature", md5Hex(bytes.video));
    form.append(
      "video_file",
      new Blob([bytes.video as BlobPart], {
        type: asset.mime_type ?? "video/mp4",
      }),
      `${asset.name}.mp4`,
    );
    const data = await tiktokRequest(
      "/file/video/ad/upload/",
      token,
      { method: "POST", body: form },
      deps,
    );
    const record = firstRecord(data.list ?? data);
    const materialId = typeof record.material_id === "string"
      ? record.material_id
      : "";
    const videoId = typeof record.video_id === "string" ? record.video_id : "";
    const primary = materialId || videoId;
    if (!primary || !videoId) {
      throw new CreativeUploadError(
        "tiktok",
        "tiktok_video_id_missing",
        "TikTok returned no stable video id.",
      );
    }
    if (!await hooks.saveProviderRef(primary, { video_id: videoId })) return;
    // ISSUE-997 C: capture the cover image_id BEFORE markProcessing, so a
    // "processing"/"ready" ref always carries { video_id, cover_image_id }. The
    // authoritative completeness gate is the create branch's creative_ref_incomplete
    // check (a legacy #1184 ref with no cover fails closed there, never silently).
    await uploadTiktokCover(connection, bytes.poster, asset, hooks, deps);
  },
  check: async (_ref, extra, connection, deps = {}) => {
    const token = requiredToken(connection);
    const videoId = typeof extra.video_id === "string" ? extra.video_id : "";
    if (!videoId) {
      return { state: "terminal", terminalCode: "tiktok_video_id_missing" };
    }
    const query = new URLSearchParams({
      advertiser_id: connection.external_account_id,
      video_ids: JSON.stringify([videoId]),
    });
    const data = await tiktokRequest(
      `/file/video/ad/info/?${query.toString()}`,
      token,
      { method: "GET" },
      deps,
    );
    const record = matchingTikTokRecord(data.list ?? data, videoId);
    const previewUrl = validTikTokPreviewUrl(record.preview_url);
    const previewExpiry = typeof record.preview_url_expire_time === "string"
      ? record.preview_url_expire_time.trim()
      : "";
    const parsedExpiry = Date.parse(previewExpiry);
    if (
      record.video_id === videoId && record.displayable === true &&
      previewUrl && previewExpiry && Number.isFinite(parsedExpiry)
    ) {
      return {
        state: "ready",
        preview: {
          external_url: previewUrl,
          expires_at: previewExpiry,
        },
      };
    }
    return { state: "processing", retryAfterSeconds: 10 };
  },
};

// ── ISSUE-997 D1: Google (YouTube) video prepare adapter ─────────────────────
// Ports the working legacy YouTube resumable upload+poll (the dead-at-create
// googleCreativeAdapter in adCreative.ts) into the #1184 PrepareProviderAdapter
// shape. Auth resolves through google.ts::resolveGoogleClient (NOT the file-private
// googleHeaders()/googleAdsVersion()), so no adCreative.ts internals are needed.
// Unlike the legacy in-loop poll, check() polls exactly ONCE per call: the #1184
// client re-polls with retry_after, so YouTube's ~180s processing fits inside the
// 60-minute RPC deadline with zero edge wall-clock risk. The upload lands an
// UNLISTED video on the Google-managed channel (an ASSET, never an ad — no spend,
// deletable). bytes.poster is IGNORED — Google needs no cover (contrast TikTok C,
// which uploads a cover_image_id). The youtube_video_id is only known at PROCESSED
// time, so check() surfaces it via mergeExtra for the endpoint to fold into
// external_ref_extra on the READY transition (§3.1). Create stays a separate,
// still-fail-closed gate (D2) — this adapter only produces a READY ref.
function googleAdsAuthHeaders(client: GoogleClient): Record<string, string> {
  return {
    Authorization: `Bearer ${client.accessToken}`,
    "developer-token": client.developerToken,
    "login-customer-id": client.loginCustomerId,
  };
}

const googlePrepareAdapter: PrepareProviderAdapter = {
  initiate: async (asset, connection, bytes, hooks, deps = {}) => {
    const client = await resolveGoogleClient(connection);
    const fetchImpl = deps.fetchImpl ?? fetch;
    const startResponse = await fetchImpl(
      `${client.apiBase}/resumable/upload/${client.apiVersion}/customers/${client.customerId}/youTubeVideoUploads:create`,
      {
        method: "POST",
        headers: {
          ...googleAdsAuthHeaders(client),
          "Content-Type": "application/json",
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": String(bytes.video.byteLength),
        },
        // #1288: the documented Google Ads YouTube resumable START body carries
        // the video metadata + privacy — an empty {} left the session without the
        // required UNLISTED metadata, so the guardrail comment above ("UNLISTED
        // video") was never actually enforced in the request. video_title is the
        // creative name; description is static + brand-safe (no PII).
        body: JSON.stringify({
          customer_id: client.customerId,
          you_tube_video_upload: {
            video_title: asset.name,
            video_description: "Mingla ad creative",
            video_privacy: "UNLISTED",
          },
        }),
      },
    );
    if (!startResponse.ok) {
      throw new CreativeUploadError(
        "google",
        "google_yt_upload_start_failed",
        `YouTube resumable start failed: HTTP ${startResponse.status}.`,
      );
    }
    const uploadUrl = startResponse.headers.get("X-Goog-Upload-URL");
    if (!uploadUrl) {
      throw new CreativeUploadError(
        "google",
        "google_yt_upload_url_missing",
        "YouTube resumable start returned no X-Goog-Upload-URL header.",
      );
    }
    // #1288: the documented Google Ads YouTube resumable data/finalize leg is a
    // PUT that carries `Authorization: Bearer <token>` — the Google Ads upload URL
    // (unlike a generic pre-signed GCS session URL) requires the bearer token on
    // the data leg. The prior POST with no Authorization deterministically failed
    // after a 200 START (RC-1/RC-3). Per doc the data leg needs ONLY the bearer —
    // NOT developer-token / login-customer-id.
    const uploadResponse = await fetchImpl(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${client.accessToken}`,
        "X-Goog-Upload-Command": "upload, finalize",
        "X-Goog-Upload-Offset": "0",
      },
      body: bytes.video as unknown as BodyInit,
    });
    if (!uploadResponse.ok) {
      // #1288: surface WHY Google rejected so ONE re-capture is decisive
      // (401 "invalid authentication credentials" ⇒ RC-1 vs 400 metadata ⇒ RC-2).
      // scrubCreativeSecrets redacts any Bearer/meta token before it reaches logs.
      const failBody = scrubCreativeSecrets(
        (await uploadResponse.text()).slice(0, 300),
      );
      throw new CreativeUploadError(
        "google",
        "google_yt_upload_failed",
        `YouTube resumable upload/finalize failed: HTTP ${uploadResponse.status} ${failBody}`,
      );
    }
    const uploadPayload = await responseJson(uploadResponse);
    const nested = uploadPayload.youTubeVideoUpload;
    const resourceName = typeof uploadPayload.resourceName === "string"
      ? uploadPayload.resourceName
      : nested && typeof nested === "object" &&
          typeof (nested as Record<string, unknown>).resourceName === "string"
      ? String((nested as Record<string, unknown>).resourceName)
      : "";
    if (!resourceName) {
      throw new CreativeUploadError(
        "google",
        "google_yt_resource_missing",
        "YouTube resumable finalize returned no youTubeVideoUpload resourceName.",
      );
    }
    if (
      !await hooks.saveProviderRef(resourceName, {
        upload_resource_name: resourceName,
      })
    ) return;
    await hooks.markProcessing();
  },
  check: async (ref, extra, connection, deps = {}) => {
    const client = await resolveGoogleClient(connection);
    const fetchImpl = deps.fetchImpl ?? fetch;
    const resourceName = typeof extra.upload_resource_name === "string" &&
        extra.upload_resource_name
      ? extra.upload_resource_name
      : ref;
    // #1292: `youTubeVideoUploads/{id}` is NOT a routable Ads-API REST GET — it is a
    // resumable-upload (POST …:create) + GAQL resource, so Google's front door answers
    // a GET on that path with a generic HTML 404 (never a JSON NOT_FOUND). The prior
    // GET therefore never saw PROCESSED and the ref spun to timeout. The documented v24
    // mechanism is a GAQL search on `you_tube_video_upload` filtered by resource_name;
    // `state` reaches PROCESSED and `video_id` is populated there. `resourceName` is our
    // own Google-generated saved ref (fixed shape, no user input) — safe to interpolate.
    const query = "SELECT you_tube_video_upload.resource_name, " +
      "you_tube_video_upload.video_id, you_tube_video_upload.state " +
      "FROM you_tube_video_upload " +
      `WHERE you_tube_video_upload.resource_name = '${resourceName}'`;
    const pollResponse = await fetchImpl(
      `${client.apiBase}/${client.apiVersion}/customers/${client.customerId}/googleAds:search`,
      {
        method: "POST",
        headers: {
          ...googleAdsAuthHeaders(client),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      },
    );
    // Direct fetchImpl POST (not googleAdsRequest) preserves the adapter's deps.fetchImpl
    // DI and today's tolerant-on-transient behavior: a non-2xx / un-parseable body →
    // responseJson {} → empty results → state=null → processing (retry), never a false
    // terminal. `payload` is redirected to the parsed upload row so the enum→verdict
    // mapping below (video_id read + PROCESSED/FAILED handling) stays UNCHANGED.
    const searchPayload = await responseJson(pollResponse);
    const results = Array.isArray(searchPayload.results)
      ? searchPayload.results as Record<string, unknown>[]
      : [];
    const payload = (results[0]?.youTubeVideoUpload ??
      results[0]?.you_tube_video_upload ?? {}) as Record<string, unknown>;
    const state = typeof payload.state === "string" ? payload.state : null;
    if (state === "PROCESSED") {
      const videoId = typeof payload.videoId === "string"
        ? payload.videoId
        : typeof payload.video_id === "string"
        ? String(payload.video_id)
        : "";
      if (!videoId) {
        return {
          state: "terminal",
          terminalCode: "google_yt_video_id_missing",
        };
      }
      return {
        state: "ready",
        preview: null,
        mergeExtra: { youtube_video_id: videoId },
      };
    }
    if (state === "FAILED" || state === "REJECTED" || state === "UNAVAILABLE") {
      return { state: "terminal", terminalCode: "google_yt_processing_failed" };
    }
    return { state: "processing", retryAfterSeconds: 10 };
  },
};

export const PREPARE_PROVIDER_ADAPTERS: Record<
  PreparationPlatform,
  PrepareProviderAdapter
> = {
  meta: metaPrepareAdapter,
  snapchat: snapPrepareAdapter,
  tiktok: tiktokPrepareAdapter,
  google: googlePrepareAdapter,
};

export function capabilityFor(platform: PreparationPlatform):
  | "create_and_real_preview"
  | "create_and_approx_preview" {
  if (platform === "meta") return "create_and_real_preview";
  if (platform === "snapchat") return "create_and_approx_preview";
  // ISSUE-997 D1: Google video PREPARATION is wired here; create is a SEPARATE
  // gate (still fail-closed until D2). Approximation-only preview forever — Google
  // exposes no video-ad preview API (flags.js VIDEO_API_AD_PREVIEWS_ENABLED.google
  // stays false). Like TikTok's note below, this label gates nothing (create is
  // gated by the admin VIDEO_CREATE_ENABLED/VIDEO_CREATE_PLATFORMS lists + the
  // create-branch READY-ref resolve), but the accurate label is set for google now.
  if (platform === "google") return "create_and_approx_preview";
  // TikTok supports both paused video create and a provider-rendered preview.
  // This label is descriptive rather than an authorization gate, but it still
  // has to tell operators the same truth as the create path.
  return "create_and_real_preview";
}

export function toPreparationState(
  status: PrepareBeginRow["current_status"],
): PreparationState {
  return status === "pending" ? "not_started" : status;
}

export function isPreparationPlatform(
  value: unknown,
): value is PreparationPlatform {
  return value === "meta" || value === "snapchat" || value === "tiktok" ||
    value === "google";
}

export function assertConsumerVideoPlatform(
  platform: Platform,
  lane: unknown,
): asserts platform is PreparationPlatform {
  if (!isPreparationPlatform(platform) || lane !== "consumer") {
    throw new CreativeTrustError(
      "platform_or_lane_invalid",
      422,
      "Only consumer Meta, Snapchat, TikTok, and Google video preparation is available.",
    );
  }
}
