// issue #1023 wave 2 — loads a host's chosen Google Fonts family on demand.
//
// A theme font that is not one of the 14 bundled slugs resolves to the keys
// `GF_<Family_With_Underscores>_500` and `_700` (themeResolver.googleFontKey).
// Every render site already uses `theme.fontFamilyValue` /
// `boldFontFamily(theme)`, so this loader only has to make sure something real
// is registered under those two keys:
//
//   - the family's 500 and 700 faces (snapped: a missing weight falls back to
//     the family's default face, and a missing bold reuses the base face);
//   - or, when anything fails (offline with no cache, a family Google no
//     longer serves, a timeout), Inter registered under BOTH keys.
//
// I-1023-FONT-FALLS-BACK-TO-INTER: never leave a referenced key unregistered.
// On native an unregistered family silently draws the system face; Inter is
// the Mingla default, so a failure looks like "no custom font", not "broken".
//
// I-1023-ONLY-CHOSEN-FONT-DOWNLOADS: a page downloads one family's base and
// bold only. The 14 legacy slugs never reach this module (they stay bundled).
//
// I-1023-NO-GOOGLE-FROM-BUYER-BROWSER: on web every request is same-origin
// (`/gfonts/...`, a Vercel rewrite in mingla-business/vercel.json), so Google
// sees Vercel, not the buyer, and the public-page CSP (`font-src 'self'`,
// `connect-src 'self'`) needs no change. The local Expo dev server has no such
// rewrite, so a development web build calls Google directly.
//
// Package-pure (I-MOR-0827-PACKAGE-ISOLATION): no app imports. The Inter
// fallback modules are passed in by the app wrapper, because the
// `@expo-google-fonts/*` thunks are app-local (ORCH-1083 boot budget).

import * as Font from "expo-font";
import { Platform } from "react-native";

import { googleFontKey, isGoogleFontFamily } from "./themeResolver";

export type FontModuleSource = number | string;

export interface InterFallbackModules {
  base: FontModuleSource;
  bold: FontModuleSource;
}

export interface EnsureGoogleFontOptions {
  /** Resolves the bundled Inter 500 / 700 modules for the failure path. */
  loadFallback: () => Promise<InterFallbackModules>;
}

export interface EnsureGoogleFontResult {
  loaded: boolean;
  fellBack: boolean;
}

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface GoogleFontOrigins {
  css: string;
  file: string;
}

const GOOGLE_CSS = "https://fonts.googleapis.com";
const GOOGLE_FILES = "https://fonts.gstatic.com";
const PROXY = "/gfonts";

/**
 * Where font CSS and files come from. Web production uses the same-origin
 * proxy; native, and the local web dev server (no rewrite), use Google.
 */
export const resolveGoogleFontOrigins = (
  platform: string,
  dev: boolean,
): GoogleFontOrigins =>
  platform === "web" && !dev
    ? { css: PROXY, file: PROXY }
    : { css: GOOGLE_CSS, file: GOOGLE_FILES };

const IS_DEV = typeof __DEV__ !== "undefined" && __DEV__ === true;
const ORIGINS = resolveGoogleFontOrigins(Platform.OS, IS_DEV);
export const GF_CSS_ORIGIN = ORIGINS.css;
export const GF_FILE_ORIGIN = ORIGINS.file;

const CSS_TIMEOUT_MS = 4000;
const WEB_LOAD_CAP_MS = 6000;
// Non-browser user agents get static TTF URLs from css2 (curl-verified with the
// CFNetwork and okhttp agents). Set explicitly so the platform default can
// never switch native to woff2, which expo-font cannot register.
const NATIVE_CSS_HEADERS = { "User-Agent": "okhttp/4.12.0" };

const familyParam = (family: string): string =>
  encodeURIComponent(family).replace(/%20/g, "+");

/** The css2 URL for a family and optional weight list. */
export const googleCssUrl = (
  origin: string,
  family: string,
  weights?: readonly number[],
  text?: string,
): string => {
  const wght =
    weights !== undefined && weights.length > 0
      ? `:wght@${weights.join(";")}`
      : "";
  const textParam =
    text !== undefined ? `&text=${encodeURIComponent(text)}` : "";
  return `${origin}/css2?family=${familyParam(family)}${wght}&display=swap${textParam}`;
};

export interface FontFaceBlock {
  weight: number;
  css: string;
  url: string | null;
}

/** Splits a css2 response into its `@font-face` blocks. */
export const parseFontFaceBlocks = (css: string): FontFaceBlock[] => {
  const blocks: FontFaceBlock[] = [];
  const re = /(\/\*[^*]*\*\/\s*)?@font-face\s*\{[^}]*\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    const text = match[0];
    const weightMatch = /font-weight:\s*(\d+)/.exec(text);
    const urlMatch = /src:\s*url\(([^)]+)\)/.exec(text);
    blocks.push({
      weight: weightMatch !== null ? Number(weightMatch[1]) : 400,
      css: text,
      url: urlMatch !== null ? urlMatch[1].replace(/['"]/g, "") : null,
    });
  }
  return blocks;
};

/**
 * Rewrites Google's blocks for the web: the file host becomes `fileOrigin`, the
 * family becomes `key`, and the weight becomes the full range so a style's
 * `fontWeight` never triggers faux bold (native ignores `fontWeight` too).
 * Every `unicode-range` subset is kept (Yoruba ṣ ẹ ọ live in latin-ext).
 */
export const rewriteBlocksForWeb = (
  blocks: readonly FontFaceBlock[],
  key: string,
  fileOrigin: string,
): string =>
  blocks
    .map((block) =>
      block.css
        .split(`${GOOGLE_FILES}/`)
        .join(`${fileOrigin}/`)
        .replace(/font-family:\s*[^;]+;/, `font-family: '${key}';`)
        .replace(/font-weight:\s*\d+;/, "font-weight: 100 900;"),
    )
    .join("\n");

export interface ResolvedFaces {
  base: FontFaceBlock[];
  bold: FontFaceBlock[];
}

/**
 * Resolves the base (500) and bold (700) faces with at most four small css2
 * requests. Google answers HTTP 400 for a weight the family lacks, so weights
 * are snapped: pair → single 500 (else the default face) → single 700 (else
 * the base). Returns null when nothing usable came back.
 */
export const resolveGoogleFaces = async (
  family: string,
  fetchCss: (url: string) => Promise<{ status: number; text: string } | null>,
  origin: string,
): Promise<ResolvedFaces | null> => {
  const pair = await fetchCss(googleCssUrl(origin, family, [500, 700]));
  if (pair !== null && pair.status === 200) {
    const blocks = parseFontFaceBlocks(pair.text);
    const base = blocks.filter((b) => b.weight === 500);
    const bold = blocks.filter((b) => b.weight === 700);
    if (base.length > 0) return { base, bold: bold.length > 0 ? bold : base };
  }
  if (pair === null || pair.status !== 400) return null;

  const single = async (weights?: number[]): Promise<FontFaceBlock[]> => {
    const response = await fetchCss(googleCssUrl(origin, family, weights));
    if (response === null || response.status !== 200) return [];
    return parseFontFaceBlocks(response.text);
  };
  let base = await single([500]);
  if (base.length === 0) base = await single();
  if (base.length === 0) return null;
  const bold = await single([700]);
  return { base, bold: bold.length > 0 ? bold : base };
};

const firstUrl = (blocks: readonly FontFaceBlock[]): string | null => {
  const ttf = blocks.find((b) => b.url !== null && /\.ttf(\?|$)/.test(b.url));
  return ttf?.url ?? null;
};

const fetchWithTimeout = async (
  url: string,
  headers: Record<string, string> | undefined,
): Promise<{ status: number; text: string } | null> => {
  const fetchImpl = (globalThis as { fetch?: FetchLike }).fetch;
  if (fetchImpl === undefined) return null;
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), CSS_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers,
      signal: controller?.signal,
    });
    return { status: response.status, text: await response.text() };
  } catch {
    // Offline, timeout or blocked: the caller falls back to Inter and logs.
    return null;
  } finally {
    clearTimeout(timer);
  }
};

// ---------------------------------------------------------------------------
// Native URL cache: lets a later offline launch register from expo-asset's
// on-disk copy (keyed by URL). Capped at 50 families, least recently used out.
const CACHE_KEY = "mingla.gfonts.v1";
const CACHE_LIMIT = 50;
type UrlCache = Record<string, { b: string; B: string; t: number }>;

type AsyncStorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

let storageOverride: AsyncStorageLike | null = null;
/** Test seam. */
export const __setGoogleFontStorageForTests = (
  storage: AsyncStorageLike | null,
): void => {
  storageOverride = storage;
};

const getStorage = async (): Promise<AsyncStorageLike | null> => {
  if (storageOverride !== null) return storageOverride;
  if (Platform.OS === "web") return null;
  try {
    const mod = await import("@react-native-async-storage/async-storage");
    return (mod.default ?? mod) as unknown as AsyncStorageLike;
  } catch {
    return null;
  }
};

const readCache = async (): Promise<UrlCache> => {
  const storage = await getStorage();
  if (storage === null) return {};
  try {
    const raw = await storage.getItem(CACHE_KEY);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as UrlCache)
      : {};
  } catch {
    return {};
  }
};

const writeCache = async (cache: UrlCache): Promise<void> => {
  const storage = await getStorage();
  if (storage === null) return;
  const trimmed = Object.entries(cache)
    .sort((a, b) => b[1].t - a[1].t)
    .slice(0, CACHE_LIMIT);
  try {
    await storage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch (error) {
    console.warn("[theme-font] url cache write failed", error);
  }
};

// ---------------------------------------------------------------------------
const inFlight = new Map<string, Promise<EnsureGoogleFontResult>>();
const settled = new Map<string, EnsureGoogleFontResult>();

/** True once a family's keys are registered (real face or Inter). */
export const isGoogleFontSettled = (family: string): boolean =>
  settled.has(family);

/** The outcome for a family, or null while it is still loading. */
export const googleFontOutcome = (
  family: string,
): EnsureGoogleFontResult | null => settled.get(family) ?? null;

/** Test seam. */
export const __resetGoogleFontLoaderForTests = (): void => {
  inFlight.clear();
  settled.clear();
  previewInFlight.clear();
  previewDone.clear();
  previewCount = 0;
};

const registerFallback = async (
  family: string,
  options: EnsureGoogleFontOptions,
): Promise<EnsureGoogleFontResult> => {
  const base = googleFontKey(family, 500);
  const bold = googleFontKey(family, 700);
  console.warn("[theme-font] fallback", family);
  try {
    const modules = await options.loadFallback();
    const map: Record<string, FontModuleSource> = {};
    if (!Font.isLoaded(base)) map[base] = modules.base;
    if (!Font.isLoaded(bold)) map[bold] = modules.bold;
    if (Object.keys(map).length > 0) await Font.loadAsync(map);
    return { loaded: true, fellBack: true };
  } catch (error) {
    console.warn("[theme-font] inter fallback failed", family, error);
    return { loaded: false, fellBack: true };
  }
};

const loadNative = async (family: string): Promise<boolean> => {
  const base = googleFontKey(family, 500);
  const bold = googleFontKey(family, 700);
  const cache = await readCache();
  const cached = cache[family];
  if (cached !== undefined) {
    try {
      await Font.loadAsync({ [base]: cached.b, [bold]: cached.B });
      cache[family] = { ...cached, t: Date.now() };
      void writeCache(cache);
      return true;
    } catch {
      // Google moved the file: forget it and resolve again below.
      delete cache[family];
    }
  }
  const faces = await resolveGoogleFaces(
    family,
    (url) => fetchWithTimeout(url, NATIVE_CSS_HEADERS),
    GF_CSS_ORIGIN,
  );
  if (faces === null) return false;
  const baseUrl = firstUrl(faces.base);
  const boldUrl = firstUrl(faces.bold) ?? baseUrl;
  if (baseUrl === null || boldUrl === null) return false;
  await Font.loadAsync({ [base]: baseUrl, [bold]: boldUrl });
  cache[family] = { b: baseUrl, B: boldUrl, t: Date.now() };
  void writeCache(cache);
  return true;
};

const withCap = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });

const loadWeb = async (family: string): Promise<boolean> => {
  if (typeof document === "undefined") return false;
  const faces = await resolveGoogleFaces(
    family,
    (url) => fetchWithTimeout(url, undefined),
    GF_CSS_ORIGIN,
  );
  if (faces === null) return false;
  const base = googleFontKey(family, 500);
  const bold = googleFontKey(family, 700);
  const style = document.createElement("style");
  style.setAttribute("data-mingla-gfont", family);
  style.textContent = `${rewriteBlocksForWeb(faces.base, base, GF_FILE_ORIGIN)}\n${rewriteBlocksForWeb(faces.bold, bold, GF_FILE_ORIGIN)}`;
  document.head.appendChild(style);
  const fonts = (document as { fonts?: { load: (f: string) => Promise<unknown[]> } }).fonts;
  if (fonts === undefined) return true;
  const result = await withCap(
    Promise.all([fonts.load(`1em "${base}"`), fonts.load(`1em "${bold}"`)]),
    WEB_LOAD_CAP_MS,
  );
  if (result === null || result[0].length === 0) {
    // Too slow or nothing matched: drop it so the page never swaps face
    // mid-session, and let Inter take the keys.
    style.remove();
    return false;
  }
  return true;
};

/**
 * Registers a Google family under its `GF_<family>_500/_700` keys, or Inter
 * under the same keys when it cannot. Deduped per family; a family that fell
 * back is not retried in the same session.
 */
export const ensureGoogleFont = (
  family: string,
  options: EnsureGoogleFontOptions,
): Promise<EnsureGoogleFontResult> => {
  const done = settled.get(family);
  if (done !== undefined) return Promise.resolve(done);
  const existing = inFlight.get(family);
  if (existing !== undefined) return existing;
  const promise = (async (): Promise<EnsureGoogleFontResult> => {
    let ok = false;
    // Never build a URL from an unvalidated value.
    if (isGoogleFontFamily(family)) {
      try {
        ok = Platform.OS === "web" ? await loadWeb(family) : await loadNative(family);
      } catch (error) {
        console.warn("[theme-font] load failed", family, error);
        ok = false;
      }
    }
    const result = ok
      ? { loaded: true, fellBack: false }
      : await registerFallback(family, options);
    settled.set(family, result);
    inFlight.delete(family);
    return result;
  })();
  inFlight.set(family, promise);
  return promise;
};

// ---------------------------------------------------------------------------
// Picker previews: a tiny subset (`&text=<family name>`) registered under
// `GFP_<family>`. At most 4 in flight and 150 per session; past the cap a row
// keeps the system font. Previews never use the URL cache.
export const PREVIEW_MAX_IN_FLIGHT = 4;
export const PREVIEW_SESSION_CAP = 150;
const previewInFlight = new Set<string>();
const previewDone = new Set<string>();
let previewCount = 0;

export const googlePreviewKey = (family: string): string =>
  `GFP_${family.replace(/ /g, "_")}`;

export const isGooglePreviewReady = (family: string): boolean =>
  previewDone.has(family);

/** Number of preview requests currently in flight (picker test seam). */
export const googlePreviewsInFlight = (): number => previewInFlight.size;

/**
 * Loads a family's preview face. Resolves true when the `GFP_` key is
 * registered, false when skipped (cap, busy) or failed. Never throws.
 */
export const ensureGooglePreviewFace = async (family: string): Promise<boolean> => {
  if (previewDone.has(family)) return true;
  if (!isGoogleFontFamily(family)) return false;
  if (previewInFlight.has(family)) return false;
  if (previewInFlight.size >= PREVIEW_MAX_IN_FLIGHT) return false;
  if (previewCount >= PREVIEW_SESSION_CAP) return false;
  previewInFlight.add(family);
  previewCount += 1;
  const key = googlePreviewKey(family);
  try {
    const isWeb = Platform.OS === "web";
    const response = await fetchWithTimeout(
      googleCssUrl(GF_CSS_ORIGIN, family, undefined, family),
      isWeb ? undefined : NATIVE_CSS_HEADERS,
    );
    if (response === null || response.status !== 200) return false;
    const blocks = parseFontFaceBlocks(response.text);
    if (blocks.length === 0) return false;
    if (isWeb) {
      if (typeof document === "undefined") return false;
      const style = document.createElement("style");
      style.setAttribute("data-mingla-gfont-preview", family);
      style.textContent = rewriteBlocksForWeb(blocks, key, GF_FILE_ORIGIN);
      document.head.appendChild(style);
    } else {
      const url = blocks[0].url;
      if (url === null) return false;
      // The subset URL has no file extension; iOS and Android register the
      // downloaded bytes regardless (runtime proof N-4). On failure the row
      // keeps the system font.
      await Font.loadAsync({ [key]: url });
    }
    previewDone.add(family);
    return true;
  } catch {
    // A preview face is decoration: the row keeps the system font.
    return false;
  } finally {
    previewInFlight.delete(family);
  }
};
