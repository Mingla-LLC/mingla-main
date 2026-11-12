// MINGLA-INVARIANT: I-4389-ARI-CLIENT-REDACTS-DIGITS | issue #4389 | The Ari composer redacts every run of 8 or more digits, and card-style groups of three or more 4-digit blocks, before a message is sent, so bank, card and ID numbers reach neither Ari nor the server.
/**
 * #4389 A1–A5 — Ari's setup cards and the client redaction (AR-3).
 */
import { describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

import { redactSensitiveDigits } from "../../../components/ari/ariRedaction";
import { ARI_SETUP_COPY, payoutCountryLabel } from "../../../components/ari/ariSetupCopy";
import { BRAND_SETUP_BANNED_WORDS } from "../../../components/brand/brandSetupCopy";
import { firstRunGreeting } from "../../../utils/firstRunState";

const read = (rel: string): string => fs.readFileSync(path.join(__dirname, rel), "utf8");

describe("#4389 A5 — digits redacted before send", () => {
  test.each([
    ["My account number is 0123456789", "My account number is ••••••••••"],
    ["card 4242 4242 4242 4242 thanks", "card •••• •••• •••• •••• thanks"],
    ["sort 12-34-56 acct 12345678", "sort 12-34-56 acct ••••••••"],
  ])("%s", (input, out) => {
    const r = redactSensitiveDigits(input);
    expect(r.text).toBe(out);
    expect(r.redacted).toBe(true);
    expect(r.text).not.toMatch(/\d{8,}/);
  });
  test("short numbers, prices and dates stay", () => {
    for (const t of ["2 tickets for Friday", "£25 at 9pm", "15 Nov 2026", "call 1234567"]) {
      expect(redactSensitiveDigits(t)).toEqual({ text: t, redacted: false });
    }
  });
  test("the composer redacts before anything is sent and shows the A5 notice", () => {
    const src = read("../AriChatScreen.tsx");
    const at = src.indexOf("const safe = redactSensitiveDigits(text);");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(src.indexOf(".sendMessage(text, selectedFiles"));
    expect(src).toContain("<AriSensitiveNotice");
    expect(ARI_SETUP_COPY.a5.notice).toBe("Please don't share that here. I've hidden it. Use the secure screen.");
  });
});

describe("#4389 A1 / A2 — cards from the checklist, not Ari's words", () => {
  test("A1 words, no business", () => {
    const copy = firstRunGreeting({ stage: "no_brand", displayName: "Tobi Ade", brandName: null, remembered: null });
    expect(copy.headline).toBe("Hi Tobi. Let's get your account ready to take bookings.");
    expect(`${copy.headline} ${copy.body}`).not.toMatch(/business/i);
  });
  test("the greeting is told whether brand_setup is complete (#4389 P2: never 'is set up' early)", () => {
    expect(read("../AriChatScreen.tsx")).toContain("setupComplete: setupData?.facts.complete === true");
  });

  test("the screen mounts A1 under the greeting and A2 from useBrandSetupChecklist", () => {
    const src = read("../AriChatScreen.tsx");
    expect(src).toContain("footer={firstRunSetupCard}");
    expect(src).toContain("useBrandSetupChecklist(");
    expect(src).toContain('state="complete"');
    expect(src).toContain('onSetUp={() => router.push("/brand/new" as never)}');
  });
  test("no banned words in Ari setup copy", () => {
    const all = JSON.stringify(ARI_SETUP_COPY) + ARI_SETUP_COPY.a1.headline("A") + ARI_SETUP_COPY.a2.lead("B", 2, "Organiser Terms") + ARI_SETUP_COPY.a3.question("B", "Canada", "CAD");
    for (const word of BRAND_SETUP_BANNED_WORDS) expect(all).not.toMatch(word);
  });
});

describe("#4389 A3 / A4", () => {
  test("A3 names where funds are collected", () => {
    expect(payoutCountryLabel("ca")).toEqual({ name: "Canada", currency: "CAD" });
    expect(payoutCountryLabel("NG")).toEqual({ name: "Nigeria", currency: "NGN" });
    expect(payoutCountryLabel("ZZ")).toBeNull();
    expect(ARI_SETUP_COPY.a3.question("Lantern Room", "Canada", "CAD")).toBe(
      "Create Lantern Room collecting funds in Canada (CAD)?",
    );
    expect(read("../../../components/ari/ToolProposalCard.tsx")).toContain("payoutCountryLabel(args.payout_country)");
  });
  test("A4 handoff cards map each start_payments_onboarding outcome", () => {
    // MessageList pulls the animation runtime; read the mapping from source.
    const src = read("../../../components/ari/MessageList.tsx");
    expect(src).toContain('if (toolName === "start_payments_onboarding") {');
    expect(src).toContain("if (r.requires_owner === true)");
    expect(src).toContain('missing.includes("money.terms_member")');
    expect(src).toContain('if (toolName === "start_door_sale" && route !== null)');
    expect(ARI_SETUP_COPY.a4.secureBody).toBe("Bank and ID details are entered on a secure screen, not in chat.");
    expect(read("../AriChatScreen.tsx")).toContain("onOpenRoute={(route) => router.push(route as never)}");
  });
});

// ── A1 / A2 / A5 cards, rendered ────────────────────────────────────────
/* eslint-disable import/first, @typescript-eslint/no-require-imports */
import React from "react";
import { AriSensitiveNotice, AriSetupCard } from "../../../components/ari/AriSetupCard";

const TR = require("react-test-renderer") as {
  create(el: React.ReactElement): {
    root: { findAll(fn: (n: { props: Record<string, unknown> }) => boolean): Array<{ props: Record<string, unknown> }> };
    toJSON(): unknown;
    unmount(): void;
  };
  act(cb: () => void): void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(el: React.ReactElement) {
  let tree!: ReturnType<typeof TR.create>;
  TR.act(() => {
    tree = TR.create(el);
  });
  return tree;
}
const press = (tree: ReturnType<typeof TR.create>, id: string): void => {
  const node = tree.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === "function")[0];
  if (!node) throw new Error(`no ${id}`);
  TR.act(() => (node.props.onPress as () => void)());
};

describe("#4389 cards render from their inputs", () => {
  test("A1: four rows, About 3 minutes, both buttons work", () => {
    const onSetUp = jest.fn();
    const onWithAri = jest.fn();
    const tree = mount(React.createElement(AriSetupCard, { brandName: null, doneCount: 0, onSetUp, onWithAri }));
    const text = JSON.stringify(tree.toJSON());
    for (const t of ["Set up your brand", "About 3 minutes", "Brand name", "Bank country", "Organiser Terms", "Payment details"]) {
      expect(text).toContain(t);
    }
    press(tree, "ari-setup-start");
    press(tree, "ari-setup-with-ari");
    expect(onSetUp).toHaveBeenCalledTimes(1);
    expect(onWithAri).toHaveBeenCalledTimes(1);
    tree.unmount();
  });
  test("A2: progress from doneCount; waiting for a client hides Continue", () => {
    const tree = mount(React.createElement(AriSetupCard, { brandName: "Lantern Room", doneCount: 2, waitingFor: "Ada", onSetUp: jest.fn() }));
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain("2 of 4 done");
    expect(text).toContain("Waiting for Ada");
    expect(tree.root.findAll((n) => n.props.testID === "ari-setup-continue")).toHaveLength(0);
    const bar = tree.root.findAll((n) => n.props.accessibilityRole === "progressbar")[0];
    expect(bar?.props.accessibilityValue).toEqual({ min: 0, max: 4, now: 2 });
    tree.unmount();
  });
  test("complete collapses to All set; A5 notice opens the secure screen", () => {
    const done = mount(React.createElement(AriSetupCard, { brandName: "X", doneCount: 4, state: "complete", onSetUp: jest.fn() }));
    expect(JSON.stringify(done.toJSON())).toContain("All set");
    done.unmount();
    const onOpen = jest.fn();
    const notice = mount(React.createElement(AriSensitiveNotice, { onOpen }));
    press(notice, "ari-sensitive-open");
    expect(onOpen).toHaveBeenCalledTimes(1);
    notice.unmount();
  });
});
