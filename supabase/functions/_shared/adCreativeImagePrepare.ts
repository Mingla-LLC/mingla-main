/**
 * Issue #3697 — provider-native IMAGE preparation for a frozen, launch-confirmed
 * plan (admin-ad-creative-prepare).
 *
 * Snapchat ads reference a Snap media id, never a URL, so an image creative
 * must be uploaded to the plan's Snap ad account before the paused create can
 * find a READY ad_creative_platform_refs row. Meta and Reddit consume the
 * hosted image_url at create time and TikTok has its own create-time path, so
 * they have no image preparation: only platforms listed here are accepted.
 *
 * This is NOT a parallel upload rail. It drives the #866 resolver
 * (resolveCreativeRef: cache-first, content-hash keyed, atomic lock row,
 * fail-close typed errors, scrubbed failure text) with the existing provider
 * adapter (snapchatCreativeAdapter: token mint, multipart upload, READY poll).
 * What it adds is the frozen-plan binding: the caller has already proven the
 * exact plan, its allocated connection and the creative's ownership, so the
 * resolver is handed that exact connection instead of a lane lookup.
 */
import type { AdConnectionRow, Lane, Platform } from "./adChannel.ts";
import {
  type AdCreativeRow,
  CREATIVE_UPLOAD_ADAPTERS,
  CreativeByteSourceError,
  CreativeConnectionError,
  type CreativeRefDb,
  CreativeRefLockedError,
  type CreativeRefRow,
  type CreativeUploadAdapter,
  type CreativeUploadDeps,
  CreativeValidationError,
  fetchCreativeBytes,
  resolveCreativeRef,
  scrubCreativeSecrets,
  STALE_LOCK_TAKEOVER_MS,
} from "./adCreative.ts";
import { sha256Hex } from "./adCreativeProbe.ts";

/** Platforms whose create path needs a provider-native uploaded image. */
export const IMAGE_PREPARATION_PLATFORMS = Object.freeze(["snapchat"] as const);
export type ImagePreparationPlatform =
  typeof IMAGE_PREPARATION_PLATFORMS[number];

export function isImagePreparationPlatform(
  value: unknown,
): value is ImagePreparationPlatform {
  return (IMAGE_PREPARATION_PLATFORMS as readonly unknown[]).includes(value);
}

const SNAP_TOP_SNAP_RATIO = 0.5625;

/**
 * The bytes to send. The matrix accepts a non-9:16 master only when a
 * pre-cropped 9:16 variant exists ("the variant slot will be used instead"),
 * so that variant is what Snap receives. The ref stays keyed on the master's
 * content_hash, which is what create looks it up by.
 */
export function imagePreparationSource(
  creative: AdCreativeRow,
): {
  url: string;
  contentHash: string;
  facts: Pick<AdCreativeRow, "width" | "height" | "aspect_ratio" | "byte_size">;
} | null {
  const ratio = creative.aspect_ratio;
  const variant = creative.variants?.["9:16"];
  if (
    ratio !== null && Math.abs(ratio - SNAP_TOP_SNAP_RATIO) > 0.01 &&
    variant && typeof variant.source_url === "string" &&
    typeof variant.content_hash === "string"
  ) {
    return {
      url: variant.source_url,
      contentHash: variant.content_hash,
      // The matrix then judges the bytes actually sent.
      facts: {
        width: variant.width,
        height: variant.height,
        aspect_ratio: variant.height > 0 ? variant.width / variant.height : null,
        byte_size: variant.byte_size ?? creative.byte_size,
      },
    };
  }
  if (!creative.source_url) return null;
  return {
    url: creative.source_url,
    contentHash: creative.content_hash,
    facts: {
      width: creative.width,
      height: creative.height,
      aspect_ratio: creative.aspect_ratio,
      byte_size: creative.byte_size,
    },
  };
}

export type ImagePrepareOutcome =
  | { kind: "ready"; ref: CreativeRefRow; cached: boolean }
  | { kind: "not_started"; ref: CreativeRefRow | null }
  | { kind: "in_progress"; ref: CreativeRefRow; stale: boolean }
  | {
    kind: "failed";
    ref: CreativeRefRow | null;
    code: string;
    httpStatus: number;
    retryable: boolean;
    cached: boolean;
    message: string;
  };

export interface ImagePrepareInput {
  action: "start" | "status" | "retry";
  creative: AdCreativeRow;
  /** The plan's allocated, already-verified connection. */
  connection: AdConnectionRow;
  platform: Platform;
  lane: Lane;
}

export interface ImagePrepareDeps extends CreativeUploadDeps {
  adapters?: Record<Platform, CreativeUploadAdapter>;
  now?: () => number;
  log?: (message: string) => void;
}

function readyMatches(
  ref: CreativeRefRow | null,
  creative: AdCreativeRow,
): boolean {
  return !!ref && ref.status === "ready" && !!ref.external_ref &&
    ref.external_kind === "image" &&
    ref.content_hash === creative.content_hash;
}

function lockIsStale(ref: CreativeRefRow, nowMs: number): boolean {
  if (!ref.updated_at) return false;
  const parsed = Date.parse(ref.updated_at);
  return Number.isFinite(parsed) && parsed < nowMs - STALE_LOCK_TAKEOVER_MS;
}

function failed(
  ref: CreativeRefRow | null,
  code: string,
  httpStatus: number,
  retryable: boolean,
  message: string,
  cached = false,
): ImagePrepareOutcome {
  return { kind: "failed", ref, code, httpStatus, retryable, cached, message };
}

export async function prepareCreativeImageRef(
  db: CreativeRefDb,
  input: ImagePrepareInput,
  deps: ImagePrepareDeps = {},
): Promise<ImagePrepareOutcome> {
  const { action, creative, connection, platform, lane } = input;
  const now = deps.now ?? Date.now;
  if (!isImagePreparationPlatform(platform)) {
    return failed(
      null,
      "image_preparation_not_supported",
      422,
      false,
      `${platform} uses the hosted image at create time; there is nothing to prepare.`,
    );
  }
  if (creative.kind !== "image") {
    return failed(
      null,
      "creative_kind_or_status_invalid",
      422,
      false,
      "Only an image creative can be prepared on this path.",
    );
  }
  const accountId = connection.external_account_id;
  const readRef = () => db.getRef(creative.id, platform, lane, accountId);

  const existing = await readRef();
  if (existing && readyMatches(existing, creative)) {
    return { kind: "ready", ref: existing, cached: true };
  }
  const activeLock = existing !== null &&
    (existing.status === "uploading" || existing.status === "processing");
  if (action === "status") {
    if (!existing || existing.status === "pending" || existing.status === "ready") {
      // A READY ref with other bytes is stale (A1-1): a start re-uploads it.
      return { kind: "not_started", ref: existing };
    }
    if (existing && activeLock) {
      return { kind: "in_progress", ref: existing, stale: lockIsStale(existing, now()) };
    }
    return failed(
      existing,
      "provider_image_upload_failed",
      200,
      true,
      "The platform could not accept this image. Retry this platform.",
      true,
    );
  }
  if (existing && activeLock && !lockIsStale(existing, now())) {
    return { kind: "in_progress", ref: existing, stale: false };
  }

  const source = imagePreparationSource(creative);
  if (!source) {
    return failed(
      existing,
      "creative_source_unavailable",
      422,
      false,
      "This image has no stored source to upload.",
    );
  }
  // Same identity rule as the video path: the bytes sent must be the bytes
  // that were validated and recorded, or nothing is uploaded.
  let bytes: Uint8Array;
  try {
    bytes = await fetchCreativeBytes(source.url, deps);
  } catch (error) {
    deps.log?.(
      `[admin-ad-creative-prepare] image source fetch failed: ${
        scrubCreativeSecrets(error instanceof Error ? error.message : String(error))
      }`,
    );
    return failed(
      existing,
      "creative_source_unavailable",
      502,
      true,
      "The stored image could not be read. Try again shortly.",
    );
  }
  if (await sha256Hex(bytes) !== source.contentHash) {
    return failed(
      existing,
      "creative_identity_changed",
      409,
      false,
      "The image bytes changed after validation. Record a new creative before preparing it.",
    );
  }
  const baseFetch = deps.fetchImpl ?? fetch;
  const fetchImpl = ((request: URL | Request | string, init?: RequestInit) =>
    String(request) === source.url
      ? Promise.resolve(new Response(bytes as unknown as BodyInit, { status: 200 }))
      : baseFetch(request, init)) as typeof fetch;

  // The resolver gets the plan's exact connection and the already-gated
  // creative. Prepare has already applied its own status rule (#3697 C-13: a
  // frozen plan keeps an archived creative usable; purged is refused), so the
  // resolver's new-selection archive rule does not apply here.
  const boundDb: CreativeRefDb = {
    ...db,
    getConnection: () => Promise.resolve(connection),
    getCreative: () =>
      Promise.resolve({
        ...creative,
        ...source.facts,
        status: "active",
        source_url: source.url,
      }),
  };
  try {
    await resolveCreativeRef(boundDb, creative.id, platform, lane, {
      fetchImpl,
      sleep: deps.sleep,
      adapters: deps.adapters ?? CREATIVE_UPLOAD_ADAPTERS,
    });
  } catch (error) {
    const after = await readRef();
    if (error instanceof CreativeRefLockedError && after) {
      return { kind: "in_progress", ref: after, stale: false };
    }
    deps.log?.(
      `[admin-ad-creative-prepare] image upload failed: ${
        scrubCreativeSecrets(error instanceof Error ? error.message : String(error))
      }`,
    );
    if (error instanceof CreativeValidationError) {
      return failed(after, "creative_does_not_fit", 422, false, scrubCreativeSecrets(error.message));
    }
    if (error instanceof CreativeConnectionError) {
      return failed(
        after,
        "provider_connection_failed",
        424,
        true,
        "The platform connection could not be used. Check the connection, then retry.",
      );
    }
    if (error instanceof CreativeByteSourceError) {
      return failed(
        after,
        "creative_source_unavailable",
        502,
        true,
        "The stored image could not be read. Try again shortly.",
      );
    }
    return failed(
      after,
      "provider_image_upload_failed",
      502,
      true,
      "The platform could not accept this image. Retry this platform.",
    );
  }
  const ready = await readRef();
  if (!ready || !readyMatches(ready, creative)) {
    return failed(
      ready,
      "provider_image_upload_failed",
      502,
      true,
      "The platform upload finished but no ready copy was recorded. Retry this platform.",
    );
  }
  return { kind: "ready", ref: ready, cached: false };
}

// The prepare endpoint builds its ref store from the same Supabase-backed
// CreativeRefDb the #866 resolver ships with (atomic lock row, scrubbed
// failure text), re-exported so the endpoint needs one import for this path.
export { createSupabaseCreativeRefDb } from "./adCreative.ts";
