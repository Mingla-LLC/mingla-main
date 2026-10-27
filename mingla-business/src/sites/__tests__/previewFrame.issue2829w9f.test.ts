/*
 * #2829 W9f (A18 item 2) — a Business web Vercel preview deployment names its
 * own origin on the framed preview link so the runtime allows it; production
 * and local Business web add nothing (the runtime already allows them).
 */
import { previewUrlForFrame } from "../previewFrame";

const STUDIO_PREVIEW = "https://studio.sites.usemingla.com/preview?token=abc";

describe("#2829 W9f preview frame origin", () => {
  it("a Business Vercel preview deployment adds fa=<its origin>", () => {
    expect(previewUrlForFrame(STUDIO_PREVIEW, "https://mingla-business-git-x-mingla.vercel.app"))
      .toBe(`${STUDIO_PREVIEW}&fa=${encodeURIComponent("https://mingla-business-git-x-mingla.vercel.app")}`);
  });

  it("production, local and any other origin add nothing", () => {
    for (const origin of ["https://host.usemingla.com", "http://localhost:8190", "https://evil.vercel.app", null, undefined]) {
      expect(previewUrlForFrame(STUDIO_PREVIEW, origin)).toBe(STUDIO_PREVIEW);
    }
  });
  // #2829 W11 — pattern parity with the runtime and the edge functions, and the
  // web pane framing through previewUrlForFrame, are structural rules now held
  // by the Sites strict-grep gate (issue-2830-sites-foundation.mjs).
});
