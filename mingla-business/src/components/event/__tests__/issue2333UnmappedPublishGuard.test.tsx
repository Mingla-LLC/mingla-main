/**
 * issue #2333 — executable guard-copy proof.
 *
 * Component wiring is structural and belongs to the CI-wired #2333 strict-grep gate.
 * This Jest file executes the shared behavior instead of reading component source
 * (#1047: source-only tests are not regression proof).
 */

import {
  describeUnmappedEditGuard,
  describeUnmappedPublishGuard,
  resolveProviderNeutralPaidPublishGuardCopy,
} from "../../../utils/paidPublishGuards";

describe("issue #2333 — unmapped server guards fail honestly", () => {
  const spy = (): jest.SpyInstance =>
    jest.spyOn(console, "error").mockImplementation(() => {});

  test("a bare server guard is named without inviting a retry", () => {
    const errorSpy = spy();
    try {
      const copy = describeUnmappedPublishGuard("future_guard_required");
      expect(copy).toContain('"future_guard_required"');
      expect(copy).toContain("Contact support");
      expect(copy).not.toMatch(/try again/i);
      expect(errorSpy).toHaveBeenCalledWith(
        "[#2333] unmapped publish guard",
        "future_guard_required",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("an untrusted server envelope is not echoed into the toast", () => {
    const errorSpy = spy();
    try {
      const raw = '<script>alert("x")</script>';
      const copy = describeUnmappedPublishGuard(raw);
      expect(copy).not.toContain(raw);
      expect(copy).toContain("Nothing was lost");
      expect(copy).not.toMatch(/try again/i);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("a bare edit guard names the code and truthfully preserves the published event", () => {
    const errorSpy = spy();
    try {
      const copy = describeUnmappedEditGuard("future_edit_guard");
      expect(copy).toContain('"future_edit_guard"');
      expect(copy).toContain("Your published event was not changed");
      expect(copy).not.toMatch(/couldn't publish|draft|try again/i);
      expect(errorSpy).toHaveBeenCalledWith(
        "[#2333] unmapped edit guard",
        "future_edit_guard",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("an untrusted edit envelope is neither echoed nor described as a draft failure", () => {
    const errorSpy = spy();
    try {
      const raw = '{"message":"future_edit_guard","details":"<script>x</script>"}';
      const copy = describeUnmappedEditGuard(raw);
      expect(copy).not.toContain(raw);
      expect(copy).toBe(
        "We couldn't save these changes. Your published event was not changed. Contact support if it keeps happening.",
      );
      expect(copy).not.toMatch(/couldn't publish|draft|try again/i);
      expect(errorSpy).toHaveBeenCalledWith("[#2333] unmapped edit guard", raw);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("city_required resolves to the actionable Where-step contract", () => {
    expect(resolveProviderNeutralPaidPublishGuardCopy("city_required")).toEqual(
      expect.objectContaining({
        reason: "city_required",
        action: "edit_where",
        actionLabel: "Open Where step",
      }),
    );
  });
});
