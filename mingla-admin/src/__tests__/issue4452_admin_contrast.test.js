// #4452 §7.1 (T-7.1): the Admin refresh tokens meet WCAG AA (4.5:1) in light
// and dark, and the old --color-* variables map onto them.
//
// FAILS-ON-REVERT: restoring --color-text-muted: #9ca3af (2.5:1) fails the
// mapping case; a white primary-button hover (3.0:1) fails the hover pair;
// dropping the dark token block fails the dark cases.
//
// Run: node --test src/__tests__/issue4452_admin_contrast.test.js (from mingla-admin).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(SRC, "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function blockFrom(open) {
  let depth = 1, i = open + 1;
  while (depth && i < css.length) { if (css[i] === "{") depth++; else if (css[i] === "}") depth--; i++; }
  return css.slice(open + 1, i - 1);
}
function block(selectorRe) {
  const m = css.match(selectorRe);
  assert.ok(m, `block ${selectorRe}`);
  return blockFrom(css.indexOf("{", m.index));
}
function vars(text) {
  const out = {};
  for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
}
// Light = the :root block that holds the --a-* set; dark = [data-theme="dark"] over it.
const at = css.indexOf("--a-panel:#ffffff");
assert.ok(at > 0, "the light token set");
const LIGHT = vars(blockFrom(css.lastIndexOf("{", at)));
const DARK = { ...LIGHT, ...vars(block(/\n\[data-theme="dark"\]\s*\{/)) };
const MEDIA_DARK = { ...LIGHT, ...vars(block(/:root:not\(\[data-theme="light"\]\)\s*\{/)) };

function resolve(env, v, depth = 0) {
  assert.ok(depth < 10, "var loop");
  const m = /^var\((--[a-z0-9-]+)\)$/i.exec(v);
  if (!m) return v;
  assert.ok(env[m[1]] !== undefined, `undefined ${m[1]}`);
  return resolve(env, env[m[1]], depth + 1);
}
function lum(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(env, fg, bg) {
  const a = lum(resolve(env, fg.startsWith("#") ? fg : env[fg] ?? fg));
  const b = lum(resolve(env, bg.startsWith("#") ? bg : env[bg] ?? bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const PAIRS = [
  ["--a-text", "--a-panel"], ["--a-text", "--a-bg"],
  ["--a-muted", "--a-panel"], ["--a-muted", "--a-bg"], ["--a-muted", "--a-soft"],
  ["--a-dim", "--a-panel"], ["--a-dim", "--a-bg"], ["--a-dim", "--a-soft"],
  ["--a-chip-ink", "--a-chip"],
  ["--a-live-ink", "--a-live-bg"], ["--a-stop-ink", "--a-stop-bg"], ["--a-sched-ink", "--a-sched-bg"],
  ["--a-panel", "--a-text"],
  ["--a-hover-ink", "--a-hover-bg"],
  // Pass 2: the refreshed menu reads these tokens.
  ["--sidebar-active-text", "--sidebar-active-bg"], ["--sidebar-text", "--sidebar-bg"], ["--sidebar-text-dim", "--sidebar-bg"],
  ["--a-chip-ink", "--a-chip"], ["--a-draft-ink", "--a-soft"],
];

describe("#4452 T-7.1 admin contrast", () => {
  for (const [name, env] of [["light", LIGHT], ["dark", DARK], ["dark (OS, before the toggle)", MEDIA_DARK]]) {
    it(`${name}: every pair is at least 4.5:1`, () => {
      for (const [fg, bg] of PAIRS) {
        const r = ratio(env, fg, bg);
        assert.ok(r >= 4.5, `${name} ${fg} on ${bg} = ${r.toFixed(2)}`);
      }
    });
  }

  it("the v13 expected values hold (±0.15)", () => {
    const near = (r, lo, hi, label) => assert.ok(r >= lo - 0.15 && r <= hi + 0.15, `${label} = ${r.toFixed(2)}`);
    // v13: light dim 4.7–4.9 and muted 5.3–5.6 (on the page and soft fills; on white they are higher).
    for (const bg of ["--a-bg", "--a-soft"]) {
      near(ratio(LIGHT, "--a-dim", bg), 4.7, 4.9, `light dim/${bg}`);
      near(ratio(LIGHT, "--a-muted", bg), 5.3, 5.6, `light muted/${bg}`);
    }
    near(ratio(LIGHT, "--a-chip-ink", "--a-chip"), 5.9, 5.9, "light chip");
    near(ratio(DARK, "--a-chip-ink", "--a-chip"), 6.8, 6.8, "dark chip");
    near(ratio(LIGHT, "--a-hover-ink", "--a-hover-bg"), 6.4, 6.4, "ink on orange hover");
    for (const env of [LIGHT, DARK]) {
      for (const k of ["live", "stop", "sched"]) assert.ok(ratio(env, `--a-${k}-ink`, `--a-${k}-bg`) >= 5.6 - 0.15, k);
    }
    assert.ok(ratio(LIGHT, "#ffffff", "#eb7825") < 4.5, "white on orange really is below AA (why the hover is ink)");
  });

  it("today's --color-* variables map onto the tokens (the 2.5:1 muted is gone)", () => {
    const map = {
      "--color-background-primary": "--a-panel", "--color-background-secondary": "--a-bg",
      "--color-text-primary": "--a-text", "--color-text-secondary": "--a-text2",
      "--color-text-tertiary": "--a-muted", "--color-text-muted": "--a-dim",
    };
    for (const env of [LIGHT, DARK]) {
      for (const [from, to] of Object.entries(map)) assert.equal(env[from], `var(${to})`, from);
    }
    assert.ok(ratio(LIGHT, "--color-text-muted", "--color-background-primary") >= 4.5);
    assert.equal(LIGHT["--brand-orange"], "#eb7825", "brand orange unchanged");
  });
});
