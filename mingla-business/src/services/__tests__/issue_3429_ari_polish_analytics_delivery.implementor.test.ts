/**
 * #3429 P0 (second) — every Ari analytics helper must DELIVER to postHogService.
 *
 * THE DEFECT THIS EXISTS FOR. `9e9e45cdb` moved postHogService behind a
 * function-scope require so importing this module would stop evaluating
 * expo-constants at boot. The rewrite replaced `postHogService.capture(` with
 * `capture(` everywhere — including inside the new `capture` helper's own body,
 * which therefore called itself. `postHogService` was destructured and never
 * read. Every Ari analytics call then blew the stack:
 *
 *   Uncaught Error: Maximum call stack size exceeded
 *     ariPolishAnalytics.ts (18:30) → capture → capture → capture → …
 *
 * The user-visible effect was worse than a crash. The answer rendered, then the
 * turn never settled: "Sending your message" stuck forever and `Sent` never
 * appeared, still stuck 29 s after send.
 *
 * WHY A WEAKER TEST WOULD NOT HAVE CAUGHT IT. A test that merely CALLS a helper
 * and asserts it does not throw passes over this in a mocked environment, and a
 * test that asserts "postHogService is imported" passes over it too — the
 * import was there, it was the call that lost its qualifier. The only assertion
 * that fails on infinite recursion is one that checks the spy RECEIVED the
 * event. So every case below asserts receipt, with the payload.
 */

const capture = jest.fn();
jest.mock("../postHogService", () => ({ postHogService: { capture } }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const analytics = require("../ariPolishAnalytics") as {
  captureAriAttachmentOutcome: (a: Record<string, unknown>) => void;
  captureAriTurnOutcome: (a: Record<string, unknown>) => void;
  captureAriActivityDisplayed: (a: Record<string, unknown>) => void;
  captureAriRevealOutcome: (a: Record<string, unknown>) => void;
  captureAriTitleAction: (surface: string, action: string) => void;
};

describe("#3429 — Ari analytics helpers deliver to postHogService", () => {
  beforeEach(() => capture.mockClear());

  it("D-1 attachment outcome ARRIVES at postHogService", () => {
    analytics.captureAriAttachmentOutcome({
      surface: "main", outcome: "opened", fileType: "pdf", errorCode: null,
    });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith("ari_attachment_outcome", {
      surface: "main", outcome: "opened", file_type: "pdf", error_code: null,
    });
  });

  it("D-2 turn outcome ARRIVES, with its bucketed payload", () => {
    analytics.captureAriTurnOutcome({
      surface: "main", outcome: "completed", hasAttachments: true, attachmentCount: 3,
    });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith("ari_turn_outcome", {
      surface: "main", outcome: "completed", has_attachments: true,
      attachment_count_bucket: "2-5", error_code: null,
    });
  });

  it("D-3 activity displayed ARRIVES", () => {
    analytics.captureAriActivityDisplayed({ surface: "website", phase: "thinking" });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith("ari_activity_displayed", {
      surface: "website", activity_phase: "thinking",
    });
  });

  it("D-4 reveal outcome ARRIVES — the helper SemanticRevealText calls on every answer", () => {
    analytics.captureAriRevealOutcome({
      surface: "main", outcome: "completed", reducedMotion: false, durationMs: 700,
    });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith("ari_response_reveal", {
      surface: "main", outcome: "completed", reduced_motion: false, duration_bucket: "501-900",
    });
  });

  it("D-5 title action ARRIVES", () => {
    analytics.captureAriTitleAction("main", "renamed");
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith("ari_title_action", {
      surface: "main", action: "renamed",
    });
  });

  it("D-6 EVERY exported helper reaches postHogService — none may be a no-op or recurse", () => {
    const helpers: [string, () => void][] = [
      ["captureAriAttachmentOutcome", () => analytics.captureAriAttachmentOutcome({ surface: "main", outcome: "ready", fileType: "image" })],
      ["captureAriTurnOutcome", () => analytics.captureAriTurnOutcome({ surface: "main", outcome: "started" })],
      ["captureAriActivityDisplayed", () => analytics.captureAriActivityDisplayed({ surface: "main", phase: "x" })],
      ["captureAriRevealOutcome", () => analytics.captureAriRevealOutcome({ surface: "main", outcome: "skipped", reducedMotion: true, durationMs: 0 })],
      ["captureAriTitleAction", () => analytics.captureAriTitleAction("main", "deleted")],
    ];
    for (const [name, call] of helpers) {
      capture.mockClear();
      expect(() => call()).not.toThrow();
      expect({ helper: name, delivered: capture.mock.calls.length }).toEqual({
        helper: name, delivered: 1,
      });
    }
  });
});
