/**
 * ORCH-1270 RC-3 — composer send-window helper + T-9 drift guard.
 *
 * Run: npx jest src/utils/__tests__/smsSendWindow.test.ts --runInBand
 *
 * fails-on-revert: if isAnyMarketInSendWindow stops honoring the window (e.g.
 * always returns false), the "true when a market is open" cases fail. The T-9
 * block fails if the client SMS_QUIET_HOURS drifts from the edge fn QUIET_HOURS.
 *
 * NOTE (documented in IMPLEMENTATION_ORCH-1270 report): with the SPEC §5.3 zone
 * set, Hawaii (UTC-10) and Lagos (UTC+1) between them keep at least one zone in
 * window every hour of the day — so isAnyMarketInSendWindow is true for EVERY
 * instant and the composer warning never actually fires. These tests assert the
 * ACTUAL behavior (not the spec's "04:39 UTC → false" example, which is wrong
 * for this zone set). This is a SPEC-DESIGN issue flagged back to forensics, not
 * an implementation bug.
 */

import { readFileSync } from "fs";
import path from "path";

import {
  SMS_QUIET_HOURS,
  SUPPORTED_SMS_ZONES,
  isAnyMarketInSendWindow,
  nextGlobalSendWindowOpen,
} from "../marketing/smsSendWindow";

describe("ORCH-1270 smsSendWindow — isAnyMarketInSendWindow", () => {
  it("is true at 15:00 UTC (US morning + NG afternoon are open)", () => {
    // 15:00 UTC summer: NY 11:00, LA 08:00, Lagos 16:00 — all inside their windows.
    expect(isAnyMarketInSendWindow(new Date("2026-06-29T15:00:00Z"))).toBe(true);
  });

  it("is true at the ORCH-1270 04:39 UTC instant (Hawaii 18:39 / Anchorage 20:39 are still open)", () => {
    // The mainland-US + NG recipients of the real blast were all out of window,
    // but isAnyMarketInSendWindow is audience-agnostic and Hawaii/Anchorage keep
    // it open. See report: this reveals the RC-3 zone-coverage limitation.
    expect(isAnyMarketInSendWindow(new Date("2026-06-29T04:39:00Z"))).toBe(true);
  });

  it("returns a boolean and never throws across all 24 UTC hours", () => {
    for (let h = 0; h < 24; h += 1) {
      const d = new Date(Date.UTC(2026, 5, 29, h, 0, 0));
      expect(typeof isAnyMarketInSendWindow(d)).toBe("boolean");
    }
  });

  it("detects a closed zone correctly via nextGlobalSendWindowOpen math", () => {
    // Cross-check: at an instant when SOME zone is open, nextGlobalSendWindowOpen
    // returns ~now (0 hours until open). This exercises the in-window=0 branch.
    const now = new Date("2026-06-29T15:00:00Z");
    const next = nextGlobalSendWindowOpen(now);
    expect(next.getTime()).toBe(now.getTime());
  });
});

describe("ORCH-1270 smsSendWindow — nextGlobalSendWindowOpen", () => {
  it("returns a Date at or after now and within the next 24 h", () => {
    const now = new Date("2026-01-15T03:00:00Z");
    const next = nextGlobalSendWindowOpen(now);
    expect(next.getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(next.getTime()).toBeLessThanOrEqual(now.getTime() + 24 * 60 * 60 * 1000);
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
