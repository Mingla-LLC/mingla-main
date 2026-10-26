/**
 * #4111 retest — independent tester adversarial proof for the /m composer lift.
 *
 * Found at runtime (375px, a 14-message thread): once the composer had lifted
 * above the "Ad privacy choices" button, the thread bubbles scrolling behind
 * its old footprint were counted as floaters, so the composer jumped between
 * 68 and 149 px as the guest scrolled, with messages showing BELOW it.
 *
 * This suite runs the real `measureObstructionLift` against a document that
 * models parents and computed overflow: content inside the thread's scroller
 * never lifts the bar; the floating button still does; the answer does not
 * change with scroll position.
 *
 * FAILS-ON-REVERT: removing the `insidePageScroller` skip makes the
 * "scroll position never moves the composer" and "bubble alone" cases fail.
 */
import { describe, expect, test } from "@jest/globals";

import { measureObstructionLift } from "../PinnedBottomBar.web";

class Node2 {
  parentElement: Node2 | null = null;
  constructor(
    public rect: { top: number; bottom: number; left: number; right: number },
    public overflowY = "visible",
    public scroll = { scrollHeight: 0, clientHeight: 0 },
    public kids: Node2[] = [],
  ) {
    for (const k of kids) k.parentElement = this;
  }
  get scrollHeight() {
    return this.scroll.scrollHeight;
  }
  get clientHeight() {
    return this.scroll.clientHeight;
  }
  getBoundingClientRect() {
    const { top, bottom, left, right } = this.rect;
    return { top, bottom, left, right, width: right - left, height: bottom - top };
  }
  contains(other: Node2): boolean {
    return other === this || this.kids.some((k) => k.contains(other));
  }
}

const H = 812;
const W = 375;
const view = {
  innerWidth: W,
  innerHeight: H,
  HTMLElement: Node2,
  getComputedStyle: (n: Node2) => ({ overflowY: n.overflowY }),
};

const docOf = (all: Node2[]) =>
  ({
    defaultView: view,
    // top-most first: later entries are painted on top
    elementsFromPoint: (x: number, y: number) =>
      all
        .filter((e) => x >= e.rect.left && x <= e.rect.right && y >= e.rect.top && y <= e.rect.bottom)
        .reverse(),
  }) as unknown as Document;

/** The page: [scroller > bubble(s)], composer (lifted by `lift`), floating button. */
function page(lift: number, bubbleTop: number | null, withChip: boolean) {
  const bar = new Node2({ top: H - 89 - lift, bottom: H - lift, left: 0, right: W });
  const bubble = bubbleTop === null ? null : new Node2({ top: bubbleTop, bottom: bubbleTop + 82, left: 64, right: 359 });
  const content = new Node2({ top: -600, bottom: 1310, left: 0, right: W }, "visible", { scrollHeight: 0, clientHeight: 0 }, bubble ? [bubble] : []);
  const scroller = new Node2({ top: 64, bottom: H, left: 0, right: W }, "auto", { scrollHeight: 1910, clientHeight: 748 }, [content]);
  const chip = new Node2({ top: 752, bottom: 796, left: 221, right: 359 });
  const root = new Node2({ top: 0, bottom: H, left: 0, right: W }, "visible", { scrollHeight: 0, clientHeight: 0 }, [scroller, bar, ...(withChip ? [chip] : [])]);
  const layers = [root, scroller, content, ...(bubble ? [bubble] : []), bar, ...(withChip ? [chip] : [])];
  return { bar, doc: docOf(layers) };
}

describe("#4111 retest — thread content never lifts the composer", () => {
  test("a bubble scrolling behind the composer's footprint alone → no lift", () => {
    const { bar, doc } = page(0, 730, false);
    // Simulate the already-lifted state, where the bubble is visible in the old footprint.
    const lifted = page(60, 730, false);
    expect(measureObstructionLift(bar as unknown as HTMLElement, 0, doc)).toBe(0);
    expect(measureObstructionLift(lifted.bar as unknown as HTMLElement, 60, lifted.doc)).toBe(0);
  });

  test("the floating button still lifts it: 812 - 752 + 8 = 68", () => {
    const { bar, doc } = page(0, null, true);
    expect(measureObstructionLift(bar as unknown as HTMLElement, 0, doc)).toBe(68);
  });

  test("scroll position never moves the composer once it cleared the button", () => {
    const answers = new Set<number>();
    for (const bubbleTop of [600, 650, 700, 724, 740, 760, 790, null]) {
      const { bar, doc } = page(68, bubbleTop, true);
      answers.add(measureObstructionLift(bar as unknown as HTMLElement, 68, doc));
    }
    expect([...answers]).toEqual([68]);
  });
});
