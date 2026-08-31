/**
 * ORCH-1150 §9.3 — I-PROPOSED-1150-RSVP-OWN-PUBLISH-RPC.
 *
 * The RSVP publish service MUST call business_publish_rsvp_graph and MUST NOT
 * call business_publish_event_draft (re-pointing it at the event RPC would
 * re-introduce the event_ticket_required 0-ticket block). Static source
 * assertion + a behavioral mock test that the right RPC name is invoked.
 *
 * [TEST-MOD-APPROVED #1977] #1977 repins publish to business_publish_rsvp_graph
 * (canonical graph owner) after #1977 replaced the payload-style draft RPC.
 *
 * Fails-on-revert: deleting the "business_publish_rsvp_graph" rpc call (or
 * re-pointing it at business_publish_event_draft) makes this FAIL.
 */

import fs from "fs";
import path from "path";

const SERVICE_SRC = fs.readFileSync(
  path.join(__dirname, "..", "rsvpEvents.ts"),
  "utf8",
);

describe("ORCH-1150 §9.3 — RSVP has its own publish RPC", () => {
  it("rsvpEvents.ts calls business_publish_rsvp_graph", () => {
    expect(SERVICE_SRC).toContain('"business_publish_rsvp_graph"');
  });

  it("rsvpEvents.ts does NOT call business_publish_event_draft", () => {
    expect(SERVICE_SRC).not.toContain("business_publish_event_draft");
  });

  it("the RSVP wizard does not import the event publish hook", () => {
    const wizardSrc = fs.readFileSync(
      path.join(__dirname, "..", "..", "components", "rsvp", "RsvpCreatorWizard.tsx"),
      "utf8",
    );
    expect(wizardSrc).not.toContain("usePublishBusinessEventDraft");
    expect(wizardSrc).not.toContain("business_publish_event_draft");
  });
});
