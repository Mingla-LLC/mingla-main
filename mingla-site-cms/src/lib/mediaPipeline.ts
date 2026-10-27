import sharp, { type Metadata } from "sharp";
import type { PayloadRequest } from "payload";
import { cmsConfig } from "./config";
import { sha256 } from "./crypto";
import {
  deleteObject,
  presignedQuarantinePut,
  readObject,
  writeObject,
  listObjects,
} from "./objectStore";
import { emitCmsObservation } from "./observability";
import { sweepOfferingRenditions } from "./offeringCoverRenditions";
import { readCoreRetentionProjection } from "./gateway";
import { studioMediaGrantRequest } from "./studioRequestAuth";
import { tenantMediaInUse } from "./mediaHolders";
import { chunkDigests, FILE_VIDEO_BRANDS, inspectMp4 } from "./mp4Inspect";
import { MAX_FILE_VIDEO_BYTES, VIDEO_CHUNK_BYTES } from "../contracts/generated/video.ts";

/*
 * #2830 — video/mp4 belongs here.
 *
 * Everything downstream already accepted it: the declared_mime column lists it,
 * MP4_BRANDS sniffs it, the processing path writes it to the approved bucket,
 * and the line below this gate casts content_type to a union that INCLUDES it.
 * Only this set left it out, so every video upload was refused at the front
 * door with "that image could not be accepted" while the whole pipeline behind
 * it sat ready. A hero video could never have been uploaded through the product.
 */
const ACCEPTED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
]);
const WIDTHS = [320, 640, 960, 1440, 1920] as const;
/** #2829 W7b — named extra renditions (see the approval step). */
export const MEDIA_VARIANTS = [
  { name: "c400", width: 400, height: 300 },
  { name: "c768", width: 768, height: 576 },
  { name: "w1600", width: 1600, height: null },
] as const;
const VARIANT_NAMES: readonly string[] = MEDIA_VARIANTS.map((variant) => variant.name);
const MAX_BYTES = 20 * 1024 * 1024;
// #2829 W6 (AD-9) — a file video may be up to 50 MiB; pictures keep 20 MiB.
const MAX_VIDEO_BYTES = MAX_FILE_VIDEO_BYTES;
const maxBytesFor = (mime: string) => (mime === "video/mp4" ? MAX_VIDEO_BYTES : MAX_BYTES);

/**
 * #2830 — the `ftyp` brands a browser will actually play as `video/mp4`.
 *
 * Deliberately a short allowlist rather than "any ftyp": the box is shared by
 * the whole ISO base-media family, which includes containers no browser plays
 * and some it should not be handed at all. A hero video that silently fails to
 * start is indistinguishable from a broken website.
 */
// #2829 W6 — narrowed to the brands AD-9 names (isom/iso2/mp41/mp42/avc1).
const MP4_BRANDS = FILE_VIDEO_BRANDS;
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
  kind?: unknown;
};

/** The stored type of one approved object (a file video's master is MP4). */
function storedContentType(key: string): string {
  return key.endsWith(".mp4") ? "video/mp4" : "image/webp";
}

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
  // #2829 W11 (A11) — a stream video lives on the stream service, not in
  // Sites storage: there is nothing here to copy, restore or purge.
  if (media.kind === "stream_video") return [];
  // A file video is one MP4 served as stored (no renditions).
  if (media.kind === "file_video") return fileVideoStorageObjects(media, tenantId, siteId, mediaId);
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
  // #2829 W7b — extra renditions (optional; media approved earlier has none).
  const variantDescriptors: Array<{ key: string; digest: string; bytes: number }> = [];
  if (manifest.variants !== undefined) {
    if (!Array.isArray(manifest.variants)) throw new Error("VALIDATION_FAILED");
    const seen = new Set<string>();
    for (const value of manifest.variants) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("VALIDATION_FAILED");
      const name = (value as Record<string, unknown>).name;
      if (typeof name !== "string" || !VARIANT_NAMES.includes(name) || seen.has(name)) throw new Error("VALIDATION_FAILED");
      seen.add(name);
      variantDescriptors.push(storageDescriptor(value, `${approvedPrefix}/${name}.webp`));
    }
  }
  const descriptors = [
    master,
    ...WIDTHS.map((width) => {
      const rendition = renditions.get(width);
      if (!rendition) throw new Error("VALIDATION_FAILED");
      return rendition;
    }),
    ...variantDescriptors,
  ];
  return descriptors.map((descriptor) => ({
    approvedKey: descriptor.key,
    recoveryKey:
      `recovery/${tenantId}/${descriptor.key.slice("approved/".length)}`,
    digest: descriptor.digest,
    bytes: descriptor.bytes,
  }));
}

function fileVideoStorageObjects(
  media: MediaStorageRecord,
  tenantId: string,
  siteId: string,
  mediaId: string,
): StoredMediaObject[] {
  const manifest = media.rendition_manifest && typeof media.rendition_manifest === "object" && !Array.isArray(media.rendition_manifest)
    ? media.rendition_manifest as Record<string, unknown>
    : null;
  const masterKey = manifest?.master && typeof manifest.master === "object" ? (manifest.master as Record<string, unknown>).key : undefined;
  const match = typeof masterKey === "string"
    ? masterKey.match(new RegExp(`^approved/${siteId}/${mediaId}/([0-9a-f]{64})/master\\.mp4$`, "i"))
    : null;
  if (
    !manifest || manifest.version !== 1 || !match || media.approved_master_key !== masterKey ||
    !Array.isArray(manifest.renditions) || manifest.renditions.length !== 0
  ) throw new Error("VALIDATION_FAILED");
  const master = storageDescriptor(manifest.master, masterKey as string);
  return [{
    approvedKey: master.key,
    recoveryKey: `recovery/${tenantId}/${master.key.slice("approved/".length)}`,
    digest: master.digest,
    bytes: master.bytes,
  }];
}

/**
 * #2829 W11 (A11) — does any publication Core protects (the live one, the
 * last good one and the versions it can roll back to) show this media? Such
 * media cannot be removed from Studio: removing it would break a version the
 * owner can put back live. Core unreachable → the removal is refused.
 */
async function mediaOnProtectedPublication(siteId: string, mediaId: string): Promise<boolean> {
  let keys: string[];
  try {
    keys = (await readCoreRetentionProjection(siteId, crypto.randomUUID())).protected_artifact_keys;
  } catch {
    throw new Error("SERVICE_TEMPORARILY_UNAVAILABLE");
  }
  for (const key of keys) {
    if (!new RegExp(`^publications/${siteId}/[0-9a-f-]{36}/[0-9a-f]{64}\\.json$`, "i").test(key)) {
      throw new Error("SERVICE_TEMPORARILY_UNAVAILABLE");
    }
    const artifact = JSON.parse(new TextDecoder().decode(await readObject(cmsConfig().artifactBucket, key))) as { media?: Array<{ id?: unknown }> };
    if ((artifact.media ?? []).some((item) => String(item.id) === mediaId)) return true;
  }
  return false;
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
  /*
   * #2830 — MP4. An ISO base-media file declares itself with an `ftyp` box:
   * a 4-byte big-endian size, then the literal "ftyp", then a brand. This is
   * checked the same way the image formats are — by reading the bytes, not by
   * trusting the upload's declared type or its filename.
   */
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.slice(4, 8)).toString("ascii") === "ftyp"
  ) {
    const brand = Buffer.from(bytes.slice(8, 12)).toString("ascii");
    if (MP4_BRANDS.has(brand)) return "video/mp4";
  }
  return null;
}

function hasExactContainerBoundary(bytes: Uint8Array, mime: string): boolean {
  if (mime === "video/mp4") {
    /*
     * An MP4 is a sequence of top-level boxes. Walk them from the start: if
     * the sizes tile the file exactly, nothing is appended past the end, which
     * is the same property the image checks establish. A zero or absurd size
     * ends the walk rather than looping.
     */
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    while (offset + 8 <= bytes.length) {
      const size = view.getUint32(offset, false);
      // `1` means a 64-bit size follows, `0` means "to end of file". Both are
      // legal but neither is produced by the encoders we accept, so refuse
      // rather than guess at the layout.
      if (size < 8) return false;
      offset += size;
    }
    return offset === bytes.length;
  }
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
    input.bytes > maxBytesFor(input.content_type)
  )
    throw new Error("MEDIA_REJECTED");
  const declaredMime = input.content_type as
    "image/jpeg" | "image/png" | "image/webp" | "video/mp4";
  const previousGrantContext = req.context.minglaMediaGrant;
  req.context.minglaMediaGrant = true;
  try {
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
    await req.payload.update({
      collection: "media",
      id: media.id,
      overrideAccess: false,
      req,
      data: { quarantine_key: key },
    });
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
      maximum_bytes: maxBytesFor(declaredMime),
    };
  } finally {
    req.context.minglaMediaGrant = previousGrantContext;
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
    | "PROCESSING_FAILED"
    | "VIDEO_NOT_FASTSTART"
    | "VIDEO_CODEC",
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


async function processApprovedVideo(
  req: PayloadRequest,
  media: { id: string | number },
  checksum: string,
  source: Uint8Array,
  quarantineKey: string,
  inspection: { durationMs: number; width: number; height: number },
) {
  await req.payload.update({
    collection: "media",
    id: media.id,
    overrideAccess: false,
    req,
    data: {
      state: "PROCESSING",
      detected_mime: "video/mp4",
      kind: "file_video",
      checksum,
      // #2829 W6 — the length (hero loops are held to 15 s) and frame size.
      duration_ms: inspection.durationMs,
      width: inspection.width || null,
      height: inspection.height || null,
    },
  });
  const siteId = (req.user as unknown as { siteId: string }).siteId;
  const key =
    `approved/${siteId}/${media.id}/${checksum}/master.mp4`;
  const digest = await sha256(source);
  // Deterministic key recorded BEFORE the first write, same as the image path,
  // so a failure leaves a durable cleanup manifest rather than an orphan.
  await req.payload.update({
    collection: "media",
    id: media.id,
    overrideAccess: false,
    req,
    data: {
      approved_master_key: key,
      rendition_manifest: {
        version: 1,
        // #2829 W6 (AD-9) — SHA-256 per 1 MiB chunk, computed at approval
        // and frozen into each publication, so the runtime verifies a byte
        // range by reading only the chunks that cover it.
        master: {
          key,
          digest,
          bytes: source.byteLength,
          chunk_size: VIDEO_CHUNK_BYTES,
          chunk_digests: await chunkDigests(source, VIDEO_CHUNK_BYTES),
        },
        // No widths: a video is served as stored. An empty list is the honest
        // record of that, rather than five fabricated entries pointing at one
        // file.
        renditions: [],
      },
    },
  });
  try {
    await writeObject(cmsConfig().approvedBucket, key, source, "video/mp4");
    const stored = await readObject(cmsConfig().approvedBucket, key);
    if (
      stored.byteLength !== source.byteLength ||
      (await sha256(stored)) !== digest
    ) throw new Error("STORAGE_UNAVAILABLE");
    return await req.payload.update({
      collection: "media",
      id: media.id,
      overrideAccess: false,
      req,
      data: { state: "READY", quarantine_key: null, quarantine_delete_by: null },
    });
  } catch (error) {
    void quarantineKey;
    throw error;
  }
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
    showHiddenFields: true,
  });
  const key = String(media.quarantine_key || "");
  if (media.state !== "UPLOADING" || !key || !/^[0-9a-f]{64}$/.test(checksum))
    throw new Error("INVALID_STATE");
  const source = await readObject(cmsConfig().quarantineBucket, key);
  if (
    source.byteLength !== observedBytes ||
    source.byteLength !== media.bytes ||
    source.byteLength > maxBytesFor(String(media.declared_mime))
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
  /*
   * #2830 — VIDEO TAKES ITS OWN PATH, and takes it early.
   *
   * Everything below this point is `sharp`: decode, re-encode to webp, strip
   * metadata, and cut five width renditions. None of that applies to an MP4,
   * and handing one to sharp fails as DECODE_FAILED, which is why video was
   * simply unsupported rather than merely absent from the allowlist.
   *
   * A video is stored ONCE, verified by digest on readback exactly as the
   * image outputs are, and carries no rendition manifest. What it does NOT get
   * is transcoding or poster extraction — there is no ffmpeg here — so a video
   * hero requires the brand to supply a poster image alongside it. That is
   * enforced where the block is built, not left for a customer to discover as
   * a black rectangle on a slow connection.
   */
  if (mime === "video/mp4") {
    // #2829 W6 — a site video must play inline and seek: H.264 (AAC audio),
    // fast start (index before data). Refused with a plain reason otherwise.
    const inspection = inspectMp4(source);
    if (!inspection.ok) {
      return reject(
        req,
        media.id,
        key,
        inspection.reason === "NOT_FASTSTART" ? "VIDEO_NOT_FASTSTART" : inspection.reason === "CODEC" ? "VIDEO_CODEC" : "MIME_MISMATCH",
      );
    }
    return processApprovedVideo(req, media, checksum, source, key, inspection);
  }
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
      kind: "image",
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
  /*
   * #2829 W7b — the extra renditions a design can offer in `srcset`: 4:3
   * centre crops (400×300, 768×576) and the picture 1600 wide. Never
   * enlarged: when the upload is smaller than a rendition in either
   * direction, that rendition is the upload at its own size, uncropped (and
   * the page lists each width once).
   */
  const variants = [];
  for (const variant of MEDIA_VARIANTS) {
    const output = await sharp(source, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize(variant.height === null
        ? { width: variant.width, withoutEnlargement: true }
        : { width: variant.width, height: variant.height, fit: "cover", position: "centre", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    const outputMeta = await sharp(output).metadata();
    const variantKey = `${base}/${variant.name}.webp`;
    const digest = await sha256(output);
    outputs.push({ key: variantKey, bytes: output, digest });
    variants.push({
      name: variant.name,
      width: outputMeta.width ?? variant.width,
      height: outputMeta.height ?? variant.height ?? 0,
      key: variantKey,
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
    ...(variants.length ? { variants } : {}),
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
    showHiddenFields: true,
  });
  const tenantId = relationshipId(media.tenant);
  if (
    !actor?.tenantId ||
    !actor.siteId ||
    tenantId !== actor.tenantId
  ) throw new Error("FORBIDDEN");
  if (media.state !== "READY") throw new Error("INVALID_STATE");
  // #2829 — EVERY page (a capped read let a photo used only on the sixth
  // page look unused), every content entry, the settings, navigation and
  // footer, and EVERY media field their schemas declare (a hand list missed
  // the hero video, a film's video and poster and team portraits, so media
  // used only there looked unused and retention would delete it).
  // #2829 W11 (A11) — refused with a reason the owner can act on.
  if ((await tenantMediaInUse(req, tenantId)).has(mediaId)) {
    throw new Error("MEDIA_IN_USE_DRAFT");
  }
  // Storage layout is validated before anything leaves this process.
  const objects = mediaStorageObjects(
    media,
    tenantId,
    actor.siteId,
    String(media.id),
  );
  if (await mediaOnProtectedPublication(actor.siteId, String(media.id))) {
    throw new Error("MEDIA_IN_USE_LIVE");
  }
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
      storedContentType(object.approvedKey),
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
    showHiddenFields: true,
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
    showHiddenFields: true,
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
      storedContentType(object.approvedKey),
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
    showHiddenFields: true,
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
        data: item.state === "UPLOADING"
          ? {
            state: "REJECTED",
            rejection_code: null,
            quarantine_key: null,
            quarantine_delete_by: null,
          }
          : { quarantine_key: null, quarantine_delete_by: null },
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
  const keptArtifactKeys = new Set(protectedArtifactKeys);
  let purgedArtifacts = 0;
  for (const [index, job] of jobs.docs.entries()) {
    if (typeof job.artifact_key !== "string") continue;
    if (
      !artifactMayBePurged({
        protectedByCore: protectedSet.has(job.artifact_key),
        completedAt: job.updatedAt,
        newestRank: index + 1,
      })
    ) {
      keptArtifactKeys.add(job.artifact_key);
      continue;
    }
    await deleteObject(cmsConfig().artifactBucket, job.artifact_key);
    purgedArtifacts += 1;
  }
  // #2829 W11 (A14) — offering-cover renditions no kept publication (and no
  // recent preview) refers to any more; see sweepOfferingRenditions. Spend
  // cap: storage must not grow with every cover a site ever showed. A failed
  // listing or read deletes nothing and is reported, never silent; the rest
  // of the sweep stands.
  try {
    const renditions = await sweepOfferingRenditions({
      siteId,
      keptArtifactKeys: [...keptArtifactKeys],
      deps: {
        list: (prefix) => listObjects(
          prefix.startsWith("publications/") ? cmsConfig().artifactBucket : cmsConfig().approvedBucket,
          prefix,
        ),
        readArtifact: async (key) => JSON.parse(new TextDecoder().decode(await readObject(cmsConfig().artifactBucket, key))),
        remove: (key) => deleteObject(cmsConfig().approvedBucket, key),
      },
    });
    emitRenditionSweep(siteId, `scanned:${renditions.scanned}->purged:${renditions.purged}`, null);
  } catch {
    emitRenditionSweep(siteId, "scan->skipped", "SERVICE_TEMPORARILY_UNAVAILABLE");
  }
  return {
    protected_artifacts: protectedSet.size,
    protected_media: protectedMediaIds.size,
    purged_media: purgedMedia,
    purged_artifacts: purgedArtifacts,
  };
}

function emitRenditionSweep(siteId: string, transition: string, code: string | null): void {
  emitCmsObservation({
    event: "mingla_sites_state",
    metric: code ? "retention.offering_renditions_skipped" : "retention.offering_renditions_swept",
    request_id: crypto.randomUUID(),
    operation_id: null,
    site_id: siteId,
    publication_id: null,
    direction: "core_to_cms",
    route: "/api/internal/retention-sweep",
    state_transition: transition,
    latency_ms: 0,
    retry_count: 0,
    safe_error_code: code,
    status_code: null,
    version: "sites-v1",
  });
}
