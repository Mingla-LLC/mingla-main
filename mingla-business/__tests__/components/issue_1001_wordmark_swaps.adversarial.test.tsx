import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

// ISSUE-1001 [brand logo consolidation] — TESTER ADVERSARIAL suite (reserved
// path, SPEC #1001 §4.6). Attack angles DELIBERATELY DIFFERENT from the
// implementor happy-path suite (issue_1001_wordmark_swaps.test.ts):
//
//   B1  TEXT-WORDMARK RESURRECTION, broad-regex form: the happy-path suite
//       pins exact strings; this one bans ANY sole-content Text wordmark in
//       ALL THREE swapped components (mingla-business PANE + GATE, and the
//       app-mobile ShareModal reached via the repo root) — case-insensitive,
//       tolerant of letter-spacing tricks ("M I N G L A"), quoted-expression
//       children ({"Mingla"} / {`MINGLA`}), and multiline JSX.
//   B2  tintColor must be a PROP on the wordmark Image (react-native-web 0.21
//       implements only the prop form) — and must NOT sneak into the style
//       object (the deprecated form silently no-ops the accent on web).
//   B3  every swapped wordmark Image carries accessibilityLabel="Mingla".
//   B4  ORPHANED-STYLE RESURRECTION: the deleted style keys (minglaDot,
//       minglaText, miniglaLogo, and GATE's text `kicker`) must stay deleted;
//       their replacements (minglaWordmark, miniglaLogoImg, kickerLogo) must
//       exist. A revert that re-adds the text badge re-adds these keys.
//   B5  the @mingla/brand-assets import must survive in all three files (a
//       revert usually deletes the import first).
//
// House pattern: source scan, no render (per BusinessWelcomeScreenLogo tests).
// fails-on-revert: reverting SeeWhosGoingGate.tsx or ShareModal.tsx to their
// pre-#1001 shape fails B1/B2/B4/B5 here.

const bizRoot = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(bizRoot, "..");

const FILES = {
  pane: path.join(
    bizRoot,
    "src/components/marketing/EmailPreviewPane.tsx",
  ),
  gate: path.join(bizRoot, "src/components/event/SeeWhosGoingGate.tsx"),
  share: path.join(repoRoot, "app-mobile/src/components/ShareModal.tsx"),
} as const;

const read = (p: string): string => fs.readFileSync(p, "utf8");

// Sole-content Text wordmark, any case, any inter-letter whitespace, plain or
// quoted-expression child, multiline tolerant. Legit copy ("via Mingla",
// "the Mingla app") is never SOLE content, so it cannot false-positive.
const TEXT_WORDMARK_RESURRECTION =
  /<Text\b[^>]*>\s*(?:\{\s*)?["'`]?\s*M\s*I\s*N\s*G\s*L\s*A\s*["'`]?\s*(?:\}\s*)?<\/Text>/i;

/** All self-closing <Image .../> JSX blocks in a source string. */
const imageBlocks = (src: string): string[] =>
  src.match(/<Image\b[\s\S]*?\/>/g) ?? [];

/** The wordmark Image block (source={MINGLA_WORDMARK}) or null. */
const wordmarkImage = (src: string): string | null =>
  imageBlocks(src).find((b) => b.includes("source={MINGLA_WORDMARK}")) ?? null;

describe("ISSUE-1001 adversarial — all three swapped components exist on disk", () => {
  test.each(Object.entries(FILES))("%s source is readable", (_name, p) => {
    expect(fs.existsSync(p)).toBe(true);
  });
});

describe.each([
  ["EmailPreviewPane", FILES.pane],
  ["SeeWhosGoingGate", FILES.gate],
  ["ShareModal", FILES.share],
])("ISSUE-1001 adversarial — %s", (name, file) => {
  const source = read(file);

  test("B1: no sole-content Text wordmark survives under the broad regex", () => {
    expect(source).not.toMatch(TEXT_WORDMARK_RESURRECTION);
  });

  test("B5: the @mingla/brand-assets wordmark import survives", () => {
    expect(source).toMatch(
      /import\s*\{\s*MINGLA_WORDMARK\s*\}\s*from\s*["']@mingla\/brand-assets["']/,
    );
  });

  test("B3: the swapped wordmark Image exists and carries accessibilityLabel=\"Mingla\"", () => {
    const img = wordmarkImage(source);
    expect(img).not.toBeNull();
    expect(img as string).toContain('accessibilityLabel="Mingla"');
    expect(img as string).toContain('resizeMode="contain"');
  });
});

describe("ISSUE-1001 adversarial — GATE tint contract (B2)", () => {
  const source = read(FILES.gate);

  test("tintColor={palette.accent} is a PROP on the wordmark Image", () => {
    const img = wordmarkImage(source);
    expect(img).not.toBeNull();
    expect(img as string).toContain("tintColor={palette.accent}");
  });

  test("tintColor does NOT hide in the kickerLogo style object (deprecated web form)", () => {
    const style = source.match(/kickerLogo:\s*\{([\s\S]*?)\}/);
    expect(style).not.toBeNull();
    expect((style as RegExpMatchArray)[1]).not.toContain("tintColor");
  });

  test("no hardcoded tint sneaks in beside the palette accent", () => {
    const img = wordmarkImage(source) as string;
    // Exactly one tintColor binding, and it is the theme accent, not a hex.
    expect(img.match(/tintColor=/g)).toHaveLength(1);
    expect(img).not.toMatch(/tintColor=["']#/);
  });
});

describe("ISSUE-1001 adversarial — orphaned-style resurrection (B4)", () => {
  test("ShareModal: minglaDot/minglaText stay deleted; minglaWordmark exists", () => {
    const source = read(FILES.share);
    expect(source).not.toMatch(/\bminglaDot\s*:/);
    expect(source).not.toMatch(/\bminglaText\s*:/);
    expect(source).toMatch(/\bminglaWordmark\s*:\s*\{/);
  });

  test("EmailPreviewPane: miniglaLogo (text style) stays deleted; miniglaLogoImg exists", () => {
    const source = read(FILES.pane);
    expect(source).not.toMatch(/\bminiglaLogo\s*:\s*\{/);
    expect(source).toMatch(/\bminiglaLogoImg\s*:\s*\{/);
  });

  test("SeeWhosGoingGate: text `kicker` style stays deleted; kickerLogo exists", () => {
    const source = read(FILES.gate);
    expect(source).not.toMatch(/\n\s*kicker\s*:\s*\{/);
    expect(source).toMatch(/\bkickerLogo\s*:\s*\{/);
    // The orch-1342 gate contract must survive the swap.
    expect(source).toContain('testID="orch-1342-gate-close"');
    expect(source).toContain('testID="orch-1342-gate-qr"');
  });
});
