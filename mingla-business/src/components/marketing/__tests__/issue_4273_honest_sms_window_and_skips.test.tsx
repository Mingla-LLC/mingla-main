/**
 * #4273 — what the composer tells a host must match what the sender does.
 *
 * Run: npx jest src/components/marketing/__tests__/issue_4273_honest_sms_window_and_skips.test.tsx --maxWorkers=2
 *
 * fails-on-revert: restoring the hard-coded "(8 AM–9 PM)" copy, or the old
 * "safely skipped because …" line, fails these assertions.
 */

// MINGLA-INVARIANT: I-4273-SMS-WINDOW-COPY-FROM-SENDER-HOURS | issue #4273 | The composer's SMS timing note is built from SMS_WINDOWS, which the drift test pins to the edge SMS_COUNTRIES windows, so it never states a window the sender does not use.
// MINGLA-INVARIANT: I-4273-SKIPPED-LINE-GIVES-NO-REASON | issue #4273 | The send-now confirmation reports recipients sealed and not sent as "couldn't be reached" with no reason.

import { readFileSync } from "fs";
import path from "path";

import {
  SMS_WINDOWS,
  formatSmsSendWindows,
} from "../../../utils/marketing/smsSendWindow";

const REVIEW = readFileSync(path.join(__dirname, "../ComposerReviewSheet.tsx"), "utf8");
const SENT = readFileSync(path.join(__dirname, "../ComposerSentConfirmation.tsx"), "utf8");
const EDGE = readFileSync(
  path.join(__dirname, "../../../../../supabase/functions/_shared/smsCountries.ts"),
  "utf8",
);

describe("#4273 SMS window copy", () => {
  it("states Nigeria's real 8 AM–8 PM window, France's and everyone else's (#4273 all countries)", () => {
    expect(formatSmsSendWindows()).toBe(
      "8 AM–8 PM in Nigeria, 8 AM–9:30 PM Monday to Saturday in France, 8 AM–9 PM everywhere else",
    );
  });

  it("is built from the sender's own hours", () => {
    // #4273 — the sender's windows live in _shared/smsCountries.ts.
    const ng = /NG: \{[^}]*?window: \{ start: H\((\d+)\), end: H\((\d+)\) \}/.exec(EDGE);
    expect(ng).not.toBeNull();
    expect(SMS_WINDOWS.NG.start).toBe(Number(ng?.[1]) * 60);
    expect(SMS_WINDOWS.NG.end).toBe(Number(ng?.[2]) * 60);
  });

  it("the review sheet uses the derived window and no single hard-coded one", () => {
    expect(REVIEW).toContain("${formatSmsSendWindows()}");
    expect(REVIEW).not.toMatch(/\(8 AM–9 PM\)/);
  });
});

describe("#4273 skipped line", () => {
  it("says couldn't be reached, without a reason", () => {
    expect(SENT).toContain("couldn't be reached.");
    expect(SENT).not.toMatch(/safely skipped because/);
  });
});
