// #4420 — the creation wizards' invite publish gate (Event, RSVP, Experience
// and Trip all call it). Nobody invited: Publish never waits on the delivery
// estimate. People invited: Publish needs the current estimate, and a failed
// one is reported so the Preview step can say why.
//
// FAILS-ON-REVERT: make wizardInviteSummaryReady require a quote for every
// enabled plan (the old inline rule) and GP-1 goes red.
import { describe, expect, test } from "@jest/globals";

import {
  wizardInviteEstimateFailed,
  wizardInviteListFailed,
  wizardInviteSummaryReady,
} from "../wizardInvitePublishGate";

const idle = { isPending: false, isFetching: false, isError: false };
const failed = { isPending: false, isFetching: false, isError: true };
const plan = (selectedCount: number) => ({
  eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  eventType: "event",
  selectionRevision: 3,
  selectedCount,
  bookSelectedCount: selectedCount,
  accountRecipientCount: 0,
  brandPersonIds: [],
  selectionHash: "h".repeat(64),
  state: "draft",
  publishedSelectionRevision: null,
  updatedAt: null,
}) as never;
const quote = {
  selectionRevision: 3, selectedCount: 2, reachableCount: 2, suppressedCount: 0,
  canReceiveCount: 2, skippedCount: 0, perChannelReachable: { email: 2, sms: 0, push: 0 },
  estimatedCostMinor: 0, currency: "USD", quoteHash: "q".repeat(64), selectionHash: "h".repeat(64),
} as never;

describe("#4420 invite publish gate", () => {
  test("GP-1 nobody invited: ready with no estimate, even when it failed", () => {
    const input = { inviteEnabled: true, plan: plan(0), quote: null, summary: { plan: idle, quote: failed } };
    expect(wizardInviteSummaryReady(input)).toBe(true);
    expect(wizardInviteEstimateFailed(input)).toBe(false);
  });

  test("GP-2 people invited, estimate failed: waits and reports the failure", () => {
    const input = { inviteEnabled: true, plan: plan(2), quote: null, summary: { plan: idle, quote: failed } };
    expect(wizardInviteSummaryReady(input)).toBe(false);
    expect(wizardInviteEstimateFailed(input)).toBe(true);
  });

  test("GP-3 people invited, current estimate: ready", () => {
    const input = { inviteEnabled: true, plan: plan(2), quote, summary: { plan: idle, quote: idle } };
    expect(wizardInviteSummaryReady(input)).toBe(true);
    expect(wizardInviteEstimateFailed(input)).toBe(false);
  });

  test("GP-4 the saved list not loaded yet or failed: waits", () => {
    expect(wizardInviteSummaryReady({ inviteEnabled: true, plan: null, quote: null, summary: { plan: failed, quote: idle } })).toBe(false);
    expect(wizardInviteSummaryReady({ inviteEnabled: true, plan: plan(0), quote: null,
      summary: { plan: { isPending: false, isFetching: true, isError: false }, quote: idle } })).toBe(false);
  });

  test("GP-5 invites off: never holds Publish", () => {
    expect(wizardInviteSummaryReady({ inviteEnabled: false, plan: null, quote: null, summary: { plan: failed, quote: failed } })).toBe(true);
  });

  test("GP-6 a failed saved-list read is reported", () => {
    expect(wizardInviteListFailed({ inviteEnabled: true, plan: null, quote: null, summary: { plan: failed, quote: idle } })).toBe(true);
    expect(wizardInviteListFailed({ inviteEnabled: false, plan: null, quote: null, summary: { plan: failed, quote: idle } })).toBe(false);
  });
});
