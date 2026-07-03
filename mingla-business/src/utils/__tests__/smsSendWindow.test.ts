/**
 * ORCH-1270 — composer send-window helper + T-9 drift guard.
 *
 * Run: npx jest src/utils/__tests__/smsSendWindow.test.ts --runInBand
 *
 * fails-on-revert: the T-9 block fails if the client SMS_QUIET_HOURS drifts
 * from the edge fn QUIET_HOURS; the nextGlobalSendWindowOpen cases fail if the
 * "already-open ⇒ now / else soonest-open" math breaks.
 *
 * ORCH-1270 F-1: `isAnyMarketInSendWindow` was removed as dead code — with the
 * SUPPORTED_SMS_ZONES set (Honolulu UTC-10 … Lagos UTC+1) it returned true for
 * every instant, so the composer warning it gated never fired. The review-sheet
 * note is now always-on informational for an SMS send-now, so the predicate has
 * no caller and its always-true assertions were dropped. What remains is the
 * genuinely load-bearing surface: nextGlobalSendWindowOpen (labels + drives the
 * "Schedule for …" CTA) and the T-9 drift guard.
 */

import { readFileSync } from "fs";
import path from "path";

import {
  SMS_QUIET_HOURS,
  SUPPORTED_SMS_ZONES,
  nextGlobalSendWindowOpen,
} from "../marketing/smsSendWindow";

describe("ORCH-1270 smsSendWindow — nextGlobalSendWindowOpen", () => {
  it("returns ~now when some zone is already open (in-window ⇒ 0 hours)", () => {
    // 15:00 UTC summer: NY 11:00, LA 08:00, Lagos 16:00 — all inside their
    // windows, so the soonest window is now.
    const now = new Date("2026-06-29T15:00:00Z");
    const next = nextGlobalSendWindowOpen(now);
    expect(next.getTime()).toBe(now.getTime());
  });

  it("returns a Date at or after now and within the next 24 h", () => {
    const now = new Date("2026-01-15T03:00:00Z");
    const next = nextGlobalSendWindowOpen(now);
    expect(next.getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(next.getTime()).toBeLessThanOrEqual(now.getTime() + 24 * 60 * 60 * 1000);
  });

  it("returns a valid Date and never throws across all 24 UTC hours", () => {
    for (let h = 0; h < 24; h += 1) {
      const d = new Date(Date.UTC(2026, 5, 29, h, 0, 0));
      const next = nextGlobalSendWindowOpen(d);
      expect(Number.isNaN(next.getTime())).toBe(false);
    }
  });
});

describe("ORCH-1270 smsSendWindow — SUPPORTED_SMS_ZONES", () => {
  it("covers the 7 distinct US IANA zones + Lagos, market-tagged", () => {
    const zones = SUPPORTED_SMS_ZONES.map((z) => z.zone);
    for (const z of [
      "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix",
      "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "Africa/Lagos",
    ]) {
      expect(zones).toContain(z);
    }
    expect(SUPPORTED_SMS_ZONES.find((z) => z.zone === "Africa/Lagos")?.market).toBe("NG");
    expect(SUPPORTED_SMS_ZONES.find((z) => z.zone === "America/New_York")?.market).toBe("US");
  });
});

// ─── T-9 drift guard (SPEC §8.2) ──────────────────────────────────────────────
describe("ORCH-1270 T-9 — client SMS_QUIET_HOURS equals edge fn QUIET_HOURS", () => {
  it("does not drift from supabase/functions/marketing-send/index.ts", () => {
    const edgePath = path.join(
      __dirname,
      "../../../../supabase/functions/marketing-send/index.ts",
    );
    const edgeSrc = readFileSync(edgePath, "utf8");

    // Extract the edge fn's QUIET_HOURS US/NG {startHour,endHour} tuples.
    const block = edgeSrc.match(/const QUIET_HOURS\s*=\s*\{([\s\S]*?)\}\s*as const;/);
    expect(block).not.toBeNull();
    const body = block![1];
    const grab = (market: string): { startHour: number; endHour: number } => {
      const m = body.match(
        new RegExp(`${market}:\\s*\\{\\s*startHour:\\s*(\\d+),\\s*endHour:\\s*(\\d+)`),
      );
      expect(m).not.toBeNull();
      return { startHour: parseInt(m![1], 10), endHour: parseInt(m![2], 10) };
    };

    expect(grab("US")).toEqual({
      startHour: SMS_QUIET_HOURS.US.startHour,
      endHour: SMS_QUIET_HOURS.US.endHour,
    });
    expect(grab("NG")).toEqual({
      startHour: SMS_QUIET_HOURS.NG.startHour,
      endHour: SMS_QUIET_HOURS.NG.endHour,
    });
  });
});
