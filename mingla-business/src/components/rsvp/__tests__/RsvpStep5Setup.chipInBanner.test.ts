/**
 * ORCH-1335 — banner-swap SOURCE-STRUCTURE guard (§5.a File 2).
 *
 * Reads RsvpStep5Setup.tsx as text (the repo pattern used by the coverPersistence
 * / gate tests) and asserts the chip-in callout is payout-aware: it renders
 * exactly ONE of two callouts, selected by the `chipInPayoutReady` prop — NOT the
 * old unconditional nudge.
 *
 * Pure `.test.ts` (no RTL) → runs under the DEFAULT jest.config.cjs, so it is
 * CI-enforced. Fails-on-revert: hardcoding the nudge / dropping the prop removes
 * `chipInPayoutReady` + the positive testID/copy → these assertions fail.
 */
import { readFileSync } from "fs";
import path from "path";

const SOURCE_PATH = path.resolve(__dirname, "..", "RsvpStep5Setup.tsx");
const source = readFileSync(SOURCE_PATH, "utf8");

describe("RsvpStep5Setup — chip-in bank callout is payout-aware (ORCH-1335)", () => {
  it("keeps the neutral connect nudge copy + testID unchanged", () => {
    expect(source).toContain("Connect your bank to collect contributions");
    expect(source).toContain('testID="rsvp-contribution-connect-callout"');
  });

  it("adds the positive 'Payouts are on' confirmation copy + testID", () => {
    expect(source).toContain("Payouts are on");
    expect(source).toContain(
      "Guests can chip in the moment you publish — no extra setup needed.",
    );
    expect(source).toContain('testID="rsvp-contribution-ready-callout"');
  });

  it("gates the two callouts on the chipInPayoutReady prop (NOT unconditional)", () => {
    // The ternary `{chipInPayoutReady ? (...) : (...)}` selects the callout.
    // Its presence proves the connect nudge is no longer rendered unconditionally.
    expect(source).toContain("chipInPayoutReady ?");
    // The prop is destructured from StepBodyProps.
    expect(source).toMatch(/chipInPayoutReady\b/);
  });

  it("renders the positive confirmation with the semantic success token + check icon", () => {
    expect(source).toContain("semantic.success");
    expect(source).toContain('name="check"');
  });
});
