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
const MAX_IMAGE_DECODED_BYTES = 64 * 1024 * 1024;

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
  crc32: number;
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
  if (
    readU16LE(bytes, eocd + 4) !== 0 ||
    readU16LE(bytes, eocd + 6) !== 0 ||
    readU16LE(bytes, eocd + 8) !== readU16LE(bytes, eocd + 10)
  ) {
    throw new AriAttachmentError("UNSUPPORTED_TYPE");
  }
  const entryCount = readU16LE(bytes, eocd + 10);
  const directorySize = readU32LE(bytes, eocd + 12);
  const directoryOffset = readU32LE(bytes, eocd + 16);
  const commentLength = readU16LE(bytes, eocd + 20);
  if (entryCount > 2_000) {
    throw new AriAttachmentError("DECOMPRESSION_BOMB");
  }
  if (
    directoryOffset + directorySize !== eocd ||
    eocd + 22 + commentLength !== bytes.length
  ) throw new AriAttachmentError("CORRUPT_FILE");

  const entries: ZipEntry[] = [];
  let cursor = directoryOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (readU32LE(bytes, cursor) !== 0x02014b50) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
    const flags = readU16LE(bytes, cursor + 8);
    const compression = readU16LE(bytes, cursor + 10);
    const crc32 = readU32LE(bytes, cursor + 16);
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
      crc32,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    cursor = nameEnd + extraLength + commentLength;
    if (cursor > eocd) throw new AriAttachmentError("CORRUPT_FILE");
  }
  if (cursor !== eocd) throw new AriAttachmentError("CORRUPT_FILE");
  return entries;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function collectStreamExact(
  stream: ReadableStream<Uint8Array>,
  expectedBytes: number,
  maximumBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > expectedBytes || total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AriAttachmentError("DECOMPRESSION_BOMB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== expectedBytes) throw new AriAttachmentError("CORRUPT_FILE");
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function unzipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
): Promise<Uint8Array> {
  if (readU32LE(bytes, entry.localOffset) !== 0x04034b50) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  const localFlags = readU16LE(bytes, entry.localOffset + 6);
  const localCompression = readU16LE(bytes, entry.localOffset + 8);
  const localCrc = readU32LE(bytes, entry.localOffset + 14);
  const localCompressedSize = readU32LE(bytes, entry.localOffset + 18);
  const localUncompressedSize = readU32LE(bytes, entry.localOffset + 22);
  const nameLength = readU16LE(bytes, entry.localOffset + 26);
  const extraLength = readU16LE(bytes, entry.localOffset + 28);
  const nameStart = entry.localOffset + 30;
  const nameEnd = nameStart + nameLength;
  let localName: string;
  try {
    localName = textDecoder.decode(bytes.slice(nameStart, nameEnd));
  } catch {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  if (
    localFlags !== entry.flags || localCompression !== entry.compression ||
    nameEnd > bytes.length ||
    localName !== entry.name ||
    ((entry.flags & 0x8) === 0 &&
      (localCrc !== entry.crc32 ||
        localCompressedSize !== entry.compressedSize ||
        localUncompressedSize !== entry.uncompressedSize))
  ) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > bytes.length) throw new AriAttachmentError("UPLOAD_INCOMPLETE");
  const compressed = bytes.slice(start, end);
  if (entry.compression === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
    if (crc32(compressed) !== entry.crc32) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
    return compressed;
  }
  if (entry.compression !== 8) throw new AriAttachmentError("UNSUPPORTED_TYPE");
  try {
    const stream = new Blob([compressed]).stream().pipeThrough(
      new DecompressionStream("deflate-raw"),
    );
    const result = await collectStreamExact(
      stream,
      entry.uncompressedSize,
      MAX_DOCX_UNCOMPRESSED_BYTES,
    );
    if (crc32(result) !== entry.crc32) {
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

interface ImageDimensions {
  width: number;
  height: number;
}

interface PngStructure extends ImageDimensions {
  bitDepth: number;
  channels: number;
  colorType: number;
  paletteEntries: number | null;
}

interface HeicStructure {
  mime: string;
  dimensions: ImageDimensions[];
}

function assertImageDimensions(
  width: number,
  height: number,
  decodedBytesPerPixel = 4,
): void {
  const pixels = width * height;
  const decodedBytes = pixels * decodedBytesPerPixel;
  if (
    width < 1 || height < 1 || !Number.isSafeInteger(pixels) ||
    pixels > MAX_IMAGE_PIXELS || decodedBytesPerPixel < 1 ||
    !Number.isSafeInteger(decodedBytes) ||
    decodedBytes > MAX_IMAGE_DECODED_BYTES
  ) {
    throw new AriAttachmentError("DECOMPRESSION_BOMB");
  }
}

function verifyJpeg(bytes: Uint8Array): ImageDimensions {
  if (!startsWithBytes(bytes, [0xff, 0xd8])) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  let cursor = 2;
  let foundFrame = false;
  let frameMarker = 0;
  let sawScan = false;
  let sawEntropy = false;
  let dimensions: ImageDimensions | null = null;
  const quantizationTables = new Set<number>();
  const dcHuffmanTables = new Set<number>();
  const acHuffmanTables = new Set<number>();
  const frameComponents = new Map<number, number>();
  while (cursor < bytes.length) {
    if (bytes[cursor] !== 0xff) throw new AriAttachmentError("CORRUPT_FILE");
    while (cursor < bytes.length && bytes[cursor] === 0xff) cursor += 1;
    if (cursor >= bytes.length) {
      throw new AriAttachmentError("UPLOAD_INCOMPLETE");
    }
    const marker = bytes[cursor++];
    if (marker === 0xd9) {
      if (
        !foundFrame || !sawScan || !sawEntropy || cursor !== bytes.length ||
        quantizationTables.size === 0 || dcHuffmanTables.size === 0 ||
        acHuffmanTables.size === 0
      ) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      if (dimensions === null) throw new AriAttachmentError("CORRUPT_FILE");
      return dimensions;
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
    const payloadStart = cursor + 2;
    const segmentEnd = cursor + segmentLength;
    if (marker === 0xdb) {
      let tableCursor = payloadStart;
      while (tableCursor < segmentEnd) {
        const precisionAndId = bytes[tableCursor++];
        const precision = precisionAndId >>> 4;
        const tableId = precisionAndId & 0x0f;
        if (precision > 1 || tableId > 3) {
          throw new AriAttachmentError("CORRUPT_FILE");
        }
        tableCursor += precision === 0 ? 64 : 128;
        if (tableCursor > segmentEnd) {
          throw new AriAttachmentError("UPLOAD_INCOMPLETE");
        }
        const valueBytes = precision === 0 ? 1 : 2;
        for (
          let valueOffset = tableCursor - 64 * valueBytes;
          valueOffset < tableCursor;
          valueOffset += valueBytes
        ) {
          const value = valueBytes === 1
            ? bytes[valueOffset]
            : readU16BE(bytes, valueOffset);
          if (value === 0) throw new AriAttachmentError("CORRUPT_FILE");
        }
        quantizationTables.add(tableId);
      }
    } else if (marker === 0xc4) {
      let tableCursor = payloadStart;
      while (tableCursor < segmentEnd) {
        const classAndId = bytes[tableCursor++];
        const tableClass = classAndId >>> 4;
        const tableId = classAndId & 0x0f;
        if (tableClass > 1 || tableId > 3 || tableCursor + 16 > segmentEnd) {
          throw new AriAttachmentError("CORRUPT_FILE");
        }
        let symbolCount = 0;
        let availableCodes = 1;
        for (let index = 0; index < 16; index += 1) {
          const codesAtLength = bytes[tableCursor + index];
          availableCodes = availableCodes * 2 - codesAtLength;
          if (availableCodes < 0) {
            throw new AriAttachmentError("CORRUPT_FILE");
          }
          symbolCount += codesAtLength;
        }
        tableCursor += 16;
        if (
          symbolCount < 1 || symbolCount > 256 ||
          tableCursor + symbolCount > segmentEnd
        ) {
          throw new AriAttachmentError("CORRUPT_FILE");
        }
        tableCursor += symbolCount;
        (tableClass === 0 ? dcHuffmanTables : acHuffmanTables).add(tableId);
      }
    }
    if (marker === 0xda) {
      if (!foundFrame || segmentLength < 8) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      const componentCount = bytes[payloadStart];
      if (
        componentCount < 1 || componentCount > frameComponents.size ||
        segmentLength !== 6 + 2 * componentCount
      ) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      const scanComponents = new Set<number>();
      if (
        Array.from(frameComponents.values()).some((table) =>
          !quantizationTables.has(table)
        )
      ) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      for (let index = 0; index < componentCount; index += 1) {
        const componentId = bytes[payloadStart + 1 + 2 * index];
        const tables = bytes[payloadStart + 2 + 2 * index];
        const dcTable = tables >>> 4;
        const acTable = tables & 0x0f;
        if (
          scanComponents.has(componentId) ||
          !frameComponents.has(componentId) ||
          !dcHuffmanTables.has(dcTable) || !acHuffmanTables.has(acTable)
        ) {
          throw new AriAttachmentError("CORRUPT_FILE");
        }
        scanComponents.add(componentId);
      }
      const spectralStart = bytes[payloadStart + 1 + 2 * componentCount];
      const spectralEnd = bytes[payloadStart + 2 + 2 * componentCount];
      const approximation = bytes[payloadStart + 3 + 2 * componentCount];
      if (
        frameMarker === 0xc2
          ? spectralStart > spectralEnd || spectralEnd > 63 ||
            (spectralStart === 0 && spectralEnd !== 0) ||
            (approximation >>> 4) > 13 || (approximation & 0x0f) > 13
          : spectralStart !== 0 || spectralEnd !== 63 || approximation !== 0
      ) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      sawScan = true;
      cursor = segmentEnd;
      let markerStart = -1;
      while (cursor < bytes.length) {
        if (bytes[cursor] !== 0xff) {
          sawEntropy = true;
          cursor += 1;
          continue;
        }
        const candidateStart = cursor;
        while (cursor < bytes.length && bytes[cursor] === 0xff) cursor += 1;
        if (cursor >= bytes.length) {
          throw new AriAttachmentError("UPLOAD_INCOMPLETE");
        }
        const next = bytes[cursor];
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          if (next === 0x00) sawEntropy = true;
          cursor += 1;
          continue;
        }
        markerStart = candidateStart;
        break;
      }
      if (markerStart < 0) throw new AriAttachmentError("UPLOAD_INCOMPLETE");
      cursor = markerStart;
      continue;
    }
    const isFrame = [0xc0, 0xc1, 0xc2].includes(marker);
    if (isFrame) {
      if (foundFrame || segmentLength < 11) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      const precision = bytes[payloadStart];
      const componentCount = bytes[payloadStart + 5];
      if (
        ![8, 12].includes(precision) ||
        (marker === 0xc0 && precision !== 8) || componentCount < 1 ||
        componentCount > 4 || segmentLength !== 8 + 3 * componentCount
      ) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      const width = readU16BE(bytes, cursor + 5);
      const height = readU16BE(bytes, cursor + 3);
      assertImageDimensions(width, height);
      dimensions = { width, height };
      for (let index = 0; index < componentCount; index += 1) {
        const componentId = bytes[payloadStart + 6 + 3 * index];
        const sampling = bytes[payloadStart + 7 + 3 * index];
        const quantizationTable = bytes[payloadStart + 8 + 3 * index];
        if (
          frameComponents.has(componentId) || (sampling >>> 4) === 0 ||
          (sampling & 0x0f) === 0 || quantizationTable > 3
        ) {
          throw new AriAttachmentError("CORRUPT_FILE");
        }
        frameComponents.set(componentId, quantizationTable);
      }
      foundFrame = true;
      frameMarker = marker;
    } else if (
      (marker >= 0xc0 && marker <= 0xcf) &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      throw new AriAttachmentError("UNSUPPORTED_TYPE");
    }
    cursor = segmentEnd;
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

async function validatePngRows(
  stream: ReadableStream<Uint8Array>,
  bytesPerRow: number,
  height: number,
): Promise<void> {
  const reader = stream.getReader();
  let total = 0;
  const rowStride = bytesPerRow + 1;
  const expectedBytes = height * rowStride;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const byte of value) {
        if (total >= expectedBytes) {
          await reader.cancel().catch(() => undefined);
          throw new AriAttachmentError("DECOMPRESSION_BOMB");
        }
        if (total % rowStride === 0 && byte > 4) {
          throw new AriAttachmentError("CORRUPT_FILE");
        }
        total += 1;
      }
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== expectedBytes) throw new AriAttachmentError("CORRUPT_FILE");
}

async function collectStreamAtMost(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AriAttachmentError("DECOMPRESSION_BOMB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function verifyPng(bytes: Uint8Array): Promise<PngStructure> {
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
  let bitDepth = 0;
  let colorType = 0;
  let sawPalette = false;
  let channels = 0;
  let paletteEntries: number | null = null;
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
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      channels =
        ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
      const legalDepths = ({
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      } as Record<number, readonly number[]>)[colorType];
      if (
        !channels || !legalDepths?.includes(bitDepth) ||
        bytes[dataStart + 10] !== 0 || bytes[dataStart + 11] !== 0 ||
        bytes[dataStart + 12] !== 0
      ) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      assertImageDimensions(
        width,
        height,
        Math.max(1, channels * Math.ceil(bitDepth / 8)),
      );
      bytesPerRow = Math.ceil(width * channels * bitDepth / 8);
      sawHeader = true;
    } else if (type === "PLTE") {
      if (
        sawPalette || sawImageData || colorType === 0 || colorType === 4 ||
        length < 3 || length > 768 || length % 3 !== 0 ||
        (colorType === 3 && length / 3 > 2 ** bitDepth)
      ) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      sawPalette = true;
      paletteEntries = length / 3;
    } else if (type === "IDAT") {
      if (colorType === 3 && !sawPalette) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
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
        await validatePngRows(compressed, bytesPerRow, height);
      } catch (error: unknown) {
        if (error instanceof AriAttachmentError) throw error;
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      return {
        width,
        height,
        bitDepth,
        channels,
        colorType,
        paletteEntries,
      };
    } else if (type.charCodeAt(0) >= 0x41 && type.charCodeAt(0) <= 0x5a) {
      throw new AriAttachmentError("UNSUPPORTED_TYPE");
    }
    cursor = chunkEnd;
  }
  throw new AriAttachmentError("UPLOAD_INCOMPLETE");
}

interface HevcConfiguration {
  lengthSize: number;
}

function parseHevcConfiguration(
  bytes: Uint8Array,
  start: number,
  end: number,
): HevcConfiguration {
  if (end - start < 23 || bytes[start] !== 1) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  const lengthSize = (bytes[start + 21] & 0x03) + 1;
  if (lengthSize === 3) throw new AriAttachmentError("CORRUPT_FILE");
  const arrayCount = bytes[start + 22];
  if (arrayCount < 3) throw new AriAttachmentError("CORRUPT_FILE");
  const parameterSets = new Set<number>();
  let cursor = start + 23;
  for (let array = 0; array < arrayCount; array += 1) {
    if (cursor + 3 > end) throw new AriAttachmentError("UPLOAD_INCOMPLETE");
    const nalType = bytes[cursor] & 0x3f;
    const nalCount = readU16BE(bytes, cursor + 1);
    cursor += 3;
    if (nalCount < 1 || nalCount > 1_000) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
    for (let nal = 0; nal < nalCount; nal += 1) {
      const nalLength = readU16BE(bytes, cursor);
      cursor += 2;
      if (nalLength < 2 || cursor + nalLength > end) {
        throw new AriAttachmentError("UPLOAD_INCOMPLETE");
      }
      const encodedType = (bytes[cursor] >>> 1) & 0x3f;
      if (
        (bytes[cursor] & 0x80) !== 0 || encodedType !== nalType ||
        (bytes[cursor + 1] & 0x07) === 0
      ) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      cursor += nalLength;
    }
    if ([32, 33, 34].includes(nalType)) parameterSets.add(nalType);
  }
  if (
    cursor !== end || ![32, 33, 34].every((type) => parameterSets.has(type))
  ) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  return { lengthSize };
}

function validateHevcItemPayload(
  bytes: Uint8Array,
  start: number,
  end: number,
  lengthSize: number,
): void {
  let cursor = start;
  let sawCodedSlice = false;
  while (cursor < end) {
    if (cursor + lengthSize > end) {
      throw new AriAttachmentError("UPLOAD_INCOMPLETE");
    }
    let nalLength = 0;
    for (let index = 0; index < lengthSize; index += 1) {
      nalLength = nalLength * 256 + bytes[cursor + index];
    }
    cursor += lengthSize;
    if (nalLength < 2 || cursor + nalLength > end) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
    const nalType = (bytes[cursor] >>> 1) & 0x3f;
    if ((bytes[cursor] & 0x80) !== 0 || (bytes[cursor + 1] & 0x07) === 0) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
    if (nalType <= 31) sawCodedSlice = true;
    cursor += nalLength;
  }
  if (!sawCodedSlice) throw new AriAttachmentError("CORRUPT_FILE");
}

function verifyHeic(bytes: Uint8Array): HeicStructure | null {
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
  const dimensions: ImageDimensions[] = [];
  const itemExtents: Array<{
    itemId: number;
    offset: number;
    length: number;
    source: "absolute" | "idat";
  }> = [];
  const itemTypes = new Map<number, string>();
  const hevcConfigurations: HevcConfiguration[] = [];
  const mediaDataRanges: Array<{ start: number; end: number }> = [];
  const itemDataRanges: Array<{ start: number; end: number }> = [];
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
        const width = readU32BE(bytes, cursor + 12);
        const height = readU32BE(bytes, cursor + 16);
        assertImageDimensions(width, height);
        dimensions.push({ width, height });
        sawIspe = true;
      } else if (type === "clap") {
        if (declaredSize !== 40) {
          throw new AriAttachmentError("CORRUPT_FILE");
        }
        const widthNumerator = readU32BE(bytes, cursor + 8);
        const widthDenominator = readU32BE(bytes, cursor + 12);
        const heightNumerator = readU32BE(bytes, cursor + 16);
        const heightDenominator = readU32BE(bytes, cursor + 20);
        const width = widthNumerator / widthDenominator;
        const height = heightNumerator / heightDenominator;
        if (
          widthDenominator === 0 || heightDenominator === 0 ||
          readU32BE(bytes, cursor + 28) === 0 ||
          readU32BE(bytes, cursor + 36) === 0 ||
          !Number.isInteger(width) || !Number.isInteger(height)
        ) {
          throw new AriAttachmentError("CORRUPT_FILE");
        }
        assertImageDimensions(width, height);
        dimensions.push({ width, height });
      } else if (type === "hvcC") {
        if (hevcConfigurations.length !== 0) {
          throw new AriAttachmentError("CORRUPT_FILE");
        }
        hevcConfigurations.push(parseHevcConfiguration(
          bytes,
          cursor + 8,
          cursor + declaredSize,
        ));
      } else if (type === "infe") {
        const payload = cursor + 8;
        if (declaredSize < 20) throw new AriAttachmentError("CORRUPT_FILE");
        const version = bytes[payload];
        let itemId: number;
        let itemTypeOffset: number;
        if (version === 2) {
          itemId = readU16BE(bytes, payload + 4);
          itemTypeOffset = payload + 8;
        } else if (version === 3) {
          itemId = readU32BE(bytes, payload + 4);
          itemTypeOffset = payload + 10;
        } else {
          throw new AriAttachmentError("UNSUPPORTED_TYPE");
        }
        if (itemId < 1 || itemTypeOffset + 4 > cursor + declaredSize) {
          throw new AriAttachmentError("CORRUPT_FILE");
        }
        const itemType = textDecoder.decode(
          bytes.slice(itemTypeOffset, itemTypeOffset + 4),
        );
        if (itemTypes.has(itemId)) {
          throw new AriAttachmentError("CORRUPT_FILE");
        }
        itemTypes.set(itemId, itemType);
      } else if (type === "iloc") {
        if (declaredSize < 16) throw new AriAttachmentError("CORRUPT_FILE");
        const payload = cursor + 8;
        const version = bytes[payload];
        if (version > 2) throw new AriAttachmentError("CORRUPT_FILE");
        const offsetSize = bytes[payload + 4] >>> 4;
        const lengthSize = bytes[payload + 4] & 0x0f;
        const baseOffsetSize = bytes[payload + 5] >>> 4;
        const indexSize = version > 0 ? bytes[payload + 5] & 0x0f : 0;
        if (
          offsetSize > 4 || lengthSize < 1 || lengthSize > 4 ||
          baseOffsetSize > 4 || indexSize > 4
        ) {
          throw new AriAttachmentError("CORRUPT_FILE");
        }
        const itemCount = version < 2
          ? readU16BE(bytes, payload + 6)
          : readU32BE(bytes, payload + 6);
        if (itemCount < 1 || itemCount > 1_000) {
          throw new AriAttachmentError("CORRUPT_FILE");
        }
        let itemCursor = payload + (version < 2 ? 8 : 10);
        const readVariableUInt = (size: number): number => {
          if (itemCursor + size > cursor + declaredSize) {
            throw new AriAttachmentError("UPLOAD_INCOMPLETE");
          }
          let value = 0;
          for (let index = 0; index < size; index += 1) {
            value = value * 256 + bytes[itemCursor++];
          }
          return value;
        };
        for (let item = 0; item < itemCount; item += 1) {
          const itemIdSize = version < 2 ? 2 : 4;
          const fixedBytes = itemIdSize + (version > 0 ? 2 : 0) + 4;
          if (itemCursor + fixedBytes > cursor + declaredSize) {
            throw new AriAttachmentError("UPLOAD_INCOMPLETE");
          }
          const itemId = itemIdSize === 2
            ? readU16BE(bytes, itemCursor)
            : readU32BE(bytes, itemCursor);
          itemCursor += itemIdSize;
          let constructionMethod = 0;
          if (version > 0) {
            constructionMethod = readU16BE(bytes, itemCursor) & 0x000f;
            itemCursor += 2;
            if (constructionMethod > 1) {
              throw new AriAttachmentError("CORRUPT_FILE");
            }
          }
          const dataReferenceIndex = readU16BE(bytes, itemCursor);
          itemCursor += 2;
          if (dataReferenceIndex !== 0) {
            throw new AriAttachmentError("CORRUPT_FILE");
          }
          const baseOffset = readVariableUInt(baseOffsetSize);
          const extentCount = readU16BE(bytes, itemCursor);
          itemCursor += 2;
          if (extentCount < 1 || extentCount > 1_000) {
            throw new AriAttachmentError("CORRUPT_FILE");
          }
          for (let extent = 0; extent < extentCount; extent += 1) {
            if (version > 0 && indexSize > 0) readVariableUInt(indexSize);
            const offset = readVariableUInt(offsetSize);
            const length = readVariableUInt(lengthSize);
            if (
              length < 1 || !Number.isSafeInteger(baseOffset + offset + length)
            ) {
              throw new AriAttachmentError("CORRUPT_FILE");
            }
            itemExtents.push({
              itemId,
              offset: baseOffset + offset,
              length,
              source: constructionMethod === 1 ? "idat" : "absolute",
            });
            if (itemExtents.length > 10_000) {
              throw new AriAttachmentError("DECOMPRESSION_BOMB");
            }
          }
        }
        if (itemCursor !== cursor + declaredSize) {
          throw new AriAttachmentError("CORRUPT_FILE");
        }
      } else if (type === "mdat") {
        if (declaredSize <= 8) throw new AriAttachmentError("CORRUPT_FILE");
        mediaDataRanges.push({ start: cursor + 8, end: cursor + declaredSize });
      } else if (type === "idat") {
        if (declaredSize <= 8) throw new AriAttachmentError("CORRUPT_FILE");
        itemDataRanges.push({ start: cursor + 8, end: cursor + declaredSize });
      } else if (type === "iinf") {
        const payload = cursor + 8;
        if (declaredSize < 14) throw new AriAttachmentError("CORRUPT_FILE");
        const version = bytes[payload];
        if (version > 1) throw new AriAttachmentError("UNSUPPORTED_TYPE");
        const childStart = payload + (version === 0 ? 6 : 8);
        if (childStart > cursor + declaredSize) {
          throw new AriAttachmentError("CORRUPT_FILE");
        }
        visit(childStart, cursor + declaredSize, depth + 1);
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
  if (!sawIspe || itemExtents.length === 0 || hevcConfigurations.length !== 1) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  if (
    !itemExtents.every((extent) =>
      (extent.source === "absolute" ? mediaDataRanges : itemDataRanges).some((
        range,
      ) =>
        extent.source === "absolute"
          ? extent.offset >= range.start &&
            extent.offset + extent.length <= range.end
          : range.start + extent.offset + extent.length <= range.end
      )
    )
  ) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  const hevcItemIds = new Set(
    Array.from(itemTypes.entries())
      .filter(([, itemType]) => itemType === "hvc1" || itemType === "hev1")
      .map(([itemId]) => itemId),
  );
  if (hevcItemIds.size === 0) throw new AriAttachmentError("CORRUPT_FILE");
  let validatedCodedItem = false;
  for (const extent of itemExtents) {
    if (!hevcItemIds.has(extent.itemId)) continue;
    const range =
      (extent.source === "absolute" ? mediaDataRanges : itemDataRanges).find((
        candidate,
      ) =>
        extent.source === "absolute"
          ? extent.offset >= candidate.start &&
            extent.offset + extent.length <= candidate.end
          : candidate.start + extent.offset + extent.length <= candidate.end
      );
    if (!range) throw new AriAttachmentError("CORRUPT_FILE");
    const payloadStart = extent.source === "absolute"
      ? extent.offset
      : range.start + extent.offset;
    validateHevcItemPayload(
      bytes,
      payloadStart,
      payloadStart + extent.length,
      hevcConfigurations[0].lengthSize,
    );
    validatedCodedItem = true;
  }
  if (!validatedCodedItem) throw new AriAttachmentError("CORRUPT_FILE");
  return { mime, dimensions };
}

function verifyWebp(bytes: Uint8Array): ImageDimensions {
  if (readU32LE(bytes, 4) + 8 !== bytes.length || bytes.length < 20) {
    throw new AriAttachmentError("UPLOAD_INCOMPLETE");
  }
  let cursor = 12;
  let extendedDimensions: { width: number; height: number } | null = null;
  let codedDimensions: ImageDimensions | null = null;
  let codedPayloadFound = false;
  while (cursor < bytes.length) {
    if (cursor + 8 > bytes.length) throw new AriAttachmentError("CORRUPT_FILE");
    const type = textDecoder.decode(bytes.slice(cursor, cursor + 4));
    const length = readU32LE(bytes, cursor + 4);
    const data = cursor + 8;
    const end = data + length;
    if (end > bytes.length) throw new AriAttachmentError("UPLOAD_INCOMPLETE");
    if (type === "VP8X" && length === 10) {
      if (
        extendedDimensions !== null || (bytes[data] & 0x01) !== 0 ||
        bytes[data + 1] !== 0 || bytes[data + 2] !== 0 || bytes[data + 3] !== 0
      ) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      if ((bytes[data] & 0x02) !== 0) {
        throw new AriAttachmentError("UNSUPPORTED_TYPE");
      }
      const width = 1 + bytes[data + 4] + (bytes[data + 5] << 8) +
        (bytes[data + 6] << 16);
      const height = 1 + bytes[data + 7] + (bytes[data + 8] << 8) +
        (bytes[data + 9] << 16);
      assertImageDimensions(width, height);
      extendedDimensions = { width, height };
    } else if (type === "VP8L" && length >= 5 && bytes[data] === 0x2f) {
      if (codedPayloadFound) throw new AriAttachmentError("CORRUPT_FILE");
      const packedDimensions = readU32LE(bytes, data + 1);
      if ((packedDimensions >>> 29) !== 0) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      const width = 1 + (packedDimensions & 0x3fff);
      const height = 1 + ((packedDimensions >>> 14) & 0x3fff);
      assertImageDimensions(width, height);
      if (
        extendedDimensions !== null &&
        (extendedDimensions.width !== width ||
          extendedDimensions.height !== height)
      ) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      codedDimensions = { width, height };
      codedPayloadFound = true;
    } else if (
      type === "VP8 " && length >= 10 && bytes[data + 3] === 0x9d &&
      bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a
    ) {
      if (codedPayloadFound) throw new AriAttachmentError("CORRUPT_FILE");
      const frameTag = bytes[data] | (bytes[data + 1] << 8) |
        (bytes[data + 2] << 16);
      const keyFrame = (frameTag & 0x01) === 0;
      const version = (frameTag >>> 1) & 0x07;
      const showFrame = (frameTag & 0x10) !== 0;
      const firstPartitionBytes = frameTag >>> 5;
      if (
        !keyFrame || version > 3 || !showFrame || firstPartitionBytes < 1 ||
        10 + firstPartitionBytes >= length
      ) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      const width = readU16LE(bytes, data + 6) & 0x3fff;
      const height = readU16LE(bytes, data + 8) & 0x3fff;
      assertImageDimensions(width, height);
      if (
        extendedDimensions !== null &&
        (extendedDimensions.width !== width ||
          extendedDimensions.height !== height)
      ) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      codedDimensions = { width, height };
      codedPayloadFound = true;
    } else if (["ANIM", "ANMF"].includes(type)) {
      throw new AriAttachmentError("UNSUPPORTED_TYPE");
    }
    if (length % 2 === 1 && (end >= bytes.length || bytes[end] !== 0)) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
    cursor = end + (length % 2);
  }
  if (cursor !== bytes.length || !codedPayloadFound) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  if (codedDimensions === null) throw new AriAttachmentError("CORRUPT_FILE");
  return codedDimensions;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function assertDecodedRgba(
  decoded: {
    width: number;
    height: number;
    data: { byteLength: number };
  },
  expected: readonly ImageDimensions[],
): void {
  assertDecodedDimensions(decoded.width, decoded.height, expected);
  if (decoded.data.byteLength !== decoded.width * decoded.height * 4) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
}

function assertDecodedDimensions(
  decodedWidth: number,
  decodedHeight: number,
  expected: readonly ImageDimensions[],
): void {
  if (
    !expected.some(({ width, height }) =>
      width === decodedWidth && height === decodedHeight
    )
  ) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  assertImageDimensions(decodedWidth, decodedHeight);
}

async function decodeJpeg(
  bytes: Uint8Array,
  dimensions: ImageDimensions,
): Promise<void> {
  const jpegModule = await import("npm:jpeg-js@0.4.4");
  try {
    const decoded = jpegModule.decode(bytes, {
      formatAsRGBA: true,
      maxMemoryUsageInMB: 192,
      maxResolutionInMP: 17,
      tolerantDecoding: false,
      useTArray: true,
    });
    assertDecodedRgba(decoded, [dimensions]);
  } catch (error: unknown) {
    if (error instanceof AriAttachmentError) throw error;
    throw new AriAttachmentError("CORRUPT_FILE");
  }
}

async function decodePng(
  bytes: Uint8Array,
  structure: PngStructure,
): Promise<void> {
  const { decode } = await import("npm:fast-png@8.0.0");
  try {
    const decoded = decode(bytes);
    if (
      decoded.width !== structure.width ||
      decoded.height !== structure.height ||
      decoded.channels !== structure.channels
    ) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
    const bytesPerRow = Math.ceil(
      structure.width * structure.channels * structure.bitDepth / 8,
    );
    const expectedBytes = bytesPerRow * structure.height;
    if (
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes > MAX_IMAGE_DECODED_BYTES ||
      decoded.data.byteLength !== expectedBytes
    ) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
    if (structure.colorType === 3) {
      if (
        !decoded.palette || decoded.palette.length !== structure.paletteEntries
      ) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      const mask = (1 << structure.bitDepth) - 1;
      for (let row = 0; row < structure.height; row += 1) {
        for (let column = 0; column < structure.width; column += 1) {
          const bitOffset = column * structure.bitDepth;
          const packedByte = decoded.data[
            row * bytesPerRow + Math.floor(bitOffset / 8)
          ];
          const shift = 8 - structure.bitDepth - (bitOffset % 8);
          const paletteIndex = (packedByte >>> shift) & mask;
          if (paletteIndex < decoded.palette.length) continue;
          throw new AriAttachmentError("CORRUPT_FILE");
        }
      }
    }
  } catch (error: unknown) {
    if (error instanceof AriAttachmentError) throw error;
    throw new AriAttachmentError("CORRUPT_FILE");
  }
}

async function decodeWebp(
  bytes: Uint8Array,
  dimensions: ImageDimensions,
): Promise<void> {
  const { default: decode } = await import("npm:@jsquash/webp@1.5.0/decode.js");
  try {
    const decoded = await decode(exactArrayBuffer(bytes));
    assertDecodedRgba(decoded, [dimensions]);
  } catch (error: unknown) {
    if (error instanceof AriAttachmentError) throw error;
    throw new AriAttachmentError("CORRUPT_FILE");
  }
}

async function decodeHeic(
  bytes: Uint8Array,
  dimensions: readonly ImageDimensions[],
): Promise<void> {
  const { default: libheif } = await import(
    "npm:libheif-js@1.23.2/wasm-bundle.js"
  );
  interface HeifImage {
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      callback: (
        displayed: {
          data: Uint8ClampedArray;
          width: number;
          height: number;
        } | null,
      ) => void,
    ): void;
    free(): void;
    get_height(): number;
    get_width(): number;
    is_primary(): boolean;
  }
  interface HeifDecoder {
    decode(source: Uint8Array): HeifImage[];
    decoder: { delete(): void } | null;
  }
  await libheif.ready;
  const decoder = new libheif.HeifDecoder() as HeifDecoder;
  let images: HeifImage[] = [];
  try {
    images = decoder.decode(bytes);
    const primaries = images.filter((image) => image.is_primary());
    if (images.length === 0 || primaries.length > 1) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
    const image = primaries[0] ?? images[0];
    const width = image.get_width();
    const height = image.get_height();
    assertDecodedDimensions(width, height, dimensions);
    const target = {
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    };
    const decoded = await new Promise<{
      data: { byteLength: number };
      width: number;
      height: number;
    }>((resolve, reject) => {
      image.display(target, (displayed) => {
        if (displayed === null) {
          reject(new AriAttachmentError("CORRUPT_FILE"));
        } else {
          resolve(displayed);
        }
      });
    });
    assertDecodedRgba(decoded, dimensions);
  } catch (error: unknown) {
    if (error instanceof AriAttachmentError) throw error;
    throw new AriAttachmentError("CORRUPT_FILE");
  } finally {
    for (const image of images) {
      try {
        image.free();
      } catch {
        // Best-effort cleanup continues so one corrupt handle cannot leak others.
      }
    }
    try {
      decoder.decoder?.delete();
    } catch {
      // The underlying libheif context may already have been released on failure.
    }
  }
}

async function detectImage(bytes: Uint8Array): Promise<string | null> {
  if (startsWithBytes(bytes, [0xff, 0xd8])) {
    const dimensions = verifyJpeg(bytes);
    await decodeJpeg(bytes, dimensions);
    return "image/jpeg";
  }
  if (
    startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    const structure = await verifyPng(bytes);
    await decodePng(bytes, structure);
    return "image/png";
  }
  if (
    findAscii(bytes.slice(0, 16), "RIFF") === 0 &&
    findAscii(bytes.slice(8, 16), "WEBP") === 0
  ) {
    const dimensions = verifyWebp(bytes);
    await decodeWebp(bytes, dimensions);
    return "image/webp";
  }
  const heic = verifyHeic(bytes);
  if (heic === null) return null;
  await decodeHeic(bytes, heic.dimensions);
  return heic.mime;
}

interface PdfStreamRecord {
  objectNumber: number;
  generation: number;
  objectOffset: number;
  dictionary: string;
  decoded: Uint8Array;
}

interface PdfReference {
  objectNumber: number;
  generation: number;
}

interface PdfXrefEntry {
  offset: number;
  generation: number;
}

function parsePdfReference(
  dictionary: string,
  key: string,
): PdfReference | null {
  const match = new RegExp(
    `/${key}\\s+(\\d+)\\s+(\\d+)\\s+R\\b`,
  ).exec(dictionary);
  if (!match) return null;
  return { objectNumber: Number(match[1]), generation: Number(match[2]) };
}

function parsePdfFilters(dictionary: string): string[] {
  if (!/\/Filter\b/.test(dictionary)) return [];
  const direct = /\/Filter\s*\/([A-Za-z0-9]+)/.exec(dictionary);
  const array = /\/Filter\s*\[((?:\s*\/[A-Za-z0-9]+\s*)+)\]/.exec(
    dictionary,
  );
  const filters = direct
    ? [direct[1]]
    : array
    ? Array.from(array[1].matchAll(/\/([A-Za-z0-9]+)/g), (match) => match[1])
    : [];
  if (filters.length === 0) throw new AriAttachmentError("CORRUPT_FILE");
  if (
    filters.length > 2 ||
    filters.some((filter) =>
      !["FlateDecode", "RunLengthDecode"].includes(filter)
    )
  ) {
    throw new AriAttachmentError("UNSUPPORTED_TYPE");
  }
  return filters;
}

function decodePdfRunLength(
  encoded: Uint8Array,
  maximumBytes: number,
): Uint8Array {
  let total = 0;
  let cursor = 0;
  let sawEnd = false;
  while (cursor < encoded.length) {
    const control = encoded[cursor++];
    if (control === 128) {
      sawEnd = true;
      break;
    }
    const count = control <= 127 ? control + 1 : 257 - control;
    total += count;
    if (total > maximumBytes) {
      throw new AriAttachmentError("DECOMPRESSION_BOMB");
    }
    if (control <= 127) {
      if (cursor + count > encoded.length) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      cursor += count;
    } else {
      if (cursor >= encoded.length) {
        throw new AriAttachmentError("CORRUPT_FILE");
      }
      cursor += 1;
    }
  }
  if (!sawEnd || cursor !== encoded.length) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  const output = new Uint8Array(total);
  cursor = 0;
  let outputOffset = 0;
  while (cursor < encoded.length) {
    const control = encoded[cursor++];
    if (control === 128) break;
    const count = control <= 127 ? control + 1 : 257 - control;
    if (control <= 127) {
      output.set(encoded.subarray(cursor, cursor + count), outputOffset);
      cursor += count;
    } else {
      output.fill(encoded[cursor++], outputOffset, outputOffset + count);
    }
    outputOffset += count;
  }
  return output;
}

async function decodePdfStream(
  encoded: Uint8Array,
  filters: string[],
  maximumBytes: number,
): Promise<Uint8Array> {
  if (encoded.byteLength > maximumBytes) {
    throw new AriAttachmentError("DECOMPRESSION_BOMB");
  }
  let decoded: Uint8Array = encoded.slice();
  for (const filter of filters) {
    if (filter === "RunLengthDecode") {
      decoded = decodePdfRunLength(decoded, maximumBytes);
      continue;
    }
    try {
      const source = decoded.buffer.slice(
        decoded.byteOffset,
        decoded.byteOffset + decoded.byteLength,
      ) as ArrayBuffer;
      decoded = await collectStreamAtMost(
        new Blob([source]).stream().pipeThrough(
          new DecompressionStream("deflate"),
        ),
        maximumBytes,
      );
    } catch (error: unknown) {
      if (error instanceof AriAttachmentError) throw error;
      throw new AriAttachmentError("CORRUPT_FILE");
    }
  }
  return decoded;
}

function pdfObjectBodyAt(
  latin: string,
  reference: PdfReference,
  xref: Map<number, PdfXrefEntry>,
): string {
  const entry = xref.get(reference.objectNumber);
  if (!entry || entry.generation !== reference.generation) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  const header = new RegExp(
    `^${reference.objectNumber}\\s+${reference.generation}\\s+obj\\b`,
  ).exec(latin.slice(entry.offset));
  if (!header) throw new AriAttachmentError("CORRUPT_FILE");
  const bodyStart = entry.offset + header[0].length;
  const bodyEnd = latin.indexOf("endobj", bodyStart);
  if (bodyEnd < 0) throw new AriAttachmentError("UPLOAD_INCOMPLETE");
  return latin.slice(bodyStart, bodyEnd);
}

function validatePdfPageTree(
  latin: string,
  root: PdfReference,
  xref: Map<number, PdfXrefEntry>,
): number {
  const catalog = pdfObjectBodyAt(latin, root, xref);
  if (!/\/Type\s*\/Catalog\b/.test(catalog)) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  const pagesReference = parsePdfReference(catalog, "Pages");
  if (!pagesReference) throw new AriAttachmentError("CORRUPT_FILE");
  const visited = new Set<string>();
  const walkPages = (
    reference: PdfReference,
    expectedParent: PdfReference | null,
    depth: number,
  ): number => {
    if (depth > 16) throw new AriAttachmentError("DECOMPRESSION_BOMB");
    const key = `${reference.objectNumber}:${reference.generation}`;
    if (visited.has(key)) throw new AriAttachmentError("CORRUPT_FILE");
    visited.add(key);
    const pages = pdfObjectBodyAt(latin, reference, xref);
    const count = /\/Count\s+(\d+)\b/.exec(pages);
    const kids = /\/Kids\s*\[([\s\S]{0,8192}?)\]/.exec(pages);
    const parent = parsePdfReference(pages, "Parent");
    if (
      !/\/Type\s*\/Pages\b/.test(pages) || !count || !kids ||
      (expectedParent === null && parent !== null) ||
      (expectedParent !== null &&
        (!parent || parent.objectNumber !== expectedParent.objectNumber ||
          parent.generation !== expectedParent.generation))
    ) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
    const declaredCount = Number(count[1]);
    if (declaredCount > MAX_PDF_PAGES) {
      throw new AriAttachmentError("CONTEXT_LIMIT_EXCEEDED");
    }
    const children = Array.from(
      kids[1].matchAll(/(\d+)\s+(\d+)\s+R\b/g),
      (match) => ({
        objectNumber: Number(match[1]),
        generation: Number(match[2]),
      }),
    );
    if (children.length < 1) throw new AriAttachmentError("CORRUPT_FILE");
    let actualCount = 0;
    for (const child of children) {
      const body = pdfObjectBodyAt(latin, child, xref);
      if (/\/Type\s*\/Pages\b/.test(body)) {
        actualCount += walkPages(child, reference, depth + 1);
      } else {
        const childKey = `${child.objectNumber}:${child.generation}`;
        if (visited.has(childKey)) {
          throw new AriAttachmentError("CORRUPT_FILE");
        }
        visited.add(childKey);
        const childParent = parsePdfReference(body, "Parent");
        if (
          !/\/Type\s*\/Page\b/.test(body) || !childParent ||
          childParent.objectNumber !== reference.objectNumber ||
          childParent.generation !== reference.generation
        ) {
          throw new AriAttachmentError("CORRUPT_FILE");
        }
        actualCount += 1;
      }
      if (actualCount > MAX_PDF_PAGES) {
        throw new AriAttachmentError("CONTEXT_LIMIT_EXCEEDED");
      }
    }
    if (actualCount !== declaredCount) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
    return actualCount;
  };
  return walkPages(pagesReference, null, 0);
}

function parseClassicPdfXref(
  latin: string,
  xrefOffset: number,
): { root: PdfReference; entries: Map<number, PdfXrefEntry> } {
  const trailerOffset = latin.indexOf("trailer", xrefOffset + 4);
  if (trailerOffset < 0) throw new AriAttachmentError("CORRUPT_FILE");
  const lines = latin.slice(xrefOffset + 4, trailerOffset).trim().split(
    /\r?\n/,
  );
  const entries = new Map<number, PdfXrefEntry>();
  let line = 0;
  while (line < lines.length) {
    const subsection = /^(\d+)\s+(\d+)\s*$/.exec(lines[line++]);
    if (!subsection) throw new AriAttachmentError("CORRUPT_FILE");
    const first = Number(subsection[1]);
    const count = Number(subsection[2]);
    if (count < 1 || count > 100_000 || line + count > lines.length) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
    for (let index = 0; index < count; index += 1) {
      const entry = /^(\d{10})\s+(\d{5})\s+([fn])\s*$/.exec(lines[line++]);
      if (!entry) throw new AriAttachmentError("CORRUPT_FILE");
      if (entry[3] === "n") {
        entries.set(first + index, {
          offset: Number(entry[1]),
          generation: Number(entry[2]),
        });
      }
    }
  }
  const dictionaryStart = latin.indexOf("<<", trailerOffset + 7);
  const dictionaryEnd = latin.indexOf(">>", dictionaryStart + 2);
  if (dictionaryStart < 0 || dictionaryEnd < 0) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  const dictionary = latin.slice(dictionaryStart, dictionaryEnd + 2);
  const size = /\/Size\s+(\d+)\b/.exec(dictionary);
  const root = parsePdfReference(dictionary, "Root");
  if (!size || Number(size[1]) < 1 || Number(size[1]) > 100_000 || !root) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  for (const [objectNumber, entry] of entries) {
    if (
      objectNumber >= Number(size[1]) || entry.offset >= xrefOffset ||
      !new RegExp(`^${objectNumber}\\s+${entry.generation}\\s+obj\\b`).test(
        latin.slice(entry.offset),
      )
    ) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
  }
  return { root, entries };
}

function readPdfXrefField(
  bytes: Uint8Array,
  cursor: number,
  width: number,
): number {
  let value = 0;
  for (let index = 0; index < width; index += 1) {
    value = value * 256 + bytes[cursor + index];
  }
  return value;
}

function parsePdfXrefStream(
  latin: string,
  xrefOffset: number,
  streams: PdfStreamRecord[],
): { root: PdfReference; entries: Map<number, PdfXrefEntry> } {
  const stream = streams.find((candidate) =>
    candidate.objectOffset === xrefOffset
  );
  if (!stream || !/\/Type\s*\/XRef\b/.test(stream.dictionary)) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  const sizeMatch = /\/Size\s+(\d+)\b/.exec(stream.dictionary);
  const widthsMatch = /\/W\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(
    stream.dictionary,
  );
  const root = parsePdfReference(stream.dictionary, "Root");
  if (
    !sizeMatch || !widthsMatch || !root ||
    !/\/Length\s+\d+\b/.test(stream.dictionary)
  ) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  const size = Number(sizeMatch[1]);
  const widths = widthsMatch.slice(1).map(Number);
  const entryWidth = widths.reduce((total, width) => total + width, 0);
  if (
    size < 1 || size > 100_000 || entryWidth < 1 || entryWidth > 12 ||
    widths.some((width) => width < 0 || width > 4)
  ) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  const indexMatch = /\/Index\s*\[([^\]]+)\]/.exec(stream.dictionary);
  const indexValues = indexMatch
    ? Array.from(indexMatch[1].matchAll(/\d+/g), (match) => Number(match[0]))
    : [0, size];
  if (indexValues.length < 2 || indexValues.length % 2 !== 0) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  const totalEntries = indexValues.reduce(
    (total, value, index) => index % 2 === 1 ? total + value : total,
    0,
  );
  if (stream.decoded.length !== totalEntries * entryWidth) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  const entries = new Map<number, PdfXrefEntry>();
  let cursor = 0;
  for (let pair = 0; pair < indexValues.length; pair += 2) {
    const first = indexValues[pair];
    const count = indexValues[pair + 1];
    if (count < 1 || first + count > size) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
    for (let index = 0; index < count; index += 1) {
      const type = widths[0] === 0
        ? 1
        : readPdfXrefField(stream.decoded, cursor, widths[0]);
      const fieldTwo = readPdfXrefField(
        stream.decoded,
        cursor + widths[0],
        widths[1],
      );
      const fieldThree = readPdfXrefField(
        stream.decoded,
        cursor + widths[0] + widths[1],
        widths[2],
      );
      cursor += entryWidth;
      if (type === 1) {
        entries.set(first + index, {
          offset: fieldTwo,
          generation: fieldThree,
        });
      } else if (type !== 0) {
        throw new AriAttachmentError("UNSUPPORTED_TYPE");
      }
    }
  }
  for (const [objectNumber, entry] of entries) {
    if (
      objectNumber >= size || entry.offset > xrefOffset ||
      !new RegExp(`^${objectNumber}\\s+${entry.generation}\\s+obj\\b`).test(
        latin.slice(entry.offset),
      )
    ) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
  }
  return { root, entries };
}

async function parsePdfStreams(
  bytes: Uint8Array,
  latin: string,
): Promise<PdfStreamRecord[]> {
  const objectHeaders = Array.from(
    latin.matchAll(/(?:^|\r?\n)(\d+)\s+(\d+)\s+obj\b/g),
    (match) => ({
      objectNumber: Number(match[1]),
      generation: Number(match[2]),
      offset: (match.index ?? 0) + match[0].indexOf(match[1]),
    }),
  );
  const records: PdfStreamRecord[] = [];
  let totalDecoded = 0;
  let objectHeaderIndex = -1;
  for (const marker of latin.matchAll(/\r?\nstream\r?\n/g)) {
    const markerOffset = marker.index ?? 0;
    while (
      objectHeaderIndex + 1 < objectHeaders.length &&
      objectHeaders[objectHeaderIndex + 1].offset < markerOffset
    ) {
      objectHeaderIndex += 1;
    }
    const object = objectHeaderIndex >= 0
      ? objectHeaders[objectHeaderIndex]
      : null;
    if (!object) throw new AriAttachmentError("CORRUPT_FILE");
    const objectPrefix = latin.slice(object.offset, markerOffset);
    const dictionaryStart = objectPrefix.indexOf("<<");
    const dictionaryEnd = objectPrefix.lastIndexOf(">>");
    if (dictionaryStart < 0 || dictionaryEnd < dictionaryStart) {
      throw new AriAttachmentError("CORRUPT_FILE");
    }
    const dictionary = objectPrefix.slice(dictionaryStart, dictionaryEnd + 2);
    const lengthMatch = /\/Length\s+(\d+)\b/.exec(dictionary);
    if (!lengthMatch) throw new AriAttachmentError("UNSUPPORTED_TYPE");
    const length = Number(lengthMatch[1]);
    const dataStart = markerOffset + marker[0].length;
    const dataEnd = dataStart + length;
    if (
      !Number.isSafeInteger(length) || length < 0 ||
      length > MAX_PDF_STREAM_BYTES || dataEnd > bytes.length
    ) {
      throw new AriAttachmentError("DECOMPRESSION_BOMB");
    }
    if (!/^(?:\r\n|\n|\r)?endstream\b/.test(latin.slice(dataEnd))) {
      throw new AriAttachmentError("UPLOAD_INCOMPLETE");
    }
    const decoded = await decodePdfStream(
      bytes.slice(dataStart, dataEnd),
      parsePdfFilters(dictionary),
      MAX_PDF_STREAM_BYTES - totalDecoded,
    );
    totalDecoded += decoded.byteLength;
    if (totalDecoded > MAX_PDF_STREAM_BYTES) {
      throw new AriAttachmentError("DECOMPRESSION_BOMB");
    }
    records.push({
      objectNumber: object.objectNumber,
      generation: object.generation,
      objectOffset: object.offset,
      dictionary,
      decoded,
    });
  }
  return records;
}

async function verifyPdf(bytes: Uint8Array): Promise<{ pageCount: number }> {
  const tail = bytes.slice(Math.max(0, bytes.length - 2048));
  if (findAscii(tail, "%%EOF") < 0 || findAscii(tail, "startxref") < 0) {
    throw new AriAttachmentError("UPLOAD_INCOMPLETE");
  }
  const latin = new TextDecoder("latin1").decode(bytes);
  if (/\/Encrypt\b/.test(latin)) throw new AriAttachmentError("ENCRYPTED_FILE");
  const startXref = /(?:^|\r?\n)startxref\s+(\d+)\s+%%EOF\s*$/.exec(latin);
  if (!startXref) throw new AriAttachmentError("CORRUPT_FILE");
  const xrefOffset = Number(startXref[1]);
  if (!Number.isSafeInteger(xrefOffset) || xrefOffset >= bytes.length) {
    throw new AriAttachmentError("CORRUPT_FILE");
  }
  const streams = await parsePdfStreams(bytes, latin);
  const parsed = latin.slice(xrefOffset, xrefOffset + 4) === "xref"
    ? parseClassicPdfXref(latin, xrefOffset)
    : parsePdfXrefStream(latin, xrefOffset, streams);
  return { pageCount: validatePdfPageTree(latin, parsed.root, parsed.entries) };
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
    const { pageCount } = await verifyPdf(bytes);
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
