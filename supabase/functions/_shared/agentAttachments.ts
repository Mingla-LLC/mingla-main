/** Issue #3429 — private Ari attachment verification and Gemini projection. */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { GeminiContentMessage } from "./agentGemini.ts";

export const ARI_ATTACHMENT_BUCKET = "ari-chat-attachments";
export const ARI_ATTACHMENT_MAX_FILES = 5;
export const ARI_ATTACHMENT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ARI_ATTACHMENT_MAX_TURN_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_CONTEXT_CHARS = 250_000;
const MAX_DOCX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 80;
const MAX_PDF_STREAM_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;

export const ARI_ATTACHMENT_MIMES = Object.freeze(
  [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/csv",
    "application/csv",
  ] as const,
);

export type AriAttachmentFileType = "image" | "pdf" | "docx" | "text" | "csv";
export type AriAttachmentFailureCode =
  | "UNSUPPORTED_TYPE"
  | "FILE_TOO_LARGE"
  | "SIZE_MISMATCH"
  | "MIME_MISMATCH"
  | "CORRUPT_FILE"
  | "ENCRYPTED_FILE"
  | "UNREADABLE_FILE"
  | "DUPLICATE_FILE"
  | "DECOMPRESSION_BOMB"
  | "CONTEXT_LIMIT_EXCEEDED"
  | "UPLOAD_INCOMPLETE"
  | "ATTACHMENT_SCOPE_DENIED";

export class AriAttachmentError extends Error {
  readonly code: AriAttachmentFailureCode;

  constructor(code: AriAttachmentFailureCode) {
    super(code);
    this.name = "AriAttachmentError";
    this.code = code;
  }
}

export interface VerifiedAriAttachment {
  verifiedMime: string;
  fileType: AriAttachmentFileType;
  sizeBytes: number;
  sha256: string;
  derivativeText: string | null;
  processingMetadata: Record<string, string | number | boolean>;
}

export interface ReadyAttachmentRow {
  id: string;
  user_id: string;
  brand_id: string;
  conversation_id: string;
  message_id: string;
  client_turn_id: string;
  storage_path: string;
  derived_storage_path: string | null;
  original_filename: string;
  verified_mime: string;
  file_type: AriAttachmentFileType;
  verified_size_bytes: number;
  sha256: string;
  derived_size_bytes: number | null;
  derived_sha256: string | null;
  display_order: number;
  state: "ready";
}

const textDecoder = new TextDecoder("utf-8", { fatal: true });

function startsWithBytes(
  bytes: Uint8Array,
  signature: readonly number[],
): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function findAscii(bytes: Uint8Array, needle: string): number {
  const target = new TextEncoder().encode(needle);
  outer:
  for (let start = 0; start <= bytes.length - target.length; start += 1) {
    for (let index = 0; index < target.length; index += 1) {
      if (bytes[start + index] !== target[index]) continue outer;
    }
    return start;
  }
  return -1;
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) throw new AriAttachmentError("CORRUPT_FILE");
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) throw new AriAttachmentError("CORRUPT_FILE");
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function readU16BE(bytes: Uint8Array, offset: number): number {
  if (offset + 2 > bytes.length) throw new AriAttachmentError("CORRUPT_FILE");
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) throw new AriAttachmentError("CORRUPT_FILE");
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0;
}

function normalizedDeclaredMime(value: string): string {
  const mime = value.split(";", 1)[0].trim().toLowerCase();
  if (mime === "image/jpg") return "image/jpeg";
  if (mime === "text/comma-separated-values") return "text/csv";
  return mime;
}

export function fileTypeForDeclaredMime(
  mimeValue: string,
): AriAttachmentFileType | null {
  const mime = normalizedDeclaredMime(mimeValue);
  if (
    ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
      .includes(mime)
  ) {
    return "image";
  }
  if (mime === "application/pdf") return "pdf";
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (mime === "text/plain") return "text";
  if (["text/csv", "application/csv"].includes(mime)) return "csv";
  return null;
}

function assertTextIsNonBinary(text: string): void {
  if (text.includes("\u0000")) throw new AriAttachmentError("UNREADABLE_FILE");
  let controlCount = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 32 && ![9, 10, 13].includes(code)) controlCount += 1;
  }
  if (text.length > 0 && controlCount / text.length > 0.01) {
    throw new AriAttachmentError("UNREADABLE_FILE");
  }
}

function normalizeText(text: string): string {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
    .normalize("NFC");
  if (normalized.length > MAX_TEXT_CONTEXT_CHARS) {
    throw new AriAttachmentError("CONTEXT_LIMIT_EXCEEDED");
  }
  return normalized;
}

interface ZipEntry {
  name: string;
  flags: number;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function parseZipCentralDirectory(bytes: Uint8Array): ZipEntry[] {
  let eocd = -1;
  const lowerBound = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= lowerBound; offset -= 1) {
    if (readU32LE(bytes, offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new AriAttachmentError("CORRUPT_FILE");
  const entryCount = readU16LE(bytes, eocd + 10);
  const directorySize = readU32LE(bytes, eocd + 12);
  const directoryOffset = readU32LE(bytes, eocd + 16);
  if (entryCount > 2_000 || directoryOffset + directorySize > bytes.length) {
    throw new AriAttachmentError("DECOMPRESSION_BOMB");
  }

  const entries: ZipEntry[] = [];
  let cursor = directoryOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (readU32LE(bytes, cursor) !== 0x02014b50) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
    const flags = readU16LE(bytes, cursor + 8);
    const compression = readU16LE(bytes, cursor + 10);
    const compressedSize = readU32LE(bytes, cursor + 20);
    const uncompressedSize = readU32LE(bytes, cursor + 24);
    const nameLength = readU16LE(bytes, cursor + 28);
    const extraLength = readU16LE(bytes, cursor + 30);
    const commentLength = readU16LE(bytes, cursor + 32);
    const localOffset = readU32LE(bytes, cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.length || (flags & 0x1) !== 0) {
      throw new AriAttachmentError(
        (flags & 0x1) !== 0 ? "ENCRYPTED_FILE" : "CORRUPT_FILE",
      );
    }
    let name: string;
    try {
      name = textDecoder.decode(bytes.slice(nameStart, nameEnd));
    } catch {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
    totalUncompressed += uncompressedSize;
    if (
      totalUncompressed > MAX_DOCX_UNCOMPRESSED_BYTES ||
      (compressedSize > 0 && uncompressedSize / compressedSize > 100)
    ) {
      throw new AriAttachmentError("DECOMPRESSION_BOMB");
    }
    entries.push({
      name,
      flags,
      compression,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    cursor = nameEnd + extraLength + commentLength;
  }
  return entries;
}

async function unzipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
): Promise<Uint8Array> {
  if (readU32LE(bytes, entry.localOffset) !== 0x04034b50) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  const nameLength = readU16LE(bytes, entry.localOffset + 26);
  const extraLength = readU16LE(bytes, entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw new AriAttachmentError("UPLOAD_INCOMPLETE");
  const compressed = bytes.slice(start, end);
  if (entry.compression === 0) return compressed;
  if (entry.compression !== 8) throw new AriAttachmentError("UNSUPPORTED_TYPE");
  try {
    const stream = new Blob([compressed]).stream().pipeThrough(
      new DecompressionStream("deflate-raw"),
    );
    const result = new Uint8Array(await new Response(stream).arrayBuffer());
    if (result.length !== entry.uncompressedSize) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
    return result;
  } catch (error: unknown) {
    if (error instanceof AriAttachmentError) throw error;
    throw new AriAttachmentError("CORRUPT_FILE");
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&")
    .replace(
      /&#(\d+);/g,
      (_whole, digits: string) => String.fromCodePoint(Number(digits)),
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_whole, digits: string) =>
        String.fromCodePoint(Number.parseInt(digits, 16)),
    );
}

async function docxText(
  bytes: Uint8Array,
): Promise<{ text: string; entries: number }> {
  const entries = parseZipCentralDirectory(bytes);
  const contentTypes = entries.find((entry) =>
    entry.name === "[Content_Types].xml"
  );
  const document = entries.find((entry) => entry.name === "word/document.xml");
  if (!contentTypes || !document) throw new AriAttachmentError("CORRUPT_FILE");
  const contentTypesBytes = await unzipEntry(bytes, contentTypes);
  const contentTypesText = textDecoder.decode(contentTypesBytes);
  if (!contentTypesText.includes("wordprocessingml.document.main+xml")) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  const documentBytes = await unzipEntry(bytes, document);
  let xml: string;
  try {
    xml = textDecoder.decode(documentBytes);
  } catch {
    throw new AriAttachmentError("UNREADABLE_FILE");
  }
  const withBreaks = xml
    .replace(/<w:tab\b[^>]*\/>/g, "\t")
    .replace(/<w:br\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n");
  const textRuns = Array.from(
    withBreaks.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g),
  )
    .map((match) => decodeXmlEntities(match[1]))
    .join("");
  const text = normalizeText(textRuns.replace(/\n{3,}/g, "\n\n").trim());
  if (text.length === 0) throw new AriAttachmentError("UNREADABLE_FILE");
  return { text, entries: entries.length };
}

async function digestHex(bytes: Uint8Array): Promise<string> {
  const source = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", source));
  return Array.from(digest).map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function assertImageDimensions(width: number, height: number): void {
  if (
    width < 1 || height < 1 || !Number.isSafeInteger(width * height) ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new AriAttachmentError("DECOMPRESSION_BOMB");
  }
}

function verifyJpeg(bytes: Uint8Array): void {
  if (!startsWithBytes(bytes, [0xff, 0xd8])) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  let cursor = 2;
  let foundFrame = false;
  while (cursor < bytes.length) {
    if (bytes[cursor] !== 0xff) throw new AriAttachmentError("CORRUPT_FILE");
    while (bytes[cursor] === 0xff) cursor += 1;
    const marker = bytes[cursor++];
    if (marker === 0xd9) {
      if (!foundFrame || cursor !== bytes.length) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      return;
    }
    if (
      marker === 0x00 || marker === 0xd8 || marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
    const segmentLength = readU16BE(bytes, cursor);
    if (segmentLength < 2 || cursor + segmentLength > bytes.length) {
      throw new AriAttachmentError("UPLOAD_INCOMPLETE");
    }
    if (marker === 0xda) {
      cursor += segmentLength;
      while (cursor < bytes.length) {
        if (bytes[cursor] !== 0xff) {
          cursor += 1;
          continue;
        }
        const next = bytes[cursor + 1];
        if (next === 0xd9 && foundFrame && cursor + 2 === bytes.length) return;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          cursor += 2;
          continue;
        }
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      throw new AriAttachmentError("UPLOAD_INCOMPLETE");
    }
    const isFrame = (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isFrame) {
      if (segmentLength < 8) throw new AriAttachmentError("CORRUPT_FILE");
      assertImageDimensions(
        readU16BE(bytes, cursor + 5),
        readU16BE(bytes, cursor + 3),
      );
      foundFrame = true;
    }
    cursor += segmentLength;
  }
  throw new AriAttachmentError("UPLOAD_INCOMPLETE");
}

function pngCrc(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function verifyPng(bytes: Uint8Array): Promise<void> {
  if (
    !startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  let cursor = 8;
  let sawHeader = false;
  let sawImageData = false;
  let width = 0;
  let height = 0;
  let bytesPerRow = 0;
  const idat: Uint8Array[] = [];
  while (cursor < bytes.length) {
    const length = readU32BE(bytes, cursor);
    const typeStart = cursor + 4;
    const dataStart = cursor + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > bytes.length || !Number.isSafeInteger(chunkEnd)) {
      throw new AriAttachmentError("UPLOAD_INCOMPLETE");
    }
    if (pngCrc(bytes, typeStart, dataEnd) !== readU32BE(bytes, dataEnd)) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
    const type = String.fromCharCode(...bytes.slice(typeStart, typeStart + 4));
    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      width = readU32BE(bytes, dataStart);
      height = readU32BE(bytes, dataStart + 4);
      assertImageDimensions(width, height);
      const bitDepth = bytes[dataStart + 8];
      const colorType = bytes[dataStart + 9];
      const channels =
        ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
      if (
        !channels || ![1, 2, 4, 8, 16].includes(bitDepth) ||
        bytes[dataStart + 12] !== 0
      ) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      bytesPerRow = Math.ceil(width * channels * bitDepth / 8);
      sawHeader = true;
    } else if (type === "IDAT") {
      sawImageData = true;
      idat.push(bytes.slice(dataStart, dataEnd));
    } else if (type === "IEND") {
      if (length !== 0 || !sawImageData || chunkEnd !== bytes.length) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      try {
        const compressedBytes = new Uint8Array(
          idat.reduce((total, part) => total + part.length, 0),
        );
        let offset = 0;
        for (const part of idat) {
          compressedBytes.set(part, offset);
          offset += part.length;
        }
        const compressed = new Blob([compressedBytes.buffer]).stream()
          .pipeThrough(
            new DecompressionStream("deflate"),
          );
        const decoded = new Uint8Array(
          await new Response(compressed).arrayBuffer(),
        );
        if (decoded.length !== height * (bytesPerRow + 1)) {
          throw new AriAttachmentError("CORRUPT_FILE");
        }
      } catch (error: unknown) {
        if (error instanceof AriAttachmentError) throw error;
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      return;
    }
    cursor = chunkEnd;
  }
  throw new AriAttachmentError("UPLOAD_INCOMPLETE");
}

function verifyHeic(bytes: Uint8Array): string | null {
  if (bytes.length < 16 || findAscii(bytes.slice(4, 8), "ftyp") !== 0) {
    return null;
  }
  const brand = textDecoder.decode(bytes.slice(8, 12)).toLowerCase();
  let mime: string;
  if (["heic", "heix", "hevc", "hevx"].includes(brand)) mime = "image/heic";
  else if (["heif", "heim", "heis", "mif1", "msf1"].includes(brand)) {
    mime = "image/heif";
  } else if (brand === "avif" || brand === "avis") {
    throw new AriAttachmentError("UNSUPPORTED_TYPE");
  } else return null;

  let sawIspe = false;
  let boxCount = 0;
  const containers = new Set([
    "meta",
    "moov",
    "trak",
    "mdia",
    "minf",
    "stbl",
    "dinf",
    "edts",
    "udta",
    "iprp",
    "ipco",
  ]);
  const visit = (start: number, end: number, depth: number): void => {
    if (depth > 16) throw new AriAttachmentError("DECOMPRESSION_BOMB");
    let cursor = start;
    while (cursor < end) {
      if (++boxCount > 10_000) {
        throw new AriAttachmentError("DECOMPRESSION_BOMB");
      }
      const declaredSize = readU32BE(bytes, cursor);
      if (declaredSize < 8 || cursor + declaredSize > end) {
        throw new AriAttachmentError("UPLOAD_INCOMPLETE");
      }
      const type = textDecoder.decode(bytes.slice(cursor + 4, cursor + 8));
      if (type === "ispe") {
        if (declaredSize < 20) throw new AriAttachmentError("CORRUPT_FILE");
        assertImageDimensions(
          readU32BE(bytes, cursor + 12),
          readU32BE(bytes, cursor + 16),
        );
        sawIspe = true;
      } else if (containers.has(type)) {
        const childStart = cursor + 8 + (type === "meta" ? 4 : 0);
        if (childStart > cursor + declaredSize) {
          throw new AriAttachmentError("CORRUPT_FILE");
        }
        visit(childStart, cursor + declaredSize, depth + 1);
      }
      cursor += declaredSize;
    }
  };
  visit(0, bytes.length, 0);
  if (!sawIspe) throw new AriAttachmentError("CORRUPT_FILE");
  return mime;
}

async function detectImage(bytes: Uint8Array): Promise<string | null> {
  if (startsWithBytes(bytes, [0xff, 0xd8])) {
    verifyJpeg(bytes);
    return "image/jpeg";
  }
  if (
    startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    await verifyPng(bytes);
    return "image/png";
  }
  if (
    findAscii(bytes.slice(0, 16), "RIFF") === 0 &&
    findAscii(bytes.slice(8, 16), "WEBP") === 0
  ) {
    const declaredRiffSize = readU32LE(bytes, 4) + 8;
    if (declaredRiffSize !== bytes.length || bytes.length < 20) {
      throw new AriAttachmentError("UPLOAD_INCOMPLETE");
    }
    return "image/webp";
  }
  return verifyHeic(bytes);
}

function verifyPdf(bytes: Uint8Array): { pageCount: number } {
  const tail = bytes.slice(Math.max(0, bytes.length - 2048));
  if (findAscii(tail, "%%EOF") < 0 || findAscii(tail, "startxref") < 0) {
    throw new AriAttachmentError("UPLOAD_INCOMPLETE");
  }
  const latin = new TextDecoder("latin1").decode(bytes);
  if (/\/Encrypt\b/.test(latin)) throw new AriAttachmentError("ENCRYPTED_FILE");
  if (!/\d+\s+\d+\s+obj\b/.test(latin)) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  if (
    !/^xref\s*$/m.test(latin) || !/\bstartxref\s+\d+\s+%%EOF\s*$/m.test(latin)
  ) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  let totalStreams = 0;
  const streamPattern = /(?:\r?\n)stream\r?\n/g;
  for (const stream of latin.matchAll(streamPattern)) {
    const start = (stream.index ?? 0) + stream[0].length;
    const end = latin.indexOf("endstream", start);
    if (end < 0) throw new AriAttachmentError("UPLOAD_INCOMPLETE");
    const header = latin.slice(
      Math.max(0, (stream.index ?? 0) - 1024),
      stream.index,
    );
    const declaredLength = Array.from(header.matchAll(/\/Length\s+(\d+)/g))
      .at(-1);
    const actualLength = end - start;
    const boundedLength = declaredLength
      ? Number(declaredLength[1])
      : actualLength;
    if (
      !Number.isSafeInteger(boundedLength) || boundedLength < 0 ||
      boundedLength > MAX_PDF_STREAM_BYTES || actualLength > boundedLength + 2
    ) {
      throw new AriAttachmentError("DECOMPRESSION_BOMB");
    }
    totalStreams += boundedLength;
    if (totalStreams > MAX_PDF_STREAM_BYTES) {
      throw new AriAttachmentError("DECOMPRESSION_BOMB");
    }
  }
  const pageCount = Array.from(latin.matchAll(/\/Type\s*\/Page\b/g)).length;
  if (pageCount > MAX_PDF_PAGES) {
    throw new AriAttachmentError("CONTEXT_LIMIT_EXCEEDED");
  }
  return { pageCount };
}

export async function verifyAriAttachment(
  bytes: Uint8Array,
  declaredMimeValue: string,
  declaredSizeBytes: number,
): Promise<VerifiedAriAttachment> {
  if (bytes.length === 0) throw new AriAttachmentError("CORRUPT_FILE");
  if (
    bytes.length > ARI_ATTACHMENT_MAX_FILE_BYTES ||
    declaredSizeBytes > ARI_ATTACHMENT_MAX_FILE_BYTES
  ) {
    throw new AriAttachmentError("FILE_TOO_LARGE");
  }
  if (bytes.length !== declaredSizeBytes) {
    throw new AriAttachmentError("SIZE_MISMATCH");
  }
  const declaredMime = normalizedDeclaredMime(declaredMimeValue);
  const declaredType = fileTypeForDeclaredMime(declaredMime);
  if (!declaredType) throw new AriAttachmentError("UNSUPPORTED_TYPE");

  let verifiedMime = "";
  let fileType: AriAttachmentFileType = declaredType;
  let derivativeText: string | null = null;
  const processingMetadata: Record<string, string | number | boolean> = {};
  const imageMime = await detectImage(bytes);

  if (imageMime !== null) {
    verifiedMime = imageMime;
    fileType = "image";
  } else if (startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    const { pageCount } = verifyPdf(bytes);
    verifiedMime = "application/pdf";
    fileType = "pdf";
    processingMetadata.page_count = pageCount;
  } else if (startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const extracted = await docxText(bytes);
    verifiedMime =
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    fileType = "docx";
    derivativeText = extracted.text;
    processingMetadata.package_entries = extracted.entries;
    processingMetadata.text_chars = extracted.text.length;
  } else if (declaredType === "text" || declaredType === "csv") {
    let text: string;
    try {
      text = textDecoder.decode(bytes);
    } catch {
      throw new AriAttachmentError("UNREADABLE_FILE");
    }
    assertTextIsNonBinary(text);
    derivativeText = normalizeText(text);
    verifiedMime = declaredType === "csv" ? "text/csv" : "text/plain";
    fileType = declaredType;
    processingMetadata.text_chars = derivativeText.length;
  } else {
    throw new AriAttachmentError("CORRUPT_FILE");
  }

  const compatible = declaredMime === verifiedMime ||
    (verifiedMime === "image/heic" && declaredMime === "image/heif") ||
    (verifiedMime === "image/heif" && declaredMime === "image/heic") ||
    (verifiedMime === "text/csv" && declaredMime === "application/csv");
  if (!compatible || declaredType !== fileType) {
    throw new AriAttachmentError("MIME_MISMATCH");
  }
  return {
    verifiedMime,
    fileType,
    sizeBytes: bytes.length,
    sha256: await digestHex(bytes),
    derivativeText,
    processingMetadata,
  };
}

export function base64FromBytes(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

export function wrapAriAttachmentText(
  fileType: AriAttachmentFileType,
  displayOrder: number,
  text: string,
): string {
  const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<user_data source="attachment" type="${fileType}" index="${
    displayOrder + 1
  }">\n${escaped}\n</user_data>`;
}

export async function assertAttemptRunning(
  serviceClient: SupabaseClient,
  attemptId: string,
  userId: string,
  attemptNumber: number,
): Promise<void> {
  const { data, error } = await serviceClient.from("agent_turn_attempts")
    .select("id")
    .eq("id", attemptId)
    .eq("user_id", userId)
    .eq("attempt_number", attemptNumber)
    .eq("status", "running")
    .maybeSingle();
  if (error || !data) throw new AriAttachmentError("ATTACHMENT_SCOPE_DENIED");
}

export async function projectReadyAttachments(args: {
  serviceClient: SupabaseClient;
  rows: ReadyAttachmentRow[];
  attemptId: string;
  userId: string;
  attemptNumber: number;
}): Promise<GeminiContentMessage["parts"]> {
  const parts: GeminiContentMessage["parts"] = [];
  for (
    const attachment of [...args.rows].sort((left, right) =>
      left.display_order - right.display_order
    )
  ) {
    await assertAttemptRunning(
      args.serviceClient,
      args.attemptId,
      args.userId,
      args.attemptNumber,
    );
    const path = attachment.derived_storage_path ?? attachment.storage_path;
    const { data: downloaded, error } = await args.serviceClient.storage
      .from(ARI_ATTACHMENT_BUCKET).download(path);
    if (error || !downloaded) throw new AriAttachmentError("UNREADABLE_FILE");
    const bytes = new Uint8Array(await downloaded.arrayBuffer());
    if (attachment.derived_storage_path === null) {
      if (
        bytes.length !== attachment.verified_size_bytes ||
        await digestHex(bytes) !== attachment.sha256
      ) {
        throw new AriAttachmentError("UPLOAD_INCOMPLETE");
      }
      parts.push({
        inlineData: {
          mimeType: attachment.verified_mime,
          data: base64FromBytes(bytes),
        },
      });
    } else {
      if (
        attachment.derived_size_bytes === null ||
        attachment.derived_sha256 === null ||
        bytes.length !== attachment.derived_size_bytes ||
        await digestHex(bytes) !== attachment.derived_sha256
      ) {
        throw new AriAttachmentError("UPLOAD_INCOMPLETE");
      }
      let text: string;
      try {
        text = textDecoder.decode(bytes);
      } catch {
        throw new AriAttachmentError("UNREADABLE_FILE");
      }
      if (text.length > MAX_TEXT_CONTEXT_CHARS) {
        throw new AriAttachmentError("CONTEXT_LIMIT_EXCEEDED");
      }
      parts.push({
        text: wrapAriAttachmentText(
          attachment.file_type,
          attachment.display_order,
          text,
        ),
      });
    }
  }
  return parts;
}
