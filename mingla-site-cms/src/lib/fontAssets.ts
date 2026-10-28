import { sha256 } from "./crypto";
import {
  MAX_FONT_FILE_BYTES,
  MAX_SITE_FONT_BYTES,
  isFontFamilyName,
  type FontAsset,
  type FontFallback,
  type FontSlot,
  type FontSlotKey,
  type FontSlots,
  type FontStyle,
} from "../contracts/generated/fontSlots.ts";
import { findCatalogFont } from "../contracts/generated/fontCatalog.ts";
import { fallbackFaceFor } from "./fontMetrics";

/*
 * #2829 AD-3 / S-5 — fetch a site's chosen Google fonts ONCE, at publish, and
 * keep them first-party.
 *
 * A visitor's browser never contacts Google: the builder asks Google's CSS
 * API which woff2 files make up each family, downloads them from Google's font
 * host, checks each is a real woff2 within the size caps, stores it under its
 * own SHA-256 in the Sites media bucket, and the artifact lists the files for
 * the runtime to serve from `/fonts/<digest>`.
 *
 * Rules that are security controls, not style:
 *   - exact hosts: CSS only from https://fonts.googleapis.com, files only from
 *     https://fonts.gstatic.com; redirects are refused, never followed;
 *   - every file must start with the woff2 signature `wOF2`;
 *   - ≤ 1.5 MiB per file and ≤ 6 MiB per site;
 *   - storage keys are the content digest only — nothing from a request.
 *
 * A publish never fails because Google is slow or a family will not load: the
 * slot falls back to the design's own family (and, if even that cannot load,
 * to a system face) and a warning is returned for the owner to see.
 */

export const GOOGLE_FONTS_CSS_ORIGIN = "https://fonts.googleapis.com";
export const GOOGLE_FONTS_FILE_HOST = "fonts.gstatic.com";
/** A current desktop browser, so Google answers with woff2 files. */
export const WOFF2_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
export const DEFAULT_FONT_SUBSETS = ["latin", "latin-ext"] as const;
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_VERSION = "v1";

export type CachedFace = FontAsset;

export type FontWarningCode = "FONT_FETCH_FAILED" | "FONT_TOO_LARGE";
export type FontWarning = {
  slot: FontSlotKey;
  requested: string;
  used: string;
  code: FontWarningCode;
};

export type FontPipelineDeps = {
  fetch: typeof fetch;
  /** Store a validated woff2 under fonts/<digest>.woff2 (idempotent). */
  storeFont: (digest: string, bytes: Uint8Array) => Promise<void>;
  /** Faces already fetched for this exact request, or null. */
  cachedFaces: (requestKey: string) => Promise<CachedFace[] | null>;
  saveFaces: (requestKey: string, faces: CachedFace[]) => Promise<void>;
};

export type ResolvedSiteFonts = {
  slots: FontSlots;
  assets: FontAsset[];
  fallbacks: FontFallback[];
  warnings: FontWarning[];
};

/** The cache key for one family request (family, weights, italic, subsets). */
export function fontRequestKey(slot: Pick<FontSlot, "family" | "weights" | "italic">, subsets: readonly string[]): string {
  return [slot.family, [...slot.weights].sort((a, b) => a - b).join(","), slot.italic ? "i" : "", [...subsets].sort().join(","), CACHE_VERSION].join("|");
}

/** css2 URL for a family and its weights (italic adds the ital axis). */
export function googleCssUrl(slot: Pick<FontSlot, "family" | "weights" | "italic">): string {
  if (!isFontFamilyName(slot.family)) throw new Error("FONT_FAMILY_INVALID");
  const weights = [...slot.weights].sort((a, b) => a - b);
  const family = slot.family.replace(/ /g, "+");
  const axis = slot.italic
    ? `ital,wght@${[...weights.map((w) => `0,${w}`), ...weights.map((w) => `1,${w}`)].join(";")}`
    : `wght@${weights.join(";")}`;
  return `${GOOGLE_FONTS_CSS_ORIGIN}/css2?family=${family}:${axis}&display=swap`;
}

export type ParsedFace = {
  subset: string;
  family: string;
  style: FontStyle;
  weight: number;
  url: string;
  unicodeRange: string;
};

/** Parses Google's css2 response into faces (one per subset comment + @font-face). */
export function parseGoogleFontCss(css: string): ParsedFace[] {
  const faces: ParsedFace[] = [];
  const block = /\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  for (const match of css.matchAll(block)) {
    const body = match[2]!;
    const read = (property: string) =>
      new RegExp(`${property}\\s*:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? "";
    const family = read("font-family").replace(/^['"]|['"]$/g, "");
    const style = read("font-style");
    const weight = Number(read("font-weight"));
    const url = /src\s*:\s*url\(([^)]+)\)\s*format\(['"]woff2['"]\)/.exec(body)?.[1]?.trim() ?? "";
    const unicodeRange = read("unicode-range");
    if (!family || (style !== "normal" && style !== "italic") || !Number.isInteger(weight) || !url) continue;
    faces.push({ subset: match[1]!, family, style, weight, url, unicodeRange });
  }
  return faces;
}

function exactUrl(raw: string, host: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== host || url.username || url.password || url.port) {
    throw new Error("FONT_HOST_REFUSED");
  }
  return url;
}

async function fetchStrict(deps: Pick<FontPipelineDeps, "fetch">, url: URL, userAgent = WOFF2_USER_AGENT): Promise<Response> {
  const response = await deps.fetch(url.toString(), {
    redirect: "error",
    headers: {
      "user-agent": userAgent,
      accept: url.hostname === GOOGLE_FONTS_FILE_HOST ? (userAgent === WOFF2_USER_AGENT ? "font/woff2" : "font/ttf") : "text/css",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  // A redirect that slipped through (a runtime that ignores `redirect`) is refused.
  if (response.redirected || (response.url && new URL(response.url).hostname !== url.hostname)) {
    throw new Error("FONT_REDIRECT_REFUSED");
  }
  if (!response.ok) throw new Error("FONT_FETCH_FAILED");
  return response;
}

/** Downloads, validates and stores one woff2 file; returns its digest and size. */
export async function fetchFontFile(deps: FontPipelineDeps, raw: string): Promise<{ digest: string; bytes: number }> {
  const url = exactUrl(raw, GOOGLE_FONTS_FILE_HOST);
  const response = await fetchStrict(deps, url);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > MAX_FONT_FILE_BYTES) throw new Error("FONT_TOO_LARGE");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FONT_FILE_BYTES) throw new Error("FONT_TOO_LARGE");
  // woff2 signature "wOF2".
  if (bytes[0] !== 0x77 || bytes[1] !== 0x4f || bytes[2] !== 0x46 || bytes[3] !== 0x32) {
    throw new Error("FONT_SIGNATURE_INVALID");
  }
  const digest = await sha256(bytes);
  await deps.storeFont(digest, bytes);
  return { digest, bytes: bytes.byteLength };
}

/** The faces of one family request: from the cache, or fetched, validated and cached. */
export async function facesForSlot(
  deps: FontPipelineDeps,
  slot: Pick<FontSlot, "family" | "weights" | "italic">,
  subsets: readonly string[] = DEFAULT_FONT_SUBSETS,
): Promise<CachedFace[]> {
  const key = fontRequestKey(slot, subsets);
  const cached = await deps.cachedFaces(key);
  if (cached && cached.length) return cached;
  const cssUrl = exactUrl(googleCssUrl(slot), "fonts.googleapis.com");
  const css = await (await fetchStrict(deps, cssUrl)).text();
  const parsed = parseGoogleFontCss(css)
    .filter((face) => subsets.includes(face.subset) && face.family === slot.family && slot.weights.includes(face.weight));
  if (!parsed.length) throw new Error("FONT_FETCH_FAILED");
  const files = new Map<string, { digest: string; bytes: number }>();
  for (const face of parsed) {
    if (!files.has(face.url)) files.set(face.url, await fetchFontFile(deps, face.url));
  }
  const faces: CachedFace[] = parsed.map((face) => ({
    family: face.family,
    weight: face.weight,
    style: face.style,
    unicode_range: face.unicodeRange,
    digest: files.get(face.url)!.digest,
    bytes: files.get(face.url)!.bytes,
  }));
  await deps.saveFaces(key, faces);
  return faces;
}

function systemSlotFor(base: FontSlot, category: string | null): FontSlot {
  return {
    family: category === "serif" ? "Georgia" : "Arial",
    source: "system",
    weights: [...base.weights],
    italic: false,
  };
}

/**
 * Every chosen slot → stored files, fallback faces and warnings. Slots whose
 * family cannot be loaded fall back to the design's family for that slot
 * (then to a system face), each with a warning; nothing here throws for a
 * font problem.
 */
export async function resolveSiteFonts(
  deps: FontPipelineDeps,
  input: { slots: FontSlots; designFonts: FontSlots; subsets?: readonly string[] },
): Promise<ResolvedSiteFonts> {
  const subsets = input.subsets ?? DEFAULT_FONT_SUBSETS;
  const warnings: FontWarning[] = [];
  const assets: FontAsset[] = [];
  const digestBytes = new Map<string, number>();
  const out: Record<FontSlotKey, FontSlot | null> = { display: null, body: null, accent: null };
  const usedBytes = () => [...digestBytes.values()].reduce((sum, bytes) => sum + bytes, 0);
  const tryFaces = async (slot: FontSlot): Promise<CachedFace[]> => {
    const faces = await facesForSlot(deps, slot, subsets);
    const extra = new Map<string, number>();
    for (const face of faces) if (!digestBytes.has(face.digest)) extra.set(face.digest, face.bytes);
    const added = [...extra.values()].reduce((sum, bytes) => sum + bytes, 0);
    if (usedBytes() + added > MAX_SITE_FONT_BYTES) throw new Error("FONT_TOO_LARGE");
    return faces;
  };
  const accept = (slot: FontSlot, faces: CachedFace[]) => {
    for (const face of faces) {
      digestBytes.set(face.digest, face.bytes);
      if (!assets.some((asset) => asset.family === face.family && asset.weight === face.weight && asset.style === face.style && asset.unicode_range === face.unicode_range)) {
        assets.push(face);
      }
    }
    return slot;
  };
  for (const key of ["display", "body", "accent"] as const) {
    const slot = input.slots[key];
    if (!slot) continue;
    if (slot.source === "system") {
      out[key] = slot;
      continue;
    }
    try {
      out[key] = accept(slot, await tryFaces(slot));
      continue;
    } catch (error) {
      const code: FontWarningCode = error instanceof Error && error.message === "FONT_TOO_LARGE"
        ? "FONT_TOO_LARGE"
        : "FONT_FETCH_FAILED";
      const designSlot = input.designFonts[key];
      let used: FontSlot | null = null;
      if (designSlot && designSlot.family !== slot.family) {
        try {
          used = designSlot.source === "system" ? designSlot : accept(designSlot, await tryFaces(designSlot));
        } catch {
          used = null;
        }
      }
      if (!used) {
        used = key === "accent" && !designSlot
          ? null
          : systemSlotFor(designSlot ?? slot, findCatalogFont((designSlot ?? slot).family)?.category ?? null);
      }
      out[key] = used;
      warnings.push({ slot: key, requested: slot.family, used: used?.family ?? "none", code });
    }
  }
  const slots: FontSlots = {
    display: out.display ?? systemSlotFor(input.designFonts.display, null),
    body: out.body ?? systemSlotFor(input.designFonts.body, null),
    accent: out.accent,
  };
  const families = new Set(
    [slots.display, slots.body, slots.accent]
      .filter((slot): slot is FontSlot => slot !== null && slot.source === "google")
      .map((slot) => slot.family),
  );
  const fallbacks = [...families]
    .map((family) => fallbackFaceFor(family))
    .filter((face): face is FontFallback => face !== null);
  assets.sort((a, b) =>
    a.family.localeCompare(b.family) || a.weight - b.weight || a.style.localeCompare(b.style) ||
    a.unicode_range.localeCompare(b.unicode_range)
  );
  return { slots, assets: assets.filter((asset) => families.has(asset.family)), fallbacks, warnings };
}

/** Owner-facing sentence for a warning (Business shows it after publish). */
export function fontWarningSentence(warning: FontWarning): string {
  const slotName = warning.slot === "display" ? "heading" : warning.slot === "body" ? "body" : "accent";
  return `Your ${slotName} font couldn't be loaded, we used ${warning.used} for now.`;
}

/*
 * #2829 W11 (amendment A17) — specimens for the Business app on iPhone and
 * Android, which load fonts natively and cannot read woff2. Google answers a
 * browser that predates woff2 with one TrueType file per weight, so the
 * pipeline asks for exactly that, from the same two exact hosts with
 * redirects refused, checks the TrueType/OpenType signature and the size cap,
 * and stores it content-addressed beside the woff2 files. Previews only:
 * websites keep serving woff2 from their own origin.
 */
export const TTF_USER_AGENT = "Mozilla/5.0 (Windows; U; Windows NT 5.1; en-US) AppleWebKit/533.20.25 (KHTML, like Gecko) Version/5.0.4 Safari/533.20.27";

/** The single TrueType face Google lists for a family + weight (old-browser CSS). */
export function parseGoogleTtfCss(css: string, family: string, weight: number): string | null {
  for (const match of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = match[1]!;
    const read = (property: string) => new RegExp(`${property}\\s*:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? "";
    if (read("font-family").replace(/^['"]|['"]$/g, "") !== family) continue;
    if (read("font-style") !== "normal" || Number(read("font-weight")) !== weight) continue;
    const url = /src\s*:\s*url\(([^)]+)\)\s*format\(['"](truetype|opentype)['"]\)/.exec(body)?.[1]?.trim();
    if (url) return url;
  }
  return null;
}

/** TrueType (00 01 00 00 / "true") or OpenType-CFF ("OTTO") signature. */
export function isTrueTypeSignature(bytes: Uint8Array): boolean {
  const [a, b, c, d] = bytes;
  return (a === 0x00 && b === 0x01 && c === 0x00 && d === 0x00)
    || (a === 0x74 && b === 0x72 && c === 0x75 && d === 0x65)
    || (a === 0x4f && b === 0x54 && c === 0x54 && d === 0x4f);
}

export type TtfPipelineDeps = Pick<FontPipelineDeps, "fetch" | "cachedFaces" | "saveFaces"> & {
  /** Store a validated TrueType file under fonts/<digest>.ttf (idempotent). */
  storeTtf: (digest: string, bytes: Uint8Array) => Promise<void>;
};

/** One family + weight as a stored TrueType file (cached per request). */
export async function ttfPreviewFace(deps: TtfPipelineDeps, family: string, weight: number): Promise<CachedFace> {
  const key = [family, String(weight), "", "ttf", CACHE_VERSION].join("|");
  const cached = await deps.cachedFaces(key);
  if (cached?.[0]) return cached[0];
  const cssUrl = exactUrl(googleCssUrl({ family, weights: [weight], italic: false }), "fonts.googleapis.com");
  const css = await (await fetchStrict(deps, cssUrl, TTF_USER_AGENT)).text();
  const raw = parseGoogleTtfCss(css, family, weight);
  if (!raw) throw new Error("FONT_FETCH_FAILED");
  const response = await fetchStrict(deps, exactUrl(raw, GOOGLE_FONTS_FILE_HOST), TTF_USER_AGENT);
  if (Number(response.headers.get("content-length") ?? "0") > MAX_FONT_FILE_BYTES) throw new Error("FONT_TOO_LARGE");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FONT_FILE_BYTES) throw new Error("FONT_TOO_LARGE");
  if (!isTrueTypeSignature(bytes)) throw new Error("FONT_SIGNATURE_INVALID");
  const digest = await sha256(bytes);
  await deps.storeTtf(digest, bytes);
  const face: CachedFace = { family, weight, style: "normal", unicode_range: "", digest, bytes: bytes.byteLength };
  await deps.saveFaces(key, [face]);
  return face;
}
