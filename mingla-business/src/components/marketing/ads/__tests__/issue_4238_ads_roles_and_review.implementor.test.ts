/**
 * #4238 ads roles and honest Review questions — the client helpers.
 *
 *   B1  the server's launch / fund answers win over the role mirror in
 *       hostAdLaunchBlocker (an admin is not blocked at the hold).
 *   W1  hostAdWideningKind picks the reason: past buyers / area / mixed.
 *   W2  the past-buyers sentence is shown as the server wrote it, with the
 *       count, singular and plural; it matches the server's helper.
 *   G1  hostAdGoalFallbackReason says "not_yet" only when the app supports
 *       the goal and its signal isn't ready.
 *
 * FAILS ON REVERT: drop the capabilities branch in hostAdLaunchBlocker -> B1
 * fails; drop HOST_AD_PAST_BUYERS_LINE from hostAdTargetingNote -> W2 fails.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";

import { hostAdLaunchBlocker } from "../hostAdBuilderModel";
import {
  HOST_AD_PAST_BUYERS_LINE,
  hostAdPastBuyersLine,
  hostAdTargetingNote,
  hostAdWideningKind,
} from "../hostAdCopy";
import { hostAdGoalFallbackReason } from "../hostAdGoal";

const ok = {
  offline: false,
  canLaunch: true,
  canFund: true,
  askName: null,
  checks: [{ platform: "meta", state: "ready" as const }],
  checked: true,
  rightsConfirmed: true,
  topUpNeededCents: 0,
};

describe("B1 launch blocker reads the server's answers", () => {
  test("an admin (server: launch and fund yes) is not blocked even if the role mirror is stale", () => {
    expect(
      hostAdLaunchBlocker({
        ...ok,
        canLaunch: false,
        canFund: false,
        capabilities: { launch: { allowed: true }, change_live: { allowed: true } },
      }),
    ).toBeNull();
  });
  test("a server refusal blocks with who to ask", () => {
    expect(
      hostAdLaunchBlocker({
        ...ok,
        capabilities: {
          launch: { allowed: false, ask_name: "Tolu" },
          change_live: { allowed: false, ask_name: "Tolu" },
        },
      }),
    ).toEqual({ kind: "no_launch_access", askName: "Tolu" });
    expect(
      hostAdLaunchBlocker({
        ...ok,
        capabilities: { launch: { allowed: true }, change_live: { allowed: false, ask_name: "Tolu" } },
      }),
    ).toEqual({ kind: "no_fund_access", askName: "Tolu" });
  });
  test("no capabilities (older server): the role mirror answers as before", () => {
    expect(hostAdLaunchBlocker({ ...ok, capabilities: null })).toBeNull();
    expect(hostAdLaunchBlocker({ ...ok, canFund: false, capabilities: {} })).toEqual({
      kind: "no_fund_access",
      askName: null,
    });
  });
});

describe("W1 / W2 the reason behind a wider group", () => {
  const buyers = hostAdPastBuyersLine("Snapchat", 38);
  const area = "TikTok uses the wider area around your pin.";
  test("past buyers only, area only, both", () => {
    expect(hostAdWideningKind([buyers])).toBe("past_buyers");
    expect(hostAdWideningKind([buyers, hostAdPastBuyersLine("Google", 38)])).toBe("past_buyers");
    expect(hostAdWideningKind([area])).toBe("area");
    expect(hostAdWideningKind([buyers, area])).toBe("mixed");
    expect(hostAdWideningKind([])).toBe("area");
  });
  test("the sentence carries the count, singular and plural", () => {
    expect(buyers).toBe("Snapchat can't leave out your 38 past buyers yet, so they may see this ad.");
    expect(hostAdPastBuyersLine("Facebook & Instagram", 1)).toBe(
      "Facebook & Instagram can't leave out your 1 past buyer yet, so they may see this ad.",
    );
    expect(hostAdPastBuyersLine("TikTok", 1204)).toBe(
      "TikTok can't leave out your 1,204 past buyers yet, so they may see this ad.",
    );
    expect(HOST_AD_PAST_BUYERS_LINE.test("TikTok uses the wider area around your pin.")).toBe(false);
  });
  test("the Review row shows the line as the server wrote it", () => {
    expect(hostAdTargetingNote("snapchat", "broader", buyers)).toBe(buyers);
  });
  test("same sentence and pattern as the server helper", () => {
    const server = fs.readFileSync(
      path.resolve(__dirname, "../../../../../../supabase/functions/_shared/hostAdWidening.ts"),
      "utf8",
    );
    expect(server).toContain(
      "return `${appName} can't leave out your ${n.toLocaleString(\"en-US\")} ${people} yet, so they may see this ad.`;",
    );
    expect(server).toContain(String(HOST_AD_PAST_BUYERS_LINE).slice(1, -1));
  });
});

describe("G1 goal fallback: 'yet' only when the app supports the goal", () => {
  test("sales", () => {
    expect(hostAdGoalFallbackReason("sales", { platform: "snapchat", sales: { ready: false } })).toBe("not_yet");
    expect(hostAdGoalFallbackReason("sales", { platform: "meta" })).toBe("not_yet");
    expect(hostAdGoalFallbackReason("sales", { platform: "reddit", sales: { ready: false } })).toBe("cannot");
    expect(hostAdGoalFallbackReason("sales", { platform: "google", sales: { ready: true } })).toBe("cannot");
    expect(hostAdGoalFallbackReason("sales", { platform: "tiktok", sales: { ready: true } })).toBe("cannot");
  });
  test("sign-ups", () => {
    expect(hostAdGoalFallbackReason("signups", { platform: "meta", signups: { ready: false } })).toBe("not_yet");
    expect(hostAdGoalFallbackReason("signups", { platform: "tiktok", signups: { ready: false } })).toBe("cannot");
  });
});
