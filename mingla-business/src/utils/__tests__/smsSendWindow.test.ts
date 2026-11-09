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
  SMS_WINDOWS,
  SUPPORTED_SMS_ZONES,
  formatSmsSendWindows,
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
    expect(SUPPORTED_SMS_ZONES.find((z) => z.zone === "America/New_York")?.market).toBe("DEFAULT");
    expect(SUPPORTED_SMS_ZONES.find((z) => z.zone === "Europe/Paris")?.market).toBe("FR");
  });
});

// ─── T-9 drift guard — #4273: the edge windows live in _shared/smsCountries.ts
describe("ORCH-1270 T-9 / #4273 — client SMS_WINDOWS equal the edge SMS_COUNTRIES rows", () => {
  const edgePath = path.join(__dirname, "../../../../supabase/functions/_shared/smsCountries.ts");
  const edgeSrc = readFileSync(edgePath, "utf8");
  const minutes = (expr: string): number => {
    const m = expr.match(/H\((\d+)(?:,\s*(\d+))?\)/);
    expect(m).not.toBeNull();
    return parseInt(m![1], 10) * 60 + (m![2] ? parseInt(m![2], 10) : 0);
  };

  it("the default window (DAY) matches", () => {
    const day = edgeSrc.match(/const DAY = \{ start: (H\([^)]*\)), end: (H\([^)]*\)) \}/);
    expect(day).not.toBeNull();
    expect({ start: minutes(day![1]), end: minutes(day![2]) }).toEqual({
      start: SMS_WINDOWS.DEFAULT.start,
      end: SMS_WINDOWS.DEFAULT.end,
    });
  });

  it("Nigeria's window matches", () => {
    const ng = edgeSrc.match(/NG: \{[^}]*?window: \{ start: (H\([^)]*\)), end: (H\([^)]*\)) \}/);
    expect(ng).not.toBeNull();
    expect({ start: minutes(ng![1]), end: minutes(ng![2]) }).toEqual({ start: SMS_WINDOWS.NG.start, end: SMS_WINDOWS.NG.end });
  });

  it("France's window and days match", () => {
    const fr = edgeSrc.match(/FR: eu\(\[[^\]]*\],\s*\{\s*window: \{ start: (H\([^)]*\)), end: (H\([^)]*\)), days: \[([^\]]*)\]/);
    expect(fr).not.toBeNull();
    expect({ start: minutes(fr![1]), end: minutes(fr![2]) }).toEqual({ start: SMS_WINDOWS.FR.start, end: SMS_WINDOWS.FR.end });
    expect(fr![3].split(",").map((d) => parseInt(d.trim(), 10))).toEqual([...SMS_WINDOWS.FR.days]);
  });

  it("the host copy names all three windows", () => {
    expect(formatSmsSendWindows()).toBe(
      "8 AM–8 PM in Nigeria, 8 AM–9:30 PM Monday to Saturday in France, 8 AM–9 PM everywhere else",
    );
  });
});
