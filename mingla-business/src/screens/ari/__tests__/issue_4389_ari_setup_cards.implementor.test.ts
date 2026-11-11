/**
 * #4389 A1–A5 — Ari's setup cards and the client redaction (AR-3).
 */
import { describe, expect, test } from "@jest/globals";
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
