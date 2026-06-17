/**
 * ORCH-1150 R2 — RsvpPublicBody source-structure regression (happy-path).
 *
 * Owner: mingla-implementor (the tester adds a SECOND adversarial angle).
 *
 * @testing-library/react-native is NOT a dependency of mingla-business (see the
 * repo-wide pre-existing TS2307s), so the CTA + D-7 layering invariants are
 * enforced as SOURCE-STRUCTURE assertions (SPEC §7 T8/T11 explicitly call these
 * "component (source)"). Each assertion FAILS if the corresponding fix line is
 * deleted — proving fails-on-revert without a runtime renderer.
 */

import { readFileSync } from "fs";
import { join } from "path";

const SRC = readFileSync(
  join(__dirname, "..", "RsvpPublicBody.tsx"),
  "utf8",
);

describe("ORCH-1150 R2 D-10 — RsvpPublicBody three-button CTA", () => {
  it("imports the three lucide icons per-icon NAMED (never a barrel import)", () => {
    // INV: real-glyph icons on native + ORCH-1137 web shim; per-icon = tree-shake-safe.
    expect(SRC).toMatch(
      /import\s*\{\s*Check\s*,\s*HelpCircle\s*,\s*X\s*\}\s*from\s*["']lucide-react-native["']/,
    );
    // Must NOT barrel-import lucide (would blow the ORCH-1083 web bundle budget).
    expect(SRC).not.toMatch(/import\s*\*\s*as\s*\w+\s*from\s*["']lucide-react-native["']/);
  });

  it("renders Going · Maybe · Can't-go, each as a flex:1 equal-width ctaBtn", () => {
    expect(SRC).toContain('testID="orch-1150-rsvp-going"');
    expect(SRC).toContain('testID="orch-1150-rsvp-maybe"');
    expect(SRC).toContain('testID="orch-1150-rsvp-not-going"');
    // The shared CTA button style is flex:1 (equal width).
    expect(SRC).toMatch(/ctaBtn:\s*\{[\s\S]*?flex:\s*1/);
  });

  it("threads the correct lucide icon into each button", () => {
    // Going → Check, Maybe → HelpCircle, Can't-go → X.
    expect(SRC).toMatch(/<Check\s+size=\{19\}/);
    expect(SRC).toMatch(/<HelpCircle\s+size=\{19\}/);
    expect(SRC).toMatch(/<X\s+size=\{19\}/);
  });

  it("submit() accepts the three-status union and routes 'maybe'", () => {
    expect(SRC).toMatch(
      /rsvpStatus:\s*["']going["']\s*\|\s*["']not_going["']\s*\|\s*["']maybe["']/,
    );
    expect(SRC).toContain('void submit("maybe")');
  });

  it("applies the A4-NEW contact gate to BOTH going and maybe (a Maybe must be reachable)", () => {
    expect(SRC).toMatch(
      /\(rsvpStatus === "going" \|\| rsvpStatus === "maybe"\) && !contactReady/,
    );
  });

  it("shows the keep-posted response copy for a resolved maybe", () => {
    expect(SRC).toContain("You're marked as Maybe");
    expect(SRC).toMatch(/we'll keep you posted/i);
  });
});
