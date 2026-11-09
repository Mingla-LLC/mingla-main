// MINGLA-INVARIANT: I-1023-ANDROID-THEME-FONT-FACE | issue #1023 | Text in a theme font key goes through themeFontFace, which adds fontWeight "normal" on Android (expo-font registers the NORMAL style only; a weight >= 700 falls back to Roboto).
// MINGLA-INVARIANT: I-1023-MOTION-IN-EVERY-LIFECYCLE-STATE | issue #1023 | Public event, RSVP, experience and trip pages (web, business app, Explorer) pass the resolved theme to the motion; no closed-state override sets animation to "none" (Seth, 7 Nov; lifts #1902's suppression).
// MINGLA-INVARIANT: I-1023-GRADIENT-EVERYWHERE | issue #1023 | On every public surface the theme accent is drawn through the gradient-aware helpers (fills, borders, icons, buttons); a raw accent colour is allowed only for accent text or an allowlisted exception with a reason.
/**
 * issue #1023 (Seth: "every single element should follow the gradient if a
 * gradient is chosen"; text stays the first colour).
 *
 * 1. The shared helpers, executed: solid themes draw exactly as before;
 *    gradient themes draw the gradient, per element type and platform.
 * 2. Coverage: every public-surface source that draws `palette.accent` as a
 *    colour goes through the helpers, unless it is accent TEXT or an
 *    allowlisted exception (each with its reason).
 *
 * Fails on revert: a fill written back as `backgroundColor: palette.accent`,
 * a border as `borderColor: palette.accent`, an icon as
 * `color={palette.accent}` on an SVG icon, or a helper that ignores the
 * gradient.
 */
import { readdir, readFile } from "fs/promises";
import path from "path";
import { describe, expect, jest, test } from "@jest/globals";

type Helpers = typeof import("../../../../../packages/offering-rendering/themeAccentStyle");
type Palette = import("../../../../../packages/offering-rendering/themePalette").ThemePalette;
type Loaded = Helpers & { SOLID: Palette; SUNSET: Palette };

// Each platform gets its own module registry, so the palettes are made by the
// same themePalette module instance the helpers read their gradient from.
const loadHelpers = async (os: "web" | "ios" | "android"): Promise<Loaded> => {
  let loaded: Loaded | undefined;
  jest.isolateModules(() => {
    jest.doMock("react-native", () => ({ Platform: { OS: os } }));
    /* eslint-disable @typescript-eslint/no-require-imports */
    const helpers = require("../../../../../packages/offering-rendering/themeAccentStyle") as Helpers;
    const { createThemePalette } = require("../../../../../packages/offering-rendering/themePalette") as typeof import("../../../../../packages/offering-rendering/themePalette");
    const { resolveTheme } = require("../../../../../packages/offering-rendering/themeResolver") as typeof import("../../../../../packages/offering-rendering/themeResolver");
    /* eslint-enable @typescript-eslint/no-require-imports */
    loaded = {
      ...helpers,
      SOLID: createThemePalette(resolveTheme({ color: "#ff8a3b" }, null)),
      SUNSET: createThemePalette(resolveTheme({ color: "#ff8a3b", color2: "#ff2e63" }, null)),
    };
  });
  jest.dontMock("react-native");
  return loaded as Loaded;
};

describe("helpers: solid draws as before, gradient draws the gradient", () => {
  test("fill", async () => {
    const web = await loadHelpers("web");
    const ios = await loadHelpers("ios");
    expect(web.accentFill(web.SOLID)).toEqual({ backgroundColor: web.SOLID.accent });
    const w = web.accentFill(web.SUNSET) as Record<string, string>;
    expect(w.backgroundColor).toBe(web.SUNSET.accent);
    expect(w.backgroundImage).toMatch(/^linear-gradient\(135deg, #[0-9a-f]{6} 0%, #[0-9a-f]{6} 100%\)$/);
    const n = ios.accentFill(ios.SUNSET) as Record<string, string>;
    expect(n.experimental_backgroundImage).toBe(w.backgroundImage);
    expect(n.backgroundImage).toBeUndefined();
  });

  test("fill with its own accent edge", async () => {
    const web = await loadHelpers("web");
    expect(web.accentFillWithBorder(web.SOLID)).toEqual({ backgroundColor: web.SOLID.accent, borderColor: web.SOLID.accent });
    expect(web.accentFillWithBorder(web.SUNSET)).toMatchObject({ borderColor: "transparent" });
    expect(web.accentEdgeOnFill(web.SOLID)).toBe(web.SOLID.accent);
    expect(web.accentEdgeOnFill(web.SUNSET)).toBe("transparent");
  });

  test("outline: gradient border on web, first colour on native, unchanged when solid", async () => {
    const web = await loadHelpers("web");
    const ios = await loadHelpers("ios");
    expect(web.accentOutline(web.SOLID, { opaqueBackground: "#000000" })).toEqual({ borderColor: web.SOLID.accent });
    const w = web.accentOutline(web.SUNSET, { background: "rgba(0,0,0,0.2)", opaqueBackground: "#101010" });
    expect(w).toMatchObject({ borderColor: "transparent", backgroundColor: "rgba(0,0,0,0.2)" });
    expect(w.backgroundImage).toContain("linear-gradient(#101010, #101010) padding-box");
    expect(w.backgroundImage).toContain("border-box");
    expect(ios.accentOutline(ios.SUNSET, { opaqueBackground: "#101010" })).toEqual({ borderColor: ios.SUNSET.accent });
  });

  test("icon: gradient stops only for a gradient theme", async () => {
    const web = await loadHelpers("web");
    expect(web.accentIcon(web.SOLID)).toEqual({ color: web.SOLID.accent });
    const icon = web.accentIcon(web.SUNSET);
    expect(icon.color).toBe(web.SUNSET.accent);
    expect(icon.gradient).toHaveLength(2);
    expect(web.accentIcon(web.SOLID).gradient).toBeUndefined();
  });

  test("a palette spread into a new object reads solid (never a wrong gradient)", async () => {
    const web = await loadHelpers("web");
    expect(web.accentFill({ ...web.SUNSET })).toEqual({ backgroundColor: web.SUNSET.accent });
  });
});

describe("theme font face: Android names the face without a bold weight", () => {
  test("Android adds fontWeight normal; iOS and web keep the stylesheet weight", async () => {
    const android = await loadHelpers("android");
    const ios = await loadHelpers("ios");
    const web = await loadHelpers("web");
    const key = "GF_Bricolage_Grotesque_700";
    expect(android.themeFontFace(key)).toEqual({ fontFamily: key, fontWeight: "normal" });
    expect(ios.themeFontFace(key)).toEqual({ fontFamily: key });
    expect(web.themeFontFace(key)).toEqual({ fontFamily: key });
  });
});

// ── coverage ────────────────────────────────────────────────────────────────
const REPO = path.resolve(__dirname, "../../../../..");
const ROOTS = [
  "packages/offering-rendering",
  "packages/brand-rendering",
  "mingla-business/app",
  "mingla-business/src/components",
  "app-mobile/src/components",
  "app-mobile/src/screens",
];

/** Allowed first-colour uses that are not text, each with its reason. */
const ALLOW: ReadonlyArray<{ re: RegExp; why: string }> = [
  { re: /shadowColor: palette\.accent/, why: "React Native shadows take one colour" },
  { re: /hexToRgba\(palette\.accent/, why: "translucent glow derived from the first colour" },
  { re: /accentHex: palette\.accent|\[palette\.accent, venue\.lat/, why: "static map image pin colour (image API takes one hex)" },
  { re: /borderFocused: palette\.accent|^\s*accent: palette\.accent,|actionColor=\{palette\.accent\}/, why: "phone-input focus and caret tokens (focus indication stays solid)" },
  { re: /outlineColor: palette\.accent/, why: "keyboard focus ring (stays solid for accessibility)" },
  { re: /ActivityIndicator color=/, why: "the native spinner takes one tint" },
  { re: /^\s*color=\{palette\.accent\}$/, why: "multi-line ActivityIndicator tint (one colour)" },
  { re: /^\s*palette\.accent,$/, why: "hook dependency list, not drawing" },
  { re: /tintColor=\{palette\.accent\}/, why: "image tint takes one colour" },
  { re: /accent=\{palette\.accent\}/, why: "Stripe payment element appearance takes one colour" },
  { re: /borderBottomColor: palette\.accent|borderLeftColor: palette\.accent/, why: "one-sided rule; a gradient border needs all four sides" },
  { re: /accentColor=\{palette\.accent\}/, why: "first colour for labels; the fill comes from accentGradient / selectedFill on the same element" },
  { re: /backgroundColor=\{palette\.accent\}/, why: "fallback prop; fillStyle={accentFill(palette)} on the same element wins" },
  { re: /^\s*borderColor: palette\.accent,$/, why: "brand avatar ring in the SOLID branch only; a gradient theme draws the ring with ThemeAccentFill" },
  { re: /const followFill = palette\.accent|contrastRatio\(palette\.accent|\? palette\.accent$/, why: "colour tokens / contrast maths, not drawing (the follow fill is painted with the gradient layer)" },
  { re: /const accentFill = flatten\(palette\.accent, surface\)/, why: "#4347 venue When block: the accent flattened to one opaque colour for its 3:1 contrast check; a dark accent falls back to the text colour (a gradient cannot be contrast-checked)" },
];

const SKIP_FILES = /themePalette\.ts$|themeAccentStyle\.ts$|ThemeAccentFill\.tsx$|LucideIcons\.tsx$|types\.ts$|themeColorModel\.ts$|themedPreviewCardColors\.ts$/;

const walk = async (rel: string): Promise<string[]> => {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(path.join(REPO, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === "__tests__") continue;
    const child = path.posix.join(rel, e.name);
    if (e.isDirectory()) out.push(...(await walk(child)));
    else if (/\.(ts|tsx)$/.test(e.name) && !SKIP_FILES.test(e.name)) out.push(child);
  }
  return out;
};

const isText = (lines: string[], i: number): boolean => {
  const line = lines[i];
  if (/\bcolor: (?:[\w.!]+ \? [^:]+ : )?(?:props\.)?palette\.accent\b(?!Text|Wash)/.test(line)) return true;
  if (/\bcolor: [\w.!]+ \? (?:props\.)?palette\.accent :/.test(line)) return true;
  if (/\b(?:textColor|kickerColor|tint) = /.test(line)) return true;
  // multi-line `color:` conditional (`color:\n cond\n ? palette.accent`)
  return lines.slice(Math.max(0, i - 3), i).some((l) => /^\s*color:\s*$/.test(l));
};

describe("coverage: the accent is drawn through the gradient helpers", () => {
  test("no raw accent fill, border or SVG icon colour outside text and the allowlist", async () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const rel of await walk(root)) {
        const raw = await readFile(path.join(REPO, rel), "utf8");
        // Blank out block comments (JSX comments included), keeping lines.
        const src = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
        const lines = src.split("\n");
        lines.forEach((line, i) => {
          if (!/\b(?:props\.)?palette\.accent\b(?!Text|Wash)/.test(line)) return;
          if (/^\s*(\*|\/\/)/.test(line)) return;
          if (isText(lines, i)) return;
          if (ALLOW.some((a) => a.re.test(line))) return;
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  test("motion plays in every lifecycle state: nothing overrides the resolved animation to none", async () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const rel of await walk(root)) {
        if (/designTokens\.ts$/.test(rel)) continue; // the Mingla default theme
        const raw = await readFile(path.join(REPO, rel), "utf8");
        // Block comments (JSX ones included) blanked, keeping line numbers.
        const lines = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).split("\n");
        lines.forEach((line, i) => {
          if (/^\s*(\*|\/\/)/.test(line)) return;
          if (/animation: ?["']none["']|\.\.\.theme, animation:/.test(line)) {
            offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
    // The two #1902 closed-state shells hand the motion the real theme.
    for (const rel of [
      "mingla-business/src/components/event/FoundationEventPreview.tsx",
      "mingla-business/src/components/event/FoundationRsvpPreview.tsx",
    ]) {
      const src = await readFile(path.join(REPO, rel), "utf8");
      expect(src).not.toContain("shellTheme");
      expect(src).toMatch(/<ParallaxCoverShell[\s\S]{0,400}theme=\{theme\}/);
    }
  });

  test("no bold theme font is set as a raw fontFamily (Android would draw Roboto)", async () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const rel of await walk(root)) {
        const lines = (await readFile(path.join(REPO, rel), "utf8")).split("\n");
        lines.forEach((line, i) => {
          if (/^\s*(\*|\/\/)/.test(line)) return;
          if (/fontFamily: (?:boldFamily|bold|boldFontFamily\()/.test(line)) {
            offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
