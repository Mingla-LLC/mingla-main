/**
 * ORCH-1150 Step 9 — public RSVP submit error-code bubbling (regression).
 *
 * The public /e/ RSVP page maps the edge-fn { error } code to an inline message
 * (rsvp_contact_required / rsvp_phone_invalid / rsvp_full / rsvp_not_open). If
 * the parser silently dropped the body code and only used error.message, the
 * page would show a generic "try again" instead of the right field-level
 * message — a real UX regression. This proves the body code wins.
 *
 * Fails-on-revert: replacing the body-code extraction with `error.message` only
 * (delete the `parsed.error` branch) makes the first assertion FAIL.
 */

import { parseRsvpErrorCode } from "../rsvpErrorCodes";

describe("ORCH-1150 §6 — public RSVP submit error code", () => {
  it("prefers the { error } code embedded in a string body", () => {
    const code = parseRsvpErrorCode({
      message: "Edge Function returned a non-2xx status code",
      context: { body: JSON.stringify({ error: "rsvp_contact_required" }) },
    });
    expect(code).toBe("rsvp_contact_required");
  });

  it("prefers the { error } code from an already-parsed object body", () => {
    expect(
      parseRsvpErrorCode({ context: { body: { error: "rsvp_phone_invalid" } } }),
    ).toBe("rsvp_phone_invalid");
  });

  it("bubbles rsvp_full so the page shows 'just filled up'", () => {
    expect(
      parseRsvpErrorCode({ context: { body: { error: "rsvp_full" } } }),
    ).toBe("rsvp_full");
  });

  it("falls back to error.message when there is no body", () => {
    expect(parseRsvpErrorCode({ message: "network down" })).toBe("network down");
  });

  it("falls back to rsvp_write_failed for a null error or empty everything", () => {
    expect(parseRsvpErrorCode(null)).toBe("rsvp_write_failed");
    expect(parseRsvpErrorCode({})).toBe("rsvp_write_failed");
  });

  it("keeps the message code when the body is malformed JSON", () => {
    expect(
      parseRsvpErrorCode({ message: "boom", context: { body: "{not json" } }),
    ).toBe("boom");
  });
});
