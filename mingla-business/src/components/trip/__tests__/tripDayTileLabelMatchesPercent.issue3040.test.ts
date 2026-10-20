/**
 * #3040 — observed 2026-10-19 on job 2ad825b6 (Host web, trip-day video): the
 * tile showed "Uploading · 99%" while the accessibility tree read "uploading,
 * 75 percent". What assistive tech reads must be the number on screen.
 * Invariant I-VIDEO-ACK-NEVER-BEHIND-SIGN-IN (declared in mingla-business/src/services/__tests__/laneAckWithinTwoSeconds.issue3040.test.ts): the 99% hold lasts only until the server confirms
 *
 * FAILS ON REVERT:
 *   L1  tileAnnouncement goes back to the 25/50/75 step text
 *   L2  `sheetProgressLine` reads the raw service percent again (it showed
 *       100 while the tile said 99)
 */
import {
  newTripDayTile,
  sheetProgressLine,
  tileA11yLabel,
  tileAnnouncement,
  tileFromProgress,
  tileVisual,
  type TripDayTile,
} from "../tripDayTileModel";

const uploadingTile = (servicePercent: number | null): TripDayTile => ({
  ...newTripDayTile({ key: "k", kind: "video", durationMs: 8_000 }),
  ...tileFromProgress({ phase: "uploading", percent: servicePercent }),
});

const numbersIn = (text: string): number[] => (text.match(/\d+/g) ?? []).map(Number);

describe("#3040 — the accessibility label equals the visible percent", () => {
  it("L1 for every percent the service can report, label and live region never contradict the tile", () => {
    for (let percent = 0; percent <= 100; percent += 1) {
      const tile = uploadingTile(percent);
      const visible = tileVisual(tile).label;
      expect(visible).toBe(`${tile.percent}%`);
      expect(tileA11yLabel(tile, 0)).toBe(`Video 1, uploading, ${tile.percent} percent. Double tap to cancel.`);
      // The live region: the item number only, never a stale step.
      expect(numbersIn(tileAnnouncement(tile, 0))).toEqual([1]);
    }
    // The production moment: 99 on screen, 99 in the label.
    expect(tileA11yLabel(uploadingTile(99), 0)).toContain("99 percent");
    expect(tileAnnouncement(uploadingTile(99), 0)).not.toContain("75");
  });

  it("an upload with no honest number yet says so everywhere", () => {
    const tile = uploadingTile(null);
    expect(tileVisual(tile).label).toBe("Uploading");
    expect(tileA11yLabel(tile, 0)).toBe("Video 1, uploading. Double tap to cancel.");
  });

  it("L2 the sheet's progress line shows the tile's number, not the raw service percent", () => {
    for (let percent = 0; percent <= 100; percent += 1) {
      const progress = { phase: "uploading" as const, percent };
      const tile = uploadingTile(percent);
      expect(sheetProgressLine(progress)).toBe(`Uploading · ${tile.percent}%`);
      expect(tileA11yLabel(tile, 0)).toContain(`${tile.percent} percent`);
    }
    // The service reports 100 the instant every byte is confirmed; the tile
    // still says 99 until "Confirming", so the line must too.
    expect(sheetProgressLine({ phase: "uploading", percent: 100 })).toBe("Uploading · 99%");
    expect(sheetProgressLine({ phase: "uploading", percent: null })).toBe("Uploading…");
    expect(sheetProgressLine({ phase: "confirming", percent: null })).toBe("Confirming upload…");
  });
});
