/**
 * ORCH-1283 — remove the dead RCS composer tab.
 *
 * SOURCE-CONTRACT test (see metaOrch1281SmsPreview.test.tsx for why the default
 * node/ts-jest config can't mount ChannelTabs' RN tree).
 *
 * Verifies I-PROPOSED-1283-NO-RCS-TAB: the composer channel selector exposes
 * exactly {email, sms}; the TABS array + MarketingChannelKind carry no `rcs`;
 * and the ORCH-0815-B gate contains no assertion requiring the `rcs` literal.
 *
 * FAILS-ON-REVERT: re-adding `{ kind: "rcs", … }` to TABS (or `| "rcs"` to
 * MarketingChannelKind) fails the "no rcs" assertions; re-adding the gate's
 * `case "rcs"` / `kind: "rcs"` assertions fails the gate-clean assertions.
 */

import { readFileSync } from "fs";
import path from "path";

const TABS = readFileSync(path.join(__dirname, "../ChannelTabs.tsx"), "utf8");
const GATE = readFileSync(
  path.join(
    __dirname,
    "../../../../../.github/scripts/strict-grep/orch-0815-b-composer-and-send.mjs",
  ),
  "utf8",
);

describe("ORCH-1283 — no RCS tab", () => {
  it("ChannelTabs exposes exactly email + sms (no rcs)", () => {
    expect(TABS).toMatch(/kind:\s*["']email["']/);
    expect(TABS).toMatch(/kind:\s*["']sms["']/);
    expect(TABS).not.toMatch(/kind:\s*["']rcs["']/);
  });

  it("MarketingChannelKind is narrowed to 'email' | 'sms'", () => {
    expect(TABS).toMatch(
      /export type MarketingChannelKind\s*=\s*"email"\s*\|\s*"sms"\s*;/,
    );
    expect(TABS).not.toMatch(/MarketingChannelKind[^;]*"rcs"/);
  });

  it("no 'RCS' tab label remains in the rendered TABS", () => {
    expect(TABS).not.toMatch(/label:\s*["']RCS["']/);
  });

  it("the ORCH-0815-B gate no longer requires the rcs literal (email + sms only)", () => {
    // The rcs case + rcs tab assertions are gone…
    expect(GATE).not.toMatch(/case\\s\+\["']rcs\["']/);
    expect(GATE).not.toContain('missing rcs case');
    expect(GATE).not.toContain('literal `rcs` tab missing');
    // …but the email + sms assertions are KEPT.
    expect(GATE).toContain('missing email case');
    expect(GATE).toContain('missing sms case');
    expect(GATE).toMatch(/literal `email` tab missing/);
    expect(GATE).toMatch(/literal `sms` tab missing/);
  });
});
