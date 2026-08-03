/**
 * issue #1027 — Thread A (native keyboard/viewport) · Symptom 1 · TESTER
 * ADVERSARIAL regression. Different angle from the implementor's happy-path
 * suite (`mapboxAddressInputKeyboardCap.1027.test.ts`), which only source-regexes
 * the formula's TEXT. This suite EXECUTES the REAL, shipped `computeDropdownMaxHeight`
 * across the boundary / over-constrain / no-keyboard matrix and asserts the
 * BEHAVIOUR the regex cannot prove.
 *
 * WHY EXTRACT-AND-EXECUTE (not `import`): the shared module does `import React
 * from "react"`, which is unresolvable FROM `packages/` under the biz jest config
 * (mingla-business owns the only real react copy) — an import of the whole .tsx
 * fails at module load (independently verified by the tester: "Cannot find module
 * 'react' from '../packages/location-input/src/MapboxAddressInput.tsx'"). So this
 * suite reads the REAL package source, extracts the exact `computeDropdownMaxHeight`
 * body + its three constants VERBATIM (brace-matched, no reimplementation),
 * transpiles that isolated snippet with the repo's own TypeScript, and runs it.
 * The function under test is therefore the shipped source text, executed — not a
 * copy authored here.
 *
 * ADVERSARIAL ANGLES (none covered behaviourally by the implementor suite):
 *   - OVER-CONSTRAIN: keyboard top ABOVE the card top (keyboard height ≥ the space,
 *     availableBelow ≤ 0) MUST floor to MIN_DROPDOWN_HEIGHT, never 0 / negative —
 *     the list must stay a usable, scrollable window and must NOT collapse.
 *   - NO-KEYBOARD companion: a hidden keyboard (screenY = Infinity) MUST fall back
 *     to the token, so nobody "fixes" the cap by hard-coding a small constant that
 *     shrinks the dropdown when there is no keyboard at all.
 *   - iOS accessory geometry: iOS reserves 44 more than Android for the same
 *     card/keyboard geometry (a dropped accessory term would silently regress SE).
 *   - Token stays an UPPER BOUND, never a floor-breaker.
 *   - Fuzz invariant: for any finite geometry the result is in
 *     [MIN, max(MIN, token)] — never unbounded, never < MIN.
 *
 * FAILS-ON-REVERT (tester-verified): remove the `Math.max(MIN_DROPDOWN_HEIGHT, …)`
 * floor → the over-constrain / zero-available cases return ≤ 0 and these tests go
 * RED; drop the `!Number.isFinite(keyboardScreenY)` guard → the no-keyboard case
 * stops returning the token and goes RED; drop the iOS `accessory` term → the
 * iOS-vs-Android delta assertion goes RED.
 *
 * I-PROPOSED-1027-KEYBOARD-AWARE-DROPDOWN-CAP.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

// ── Extract the REAL constants + function body from the shipped package source ──
const SOURCE_PATH = path.join(
  process.cwd(),
  "../packages/location-input/src/MapboxAddressInput.tsx",
);

/** Brace-match a `{ … }` block starting at the first `{` after `bodyAnchor`. */
function sliceBalanced(src: string, start: number, bodyAnchor: string): string {
  const anchorAt = src.indexOf(bodyAnchor, start);
  if (anchorAt === -1) throw new Error(`anchor not found: ${bodyAnchor}`);
  const open = src.indexOf("{", anchorAt);
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return src.slice(start, i);
}

type CapFn = (p: {
  keyboardScreenY: number;
  cardTopY: number | null;
  tokenMaxHeight: number;
  isIOS: boolean;
}) => number;

interface CapModule {
  computeDropdownMaxHeight: CapFn;
  DROPDOWN_SAFETY_MARGIN: number;
  DROPDOWN_KEYBOARD_ACCESSORY_ALLOWANCE: number;
  MIN_DROPDOWN_HEIGHT: number;
}

function loadRealCapModule(): CapModule {
  const src = readFileSync(SOURCE_PATH, "utf8");
  const c1 = src.match(/export const DROPDOWN_SAFETY_MARGIN\s*=\s*[^;]+;/);
  const c2 = src.match(
    /export const DROPDOWN_KEYBOARD_ACCESSORY_ALLOWANCE\s*=\s*[^;]+;/,
  );
  const c3 = src.match(/export const MIN_DROPDOWN_HEIGHT\s*=\s*[^;]+;/);
  if (c1 === null || c2 === null || c3 === null) {
    throw new Error("cap constants not found in package source");
  }
  const fnStart = src.indexOf("export function computeDropdownMaxHeight");
  const fn = sliceBalanced(src, fnStart, "): number {");
  const moduleText = [c1[0], c2[0], c3[0], fn].join("\n\n");

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ts = require("typescript") as {
    transpileModule: (
      input: string,
      opts: { compilerOptions: Record<string, unknown> },
    ) => { outputText: string };
    ModuleKind: { CommonJS: number };
    ScriptTarget: { ES2019: number };
  };
  const js = ts.transpileModule(moduleText, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2019,
    },
  }).outputText;

  const mod = { exports: {} as Record<string, unknown> };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function("module", "exports", js)(mod, mod.exports);
  const out = mod.exports as unknown as CapModule;
  if (typeof out.computeDropdownMaxHeight !== "function") {
    throw new Error("failed to load computeDropdownMaxHeight from source");
  }
  return out;
}

const M = loadRealCapModule();
const cap = M.computeDropdownMaxHeight;

describe("issue #1027 · Symptom 1 ADVERSARIAL — the shipped cap function executed", () => {
  test("the extracted constants match the shipped contract (8 / 44 / 96)", () => {
    expect(M.DROPDOWN_SAFETY_MARGIN).toBe(8);
    expect(M.DROPDOWN_KEYBOARD_ACCESSORY_ALLOWANCE).toBe(44);
    expect(M.MIN_DROPDOWN_HEIGHT).toBe(96);
  });

  test("OVER-CONSTRAIN: keyboard top ABOVE the card floors to MIN — never collapses to 0/negative", () => {
    // keyboard's top (100) is far ABOVE the card's top (500): availableBelow is
    // deeply negative. The dropdown must NOT vanish — it floors to a scrollable MIN.
    const r = cap({
      keyboardScreenY: 100,
      cardTopY: 500,
      tokenMaxHeight: 9999,
      isIOS: false,
    });
    expect(r).toBe(M.MIN_DROPDOWN_HEIGHT);
    expect(r).toBeGreaterThan(0);
  });

  test("ZERO available space (keyboard exactly at the card bottom) still floors to MIN", () => {
    // 600 - 592 - 8 (margin) - 0 = 0 → floored to MIN, still scrollable.
    const r = cap({
      keyboardScreenY: 600,
      cardTopY: 592,
      tokenMaxHeight: 9999,
      isIOS: false,
    });
    expect(r).toBe(M.MIN_DROPDOWN_HEIGHT);
  });

  test("NO-KEYBOARD companion: hidden keyboard (Infinity) falls back to the token, never a small hard cap", () => {
    // Guards the over-correction: when there is NO keyboard the dropdown must be
    // exactly today's token-driven height (280 consumer-light / 9999 business).
    expect(
      cap({
        keyboardScreenY: Number.POSITIVE_INFINITY,
        cardTopY: 120,
        tokenMaxHeight: 280,
        isIOS: false,
      }),
    ).toBe(280);
    expect(
      cap({
        keyboardScreenY: Number.POSITIVE_INFINITY,
        cardTopY: 120,
        tokenMaxHeight: 9999,
        isIOS: true,
      }),
    ).toBe(9999);
  });

  test("unmeasured card (cardTopY === null) also falls back to the token", () => {
    expect(
      cap({
        keyboardScreenY: 600,
        cardTopY: null,
        tokenMaxHeight: 280,
        isIOS: false,
      }),
    ).toBe(280);
  });

  test("iOS reserves 44 MORE than Android for identical card/keyboard geometry", () => {
    const geometry = { keyboardScreenY: 720, cardTopY: 400, tokenMaxHeight: 9999 };
    const android = cap({ ...geometry, isIOS: false }); // 720-400-8 = 312
    const ios = cap({ ...geometry, isIOS: true }); // 720-400-8-44 = 268
    expect(android).toBe(312);
    expect(ios).toBe(268);
    expect(android - ios).toBe(M.DROPDOWN_KEYBOARD_ACCESSORY_ALLOWANCE);
  });

  test("the token is an UPPER BOUND: when the measured space exceeds the token, the token wins", () => {
    // availableBelow = 900-100-8 = 792, but the token (200) caps it.
    expect(
      cap({
        keyboardScreenY: 900,
        cardTopY: 100,
        tokenMaxHeight: 200,
        isIOS: false,
      }),
    ).toBe(200);
  });

  test("INVARIANT (fuzz): for any finite geometry the result is in [MIN, max(MIN, token)]", () => {
    for (let i = 0; i < 500; i++) {
      const keyboardScreenY = Math.round(Math.random() * 1200);
      const cardTopY = Math.round(Math.random() * 1200);
      const tokenMaxHeight = Math.round(Math.random() * 500) + 1;
      const isIOS = Math.random() < 0.5;
      const r = cap({ keyboardScreenY, cardTopY, tokenMaxHeight, isIOS });
      expect(r).toBeGreaterThanOrEqual(M.MIN_DROPDOWN_HEIGHT);
      expect(r).toBeLessThanOrEqual(Math.max(M.MIN_DROPDOWN_HEIGHT, tokenMaxHeight));
      expect(Number.isFinite(r)).toBe(true);
    }
  });
});
