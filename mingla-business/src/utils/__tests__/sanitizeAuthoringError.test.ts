/**
 * sanitizeAuthoringError tests — ORCH-1218 SPEC §7 (T1–T8).
 *
 * Verifies the venue-authoring error sanitizer:
 *   - non-vendor reasons pass through unchanged (META-ORCH-1009 Sub-E B6)
 *   - per-code vendor mappings (429, unconfigured, empty, unparseable, etc.)
 *   - the unknown-vendor catch-all
 *   - empty/non-Error → the provided fallback
 *   - the "Google location" geocoding message is NOT scrubbed
 *
 * Happy-path / fails-on-revert regression test for the implementor's gate.
 */

import { sanitizeAuthoringError } from "../sanitizeAuthoringError";

const FALLBACK = "AI setup failed.";
const GENERIC =
  "Mingla's AI couldn't finish setting up your listing. Please try again.";

describe("sanitizeAuthoringError", () => {
  // T1 (happy) — non-vendor reason passes through unchanged.
  it("passes a non-vendor reason through unchanged", () => {
    expect(
      sanitizeAuthoringError(new Error("tier2_pipeline_failed"), FALLBACK),
    ).toBe("tier2_pipeline_failed");
    expect(
      sanitizeAuthoringError(new Error("place_pool_link_missing"), FALLBACK),
    ).toBe("place_pool_link_missing");
    expect(
      sanitizeAuthoringError(new Error("Network request failed"), FALLBACK),
    ).toBe("Network request failed");
  });

  // T2 — rate-limit (429) mapped; no vendor substring.
  it("maps gemini_failed:429 to the busy message with no vendor token", () => {
    const out = sanitizeAuthoringError(
      new Error('gemini_failed:429:{"retry":true}'),
      FALLBACK,
    );
    expect(out).toBe(
      "Mingla's AI is busy right now. Please wait a moment and try again.",
    );
    expect(out.toLowerCase()).not.toContain("gemini");
  });

  // T3 — unconfigured mapped.
  it("maps gemini_unconfigured to the unavailable message", () => {
    expect(
      sanitizeAuthoringError(new Error("gemini_unconfigured"), FALLBACK),
    ).toBe("Mingla's AI isn't available right now. Please try again shortly.");
  });

  // T4 — suffixed coverage code → generic; no vendor token.
  it("maps suffixed gemini_incomplete_coverage to generic", () => {
    const out = sanitizeAuthoringError(
      new Error("gemini_incomplete_coverage:vibe_chill,vibe_loud"),
      FALLBACK,
    );
    expect(out).toBe(GENERIC);
    expect(out.toLowerCase()).not.toContain("gemini");
  });

  // Additional per-code mappings (SC-3).
  it("maps gemini_empty / gemini_unparseable_json / bare gemini_failed", () => {
    expect(sanitizeAuthoringError(new Error("gemini_empty"), FALLBACK)).toBe(
      "Mingla's AI didn't return a result. Please try again.",
    );
    expect(
      sanitizeAuthoringError(new Error("gemini_unparseable_json"), FALLBACK),
    ).toBe("Mingla's AI returned an unexpected result. Please try again.");
    expect(
      sanitizeAuthoringError(new Error("gemini_missing_evaluations"), FALLBACK),
    ).toBe(GENERIC);
    expect(
      sanitizeAuthoringError(new Error("gemini_missing_signal:abc"), FALLBACK),
    ).toBe(GENERIC);
  });

  // T5 — bare gemini_failed → generic (must not be shadowed by the 429 branch).
  it("maps bare gemini_failed to generic", () => {
    expect(sanitizeAuthoringError(new Error("gemini_failed"), FALLBACK)).toBe(
      GENERIC,
    );
  });

  // T6 — other-vendor catch-all (SC-5).
  it("scrubs an unknown/other vendor token via the catch-all", () => {
    expect(
      sanitizeAuthoringError(new Error("openai_overloaded"), FALLBACK),
    ).toBe(GENERIC);
    expect(
      sanitizeAuthoringError(new Error("powered by Claude"), FALLBACK),
    ).toBe(GENERIC);
  });

  // T7 — empty / non-Error → fallback.
  it("returns the fallback for empty or non-Error input", () => {
    expect(sanitizeAuthoringError(null, FALLBACK)).toBe(FALLBACK);
    expect(sanitizeAuthoringError({}, FALLBACK)).toBe(FALLBACK);
    expect(sanitizeAuthoringError(new Error(""), FALLBACK)).toBe(FALLBACK);
  });

  // T8 — "Google location" geocoding message preserved (SC-6).
  it("does NOT scrub a 'Google location' geocoding message", () => {
    const msg = "Pick a Google location to continue.";
    expect(sanitizeAuthoringError(new Error(msg), FALLBACK)).toBe(msg);
  });
});
