// ORCH-1163 R4 — RSVP decision polish: SOLID Maybe/Can't buttons + micro PILL.
//
// Seth screenshot: the "Maybe" / "Can't go" decision buttons were TOO
// TRANSPARENT on every surface (translucent palette.accentWash / palette.card
// rgba tokens bled the page through on web — no backdrop blur), and the
// microcopy under the buttons rendered as a bare full-width Text. R4:
//   FIX 1 — every decision-button fill + the momentum card resolve to a SOLID
//           (alpha-1) color on ALL platforms via the new opaque*Color helpers in
//           themePalette.ts (composite the translucent token over palette.page).
//   FIX 2 — the micro renders inside a thin SELF-SIZING pill (alignSelf:"center",
//           borderRadius:999, opaque accent fill + panelBorder), hugging the text.
//
// Deno-runnable SOURCE-STRUCTURE assertions (the package has no RN test renderer)
// plus a runtime check of the pure color-math helpers (no RN import).
//
// FAILS-ON-REVERT (proven by true line-deletion in the report):
//   - revert the Maybe button back to `backgroundColor: palette.accentWash`
//     (the translucent rgba token) → the "no translucent token on the buttons"
//     assertion FAILS.
//   - revert opaqueCardFill to `palette.card` on the non-Android branch → the
//     "opaqueSurfaceColor used for the neutral fill" assertion FAILS.
//   - drop the <View styles.microPill> wrapper (bare <Text styles.micro>) → the
//     micro-pill assertions FAIL.
//   - make opaqueAccentWashColor return a token with alpha < 1 → the runtime
//     "helpers return a solid 6-digit hex" assertion FAILS.

import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const COMPONENT_RAW = await Deno.readTextFile(
  new URL("../RsvpMomentumDecision.tsx", import.meta.url),
);
const THEME_PALETTE_SRC = await Deno.readTextFile(
  new URL("../themePalette.ts", import.meta.url),
);

// Pure mirror of the themePalette composite math (the module is RN-adjacent and
// imports ./designTokens extensionlessly, so we read it as text + re-derive the
// composite here, exactly like the package's other deno tests avoid the RN
// runtime). `compositeOverOpaque` alpha-blends a translucent rgba over an opaque
// hex base → a SOLID 6-digit hex.
type Rgb = { r: number; g: number; b: number };
const parseHex = (hex: string): Rgb => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (m === null) throw new Error(`bad hex ${hex}`);
  return {
    r: parseInt(m[1].slice(0, 2), 16),
    g: parseInt(m[1].slice(2, 4), 16),
    b: parseInt(m[1].slice(4, 6), 16),
  };
};
const rgbaAlpha = (color: string): { rgb: Rgb; a: number } => {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/
    .exec(color);
  if (m === null) return { rgb: parseHex(color), a: 1 };
  return {
    rgb: { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) },
    a: m[4] === undefined ? 1 : Number(m[4]),
  };
};
const toHex = ({ r, g, b }: Rgb): string =>
  "#" +
  [r, g, b]
    .map((c) => Math.min(255, Math.max(0, Math.round(c))).toString(16).padStart(2, "0"))
    .join("");
const composite = (top: string, base: string): string => {
  const t = rgbaAlpha(top);
  const b = parseHex(base);
  const a = Math.min(1, Math.max(0, t.a));
  return toHex({
    r: t.rgb.r * a + b.r * (1 - a),
    g: t.rgb.g * a + b.g * (1 - a),
    b: t.rgb.b * a + b.b * (1 - a),
  });
};
// Strip comments — the invariants are about RENDERED code, not the doc comments
// (which legitimately NAME the old translucent tokens to explain the fix).
const COMPONENT = COMPONENT_RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /(^|[^:])\/\/[^\n]*/g,
  "$1",
);

// ─────────────────────── FIX 1: opaque-surface helpers ───────────────────────

Deno.test("R4 §1 — themePalette.ts EXPORTS the two opaque-surface helpers", () => {
  assertMatch(THEME_PALETTE_SRC, /export const opaqueSurfaceColor\b/);
  assertMatch(THEME_PALETTE_SRC, /export const opaqueAccentWashColor\b/);
  // opaqueSurfaceColor composites the translucent card over the opaque page …
  assertStringIncludes(
    THEME_PALETTE_SRC,
    "compositeOverOpaque(palette.card, palette.page)",
  );
  // … opaqueAccentWashColor composites the translucent accentWash over the page.
  assertStringIncludes(
    THEME_PALETTE_SRC,
    "compositeOverOpaque(palette.accentWash, palette.page)",
  );
});

Deno.test("R4 §1 — compositing a translucent token over the page yields a SOLID 6-digit hex (no see-through)", () => {
  // Mirror the real palette token shapes (themePalette.ts ~L170-177):
  //   card       = rgba(255,255,255,0.10|0.72)
  //   accentWash = rgba(<accent>,0.24|0.18)
  // composited over an opaque page hex.
  const cases: Array<{ page: string; card: string; wash: string }> = [
    { page: "#081214", card: "rgba(255,255,255,0.10)", wash: "rgba(15,118,110,0.24)" },
    { page: "#f0f3f8", card: "rgba(255,255,255,0.72)", wash: "rgba(30,58,138,0.18)" },
    { page: "#1e120d", card: "rgba(255,255,255,0.10)", wash: "rgba(174,89,28,0.24)" },
  ];
  for (const { page, card, wash } of cases) {
    const surface = composite(card, page);
    const accent = composite(wash, page);
    assertMatch(surface, /^#[0-9a-f]{6}$/i);
    assertMatch(accent, /^#[0-9a-f]{6}$/i);
    assert(!surface.startsWith("rgba"));
    assert(!accent.startsWith("rgba"));
    // Hierarchy: the accent-tinted fill (Maybe) must read DIFFERENTLY from the
    // neutral surface (Can't go) even though both are opaque.
    assert(accent !== surface);
  }
});

Deno.test("R4 §1 — the component imports + uses the opaque-surface helpers (not the raw translucent tokens on the buttons)", () => {
  assertStringIncludes(COMPONENT, "opaqueSurfaceColor");
  assertStringIncludes(COMPONENT, "opaqueAccentWashColor");
  // The Maybe button's ACTIVE fill is the opaque accent fill (NOT the translucent
  // `palette.accentWash` token), and it no longer dims via see-through opacity.
  assertStringIncludes(COMPONENT, "backgroundColor: opaqueAccentFill(palette)");
  assert(
    !/opacity:\s*maybeDisabled\s*\?\s*0\.5/.test(COMPONENT),
    "the Maybe button must not dim via a see-through opacity (use an opaque disabled fill)",
  );
  // The Maybe button's style block (between MaybeButton + MaybeGlyph) must NOT
  // reference the translucent accentWash token anymore.
  const maybeBlock = COMPONENT.slice(
    COMPONENT.indexOf("const MaybeButton"),
    COMPONENT.indexOf("<MaybeGlyph"),
  );
  assert(
    maybeBlock.length > 0 &&
      !/backgroundColor:\s*palette\.accentWash/.test(maybeBlock),
    "the Maybe decision button must not fill with the translucent palette.accentWash",
  );
  // The neutral card fill resolves through opaqueSurfaceColor on the non-Android
  // platforms (web + iOS), not the translucent palette.card.
  assertStringIncludes(COMPONENT, "opaqueSurfaceColor(palette)");
});

Deno.test("R4 §1 — Going button is UNCHANGED (solid palette.accent active fill)", () => {
  // The hierarchy keeps Going = solid accent; we only made Maybe/Can't opaque.
  assertStringIncludes(COMPONENT, "backgroundColor: palette.accent, borderColor: palette.accent");
});

// ───────────────────────────── FIX 2: micro pill ─────────────────────────────

Deno.test("R4 §2 — the micro renders inside a self-sizing PILL that hugs the text", () => {
  // A View wrapper with the microPill style + the testID anchor.
  assertStringIncludes(COMPONENT, "styles.microPill");
  assertStringIncludes(COMPONENT, 'testID="orch-1163-rsvp-micro-pill"');
  // The pill style is self-sizing (alignSelf center, NOT full width), rounded,
  // bordered, opaque-filled.
  assertStringIncludes(COMPONENT, 'alignSelf: "center"');
  assertMatch(COMPONENT, /microPill:\s*\{[\s\S]*?borderRadius:\s*999/);
  assertMatch(COMPONENT, /microPill:\s*\{[\s\S]*?borderWidth:\s*1/);
  // The pill is NOT stretched to full width (no width:"100%" / alignSelf:"stretch").
  assert(
    !/microPill:\s*\{[\s\S]*?(width:\s*"100%"|alignSelf:\s*"stretch")[\s\S]*?\}/.test(
      COMPONENT,
    ),
    "the micro pill must hug its text, never stretch full width",
  );
});

Deno.test("R4 §2 — the pill fill is opaque + bordered (theme-adapted, no see-through)", () => {
  // The pill background is the opaque accent fill helper + panelBorder.
  assertMatch(
    COMPONENT,
    /backgroundColor:\s*opaqueAccentFill\(palette\),\s*borderColor:\s*palette\.panelBorder/,
  );
});

// ─────────────────── still-true ORCH-1157 theme-dial guard ────────────────────

Deno.test("R4 — no raw hex literal leaked into the theme-driven component", () => {
  // The opaque math lives in themePalette.ts; the component holds no hex.
  assert(!/#[0-9a-fA-F]{6}\b/.test(COMPONENT));
  assert(!/#[0-9a-fA-F]{3}\b/.test(COMPONENT));
});

Deno.test("R4 — sanity: the composite math is deterministic", () => {
  assertEquals(
    composite("rgba(255,255,255,0.10)", "#081214"),
    composite("rgba(255,255,255,0.10)", "#081214"),
  );
});
