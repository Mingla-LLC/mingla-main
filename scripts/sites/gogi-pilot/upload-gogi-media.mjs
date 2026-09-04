#!/usr/bin/env node
/*
 * #2830 — upload gögi's own media into Mingla's private media pipeline and
 * write a slot -> media-id manifest the seed consumes.
 *
 * Separate from the seed on purpose. Uploading 46 files is slow and can fail
 * halfway; the seed is a fast, all-or-nothing content reconcile. Keeping them
 * apart means a half-finished upload never leaves the site half-seeded, and a
 * re-run of either is cheap.
 *
 * Idempotent: every file is stored under a content-addressed filename, so a
 * second run finds its own earlier upload and reuses the id instead of
 * creating a duplicate.
 */
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

import {
  CmsSeedClient,
  GOGI_BRAND_ID,
  GOGI_CONFIGURED_BY,
  GOGI_SOURCE,
  SeedError,
  validateStudioSession,
} from "./seed-gogi-pilot.mjs";
import { MEDIA_SLOTS } from "./media-slots.mjs";

const MAX_BYTES = 20 * 1024 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(code) {
  throw new SeedError(code);
}

// The same four types the CMS pipeline accepts. Detected from bytes, never
// from the file extension: an extension is a claim, the magic number is not.
const MP4_BRANDS = new Set(["isom", "iso2", "mp41", "mp42", "avc1", "dash"]);

export function detectMime(bytes) {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
    bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") {
    const brand = bytes.toString("ascii", 8, 12).trim().toLowerCase();
    if (MP4_BRANDS.has(brand)) return "video/mp4";
  }
  return fail("UNSUPPORTED_MEDIA_TYPE");
}

const EXTENSION = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
};

// Content-addressed, so re-running finds the same object rather than a second
// copy of it. The slot is in the name only to make the media library legible
// to a human scrolling it in Studio.
export function deterministicMediaFilename(slot, sha256, mime) {
  const extension = EXTENSION[mime];
  if (!extension) fail("UNSUPPORTED_MEDIA_TYPE");
  const safeSlot = slot.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return `gogi-pilot-${safeSlot}-${sha256}.${extension}`;
}

export async function inspectAsset(slot, path) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch {
    fail("MEDIA_FILE_MISSING");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail("MEDIA_FILE_NOT_REGULAR");
  if (metadata.size < 1 || metadata.size > MAX_BYTES) fail("MEDIA_FILE_SIZE_INVALID");
  const bytes = await readFile(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const mime = detectMime(bytes);
  return {
    slot,
    bytes,
    byteLength: metadata.size,
    mime,
    sha256,
    filename: deterministicMediaFilename(slot, sha256, mime),
  };
}

export function planUploads(assets, libraryMedia) {
  const ready = new Map();
  for (const item of libraryMedia) {
    const name = String(item?.filename || "");
    if (!name) continue;
    if (ready.has(name)) fail("DUPLICATE_MEDIA_FILENAME");
    ready.set(name, item);
  }
  const plan = [];
  for (const asset of assets) {
    const existing = ready.get(asset.filename);
    if (!existing) {
      plan.push({ asset, action: "upload", mediaId: null });
      continue;
    }
    // A half-finished upload from a previous run must be re-driven, not
    // silently treated as done.
    if (existing.state !== "READY") {
      plan.push({ asset, action: "upload", mediaId: null });
      continue;
    }
    plan.push({ asset, action: "reuse", mediaId: String(existing.id) });
  }
  return plan;
}

function parseArgs(argv) {
  const values = {};
  const allowed = new Set([
    "--source-dir",
    "--manifest-out",
    "--site-id",
    "--brand-id",
    "--tenant-id",
    "--configured-by",
    "--source",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      if (values.apply === true) fail("DUPLICATE_ARGUMENT");
      values.apply = true;
      continue;
    }
    if (!allowed.has(argument)) fail("UNKNOWN_ARGUMENT");
    if (Object.prototype.hasOwnProperty.call(values, argument)) fail("DUPLICATE_ARGUMENT");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail("MISSING_ARGUMENT_VALUE");
    values[argument] = value;
    index += 1;
  }
  return values;
}

export function validateUploadOptions(raw) {
  const required = (value, code) => {
    if (typeof value !== "string" || value.trim() === "") fail(code);
    return value.trim();
  };
  const options = {
    sourceDir: resolve(required(raw["--source-dir"], "MISSING_SOURCE_DIR")),
    manifestOut: resolve(required(raw["--manifest-out"], "MISSING_MANIFEST_OUT")),
    siteId: required(raw["--site-id"], "MISSING_SITE_ID").toLowerCase(),
    brandId: required(raw["--brand-id"], "MISSING_BRAND_ID").toLowerCase(),
    tenantId: required(raw["--tenant-id"], "MISSING_TENANT_ID").toLowerCase(),
    configuredBy: required(raw["--configured-by"], "MISSING_CONFIGURED_BY").toLowerCase(),
    source: required(raw["--source"], "MISSING_SOURCE"),
    apply: raw.apply === true,
  };
  if (![options.siteId, options.brandId, options.tenantId, options.configuredBy].every((id) => UUID.test(id))) {
    fail("INVALID_ID");
  }
  if (options.brandId !== GOGI_BRAND_ID) fail("WRONG_GOGI_BRAND");
  if (options.configuredBy !== GOGI_CONFIGURED_BY) fail("WRONG_CONFIGURED_BY");
  if (options.source !== GOGI_SOURCE) fail("UNSUPPORTED_SOURCE");
  return options;
}

export async function uploadAll(client, options, dependencies = {}) {
  const inspect = dependencies.inspectAsset ?? inspectAsset;
  const assets = [];
  for (const [slot, relativePath] of Object.entries(MEDIA_SLOTS)) {
    assets.push(await inspect(slot, join(options.sourceDir, relativePath)));
  }

  const snapshot = await client.readState();
  const plan = planUploads(assets, Array.isArray(snapshot.media) ? snapshot.media : []);
  const pending = plan.filter((entry) => entry.action === "upload");

  if (!options.apply) {
    return {
      mode: "dry-run",
      total: plan.length,
      pending: pending.length,
      reused: plan.length - pending.length,
      changed: false,
      manifest: null,
    };
  }

  const manifest = {};
  for (const entry of plan) {
    manifest[entry.asset.slot] = entry.action === "reuse"
      ? entry.mediaId
      : String(await client.uploadAsset(entry.asset));
  }
  for (const slot of Object.keys(MEDIA_SLOTS)) {
    if (!UUID.test(String(manifest[slot] || ""))) fail("MEDIA_MANIFEST_INCOMPLETE");
  }

  await writeFile(options.manifestOut, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return {
    mode: "apply",
    total: plan.length,
    pending: pending.length,
    reused: plan.length - pending.length,
    changed: pending.length > 0,
    manifest: options.manifestOut,
  };
}

export async function run(argv, environment = process.env, dependencies = {}) {
  const options = validateUploadOptions(parseArgs(argv));
  const credentials = validateStudioSession(
    environment.MINGLA_SITES_SEED_STUDIO_COOKIE,
    environment.MINGLA_SITES_SEED_STUDIO_CSRF,
    options,
  );
  const client = dependencies.client ?? new CmsSeedClient({
    ...credentials,
    fetchImpl: dependencies.fetchImpl ?? fetch,
  });
  const result = await uploadAll(client, options, dependencies);
  return { ok: true, ...result, brand_id: options.brandId, tenant_id: options.tenantId };
}

async function main() {
  try {
    const result = await run(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const code = error instanceof SeedError ? error.code : "MEDIA_UPLOAD_OPERATOR_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
