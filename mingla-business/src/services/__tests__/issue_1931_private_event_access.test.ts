/**
 * Issue #1931 — Business client released-set state (SC-34, SC-35, SC-46).
 *
 * With readiness false — which is the whole of this release — the SHIPPING, user-visible
 * state of every Private authoring surface is the disabled / blocked state, and that is
 * what these tests assert. They are behavioral over the real exported functions, not
 * assertions about source text.
 */
import {
  PRIVATE_ACCESS_NOT_READY_CODE,
  PRIVATE_EVENT_ACCESS_READY,
  PRIVATE_NEEDS_SETUP_ACTION,
  PRIVATE_NEEDS_SETUP_BODY,
  PRIVATE_NEEDS_SETUP_TITLE,
  PRIVATE_NOT_READY_HELPER,
  canSelectPrivateVisibility,
  privatePublishBlockReason,
} from "../privateEventAccessService";

describe("#1931 released-set client state", () => {
  it("SC-46 — Private ticket sales are NOT ready in this release", () => {
    expect(PRIVATE_EVENT_ACCESS_READY).toBe(false);
    expect(canSelectPrivateVisibility()).toBe(false);
  });

  it("SC-34 — the creator Private row is blocked with the exact contract copy", () => {
    expect(PRIVATE_NOT_READY_HELPER).toBe(
      "Private ticket sales are not ready yet. Choose Public or Unlisted to publish.",
    );
  });

  // NOTE ON SCOPE, after the independent tester correctly flagged the previous title:
  // this case tests the PREDICATE only. The predicate is now genuinely wired into
  // `usePublishBusinessEventDraft`'s mutationFn, but the AUTHORITATIVE proof that a
  // Private draft cannot publish is the SQL fixture `SC-34` in
  // supabase/migrations/__tests__/issue_1931_private_event_access.test.sql, which drives
  // `business_publish_event_draft` — the function the real client path reaches through
  // `issue_1719_publish_event_with_poster`. A client-side predicate can never be the
  // authority, and this test does not claim to be.
  it("SC-34 — the publish-block predicate returns the block reason for a Private draft", () => {
    // The draft keeps its stored visibility; only publish is blocked.
    expect(privatePublishBlockReason("private")).toBe(PRIVATE_NOT_READY_HELPER);
    // Public and Unlisted authoring are entirely unchanged.
    expect(privatePublishBlockReason("public")).toBeNull();
    expect(privatePublishBlockReason("unlisted")).toBeNull();
    expect(privatePublishBlockReason("hidden")).toBeNull();
  });

  it("SC-35 — preexisting Private rows surface the needs_setup card copy", () => {
    expect(PRIVATE_NEEDS_SETUP_TITLE).toBe("Finish private access setup");
    expect(PRIVATE_NEEDS_SETUP_BODY).toBe(
      "Secure this event's media and send new invite links before guests can open or buy tickets.",
    );
    expect(PRIVATE_NEEDS_SETUP_ACTION).toBe("Set up private access");
  });

  it("the server reason class is typed and non-disclosing", () => {
    expect(PRIVATE_ACCESS_NOT_READY_CODE).toBe("private_access_not_ready");
    // It must carry no event fact, no contact and no capability material.
    expect(PRIVATE_ACCESS_NOT_READY_CODE).not.toMatch(/token|grant|email|phone|title/i);
  });

  it("SC-49 — the client module hardcodes no hostname", () => {
    const values = [
      PRIVATE_NOT_READY_HELPER,
      PRIVATE_NEEDS_SETUP_TITLE,
      PRIVATE_NEEDS_SETUP_BODY,
      PRIVATE_NEEDS_SETUP_ACTION,
      PRIVATE_ACCESS_NOT_READY_CODE,
    ].join(" ");
    expect(values).not.toMatch(/usemingla\.com|mingla\.app/);
  });
});
