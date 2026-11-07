// issue #1023 — small, dependency-free toolkit the Lottie generator uses:
// seeded RNG, the reference palette, shape builders and keyframe fitting.
//
// Everything here is deterministic: the same seed always produces the same
// bytes, so regenerating the JSON never produces a spurious diff.

/* ---------------------------------------------------------------- RNG ---- */

export function hashSeed(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: tiny, fast, good enough for particle scatter. */
export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const R = (lo, hi) => lo + next() * (hi - lo);
  const RI = (lo, hi) => Math.floor(R(lo, hi + 1));
  const pick = (list) => list[Math.floor(next() * list.length)];
  return { next, R, RI, pick };
}

/* ------------------------------------------------------------ palette ---- */
// A copy of the reference page's `viv` / `pal` / `palDark` (and of the runtime
// `buildThemeMotionPalette`), used only to give the raw JSON sensible default
// colours for the Mingla orange. The runtime rewrites every slot anyway.

export function hexToRgb255(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

export function hslToRgb01(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

export function defaultSlots(brand = "#eb7825") {
  const [h, s0, l0] = rgbToHsl(...hexToRgb255(brand));
  const BH = h, BS = Math.max(s0, 78), BL = Math.min(Math.max(l0, 52), 64);
  const BH2 = BH + 30, BS2 = BS, BL2 = BL + 4, BHM = BH - 32;
  return {
    c0: hslToRgb01(BH, BS, BL),
    c1: hslToRgb01(BH, BS, Math.min(BL + 16, 82)),
    c2: hslToRgb01(BH2, BS2, BL2),
    c3: hslToRgb01(BH2, BS2, Math.min(BL2 + 14, 82)),
    c4: hslToRgb01(BHM, BS, BL + 2),
    c5: hslToRgb01(BH, 80, 92),
    d0: hslToRgb01(BH, BS, BL - 24),
    d2: hslToRgb01(BH2, BS2, BL2 - 24),
  };
}

const SLOT_RE = /^(c[0-5]|d[02])$/;
export const isSlot = (c) => typeof c === "string" && SLOT_RE.test(c);

const DEFAULTS = defaultSlots();

/** colour spec → [r,g,b] 0..1. Spec is a slot name or a #hex. */
export function rgbOf(spec) {
  if (isSlot(spec)) return DEFAULTS[spec];
  return hexToRgb255(spec).map((v) => v / 255);
}

/* ------------------------------------------------------------ numbers ---- */

export const r1 = (v) => Math.round(v * 10) / 10;
export const r2 = (v) => Math.round(v * 100) / 100;
export const r3 = (v) => Math.round(v * 1000) / 1000;
const rc = (v) => Math.round(v * 1000) / 1000;

/* ------------------------------------------------------------- shapes ---- */
// All builders take sizes in COMP pixels (the generator scales from the
// reference page's units before calling them).

const tr = (p = [0, 0], r = 0, s = [100, 100], o = 100) => ({
  ty: "tr",
  p: { a: 0, k: [r1(p[0]), r1(p[1])] },
  a: { a: 0, k: [0, 0] },
  s: { a: 0, k: s },
  r: { a: 0, k: r1(r) },
  o: { a: 0, k: o },
});

export function group(items, opts = {}) {
  return { ty: "gr", it: [...items, tr(opts.p, opts.r, opts.s, opts.o)] };
}

export const rect = (w, h, round = 0, p = [0, 0]) => ({
  ty: "rc",
  p: { a: 0, k: [r1(p[0]), r1(p[1])] },
  s: { a: 0, k: [r1(w), r1(h)] },
  r: { a: 0, k: r1(round) },
});

export const ellipse = (w, h, p = [0, 0]) => ({
  ty: "el",
  p: { a: 0, k: [r1(p[0]), r1(p[1])] },
  s: { a: 0, k: [r1(w), r1(h)] },
});

/** Bezier path. pts: [[x,y,inX,inY,outX,outY], ...] (tangents relative). */
export function pathShape(pts, closed = true) {
  return {
    ty: "sh",
    ks: { a: 0, k: pathValue(pts, closed) },
  };
}

export function pathValue(pts, closed = true) {
  return {
    c: closed,
    v: pts.map((p) => [r1(p[0]), r1(p[1])]),
    i: pts.map((p) => [r1(p[2] ?? 0), r1(p[3] ?? 0)]),
    o: pts.map((p) => [r1(p[4] ?? 0), r1(p[5] ?? 0)]),
  };
}

export const polygon = (xy, closed = true) => pathShape(xy.map(([x, y]) => [x, y]), closed);

/** Solid fill. `nm` is the colour slot (c0…c5, d0, d2) or "fx" for fixed. */
export function fill(color, opacity = 100) {
  const [r, g, b] = rgbOf(color);
  return {
    ty: "fl",
    nm: isSlot(color) ? color : "fx",
    c: { a: 0, k: [rc(r), rc(g), rc(b), 1] },
    o: { a: 0, k: Math.round(opacity) },
    r: 1,
  };
}

export function stroke(color, width, opacity = 100, cap = 2, dash = null) {
  const [r, g, b] = rgbOf(color);
  const out = {
    ty: "st",
    nm: isSlot(color) ? color : "fx",
    c: { a: 0, k: [rc(r), rc(g), rc(b), 1] },
    o: { a: 0, k: Math.round(opacity) },
    w: { a: 0, k: r2(width) },
    lc: cap,
    lj: 2,
  };
  if (dash) {
    out.d = [
      { n: "d", nm: "dash", v: { a: 0, k: r2(dash[0]) } },
      { n: "g", nm: "gap", v: { a: 0, k: r2(dash[1]) } },
      { n: "o", nm: "offset", v: { a: 0, k: 0 } },
    ];
  }
  return out;
}

/**
 * Gradient fill/stroke. stops: [{at, color, alpha}]. The node's `nm` lists the
 * colour of each stop ("g|c1|c0|d0") so the runtime can rewrite brand stops.
 */
function gradientData(stops) {
  const col = [];
  const alpha = [];
  for (const st of stops) {
    const [r, g, b] = rgbOf(st.color);
    col.push(r3(st.at), rc(r), rc(g), rc(b));
  }
  for (const st of stops) alpha.push(r3(st.at), r3(st.alpha ?? 1));
  return {
    nm: "g|" + stops.map((s) => (isSlot(s.color) ? s.color : "fx")).join("|"),
    g: { p: stops.length, k: { a: 0, k: [...col, ...alpha] } },
  };
}

export function gradientFill(stops, start, end, radial = false) {
  const gd = gradientData(stops);
  return {
    ty: "gf",
    nm: gd.nm,
    o: { a: 0, k: 100 },
    r: 1,
    s: { a: 0, k: [r1(start[0]), r1(start[1])] },
    e: { a: 0, k: [r1(end[0]), r1(end[1])] },
    t: radial ? 2 : 1,
    g: gd.g,
    ...(radial ? { h: { a: 0, k: 0 }, a: { a: 0, k: 0 } } : {}),
  };
}

export function gradientStroke(stops, start, end, width) {
  const gd = gradientData(stops);
  return {
    ty: "gs",
    nm: gd.nm,
    o: { a: 0, k: 100 },
    w: { a: 0, k: r2(width) },
    s: { a: 0, k: [r1(start[0]), r1(start[1])] },
    e: { a: 0, k: [r1(end[0]), r1(end[1])] },
    t: 1,
    lc: 2,
    lj: 2,
    g: gd.g,
  };
}

/** A soft radial glow disc of radius `r`, colour at `alpha` in the centre. */
export function glowDisc(r, color, alpha, p = [0, 0]) {
  return group([
    ellipse(r * 2, r * 2),
    gradientFill(
      [
        { at: 0, color, alpha },
        { at: 1, color, alpha: 0 },
      ],
      [0, 0],
      [r, 0],
      true,
    ),
  ], { p });
}

export function star4Points(r, thin = 0.18) {
  const out = [];
  for (let i = 0; i < 8; i += 1) {
    const ang = (i * Math.PI) / 4 - Math.PI / 2;
    const rr = i % 2 ? r * thin : r;
    out.push([Math.cos(ang) * rr, Math.sin(ang) * rr]);
  }
  return out;
}

/** The reference `heart(c, 0, -s/2, s)`: point at the bottom, size s. */
export function heartPath(s) {
  const y = -s / 2;
  return pathShape([
    [0, y + s * 0.35, 0, -s * 0.35, 0, -s * 0.35],
    [-s * 0.5, y + s * 0.3, 0, -s * 0.35, 0, s * 0.3],
    [0, y + s, 0, -s * 0.2, 0, -s * 0.2],
    [s * 0.5, y + s * 0.3, 0, s * 0.3, 0, -s * 0.35],
  ]);
}

/* ----------------------------------------------------------- keyframes ---- */

const LIN_O = { x: 0, y: 0 };
const LIN_I = { x: 1, y: 1 };

/**
 * Fit a sampled 1-D curve (one value per frame) with as few keyframes as
 * possible, using cubic-Hermite segments expressed as Lottie bezier easing
 * (time handles at 1/3 and 2/3, so time stays linear and the value follows the
 * Hermite curve exactly). Splits the worst segment until every sample is
 * within `eps`. Returns [{f, v, m}] where m is the slope (per frame).
 */
export function fitCurve(values, eps, opts = {}) {
  const n = values.length;
  if (n === 0) return [];
  const slope = (i) => {
    if (opts.linear) return null;
    if (i <= 0) return n > 1 ? values[1] - values[0] : 0;
    if (i >= n - 1) return values[n - 1] - values[n - 2];
    return (values[i + 1] - values[i - 1]) / 2;
  };
  const keys = new Set([0, n - 1]);
  const evalSeg = (a, b, i) => {
    const h = b - a;
    if (h === 0) return values[a];
    const u = (i - a) / h;
    const ma = slope(a), mb = slope(b);
    if (ma === null || mb === null) return values[a] + (values[b] - values[a]) * u;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
    const h10 = u ** 3 - 2 * u ** 2 + u;
    const h01 = -2 * u ** 3 + 3 * u ** 2;
    const h11 = u ** 3 - u ** 2;
    return h00 * values[a] + h10 * h * ma + h01 * values[b] + h11 * h * mb;
  };
  const handleOk = (a, b) => {
    if (opts.linear) return true;
    const dv = values[b] - values[a];
    const h = b - a;
    const ma = slope(a), mb = slope(b);
    if (Math.abs(dv) < 1e-6) return Math.abs(ma) < 1e-6 && Math.abs(mb) < 1e-6;
    const yo = (ma * h) / 3 / dv;
    const yi = 1 - (mb * h) / 3 / dv;
    return Math.abs(yo) <= 4 && Math.abs(yi) <= 4 && Math.abs(yi - 1) <= 4;
  };
  for (let guard = 0; guard < 4000; guard += 1) {
    const sorted = [...keys].sort((x, y) => x - y);
    let worst = -1, worstErr = eps, worstSeg = null;
    for (let k = 0; k < sorted.length - 1; k += 1) {
      const a = sorted[k], b = sorted[k + 1];
      if (b - a < 2) continue;
      if (!handleOk(a, b)) {
        const mid = Math.floor((a + b) / 2);
        worst = mid; worstErr = Infinity; worstSeg = [a, b];
        break;
      }
      for (let i = a + 1; i < b; i += 1) {
        const err = Math.abs(evalSeg(a, b, i) - values[i]);
        if (err > worstErr) { worstErr = err; worst = i; worstSeg = [a, b]; }
      }
    }
    if (worst < 0 || worstSeg === null) break;
    keys.add(worst);
  }
  return [...keys].sort((x, y) => x - y).map((f) => ({ f, v: values[f], m: slope(f) }));
}

function easing(a, b) {
  if (a.m === null || b.m === null) return { o: LIN_O, i: LIN_I };
  const dv = b.v - a.v;
  const h = b.f - a.f;
  if (Math.abs(dv) < 1e-6) return { o: LIN_O, i: LIN_I };
  return {
    o: { x: 0.333, y: r3((a.m * h) / 3 / dv) },
    i: { x: 0.667, y: r3(1 - (b.m * h) / 3 / dv) },
  };
}

/**
 * Animated scalar property from per-frame samples. `round` formats values.
 * `offsetFrames` shifts every key time (used to start a precomp mid-way).
 */
export function animScalar(values, eps, round = r1, opts = {}) {
  const first = values[0];
  if (values.every((v) => Math.abs(v - first) <= eps * 0.5)) {
    return { a: 0, k: round(first) };
  }
  const keys = fitCurve(values, eps, opts);
  const k = keys.map((key, idx) => {
    const out = { t: key.f + (opts.t0 ?? 0), s: [round(key.v)] };
    if (idx < keys.length - 1) {
      const e = easing(key, keys[idx + 1]);
      out.o = e.o;
      out.i = e.i;
    }
    return out;
  });
  return { a: 1, k };
}

/**
 * Animated 2-D scale from per-frame [sx, sy] samples. One easing curve is
 * shared by both axes, so callers only animate one axis or both uniformly.
 */
export function animScale(pairs, eps) {
  const sx = pairs.map((p) => p[0]);
  const sy = pairs.map((p) => p[1]);
  const varX = Math.max(...sx) - Math.min(...sx);
  const varY = Math.max(...sy) - Math.min(...sy);
  if (varX <= eps * 0.5 && varY <= eps * 0.5) {
    return { a: 0, k: [r1(sx[0]), r1(sy[0])] };
  }
  const driver = varY >= varX ? sy : sx;
  const keys = fitCurve(driver, eps);
  const k = keys.map((key, idx) => {
    const out = { t: key.f, s: [r1(sx[key.f]), r1(sy[key.f])] };
    if (idx < keys.length - 1) {
      const e = easing(key, keys[idx + 1]);
      out.o = e.o;
      out.i = e.i;
    }
    return out;
  });
  return { a: 1, k };
}

/** Linear path keyframes from a list of path values (one per keyframe time). */
export function animPath(frames, values) {
  return {
    a: 1,
    k: frames.map((f, idx) => {
      const out = { t: f, s: [values[idx]] };
      if (idx < frames.length - 1) {
        out.o = LIN_O;
        out.i = LIN_I;
      }
      return out;
    }),
  };
}

/** Sawtooth on a scalar: ramps from a→b over each period, then jumps back. */
export function sawtooth(a, b, periodFrames, totalFrames, phaseFrames = 0) {
  const k = [];
  let f = -phaseFrames;
  while (f < totalFrames) {
    k.push({ t: Math.max(f, 0) === f ? f : f, s: [r1(a)], o: LIN_O, i: LIN_I });
    k.push({ t: f + periodFrames - 1, s: [r1(a + (b - a) * ((periodFrames - 1) / periodFrames))], h: 1 });
    f += periodFrames;
  }
  k.push({ t: f, s: [r1(a)] });
  return { a: 1, k };
}
