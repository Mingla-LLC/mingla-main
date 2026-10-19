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

  // [TEST-MOD-APPROVED #3040] design H-13 — the error card's actions come
  // from coverUploadCardModel ("Try again" + "Discard"), and a different clip
  // after a failure is now a NEW operation (A-18) instead of a "choose the same
  // video" refusal, so the old mismatch sentence has nothing left to name.
  const model = repoFile("src/components/ui/coverUploadCardModel.ts");

  test("T-2974-D-01 the error phase renders a discard control alongside Try again", () => {
    expect(model).toContain('actions: [action("try_again", "Try again", "secondary"), action("discard", "Discard", "ghost")],');
    // Wired to the real cancel path, which clears the local record (and cancels
    // the server job when one exists) — not to a cosmetic no-op.
    expect(picker).toMatch(/case "discard":[\s\S]{0,120}cancelVideoCoverUpload\(\);/);
  });

  test("T-2974-D-02 a different clip after a failure starts fresh instead of a dead-end refusal", () => {
    expect(hook).not.toContain(
      "Choose the same video to resume this upload, or cancel it first.",
    );
    expect(hook).toContain("operationId = newOperationId();");
  });

  test("T-2974-D-03 Cancel/Choose-a-different-video belong to the active card states only", () => {
    expect(model).toMatch(/case "error":\s*return errorCardModel\(/);
    expect(model).not.toMatch(/stateId: "H-13"[\s\S]{0,400}"choose_different"/);
  });
});
