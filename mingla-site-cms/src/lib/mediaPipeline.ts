import sharp, { type Metadata } from "sharp";
import type { PayloadRequest } from "payload";
import type { UploadGrantStage } from "./uploadGrantObservability";
import { cmsConfig } from "./config";
import { sha256 } from "./crypto";
import {
  deleteObject,
  presignedQuarantinePut,
  readObject,
  writeObject,
} from "./objectStore";
import { emitCmsObservation } from "./observability";
import { studioMediaGrantRequest } from "./studioRequestAuth";

const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);
const WIDTHS = [320, 640, 960, 1440, 1920] as const;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StoredMediaObject = {
  approvedKey: string;
  recoveryKey: string;
  digest: string;
  bytes: number;
};

type MediaStorageRecord = {
  approved_master_key?: unknown;
  rendition_manifest?: unknown;
};

function storageDescriptor(
  value: unknown,
  expectedKey: string,
): { key: string; digest: string; bytes: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("VALIDATION_FAILED");
  }
  const descriptor = value as Record<string, unknown>;
  if (
    descriptor.key !== expectedKey ||
    typeof descriptor.digest !== "string" ||
    !/^[0-9a-f]{64}$/.test(descriptor.digest) ||
    typeof descriptor.bytes !== "number" ||
    !Number.isInteger(descriptor.bytes) ||
    descriptor.bytes < 1
  ) throw new Error("VALIDATION_FAILED");
  return {
    key: descriptor.key,
    digest: descriptor.digest,
    bytes: descriptor.bytes,
  };
}

export function mediaStorageObjects(
  media: MediaStorageRecord,
  tenantId: string,
  siteId: string,
  mediaId: string,
): StoredMediaObject[] {
  if (![tenantId, siteId, mediaId].every((id) => UUID.test(id))) {
    throw new Error("VALIDATION_FAILED");
  }
  if (
    !media.rendition_manifest ||
    typeof media.rendition_manifest !== "object" ||
    Array.isArray(media.rendition_manifest)
  ) throw new Error("VALIDATION_FAILED");
  const manifest = media.rendition_manifest as Record<string, unknown>;
  const masterValue =
    manifest.master &&
    typeof manifest.master === "object" &&
    !Array.isArray(manifest.master)
      ? manifest.master as Record<string, unknown>
      : null;
  const masterKey = masterValue?.key;
  const masterMatch =
    typeof masterKey === "string"
      ? masterKey.match(
        new RegExp(
          `^approved/${siteId}/${mediaId}/([0-9a-f]{64})/master\\.webp$`,
          "i",
        ),
      )
      : null;
  if (
    manifest.version !== 1 ||
    media.approved_master_key !== masterKey ||
    !masterMatch ||
    !Array.isArray(manifest.renditions) ||
    manifest.renditions.length !== WIDTHS.length
  ) throw new Error("VALIDATION_FAILED");
  const approvedPrefix =
    `approved/${siteId}/${mediaId}/${masterMatch[1].toLowerCase()}`;
  const master = storageDescriptor(
    manifest.master,
    `${approvedPrefix}/master.webp`,
  );
  const renditions = new Map<number, { key: string; digest: string; bytes: number }>();
  for (const value of manifest.renditions) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("VALIDATION_FAILED");
    }
    const row = value as Record<string, unknown>;
    const targetWidth = row.target_width;
    if (
      typeof targetWidth !== "number" ||
      !WIDTHS.includes(targetWidth as (typeof WIDTHS)[number]) ||
      renditions.has(targetWidth)
    ) throw new Error("VALIDATION_FAILED");
    renditions.set(
      targetWidth,
      storageDescriptor(row, `${approvedPrefix}/${targetWidth}.webp`),
    );
  }
  const descriptors = [
    master,
    ...WIDTHS.map((width) => {
      const rendition = renditions.get(width);
      if (!rendition) throw new Error("VALIDATION_FAILED");
      return rendition;
    }),
  ];
  return descriptors.map((descriptor) => ({
    approvedKey: descriptor.key,
    recoveryKey:
      `recovery/${tenantId}/${descriptor.key.slice("approved/".length)}`,
    digest: descriptor.digest,
    bytes: descriptor.bytes,
  }));
}

async function verifiedObject(
  bucket: string,
  key: string,
  digest: string,
  bytes: number,
): Promise<Uint8Array> {
  const value = await readObject(bucket, key);
  if (value.byteLength !== bytes || await sha256(value) !== digest) {
    throw new Error("STORAGE_UNAVAILABLE");
  }
  return value;
}

function detectedMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes
      .slice(0, 8)
      .every(
        (value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index],
      )
  )
    return "image/png";
  if (
    Buffer.from(bytes.slice(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.slice(8, 12)).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return null;
}

function hasExactContainerBoundary(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/jpeg") {
    return (
      bytes.length >= 2 &&
      bytes[bytes.length - 2] === 0xff &&
      bytes[bytes.length - 1] === 0xd9
    );
  }
  if (mime === "image/png") {
    return (
      Buffer.from(bytes.slice(-12)).toString("hex") ===
      "0000000049454e44ae426082"
    );
  }
  if (mime === "image/webp") {
    return (
      bytes.length >= 12 &&
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
        4,
        true,
      ) +
        8 ===
        bytes.length
    );
  }
  return false;
}

export async function createUploadGrant(
  req: PayloadRequest,
  input: { filename: string; content_type: string; bytes: number },
  onStage?: (stage: UploadGrantStage) => void,
) {
  const user = req.user as unknown as {
    tenantId?: string;
    siteId?: string;
    userId?: string;
    id?: string;
  };
  if (
    !user?.tenantId ||
    !user.siteId ||
    !ACCEPTED.has(input.content_type) ||
    !Number.isInteger(input.bytes) ||
    input.bytes < 1 ||
    input.bytes > MAX_BYTES
  )
    throw new Error("MEDIA_REJECTED");
  const declaredMime = input.content_type as
    "image/jpeg" | "image/png" | "image/webp";
  const previousGrantContext = req.context.minglaMediaGrant;
  const previousStageObserver = req.context.minglaUploadGrantStage;
  req.context.minglaMediaGrant = true;
  req.context.minglaUploadGrantStage = onStage;
  try {
    onStage?.("grant_media_create");
    const media = await req.payload.create({
      collection: "media",
      overrideAccess: false,
      req,
      data: {
        tenant: user.tenantId,
        state: "UPLOADING",
        original_filename_safe: input.filename
          .replace(/[^A-Za-z0-9._ -]/g, "_")
          .slice(0, 160),
        declared_mime: declaredMime,
        bytes: input.bytes,
        created_by: user.id,
        quarantine_delete_by: new Date(
          Date.now() + 72 * 60 * 60_000,
        ).toISOString(),
      },
    });
    const key = `quarantine/${user.siteId}/${media.id}/${crypto.randomUUID()}`;
    onStage?.("grant_media_update");
    await req.payload.update({
      collection: "media",
      id: media.id,
      overrideAccess: false,
      req,
      data: { quarantine_key: key },
    });
    onStage?.("grant_presign");
    const grant = await presignedQuarantinePut(
      cmsConfig().quarantineBucket,
      key,
      input.content_type,
      300,
    );
    return {
      media_id: media.id,
      expires_in_seconds: 300,
      upload_url: grant.url,
      required_headers: grant.headers,
      maximum_bytes: MAX_BYTES,
    };
  } finally {
    req.context.minglaMediaGrant = previousGrantContext;
    req.context.minglaUploadGrantStage = previousStageObserver;
  }
}

async function reject(
  req: PayloadRequest,
  mediaId: string | number,
  key: string,
  code:
    | "TYPE_NOT_ALLOWED"
    | "TOO_LARGE"
    | "DIMENSIONS_TOO_LARGE"
    | "MIME_MISMATCH"
    | "DECODE_FAILED"
    | "CHECKSUM_MISMATCH"
    | "METADATA_RETAINED"
    | "PROCESSING_FAILED",
) {
  let quarantineRemoved = false;
  try {
    await deleteObject(cmsConfig().quarantineBucket, key);
    quarantineRemoved = true;
  } catch {
    const studioUser = req.user as unknown as { siteId?: string };
    emitCmsObservation({
      event: "mingla_sites_state",
      metric: "media.quarantine_cleanup.failure",
      request_id: crypto.randomUUID(),
      operation_id: null,
      site_id: /^[0-9a-f-]{36}$/i.test(String(studioUser?.siteId || ""))
        ? String(studioUser.siteId)
        : null,
      publication_id: null,
      direction: "studio_to_cms",
      route: "/media/quarantine-cleanup",
      state_transition: "rejected->cleanup_retry_scheduled",
      latency_ms: 0,
      retry_count: 0,
      safe_error_code: "STORAGE_UNAVAILABLE",
      status_code: null,
      version: "sites-v1",
    });
  }
  await req.payload.update({
    collection: "media",
    id: mediaId,
    overrideAccess: false,
    req,
    data: {
      state: "REJECTED",
      rejection_code: code,
      quarantine_key: quarantineRemoved ? null : key,
      quarantine_delete_by: quarantineRemoved
        ? null
        : new Date(Date.now() + 60 * 60_000).toISOString(),
    },
  });
  throw new Error("MEDIA_REJECTED");
}

async function processUpload(
  req: PayloadRequest,
  mediaId: string,
  checksum: string,
  observedBytes: number,
) {
  const media = await req.payload.findByID({
    collection: "media",
    id: mediaId,
    overrideAccess: false,
    req,
    depth: 0,
  });
  const key = String(media.quarantine_key || "");
  if (media.state !== "UPLOADING" || !key || !/^[0-9a-f]{64}$/.test(checksum))
    throw new Error("INVALID_STATE");
  const source = await readObject(cmsConfig().quarantineBucket, key);
  if (
    source.byteLength !== observedBytes ||
    source.byteLength !== media.bytes ||
    source.byteLength > MAX_BYTES
  )
    return reject(req, media.id, key, "TOO_LARGE");
  if ((await sha256(source)) !== checksum)
    return reject(req, media.id, key, "CHECKSUM_MISMATCH");
  const mime = detectedMime(source);
  if (
    !mime ||
    mime !== media.declared_mime ||
    !hasExactContainerBoundary(source, mime)
  )
    return reject(req, media.id, key, "MIME_MISMATCH");
  let metadata: Metadata;
  try {
    metadata = await sharp(source, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    return reject(req, media.id, key, "DECODE_FAILED");
  }
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width * metadata.height > MAX_PIXELS ||
    (metadata.pages && metadata.pages > 1)
  )
    return reject(req, media.id, key, "DIMENSIONS_TOO_LARGE");
  await req.payload.update({
    collection: "media",
    id: media.id,
    overrideAccess: false,
    req,
    data: {
      state: "PROCESSING",
      detected_mime: mime,
      width: metadata.width,
      height: metadata.height,
      checksum,
    },
  });
  const base = `approved/${(req.user as unknown as { siteId: string }).siteId}/${media.id}/${checksum}`;
  const master = await sharp(source, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .webp({ quality: 80 })
    .toBuffer();
  const sanitizedMetadata = await sharp(master).metadata();
  if (
    sanitizedMetadata.exif ||
    sanitizedMetadata.icc ||
    sanitizedMetadata.iptc ||
    sanitizedMetadata.xmp ||
    (sanitizedMetadata.pages && sanitizedMetadata.pages > 1)
  )
    return reject(req, media.id, key, "METADATA_RETAINED");
  const masterKey = `${base}/master.webp`;
  const masterDigest = await sha256(master);
  const renditions = [];
  const outputs: Array<{ key: string; bytes: Uint8Array; digest: string }> = [
    { key: masterKey, bytes: master, digest: masterDigest },
  ];
  for (const width of WIDTHS) {
    const output = await sharp(source, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize({
        width: Math.min(width, metadata.width),
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer();
    const renditionKey = `${base}/${width}.webp`;
    const digest = await sha256(output);
    outputs.push({ key: renditionKey, bytes: output, digest });
    renditions.push({
      target_width: width,
      width: Math.min(width, metadata.width),
      key: renditionKey,
      digest,
      bytes: output.byteLength,
    });
  }
  const renditionManifest = {
    version: 1,
    master: {
      key: masterKey,
      digest: masterDigest,
      bytes: master.byteLength,
    },
    renditions,
  };

  // Persist every deterministic approved key before the first write. If a
  // later write/readback fails, the retryable row remains a durable cleanup
  // manifest instead of leaving an unreferenced object in private storage.
  await req.payload.update({
    collection: "media",
    id: media.id,
    overrideAccess: false,
    req,
    data: {
      approved_master_key: masterKey,
      rendition_manifest: renditionManifest,
    },
  });
  try {
    for (const output of outputs) {
      await writeObject(
        cmsConfig().approvedBucket,
        output.key,
        output.bytes,
        "image/webp",
      );
      const stored = await readObject(cmsConfig().approvedBucket, output.key);
      if (
        stored.byteLength !== output.bytes.byteLength ||
        await sha256(stored) !== output.digest
      ) throw new Error("STORAGE_UNAVAILABLE");
    }
    const ready = await req.payload.update({
      collection: "media",
      id: media.id,
      overrideAccess: false,
      req,
      data: {
        state: "READY",
        approved_master_key: masterKey,
        quarantine_delete_by: new Date(Date.now() + 60 * 60_000).toISOString(),
        recovery_until: new Date(
          Date.now() + 30 * 24 * 60 * 60_000,
        ).toISOString(),
        rendition_manifest: renditionManifest,
      },
    });
    try {
      await deleteObject(cmsConfig().quarantineBucket, key);
      return await req.payload.update({
        collection: "media",
        id: media.id,
        overrideAccess: false,
        req,
        data: { quarantine_key: null, quarantine_delete_by: null },
      });
    } catch {
      // READY is already durable and the quarantine source has a one-hour
      // cleanup deadline consumed by runRetentionSweep.
      return ready;
    }
  } catch (error) {
    let allApprovedOutputsRemoved = true;
    for (const output of outputs) {
      try {
        await deleteObject(cmsConfig().approvedBucket, output.key);
      } catch {
        allApprovedOutputsRemoved = false;
      }
    }
    if (allApprovedOutputsRemoved) {
      await req.payload.update({
        collection: "media",
        id: media.id,
        overrideAccess: false,
        req,
        data: { approved_master_key: null, rendition_manifest: null },
      });
    }
    throw error;
  }
}

export async function completeUpload(
  req: PayloadRequest,
  mediaId: string,
  checksum: string,
  observedBytes: number,
) {
  const previousGrantContext = req.context.minglaMediaGrant;
  req.context.minglaMediaGrant = true;
  try {
    return await processUpload(req, mediaId, checksum, observedBytes);
  } catch (error) {
    if (
      error instanceof Error &&
      !["MEDIA_REJECTED", "INVALID_STATE"].includes(error.message)
    ) {
      try {
        await req.payload.update({
          collection: "media",
          id: mediaId,
          overrideAccess: false,
          req,
          data: {
            state: "RETRYABLE_FAILED",
            rejection_code: "PROCESSING_FAILED",
          },
        });
      } catch {
        const studioUser = req.user as unknown as { siteId?: string };
        emitCmsObservation({
          event: "mingla_sites_state",
          metric: "media.state_persist.failure",
          request_id: crypto.randomUUID(),
          operation_id: null,
          site_id: /^[0-9a-f-]{36}$/i.test(String(studioUser?.siteId || ""))
            ? String(studioUser.siteId)
            : null,
          publication_id: null,
          direction: "studio_to_cms",
          route: "/media/processing",
          state_transition: "processing_failed->state_persist_failed",
          latency_ms: 0,
          retry_count: 0,
          safe_error_code: "SERVICE_TEMPORARILY_UNAVAILABLE",
          status_code: null,
          version: "sites-v1",
        });
      }
    }
    throw error;
  } finally {
    req.context.minglaMediaGrant = previousGrantContext;
  }
}

function relationshipId(value: unknown): string {
  return value && typeof value === "object"
    ? String((value as { id?: unknown }).id || "")
    : String(value || "");
}

export async function tombstoneMedia(req: PayloadRequest, mediaId: string) {
  const actor = req.user as {
    tenantId?: string;
    siteId?: string;
  } | null;
  const media = await req.payload.findByID({
    collection: "media",
    id: mediaId,
    overrideAccess: false,
    req: studioMediaGrantRequest(req),
    depth: 0,
  });
  const tenantId = relationshipId(media.tenant);
  if (
    !actor?.tenantId ||
    !actor.siteId ||
    tenantId !== actor.tenantId
  ) throw new Error("FORBIDDEN");
  if (media.state !== "READY") throw new Error("INVALID_STATE");
  const pages = await req.payload.find({
    collection: "pages",
    overrideAccess: false,
    req,
    draft: true,
    depth: 0,
    limit: 5,
    where: { tenant: { equals: tenantId } },
  });
  for (const page of pages.docs) {
    const blocks = Array.isArray(page.blocks) ? page.blocks : [];
    for (const block of blocks as Array<Record<string, unknown>>) {
      if (relationshipId(block.media) === mediaId) {
        throw new Error("INVALID_STATE");
      }
      if (
        Array.isArray(block.images) &&
        block.images.some(
          (row) =>
            relationshipId((row as Record<string, unknown>).media) === mediaId,
        )
      ) {
        throw new Error("INVALID_STATE");
      }
    }
  }
  const settings = await req.payload.find({
    collection: "site-settings",
    overrideAccess: false,
    req,
    draft: true,
    depth: 0,
    limit: 1,
    where: { tenant: { equals: tenantId } },
  });
  const setting = settings.docs[0];
  if (
    setting &&
    [setting.logo, setting.social_image].some(
      (value) => relationshipId(value) === mediaId,
    )
  ) {
    throw new Error("INVALID_STATE");
  }
  const objects = mediaStorageObjects(
    media,
    tenantId,
    actor.siteId,
    String(media.id),
  );
  for (const object of objects) {
    const bytes = await verifiedObject(
      cmsConfig().approvedBucket,
      object.approvedKey,
      object.digest,
      object.bytes,
    );
    await writeObject(
      cmsConfig().recoveryBucket,
      object.recoveryKey,
      bytes,
      "image/webp",
    );
    await verifiedObject(
      cmsConfig().recoveryBucket,
      object.recoveryKey,
      object.digest,
      object.bytes,
    );
  }
  return req.payload.update({
    collection: "media",
    id: mediaId,
    overrideAccess: false,
    req: studioMediaGrantRequest(req),
    depth: 0,
    data: {
      state: "TOMBSTONED",
      tombstoned_at: new Date().toISOString(),
      recovery_until: new Date(
        Date.now() + 30 * 24 * 60 * 60_000,
      ).toISOString(),
    },
  });
}

export async function restoreTombstonedMedia(
  req: PayloadRequest,
  mediaId: string,
) {
  const actor = req.user as {
    tenantId?: string;
    siteId?: string;
  } | null;
  const media = await req.payload.findByID({
    collection: "media",
    id: mediaId,
    overrideAccess: false,
    req: studioMediaGrantRequest(req),
    depth: 0,
  });
  const tenantId = relationshipId(media.tenant);
  const recoveryUntil = typeof media.recovery_until === "string"
    ? Date.parse(media.recovery_until)
    : Number.NaN;
  if (
    !actor?.tenantId ||
    !actor.siteId ||
    tenantId !== actor.tenantId
  ) throw new Error("FORBIDDEN");
  if (
    media.state !== "TOMBSTONED" ||
    !Number.isFinite(recoveryUntil) ||
    recoveryUntil <= Date.now()
  ) throw new Error("INVALID_STATE");
  const objects = mediaStorageObjects(
    media,
    tenantId,
    actor.siteId,
    String(media.id),
  );
  for (const object of objects) {
    const recoveryBytes = await verifiedObject(
      cmsConfig().recoveryBucket,
      object.recoveryKey,
      object.digest,
      object.bytes,
    );
    await writeObject(
      cmsConfig().approvedBucket,
      object.approvedKey,
      recoveryBytes,
      "image/webp",
    );
    await verifiedObject(
      cmsConfig().approvedBucket,
      object.approvedKey,
      object.digest,
      object.bytes,
    );
  }
  return req.payload.update({
    collection: "media",
    id: mediaId,
    overrideAccess: false,
    req: studioMediaGrantRequest(req),
    depth: 0,
    data: {
      state: "READY",
      tombstoned_at: null,
    },
  });
}

export function mediaMayBePurged(input: {
  state: string;
  recoveryUntil: string | null;
  referencedByProtectedPublication: boolean;
  nowMs?: number;
}): boolean {
  return (
    input.state === "TOMBSTONED" &&
    !input.referencedByProtectedPublication &&
    typeof input.recoveryUntil === "string" &&
    Date.parse(input.recoveryUntil) <= (input.nowMs ?? Date.now())
  );
}

export function artifactMayBePurged(input: {
  protectedByCore: boolean;
  completedAt: string;
  newestRank: number;
  nowMs?: number;
}): boolean {
  const ageMs = (input.nowMs ?? Date.now()) - Date.parse(input.completedAt);
  return (
    !input.protectedByCore &&
    input.newestRank > 50 &&
    ageMs >= 90 * 24 * 60 * 60_000
  );
}

export async function runRetentionSweep(
  req: PayloadRequest,
  siteId: string,
  tenantId: string,
  protectedArtifactKeys: string[],
) {
  const protectedMediaIds = new Set<string>();
  for (const key of protectedArtifactKeys) {
    if (
      !new RegExp(
        `^publications/${siteId}/[0-9a-f-]{36}/[0-9a-f]{64}\\.json$`,
        "i",
      ).test(key)
    ) {
      throw new Error("VALIDATION_FAILED");
    }
    const artifact = JSON.parse(
      new TextDecoder().decode(
        await readObject(cmsConfig().artifactBucket, key),
      ),
    ) as { media?: Array<{ id?: unknown }> };
    for (const item of artifact.media || []) {
      if (typeof item.id === "string") protectedMediaIds.add(item.id);
    }
  }
  const media = await req.payload.find({
    collection: "media",
    overrideAccess: true,
    depth: 0,
    limit: 5000,
    sort: "createdAt",
    where: { tenant: { equals: tenantId } },
  });
  let purgedMedia = 0;
  for (const item of media.docs) {
    if (
      item.quarantine_key &&
      item.quarantine_delete_by &&
      Date.parse(item.quarantine_delete_by) <= Date.now()
    ) {
      await deleteObject(cmsConfig().quarantineBucket, item.quarantine_key);
      await req.payload.update({
        collection: "media",
        id: item.id,
        overrideAccess: true,
        data: { quarantine_key: null, quarantine_delete_by: null },
      });
    }
    if (
      item.state === "RETRYABLE_FAILED" &&
      item.approved_master_key &&
      item.rendition_manifest
    ) {
      const failedOutputs = mediaStorageObjects(
        item,
        tenantId,
        siteId,
        String(item.id),
      );
      for (const object of failedOutputs) {
        await deleteObject(cmsConfig().approvedBucket, object.approvedKey);
      }
      await req.payload.update({
        collection: "media",
        id: item.id,
        overrideAccess: true,
        data: { approved_master_key: null, rendition_manifest: null },
      });
    }
    if (
      !mediaMayBePurged({
        state: item.state,
        recoveryUntil: item.recovery_until || null,
        referencedByProtectedPublication: protectedMediaIds.has(
          String(item.id),
        ),
      })
    )
      continue;
    const objects = mediaStorageObjects(
      item,
      tenantId,
      siteId,
      String(item.id),
    );
    for (const object of objects) {
      await deleteObject(cmsConfig().approvedBucket, object.approvedKey);
      await deleteObject(cmsConfig().recoveryBucket, object.recoveryKey);
    }
    await req.payload.update({
      collection: "media",
      id: item.id,
      overrideAccess: true,
      data: {
        approved_master_key: null,
        rendition_manifest: null,
        recovery_until: null,
      },
    });
    purgedMedia += 1;
  }
  const jobs = await req.payload.find({
    collection: "publication-jobs",
    overrideAccess: true,
    depth: 0,
    limit: 5000,
    sort: "-updatedAt",
    where: {
      and: [
        { status: { equals: "published" } },
        { tenant: { equals: tenantId } },
      ],
    },
  });
  const protectedSet = new Set(protectedArtifactKeys);
  let purgedArtifacts = 0;
  for (const [index, job] of jobs.docs.entries()) {
    if (
      typeof job.artifact_key !== "string" ||
      !artifactMayBePurged({
        protectedByCore: protectedSet.has(job.artifact_key),
        completedAt: job.updatedAt,
        newestRank: index + 1,
      })
    )
      continue;
    await deleteObject(cmsConfig().artifactBucket, job.artifact_key);
    purgedArtifacts += 1;
  }
  return {
    protected_artifacts: protectedSet.size,
    protected_media: protectedMediaIds.size,
    purged_media: purgedMedia,
    purged_artifacts: purgedArtifacts,
  };
}
