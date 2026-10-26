/**
 * #4111 P1-1 — the /m/{token} composer is never covered by floating UI.
 * Executes the web bar's real `measureObstructionLift` against a stubbed
 * document whose hit-test stack mirrors the 375px case the tester found: the
 * "Ad privacy choices" button (bottom 16, 44px tall) sitting on Send.
 *
 * FAILS-ON-REVERT: making measureObstructionLift return 0 (no lift) fails the
 * chip and consent-card cases.
 */
import { describe, expect, test } from "@jest/globals";

import { measureObstructionLift } from "../PinnedBottomBar.web";

class FakeElement {
  constructor(
    public rect: { top: number; bottom: number; left: number; right: number },
    public children: FakeElement[] = [],
  ) {}
  getBoundingClientRect() {
    const { top, bottom, left, right } = this.rect;
    return { top, bottom, left, right, width: right - left, height: bottom - top };
  }
  contains(other: FakeElement): boolean {
    return other === this || this.children.some((c) => c.contains(other));
  }
}

const VIEW = { innerWidth: 375, innerHeight: 740, HTMLElement: FakeElement };

/** A document whose elementsFromPoint returns, top-most first, every element whose rect holds the point. */
const docWith = (stack: FakeElement[]) =>
  ({
    defaultView: VIEW,
    elementsFromPoint: (x: number, y: number) =>
      stack.filter((e) => {
        const r = e.rect;
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      }),
  }) as unknown as Document;

const composerAt = (lift: number) => new FakeElement({ top: 651 - lift, bottom: 740 - lift, left: 0, right: 375 });

describe("#4111 P1-1 pinned composer clearance", () => {
  test("the floating privacy button lifts the composer clear of it (8px gap)", () => {
    const bar = composerAt(0);
    const chip = new FakeElement({ top: 680, bottom: 724, left: 221, right: 359 });
    const page = new FakeElement({ top: 0, bottom: 740, left: 0, right: 375 }, [bar]);
    const lift = measureObstructionLift(bar as unknown as HTMLElement, 0, docWith([chip, bar, page]));
    expect(lift).toBe(740 - 680 + 8);
    // Re-measured once lifted, the same footprint gives the same answer (stable, no oscillation).
    const lifted = composerAt(lift);
    const again = measureObstructionLift(lifted as unknown as HTMLElement, lift, docWith([chip, page]));
    expect(again).toBe(lift);
  });

  test("the consent card (relative children inside a floating wrapper) lifts it too", () => {
    const bar = composerAt(0);
    const card = new FakeElement({ top: 477, bottom: 724, left: 16, right: 359 });
    expect(measureObstructionLift(bar as unknown as HTMLElement, 0, docWith([card, bar]))).toBe(740 - 477 + 8);
  });

  test("nothing floating, a page container, or a full-screen layer → no lift (#2331 inset alone)", () => {
    const bar = composerAt(0);
    const page = new FakeElement({ top: 0, bottom: 740, left: 0, right: 375 }, [bar]);
    const overlay = new FakeElement({ top: 0, bottom: 740, left: 0, right: 375 });
    expect(measureObstructionLift(bar as unknown as HTMLElement, 0, docWith([bar, page]))).toBe(0);
    expect(measureObstructionLift(bar as unknown as HTMLElement, 0, docWith([overlay, bar]))).toBe(0);
  });
});
