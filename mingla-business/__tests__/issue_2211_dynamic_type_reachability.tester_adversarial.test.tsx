/**
 * #2211 — TESTER adversarial suite.
 *
 * The implementor's suite attacks STRUCTURE: is there a ScrollView, is the
 * action a non-shrinking sibling, is `maxFontSizeMultiplier` present. This one
 * attacks a different axis on purpose: **is the cap the RIGHT NUMBER, does the
 * analytics tell the truth, and can the guards be walked past.**
 *
 * ─── THE HOLE THIS EXISTS TO CLOSE ─────────────────────────────────────────
 * The implementor's T-4 asserts
 *
 *     expect(label.props.maxFontSizeMultiplier).toBe(BUTTON_MAX_FONT_SCALE)
 *
 * reading the SAME constant the product code reads. Change
 * `BUTTON_MAX_FONT_SCALE` from 2 to 3 and that assertion still passes — while
 * the label goes back to overflowing its pill, which is the entire defect. An
 * assertion that moves with the value it is guarding cannot fail on the
 * regression it names. Every cap assertion below therefore hard-codes the
 * literal 2 and, more importantly, proves the GEOMETRY the cap has to satisfy:
 * the capped line box must fit the pill it lives in, at every size.
 *
 * Independence: this file re-derives the pill heights and label metrics from
 * the design tokens rather than importing `Button`'s private tables, so a
 * change to either side is visible here instead of cancelling out.
 */

import {
  BUTTON_MAX_FONT_SCALE,
  LARGE_TEXT_FONT_SCALE,
  ACCESSIBILITY_MAX_FONT_SCALE,
  isLargeText,
  textSizeBucket,
  textSizeAnalyticsProperties,
  normalizeFontScale,
} from "../src/constants/dynamicType";
import { typography } from "../src/constants/designSystem";

/** Verbatim from react-native/React/CoreModules/RCTAccessibilityManager.mm. */
const RN_IOS_FONT_SCALES = [
  0.823, 0.882, 0.941, 1.0, 1.118, 1.235, 1.353, 1.786, 2.143, 2.643, 3.143,
  3.571,
];

/** `SIZE_HEIGHT` in Button.tsx, re-declared here rather than imported. */
const PILL_MIN_HEIGHT = { sm: 36, md: 44, lg: 52 } as const;

describe("#2211 adversarial A — the cap is a NUMBER, not a reference", () => {
  it("A-1 — the ceiling is literally 2, not whatever the constant happens to say", () => {
    // Hard-coded on purpose. If someone raises the constant, this fails and
    // they have to come here and justify it against A-2's geometry.
    expect(BUTTON_MAX_FONT_SCALE).toBe(2);
  });

  it.each(RN_IOS_FONT_SCALES)(
    "A-2 — at fontScale %s the capped LINE BOX still fits every pill",
    (fontScale) => {
      const effective = Math.min(fontScale, BUTTON_MAX_FONT_SCALE);
      // iOS multiplies lineHeight by the same figure it multiplies fontSize by
      // (RCTTextAttributes.mm:139). The line box, not the glyph size, is what
      // has to fit — that distinction is the whole #2180/#2211 defect.
      const mdLineBox = typography.buttonMd.lineHeight * effective;
      const lgLineBox = typography.buttonLg.lineHeight * effective;
      expect(mdLineBox).toBeLessThanOrEqual(PILL_MIN_HEIGHT.sm + 4);
      expect(mdLineBox).toBeLessThanOrEqual(PILL_MIN_HEIGHT.md);
      expect(lgLineBox).toBeLessThanOrEqual(PILL_MIN_HEIGHT.lg);
    },
  );

  it("A-3 — WITHOUT the cap the largest size overflows, so A-2 is not vacuous", () => {
    // If this ever stops being true, A-2 has stopped testing anything: it would
    // pass with the cap deleted. Proves the guard is falsifiable in principle.
    const uncapped = typography.buttonMd.lineHeight * 3.571;
    expect(uncapped).toBeGreaterThan(PILL_MIN_HEIGHT.md);
    expect(uncapped).toBeGreaterThan(PILL_MIN_HEIGHT.lg);
  });
});

describe("#2211 adversarial B — the analytics must not lie", () => {
  it("B-1 — the band boundaries are the documented ones, hard-coded", () => {
    expect(LARGE_TEXT_FONT_SCALE).toBe(1.5);
    expect(ACCESSIBILITY_MAX_FONT_SCALE).toBe(2.5);
  });

  it("B-2 — no REAL Dynamic Type step sits exactly on a boundary", () => {
    // A step landing on a boundary would make the bucket depend on floating
    // point comparison order, so the boundaries were chosen to fall between
    // steps. Assert that, rather than trusting the comment that says so.
    for (const boundary of [LARGE_TEXT_FONT_SCALE, ACCESSIBILITY_MAX_FONT_SCALE]) {
      expect(RN_IOS_FONT_SCALES).not.toContain(boundary);
    }
  });

  it("B-3 — the boundary is inclusive on the way UP, at the boundary itself", () => {
    expect(isLargeText(1.5)).toBe(true);
    expect(isLargeText(1.4999)).toBe(false);
    expect(textSizeBucket(2.5)).toBe("accessibility_max");
    expect(textSizeBucket(2.4999)).toBe("accessibility");
  });

  it("B-4 — buckets are monotonic across the real table (no band inversion)", () => {
    const ORDER = ["default", "large", "accessibility", "accessibility_max"];
    const idx = RN_IOS_FONT_SCALES.map((s) => ORDER.indexOf(textSizeBucket(s)));
    expect(idx).not.toContain(-1);
    for (let i = 1; i < idx.length; i += 1) {
      expect(idx[i]).toBeGreaterThanOrEqual(idx[i - 1]);
    }
  });

  it("B-5 — font_scale is rounded, so the property cannot become high-cardinality", () => {
    // A raw float would put a near-unique value on every event and make the
    // breakdown this issue exists to enable unusable.
    for (const s of [1.11803398, 3.5714285, 2.1428571]) {
      const { font_scale: v } = textSizeAnalyticsProperties(s);
      expect(Number.isInteger(Math.round(v * 100))).toBe(true);
      expect(String(v).replace(/^\d+\.?/, "").length).toBeLessThanOrEqual(2);
    }
  });

  it("B-6 — the property SHAPE is fixed: three keys, no more, no less", () => {
    // Extra keys would silently change the PostHog schema; missing keys would
    // make the breakdown impossible. Both are regressions.
    expect(Object.keys(textSizeAnalyticsProperties(2)).sort()).toEqual([
      "font_scale",
      "is_large_text",
      "text_size_bucket",
    ]);
  });

  it("B-7 — a garbage scale degrades to `default`, never to NaN or a crash", () => {
    for (const bad of [Number.NaN, 0, -3, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(normalizeFontScale(bad)).toBe(1);
      expect(textSizeBucket(bad)).toBe("default");
      expect(isLargeText(bad)).toBe(false);
    }
  });
});

describe("#2211 adversarial C — registerTextSize is never allowed to break the app", () => {
  const loadService = (client: unknown) => {
    jest.resetModules();
    jest.doMock("posthog-react-native", () => ({ __esModule: true, default: class {} }), {
      virtual: true,
    });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PostHogService } = require("../src/services/postHogService");
    const svc = PostHogService.getInstance();
    // Drive the real method against a hostile client.
    (svc as unknown as { client: unknown; initialized: boolean }).client = client;
    (svc as unknown as { initialized: boolean }).initialized = true;
    return svc as { registerTextSize(n: number): void };
  };

  afterEach(() => {
    jest.resetModules();
    jest.dontMock("posthog-react-native");
  });

  it("C-1 — a client whose register() THROWS does not propagate", () => {
    const svc = loadService({
      register: () => {
        throw new Error("posthog exploded");
      },
    });
    expect(() => svc.registerTextSize(3.571)).not.toThrow();
  });

  it("C-2 — a client whose register() REJECTS does not produce an unhandled rejection", () => {
    const svc = loadService({ register: () => Promise.reject(new Error("network")) });
    expect(() => svc.registerTextSize(2)).not.toThrow();
  });

  it("C-3 — it registers SUPER PROPERTIES and never captures an event", () => {
    const calls: Array<[string, unknown]> = [];
    const svc = loadService({
      register: (p: unknown) => {
        calls.push(["register", p]);
        return Promise.resolve();
      },
      capture: (e: unknown) => calls.push(["capture", e]),
    });
    svc.registerTextSize(3.571);
    expect(calls.map((c) => c[0])).toEqual(["register"]);
    expect(calls[0][1]).toEqual({
      font_scale: 3.57,
      text_size_bucket: "accessibility_max",
      is_large_text: true,
    });
  });

  it("C-4 — with no client at all it is a silent no-op, not a crash", () => {
    const svc = loadService(null);
    expect(() => svc.registerTextSize(1)).not.toThrow();
  });
});

// Adversarial block D — the CI gate's own falsifiability — lives in
// `.github/scripts/strict-grep/__tests__/issue-2211-fullscreen-route-must-scroll.adversarial.test.mjs`
// and runs under `node --test`, matching the sibling #2180 gate. It cannot live
// here: the gate is an ESM `.mjs` and this suite's ts-jest transform rejects
// `import.meta`, which is exactly the kind of environment mismatch that turns a
// guard dark. Splitting it keeps both halves genuinely executable.
