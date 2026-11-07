// issue #1023 — the generated motion files and the pure rules around them:
// every slug has an entrance and a loop, every loop is seamless, brand tinting
// rewrites the named slots, the text-safe zone math, and the dev-only preview
// override is inert outside dev builds.
import { readFileSync, readdirSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

import {
  SERVER_ACCEPTED_ANIMATION_SLUGS,
  THEME_ANIMATION_CATALOG,
  THEME_ANIMATION_SLUGS,
} from "../../../../../packages/offering-rendering/designTokens";
import {
  computeFollowBands,
  computeSafeZoneBands,
  zoneFromRects,
  getThemeMotionDevOverride,
  parseMotionQueryParam,
  resolveTextSafeZone,
  resolveThemeMotionSlug,
  setThemeMotionDevOverride,
} from "../../../../../packages/offering-rendering/themeMotion";
import { isThemeAnimationSlug } from "../../../../../packages/offering-rendering/themeResolver";
import { THEME_LOTTIE_LOADERS } from "../../../../../packages/theme-animations/loaders";
import { buildThemeMotionPalette, tintLottie } from "../../../../../packages/theme-animations/tint";

const LOTTIE_DIR = path.join(__dirname, "../../../../../packages/theme-animations/lottie");
type Json = Record<string, unknown>;
const readJson = (file: string): Json => JSON.parse(readFileSync(path.join(LOTTIE_DIR, file), "utf8")) as Json;
const ANIMATED = THEME_ANIMATION_SLUGS.filter((s) => s !== "none");

describe("#1023 — 29 slugs, each with an entrance and a loop", () => {
  test("the 9 original slugs keep their names and 20 are added", () => {
    expect(ANIMATED).toHaveLength(29);
    for (const legacy of [
      "confetti",
      "fireworks",
      "balloons",
      "sparkles",
      "glitter_shower",
      "snowfall",
      "falling_petals",
      "hearts",
      "shimmer_reveal",
    ]) {
      expect(ANIMATED).toContain(legacy);
      expect(isThemeAnimationSlug(legacy)).toBe(true);
    }
    expect(isThemeAnimationSlug("love_balloons")).toBe(true);
    expect(isThemeAnimationSlug("not_a_motion")).toBe(false);
    expect(Object.keys(THEME_ANIMATION_CATALOG).sort()).toEqual([...ANIMATED].sort());
    expect(THEME_ANIMATION_CATALOG.shimmer_reveal.name).toBe("Shimmer sweep");
  });

  test("every slug has <slug>.intro.json and <slug>.loop.json, and a loader for each", () => {
    const files = new Set(readdirSync(LOTTIE_DIR));
    for (const slug of ANIMATED) {
      expect(files.has(`${slug}.intro.json`)).toBe(true);
      expect(files.has(`${slug}.loop.json`)).toBe(true);
      expect(typeof THEME_LOTTIE_LOADERS[slug].intro).toBe("function");
      expect(typeof THEME_LOTTIE_LOADERS[slug].loop).toBe("function");
    }
    expect(files.size).toBe(ANIMATED.length * 2);
  });

  test("files stay small: 150 KB or less each", () => {
    for (const file of readdirSync(LOTTIE_DIR)) {
      expect(readFileSync(path.join(LOTTIE_DIR, file)).length).toBeLessThanOrEqual(150 * 1024);
    }
  });

  test("the entrance is ~2.6 s one-shot; the loop is 6 s (12 s for the slow beams) at 30 fps", () => {
    for (const slug of ANIMATED) {
      const intro = readJson(`${slug}.intro.json`);
      const loop = readJson(`${slug}.loop.json`);
      expect(intro.fr).toBe(30);
      expect(intro.op).toBe(78);
      expect(loop.fr).toBe(30);
      expect([180, 360]).toContain(loop.op);
    }
  });
});

type Layer = { ty: number; refId?: string; nm?: string; ip: number; op: number; st: number; ks: Json };

/** The animated state of every precomp instance alive at frame `t`. */
const instanceState = (json: Json, t: number): string[] =>
  (json.layers as Layer[])
    .filter((l) => l.ty === 0 && l.ip <= t && t < l.op)
    .map((l) => JSON.stringify([l.refId, l.ks, t - l.st]))
    .sort();

/** Every animated property of a full-length scene layer, at t=0 and t=op. */
const sceneEnds = (json: Json): Array<[unknown, unknown]> => {
  const out: Array<[unknown, unknown]> = [];
  const op = json.op as number;
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const obj = node as Json;
    if (obj.a === 1 && Array.isArray(obj.k)) {
      const keys = obj.k as Array<{ t: number; s: unknown }>;
      out.push([keys.find((k) => k.t === 0)?.s, keys.find((k) => k.t === op)?.s]);
      return;
    }
    for (const value of Object.values(obj)) walk(value);
  };
  for (const layer of json.layers as Layer[]) if (layer.ty === 4) walk(layer);
  return out;
};

describe("#1023 — every loop is seamless (the first frame's state equals the last)", () => {
  test.each(ANIMATED)("%s.loop.json", (slug) => {
    const loop = readJson(`${slug}.loop.json`);
    const op = loop.op as number;
    const atStart = instanceState(loop, 0);
    expect(instanceState(loop, op)).toEqual(atStart);
    for (const [first, last] of sceneEnds(loop)) {
      expect(first).toBeDefined();
      expect(last).toEqual(first);
    }
    // a loop that is empty at frame 0 would pop in after the crossfade
    const hasScene = (loop.layers as Layer[]).some((l) => l.ty === 4);
    expect(atStart.length > 0 || hasScene).toBe(true);
  });
});

describe("#1023 review — glows fade out and paint order matches the reference", () => {
  type Grad = { ty: string; nm?: string; t?: number; g?: { p: number; k: { k: number[] } } };
  const gradients = (json: unknown): Grad[] => {
    const out: Grad[] = [];
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== "object") return;
      const obj = node as Grad & Json;
      if (obj.ty === "gf" || obj.ty === "gs") out.push(obj);
      for (const value of Object.values(obj)) walk(value);
    };
    walk(json);
    return out;
  };
  const GLOW_SLUGS = [
    "sparkles", "disco_glints", "fireflies", "lanterns", "embers", "hearts", "love_burst", "love_balloons",
  ];

  test.each(GLOW_SLUGS)("every %s glow is radial and ends at alpha 0", (slug) => {
    for (const phase of ["intro", "loop"]) {
      const glows = gradients(readJson(`${slug}.${phase}.json`)).filter((g) => g.nm?.includes("~glow"));
      expect(glows.length).toBeGreaterThan(0);
      for (const g of glows) {
        expect(g.t).toBe(2);
        const stops = g.g!.p;
        const values = g.g!.k.k;
        const alphas = values.slice(stops * 4).filter((_, i) => i % 2 === 1);
        expect(alphas).toHaveLength(stops);
        expect(alphas[0]).toBeGreaterThan(0);
        expect(alphas[alphas.length - 1]).toBe(0);
      }
    }
  });

  test("Lottie paints the first shape on top, so a halo is listed AFTER its heart", () => {
    const hearts = readJson("hearts.loop.json");
    const look = (hearts.assets as Array<{ layers: Array<{ nm?: string; shapes?: Array<{ it: Grad[] }> }> }>)
      .flatMap((a) => a.layers)
      .find((l) => l.nm === "look");
    const order = (look?.shapes ?? []).map((g) => g.it.find((i) => i.ty === "fl" || i.ty === "gf")?.nm ?? "");
    const halo = order.findIndex((nm) => nm.includes("~glow"));
    const highlight = order.findIndex((nm) => nm === "fx");
    expect(highlight).toBe(0); // the white gloss is on top
    expect(halo).toBe(order.length - 1); // the halo is underneath everything
  });

  test("centrepiece looks fit inside wide heroes; particle fields cover", () => {
    expect((readJson("love_burst.loop.json").meta as Json).fit).toBe("contain");
    expect((readJson("neon_pulse.intro.json").meta as Json).fit).toBe("contain");
    expect((readJson("confetti.loop.json").meta as Json).fit).toBe("cover");
  });
});

describe("#1023 — brand tinting rewrites the named colour slots", () => {
  const solidOf = (json: unknown, slot: string): number[][] => {
    const found: number[][] = [];
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== "object") return;
      const obj = node as Json;
      if ((obj.ty === "fl" || obj.ty === "st") && obj.nm === slot) {
        found.push(((obj.c as Json).k as number[]).slice(0, 3));
      }
      for (const value of Object.values(obj)) walk(value);
    };
    walk(json);
    return found;
  };

  test("c0 follows the brand colour; fixed colours do not move", () => {
    const confetti = readJson("confetti.loop.json");
    const blue = buildThemeMotionPalette("#2563eb");
    const tinted = tintLottie(confetti, blue);
    const c0 = solidOf(tinted, "c0");
    expect(c0.length).toBeGreaterThan(0);
    const [r, g, b] = blue.slots.c0;
    for (const rgb of c0) {
      expect(rgb[0]).toBeCloseTo(r, 2);
      expect(rgb[1]).toBeCloseTo(g, 2);
      expect(rgb[2]).toBeCloseTo(b, 2);
    }
    // the reference palette: blue stays blue (hue ~221°), vivid saturation
    expect(b).toBeGreaterThan(r);
    // fixed love reds survive a tint
    const hearts = readJson("hearts.loop.json");
    const before = JSON.stringify(hearts).match(/"nm":"g\|fx/g)?.length ?? 0;
    const after = JSON.stringify(tintLottie(hearts, blue)).match(/"nm":"g\|fx/g)?.length ?? 0;
    expect(after).toBe(before);
  });

  test("gradient stops named for a slot are rewritten", () => {
    const balloons = readJson("balloons.loop.json");
    const green = buildThemeMotionPalette("#22c55e");
    const s = JSON.stringify(tintLottie(balloons, green));
    const d0 = green.slots.d0.map((v) => Math.round(v * 1000) / 1000);
    expect(s).toContain(`${d0[0]},${d0[1]},${d0[2]}`);
  });

  test("tinting never mutates the shared JSON and is memoised per palette", () => {
    const json = readJson("sparkles.loop.json");
    const snapshot = JSON.stringify(json);
    const palette = buildThemeMotionPalette("#ff0055");
    const a = tintLottie(json, palette);
    const b = tintLottie(json, buildThemeMotionPalette("#FF0055"));
    expect(a).toBe(b);
    expect(JSON.stringify(json)).toBe(snapshot);
    expect(a).not.toBe(json);
  });

  test("a muted brand is made vivid at runtime (77events' muted gold)", () => {
    const [r, g, b] = buildThemeMotionPalette("#846420").slots.c0;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const s = (max - min) / (1 - Math.abs(2 * l - 1));
    expect(s).toBeGreaterThanOrEqual(0.775);
    expect(l).toBeGreaterThanOrEqual(0.515);
    expect(l).toBeLessThanOrEqual(0.645);
  });

  test("the palette ports the reference viv(): saturation floor 78, lightness 52-64", () => {
    const grey = buildThemeMotionPalette("#777777");
    const [r, g, b] = grey.slots.c0;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    expect(max - min).toBeGreaterThan(0.5); // a flat grey becomes a vivid colour
    expect(buildThemeMotionPalette("not a colour").key).toBe("#eb7825");
    expect(buildThemeMotionPalette("#eb7825", "#7c5cff").key).toBe("#eb7825/#7c5cff");
  });
});

describe("#1023 — text-safe zone", () => {
  test("no zone when nothing is written on the animation", () => {
    expect(resolveTextSafeZone(undefined, 400, 500)).toBeNull();
    expect(computeSafeZoneBands(500, null, 0.14)).toEqual([{ top: 0, height: 500, opacity: 1 }]);
  });

  test("the default zone is the reference: from 47% down, 6% gutters", () => {
    const zone = resolveTextSafeZone("default", 400, 500);
    expect(zone).toEqual({ x: 24, y: 235, width: 352, height: 265 });
  });

  test("bands: full above, a 16 pt feather at the midpoint, faded inside", () => {
    const zone = resolveTextSafeZone({ x: 20, y: 300, width: 360, height: 200 }, 400, 500);
    expect(computeSafeZoneBands(500, zone, 0.5)).toEqual([
      { top: 0, height: 284, opacity: 1 },
      { top: 284, height: 16, opacity: 0.75 },
      { top: 300, height: 200, opacity: 0.5 },
    ]);
    const loopOpacities = computeSafeZoneBands(500, zone, 0.14).map((b) => b.opacity);
    expect(loopOpacities[0]).toBe(1);
    expect(loopOpacities[1]).toBeCloseTo(0.57, 5);
    expect(loopOpacities[2]).toBe(0.14);
  });
});

describe("#1023 — full-screen motion overlay on every public page", () => {
  const ROOT = path.join(__dirname, "../../../../..");
  const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

  test("z-order: cover < details < motion < chrome", () => {
    const shell = read("packages/offering-rendering/ParallaxCoverShell.tsx");
    const z = (name: string): number => {
      const m = new RegExp(`export const ${name} = ([^;]+);`).exec(shell);
      return Function("CHROME_Z", `return ${m![1]};`)(70) as number;
    };
    expect(z("COVER_Z")).toBeLessThan(z("CONTENT_Z"));
    expect(z("CONTENT_Z")).toBeLessThan(z("MOTION_Z"));
    expect(z("MOTION_Z")).toBeLessThan(z("CHROME_Z"));
    // desktop chrome lives in the hero at z 5
    expect(z("DESKTOP_MOTION_Z")).toBeLessThan(5);
    // the floating Buy / Reserve bars are rendered by the page, outside the
    // shell, but native view flattening compares them with the overlay directly
    expect(z("MOTION_Z")).toBeLessThan(z("FLOATING_CTA_MIN_Z"));
  });

  test.each([
    ["mingla-business/src/components/event/PublicEventPage.tsx", "floatWrap"],
    ["mingla-business/src/components/event/FoundationRsvpPreview.tsx", "floatWrap"],
    ["mingla-business/src/components/trip/TripReserveBar.tsx", "floatWrapper"],
    ["packages/offering-rendering/TripReserveBar.tsx", "floatWrapper"],
    ["packages/offering-rendering/TripReserveBar.tsx", "floatSplitWrapper"],
    ["app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx", "nativeFloatWrap"],
  ])("%s %s: the floating CTA paints above the motion layer", (file, style) => {
    const src = read(file);
    const block = src.slice(src.indexOf(`  ${style}: {`), src.indexOf("},", src.indexOf(`  ${style}: {`)));
    const barZ = Number(/zIndex: (\d+)/.exec(block)![1]);
    const shell = read("packages/offering-rendering/ParallaxCoverShell.tsx");
    const motionZ = Number(/export const MOTION_Z = (\d+);/.exec(shell)![1]);
    expect(barZ).toBeGreaterThan(motionZ);
    const consumer = read("app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx");
    const consumerMotionZ = Number(/motionOverlay: \{ \.\.\.StyleSheet\.absoluteFillObject, zIndex: (\d+) \}/.exec(consumer)![1]);
    expect(barZ).toBeGreaterThan(consumerMotionZ);
  });

  test("the shell mounts the overlay after the scrolling body in all three layouts, never inside the cover", () => {
    const shell = read("packages/offering-rendering/ParallaxCoverShell.tsx");
    const overlays = shell.match(/\{motionOverlay\(\{[^}]*\}\)\}/g) ?? [];
    expect(overlays).toEqual([
      "{motionOverlay({ ref: desktopTextRef })}",
      "{motionOverlay({ ref: bodyRef })}",
      "{motionOverlay({ top: sheetTop })}",
    ]);
    // each comes right after its </Scroll>
    for (const o of overlays) {
      const at = shell.indexOf(o);
      expect(shell.lastIndexOf("</Scroll>", at)).toBeGreaterThan(shell.lastIndexOf("<Scroll", at));
    }
    const overlayFn = shell.slice(shell.indexOf("const motionOverlay"), shell.indexOf("const motionPause"));
    expect(overlayFn).toContain('pointerEvents="none"');
    expect(overlayFn).toContain('importantForAccessibility="no-hide-descendants"');
    expect(overlayFn).toContain('pauseButton="none"');
    expect(shell).not.toContain("{entrance}");
  });

  test.each([
    "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
    "app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx",
    "app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx",
  ])("%s: overlay above the sheet scroll, below the chrome, following the sheet", (file) => {
    const src = read(file);
    const overlayAt = src.indexOf('testID="issue-1023-motion-overlay"');
    expect(overlayAt).toBeGreaterThan(src.indexOf("</BottomSheetScrollView>"));
    const block = src.slice(src.lastIndexOf("<View", overlayAt), src.indexOf("</View>", overlayAt));
    expect(block).toContain('pointerEvents="none"');
    expect(block).toContain("textZoneTop={motionSheetTop}");
    expect(src).toMatch(/motionOverlay: \{ \.\.\.StyleSheet\.absoluteFillObject, zIndex: 5 \}/);
    expect(src).toMatch(/motionPause: \{ position: "absolute", right: 12, zIndex: 70 \}/);
    expect(src).toMatch(/nativeChrome: \{[\s\S]*?zIndex: 70/);
    // the cover itself no longer hosts the motion layer
    const cover = src.slice(src.indexOf("style={styles.nativeCover}"), src.indexOf("<BottomSheetScrollView"));
    expect(cover).not.toContain("ThemeEntranceAnimation");
    // the edge is driven by the scroll offset
    expect(src).toContain("motionSheetTop.setValue(motionSpacerH.current - SEAM - motionScrollY.current)");
  });

  test("follow bands are offsets from one moving edge", () => {
    const bands = computeFollowBands(800, 0.14);
    expect(bands.map((b) => [b.from, b.height])).toEqual([[-800, 784], [-16, 16], [0, 800]]);
    expect(bands[0].opacity).toBe(1);
    expect(bands[1].opacity).toBeCloseTo(0.57, 5);
    expect(bands[2].opacity).toBe(0.14);
  });

  test("web zone = the page text's live rect, clamped to the screen", () => {
    const screen = { left: 0, top: 0, width: 375, height: 812 };
    expect(zoneFromRects({ left: 0, top: 470, right: 375, bottom: 3000 }, screen)).toEqual({ x: 0, y: 470, width: 375, height: 342 });
    expect(zoneFromRects({ left: 0, top: -2000, right: 375, bottom: -10 }, screen)).toBeNull();
  });

  test("white pieces carry a soft dark rim so they read on the light sheet", () => {
    for (const slug of ["snowfall", "sparkles", "glitter_shower", "starry_sky", "shimmer_reveal"]) {
      const text = JSON.stringify(readJson(`${slug}.loop.json`));
      expect(text).toContain('"ty":"st","nm":"fx","c":{"a":0,"k":[0,0,0,1]},"o":{"a":0,"k":22}');
    }
  });
});

describe("#1023 — the dev-only preview override is inert outside dev", () => {
  test("setting it in a production build does nothing", () => {
    setThemeMotionDevOverride(null, true);
    setThemeMotionDevOverride("aurora", false);
    expect(getThemeMotionDevOverride()).toBeNull();
  });

  test("an override set in dev is ignored when the build is not dev", () => {
    expect(resolveThemeMotionSlug("confetti", "aurora", false)).toBe("confetti");
    expect(resolveThemeMotionSlug("confetti", "aurora", true)).toBe("aurora");
    expect(resolveThemeMotionSlug("confetti", null, true)).toBe("confetti");
  });

  test("?motion= accepts only known slugs", () => {
    expect(parseMotionQueryParam("?motion=love_burst")).toBe("love_burst");
    expect(parseMotionQueryParam("?a=1&motion=aurora&b=2")).toBe("aurora");
    expect(parseMotionQueryParam("?motion=drop_table")).toBeNull();
    expect(parseMotionQueryParam("")).toBeNull();
  });

  test("[TRANSITIONAL] only the original nine save until the wave 2 migration", () => {
    expect([...SERVER_ACCEPTED_ANIMATION_SLUGS]).toEqual([
      "none",
      "confetti",
      "fireworks",
      "balloons",
      "sparkles",
      "glitter_shower",
      "snowfall",
      "falling_petals",
      "hearts",
      "shimmer_reveal",
    ]);
  });
});
