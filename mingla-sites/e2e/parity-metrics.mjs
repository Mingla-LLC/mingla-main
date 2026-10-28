// #2829 W7b — the §7 pixel-parity metrics, shared by the private travel-pilot
// parity harness (e2e/ys-parity) and the public CI goldens
// (e2e/goldens). Pure: PNG buffers in, numbers out.
//
// §7 checks implemented here (thresholds are the contract; never loosen):
//   1. height: |ours − baseline| ≤ 4 px
//   2. pixelmatch(threshold 0.1, includeAA false) over the common height:
//      mismatched ≤ 1.0 % at 1440 px wide, ≤ 1.5 % at 390 px (wider than
//      390 uses the 1440 limit)
//   3. 64×64 tiles: no tile over 20 % mismatched
//   4. exclusion boxes: the ONLY regions masked out (painted identically on
//      both sides before comparing), declared by the caller
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export const PARITY_LIMITS = Object.freeze({
  heightPx: 4,
  threshold: 0.1,
  mismatchWide: 0.01,
  mismatchNarrow: 0.015,
  tile: 64,
  tileMismatch: 0.2,
});

const DIFF_COLOR = [255, 0, 0];

export function decodePng(buffer) {
  return PNG.sync.read(buffer);
}

function crop(png, width, height) {
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    png.data.copy(out.data, y * width * 4, y * png.width * 4, y * png.width * 4 + width * 4);
  }
  return out;
}

/** Paint every box the same flat colour in place (both sides get the same paint). */
export function maskBoxes(png, boxes) {
  for (const box of boxes) {
    const x0 = Math.max(0, Math.floor(box.x));
    const y0 = Math.max(0, Math.floor(box.y));
    const x1 = Math.min(png.width, Math.ceil(box.x + box.width));
    const y1 = Math.min(png.height, Math.ceil(box.y + box.height));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * png.width + x) * 4;
        png.data[i] = 255;
        png.data[i + 1] = 0;
        png.data[i + 2] = 255;
        png.data[i + 3] = 255;
      }
    }
  }
}

/**
 * Compare `ours` to `baseline` (PNG buffers) under the §7 limits.
 * Returns the numbers, a pass flag per check, and the diff PNG buffer.
 */
export function compareScreens(baselineBuffer, oursBuffer, { boxes = [], limits = PARITY_LIMITS } = {}) {
  const baseline = decodePng(baselineBuffer);
  const ours = decodePng(oursBuffer);
  const width = Math.min(baseline.width, ours.width);
  const height = Math.min(baseline.height, ours.height);
  const a = crop(baseline, width, height);
  const b = crop(ours, width, height);
  maskBoxes(a, boxes);
  maskBoxes(b, boxes);
  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold: limits.threshold,
    includeAA: false,
    diffColor: DIFF_COLOR,
    alpha: 0.15,
  });
  const ratio = mismatched / (width * height);
  const limit = width > 390 ? limits.mismatchWide : limits.mismatchNarrow;
  let worst = { x: 0, y: 0, ratio: 0 };
  let tilesOver = 0;
  for (let ty = 0; ty < height; ty += limits.tile) {
    for (let tx = 0; tx < width; tx += limits.tile) {
      const tw = Math.min(limits.tile, width - tx);
      const th = Math.min(limits.tile, height - ty);
      let count = 0;
      for (let y = ty; y < ty + th; y += 1) {
        for (let x = tx; x < tx + tw; x += 1) {
          const i = (y * width + x) * 4;
          if (diff.data[i] === DIFF_COLOR[0] && diff.data[i + 1] === DIFF_COLOR[1] && diff.data[i + 2] === DIFF_COLOR[2]) count += 1;
        }
      }
      const tileRatio = count / (tw * th);
      if (tileRatio > limits.tileMismatch) tilesOver += 1;
      if (tileRatio > worst.ratio) worst = { x: tx, y: ty, ratio: tileRatio };
    }
  }
  const heightDelta = ours.height - baseline.height;
  return {
    width,
    baselineHeight: baseline.height,
    oursHeight: ours.height,
    heightDelta,
    mismatched,
    mismatchRatio: ratio,
    mismatchLimit: limit,
    worstTile: worst,
    tilesOver,
    pass: {
      height: Math.abs(heightDelta) <= limits.heightPx,
      pixels: ratio <= limit,
      tiles: tilesOver === 0,
    },
    diffPng: PNG.sync.write(diff),
  };
}

/* ------------------------------------------------------------------ */
/* Computed styles (§7 check 5)                                         */
/* ------------------------------------------------------------------ */

/**
 * Parse a CSS colour as Chrome serialises it — rgb()/rgba() or
 * color(srgb r g b / a) — to [r, g, b, a] in 0..1. Null when it is not one.
 */
export function parseColor(value) {
  const text = String(value ?? "").trim();
  let match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(text);
  if (match) {
    const alpha = match[4] === undefined ? 1 : match[4].endsWith("%") ? Number(match[4].slice(0, -1)) / 100 : Number(match[4]);
    return [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255, alpha];
  }
  match = /^color\(\s*srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.e-]+%?))?\s*\)$/i.exec(text);
  if (match) {
    const alpha = match[4] === undefined ? 1 : match[4].endsWith("%") ? Number(match[4].slice(0, -1)) / 100 : Number(match[4]);
    return [Number(match[1]), Number(match[2]), Number(match[3]), alpha];
  }
  return null;
}

/** Colours equal within 1/255 per channel (transparent equals transparent, whatever its rgb). */
export function sameColor(a, b) {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return String(a) === String(b);
  if (x[3] === 0 && y[3] === 0) return true;
  return x.every((channel, index) => Math.abs(channel - y[index]) <= 1 / 255 + 1e-9);
}

const COLOR_TOKEN = /rgba?\([^)]*\)|color\(srgb[^)]*\)/gi;

/** Box shadows equal: same geometry text, colours compared numerically. */
export function sameShadow(a, b) {
  const textA = String(a ?? "");
  const textB = String(b ?? "");
  const colorsA = textA.match(COLOR_TOKEN) ?? [];
  const colorsB = textB.match(COLOR_TOKEN) ?? [];
  if (colorsA.length !== colorsB.length) return false;
  if (textA.replace(COLOR_TOKEN, "C").replace(/\s+/g, " ").trim() !== textB.replace(COLOR_TOKEN, "C").replace(/\s+/g, " ").trim()) return false;
  return colorsA.every((color, index) => sameColor(color, colorsB[index]));
}

export function firstFamily(value) {
  return String(value ?? "").split(",")[0].trim().replace(/^["']|["']$/g, "");
}

export const STYLE_PROPERTIES = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "color", "bg", "radius", "shadow", "padding", "w", "h"];

/** Every §7 property of one selector; returns the list of differing properties (empty = match). */
export function styleDifferences(baseline, ours) {
  if (baseline === null || ours === null) return baseline === ours ? [] : [{ property: "presence", baseline: baseline === null ? "absent" : "present", ours: ours === null ? "absent" : "present" }];
  const out = [];
  for (const property of STYLE_PROPERTIES) {
    const a = baseline[property];
    const b = ours[property];
    let same;
    if (property === "fontFamily") same = firstFamily(a) === firstFamily(b);
    else if (property === "color" || property === "bg") same = sameColor(a, b);
    else if (property === "shadow") same = sameShadow(a, b);
    else if (property === "w" || property === "h") same = Math.abs(Number(a) - Number(b)) <= 1;
    else same = String(a) === String(b);
    if (!same) out.push({ property, baseline: a, ours: b });
  }
  return out;
}
