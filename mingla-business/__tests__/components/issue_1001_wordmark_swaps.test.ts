import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

// ISSUE-1001 [brand logo consolidation] — implementor HAPPY-PATH regression
// test for the two mingla-business text-wordmark → image swaps (SPEC §4.4
// W4-2 / W4-3). House pattern per BusinessWelcomeScreenLogo.test.tsx: source
// scan, no render.
//
// Pins:
//   - EmailPreviewPane renders the REAL wordmark image (90x32, mirroring the
//     server shell's 180px header at half scale) — never a styled "Mingla"
//     <Text> header. The "via Mingla" sender-identity COPY strings are
//     legitimate prose and exempt.
//   - SeeWhosGoingGate renders the wordmark image tinted to the event-theme
//     accent (tintColor={palette.accent}) — never the "MINGLA" text kicker.
//
// Tester adversarial surface is RESERVED at
// issue_1001_wordmark_swaps.adversarial.test.tsx — do not fold it in here.

const componentDir = path.resolve(__dirname, "../..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(componentDir, rel), "utf8");

const PANE = "src/components/marketing/EmailPreviewPane.tsx";
const GATE = "src/components/event/SeeWhosGoingGate.tsx";

describe("ISSUE-1001 — EmailPreviewPane wordmark swap (W4-2)", () => {
  const source = read(PANE);

  test("imports the canonical wordmark and renders it as an Image", () => {
    expect(source).toContain('import { MINGLA_WORDMARK } from "@mingla/brand-assets"');
    expect(source).toMatch(/<Image\s+source=\{MINGLA_WORDMARK\}/);
    const a11y = source.match(/accessibilityLabel="Mingla"/g) ?? [];
    expect(a11y.length).toBe(1);
  });

  test("no <Text> node renders 'Mingla' as the wordmark (copy strings exempt)", () => {
    // The removed header: <Text style={styles.miniglaLogo}>Mingla</Text>
    expect(source).not.toMatch(/<Text[^>]*>\s*Mingla\s*<\/Text>/);
    expect(source).not.toMatch(/miniglaLogo:\s*\{/); // orphaned style deleted
    // The exempt copy strings are exact-match prose, not wordmark renders.
    expect(source).toContain("via Mingla");
  });

  test("image is the half-scale echo of the server shell's header logo", () => {
    const style = source.match(/miniglaLogoImg:\s*\{([\s\S]*?)\}/);
    expect(style).not.toBeNull();
    expect(style![1]).toMatch(/width:\s*90/);
    expect(style![1]).toMatch(/height:\s*32/);
  });
});

describe("ISSUE-1001 — SeeWhosGoingGate kicker swap (W4-3)", () => {
  const source = read(GATE);

  test("imports the canonical wordmark and renders it accent-tinted", () => {
    expect(source).toContain('import { MINGLA_WORDMARK } from "@mingla/brand-assets"');
    const img = source.match(/<Image\s+source=\{MINGLA_WORDMARK\}[\s\S]*?\/>/);
    expect(img).not.toBeNull();
    // The tint MUST track the event-theme accent (palette.accent is
    // theme-derived — teal/blue/rose fixtures exist), via the PROP form
    // (react-native-web 0.21 deprecates style.tintColor).
    expect(img![0]).toContain("tintColor={palette.accent}");
    expect(img![0]).toContain('accessibilityLabel="Mingla"');
  });

  test("no 'MINGLA' text kicker remains", () => {
    expect(source).not.toMatch(/<Text[^>]*>\s*MINGLA\s*<\/Text>/);
    expect(source).not.toMatch(/\n\s*kicker:\s*\{/); // orphaned style deleted
    // orch-1342 gate testIDs untouched by the swap.
    expect(source).toContain('testID="orch-1342-gate-close"');
    expect(source).toContain('testID="orch-1342-gate-qr"');
  });
});
