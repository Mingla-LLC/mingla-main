import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  canLeavePackageStep,
  packageReviewAction,
} from "../features/offers/packageNavigation";

describe("#4490 package editor save boundaries", () => {
  it("lets a clean draft move without saving", async () => {
    const save = jest.fn(async () => true);
    await expect(
      canLeavePackageStep({
        dirty: false,
        issue: null,
        step: "price",
        showIssue: jest.fn(),
        save,
      }),
    ).resolves.toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it("saves a valid dirty step before moving and stays put if the save fails", async () => {
    const succeeds = jest.fn(async () => true);
    await expect(
      canLeavePackageStep({ dirty: true, issue: null, step: "included", showIssue: jest.fn(), save: succeeds }),
    ).resolves.toBe(true);
    expect(succeeds).toHaveBeenCalledWith("included");

    await expect(
      canLeavePackageStep({ dirty: true, issue: null, step: "rules", showIssue: jest.fn(), save: async () => false }),
    ).resolves.toBe(false);
  });

  it("shows validation and refuses navigation from an invalid dirty step", async () => {
    const showIssue = jest.fn();
    const save = jest.fn(async () => true);
    await expect(
      canLeavePackageStep({ dirty: true, issue: "Add a price", step: "price", showIssue, save }),
    ).resolves.toBe(false);
    expect(showIssue).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it("never turns Review Done into a silent discard", () => {
    expect(packageReviewAction({ status: "live", dirty: true, dirtyStep: "price" })).toBe("save");
    expect(packageReviewAction({ status: "live", dirty: true, dirtyStep: null })).toBe("block");
    expect(packageReviewAction({ status: "live", dirty: false, dirtyStep: null })).toBe("close");
    expect(packageReviewAction({ status: "draft", dirty: false, dirtyStep: null })).toBe("publish");
  });

  it("routes the visible Back and step controls through the guarded save boundary", () => {
    const source = readFileSync(
      resolve(__dirname, "../features/offers/PackageEditor.tsx"),
      "utf8",
    );
    expect(source).toContain("onBack={stepIndex > 0 ? () => void requestStep(stepIndex - 1)");
    expect(source.match(/if \(i <= furthest && !saving\) void requestStep\(i\);/g)).toHaveLength(2);
    expect(source).toContain('testID="package-review-unsaved"');
    expect(source).toContain('dirty ?');
  });
});
