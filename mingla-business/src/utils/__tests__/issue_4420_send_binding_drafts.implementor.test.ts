/**
 * #4420 SC-4 / SC-5 — per-side drafts and the send binding (adversarial).
 *
 * A send is bound to the side and conversation showing when Send was pressed.
 * Switching sides within 50 ms of Send (while the send is in flight) must not
 * redirect it: a Team send never calls the Guest chat sender and a Guests send
 * never calls the Brand group sender. Each side keeps its own draft and a
 * landed send clears only the draft it came from.
 *
 * FAILS ON REVERT: read the side at resolve time instead of press time, route
 * both sides through one sender, or clear the other side's draft, and the
 * matching test fails.
 */
import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { MessagesSide } from "../brandMessagesInbox";
import {
  captureSendTarget,
  clearSentBrandThreadDraft,
  dispatchBrandThreadSend,
  guestSendNeedsConfirm,
  readBrandThreadDraft,
  writeBrandThreadDraft,
} from "../brandThreadSend";

const source = (relative: string): string => readFileSync(join(process.cwd(), relative), "utf8");

function deferred(): { promise: Promise<string>; resolve: (value: string) => void } {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("SC-5 a send stays bound to the side showing when Send was pressed", () => {
  test("Team send, switch to Guests within 50 ms: only the Brand group sender runs", async () => {
    const team = deferred();
    const senders = {
      team: jest.fn((_id: string, _text: string) => team.promise),
      guests: jest.fn((_id: string, _text: string) => Promise.resolve("guests")),
    };
    let showing: { side: MessagesSide; id: string } = { side: "team", id: "g-ty" };
    const target = captureSendTarget(showing.side, showing.id);
    if (!target) throw new Error("no target");
    const sending = dispatchBrandThreadSend(target, "Flyer B for Saturday", senders);
    // The switch lands mid-send (the 50 ms window).
    showing = { side: "guests", id: "x-ty" };
    await new Promise((done) => setTimeout(done, 50));
    team.resolve("team");
    await expect(sending).resolves.toBe("team");
    expect(showing.side).toBe("guests");
    expect(senders.team).toHaveBeenCalledWith("g-ty", "Flyer B for Saturday");
    expect(senders.guests).not.toHaveBeenCalled();
  });

  test("Guests send, switch to Team mid-send: only the Guest chat sender runs", async () => {
    const guests = deferred();
    const senders = {
      team: jest.fn((_id: string, _text: string) => Promise.resolve("team")),
      guests: jest.fn((_id: string, _text: string) => guests.promise),
    };
    const target = captureSendTarget("guests", "x-ty");
    if (!target) throw new Error("no target");
    const sending = dispatchBrandThreadSend(target, "Doors at 6pm", senders);
    guests.resolve("guests");
    await expect(sending).resolves.toBe("guests");
    expect(senders.guests).toHaveBeenCalledWith("x-ty", "Doors at 6pm");
    expect(senders.team).not.toHaveBeenCalled();
  });

  test("the captured target cannot be changed after press", () => {
    const target = captureSendTarget("team", "g-ty");
    expect(Object.isFrozen(target)).toBe(true);
    expect(captureSendTarget("team", null)).toBeNull();
  });

  test("both composers send through the bound dispatch, each refusing the other side", () => {
    const thread = source("app/messages/[conversationId].tsx");
    expect(thread).toContain('const target = threadSupport().captureSendTarget("team", conversationId);');
    expect(thread).toContain('guests: () => Promise.reject(new Error("The Team composer never sends to guests."))');
    const panel = source("src/components/groupChat/GroupChatPanel.tsx");
    expect(panel).toContain('const target = threadSupport().captureSendTarget("guests", conversationId);');
    expect(panel).toContain('team: () => Promise.reject(new Error("The Guests composer never sends to the Team chat."))');
    expect(panel).toContain("guests: (id, text) => postPlannerMessage(id, text)");
  });
});

describe("SC-4 each side keeps its own draft", () => {
  const team = { side: "team" as const, conversationId: "g-ty" };
  const guests = { side: "guests" as const, conversationId: "g-ty" };

  test("a Team draft survives a round trip to Guests and back; Guests starts empty", () => {
    let drafts = writeBrandThreadDraft({}, team, "Love flyer B");
    expect(readBrandThreadDraft(drafts, guests)).toBe("");
    drafts = writeBrandThreadDraft(drafts, guests, "Doors at 6");
    expect(readBrandThreadDraft(drafts, team)).toBe("Love flyer B");
    expect(readBrandThreadDraft(drafts, guests)).toBe("Doors at 6");
  });

  test("a landed send clears only its own side's draft", () => {
    const drafts = writeBrandThreadDraft(writeBrandThreadDraft({}, team, "team words"), guests, "guest words");
    const after = clearSentBrandThreadDraft(drafts, guests, "guest words");
    expect(readBrandThreadDraft(after, guests)).toBe("");
    expect(readBrandThreadDraft(after, team)).toBe("team words");
  });

  test("words typed while the send was in flight are kept", () => {
    const drafts = writeBrandThreadDraft({}, guests, "guest words and more");
    expect(readBrandThreadDraft(clearSentBrandThreadDraft(drafts, guests, "guest words"), guests)).toBe("guest words and more");
  });

  test("the thread keeps the Guests draft and the first-send answer across a switch", () => {
    const thread = source("app/messages/[conversationId].tsx");
    expect(thread).toContain("draft: guestDraft,");
    expect(thread).toContain("onDraftChange: setGuestDraft,");
    expect(thread).toContain("sendConfirmed: guestSendConfirmed,");
    // The Team draft is `composer`, which stays mounted with the thread.
    expect(thread).toContain('setComposer((current) => (current.trim() === content ? "" : current));');
  });

  test("the first guest send of a thread open asks; Team never does", () => {
    expect(guestSendNeedsConfirm("guests", false)).toBe(true);
    expect(guestSendNeedsConfirm("guests", true)).toBe(false);
    expect(guestSendNeedsConfirm("team", false)).toBe(false);
  });
});
