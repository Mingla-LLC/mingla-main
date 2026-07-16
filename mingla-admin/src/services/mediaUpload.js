/**
 * ISSUE-864 WP4 [Campaign Builder] — SPEC §4.3: the first upload helper in
 * mingla-admin. Uploads ONE ad image File to the public-read
 * `meta-ad-creatives` Storage bucket (admin-write RLS —
 * I-PROPOSED-864-CREATIVE-BUCKET-ADMIN-WRITE) and returns { publicUrl, path }.
 *
 * The bucket is the STORAGE bound only (30 MB / png+jpeg); channel acceptance
 * is the #866 server-side byte-probe via admin-ad-creative-upload (A4.c).
 * Client-side checks here are UX-only — the server re-validates everything.
 */

import { supabase } from "../lib/supabase";

export const AD_CREATIVES_BUCKET = "meta-ad-creatives";

const ALLOWED_TYPES = { "image/jpeg": "jpg", "image/png": "png" };
const MAX_BYTES = 30 * 1024 * 1024; // the bucket's storage bound (Meta's cap)

/** A4.c: per-channel byte caps surfaced in the dropzone (never one shared cap). */
export const CHANNEL_BYTE_CAPS = [
  { platform: "meta", label: "Meta", maxBytes: 30 * 1024 * 1024, capLabel: "30 MB" },
  { platform: "google", label: "Google", maxBytes: 5120 * 1024, capLabel: "5,120 KB" },
  { platform: "snapchat", label: "Snapchat", maxBytes: 5 * 1024 * 1024, capLabel: "5 MB" },
];

/** Client-side pre-check (UX-only). Returns string[] of blocking problems. */
export function precheckImageFile(file) {
  const problems = [];
  if (!file) return ["Pick a file."];
  if (!ALLOWED_TYPES[file.type]) {
    problems.push("Only JPG or PNG — every channel rejects GIF/WEBP somewhere (Google rejects them outright).");
  }
  if (file.size > MAX_BYTES) {
    problems.push(`This image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the storage bound is 30 MB.`);
  }
  return problems;
}

/** Non-blocking per-channel size warnings (A4.c dropzone honesty). */
export function channelSizeWarnings(file) {
  if (!file) return [];
  return CHANNEL_BYTE_CAPS
    .filter((cap) => file.size > cap.maxBytes)
    .map((cap) =>
      `This image is ${(file.size / 1024 / 1024).toFixed(1)} MB — over ${cap.label}'s ${cap.capLabel} limit. The validator will flag it for that channel.`
    );
}

/**
 * Upload to the bucket. Throws on failure (house pattern: services throw).
 * Path shape: campaign-builder/{yyyy-mm}/{crypto uuid}.{ext}
 */
export async function uploadAdImage(file) {
  const problems = precheckImageFile(file);
  if (problems.length > 0) throw new Error(problems.join(" "));

  const ext = ALLOWED_TYPES[file.type];
  const month = new Date().toISOString().slice(0, 7);
  const path = `campaign-builder/${month}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(AD_CREATIVES_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data } = supabase.storage.from(AD_CREATIVES_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("Upload succeeded but no public URL came back.");
  return { publicUrl: data.publicUrl, path };
}
