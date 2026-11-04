import React from "react";

// #3682 wave 2 — the host's delivery view for followers invited through their
// Mingla account: names and states only, never an address.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer");
const { act } = TestRenderer;

jest.mock("../../../services/supabase", () => ({ supabase: { rpc: jest.fn() } }));
jest.mock("../../../hooks/useOfferingAccountInvites", () => ({
  useOfferingAccountInvites: jest.fn(),
}));

import { AccountInviteSummaryView, accountInviteStatusLine } from "../AccountInviteSummaryCard";
import { parseOfferingAccountInvites } from "../../../services/offeringAccountInvitesService";

const treeText = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(treeText).join(" ");
  if (value && typeof value === "object" && "children" in value) {
    return treeText((value as { children?: unknown }).children);
  }
  return "";
};

describe("#3682 account invite delivery view", () => {
  it("renders counts, names, reasons and states", () => {
    const data = parseOfferingAccountInvites({
      eventId: "e",
      counts: { invited: 2, reached: 1, pending: 0, notReached: 1 },
      recipients: [
        { displayName: "Ada", avatarUrl: null, reason: "follower", push: "sent", email: "sent" },
        { displayName: "Bo", avatarUrl: null, reason: "extended", push: "skipped", email: "skipped" },
      ],
    });
    let renderer: any;
    act(() => { renderer = TestRenderer.create(<AccountInviteSummaryView data={data} />); });
    const text = treeText(renderer.toJSON());
    expect(text).toContain("Followers invited through Mingla");
    expect(text).toContain("2 invited · 1 reached · 1 not reached");
    expect(text).toContain("Follows you · Reached by Mingla and email");
    expect(text).toContain("Friend of a follower · Not reached");
    expect(text).toContain("Their contact details stay private.");
    expect(text).not.toContain("@");
  });

  it("stays out of the roster when nobody was invited by account", () => {
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(<AccountInviteSummaryView data={{
        counts: { invited: 0, reached: 0, pending: 0, notReached: 0 }, recipients: [],
      }} />);
    });
    expect(renderer.toJSON()).toBeNull();
  });

  it("parses defensively and drops malformed rows", () => {
    expect(() => parseOfferingAccountInvites({ counts: {}, recipients: [] })).toThrow();
    const parsed = parseOfferingAccountInvites({
      counts: { invited: 1, reached: 0, pending: 1, notReached: 0 },
      recipients: [{ displayName: "X", reason: "follower", push: "queued", email: "weird" }],
    });
    expect(parsed.recipients).toEqual([]);
    expect(accountInviteStatusLine({ displayName: "Y", avatarUrl: null, reason: "follower", push: "queued", email: "skipped" }))
      .toBe("Sending…");
  });
});
