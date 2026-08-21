/**
 * ORCH-1150 §9.3 — I-PROPOSED-1150-RSVP-OWN-PUBLISH-RPC.
 *
 * The RSVP publish service MUST call business_publish_rsvp_graph and MUST NOT
 * call business_publish_event_draft (re-pointing it at the event RPC would
 * re-introduce the event_ticket_required 0-ticket block). The graph owner
 * delegates to the legacy RSVP publish primitive inside one server transaction.
 *
 * Fails-on-revert: deleting the "business_publish_rsvp_graph" rpc call (or
 * re-pointing it at either legacy client-callable publish RPC) makes this FAIL.
 */

import fs from "fs";
import path from "path";

const SERVICE_SRC = fs.readFileSync(
  path.join(__dirname, "..", "rsvpEvents.ts"),
  "utf8",
);

describe("ORCH-1150 §9.3 — RSVP has its own publish RPC", () => {
  // [TEST-MOD-APPROVED #1977] The canonical graph RPC owns publish plus its
  // exact-once receipt. The old assertion required the client to bypass that
  // owner. Keep the original RSVP-vs-ticket invariant and add hostile proof
  // that the retired direct publish call cannot return.
  it("publishRsvpDraft calls only the canonical RSVP graph publish owner", () => {
    const publishFn = SERVICE_SRC.match(/publishRsvpDraft = async[^]*?^\};/m);
    expect(publishFn).not.toBeNull();
    expect(publishFn?.[0]).toMatch(
      /supabase\.rpc\("business_publish_rsvp_graph"/,
    );
    expect(publishFn?.[0]).not.toMatch(
      /supabase\.rpc\("business_publish_rsvp_draft"/,
    );
  });

  it("rsvpEvents.ts does NOT call business_publish_event_draft", () => {
    expect(SERVICE_SRC).not.toContain("business_publish_event_draft");
  });

  it("the RSVP wizard does not import the event publish hook", () => {
    const wizardSrc = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "components",
        "rsvp",
        "RsvpCreatorWizard.tsx",
      ),
      "utf8",
    );
    expect(wizardSrc).not.toContain("usePublishBusinessEventDraft");
    expect(wizardSrc).not.toContain("business_publish_event_draft");
  });
});
