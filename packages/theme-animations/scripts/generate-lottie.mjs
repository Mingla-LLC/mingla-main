#!/usr/bin/env node
// issue #1023 — deterministic Lottie generator for the theme entrance motion.
//
//   node packages/theme-animations/scripts/generate-lottie.mjs          (all)
//   node packages/theme-animations/scripts/generate-lottie.mjs confetti (one)
//
// For each of the 29 slugs it writes two files into ../lottie/:
//   <slug>.intro.json  — about 2.6 s, played once, dense like the approved
//                        reference entrance;
//   <slug>.loop.json   — a seamless loop (6 s; 12 s for the three slow
//                        light-beam looks) at the reference's ambient density.
//
// The approved design is the canvas particle engine in the private reference
// page (`~/.mingla-private/1023/motion_reference.html`). Every preset below is
// a port of that page's `def({...})` block: the same spawn ranges, the same
// physics (`fall`), the same sizes and the same palette indices. The canvas
// draws every particle every frame; Lottie cannot afford that, so this file
// turns the particle system into:
//   - a handful of MOTION VARIANTS per preset (one simulated particle each,
//     keyframed sparsely with cubic-Hermite segments),
//   - a few LOOKS (shape + colour slot),
//   - one cheap INSTANCE layer per particle, which places a variant×look
//     precomp at the particle's spawn point, time and size.
// The loop is seamless by construction: every particle spawned in [0, T) is
// also instanced at t − T, t − 2T, … while it is still on screen, so the set
// of live particles at frame T is exactly the set at frame 0.
//
// Brand colours go through named slots: fills/strokes named c0…c5 are the
// reference `pal(0…5)`, d0/d2 are `palDark`, gradient nodes are named
// "g|<slot>|<slot>…" per stop. "fx" marks a fixed colour (love reds, snow…).
// The runtime (`tintLottie`) rewrites every slot to the brand palette.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  painterOrder,
  animPath,
  animScalar,
  animScale,
  ellipse,
  fill,
  glowDisc,
  gradientFill,
  gradientStroke,
  group,
  hashSeed,
  heartPath,
  makeRng,
  pathShape,
  pathValue,
  polygon,
  r1,
  rect,
  sawtooth,
  star4Points,
  stroke,
} from "./lottieKit.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "lottie");

/* ------------------------------------------------------------- constants -- */

export const FPS = 30;
export const COMP_W = 400; // the 4:5 cover every public surface pins
export const COMP_H = 500;
const REF_W = 270; // the reference page's phone canvas width
const REF_H = (REF_W * COMP_H) / COMP_W; // same 4:5 area in reference units
const K = COMP_W / REF_W; // reference units → comp pixels
const PW = COMP_W * 3; // precomp canvas: big enough that nothing clips
const PH = COMP_H * 3;
const PC = [PW / 2, PH / 2];
export const INTRO_SECONDS = 2.6;
const LOOP_SECONDS = 6;
const VIVID = 1.3;
const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;

const EPS_POS = 0.3; // reference units (≈0.45 px)
const EPS_ROT = 2; // degrees
const EPS_SCALE = 2.5; // percent
const EPS_OP = 2.5; // percent

// issue #1023 — white and near-white pieces (snow, white sparkles, glitter,
// stars) now also fall over the light details sheet, where pure white would
// vanish. A hairline dark rim (22% black) keeps their shape readable on cream
// and is invisible against dark covers.
const lightEdge = (width = 0.5) => stroke("#000000", width * (400 / 270), 22, 2);

const pal = (i) => `c${((i % 6) + 6) % 6}`;
const palDark = (i) => (i % 4 >= 2 ? "d2" : "d0");
// Seth (#1023): the love set keeps the BRAND colour — no fixed reds or pinks.
// Two-tone pairs from the brand palette, led by the reference `bigHeart`'s
// pal0→pal2; the rest are its light and blended neighbours.
const LOVE_PAIRS = [
  ["c0", "c2"],
  ["c1", "c0"],
  ["c2", "c3"],
  ["c4", "c0"],
  ["c0", "c3"],
];

/* --------------------------------------------------------------- physics -- */

/** The reference page's `fall`, verbatim. */
function fall(p, dt) {
  p.x += p.vx * dt + Math.sin(p.ph + p.age * p.sw) * p.sa * dt;
  p.y += p.vy * dt;
  p.vy += (p.g || 0) * dt;
  if (p.drag) {
    p.vx *= p.drag;
    p.vy = p.vy * p.drag + (p.g || 0) * dt * 0;
  }
  p.rot += p.vr * dt;
}

const ksin = (p) => Math.sin((Math.PI * p.age) / p.life);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/* ---------------------------------------------------------------- shapes -- */
// Helpers that draw in REFERENCE units and convert to comp pixels.

const k = (v) => v * K;
const kp = (pts) => pts.map(([x, y]) => [k(x), k(y)]);

function heartLook(r, ca, cb) {
  // the reference `bigHeart`: halo, two-tone diagonal gradient, highlight.
  return [
    glowDisc(k(r * 1.25), ca, 0.33, [0, k(r * 0.05)]),
    group([
      heartPath(k(r)),
      gradientFill(
        [
          { at: 0, color: ca, alpha: 1 },
          { at: 1, color: cb, alpha: 1 },
        ],
        [k(-r * 0.5), k(-r * 0.5)],
        [k(r * 0.5), k(r * 0.5)],
      ),
    ]),
    group([ellipse(k(r * 0.18), k(r * 0.3)), fill("#ffffff", 55)], {
      p: [k(-r * 0.24), k(-r * 0.18)],
      r: -0.6 * DEG,
    }),
  ];
}

function loveCols(rng) {
  // half the hearts wear the reference pair, the rest a brand neighbour pair
  return rng.next() < 0.5 ? ["c0", "c2"] : [...rng.pick(LOVE_PAIRS)];
}

function noteGlyph(kind, sz, color) {
  // ♪ ♫ ♬ ♩ drawn as shapes (no fonts in Lottie): heads, stems, flags/beams.
  const s = sz;
  const head = (x, y) =>
    group([ellipse(k(s * 0.36), k(s * 0.26)), fill(color)], { p: [k(x), k(y)], r: -20 });
  const stem = (x, y0, y1) => group([rect(k(s * 0.07), k(y1 - y0), 0, [k(x), k((y0 + y1) / 2)]), fill(color)]);
  const beam = (x0, x1, y) =>
    group([rect(k(x1 - x0 + s * 0.07), k(s * 0.12), 0, [k((x0 + x1) / 2), k(y)]), fill(color)]);
  if (kind === 0) {
    // ♪
    return [
      head(-s * 0.1, s * 0.22),
      stem(s * 0.06, -s * 0.38, s * 0.2),
      group([
        pathShape([
          [k(s * 0.06), k(-s * 0.38), 0, 0, k(s * 0.05), k(s * 0.08)],
          [k(s * 0.26), k(-s * 0.06), 0, k(-s * 0.1), 0, 0],
          [k(s * 0.08), k(-s * 0.22), 0, 0, 0, 0],
        ]),
        fill(color),
      ]),
    ];
  }
  if (kind === 1 || kind === 2) {
    // ♫ / ♬
    const items = [
      head(-s * 0.26, s * 0.24),
      head(s * 0.2, s * 0.16),
      stem(-s * 0.1, -s * 0.3, s * 0.22),
      stem(s * 0.36, -s * 0.38, s * 0.14),
      beam(-s * 0.1, s * 0.36, -s * 0.34),
    ];
    if (kind === 2) items.push(beam(-s * 0.1, s * 0.36, -s * 0.16));
    return items;
  }
  // ♩
  return [head(-s * 0.08, s * 0.24), stem(s * 0.08, -s * 0.4, s * 0.22)];
}

/* --------------------------------------------------------------- presets -- */
// Each preset ports one reference `def`. Fields:
//   rate:[intro, ambient] spawn rate per second (×VIVID), as in the reference
//   spawn(s, rng) / enter(s, rng) / update(p, dt, s): the reference physics
//   size(p): the scalar used to pick the closest motion variant
//   lookKey(p) + drawLook(key, size): what the particle looks like
//   lookAnim(key, frames): optional intrinsic animation of the look (flip,
//     twinkle, pulse) — shared by every particle with that look
//   xf(p, s): the motion transform at the current time (reference units)
//   scene(ctx): optional non-particle layers (beams, rays, aurora, big heart)

const P = [];
const def = (o) => P.push(o);

const baseXf = (p) => ({ x: p.x, y: p.y, r: (p.rot || 0) * DEG, sx: 100, sy: 100, o: 100 });

/* ===== CELEBRATE ===== */
def({
  id: "confetti",
  group: "Celebrate",
  rate: [40, 10],
  flip: "vx",
  enterVariants: 4,
  enterTilt: 0.22,
  enterYScale: REF_H / 480,
  tilt: 0.1,
  variants: 3,
  enter(s, R) {
    const out = [];
    for (let i = 0; i < 90; i += 1) {
      const left = i % 2 === 0;
      out.push({ x: left ? -5 : s.W + 5, y: s.H * 0.92, vx: (left ? 1 : -1) * R.R(60, 230), vy: -R.R(330, 560), g: 380, drag: 0.986, rot: R.R(0, TAU), vr: R.R(-6, 6), ph: R.R(0, TAU), sw: R.R(6, 12), sa: 0, age: 0, life: 4, w: R.R(4, 7), h: R.R(7, 11), col: R.RI(0, 5), kind: R.RI(0, 2) });
    }
    return out;
  },
  spawn(s, R) {
    return { x: R.R(0, s.W), y: -10, vx: 0, vy: R.R(35, 75), rot: R.R(0, TAU), vr: R.R(-3, 3), ph: R.R(0, TAU), sw: R.R(1, 2.4), sa: R.R(10, 24), age: 0, life: 12, w: R.R(4, 7), h: R.R(7, 11), col: R.RI(0, 5), kind: R.RI(0, 2) };
  },
  update(p, dt) {
    fall(p, dt);
    if (p.g && p.vy > 70) { p.g = 0; p.vy = 70; p.drag = 0; p.sa = 18; p.sw = 2; }
  },
  size: (p) => p.w,
  lookKey: (p) => `${p.kind === 2 ? "o" : "r"}${p.col}`,
  drawLook(key, w) {
    const c = pal(Number(key.slice(1)));
    if (key[0] === "o") return [group([ellipse(k(w * 1.2), k(w * 1.2)), fill(c)])];
    return [group([rect(k(w), k(w * 1.6)), fill(c)])];
  },
  // the reference's 3D flip: scale(1, cos(ph + age*7))
  lookAnim(key, f) {
    const ph = (key.charCodeAt(1) * 1.7) % TAU;
    return { sy: Math.cos(ph + (f / FPS) * 7) * 100 };
  },
  xf: baseXf,
});

def({
  id: "streamers",
  tilt: 0.08,
  group: "Celebrate",
  rate: [22, 4],
  spawn(s, R) {
    return { x: R.R(0, s.W), y: -40, vx: 0, vy: R.R(45, 85), rot: R.R(-0.6, 0.6), vr: R.R(-1.2, 1.2), ph: R.R(0, TAU), sw: 1.5, sa: 14, age: 0, life: 12, len: R.R(26, 46), amp: R.R(4, 7), col: R.RI(0, 4), stripe: R.next() < 0.4 };
  },
  update: fall,
  size: (p) => p.len,
  lookKey: (p) => `${p.col}${p.stripe ? "s" : ""}`,
  drawLook(key, len) {
    // the curled ribbon: a sine path whose phase travels (age*5) — two
    // keyframed path states give the wiggle.
    const c = pal(Number(key[0]));
    const items = [pathShape(ribbonPts(len, 0), false), stroke(c, k(3.2), 100, 2)];
    if (key.endsWith("s")) items.push(stroke("#ffffff", k(1), 75, 1, [k(2), k(4)]));
    return [group(items)];
  },
  lookPath: (key, len) => [pathValue(ribbonPts(len, 0), false), pathValue(ribbonPts(len, Math.PI), false)],
  xf: baseXf,
});

function ribbonPts(len, phase) {
  const amp = 5.5;
  const pts = [];
  const steps = 8;
  for (let j = 0; j <= steps; j += 1) {
    const i = (len * j) / steps;
    const x = Math.sin(i * 0.32 + phase) * amp;
    const dx = Math.cos(i * 0.32 + phase) * amp * 0.32 * (len / steps) / 3;
    const dy = len / steps / 3;
    pts.push([k(x), k(i - len / 2), k(-dx), k(-dy), k(dx), k(dy)]);
  }
  return pts;
}

def({
  id: "party_shapes",
  tilt: 0.08,
  group: "Celebrate",
  rate: [26, 5],
  enter(s, R) {
    const out = [];
    for (let i = 0; i < 26; i += 1) {
      const p = this.spawn(s, R);
      p.y = R.R(s.H * 0.3, s.H);
      p.vy *= 2.4;
      p.pool = "enter";
      out.push(p);
    }
    return out;
  },
  spawn(s, R) {
    return { x: R.R(10, s.W - 10), y: s.H + 20, vx: R.R(-8, 8), vy: -R.R(22, 46), rot: R.R(0, TAU), vr: R.R(-1.6, 1.6), ph: 0, sw: 1, sa: 6, age: 0, life: 14, kind: R.RI(0, 5), r: R.R(5, 9), col: R.RI(0, 5) };
  },
  update(p, dt) {
    fall(p, dt);
    if (p.vy < -46) p.vy += 60 * dt;
  },
  size: (p) => p.r,
  lookKey: (p) => `${p.kind}${p.col}`,
  drawLook(key, r) {
    const kind = Number(key[0]);
    const c = pal(Number(key[1]));
    const sw = (x) => stroke(c, k(2.4), 100, 2);
    if (kind === 0) {
      const pts = [];
      for (let i = 0; i < 5; i += 1) pts.push([k(-r + i * r * 0.5), k(i % 2 ? -r * 0.45 : r * 0.45)]);
      return [group([polygon(pts, false), sw()])];
    }
    if (kind === 1) return [group([ellipse(k(r * 1.6), k(r * 1.6)), sw()])];
    if (kind === 2) return [group([polygon(kp([[0, -r], [r * 0.9, r * 0.7], [-r * 0.9, r * 0.7]])), sw()])];
    if (kind === 3) return [group([polygon(kp(star4Points(r))), fill(c)])];
    if (kind === 4) {
      return [
        group([polygon(kp([[-r * 0.7, 0], [r * 0.7, 0]]), false), sw()]),
        group([polygon(kp([[0, -r * 0.7], [0, r * 0.7]]), false), sw()]),
      ];
    }
    const dots = [];
    for (let i = 0; i < 6; i += 1) dots.push(ellipse(k(2.4), k(2.4), [k(-r + i * r * 0.4), k(Math.sin(i) * 2)]));
    return [group([...dots, fill(c)])];
  },
  xf: baseXf,
});

def({
  id: "fireworks",
  group: "Celebrate",
  rate: [3.2, 0.7],
  custom: "fireworks",
});

def({
  id: "balloons",
  tilt: 0.08,
  group: "Celebrate",
  rate: [7, 1.1],
  enter(s, R) {
    const out = [];
    for (let i = 0; i < 10; i += 1) {
      const p = this.spawn(s, R);
      p.y = s.H + R.R(10, 160);
      p.vy = -R.R(110, 160);
      p.pool = "enter";
      out.push(p);
    }
    return out;
  },
  spawn(s, R) {
    return { x: R.R(16, s.W - 16), y: s.H + 30, vx: 0, vy: -R.R(32, 52), ph: R.R(0, TAU), sw: R.R(0.8, 1.4), sa: R.R(8, 14), rot: 0, vr: 0, age: 0, life: 20, r: R.R(11, 16), col: R.RI(0, 4) };
  },
  update(p, dt) {
    fall(p, dt);
    if (p.vy < -55) p.vy += 60 * dt;
  },
  size: (p) => p.r,
  lookKey: (p) => `${p.col}`,
  drawLook(key, r) {
    const col = Number(key);
    return [
      group([
        pathShape([
          [0, k(r * 1.2), 0, 0, k(r * 0.27), k(r * 0.53)],
          [k(-r * 0.1), k(r * 3.2), k(0.33 * r), k(-0.8 * r), 0, 0],
        ], false),
        stroke("#ffffff", k(0.8), 35),
      ]),
      group([
        ellipse(k(r * 2), k(r * 2.36)),
        gradientFill(
          [
            { at: 0, color: pal(col >= 2 ? 3 : 1), alpha: 1 },
            { at: 0.45, color: pal(col), alpha: 1 },
            { at: 1, color: palDark(col), alpha: 1 },
          ],
          [k(-r * 0.35), k(-r * 0.45)],
          [k(r * 0.9), k(r * 0.7)],
          true,
        ),
      ]),
      group([polygon(kp([[-2.5, r * 1.2], [2.5, r * 1.2], [0, r * 1.05]])), fill(pal(col))]),
      group([ellipse(k(r * 0.36), k(r * 0.6)), fill("#ffffff", 55)], { p: [k(-r * 0.38), k(-r * 0.5)], r: -0.5 * DEG }),
    ];
  },
  xf: (p) => ({ x: p.x, y: p.y, r: Math.sin(p.ph + p.age * p.sw) * 0.12 * DEG, sx: 100, sy: 100, o: 100 }),
});

def({
  id: "bubbles",
  group: "Celebrate",
  rate: [9, 2.2],
  spawn(s, R) {
    return { x: R.R(10, s.W - 10), y: s.H + 20, vx: R.R(-6, 6), vy: -R.R(30, 60), ph: R.R(0, TAU), sw: R.R(1, 2), sa: R.R(8, 16), rot: 0, vr: 0, age: 0, life: R.R(5, 10), r: R.R(7, 18) };
  },
  update: fall,
  size: (p) => p.r,
  lookKey: () => "b",
  drawLook(_key, r) {
    const arc = [];
    const a0 = -2.4, a1 = -1.6, rr = r * 0.7;
    const t = ((a1 - a0) / 3) * rr;
    arc.push([k(Math.cos(a0) * rr), k(Math.sin(a0) * rr), 0, 0, k(-Math.sin(a0) * t), k(Math.cos(a0) * t)]);
    arc.push([k(Math.cos(a1) * rr), k(Math.sin(a1) * rr), k(Math.sin(a1) * t), k(-Math.cos(a1) * t), 0, 0]);
    return [
      group([ellipse(k(r * 2), k(r * 2)), fill(pal(1), 10)]),
      group([
        ellipse(k(r * 2), k(r * 2)),
        gradientStroke(
          [
            { at: 0, color: "#ff78dc", alpha: 0.95 },
            { at: 0.5, color: "#64e6ff", alpha: 0.95 },
            { at: 1, color: "#ffeb6e", alpha: 0.95 },
          ],
          [k(-r), k(-r)],
          [k(r), k(r)],
          k(1.6),
        ),
      ]),
      group([pathShape(arc, false), stroke("#ffffff", k(1.6), 85)]),
    ];
  },
  // the pop: the last 0.25 s grows to 1.6× and fades
  xf(p) {
    const left = p.life - p.age;
    const end = left < 0.25;
    const q = end ? 1 - left / 0.25 : 0;
    return { x: p.x, y: p.y, r: 0, sx: 100 * (1 + q * 0.6), sy: 100 * (1 + q * 0.6), o: 100 * (end ? left / 0.25 : 1) };
  },
});

def({
  id: "champagne",
  tilt: 0.08,
  group: "Celebrate",
  rate: [90, 22],
  spawn(s, R) {
    return { x: R.R(0, s.W), y: s.H + 4, vx: 0, vy: -R.R(50, 120), ph: R.R(0, TAU), sw: R.R(4, 8), sa: R.R(6, 14), rot: 0, vr: 0, age: 0, life: 9, r: R.R(1, 3.4) };
  },
  update: fall,
  size: (p) => p.r,
  lookKey: () => "b",
  drawLook(_key, r) {
    return [group([ellipse(k(r * 2), k(r * 2)), fill("#ffd76b", 18), stroke("#ffecbe", k(0.8), 75)])];
  },
  xf: baseXf,
});

/* ===== GLOW ===== */
def({
  id: "sparkles",
  group: "Glow",
  rate: [32, 7],
  noFlip: true,
  spawn(s, R) {
    return { x: R.R(0, s.W), y: R.R(0, s.H), age: 0, life: R.R(0.9, 1.5), r: R.R(4, 9), col: R.next() < 0.5 ? "w" : "1", rot: R.R(0, 1) };
  },
  size: (p) => p.r,
  lookKey: (p) => p.col,
  drawLook(key, r) {
    return [
      glowDisc(k(r * 2.4), pal(0), 0.35),
      group([polygon(kp(star4Points(r, 0.16))), fill(key === "w" ? "#ffffff" : pal(1)), ...(key === "w" ? [lightEdge(0.4)] : [])]),
    ];
  },
  xf: (p) => {
    const kk = ksin(p);
    // the reference draws its stars axis-aligned (its `rot` is never used)
    return { x: p.x, y: p.y, r: 0, sx: 100 * kk, sy: 100 * kk, o: 100 * kk };
  },
});

def({
  id: "glitter_shower",
  tilt: 0.08,
  group: "Glow",
  rate: [130, 28],
  spawn(s, R) {
    return { x: R.R(0, s.W), y: -4, vx: R.R(-10, 10), vy: R.R(110, 200), ph: R.R(0, TAU), sw: 0, sa: 0, rot: R.R(0, 1), vr: R.R(-4, 4), age: 0, life: 5, r: R.R(1, 2.3), col: R.RI(0, 3) };
  },
  update: fall,
  size: (p) => p.r,
  lookKey: (p) => `${p.col}`,
  drawLook(key, r) {
    const c = ["#ffffff", "#ffe8a8", pal(1), pal(5)][Number(key)];
    const light = key === "0" || key === "1" || key === "3";
    return [group([rect(k(r), k(r)), fill(c), ...(light ? [lightEdge(0.35)] : [])])];
  },
  // the glint: .4 + .6·|sin(ph + age·9)|
  lookAnim(key, f) {
    const ph = Number(key) * 0.8;
    return { o: (0.4 + 0.6 * Math.abs(Math.sin(ph + (f / FPS) * 9))) * 100 };
  },
  xf: baseXf,
});

def({
  id: "disco_glints",
  group: "Glow",
  rate: [9, 2],
  loopSeconds: 12,
  noFlip: true,
  spawn(s, R) {
    return { x: R.R(10, s.W - 10), y: R.R(10, s.H * 0.8), age: 0, life: R.R(0.7, 1.1), r: R.R(14, 26), col: R.RI(0, 4), rot: R.R(0, 0.6) };
  },
  size: (p) => p.r,
  lookKey: (p) => `${p.col}`,
  drawLook(key, r) {
    const col = Number(key);
    const glowCol = [pal(0), pal(1), pal(4), "#9b7bff", "#5ad1ff"][col];
    const line = (len, w, rot) =>
      group([
        polygon(kp([[-len, 0], [len, 0]]), false),
        stroke("#ffffff", k(w), 100, 2),
      ], { r: rot });
    return [
      glowDisc(k(r * 1.3), glowCol, col >= 3 ? 0.4 : 0.45),
      line(r * 1.6, 1.1, 0),
      line(r * 1.6, 1.1, 90),
      line(r * 0.7, 0.6, 45),
      line(r * 0.7, 0.6, 135),
      group([ellipse(k(4.4), k(4.4)), fill("#ffffff")]),
    ];
  },
  xf: (p) => {
    const kk = ksin(p);
    return { x: p.x, y: p.y, r: p.rot * DEG, sx: 100 * kk, sy: 100 * kk, o: 100 * kk };
  },
  scene(ctx) {
    // three slow light beams from the top centre (the reference `pre`)
    const layers = [];
    for (let i = 0; i < 3; i += 1) {
      const a = 0.05 * ctx.k + 0.03;
      const color = pal(i === 1 ? 4 : i === 2 ? 3 : 0);
      const L = REF_H * 1.3;
      const tri = kp([[0, 0], [Math.cos(-0.12) * L, Math.sin(-0.12) * L], [Math.cos(0.12) * L, Math.sin(0.12) * L]]);
      const rot = ctx.sample((t) => (Math.sin(ctx.omega(0.5) * t + i * 2.1) * 0.5 + Math.PI / 2) * DEG);
      layers.push(shapeLayer(`beam${i}`, [group([polygon(tri), fill(color, a * 100)])], {
        p: { a: 0, k: [k(REF_W / 2), k(-10)] },
        r: animScalar(rot, EPS_ROT * 0.5, r1),
      }, ctx.frames));
    }
    return layers;
  },
});

def({
  id: "bokeh",
  preAged: true,
  group: "Glow",
  rate: [8, 2.4],
  noFlip: true,
  enter(s, R) {
    const out = [];
    for (let i = 0; i < 14; i += 1) {
      const p = this.spawn(s, R);
      p.preAge = R.R(0, 2);
      out.push(p);
    }
    return out;
  },
  spawn(s, R) {
    return { x: R.R(0, s.W), y: R.R(0, s.H), vx: R.R(-6, 6), vy: R.R(-8, -2), age: 0, life: R.R(5, 8), r: R.R(12, 34), col: R.RI(0, 4) };
  },
  update(p, dt) { p.x += p.vx * dt; p.y += p.vy * dt; },
  size: (p) => p.r,
  lookKey: (p) => `${p.col}`,
  drawLook(key, r) {
    return [group([ellipse(k(r * 2), k(r * 2)), fill(pal(Number(key)), 16), stroke(pal(1), k(1), 18)])];
  },
  xf: (p) => ({ x: p.x, y: p.y, r: 0, sx: 100, sy: 100, o: 100 * ksin(p) }),
});

def({
  id: "golden_dust",
  group: "Glow",
  rate: [70, 20],
  noFlip: true,
  spawn(s, R) {
    return { x: R.R(0, s.W), y: R.R(0, s.H), age: 0, life: R.R(3, 6), r: R.R(0.6, 1.9), ph: R.R(0, TAU), col: R.next() < 0.5 ? "g" : "b" };
  },
  update(p, dt, s) {
    const a = Math.sin(p.x * 0.02 + s.t * 0.4) + Math.cos(p.y * 0.018 - s.t * 0.3);
    p.x += Math.cos(a) * 18 * dt;
    p.y += Math.sin(a) * 14 * dt - 4 * dt;
  },
  size: (p) => p.r,
  lookKey: (p) => p.col,
  drawLook(key, r) {
    return [group([ellipse(k(r * 2), k(r * 2)), fill(key === "g" ? "#fbd56b" : pal(1))])];
  },
  lookAnim(key, f) {
    return { o: (0.5 + 0.5 * Math.sin((key === "g" ? 0 : 2) + (f / FPS) * 6)) * 100 };
  },
  xf: (p) => ({ x: p.x, y: p.y, r: 0, sx: 100, sy: 100, o: 100 * ksin(p) }),
});

def({
  id: "shimmer_reveal",
  group: "Glow",
  rate: [10, 2],
  noFlip: true,
  spawn(s, R) {
    return { x: R.R(0, s.W), y: R.R(0, s.H * 0.55), age: 0, life: R.R(0.6, 1), r: R.R(3, 6) };
  },
  size: (p) => p.r,
  lookKey: () => "w",
  drawLook(_key, r) {
    return [group([polygon(kp(star4Points(r))), fill("#ffffff"), lightEdge(0.4)])];
  },
  xf: (p) => {
    const kk = ksin(p);
    return { x: p.x, y: p.y, r: 0, sx: 100 * kk, sy: 100 * kk, o: 100 * kk };
  },
  scene(ctx) {
    // a band of light sweeping across (reference `pre`): 1.3 s sweeps during
    // the entrance, 3 s in the loop (the reference's 3.4 s, snapped so two
    // sweeps fit the 6 s loop exactly).
    const per = ctx.intro ? 1.3 : 3;
    const perF = Math.round(per * FPS);
    const a = 0.32 * (0.45 + 0.55 * ctx.k);
    const from = -REF_W;
    const to = -REF_W + (REF_W + REF_H) * 1.4;
    const band = group([
      rect(k(80), k(REF_H * 3)),
      gradientFill(
        [
          { at: 0, color: pal(5), alpha: 0 },
          { at: 0.5, color: pal(5), alpha: a },
          { at: 1, color: pal(5), alpha: 0 },
        ],
        [k(-40), 0],
        [k(40), 0],
      ),
    ], { r: -0.5 * DEG, p: [0, k(REF_H / 2)] });
    return [
      shapeLayer("band", [band], {
        p: { s: true, x: scaleAnim(sawtooth(from, to, perF, ctx.frames)), y: { a: 0, k: 0 } },
      }, ctx.frames),
    ];
  },
});

function scaleAnim(anim) {
  // sawtooth() works in reference units; convert key values to comp px.
  return { ...anim, k: anim.k.map((key) => ({ ...key, s: [r1(key.s[0] * K)] })) };
}

def({
  id: "neon_pulse",
  // a centrepiece: keep it whole on wide heroes (contain, not cover)
  fit: "contain",
  group: "Glow",
  rate: [2.4, 0.7],
  noFlip: true,
  noScale: true,
  spawn(s, R) {
    return { x: s.W / 2, y: s.H * 0.24 * (480 / REF_H), age: 0, life: 2.6, col: R.RI(0, 4) };
  },
  size: () => 1,
  lookKey: (p) => `${p.col}`,
  drawLook(key) {
    return [group([ellipse(k(16), k(16)), stroke(pal(Number(key)), k(9), 18), stroke(pal(1), k(1.6), 80)])];
  },
  // the ring grows from r=8 to r=8+0.8W and fades; stroke widths stay
  // constant, so the growth is drawn by the ellipse size, not layer scale.
  lookSizeAnim(f) {
    const q = Math.min(1, f / (2.6 * FPS));
    const r = 8 + q * REF_W * 0.8;
    return [k(r * 2), k(r * 2)];
  },
  xf: (p) => ({ x: p.x, y: p.y, r: 0, sx: 100, sy: 100, o: 100 * (1 - p.age / p.life) }),
});

/* ===== NATURE ===== */
def({
  id: "snowfall",
  tilt: 0.08,
  group: "Nature",
  rate: [80, 24],
  spawn(s, R) {
    const r = R.R(0.8, 3.4);
    return { x: R.R(-10, s.W + 10), y: -6, vx: R.R(-6, 6), vy: 20 + r * 14, ph: R.R(0, TAU), sw: R.R(0.6, 1.4), sa: R.R(8, 18), rot: 0, vr: 0, age: 0, life: 30, r };
  },
  update: fall,
  size: (p) => p.r,
  lookKey: () => "w",
  drawLook(_key, r) {
    return [group([ellipse(k(r * 2), k(r * 2)), fill("#ffffff"), lightEdge(0.45)])];
  },
  instanceOpacity: (q) => (0.35 + q.r * 0.17) * 100,
  variants: 6,
  xf: baseXf,
});

def({
  id: "falling_petals",
  tilt: 0.08,
  group: "Nature",
  rate: [28, 6],
  spawn(s, R) {
    return { x: R.R(-10, s.W), y: -10, vx: R.R(8, 22), vy: R.R(30, 58), ph: R.R(0, TAU), sw: R.R(1.5, 2.6), sa: R.R(16, 30), rot: R.R(0, TAU), vr: R.R(-2, 2), age: 0, life: 16, r: R.R(4, 6.5), col: R.RI(0, 3) };
  },
  update: fall,
  noFlip: true,
  size: (p) => p.r,
  lookKey: (p) => `${p.col}`,
  drawLook(key, r) {
    const c = ["#f8b4c8", "#ffd1dc", "#f49ab5", pal(1)][Number(key)];
    return [group([ellipse(k(r * 1.2), k(r * 2)), fill(c)])];
  },
  lookAnim(key, f) {
    return { sx: Math.cos(Number(key) * 1.3 + (f / FPS) * 3) * 100 };
  },
  xf: baseXf,
});

def({
  id: "autumn_leaves",
  tilt: 0.08,
  group: "Nature",
  rate: [16, 3.5],
  spawn(s, R) {
    return { x: R.R(0, s.W), y: -14, vx: R.R(-10, 10), vy: R.R(34, 62), ph: R.R(0, TAU), sw: R.R(1.2, 2), sa: R.R(24, 40), rot: R.R(0, TAU), vr: R.R(-2.2, 2.2), age: 0, life: 16, r: R.R(6, 10), col: R.RI(0, 4) };
  },
  update: fall,
  size: (p) => p.r,
  lookKey: (p) => `${p.col}`,
  drawLook(key, r) {
    const c = ["#e8742a", "#c2410c", "#f2a541", "#a3502b", pal(0)][Number(key)];
    return [
      group([
        pathShape([
          [0, k(-r), k(-r * 0.6), k(r * 0.53), k(r * 0.6), k(r * 0.53)],
          [0, k(r), k(r * 0.6), k(-r * 0.8), k(-r * 0.6), k(-r * 0.8)],
        ]),
        fill(c),
      ]),
      group([polygon(kp([[0, -r * 0.8], [0, r * 1.2]]), false), stroke("#000000", k(0.7), 25)]),
    ];
  },
  // see-saw: rot + sin(age·2 + ph)·0.6
  xf: (p) => ({ x: p.x, y: p.y, r: (p.rot + Math.sin(p.age * 2 + p.ph) * 0.6) * DEG, sx: 100, sy: 100, o: 100 }),
});

def({
  id: "fireflies",
  preAged: true,
  group: "Nature",
  rate: [10, 3],
  noFlip: true,
  enter(s, R) {
    const out = [];
    for (let i = 0; i < 22; i += 1) {
      const p = this.spawn(s, R);
      p.preAge = R.R(0, 3);
      out.push(p);
    }
    return out;
  },
  spawn(s, R) {
    return { x: R.R(0, s.W), y: R.R(s.H * 0.15, s.H), vx: R.R(-12, 12), vy: R.R(-12, 12), ph: R.R(0, TAU), age: 0, life: R.R(6, 10), rng: makeRng(Math.floor(R.next() * 1e9)) };
  },
  update(p, dt) {
    p.vx += p.rng.R(-30, 30) * dt;
    p.vy += p.rng.R(-30, 30) * dt;
    p.vx *= 0.98;
    p.vy *= 0.98;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  },
  size: () => 1,
  noScale: true,
  lookKey: () => "f",
  drawLook() {
    return [glowDisc(k(9), "#e5ff66", 0.55), group([ellipse(k(2.8), k(2.8)), fill("#f4ffb3")])];
  },
  xf: (p) => {
    const b = ((Math.sin(p.ph + p.age * 2.2) + 1) / 2) ** 2 * ksin(p);
    return { x: p.x, y: p.y, r: 0, sx: 100, sy: 100, o: 100 * b };
  },
});

def({
  id: "rain",
  group: "Nature",
  rate: [170, 60],
  noScale: true,
  noFlip: true,
  variants: 6,
  spawn(s, R) {
    return { x: R.R(-20, s.W + 20), y: -16, vx: -40, vy: R.R(380, 520), age: 0, life: 2, len: R.R(9, 16) };
  },
  custom: "rain",
});

def({
  id: "sun_rays",
  group: "Nature",
  rate: [30, 10],
  loopSeconds: 12,
  noFlip: true,
  spawn(s, R) {
    return { x: R.R(0, s.W * 0.8), y: R.R(0, s.H * 0.7), vx: R.R(2, 8), vy: R.R(-3, 5), age: 0, life: R.R(3, 5), r: R.R(0.6, 1.6) };
  },
  update(p, dt) { p.x += p.vx * dt; p.y += p.vy * dt; },
  size: (p) => p.r,
  lookKey: () => "d",
  drawLook(_key, r) {
    return [group([ellipse(k(r * 2), k(r * 2)), fill("#fff0d2")])];
  },
  xf: (p) => ({ x: p.x, y: p.y, r: 0, sx: 100, sy: 100, o: 80 * ksin(p) }),
  scene(ctx) {
    const a = 0.07 + 0.07 * ctx.k;
    const layers = [];
    for (let i = 0; i < 8; i += 1) {
      const L = REF_H * 1.5 * (480 / REF_H);
      const tri = kp([[0, 0], [Math.cos(-0.035) * L, Math.sin(-0.035) * L], [Math.cos(0.035) * L, Math.sin(0.035) * L]]);
      const rot = ctx.sample((t) => (i * 0.17 + 0.05 + Math.sin(ctx.omega(0.35) * t + i) * 0.04) * DEG);
      layers.push(shapeLayer(`ray${i}`, [group([polygon(tri), fill(pal(i % 2 ? 5 : 1), a * (i % 3 ? 0.7 : 1) * 100)])], {
        p: { a: 0, k: [k(-10), k(-10)] },
        r: animScalar(rot, 0.3, r1),
      }, ctx.frames));
    }
    return layers;
  },
});

/* ===== NIGHT ===== */
def({
  id: "starry_sky",
  group: "Night",
  rate: [1.4, 0.35],
  noFlip: true,
  noScale: true,
  spawn(s, R) {
    return { x: R.R(s.W * 0.2, s.W * 1.1), y: R.R(-10, s.H * 0.35), vx: -R.R(260, 340), vy: R.R(110, 160), age: 0, life: 0.9 };
  },
  update(p, dt) { p.x += p.vx * dt; p.y += p.vy * dt; },
  size: () => 1,
  lookKey: () => "s",
  drawLook() {
    // shooting star: a streak fading to transparent behind the head
    const vx = -300, vy = 135;
    return [
      group([
        polygon(kp([[0, 0], [-vx * 0.18, -vy * 0.18]]), false),
        gradientStroke(
          [
            { at: 0, color: "#ffffff", alpha: 0.95 },
            { at: 1, color: "#ffffff", alpha: 0 },
          ],
          [0, 0],
          [k(-vx * 0.18), k(-vy * 0.18)],
          k(1.6),
        ),
      ]),
    ];
  },
  bounds: { minX: -120, maxX: 400 },
  xf: (p) => ({ x: p.x, y: p.y, r: 0, sx: 100, sy: 100, o: 100 }),
  scene(ctx) {
    // a field of 70 twinkling stars (reference `init` + `pre`). Twinkle
    // speeds are snapped to whole cycles per loop so the field loops cleanly.
    const R = makeRng(hashSeed("starry_sky:field"));
    const layers = [];
    for (let i = 0; i < 70; i += 1) {
      const st = { x: R.R(0, REF_W), y: R.R(0, REF_H), r: R.R(0.4, 1.5), ph: R.R(0, TAU), sp: R.R(1, 3) };
      const w = ctx.omega(st.sp);
      const alpha = ctx.sample((t) => 0.25 + 0.75 * ((Math.sin(st.ph + t * w) + 1) / 2) ** 2);
      const big = st.r > 1.2;
      const shapes = big
        ? [group([polygon(kp(star4Points(st.r * 2.6, 0.2))), fill("#fffaf0"), lightEdge(0.35)])]
        : [group([ellipse(k(st.r * 2), k(st.r * 2)), fill("#fffaf0"), lightEdge(0.3)])];
      const ks = {
        p: { a: 0, k: [r1(k(st.x)), r1(k(st.y))] },
        o: animScalar(alpha.map((a) => a * 100), EPS_OP * 1.6, Math.round),
      };
      if (big) ks.s = animScale(alpha.map((a) => [a * 100, a * 100]), EPS_SCALE * 1.6);
      layers.push(shapeLayer(`star${i}`, shapes, ks, ctx.frames));
    }
    return layers;
  },
});

def({
  id: "aurora",
  group: "Night",
  rate: [0, 0],
  loopSeconds: 12,
  scene(ctx) {
    // three curtains of light rippling across the top (reference `pre`)
    const cols = [pal(0), pal(4), pal(3)];
    const layers = [];
    const step = 12;
    const keyEvery = Math.round(FPS * 0.4);
    for (let i = 0; i < 3; i += 1) {
      const base = REF_H * (480 / REF_H) * (0.1 + i * 0.07);
      const w1 = ctx.omega(0.5 + i * 0.15);
      const w2 = ctx.omega(0.8);
      const frames = [];
      const values = [];
      for (let f = 0; f <= ctx.frames; f += keyEvery) {
        const t = Math.min(f, ctx.frames) / FPS;
        const ys = [];
        for (let x = 0; x <= REF_W + step; x += step) {
          ys.push(base + Math.sin(x * 0.025 + t * w1 + i * 2) * 16 + Math.sin(x * 0.06 - t * w2) * 5);
        }
        const pts = [[k(-step), k(-20)]];
        ys.forEach((y, j) => {
          const x = j * step;
          const prev = ys[Math.max(0, j - 1)];
          const next = ys[Math.min(ys.length - 1, j + 1)];
          const dy = ((next - prev) / 2) * (1 / 3);
          pts.push([k(x), k(y), k(-step / 3), k(-dy), k(step / 3), k(dy)]);
        });
        pts.push([k(REF_W + step * 2), k(-20)]);
        frames.push(Math.min(f, ctx.frames));
        values.push(pathValue(pts, true));
      }
      if (frames[frames.length - 1] !== ctx.frames) {
        frames.push(ctx.frames);
        values.push(values[0]);
      }
      const alpha = 0.16 + 0.2 * ctx.k;
      layers.push(shapeLayer(`curtain${i}`, [
        group([
          { ty: "sh", ks: animPath(frames, values) },
          gradientFill(
            [
              { at: 0, color: cols[i], alpha: 0 },
              { at: 0.65, color: cols[i], alpha },
              { at: 1, color: cols[i], alpha: 0 },
            ],
            [0, 0],
            [0, k(base + 40)],
          ),
        ]),
      ], {}, ctx.frames));
    }
    return layers;
  },
});

def({
  id: "lanterns",
  tilt: 0.08,
  group: "Night",
  rate: [5, 1],
  enter(s, R) {
    const out = [];
    for (let i = 0; i < 8; i += 1) {
      const p = this.spawn(s, R);
      p.y = s.H + R.R(0, 120);
      p.vy = -R.R(70, 100);
      p.pool = "enter";
      out.push(p);
    }
    return out;
  },
  spawn(s, R) {
    return { x: R.R(14, s.W - 14), y: s.H + 20, vx: 0, vy: -R.R(22, 40), ph: R.R(0, TAU), sw: R.R(0.6, 1.1), sa: R.R(6, 10), rot: 0, vr: 0, age: 0, life: 24, sz: R.R(0.7, 1.15) };
  },
  update(p, dt) {
    fall(p, dt);
    if (p.vy < -42) p.vy += 40 * dt;
  },
  size: (p) => p.sz,
  lookKey: () => "l",
  drawLook(_key, sz) {
    const w = 9 * sz, h = 12 * sz;
    return [
      glowDisc(k(24 * sz), "#ffa03c", 0.35),
      group([
        rect(k(w), k(h), k(3)),
        gradientFill(
          [
            { at: 0, color: "#ffd78c", alpha: 1 },
            { at: 1, color: "#ff7828", alpha: 1 },
          ],
          [0, k(-h / 2)],
          [0, k(h / 2)],
        ),
      ]),
    ];
  },
  lookAnim(_key, f) {
    return { o: (0.85 + 0.15 * Math.sin((f / FPS) * 9)) * 100 };
  },
  xf: baseXf,
});

def({
  id: "embers",
  tilt: 0.08,
  group: "Night",
  rate: [80, 22],
  spawn(s, R) {
    return { x: R.R(0, s.W), y: s.H + 4, vx: R.R(-10, 10), vy: -R.R(55, 140), ph: R.R(0, TAU), sw: R.R(3, 6), sa: R.R(8, 20), rot: 0, vr: 0, age: 0, life: R.R(1.8, 3.4), r: R.R(0.8, 2.3), col: R.RI(0, 3) };
  },
  update: fall,
  size: (p) => p.r,
  lookKey: (p) => `${p.col}`,
  drawLook(key, r) {
    const c = ["#ff7a1a", "#ffb020", "#ff4d00", pal(0)][Number(key)];
    return [glowDisc(k(r * 4), "#ff781e", 0.35), group([ellipse(k(r * 2), k(r * 2)), fill(c)])];
  },
  // flicker: (1 − age/life)·(.6 + .4·sin(age·20 + ph)), keyframed coarsely
  xf: (p) => ({ x: p.x, y: p.y, r: 0, sx: 100, sy: 100, o: 100 * (1 - p.age / p.life) * (0.6 + 0.4 * Math.sin(p.age * 20 + p.ph)) }),
  opEps: 8,
});

def({
  id: "music_notes",
  tilt: 0.08,
  group: "Night",
  rate: [10, 2.2],
  noFlip: true,
  spawn(s, R) {
    return { x: R.R(10, s.W - 14), y: s.H + 16, vx: 0, vy: -R.R(38, 70), ph: R.R(0, TAU), sw: R.R(2, 3), sa: R.R(10, 18), rot: R.R(-0.3, 0.3), vr: R.R(-0.4, 0.4), age: 0, life: 12, sz: R.RI(14, 24), g: R.RI(0, 3), col: R.RI(0, 2) };
  },
  update: fall,
  size: (p) => p.sz,
  lookKey: (p) => `${p.g}${p.col}`,
  drawLook(key, sz) {
    const c = [pal(0), pal(1), "#ffffff"][Number(key[1])];
    return [group(noteGlyph(Number(key[0]), sz, c))];
  },
  xf: (p) => ({ x: p.x, y: p.y, r: (p.rot + Math.sin(p.age * 4 + p.ph) * 0.15) * DEG, sx: 100, sy: 100, o: 100 }),
});

/* ===== LOVE ===== */
def({
  id: "hearts",
  group: "Love",
  enterTilt: 0.3,
  // ambient 2.4 → 3.2: the loop keeps several big hearts on the cover at all
  // times (Seth: big, vivid hearts, clearly visible in the loop too)
  rate: [9, 3.2],
  noFlip: true,
  enter(s, R) {
    const out = [];
    for (let i = 0; i < 9; i += 1) {
      const a = -Math.PI / 2 + R.R(-1.1, 1.1);
      const sp = R.R(90, 170);
      const [ca, cb] = loveCols(R);
      out.push({ x: s.W / 2, y: s.H * 0.28 * (480 / REF_H), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ph: R.R(0, TAU), sw: 1.5, sa: 0, rot: R.R(-0.3, 0.3), vr: 0, age: 0, life: 6, r: R.R(20, 34), ca, cb, drag: 0.97, pool: "enter" });
    }
    return out;
  },
  spawn(s, R) {
    const [ca, cb] = loveCols(R);
    if (R.next() < 0.68) {
      return { x: R.R(s.W * 0.14, s.W * 0.86), y: s.H * 0.45 * (480 / REF_H), vx: 0, vy: -R.R(32, 62), ph: R.R(0, TAU), sw: R.R(1.2, 2), sa: R.R(10, 18), rot: R.R(-0.25, 0.25), vr: 0, age: 0, life: 12, r: R.R(18, 32), ca, cb };
    }
    const left = R.next() < 0.5;
    return { x: left ? R.R(3, s.W * 0.06) : R.R(s.W * 0.94, s.W - 3), y: s.H + 10, vx: 0, vy: -R.R(45, 80), ph: R.R(0, TAU), sw: R.R(1.5, 2.5), sa: 3, rot: R.R(-0.3, 0.3), vr: 0, age: 0, life: 14, r: R.R(7, 10), ca, cb, pool: "gutter" };
  },
  update: fall,
  size: (p) => p.r,
  lookKey: (p) => `${p.ca}~${p.cb}`,
  drawLook(key, r) {
    const [ca, cb] = key.split("~");
    return heartLook(r, ca, cb);
  },
  // gentle pulse: 1 + .06·sin(age·7)
  lookAnim(_key, f) {
    const v = (1 + 0.06 * Math.sin((f / FPS) * 7)) * 100;
    return { sx: v, sy: v };
  },
  xf: (p) => {
    const sc = Math.min(1, p.age * 3.5) * 100;
    return { x: p.x, y: p.y, r: (p.rot + Math.sin(p.age * 2 + p.ph) * 0.15) * DEG, sx: sc, sy: sc, o: 100 };
  },
});

def({
  id: "love_burst",
  // a centrepiece: keep it whole on wide heroes (contain, not cover)
  fit: "contain",
  group: "Love",
  rate: [0, 0],
  custom: "love_burst",
});

def({
  id: "rose_petals",
  tilt: 0.08,
  group: "Love",
  rate: [34, 8],
  noFlip: true,
  spawn(s, R) {
    return { x: R.R(-10, s.W), y: -12, vx: R.R(6, 20), vy: R.R(34, 64), ph: R.R(0, TAU), sw: R.R(1.5, 2.6), sa: R.R(16, 30), rot: R.R(0, TAU), vr: R.R(-2.4, 2.4), age: 0, life: 16, r: R.R(6, 10), col: R.RI(0, 4) };
  },
  update: fall,
  size: (p) => p.r,
  lookKey: (p) => `${p.col}`,
  drawLook(key, r) {
    // brand petals: a slot colour, lit with the brand cream, shaded toward the
    // dark shade of the same family (d0 for the base hue, d2 for the second)
    const ca = ["c0", "c2", "c4", "c1", "c3"][Number(key)];
    const shade = ca === "c2" || ca === "c3" ? "d2" : "d0";
    return [
      group([
        pathShape([
          [0, k(-r), k(-r * 0.9), k(r * 0.2), k(r * 0.9), k(r * 0.2)],
          [0, k(r), k(r * 0.8), k(-r * 0.4), k(-r * 0.8), k(-r * 0.4)],
        ]),
        gradientFill(
          [
            { at: 0, color: "c5", alpha: 0.95 },
            { at: 0.35, color: ca, alpha: 1 },
            { at: 1, color: shade, alpha: 1 },
          ],
          [k(-r * 0.2), k(-r * 0.3)],
          [k(r * 0.9), k(r * 0.5)],
          true,
        ),
      ]),
    ];
  },
  lookAnim(key, f) {
    return { sx: Math.cos(Number(key) * 1.1 + (f / FPS) * 3) * 100 };
  },
  xf: baseXf,
});

def({
  id: "love_balloons",
  tilt: 0.08,
  group: "Love",
  rate: [5, 1],
  noFlip: true,
  enter(s, R) {
    const out = [];
    for (let i = 0; i < 8; i += 1) {
      const p = this.spawn(s, R);
      p.y = s.H + R.R(10, 150);
      p.vy = -R.R(110, 160);
      p.pool = "enter";
      out.push(p);
    }
    return out;
  },
  spawn(s, R) {
    const [ca, cb] = loveCols(R);
    return { x: R.R(18, s.W - 18), y: s.H + 30, vx: 0, vy: -R.R(30, 50), ph: R.R(0, TAU), sw: R.R(0.8, 1.3), sa: R.R(8, 12), rot: 0, vr: 0, age: 0, life: 20, r: R.R(18, 26), ca, cb };
  },
  update(p, dt) {
    fall(p, dt);
    if (p.vy < -52) p.vy += 60 * dt;
  },
  size: (p) => p.r,
  lookKey: (p) => `${p.ca}~${p.cb}`,
  drawLook(key, r) {
    const [ca, cb] = key.split("~");
    return [
      group([
        pathShape([
          [0, k(r * 0.5), 0, 0, k(r * 0.2), k(r * 0.53)],
          [k(-r * 0.1), k(r * 2.2), k(0.27 * r), k(-0.6 * r), 0, 0],
        ], false),
        stroke("#ffffff", k(0.8), 40),
      ]),
      ...heartLook(r, ca, cb),
      group([ellipse(k(r * 0.1), k(r * 0.2)), fill("#ffffff", 30)], { p: [k(r * 0.18), k(-r * 0.12)], r: 0.5 * DEG }),
    ];
  },
  xf: (p) => ({ x: p.x, y: p.y, r: Math.sin(p.ph + p.age * p.sw) * 0.12 * DEG, sx: 100, sy: 100, o: 100 }),
});

/* ---------------------------------------------------------- layer utils -- */

function shapeLayer(nm, shapes, ks, frames, extra = {}) {
  return {
    ty: 4,
    nm,
    ip: extra.ip ?? 0,
    op: extra.op ?? frames,
    st: extra.st ?? 0,
    sr: 1,
    ks: {
      a: { a: 0, k: [0, 0] },
      p: { a: 0, k: [0, 0] },
      ...ks,
    },
    shapes: painterOrder(shapes),
    ...(extra.parent !== undefined ? { parent: extra.parent } : {}),
    ...(extra.ind !== undefined ? { ind: extra.ind } : {}),
  };
}

function precompLayer(refId, ind, ks, ip, op, st) {
  const out = { ty: 0, refId, ind, ip, op, st, sr: 1, w: PW, h: PH, ks: { a: { a: 0, k: PC }, ...ks } };
  return out;
}

/* ---------------------------------------------------------- the engine -- */

const SUB = 2; // physics substeps per frame (the reference ran at ~60 Hz)

function world(intro) {
  return { W: REF_W, H: REF_H, t: 0, intro, k: intro ? 1 : 0.35, ps: [] };
}

/** Simulate one particle; returns per-frame transforms until it dies. */
function simulate(preset, p, s, maxFrames) {
  const out = [];
  const dt = 1 / (FPS * SUB);
  if (p.preAge) {
    // bokeh / fireflies start part-way through their life
    const n = Math.round(p.preAge * FPS * SUB);
    for (let i = 0; i < n; i += 1) { p.age += dt; preset.update?.(p, dt, s); s.t += dt; }
  }
  for (let f = 0; f < maxFrames; f += 1) {
    if (p.dead || p.age >= p.life) break;
    out.push(preset.xf(p, s));
    for (let i = 0; i < SUB; i += 1) { p.age += dt; preset.update?.(p, dt, s); s.t += dt; }
  }
  return out;
}

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
}

class Builder {
  constructor(preset, mode) {
    this.preset = preset;
    this.mode = mode; // "intro" | "loop"
    this.intro = mode === "intro";
    this.seconds = this.intro ? INTRO_SECONDS : preset.loopSeconds ?? LOOP_SECONDS;
    this.frames = Math.round(this.seconds * FPS);
    this.rng = makeRng(hashSeed(`${preset.id}:${mode}`));
    this.assets = [];
    this.assetIds = new Map();
    this.layers = [];
    this.ind = 1;
    this.pools = new Map();
    this.lookSizes = new Map();
    this.rockets = new Map();
  }

  asset(id, layers) {
    if (!this.assetIds.has(id)) {
      const short = `p${this.assetIds.size}`;
      this.assetIds.set(id, short);
      this.assets.push({ id: short, layers });
    }
    return this.assetIds.get(id);
  }

  /** Motion variants for a pool, simulated once, reused by every instance. */
  pool(name, make) {
    if (this.pools.has(name)) return this.pools.get(name);
    const preset = this.preset;
    const R = makeRng(hashSeed(`${preset.id}:${this.mode}:pool:${name}`));
    const count = name === "enter" ? preset.enterVariants ?? preset.variants ?? 4 : preset.variants ?? 4;
    const raw = make(R, count);
    const variants = raw.map((p) => {
      const s = world(this.intro);
      s.t = R.R(0, 20);
      const x0 = p.x, y0 = p.y;
      const size = preset.size(p);
      // the entrance is cut at its last frame, so never key past it
      const track = simulate(preset, { ...p }, s, this.intro ? this.frames + 1 + (preset.preAged ? 3 * FPS : 0) : 40 * FPS);
      // cannons were tuned for the reference's 480-unit-tall screen; the
      // cover is shorter, so squash the climb to open at the same height
      const ys = name === "enter" ? preset.enterYScale ?? 1 : 1;
      if (ys !== 1) for (const t of track) t.y = y0 + (t.y - y0) * ys;
      return { size, x0, y0, vx: p.vx ?? 0, track };
    });
    const out = { variants, canon: median(variants.map((v) => v.size)) };
    this.pools.set(name, out);
    return out;
  }

  /** Precomp holding one look (shape + colour), with its own small animation. */
  maxTrack() {
    let n = 1;
    for (const pool of this.pools.values()) for (const v of pool.variants) n = Math.max(n, v.track.length);
    return n;
  }

  lookAsset(key, size) {
    const preset = this.preset;
    const id = `look:${key}`;
    if (this.assetIds.has(id)) return { ref: this.assetIds.get(id), size: this.lookSizes.get(id) };
    const frames = this.maxTrack();
    this.lookSizes.set(id, size);
    const shapes = preset.drawLook(key, size);
    const ks = { p: { a: 0, k: PC } };
    if (preset.lookAnim) {
      const samples = [];
      for (let f = 0; f <= frames; f += 1) samples.push(preset.lookAnim(key, f));
      if (samples[0].sx !== undefined || samples[0].sy !== undefined) {
        ks.s = animScale(samples.map((v) => [v.sx ?? 100, v.sy ?? 100]), EPS_SCALE * 1.4);
      }
      if (samples[0].o !== undefined) ks.o = animScalar(samples.map((v) => v.o), EPS_OP * 1.4, Math.round);
    }
    if (preset.lookPath) {
      const [a, b] = preset.lookPath(key, size);
      const half = Math.round((Math.PI / 5) * FPS);
      const fr = [];
      const vals = [];
      for (let f = 0, i = 0; f <= frames + half; f += half, i += 1) { fr.push(f); vals.push(i % 2 ? b : a); }
      shapes[0].it[0] = { ty: "sh", ks: animPath(fr, vals) };
    }
    if (preset.lookSizeAnim) {
      const sizes = [];
      for (let f = 0; f <= frames; f += 1) sizes.push(preset.lookSizeAnim(f));
      shapes[0].it[0] = {
        ty: "el",
        p: { a: 0, k: [0, 0] },
        s: { a: 1, k: [{ t: 0, s: sizes[0].map(r1), o: { x: 0, y: 0 }, i: { x: 1, y: 1 } }, { t: frames, s: sizes[frames].map(r1) }] },
      };
    }
    return { ref: this.asset(id, [shapeLayer("look", shapes, ks, frames + 1)]), size };
  }

  /** Precomp: one motion variant wearing one look. */
  motionAsset(poolName, pool, vi, key) {
    const id = `m:${poolName}:${vi}:${key}`;
    if (this.assetIds.has(id)) return this.assetIds.get(id);
    const preset = this.preset;
    const v = pool.variants[vi];
    const n = v.track.length;
    const look = this.lookAsset(key, pool.canon);
    const lookRef = look.ref;
    const sizeK = v.size / look.size;
    const tx = v.track.map((t) => PC[0] + (t.x - v.x0) * K);
    const ty = v.track.map((t) => PC[1] + (t.y - v.y0) * K);
    const ks = {
      a: { a: 0, k: PC },
      p: { s: true, x: animScalar(tx, EPS_POS * K, r1), y: animScalar(ty, EPS_POS * K, r1) },
      r: animScalar(v.track.map((t) => t.r), EPS_ROT, r1),
      s: animScale(v.track.map((t) => [t.sx * sizeK, t.sy * sizeK]), EPS_SCALE),
      o: animScalar(v.track.map((t) => clamp01(t.o / 100) * 100), preset.opEps ?? EPS_OP, Math.round),
    };
    const layer = { ty: 0, refId: lookRef, ind: 1, ip: 0, op: n, st: 0, sr: 1, w: PW, h: PH, ks };
    return this.asset(id, [layer]);
  }

  chooseVariant(pool, q, R) {
    const size = this.preset.size(q);
    let best = 0, bestD = Infinity;
    pool.variants.forEach((v, i) => {
      const d = Math.abs(v.size - size) + R.next() * 1e-6;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  /** Frames an instance stays alive (until its life ends or it leaves). */
  aliveFrames(v, q, sc, fl) {
    const b = this.preset.bounds ?? {};
    const minX = b.minX ?? -60, maxX = b.maxX ?? REF_W + 60;
    const minY = -REF_H * 0.6, maxY = REF_H + 80;
    let n = 0;
    for (const t of v.track) {
      const x = q.x + fl * sc * (t.x - v.x0);
      const y = q.y + sc * (t.y - v.y0);
      if (x < minX || x > maxX || y < minY || y > maxY) break;
      n += 1;
    }
    return n;
  }

  /** Place one particle as instance layer(s); loop mode wraps it around. */
  instance(poolName, pool, q, startFrame) {
    const preset = this.preset;
    const R = this.rng;
    const vi = this.chooseVariant(pool, q, R);
    const v = pool.variants[vi];
    const sc = preset.noScale ? 1 : Math.max(0.55, Math.min(1.8, preset.size(q) / v.size));
    let fl = 1;
    if (preset.flip === "vx" && q.vx) fl = Math.sign(q.vx) === Math.sign(v.vx || 1) ? 1 : -1;
    else if (preset.flip === "vx") fl = R.next() < 0.5 ? -1 : 1;
    else if (!preset.noFlip) fl = R.next() < 0.5 ? -1 : 1;
    const key = preset.lookKey(q);
    const ref = this.motionAsset(poolName, pool, vi, key);
    const life = this.aliveFrames(v, q, sc, fl);
    if (life <= 0) return;
    const pre = q.preAge ? Math.round(q.preAge * FPS) : 0;
    const ks = {
      p: { a: 0, k: [r1(q.x * K), r1(q.y * K)] },
      s: { a: 0, k: [r1(fl * sc * 100), r1(sc * 100)] },
    };
    // a small random tilt of the whole path breaks up particles that share a
    // motion variant (otherwise they read as visible "rails")
    const tilt = poolName === "enter" ? preset.enterTilt ?? 0 : preset.tilt ?? 0;
    if (tilt) ks.r = { a: 0, k: r1(R.R(-tilt, tilt) * DEG) };
    if (preset.instanceOpacity) ks.o = { a: 0, k: Math.round(preset.instanceOpacity(q)) };
    const st0 = startFrame - pre;
    const push = (st) => {
      this.layers.push(precompLayer(ref, this.ind++, ks, st + pre, st + life, st));
    };
    if (this.intro) {
      if (st0 + life > 0) push(st0);
      return;
    }
    // loop: every copy that is on screen at some point in [0, frames]
    for (const st of this.loopStarts(st0, life)) push(st);
  }

  /**
   * Start frames for every copy of a looping particle that is on screen at
   * some frame in [0, T]. A particle born exactly at frame 0 also gets its
   * copy born at T, so the state at T matches the state at 0 exactly.
   */
  loopStarts(st0, life) {
    const out = [];
    const first = st0 <= 0 ? st0 + this.frames : st0;
    for (let st = first; st + life > 0; st -= this.frames) out.push(st);
    return out;
  }

  spawnTimes(rate) {
    const n = Math.round(rate * VIVID * this.seconds);
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const jitter = (this.rng.next() - 0.5) * 0.8;
      out.push(Math.max(0, Math.min(this.frames - 1, Math.round(((i + 0.5 + jitter) / n) * this.frames))));
    }
    return out;
  }

  build() {
    const preset = this.preset;
    const ctx = this.sceneCtx();
    const sceneLayers = preset.scene ? preset.scene(ctx) : [];
    if (preset.custom === "fireworks") this.fireworks();
    else if (preset.custom === "rain") this.rain();
    else if (preset.custom === "love_burst") sceneLayers.push(...this.loveBurst(ctx));
    else if (preset.spawn) this.particles();
    sceneLayers.forEach((l) => { l.ind = this.ind++; });
    // instance layers paint over the scene (the reference draws `pre` first)
    const layers = [...this.layers.reverse(), ...sceneLayers.reverse()];
    return {
      v: "5.7.4",
      fr: FPS,
      ip: 0,
      op: this.frames,
      w: COMP_W,
      h: COMP_H,
      nm: `mingla-${preset.id}-${this.mode}`,
      ddd: 0,
      meta: { g: "mingla generate-lottie (#1023)", slug: preset.id, phase: this.mode, fit: preset.fit ?? "cover" },
      assets: this.assets,
      layers,
    };
  }

  sceneCtx() {
    const frames = this.frames;
    const seconds = this.seconds;
    const intro = this.intro;
    return {
      frames,
      intro,
      k: intro ? 1 : 0.35,
      // snap an angular speed so a whole number of cycles fits the loop
      omega: (w) => (intro ? w : Math.max(1, Math.round((w * seconds) / TAU)) * (TAU / seconds)),
      sample: (fn) => {
        const out = [];
        for (let f = 0; f <= frames; f += 1) out.push(fn(f / FPS));
        return out;
      },
    };
  }

  particles() {
    const preset = this.preset;
    const R = this.rng;
    const s = world(this.intro);
    const rate = preset.rate[this.intro ? 0 : 1];
    const spawnPool = this.pool("spawn", (PR, n) => {
      const out = [];
      for (let i = 0; i < n * 6 && out.length < n; i += 1) {
        const p = preset.spawn(s, PR);
        if ((p.pool ?? "spawn") === "spawn") out.push(p);
      }
      // keep variants spread across the size range
      return out.sort((a, b) => preset.size(a) - preset.size(b));
    });
    let gutterPool = null;
    if (preset.id === "hearts") {
      gutterPool = this.pool("gutter", (PR, n) => {
        const out = [];
        for (let i = 0; i < 200 && out.length < n; i += 1) {
          const p = preset.spawn(s, PR);
          if (p.pool === "gutter") out.push(p);
        }
        return out;
      });
    }
    if (this.intro && preset.enter) {
      const entered = preset.enter.call(preset, s, R);
      const enterPool = this.pool("enter", (PR, n) => {
        let src = preset.enter.call(preset, s, PR).filter((p) => !p.preAge);
        if (preset.flip === "vx") src = src.filter((p) => p.vx >= 0);
        if (src.length === 0) src = preset.enter.call(preset, s, PR);
        return src.slice(0, n).sort((a, b) => preset.size(a) - preset.size(b));
      });
      for (const q of entered) {
        if (q.preAge) this.instance("spawn", spawnPool, q, 0);
        else this.instance("enter", enterPool, q, 0);
      }
    } else if (!this.intro && preset.enter && preset.id === "bokeh") {
      // bokeh/fireflies' pre-aged "enter" only fills the first intro frame;
      // the loop reaches the same density through the wrap-around.
    }
    for (const f of this.spawnTimes(rate)) {
      const q = preset.spawn(s, R);
      if (q.pool === "gutter" && gutterPool) this.instance("gutter", gutterPool, q, f);
      else this.instance("spawn", spawnPool, q, f);
    }
  }

  /* ---- fireworks: rocket + burst of sparks ---- */
  fireworks() {
    const R = this.rng;
    const rate = this.preset.rate[this.intro ? 0 : 1];
    const sparkAsset = (color) => {
      const id = `spark:${color}`;
      if (this.assetIds.has(id)) return this.assetIds.get(id);
      // one spark flying along +x with the reference drag, fading over 1.35 s
      const life = Math.round(1.35 * FPS);
      const xs = [];
      let x = 0, vx = 100;
      for (let f = 0; f <= life; f += 1) {
        xs.push(PC[0] + x * K);
        for (let i = 0; i < SUB; i += 1) { x += vx / (FPS * SUB); vx *= 0.985; }
      }
      const op = [];
      for (let f = 0; f <= life; f += 1) op.push(100 * (1 - f / life));
      const shapes = [group([rect(k(4), k(1.8), k(0.9)), fill(color)])];
      return this.asset(id, [
        shapeLayer("spark", shapes, {
          p: { s: true, x: animScalar(xs, EPS_POS * K, r1), y: { a: 0, k: PC[1] } },
          o: animScalar(op, EPS_OP, Math.round),
        }, life + 1),
      ]);
    };
    const burstAsset = (col, vi) => {
      const id = `burst:${col}:${vi}`;
      if (this.assetIds.has(id)) return this.assetIds.get(id);
      const BR = makeRng(hashSeed(`fireworks:${this.mode}:burst:${col}:${vi}`));
      const n = BR.RI(30, 44);
      const sp = BR.R(70, 130);
      const life = Math.round(1.6 * FPS);
      // gravity (g = 70 with the same drag) carried by a parent null
      const ys = [];
      let y = 0, vy = 0;
      for (let f = 0; f <= life; f += 1) {
        ys.push(PC[1] + y * K);
        for (let i = 0; i < SUB; i += 1) { vy += 70 / (FPS * SUB); vy *= 0.985; y += vy / (FPS * SUB); }
      }
      const layers = [{
        ty: 3,
        ind: 1,
        ip: 0,
        op: life + 1,
        st: 0,
        sr: 1,
        ks: { a: { a: 0, k: [0, 0, 0] }, p: { s: true, x: { a: 0, k: PC[0] }, y: animScalar(ys, EPS_POS * K, r1) }, o: { a: 0, k: 0 } },
      }];
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * TAU;
        const speed = (sp / 100) * BR.R(0.7, 1);
        const color = BR.next() < 0.2 ? "#fff7e6" : pal(col);
        const ref = sparkAsset(color);
        layers.push({
          ty: 0,
          refId: ref,
          ind: i + 2,
          parent: 1,
          ip: 0,
          op: life + 1,
          st: 0,
          sr: 1,
          w: PW,
          h: PH,
          ks: {
            a: { a: 0, k: PC },
            p: { a: 0, k: [0, 0] },
            r: { a: 0, k: r1(a * DEG) },
            s: { a: 0, k: [r1(speed * 100), 100] },
          },
        });
      }
      return this.asset(id, layers);
    };
    const rocketAsset = (col, vi) => {
      const id = `fw:${col}:${vi}`;
      if (this.rockets.has(id)) return this.rockets.get(id);
      const FR = makeRng(hashSeed(`fireworks:${this.mode}:rocket:${col}:${vi}`));
      let x = 0, y = 0, vx = FR.R(-15, 15), vy = -FR.R(300, 380);
      const xs = [], ys = [];
      let f = 0;
      while (vy <= -50 && f < 6 * FPS) {
        // the reference screen is 480 units tall and the cover is shorter:
        // scale the climb so bursts open at the same height fraction (~30%).
        xs.push(PC[0] + x * K);
        ys.push(PC[1] + y * K * (REF_H / 480));
        for (let i = 0; i < SUB; i += 1) {
          const dt = 1 / (FPS * SUB);
          x += vx * dt; y += vy * dt; vy += 170 * dt;
        }
        f += 1;
      }
      const burstAt = f;
      const burst = burstAsset(col, vi);
      const rocket = shapeLayer("rocket", [
        group([rect(k(1.4), k(9), k(0.7), [0, k(4.5)]), fill(pal(col), 70)]),
        group([ellipse(k(3.2), k(3.2)), fill(pal(col))]),
      ], {
        p: { s: true, x: animScalar(xs, EPS_POS * K, r1), y: animScalar(ys, EPS_POS * K, r1) },
      }, burstAt, { ind: 1 });
      rocket.op = burstAt;
      const total = burstAt + Math.round(1.6 * FPS) + 1;
      const burstLayer = {
        ty: 0,
        refId: burst,
        ind: 2,
        ip: burstAt,
        op: total,
        st: burstAt,
        sr: 1,
        w: PW,
        h: PH,
        ks: { a: { a: 0, k: PC }, p: { a: 0, k: [r1(xs[xs.length - 1]), r1(ys[ys.length - 1])] } },
      };
      const out = { ref: this.asset(id, [rocket, burstLayer]), total };
      this.rockets.set(id, out);
      return out;
    };
    const variants = [];
    for (let col = 0; col <= 3; col += 1) for (let vi = 0; vi < 2; vi += 1) variants.push([col, vi]);
    const times = this.spawnTimes(rate);
    for (const f of times) {
      const [col, vi] = R.pick(variants);
      const fw = rocketAsset(col, vi);
      const ref = fw.ref;
      const total = fw.total;
      const x = R.R(REF_W * 0.15, REF_W * 0.85) * K;
      const ks = { p: { a: 0, k: [r1(x), r1(COMP_H + 5)] } };
      if (this.intro) {
        this.layers.push(precompLayer(ref, this.ind++, ks, f, f + total, f));
      } else {
        for (const st of this.loopStarts(f, total)) this.layers.push(precompLayer(ref, this.ind++, ks, st, st + total, st));
      }
    }
  }

  /* ---- rain: a falling streak, then a splash ring at the bottom ---- */
  rain() {
    const preset = this.preset;
    const R = this.rng;
    const rate = preset.rate[this.intro ? 0 : 1];
    const dropAsset = (vi) => {
      const id = `drop:${vi}`;
      if (this.assetIds.has(id)) return this.assetIds.get(id);
      const DR = makeRng(hashSeed(`rain:${this.mode}:${vi}`));
      const vy = DR.R(380, 520), len = DR.R(9, 16), vx = -40;
      const fallSec = (REF_H - 4 + 16) / vy;
      const fallF = Math.round(fallSec * FPS);
      const endX = vx * fallSec;
      const drop = shapeLayer("drop", [
        group([polygon(kp([[0, 0], [vx * 0.025, -len]]), false), stroke("#bed7ff", k(1), 38)]),
      ], {
        p: {
          s: true,
          x: { a: 1, k: [{ t: 0, s: [PC[0]], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } }, { t: fallF, s: [r1(PC[0] + endX * K)] }] },
          y: { a: 1, k: [{ t: 0, s: [PC[1]], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } }, { t: fallF, s: [r1(PC[1] + (REF_H - 4 + 16) * K)] }] },
        },
      }, fallF, { ind: 1 });
      const spF = Math.round(0.35 * FPS);
      const splash = shapeLayer("splash", [
        group([
          { ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 1, k: [{ t: fallF, s: [k(4), k(2)], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } }, { t: fallF + spF, s: [r1(k(18)), r1(k(6))] }] } },
          stroke("#bed7ff", k(0.8), 50),
        ]),
      ], {
        p: { a: 0, k: [r1(PC[0] + endX * K), r1(PC[1] + (REF_H - 6 + 16) * K)] },
        o: { a: 1, k: [{ t: fallF, s: [100], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } }, { t: fallF + spF, s: [0] }] },
      }, fallF + spF, { ind: 2, ip: fallF });
      const total = fallF + spF;
      return { ref: this.asset(id, [drop, splash]), total };
    };
    const n = preset.variants ?? 6;
    const drops = [];
    for (let vi = 0; vi < n; vi += 1) drops.push(dropAsset(vi));
    for (const f of this.spawnTimes(rate)) {
      const d = R.pick(drops);
      const x = R.R(-20, REF_W + 20) * K;
      const ks = { p: { a: 0, k: [r1(x), r1(-16 * K)] } };
      if (this.intro) this.layers.push(precompLayer(d.ref, this.ind++, ks, f, f + d.total, f));
      else for (const st of this.loopStarts(f, d.total)) this.layers.push(precompLayer(d.ref, this.ind++, ks, st, st + d.total, st));
    }
  }

  /* ---- love burst: a beating cover heart sending out rings of hearts ---- */
  loveBurst(ctx) {
    const per = this.intro ? 0.7 : 1.2;
    const perF = Math.round(per * FPS);
    const cx = REF_W / 2, cy = REF_H * 0.22 * (480 / REF_H);
    const beatAt = (t) => Math.exp(-((t % per) / per) * 6);
    const scale = ctx.sample((t) => 100 * (1 + 0.14 * beatAt(t)));
    const glowOp = ctx.sample((t) => 100 * ((0.25 + 0.25 * beatAt(t)) / 0.5));
    const r = REF_W * 0.34;
    const big = shapeLayer("bigheart", [
      { ...glowDisc(k(r * 1.7), pal(0), 0.5), nm: "beat-glow" },
      ...heartLook(r, pal(0), pal(2)),
    ], {
      p: { a: 0, k: [r1(k(cx)), r1(k(cy))] },
      s: animScale(scale.map((v) => [v, v]), 1.5),
    }, ctx.frames);
    // the glow follows the beat through the first group's opacity
    const glowGroup = big.shapes.find((g) => g.nm === "beat-glow");
    glowGroup.it[glowGroup.it.length - 1].o = animScalar(glowOp, 2, Math.round);
    const R = this.rng;
    const smallAsset = (key) => {
      const id = `small:${key}`;
      if (this.assetIds.has(id)) return this.assetIds.get(id);
      // one small heart flying outward along +x with drag .965, shrinking to
      // 60% and fading over 1.6 s; drawn rotated so it faces outward.
      const life = Math.round(1.6 * FPS);
      const RR = makeRng(hashSeed(`love_burst:${key}`));
      const sp = RR.R(70, 120);
      const sz = RR.R(8, 13);
      const xs = [], sc = [], op = [];
      let x = 0, v = sp;
      for (let f = 0; f <= life; f += 1) {
        const a = 1 - f / life;
        xs.push(PC[0] + x * K);
        sc.push([(0.6 + 0.4 * a) * 100, (0.6 + 0.4 * a) * 100]);
        op.push(a * 100);
        for (let i = 0; i < SUB; i += 1) { v *= 0.965; x += v / (FPS * SUB); }
      }
      const [ca, cb] = key.split("~");
      return this.asset(id, [shapeLayer("h", [group(heartLook(sz, ca, cb), { r: 90 })], {
        p: { s: true, x: animScalar(xs, EPS_POS * K, r1), y: { a: 0, k: PC[1] } },
        s: animScale(sc, EPS_SCALE),
        o: animScalar(op, EPS_OP, Math.round),
      }, life + 1)]);
    };
    const ringAsset = (vi) => {
      const id = `ring:${vi}`;
      if (this.assetIds.has(id)) return this.assetIds.get(id);
      const RR = makeRng(hashSeed(`love_burst:${this.mode}:ring:${vi}`));
      const n = this.intro ? 14 : 9;
      const life = Math.round(1.6 * FPS);
      const layers = [];
      for (let i = 0; i < n; i += 1) {
        const a = (i / n) * TAU + RR.R(-0.1, 0.1);
        const [ca, cb] = loveCols(RR);
        layers.push({ ty: 0, refId: smallAsset(`${ca}~${cb}`), ind: i + 1, ip: 0, op: life + 1, st: 0, sr: 1, w: PW, h: PH, ks: { a: { a: 0, k: PC }, p: { a: 0, k: PC }, r: { a: 0, k: r1(a * DEG) } } });
      }
      return this.asset(id, layers);
    };
    const rings = [ringAsset(0), ringAsset(1), ringAsset(2)];
    const life = Math.round(1.6 * FPS) + 1;
    const out = [];
    for (let f = 0; f < this.frames; f += perF) {
      const ref = R.pick(rings);
      const ks = { p: { a: 0, k: [r1(k(cx)), r1(k(cy))] } };
      if (this.intro) this.layers.push(precompLayer(ref, this.ind++, ks, f, f + life, f));
      else for (const st of this.loopStarts(f, life)) this.layers.push(precompLayer(ref, this.ind++, ks, st, st + life, st));
    }
    // the big heart sits UNDER its rings? No — rings pop out from behind it in
    // the reference (rings are particles drawn after `pre`), so rings stay on
    // top and the heart goes into the scene list.
    out.push(big);
    return out;
  }
}

/* ------------------------------------------------------------------ main -- */

export const SLUG_ORDER = P.map((p) => p.id);
export const PRESET_GROUPS = Object.fromEntries(P.map((p) => [p.id, p.group]));

export function buildAnimation(slug, mode) {
  const preset = P.find((p) => p.id === slug);
  if (!preset) throw new Error(`unknown slug ${slug}`);
  return new Builder(preset, mode).build();
}

function main() {
  const only = process.argv.slice(2);
  mkdirSync(OUT_DIR, { recursive: true });
  const rows = [];
  for (const preset of P) {
    if (only.length && !only.includes(preset.id)) continue;
    for (const mode of ["intro", "loop"]) {
      const json = JSON.stringify(buildAnimation(preset.id, mode));
      writeFileSync(join(OUT_DIR, `${preset.id}.${mode}.json`), json);
      rows.push([`${preset.id}.${mode}.json`, json.length]);
    }
  }
  const width = Math.max(...rows.map((r) => r[0].length));
  for (const [name, size] of rows) console.log(`${name.padEnd(width)}  ${(size / 1024).toFixed(1).padStart(6)} KB`);
  const over = rows.filter((r) => r[1] > 150 * 1024);
  if (over.length) {
    console.error(`over the 150 KB budget: ${over.map((r) => r[0]).join(", ")}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
