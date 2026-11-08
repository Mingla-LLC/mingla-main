// issue #1023 — brand tinting for the generated theme-motion Lottie files.
//
// The generator (scripts/generate-lottie.mjs) names every brand-following
// colour node with a slot: fills/strokes "c0"…"c5" are the reference
// palette's `pal(0…5)`, "d0"/"d2" are `palDark`, and gradient nodes are named
// "g|<slot>|<slot>…" (one entry per stop, "fx" for a fixed stop). This module
// ports the reference palette (`viv`, `setBrandHSL`, `pal`, `palDark`) and
// rewrites those slots for a brand colour.

export type ThemeMotionSlot = "c0" | "c1" | "c2" | "c3" | "c4" | "c5" | "d0" | "d2";
export type Rgb01 = readonly [number, number, number];

export interface ThemeMotionPalette {
  /** Stable cache key ("#rrggbb" or "#rrggbb/#rrggbb"). */
  key: string;
  slots: Readonly<Record<ThemeMotionSlot, Rgb01>>;
}

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const FALLBACK_BRAND = "#eb7825";

const hexToRgb255 = (hex: string): [number, number, number] => {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const mx = Math.max(rr, gg, bb);
  const mn = Math.min(rr, gg, bb);
  let h = 0;
  let s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h =
      mx === rr
        ? (gg - bb) / d + (gg < bb ? 6 : 0)
        : mx === gg
          ? (bb - rr) / d + 2
          : (rr - gg) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
};

const hslToRgb01 = (hIn: number, sIn: number, lIn: number): Rgb01 => {
  const h = ((hIn % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, sIn)) / 100;
  const l = Math.max(0, Math.min(100, lIn)) / 100;
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
};

/** The reference `viv`: saturation floor 78, lightness held in 52–64. */
const vivid = (hex: string): [number, number, number] => {
  const [h, s, l] = rgbToHsl(...hexToRgb255(hex));
  return [h, Math.max(s, 78), Math.min(Math.max(l, 52), 64)];
};

const normaliseHex = (value: string | null | undefined): string | null => {
  if (typeof value !== "string" || !HEX_RE.test(value.trim())) return null;
  const raw = value.trim().replace("#", "").toLowerCase();
  const six = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  return `#${six}`;
};

/**
 * Port of the reference `setBrandHSL` + `pal` + `palDark`.
 * `color2` is optional: gradients arrive in wave 2. Without it the second
 * colour is the reference's warm neighbour (hue +30) and slot 4 is the cool
 * neighbour (hue −32); with it slot 4 is the blend of the two.
 */
export function buildThemeMotionPalette(
  color: string,
  color2?: string | null,
): ThemeMotionPalette {
  const brand = normaliseHex(color) ?? FALLBACK_BRAND;
  const brand2 = normaliseHex(color2);
  const [BH, BS, BL] = vivid(brand);
  let BH2: number;
  let BS2: number;
  let BL2: number;
  let BHM: number;
  if (brand2 !== null) {
    [BH2, BS2, BL2] = vivid(brand2);
    const d = ((BH2 - BH + 540) % 360) - 180;
    BHM = BH + d / 2;
  } else {
    BH2 = BH + 30;
    BS2 = BS;
    BL2 = BL + 4;
    BHM = BH - 32;
  }
  return {
    key: brand2 !== null ? `${brand}/${brand2}` : brand,
    slots: {
      c0: hslToRgb01(BH, BS, BL),
      c1: hslToRgb01(BH, BS, Math.min(BL + 16, 82)),
      c2: hslToRgb01(BH2, BS2, BL2),
      c3: hslToRgb01(BH2, BS2, Math.min(BL2 + 14, 82)),
      c4: hslToRgb01(BHM, BS, BL + 2),
      c5: hslToRgb01(BH, 80, 92),
      d0: hslToRgb01(BH, BS, BL - 24),
      d2: hslToRgb01(BH2, BS2, BL2 - 24),
    },
  };
}

const SLOTS: ReadonlySet<string> = new Set([
  "c0",
  "c1",
  "c2",
  "c3",
  "c4",
  "c5",
  "d0",
  "d2",
]);

type Json = unknown;
type JsonObject = Record<string, Json>;

const isObject = (v: Json): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const round = (v: number): number => Math.round(v * 1000) / 1000;

function rewriteSolid(node: JsonObject, rgb: Rgb01): JsonObject {
  const c = node.c;
  if (!isObject(c) || c.a !== 0 || !Array.isArray(c.k)) return node;
  const alpha = typeof c.k[3] === "number" ? c.k[3] : 1;
  return { ...node, c: { ...c, k: [round(rgb[0]), round(rgb[1]), round(rgb[2]), alpha] } };
}

function rewriteGradient(
  node: JsonObject,
  stopsSlots: string[],
  palette: ThemeMotionPalette,
): JsonObject {
  const g = node.g;
  if (!isObject(g) || typeof g.p !== "number" || !isObject(g.k)) return node;
  const inner = g.k;
  if (inner.a !== 0 || !Array.isArray(inner.k)) return node;
  const values = [...(inner.k as number[])];
  const stops = g.p;
  for (let i = 0; i < stops; i += 1) {
    const slot = stopsSlots[i];
    if (slot === undefined || !SLOTS.has(slot)) continue;
    const rgb = palette.slots[slot as ThemeMotionSlot];
    values[i * 4 + 1] = round(rgb[0]);
    values[i * 4 + 2] = round(rgb[1]);
    values[i * 4 + 3] = round(rgb[2]);
  }
  return { ...node, g: { ...g, k: { ...inner, k: values } } };
}

function tintNode(node: Json, palette: ThemeMotionPalette): Json {
  if (Array.isArray(node)) {
    let changed = false;
    const out = node.map((child) => {
      const next = tintNode(child, palette);
      if (next !== child) changed = true;
      return next;
    });
    return changed ? out : node;
  }
  if (!isObject(node)) return node;
  let out: JsonObject = node;
  let changed = false;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value !== "object" || value === null) continue;
    const next = tintNode(value, palette);
    if (next !== value) {
      if (!changed) {
        out = { ...node };
        changed = true;
      }
      out[key] = next;
    }
  }
  const ty = out.ty;
  const nm = out.nm;
  if ((ty === "fl" || ty === "st") && typeof nm === "string" && SLOTS.has(nm)) {
    return rewriteSolid(out, palette.slots[nm as ThemeMotionSlot]);
  }
  if ((ty === "gf" || ty === "gs") && typeof nm === "string" && nm.startsWith("g|")) {
    return rewriteGradient(out, nm.split("|").slice(1), palette);
  }
  return out;
}

const tintCache = new WeakMap<object, Map<string, object>>();

/**
 * Brand-tinted copy of a generated Lottie animation. Memoised per (animation
 * object, palette key), so re-renders and the native safe-zone bands that
 * mount the same file several times share ONE tinted object. Never mutates
 * the input (the imported JSON module is shared by every mount).
 */
export function tintLottie<T extends object>(json: T, palette: ThemeMotionPalette): T {
  let perJson = tintCache.get(json);
  if (perJson === undefined) {
    perJson = new Map();
    tintCache.set(json, perJson);
  }
  const hit = perJson.get(palette.key);
  if (hit !== undefined) return hit as T;
  const tinted = tintNode(json, palette) as T;
  perJson.set(palette.key, tinted);
  return tinted;
}
