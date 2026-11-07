// MINGLA-INVARIANT: I-1023-FONT-FALLS-BACK-TO-INTER | issue #1023 | A Google family that cannot load is registered as Inter under its own GF_ keys, never left unregistered (iOS would draw the system face).
// MINGLA-INVARIANT: I-1023-NO-GOOGLE-FROM-BUYER-BROWSER | issue #1023 | A production web build fetches font CSS and files from the same-origin /gfonts proxy only.
/**
 * issue #1023 wave 2 — P-3. The shared loader with fetch, expo-font and the
 * URL cache mocked at their boundaries; the CSS parsing, weight snapping,
 * dedupe, fallback and web rewrite are the real code.
 *
 * Fails on revert: removing the Inter registration on failure, the 400 →
 * single-weight snapping, the nearest-heavy-weight order (700, 800, 600, 900),
 * the bold-aliases-base rule, per-key loading (a base key downloading the bold
 * face), heavy brand text naming the bold key, or the same-origin web origins.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockPlatform = { OS: "ios" };
jest.mock("react-native", () => ({ Platform: mockPlatform }));

const mockFont = {
  loaded: new Map<string, unknown>(),
  calls: [] as Record<string, unknown>[],
};
jest.mock("expo-font", () => ({
  isLoaded: (key: string) => mockFont.loaded.has(key),
  loadAsync: async (map: Record<string, unknown>) => {
    mockFont.calls.push(map);
    for (const [k, v] of Object.entries(map)) mockFont.loaded.set(k, v);
  },
}));

// eslint-disable-next-line import/first
import {
  __resetGoogleFontLoaderForTests,
  __setGoogleFontStorageForTests,
  BOLD_WEIGHT_ORDER,
  ensureGoogleFontKey,
  ensureGooglePreviewFace,
  googleCssUrl,
  googlePreviewsInFlight,
  parseFontFaceBlocks,
  resolveGoogleFontOrigins,
  rewriteBlocksForWeb,
} from "../../../../../packages/offering-rendering/googleFontLoader";
// eslint-disable-next-line import/first
import { resolveTheme } from "../../../../../packages/offering-rendering/themeResolver";
// eslint-disable-next-line import/first
import { boldFontFamily } from "../../../../../packages/offering-rendering/themePalette";
// eslint-disable-next-line import/first
import { readFile } from "fs/promises";
// eslint-disable-next-line import/first
import path from "path";

const REPO = path.resolve(__dirname, "../../../../..");

const ttfCss = (family: string, weights: number[]): string =>
  weights
    .map(
      (w) =>
        `@font-face {\n  font-family: '${family}';\n  font-style: normal;\n  font-weight: ${w};\n  font-display: swap;\n  src: url(https://fonts.gstatic.com/s/x/v1/${family.replace(/ /g, "")}-${w}.ttf) format('truetype');\n}\n`,
    )
    .join("");

type Reply = { status: number; text: string } | "throw";
let replies: Record<string, Reply> = {};
let requested: string[] = [];
const fetchMock = async (url: string) => {
  requested.push(url);
  const key = Object.keys(replies).find((k) => url.includes(k));
  const reply = key === undefined ? { status: 400, text: "<html>" } : replies[key];
  if (reply === "throw") throw new Error("offline");
  return { ok: reply.status === 200, status: reply.status, text: async () => reply.text };
};

const storage = new Map<string, string>();
const fallback = {
  loadFallback: async () => ({ base: 101, bold: 102 }),
};
let warn: jest.SpiedFunction<typeof console.warn>;

beforeEach(() => {
  __resetGoogleFontLoaderForTests();
  mockFont.loaded.clear();
  mockFont.calls = [];
  replies = {};
  requested = [];
  storage.clear();
  __setGoogleFontStorageForTests({
    getItem: async (k) => storage.get(k) ?? null,
    setItem: async (k, v) => {
      storage.set(k, v);
    },
  });
  (globalThis as { fetch?: unknown }).fetch = fetchMock;
  warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

const BASE = (f: string): string => `GF_${f.replace(/ /g, "_")}_500`;
const BOLD = (f: string): string => `GF_${f.replace(/ /g, "_")}_700`;

describe("native: each key loads its own face, only when asked", () => {
  test("the base key registers the 500 TTF only (no bold download) and remembers the URL", async () => {
    replies = { "Roboto+Slab:wght@500&": { status: 200, text: ttfCss("Roboto Slab", [500]) } };
    const result = await ensureGoogleFontKey(BASE("Roboto Slab"), fallback);
    expect(result).toEqual({ loaded: true, fellBack: false });
    expect(mockFont.calls).toEqual([
      { GF_Roboto_Slab_500: "https://fonts.gstatic.com/s/x/v1/RobotoSlab-500.ttf" },
    ]);
    expect(requested).toEqual([
      "https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@500&display=swap",
    ]);
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(storage.get("mingla.gfonts.v2") ?? "{}")[BASE("Roboto Slab")].u).toContain(
      "RobotoSlab-500.ttf",
    );
  });

  test("the bold key registers the 700 TTF (Bricolage Grotesque on /b/jogular)", async () => {
    replies = {
      "Bricolage+Grotesque:wght@700&": { status: 200, text: ttfCss("Bricolage Grotesque", [700]) },
    };
    await ensureGoogleFontKey(BOLD("Bricolage Grotesque"), fallback);
    expect(mockFont.calls).toEqual([
      { GF_Bricolage_Grotesque_700: "https://fonts.gstatic.com/s/x/v1/BricolageGrotesque-700.ttf" },
    ]);
  });

  test("no 700: the bold key takes the nearest heavy face, 800 before 600", async () => {
    replies = {
      "Big+Shoulders:wght@700&": { status: 400, text: "<html>" },
      "Big+Shoulders:wght@800&": { status: 200, text: ttfCss("Big Shoulders", [800]) },
      "Big+Shoulders:wght@600&": { status: 200, text: ttfCss("Big Shoulders", [600]) },
    };
    await ensureGoogleFontKey(BOLD("Big Shoulders"), fallback);
    expect(mockFont.calls[0]).toEqual({
      GF_Big_Shoulders_700: "https://fonts.gstatic.com/s/x/v1/BigShoulders-800.ttf",
    });
    expect(requested.some((u) => u.includes("wght@600"))).toBe(false);
  });

  test("no 700 or 800: 600 is next", async () => {
    replies = {
      "Mulish:wght@600&": { status: 200, text: ttfCss("Mulish", [600]) },
    };
    await ensureGoogleFontKey(BOLD("Mulish"), fallback);
    expect(mockFont.calls[0]).toEqual({
      GF_Mulish_700: "https://fonts.gstatic.com/s/x/v1/Mulish-600.ttf",
    });
  });

  test("a single-weight family: the bold key reuses the base face", async () => {
    replies = {
      "Bebas+Neue:wght@500&": { status: 200, text: ttfCss("Bebas Neue", [500]) },
    };
    await ensureGoogleFontKey(BOLD("Bebas Neue"), fallback);
    expect(mockFont.calls[0]).toEqual({
      GF_Bebas_Neue_700: "https://fonts.gstatic.com/s/x/v1/BebasNeue-500.ttf",
    });
  });

  test("no 500 either: the family's default face (nearest weight)", async () => {
    replies = { "family=Anton&display": { status: 200, text: ttfCss("Anton", [400]) } };
    await ensureGoogleFontKey(BASE("Anton"), fallback);
    expect(mockFont.calls[0]).toEqual({ GF_Anton_500: "https://fonts.gstatic.com/s/x/v1/Anton-400.ttf" });
  });

  test("total failure registers Inter under that key (bold gets Inter 700), warns once, never retries", async () => {
    replies = { "Zzzz+Nope": "throw" };
    expect(await ensureGoogleFontKey(BASE("Zzzz Nope"), fallback)).toEqual({ loaded: true, fellBack: true });
    expect(await ensureGoogleFontKey(BOLD("Zzzz Nope"), fallback)).toEqual({ loaded: true, fellBack: true });
    expect(mockFont.calls).toEqual([{ GF_Zzzz_Nope_500: 101 }, { GF_Zzzz_Nope_700: 102 }]);
    expect(warn.mock.calls.filter((c) => c[0] === "[theme-font] fallback")).toHaveLength(2);
    const before = requested.length;
    await ensureGoogleFontKey(BOLD("Zzzz Nope"), fallback);
    expect(requested.length).toBe(before);
  });

  test("an unvalidated name never builds a URL: straight to Inter", async () => {
    await ensureGoogleFontKey("GF_Inter';}body{display:none}_700", fallback);
    expect(requested).toEqual([]);
    expect(Object.values(mockFont.calls[0])).toEqual([102]);
  });

  test("concurrent requests for one key share one load", async () => {
    replies = { "Lexend:wght@500&": { status: 200, text: ttfCss("Lexend", [500]) } };
    await Promise.all([
      ensureGoogleFontKey(BASE("Lexend"), fallback),
      ensureGoogleFontKey(BASE("Lexend"), fallback),
    ]);
    expect(requested).toHaveLength(1);
    expect(mockFont.calls).toHaveLength(1);
  });

  test("offline later: a remembered URL registers from the disk cache with no request", async () => {
    storage.set(
      "mingla.gfonts.v2",
      JSON.stringify({ GF_Sora_700: { u: "https://fonts.gstatic.com/s/sora-700.ttf", t: 1 } }),
    );
    replies = { Sora: "throw" };
    const result = await ensureGoogleFontKey(BOLD("Sora"), fallback);
    expect(result.fellBack).toBe(false);
    expect(requested).toEqual([]);
    expect(mockFont.calls[0]).toEqual({ GF_Sora_700: "https://fonts.gstatic.com/s/sora-700.ttf" });
  });

  test("the nearest-weight order is 700, 800, 600, 900", () => {
    expect(BOLD_WEIGHT_ORDER).toEqual([700, 800, 600, 900]);
  });
});

describe("heavy text names the bold key (native never derives bold from fontWeight)", () => {
  test("a Google family resolves its bold family to the _700 key, a legacy slug to its bold face", () => {
    const jogular = resolveTheme({ font: "Bricolage Grotesque" }, null);
    expect(jogular.fontFamilyValue).toBe("GF_Bricolage_Grotesque_500");
    expect(boldFontFamily(jogular)).toBe("GF_Bricolage_Grotesque_700");
    expect(boldFontFamily(resolveTheme({ font: "inter" }, null))).toBe("Inter_700Bold");
  });

  test("the brand page draws its name and headings in the bold face and loads it", async () => {
    const read = (rel: string) => readFile(path.join(REPO, rel), "utf8");
    const page = await read("packages/brand-rendering/PublicBrandPage.tsx");
    expect(page).toContain("styles.brandName, themedBoldFont");
    expect(page).toContain("styles.deskBrandName,\n                themedBoldFont");
    expect(page).not.toContain("{ fontFamily: theme.fontFamilyValue");
    const host = await read("mingla-business/src/components/brand/PublicBrandPage.tsx");
    expect(host).toContain("useThemeFont(boldFontFamily(theme))");
    const explorer = await read("app-mobile/src/screens/ConsumerBrandProfileScreen.tsx");
    expect(explorer).toContain("useConsumerThemeFont(resolvedTheme === null ? null : boldFontFamily(resolvedTheme))");
  });
});

describe("web: same-origin proxy and the CSS rewrite", () => {
  test("production web uses /gfonts; native and the local dev server use Google", () => {
    expect(resolveGoogleFontOrigins("web", false)).toEqual({ css: "/gfonts", file: "/gfonts" });
    expect(resolveGoogleFontOrigins("ios", false).css).toBe("https://fonts.googleapis.com");
    expect(resolveGoogleFontOrigins("android", false).file).toBe("https://fonts.gstatic.com");
    expect(resolveGoogleFontOrigins("web", true).css).toBe("https://fonts.googleapis.com");
    expect(googleCssUrl("/gfonts", "Roboto Slab", [500, 700])).toBe(
      "/gfonts/css2?family=Roboto+Slab:wght@500;700&display=swap",
    );
  });

  test("blocks are renamed to the key, weight-ranged, re-hosted, and keep every unicode-range", () => {
    const css = [
      "/* latin-ext */\n@font-face {\n  font-family: 'Roboto Slab';\n  font-style: normal;\n  font-weight: 500;\n  src: url(https://fonts.gstatic.com/s/robotoslab/v1/a.woff2) format('woff2');\n  unicode-range: U+0100-02BA, U+1E00-1E9F;\n}",
      "/* latin */\n@font-face {\n  font-family: 'Roboto Slab';\n  font-style: normal;\n  font-weight: 500;\n  src: url(https://fonts.gstatic.com/s/robotoslab/v1/b.woff2) format('woff2');\n  unicode-range: U+0000-00FF;\n}",
    ].join("\n");
    const out = rewriteBlocksForWeb(parseFontFaceBlocks(css), "GF_Roboto_Slab_500", "/gfonts");
    expect(out).not.toContain("fonts.gstatic.com");
    expect(out).toContain("url(/gfonts/s/robotoslab/v1/a.woff2)");
    expect(out.match(/font-family: 'GF_Roboto_Slab_500';/g)).toHaveLength(2);
    expect(out.match(/font-weight: 100 900;/g)).toHaveLength(2);
    expect(out).toContain("unicode-range: U+0100-02BA, U+1E00-1E9F;");
    expect(out).toContain("unicode-range: U+0000-00FF;");
  });
});

describe("picker previews", () => {
  test("at most four previews in flight", async () => {
    const pending: Array<() => void> = [];
    (globalThis as { fetch?: unknown }).fetch = (url: string) =>
      new Promise((resolve) => {
        requested.push(url);
        pending.push(() =>
          resolve({ ok: true, status: 200, text: async () => ttfCss("X", [400]) }),
        );
      });
    const families = ["Roboto", "Lato", "Oswald", "Raleway", "Nunito", "Rubik"];
    const results = families.map((f) => ensureGooglePreviewFace(f));
    expect(googlePreviewsInFlight()).toBe(4);
    expect(requested).toHaveLength(4);
    expect(requested[0]).toContain("&text=Roboto");
    pending.forEach((go) => go());
    const done = await Promise.all(results);
    expect(done.filter(Boolean)).toHaveLength(4);
  });
});
