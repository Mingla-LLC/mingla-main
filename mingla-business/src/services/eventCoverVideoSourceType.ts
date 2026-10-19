/**
 * #3040 B-C19 [A-20] — resolve a picked video's container type leniently.
 *
 * Prepare used to demand that the file NAME's extension equal the MIME's, so a
 * valid clip failed with the generic "We couldn't finish this video upload"
 * whenever the Android picker or Google Photos handed back a null or
 * extensionless name, or a browser reported an empty MIME.
 *
 * Order: an allowed MIME wins; else an allowed extension; else the first 12
 * bytes (`ftyp` box → MP4 family, brand `qt  ` → MOV; EBML → WebM). A 3GPP
 * source is refused by name (design H-14c) — Bunny's ladder is not built for
 * it and the host can re-export. Pure: no React, no React Native, no I/O.
 */

export type LaneVideoExtension = "mp4" | "mov" | "m4v" | "webm";

const MIME_TO_EXTENSION = new Map<string, LaneVideoExtension>([
  ["video/mp4", "mp4"],
  ["video/quicktime", "mov"],
  ["video/x-m4v", "m4v"],
  ["video/webm", "webm"],
]);

export const EXTENSION_TO_MIME: Record<LaneVideoExtension, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
};

const REFUSED_MIMES = new Set(["video/3gpp", "video/3gpp2"]);
const REFUSED_EXTENSIONS = new Set(["3gp", "3g2"]);

/** Thrown for a type the lane cannot take. `code` drives the H-14c copy. */
export class LaneVideoTypeError extends Error {
  readonly code: "video_source_type_unsupported" | "video_source_type_unknown";
  constructor(code: "video_source_type_unsupported" | "video_source_type_unknown") {
    super(code);
    this.name = "LaneVideoTypeError";
    this.code = code;
  }
}

const extensionOf = (fileName: string | null | undefined): string | null => {
  if (typeof fileName !== "string") return null;
  const match = /\.([a-z0-9]+)$/i.exec(fileName.split(/[?#]/, 1)[0] ?? fileName);
  return match?.[1]?.toLowerCase() ?? null;
};

const ascii = (bytes: Uint8Array, start: number, end: number): string => {
  let out = "";
  for (let i = start; i < end && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
};

/** Sniff the container from the first 12 bytes. null when it cannot tell. */
export const sniffLaneVideoType = (
  head: Uint8Array | null | undefined,
): LaneVideoExtension | "3gpp" | null => {
  if (!head || head.length < 4) return null;
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "webm";
  if (head.length >= 12 && ascii(head, 4, 8) === "ftyp") {
    const brand = ascii(head, 8, 12);
    if (brand === "qt  ") return "mov";
    if (brand.startsWith("M4V")) return "m4v";
    if (brand.startsWith("3gp") || brand.startsWith("3g2")) return "3gpp";
    return "mp4";
  }
  return null;
};

export type ResolvedLaneVideoType = {
  extension: LaneVideoExtension;
  mimeType: string;
  /** The given name when it already ends in the resolved extension, else `video.<ext>`. */
  fileName: string;
};

export const resolveLaneVideoType = (input: {
  mimeType?: string | null;
  fileName?: string | null;
  head?: Uint8Array | null;
}): ResolvedLaneVideoType => {
  // An empty browser MIME is "unknown", never a type.
  const mime = String(input.mimeType ?? "").trim().toLowerCase();
  const named = extensionOf(input.fileName);
  if (REFUSED_MIMES.has(mime) || (named !== null && REFUSED_EXTENSIONS.has(named))) {
    throw new LaneVideoTypeError("video_source_type_unsupported");
  }
  let extension: LaneVideoExtension | null = MIME_TO_EXTENSION.get(mime) ?? null;
  if (extension === null && named !== null && named in EXTENSION_TO_MIME) {
    extension = named as LaneVideoExtension;
  }
  if (extension === null) {
    const sniffed = sniffLaneVideoType(input.head);
    if (sniffed === "3gpp") throw new LaneVideoTypeError("video_source_type_unsupported");
    extension = sniffed;
  }
  if (extension === null) throw new LaneVideoTypeError("video_source_type_unknown");
  const base = typeof input.fileName === "string" ? input.fileName.trim() : "";
  const fileName = base.length > 0 && named === extension ? base : `video.${extension}`;
  return { extension, mimeType: EXTENSION_TO_MIME[extension], fileName };
};
