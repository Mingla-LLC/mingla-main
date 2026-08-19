/**
 * issue #2291 T-10 / T-11 — the composer must survive a malformed stored draft.
 *
 * WHAT WAS BROKEN. The draft-rehydration effect read
 * `setSubject(row.channel_payload.subject)` and
 * `setBody(row.channel_payload.body_html)` with NO fallback. On a row written
 * by the `draft_campaign` agent tool — which stored `{kind:"email", body:"…"}`,
 * one key, no `subject`, no `body_html` — both landed `undefined` in state, and
 * the next render died at three independent sites. The composer did not "open
 * empty"; it crashed before the operator saw anything.
 *
 * TWO LAYERS, DELIBERATELY.
 *  A. Source assertions on the rehydration effect. Rendering the composer needs
 *     the whole RN stack + React Query + expo-router + Sheet mocked; this file
 *     follows the precedent set by `compose.template-prefill.test.ts`. These
 *     assertions go RED the moment a `?? ""` is deleted, which is the property
 *     that matters.
 *  B. Behavioural proof that the fallback is not decorative — the real
 *     downstream function still throws on `undefined` and is safe on `""`. If
 *     that ever stops being true, the source assertions above become
 *     ceremonial, and this half says so.
 */
import fs from "node:fs";
import path from "node:path";

import { bodyHtmlToTenTapDoc } from "../../../../../src/services/marketing/tenTapTokenBridge";
import { campaignPayloadIssues } from "../../../../../src/services/marketing/campaignPayloadContract";

const COMPOSE_PATH = path.resolve(__dirname, "..", "compose.tsx");

/**
 * COMMENTS ARE STRIPPED BEFORE MATCHING, and that is not fussiness: the fix in
 * `compose.tsx` carries a docblock that QUOTES the old defective line verbatim
 * so a future reader knows what was wrong. A negative assertion run against the
 * raw file therefore matches the explanation and reports the bug as present.
 * This is the COMMS-0141 trap — a real identifier written into prose blinds the
 * check that greps for it. Caught here on the first run of this very test.
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("#2291 T-10 — draft rehydration is null-safe (source)", () => {
  let source: string;
  beforeAll(() => {
    source = stripComments(fs.readFileSync(COMPOSE_PATH, "utf8"));
  });

  it("the comment-stripper actually removes the docblock that quotes the old defect", () => {
    const raw = fs.readFileSync(COMPOSE_PATH, "utf8");
    // Non-vacuous: the raw file MUST still contain the quoted defect, or this
    // guard is asserting nothing and the negative test below is decorative.
    expect(raw).toMatch(/setSubject\(row\.channel_payload\.subject\)/);
    expect(source).not.toMatch(/setSubject\(row\.channel_payload\.subject\)/);
  });

  it("setSubject falls back to an empty string", () => {
    expect(source).toMatch(
      /setSubject\s*\(\s*row\.channel_payload\.subject\s*\?\?\s*""\s*\)/,
    );
  });

  it("setBody falls back to an empty string", () => {
    expect(source).toMatch(
      /setBody\s*\(\s*row\.channel_payload\.body_html\s*\?\?\s*""\s*\)/,
    );
  });

  it("setSmsBody falls back to an empty string", () => {
    expect(source).toMatch(
      /setSmsBody\s*\(\s*row\.channel_payload\.body\s*\?\?\s*""\s*\)/,
    );
  });

  it("no bare read of the three payload keys survives in the rehydration effect", () => {
    // The exact defect, spelled out: a read with no fallback. `[^?]` after the
    // key stops this matching the fixed `?? ""` form.
    expect(source).not.toMatch(/setSubject\s*\(\s*row\.channel_payload\.subject\s*\)/);
    expect(source).not.toMatch(/setBody\s*\(\s*row\.channel_payload\.body_html\s*\)/);
    expect(source).not.toMatch(/setSmsBody\s*\(\s*row\.channel_payload\.body\s*\)/);
  });

  it("a payload that fails the contract raises the existing banner, and does not block editing", () => {
    expect(source).toMatch(/campaignPayloadIssues\s*\(\s*storedPayload\s*\)/);
    expect(source).toMatch(/setErrorBanner\s*\(\s*CAMPAIGN_DRAFT_INCOMPLETE_BANNER\s*\)/);
    // No early `return` between the banner and the rest of hydration: the
    // operator must be able to repair the draft in place.
    expect(source).not.toMatch(
      /setErrorBanner\(CAMPAIGN_DRAFT_INCOMPLETE_BANNER\);\s*return/,
    );
  });

  it("imports the shared contract rather than reimplementing the rule inline", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*campaignPayloadIssues[^}]*\}\s*from\s*["'][^"']*campaignPayloadContract["']/,
    );
  });
});

describe("#2291 T-10 — the fallback is load-bearing (behavioural)", () => {
  const ARI_ROW = { kind: "email", body: "Ari wrote the body under the SMS key" } as Record<
    string,
    unknown
  >;

  it("the editor-mount call still THROWS on undefined — which is what the crash was", () => {
    expect(() =>
      bodyHtmlToTenTapDoc((ARI_ROW.body_html as string | undefined) as string),
    ).toThrow();
  });

  it("...and is safe on the empty string the fallback now supplies", () => {
    const rehydrated = (ARI_ROW.body_html as string | undefined) ?? "";
    expect(() => bodyHtmlToTenTapDoc(rehydrated)).not.toThrow();
    expect(bodyHtmlToTenTapDoc(rehydrated)).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("the two other throw sites are also disarmed by the same fallback", () => {
    const subject = (ARI_ROW.subject as string | undefined) ?? "";
    const body = (ARI_ROW.body_html as string | undefined) ?? "";
    // campaignName memo: `subject.length > 0 ? subject : "Untitled campaign"`
    expect(() => subject.length > 0).not.toThrow();
    // contentReady memo: `subject.trim().length > 0 && body.trim().length > 0`
    expect(() => subject.trim().length > 0 && body.trim().length > 0).not.toThrow();
    expect(subject.trim().length > 0 && body.trim().length > 0).toBe(false);
  });

  it("and the row is correctly reported as incomplete, so the banner fires", () => {
    expect(campaignPayloadIssues(ARI_ROW).length).toBeGreaterThan(0);
  });
});

describe("#2291 T-11 — a complete draft rehydrates with no banner", () => {
  const GOOD_ROW = {
    kind: "email",
    subject: "Doors at 9",
    body_html: "See you there.",
    body_text: "See you there.",
    embedded_events: [],
  };

  it("produces no issues, so no banner is raised", () => {
    expect(campaignPayloadIssues(GOOD_ROW)).toEqual([]);
  });

  it("the body survives the round trip through the editor bridge", () => {
    const rehydrated = (GOOD_ROW.body_html as string | undefined) ?? "";
    expect(rehydrated).toBe("See you there.");
    expect(() => bodyHtmlToTenTapDoc(rehydrated)).not.toThrow();
  });
});
