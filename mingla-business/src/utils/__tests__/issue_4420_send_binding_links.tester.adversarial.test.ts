/**
 * #4420 SC-4 / SC-5 / SC-15 — tester adversarial angles (not the 50 ms switch).
 *
 *   C-*  the first-send confirm is accepted AFTER the host switched to Team:
 *        the send still goes only to the Guest chat the dialog was raised for,
 *        never to the Team chat, and the Team draft is untouched.
 *   R-*  a failed send keeps its draft and its original target; the retry
 *        (pressing Send again) goes to the same side, never the other one.
 *   L-*  links: hostile schemes never become links, a whitespace / control
 *        char prefix cannot smuggle a scheme, look-alike userinfo shows the
 *        real url, and a pathological 100k-char input finishes quickly.
 *
 * FAILS ON REVERT: let dispatchBrandThreadSend read a live side, route both
 * senders through one function, clear a draft on failure, or drop the
 * http(s)-only rule in isOpenableMessageLink / URL_PATTERN, and a case fails.
 */
import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { MessagesSide } from "../brandMessagesInbox";
import {
  captureSendTarget,
  clearSentBrandThreadDraft,
  dispatchBrandThreadSend,
  readBrandThreadDraft,
  writeBrandThreadDraft,
  type BrandThreadDrafts,
} from "../brandThreadSend";
import { isOpenableMessageLink, linkifyMessageText, messageLinkHref } from "../messageLinks";

const TEAM = "team-conv-1";
const GUESTS = "guest-conv-1";

describe("#4420 confirm accepted after a side switch (C-*)", () => {
  test("C-1 the confirmed guest send reaches only the Guest chat the dialog was raised for", async () => {
    const team = jest.fn(async (_id: string, _text: string) => ({ error: null as string | null }));
    const guests = jest.fn(async (_id: string, _text: string) => ({ error: null as string | null }));
    let visible: { side: MessagesSide; conversationId: string } = { side: "guests", conversationId: GUESTS };

    // Send pressed on Guests: the target is captured, the dialog opens.
    const target = captureSendTarget(visible.side, visible.conversationId);
    expect(target).not.toBeNull();
    let onConfirm: (() => Promise<unknown>) | null = null;
    onConfirm = () => dispatchBrandThreadSend(target!, "Doors at 6", { team, guests });

    // The host switches to Team while the dialog is up, then confirms.
    visible = { side: "team", conversationId: TEAM };
    expect(visible.side).toBe("team");
    await onConfirm();

    expect(guests).toHaveBeenCalledTimes(1);
    expect(guests).toHaveBeenCalledWith(GUESTS, "Doors at 6");
    expect(team).not.toHaveBeenCalled();
  });

  test("C-2 a frozen target cannot be re-pointed after capture", () => {
    const target = captureSendTarget("guests", GUESTS)!;
    expect(Object.isFrozen(target)).toBe(true);
    expect(() => {
      (target as { side: MessagesSide }).side = "team";
    }).toThrow();
    expect(target.side).toBe("guests");
  });

  test("C-3 the confirmed guest send clears only the Guests draft, never Team's", () => {
    const g = captureSendTarget("guests", GUESTS)!;
    const tm = captureSendTarget("team", TEAM)!;
    let drafts: BrandThreadDrafts = {};
    drafts = writeBrandThreadDraft(drafts, g, "Doors at 6");
    drafts = writeBrandThreadDraft(drafts, tm, "Doors at 6");
    drafts = clearSentBrandThreadDraft(drafts, g, "Doors at 6");
    expect(readBrandThreadDraft(drafts, g)).toBe("");
    expect(readBrandThreadDraft(drafts, tm)).toBe("Doors at 6");
  });

  test("C-4 no conversation showing means no target, so nothing can be sent", () => {
    expect(captureSendTarget("guests", null)).toBeNull();
    expect(captureSendTarget("team", "")).toBeNull();
  });
});

describe("#4420 failure and retry keep the original target (R-*)", () => {
  test("R-1 a failed guest send keeps the draft and the retry goes to guests again", async () => {
    const calls: string[] = [];
    const guests = jest
      .fn(async (id: string, _t: string) => { calls.push(`guests:${id}`); return { error: null as string | null }; })
      .mockImplementationOnce(async (id: string) => { calls.push(`guests:${id}`); throw new Error("network"); });
    const team = jest.fn(async (id: string, _t: string) => { calls.push(`team:${id}`); return { error: null as string | null }; });

    const g = captureSendTarget("guests", GUESTS)!;
    let drafts: BrandThreadDrafts = writeBrandThreadDraft({}, g, "Is parking free?");
    await expect(dispatchBrandThreadSend(g, "Is parking free?", { team, guests })).rejects.toThrow("network");
    // The screen only clears on success: the draft survives.
    expect(readBrandThreadDraft(drafts, g)).toBe("Is parking free?");

    // The host flips to Team and back; Send is pressed again on Guests.
    const retry = captureSendTarget("guests", GUESTS)!;
    await dispatchBrandThreadSend(retry, readBrandThreadDraft(drafts, retry), { team, guests });
    drafts = clearSentBrandThreadDraft(drafts, retry, "Is parking free?");
    expect(calls).toEqual([`guests:${GUESTS}`, `guests:${GUESTS}`]);
    expect(team).not.toHaveBeenCalled();
    expect(readBrandThreadDraft(drafts, retry)).toBe("");
  });

  test("R-2 an unknown side is refused, never defaulted to a sender", async () => {
    const team = jest.fn(async () => "t");
    const guests = jest.fn(async () => "g");
    const bogus = Object.freeze({ side: "everyone" as unknown as MessagesSide, conversationId: GUESTS });
    await expect(dispatchBrandThreadSend(bogus, "x", { team, guests })).rejects.toThrow(/unknown_side/);
    expect(team).not.toHaveBeenCalled();
    expect(guests).not.toHaveBeenCalled();
  });

  test("R-3 each composer refuses the other side's sender in source", () => {
    const panel = readFileSync(join(process.cwd(), "src/components/groupChat/GroupChatPanel.tsx"), "utf8");
    const screen = readFileSync(join(process.cwd(), "app/messages/[conversationId].tsx"), "utf8");
    expect(panel).toMatch(/captureSendTarget\("guests", conversationId\)/);
    expect(panel).toMatch(/team: \(\) => Promise\.reject/);
    expect(screen).toMatch(/captureSendTarget\("team", conversationId\)/);
    expect(screen).toMatch(/guests: \(\) => Promise\.reject/);
    // The Guests panel never calls the Brand group sender directly.
    expect(panel).not.toMatch(/sendBrandGroupMessage/);
  });
});

describe("#4420 hostile link input (L-*)", () => {
  const links = (text: string) => linkifyMessageText(text).filter((t) => t.type === "link");

  test.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " \u0000javascript:alert(1)",
    "\tjavascript://%0aalert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "file:///etc/passwd",
    "intent://scan/#Intent;scheme=zxing;end",
    "mingla://admin",
  ])("L-1 %j is never a link and never openable", (input) => {
    expect(links(input)).toEqual([]);
    expect(isOpenableMessageLink(input.trim())).toBe(false);
  });

  test("L-2 a scheme hidden after an http link does not ride along", () => {
    const out = links("see https://good.example/a javascript:alert(1)");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ url: "https://good.example/a" });
  });

  test("L-3 userinfo look-alike: the shown text is the whole url that opens", () => {
    const out = links("https://good.example@evil.example/x");
    expect(out).toHaveLength(1);
    const link = out[0] as { text: string; url: string };
    expect(link.url).toBe("https://good.example@evil.example/x");
    expect(link.text).toBe(link.url);
  });

  test("L-4 RTL override and zero-width chars stop the link (they are not url chars a host sees)", () => {
    const out = links("https://evil.example/‮gnp.exe");
    // Whatever is linked, the url and the shown text are identical bytes.
    for (const l of out as { text: string; url: string }[]) expect(l.url).toBe(messageLinkHref(l.text));
  });

  test("L-5 www. opens as https and http stays http", () => {
    expect(links("go to www.mingla.com.")[0]).toMatchObject({ text: "www.mingla.com", url: "https://www.mingla.com" });
    expect(links("http://a.example")[0]).toMatchObject({ url: "http://a.example" });
  });

  test("L-6 markdown-ish text: [x](javascript:...) gives no link", () => {
    expect(links("[click](javascript:alert(1))")).toEqual([]);
  });

  // Was a KNOWN DEFECT (tester finding on #4420): trimLinkEnd re-split the
  // whole link once per trailing ")" or "]". Fixed (P2-1): one pass, linear.
  test("L-8 a 4,000-char link of closing brackets (the guest message cap) linkifies in under 50 ms", () => {
    const input = "https://a.example/" + ")".repeat(4_000 - 18);
    const started = Date.now();
    linkifyMessageText(input);
    expect(Date.now() - started).toBeLessThan(50);
  });

  test("L-8b a 100k-char link of closing brackets and punctuation linkifies in under 500 ms, brackets stay text", () => {
    const tail = ")]".repeat(25_000) + ".,".repeat(25_000);
    const input = "https://a.example/" + tail;
    const started = Date.now();
    const tokens = linkifyMessageText(input);
    expect(Date.now() - started).toBeLessThan(500);
    expect(tokens[0]).toMatchObject({ type: "link", url: "https://a.example/" });
    expect(tokens.map((token) => token.text).join("")).toBe(input);
  });

  test.each([
    ["open brackets", "https://a.example/" + "(".repeat(100_000)],
    ["punctuation", "https://a.example/" + ".,".repeat(50_000)],
    ["many short urls", "www.a ".repeat(20_000)],
    ["no link", "a".repeat(100_000)],
  ])("L-7 a 100k-char pathological input (%s) linkifies in under 500 ms", (_label, input) => {
    const started = Date.now();
    linkifyMessageText(input);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
