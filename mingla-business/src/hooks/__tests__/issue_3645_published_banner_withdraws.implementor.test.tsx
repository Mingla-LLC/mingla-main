/**
 * issue #3645 — the "Published. It's live." banner stops saying so the moment
 * it is no longer true.
 *
 * Live test, 2026-10-13: an experience was published (banner shown), then
 * returned to draft, and the banner stayed on the manage screen. It now goes
 * when the item is returned to draft, cancelled, or the screen switches to
 * another id — and it does not come back.
 *
 * The real hook and the real signal run here. That all four manage screens
 * pass the item's status, and open the share sheet from one place behind the
 * arrival guard, is enforced by the strict-grep gate
 * .github/scripts/strict-grep/issue-3645-paid-drafts-stop-at-publish.mjs, groups E-g and E-l.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

import {
  PUBLISH_ARRIVAL_PRESS_GUARD_MS,
  isNoLongerLiveStatus,
  isWithinPublishArrivalGuard,
  useJustPublishedArrival,
  type JustPublishedArrival,
} from "../useJustPublishedArrival";
import {
  markJustPublished,
  resetJustPublishedForTests,
} from "../../utils/justPublishedSignal";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
interface Tree {
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (action: () => void | Promise<void>) => Promise<void>;
};

let arrival: JustPublishedArrival | null = null;
function Screen({ id, status }: { id: string | null; status?: string | null }): null {
  arrival = useJustPublishedArrival(id, status);
  return null;
}
const shown = (): boolean => (arrival as JustPublishedArrival).justPublished;

async function mount(element: React.ReactElement): Promise<Tree> {
  let tree: Tree | null = null;
  await renderer.act(async () => {
    tree = renderer.create(element);
  });
  return tree as unknown as Tree;
}
async function update(tree: Tree, element: React.ReactElement): Promise<void> {
  await renderer.act(async () => {
    tree.update(element);
  });
}

beforeEach(() => {
  resetJustPublishedForTests();
  arrival = null;
});
afterEach(() => resetJustPublishedForTests());

describe("#3645 — which statuses withdraw the banner", () => {
  test("draft and cancelled do; everything else, including unknown, does not", () => {
    expect(isNoLongerLiveStatus("draft")).toBe(true);
    expect(isNoLongerLiveStatus("cancelled")).toBe(true);
    for (const status of ["scheduled", "live", "ended", "", null, undefined]) {
      expect(isNoLongerLiveStatus(status)).toBe(false);
    }
  });
});

describe("#3645 — the banner follows the truth", () => {
  test("still shown straight after a publish (unchanged)", async () => {
    markJustPublished("exp-1");
    const tree = await mount(<Screen id="exp-1" status="scheduled" />);
    expect(shown()).toBe(true);
    tree.unmount();
  });

  test("shown while the status is still loading, then kept once it loads as live", async () => {
    markJustPublished("exp-1");
    const tree = await mount(<Screen id="exp-1" status={undefined} />);
    expect(shown()).toBe(true);
    await update(tree, <Screen id="exp-1" status="live" />);
    expect(shown()).toBe(true);
    tree.unmount();
  });

  test("returned to draft: the banner goes", async () => {
    markJustPublished("exp-1");
    const tree = await mount(<Screen id="exp-1" status="scheduled" />);
    expect(shown()).toBe(true);
    await update(tree, <Screen id="exp-1" status="draft" />);
    expect(shown()).toBe(false);
    tree.unmount();
  });

  test("cancelled: the banner goes", async () => {
    markJustPublished("evt-1");
    const tree = await mount(<Screen id="evt-1" status="scheduled" />);
    await update(tree, <Screen id="evt-1" status="cancelled" />);
    expect(shown()).toBe(false);
    tree.unmount();
  });

  test("it does not come back when the item is published again without a new publish mark", async () => {
    markJustPublished("exp-1");
    const tree = await mount(<Screen id="exp-1" status="scheduled" />);
    await update(tree, <Screen id="exp-1" status="draft" />);
    await update(tree, <Screen id="exp-1" status="scheduled" />);
    expect(shown()).toBe(false);
    tree.unmount();
  });

  test("switching the screen to another id: the banner goes, and the other item never inherits it", async () => {
    markJustPublished("exp-1");
    const tree = await mount(<Screen id="exp-1" status="scheduled" />);
    expect(shown()).toBe(true);
    await update(tree, <Screen id="exp-2" status="scheduled" />);
    expect(shown()).toBe(false);
    tree.unmount();
  });

  test("switching back to the first id does not revive it", async () => {
    markJustPublished("exp-1");
    const tree = await mount(<Screen id="exp-1" status="scheduled" />);
    await update(tree, <Screen id="exp-2" status="scheduled" />);
    await update(tree, <Screen id="exp-1" status="scheduled" />);
    expect(shown()).toBe(false);
    tree.unmount();
  });

  test("a second item that WAS just published shows its own banner after the switch", async () => {
    markJustPublished("exp-1");
    const tree = await mount(<Screen id="exp-1" status="scheduled" />);
    markJustPublished("exp-2");
    await update(tree, <Screen id="exp-2" status="scheduled" />);
    expect(shown()).toBe(true);
    tree.unmount();
  });

  test("an item that arrives already in draft never shows it", async () => {
    markJustPublished("exp-1");
    const tree = await mount(<Screen id="exp-1" status="draft" />);
    expect(shown()).toBe(false);
    tree.unmount();
  });

  test("dismissing still works, and a re-render does not bring it back", async () => {
    markJustPublished("exp-1");
    const tree = await mount(<Screen id="exp-1" status="scheduled" />);
    await renderer.act(async () => {
      (arrival as JustPublishedArrival).dismiss();
    });
    expect(shown()).toBe(false);
    await update(tree, <Screen id="exp-1" status="live" />);
    expect(shown()).toBe(false);
    tree.unmount();
  });

  test("StrictMode's double effect run keeps the banner for the same id", async () => {
    markJustPublished("exp-1");
    const tree = await mount(
      <React.StrictMode>
        <Screen id="exp-1" status="scheduled" />
      </React.StrictMode>,
    );
    expect(shown()).toBe(true);
    tree.unmount();
  });

  test("callers that pass no status behave exactly as before", async () => {
    markJustPublished("exp-1");
    const tree = await mount(<Screen id="exp-1" />);
    expect(shown()).toBe(true);
    tree.unmount();
  });
});

// ---------------------------------------------------------------------------
// issue #3645 — publishing never opens the share sheet by itself.
// ---------------------------------------------------------------------------
describe("#3645 — a Share press carried over from the publish tap is ignored", () => {
  test("the guard is a short moment after a just-published arrival, nothing more", () => {
    const arrived = 1_000_000;
    expect(isWithinPublishArrivalGuard(arrived, arrived)).toBe(true);
    expect(isWithinPublishArrivalGuard(arrived, arrived + PUBLISH_ARRIVAL_PRESS_GUARD_MS - 1)).toBe(true);
    expect(isWithinPublishArrivalGuard(arrived, arrived + PUBLISH_ARRIVAL_PRESS_GUARD_MS)).toBe(false);
    expect(isWithinPublishArrivalGuard(arrived, arrived + 60_000)).toBe(false);
    // Never on a screen that was not arrived at from a publish.
    expect(isWithinPublishArrivalGuard(null, arrived)).toBe(false);
    // A clock that went backwards must not lock Share out.
    expect(isWithinPublishArrivalGuard(arrived, arrived - 1)).toBe(false);
    expect(PUBLISH_ARRIVAL_PRESS_GUARD_MS).toBeLessThanOrEqual(1000);
  });

  test("straight after a publish arrival a press is 'arrival'; a moment later it is the host's own", async () => {
    const realNow = Date.now;
    let now = 5_000_000;
    Date.now = (): number => now;
    try {
      markJustPublished("exp-1", now);
      const tree = await mount(<Screen id="exp-1" status="scheduled" />);
      expect((arrival as JustPublishedArrival).isArrivalPress()).toBe(true);
      now += PUBLISH_ARRIVAL_PRESS_GUARD_MS;
      expect((arrival as JustPublishedArrival).isArrivalPress()).toBe(false);
      // The banner is still up: its Share button works from here on.
      expect(shown()).toBe(true);
      tree.unmount();
    } finally {
      Date.now = realNow;
    }
  });

  test("an ordinary visit (no publish) never has an arrival moment", async () => {
    const tree = await mount(<Screen id="exp-9" status="scheduled" />);
    expect((arrival as JustPublishedArrival).isArrivalPress()).toBe(false);
    tree.unmount();
  });

  test("isArrivalPress keeps one identity across renders", async () => {
    markJustPublished("exp-1");
    const tree = await mount(<Screen id="exp-1" status="scheduled" />);
    const first = (arrival as JustPublishedArrival).isArrivalPress;
    await update(tree, <Screen id="exp-1" status="live" />);
    expect((arrival as JustPublishedArrival).isArrivalPress).toBe(first);
    tree.unmount();
  });
});
