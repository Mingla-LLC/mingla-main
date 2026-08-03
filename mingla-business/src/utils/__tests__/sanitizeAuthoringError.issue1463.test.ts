import { sanitizeAuthoringError } from "../sanitizeAuthoringError";

describe("Issue #1463 structured venue submission errors", () => {
  const fallback = "Could not submit. Try again.";

  it("turns a PostgREST forbidden object into an actionable safe message", () => {
    expect(
      sanitizeAuthoringError(
        { code: "P0001", details: null, hint: null, message: "forbidden" },
        fallback,
      ),
    ).toBe(
      "You don't have permission to submit venues for this brand. Ask a brand owner to update your role.",
    );
  });

  it("sanitizes vendor text carried by a structured object", () => {
    expect(
      sanitizeAuthoringError({ message: "gemini_failed:500" }, fallback),
    ).toBe(
      "Mingla's AI couldn't finish setting up your listing. Please try again.",
    );
  });

  it("keeps the fallback for objects without a string message", () => {
    expect(sanitizeAuthoringError({ message: 403 }, fallback)).toBe(fallback);
  });
});
