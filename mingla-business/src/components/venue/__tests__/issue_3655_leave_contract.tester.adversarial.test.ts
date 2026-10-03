/**
 * #3655 Story 1 — independent adversarial checks on leave helpers.
 */

import {
  formatLeaveChangedBody,
  formatUnsavedCaption,
} from "../venueLeaveContract";

describe("#3655 leave contract adversarial", () => {
  test("never invents a phantom field when labels are empty", () => {
    expect(formatLeaveChangedBody([])).not.toMatch(/You changed/);
    expect(formatUnsavedCaption([])).toBe("No changes yet");
  });

  test("3+ grammar uses 'and N more' not a third named field", () => {
    const body = formatLeaveChangedBody(["A", "B", "C"]);
    expect(body).toContain("and 1 more");
    expect(body).not.toContain("A, B, C");
    expect(formatUnsavedCaption(["A", "B", "C", "D"])).toContain("+2 more");
  });
});
