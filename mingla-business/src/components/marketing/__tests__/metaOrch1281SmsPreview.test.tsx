/**
 * ORCH-1281 — SMS blast preview (phone-bubble mock) channel-branch contract.
 *
 * SOURCE-CONTRACT test (not an RTL mount): @testing-library/react-native +
 * react-test-renderer are NOT committed deps of mingla-business's default
 * node/ts-jest config, and compose.tsx pulls in expo-router / TenTap /
 * reanimated which that config cannot mount. Per
 * feedback_biz_web_authed_runtime_unreachable_cap_claims, source-contract is
 * the honest ceiling; the tester drives the real iOS-sim runtime.
 *
 * Verifies I-PROPOSED-1281-SMS-PREVIEW-CHANNEL-BRANCHED: when channel === 'sms'
 * all three preview surfaces render the SMS preview (SmsPreviewPane / MESSAGE
 * row) and NEVER the EmailPreviewPane / email SUBJECT row; email is unchanged.
 *
 * FAILS-ON-REVERT: forcing EmailPreviewPane at the SMS branch (deleting the
 * `channel === "sms" ? <SmsPreviewPane …` guard at either preview site) fails
 * the branch assertions below; deleting the MESSAGE section in
 * ComposerReviewSheet.tsx fails the review-row assertion.
 */

import { readFileSync } from "fs";
import path from "path";

const COMPOSE = readFileSync(
  path.join(__dirname, "../../../../app/(tabs)/marketing/campaigns/compose.tsx"),
  "utf8",
);
const REVIEW = readFileSync(
  path.join(__dirname, "../ComposerReviewSheet.tsx"),
  "utf8",
);
const PANE = readFileSync(
  path.join(__dirname, "../SmsPreviewPane.tsx"),
  "utf8",
);

describe("ORCH-1281 — SmsPreviewPane channel-branch", () => {
  it("compose.tsx imports SmsPreviewPane", () => {
    expect(COMPOSE).toMatch(
      /import\s*\{\s*SmsPreviewPane\s*\}\s*from\s*["'][^"']*SmsPreviewPane["']/,
    );
  });

  it("branches the wide-desktop rail + inbox modal to SmsPreviewPane for channel === 'sms'", () => {
    // Both preview sites gate on channel === "sms" before rendering SmsPreviewPane.
    const branchMatches = COMPOSE.match(/channel === "sms" \? \(\s*<SmsPreviewPane/g) ?? [];
    expect(branchMatches.length).toBeGreaterThanOrEqual(2);
    // Email is still rendered on the non-sms side (email untouched).
    expect(COMPOSE).toMatch(/<EmailPreviewPane/);
  });

  it("retitles the inbox-preview modal to 'Message preview' for SMS", () => {
    expect(COMPOSE).toMatch(
      /channel === "sms" \? "Message preview" : "Inbox preview"/,
    );
  });

  it("passes channel-aware review props (MESSAGE row) to ComposerReviewSheet", () => {
    expect(COMPOSE).toMatch(/channelKind=\{channel === "sms" \? "sms" : "email"\}/);
    expect(COMPOSE).toMatch(/messagePreview=\{bodyWithFooter\(smsBody\)/);
  });

  it("ComposerReviewSheet shows a MESSAGE section for sms (not SUBJECT)", () => {
    // The MESSAGE branch is gated on channelKind === "sms".
    expect(REVIEW).toMatch(/channelKind === "sms" \?/);
    expect(REVIEW).toContain(">MESSAGE<");
    // The email SUBJECT section is still the else-branch (email unchanged).
    expect(REVIEW).toContain(">SUBJECT<");
  });

  it("SmsPreviewPane renders the wire body (STOP footer) + text-message caption, not email chrome", () => {
    // Uses the shared wire-body helper (so the previewed text = what is sent).
    expect(PANE).toMatch(/bodyWithFooter\(body\)/);
    // Honest sender caption (SMS/MMS), not an email FROM/Unsubscribe.
    expect(PANE).toContain("Text message · SMS");
    expect(PANE).toContain("Picture message · MMS");
    // No email chrome RENDERS (EmailPreviewPane shows >Unsubscribe< + >FROM<
    // text nodes; the word "Unsubscribe" only appears here in a doc comment).
    expect(PANE).not.toMatch(/>\s*Unsubscribe\s*</);
    expect(PANE).not.toMatch(/>\s*FROM\s*</);
    // Live count via the SAME cost util the composer + adapter use.
    expect(PANE).toMatch(/estimateSmsCost\(body,/);
  });

  it("SmsPreviewPane has an empty state + honest preview footer note", () => {
    expect(PANE).toContain("Start typing your text to preview it.");
    expect(PANE).toMatch(/Preview only — carriers render texts slightly differently/);
  });
});
