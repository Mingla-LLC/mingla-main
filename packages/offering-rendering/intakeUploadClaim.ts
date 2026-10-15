/**
 * #3859 — pure intake-upload claim contract shared by web, Explorer, and the
 * upload edge function. This module deliberately owns no storage/auth/network
 * effects; it only normalizes the finite MIME/extension contract and inspects
 * uploaded bytes before the server accepts a claim.
 */

export const INTAKE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

export const INTAKE_UPLOAD_MIME_BY_EXTENSION = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".heic": "image/heic",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".odt": "application/vnd.oasis.opendocument.text",
} as const;

export type IntakeUploadExtension =
  keyof typeof INTAKE_UPLOAD_MIME_BY_EXTENSION;
export type IntakeUploadMime =
  (typeof INTAKE_UPLOAD_MIME_BY_EXTENSION)[IntakeUploadExtension];

export interface IntakeUploadClaimAnswer {
  claim_id: string;
  mime_type: IntakeUploadMime;
  size_bytes: number;
  expires_at: string;
}

export type IntakeUploadCandidateResult =
  | {
    ok: true;
    extension: IntakeUploadExtension;
    mimeType: IntakeUploadMime;
    sizeBytes: number;
  }
  | {
    ok: false;
    reason:
      | "filename_invalid"
      | "mime_type_not_allowed"
      | "mime_extension_mismatch"
      | "file_size_invalid"
      | "file_too_large";
  };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isIntakeUploadUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function intakeUploadExtensionFromFilename(
  filename: unknown,
): IntakeUploadExtension | null {
  if (
    typeof filename !== "string" ||
    filename.length === 0 ||
    filename.length > 255 ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("\0")
  ) {
    return null;
  }
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return null;
  const extension = filename.slice(dot).toLowerCase();
  return extension in INTAKE_UPLOAD_MIME_BY_EXTENSION
    ? extension as IntakeUploadExtension
    : null;
}

export function validateIntakeUploadCandidate(input: {
  filename: unknown;
  mimeType: unknown;
  sizeBytes: unknown;
}): IntakeUploadCandidateResult {
  const extension = intakeUploadExtensionFromFilename(input.filename);
  if (extension === null) return { ok: false, reason: "filename_invalid" };
  if (typeof input.mimeType !== "string") {
    return { ok: false, reason: "mime_type_not_allowed" };
  }
  const expectedMime = INTAKE_UPLOAD_MIME_BY_EXTENSION[extension];
  if (input.mimeType !== expectedMime) {
    const supported = Object.values(INTAKE_UPLOAD_MIME_BY_EXTENSION).includes(
      input.mimeType as IntakeUploadMime,
    );
    return {
      ok: false,
      reason: supported ? "mime_extension_mismatch" : "mime_type_not_allowed",
    };
  }
  if (
    typeof input.sizeBytes !== "number" ||
    !Number.isInteger(input.sizeBytes) ||
    input.sizeBytes <= 0
  ) {
    return { ok: false, reason: "file_size_invalid" };
  }
  if (input.sizeBytes > INTAKE_UPLOAD_MAX_BYTES) {
    return { ok: false, reason: "file_too_large" };
  }
  return {
    ok: true,
    extension,
    mimeType: expectedMime,
    sizeBytes: input.sizeBytes,
  };
}

function beginsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function asciiAt(bytes: Uint8Array, offset: number, expected: string): boolean {
  if (bytes.length < offset + expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected.charCodeAt(index)) return false;
  }
  return true;
}

function zipContains(bytes: Uint8Array, marker: string): boolean {
  return new TextDecoder("latin1").decode(bytes).includes(marker);
}

/**
 * Inspect the actual uploaded bytes, not only client metadata. DOCX/ODT are ZIP
 * containers, so their required container markers are checked in addition to
 * the ZIP signature.
 */
export function intakeUploadBytesMatch(
  bytes: Uint8Array,
  extension: IntakeUploadExtension,
): boolean {
  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return beginsWith(bytes, [0xff, 0xd8, 0xff]);
    case ".png":
      return beginsWith(bytes, [
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
      ]);
    case ".webp":
      return asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP");
    case ".pdf":
      return asciiAt(bytes, 0, "%PDF-");
    case ".heic": {
      if (!asciiAt(bytes, 4, "ftyp")) return false;
      const brand = new TextDecoder("ascii").decode(bytes.slice(8, 12));
      return ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(
        brand,
      );
    }
    case ".doc":
      return beginsWith(bytes, [
        0xd0,
        0xcf,
        0x11,
        0xe0,
        0xa1,
        0xb1,
        0x1a,
        0xe1,
      ]);
    case ".docx":
      return beginsWith(bytes, [0x50, 0x4b]) &&
        zipContains(bytes, "[Content_Types].xml") &&
        zipContains(bytes, "word/");
    case ".odt":
      return beginsWith(bytes, [0x50, 0x4b]) &&
        zipContains(bytes, "application/vnd.oasis.opendocument.text");
  }
}

export function isIntakeUploadClaimAnswer(
  value: unknown,
): value is IntakeUploadClaimAnswer {
  if (value === null || typeof value !== "object") return false;
  const answer = value as Record<string, unknown>;
  return isIntakeUploadUuid(answer.claim_id) &&
    typeof answer.mime_type === "string" &&
    Object.values(INTAKE_UPLOAD_MIME_BY_EXTENSION).includes(
      answer.mime_type as IntakeUploadMime,
    ) &&
    typeof answer.size_bytes === "number" &&
    Number.isInteger(answer.size_bytes) &&
    answer.size_bytes > 0 &&
    answer.size_bytes <= INTAKE_UPLOAD_MAX_BYTES &&
    typeof answer.expires_at === "string" &&
    Number.isFinite(Date.parse(answer.expires_at));
}
