/*
 * #4453 — the "Choose your design" live preview asks Core for up to three
 * styles at a time. Core counts every plan-preview request (3 a minute, 20 a
 * day per brand), so one request per clicked style ran into "Try again in a
 * minute" on the fourth style and could spend the day's previews quickly.
 */
import { previewBatch } from "../planPreviewApi";
import type { DesignKey } from "../../../../packages/site-contracts/src/designs.ts";

const QUEUE: DesignKey[] = ["voyage", "nocturne", "haven", "grid", "pop", "journal", "maison", "sunset", "pulse", "terra"];
const none = () => false;

describe("#4453 style previews are asked for three at a time", () => {
  it("the picked style first, then the next two in the picker's order", () => {
    expect(previewBatch("haven", QUEUE, none)).toEqual(["haven", "grid", "pop"]);
  });

  it("wraps around at the end of the list", () => {
    expect(previewBatch("terra", QUEUE, none)).toEqual(["terra", "voyage", "nocturne"]);
  });

  it("skips styles already loaded, so each style is asked for once", () => {
    const loaded = (key: DesignKey) => key === "grid" || key === "pop";
    expect(previewBatch("haven", QUEUE, loaded)).toEqual(["haven", "journal", "maison"]);
  });

  it("ten styles cost four requests or fewer when clicked in order", () => {
    const have = new Set<DesignKey>();
    let requests = 0;
    for (const style of QUEUE) {
      if (have.has(style)) continue;
      requests += 1;
      for (const key of previewBatch(style, QUEUE, (k) => have.has(k))) have.add(key);
    }
    expect(requests).toBeLessThanOrEqual(4);
  });

  it("a style outside the queue (an avoid style is never in it) still asks for itself", () => {
    expect(previewBatch("atelier", QUEUE, none)[0]).toBe("atelier");
  });
});
