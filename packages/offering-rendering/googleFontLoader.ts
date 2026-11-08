// issue #1023 wave 2 — loads a host's chosen Google Fonts family on demand.
//
// A theme font that is not one of the 14 bundled slugs resolves to the keys
// `GF_<Family_With_Underscores>_500` and `_700` (themeResolver.googleFontKey).
// Every render site already uses `theme.fontFamilyValue` /
// `boldFontFamily(theme)`, so this loader only has to make sure something real
// is registered under those two keys:
//
//   - each key loads on its own, only when a surface asks for it (a page that
//     never draws bold text never downloads the bold face);
//   - the base key is the family's 500 face (else its default face); the bold
//     key is the nearest heavy face: 700, then 800, 600, 900, else the base
//     face. React Native never picks a heavier face from `fontWeight` for a
//     custom family, so heavy text must name the bold key (boldFontFamily);
//   - or, when anything fails (offline with no cache, a family Google no
//     longer serves, a timeout), Inter (500 / 700) registered under that key.
//
// I-1023-FONT-FALLS-BACK-TO-INTER: never leave a referenced key unregistered.
// On native an unregistered family silently draws the system face; Inter is
// the Mingla default, so a failure looks like "no custom font", not "broken".
//
// I-1023-ONLY-CHOSEN-FONT-DOWNLOADS: a page downloads one family's base and,
// only if it draws bold text, its bold face. The 14 legacy slugs never reach this module (they stay bundled).
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

import { familyFromGoogleFontKey, isGoogleFontFamily } from "./themeResolver";

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

const PROXY = "/gfonts";
// D-1 (privacy): a production web build talks to the same-origin proxy only,
// so it must not even CONTAIN a Google font origin. The direct origins exist
// only where a build can use them: native, and the local web dev server (no
// rewrite there). Metro inlines Platform.OS and __DEV__, so for production
// web this folds to the proxy and the minifier drops both Google strings.
const DIRECT_GOOGLE =
  Platform.OS !== "web" || (typeof __DEV__ !== "undefined" && __DEV__ === true);
const GOOGLE_CSS = DIRECT_GOOGLE ? "https://fonts.googleapis.com" : PROXY;
const GOOGLE_FILES = DIRECT_GOOGLE ? "https://fonts.gstatic.com" : PROXY;

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
        // Re-host every font file URL on `fileOrigin`. Any absolute origin is
        // replaced (the CSS only ever comes from Google or its proxy), so the
        // production web path needs no Google origin string to do it.
        .replace(/url\((['"]?)https:\/\/[^/'")\s]+\//g, `url($1${fileOrigin}/`)
        .replace(/font-family:\s*[^;]+;/, `font-family: '${key}';`)
        .replace(/font-weight:\s*\d+;/, "font-weight: 100 900;"),
    )
    .join("\n");

/** Which of a family's two keys: `_500` (base) or `_700` (bold). */
export type GoogleFace = "base" | "bold";

/** Nearest-weight order for the bold key when a family has no 700. */
export const BOLD_WEIGHT_ORDER = [700, 800, 600, 900] as const;

/** The face a `GF_<family>_<weight>` key names: `_700` is bold, else base. */
export const googleFaceOfKey = (key: string): GoogleFace =>
  key.endsWith("_700") ? "bold" : "base";

/**
 * Resolves ONE face with small css2 requests. Google answers HTTP 400 for a
 * weight the family lacks, so weights are snapped. Base: 500, else the
 * family's default face. Bold: 700, 800, 600, 900 in that order, else the
 * base face. Returns null when nothing usable came back (network failure).
 */
export const resolveGoogleFace = async (
  family: string,
  face: GoogleFace,
  fetchCss: (url: string) => Promise<{ status: number; text: string } | null>,
  origin: string,
): Promise<FontFaceBlock[] | null> => {
  const single = async (weights?: number[]): Promise<FontFaceBlock[] | null> => {
    const response = await fetchCss(googleCssUrl(origin, family, weights));
    if (response === null || (response.status !== 200 && response.status !== 400)) return null;
    return response.status === 200 ? parseFontFaceBlocks(response.text) : [];
  };
  if (face === "bold") {
    for (const weight of BOLD_WEIGHT_ORDER) {
      const blocks = await single([weight]);
      if (blocks === null) return null;
      if (blocks.length > 0) return blocks;
    }
  }
  const base = await single([500]);
  if (base === null) return null;
  if (base.length > 0) return base;
  const fallback = await single();
  return fallback !== null && fallback.length > 0 ? fallback : null;
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
// v2 is keyed by font key (one face per entry), so a bold face is cached only
// once it has been used.
const CACHE_KEY = "mingla.gfonts.v2";
const CACHE_LIMIT = 100;
type UrlCache = Record<string, { u: string; t: number }>;

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

/** True once a font key is registered (real face or Inter). */
export const isGoogleFontKeySettled = (key: string): boolean => settled.has(key);

/** The outcome for a font key, or null while it is still loading. */
export const googleFontOutcome = (key: string): EnsureGoogleFontResult | null =>
  settled.get(key) ?? null;

/** Test seam. */
export const __resetGoogleFontLoaderForTests = (): void => {
  inFlight.clear();
  settled.clear();
  previewInFlight.clear();
  previewDone.clear();
  previewCount = 0;
};

const registerFallback = async (
  key: string,
  options: EnsureGoogleFontOptions,
): Promise<EnsureGoogleFontResult> => {
  console.warn("[theme-font] fallback", key);
  try {
    const modules = await options.loadFallback();
    if (!Font.isLoaded(key)) {
      await Font.loadAsync({
        [key]: googleFaceOfKey(key) === "bold" ? modules.bold : modules.base,
      });
    }
    return { loaded: true, fellBack: true };
  } catch (error) {
    console.warn("[theme-font] inter fallback failed", key, error);
    return { loaded: false, fellBack: true };
  }
};

const loadNative = async (key: string, family: string): Promise<boolean> => {
  const cache = await readCache();
  const cached = cache[key];
  if (cached !== undefined) {
    try {
      await Font.loadAsync({ [key]: cached.u });
      cache[key] = { ...cached, t: Date.now() };
      void writeCache(cache);
      return true;
    } catch {
      // Google moved the file: forget it and resolve again below.
      delete cache[key];
    }
  }
  const blocks = await resolveGoogleFace(
    family,
    googleFaceOfKey(key),
    (url) => fetchWithTimeout(url, NATIVE_CSS_HEADERS),
    GF_CSS_ORIGIN,
  );
  const url = blocks === null ? null : firstUrl(blocks);
  if (url === null) return false;
  await Font.loadAsync({ [key]: url });
  cache[key] = { u: url, t: Date.now() };
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

const loadWeb = async (key: string, family: string): Promise<boolean> => {
  if (typeof document === "undefined") return false;
  const blocks = await resolveGoogleFace(
    family,
    googleFaceOfKey(key),
    (url) => fetchWithTimeout(url, undefined),
    GF_CSS_ORIGIN,
  );
  if (blocks === null) return false;
  const style = document.createElement("style");
  style.setAttribute("data-mingla-gfont", key);
  style.textContent = rewriteBlocksForWeb(blocks, key, GF_FILE_ORIGIN);
  document.head.appendChild(style);
  const fonts = (document as { fonts?: { load: (f: string) => Promise<unknown[]> } }).fonts;
  if (fonts === undefined) return true;
  const result = await withCap(fonts.load(`1em "${key}"`), WEB_LOAD_CAP_MS);
  if (result === null || result.length === 0) {
    // Too slow or nothing matched: drop it so the page never swaps face
    // mid-session, and let Inter take the key.
    style.remove();
    return false;
  }
  return true;
};

/**
 * Registers ONE Google font key (`GF_<family>_500` or `_700`): the family's
 * face for it, or Inter under the same key when it cannot. Deduped per key; a
 * key that fell back is not retried in the same session.
 */
export const ensureGoogleFontKey = (
  key: string,
  options: EnsureGoogleFontOptions,
): Promise<EnsureGoogleFontResult> => {
  const done = settled.get(key);
  if (done !== undefined) return Promise.resolve(done);
  const existing = inFlight.get(key);
  if (existing !== undefined) return existing;
  const promise = (async (): Promise<EnsureGoogleFontResult> => {
    let ok = false;
    const family = familyFromGoogleFontKey(key);
    // Never build a URL from an unvalidated value.
    if (family !== null && key.startsWith("GF_")) {
      try {
        ok = Platform.OS === "web" ? await loadWeb(key, family) : await loadNative(key, family);
      } catch (error) {
        console.warn("[theme-font] load failed", key, error);
        ok = false;
      }
    }
    const result = ok
      ? { loaded: true, fellBack: false }
      : await registerFallback(key, options);
    settled.set(key, result);
    inFlight.delete(key);
    return result;
  })();
  inFlight.set(key, promise);
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
