import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

/**
 * issue #2974 (d) — the recovery copy told people to "cancel it first" while no
 * cancel control was reachable anywhere in the sheet: `VideoStatusCard`
 * computes `active = !["idle", "applied", "error"].includes(stage.phase)`, so
 * in the ERROR phase both the Cancel and the Replace buttons are suppressed and
 * only "Try again" renders. A user who could not choose the identical file was
 * stuck with an instruction they could not follow.
 *
 * Deleting either half — the Discard button, or the copy that names it — turns
 * this suite red.
 */
describe("#2974 the video error card offers a reachable way out", () => {
  const picker = repoFile("src/components/ui/CoverPicker.tsx");
  const hook = repoFile("src/hooks/useEventCoverVideoUpload.ts");

  const actionRow = (): string => {
    const start = picker.indexOf('{stage.phase === "error" ? <Button label="Try again"');
    expect(start).toBeGreaterThan(-1);
    const end = picker.indexOf("</View>", start);
    expect(end).toBeGreaterThan(start);
    return picker.slice(start, end);
  };

  test("T-2974-D-01 the error phase renders a discard control alongside Try again", () => {
    const row = actionRow();
    expect(row).toContain('label="Discard upload"');
    // Wired to the real cancel path, which clears the local record (and cancels
    // the server job when one exists) — not to a cosmetic no-op.
    expect(row).toMatch(/label="Discard upload"[^>]*onPress=\{onCancel\}/);
  });

  test("T-2974-D-02 the source-mismatch copy names a control the sheet actually has", () => {
    // The instruction must reference the affordance that now exists...
    expect(hook).toContain("tap Discard upload to start over");
    // ...and the old dead-end wording must be gone.
    expect(hook).not.toContain(
      "Choose the same video to resume this upload, or cancel it first.",
    );
  });

  test("T-2974-D-03 the discard control is the ONLY new terminal affordance (Cancel/Replace stay gated on active)", () => {
    // The existing gate is untouched: this fix adds a control for the error
    // phase rather than widening `active` (which would put Cancel/Replace on
    // an applied/idle card too).
    expect(picker).toContain(
      'const active = !["idle", "applied", "error"].includes(stage.phase);',
    );
  });
});
