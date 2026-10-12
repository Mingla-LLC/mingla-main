/**
 * issue #3237 [after Publish, land on the manage screen] — TESTER adversarial.
 * Append-only: NEW file. Attacks the one-shot signal and its arrival hook from
 * angles the implementor suite does not cover:
 *
 *  - React StrictMode's double-invoked mount effect must not spend the mark on
 *    the throwaway pass and leave the real screen with no banner;
 *  - two screens for the SAME id mounted together: exactly one shows it;
 *  - id scoping against look-alike ids (prefix, suffix, case, a draft `d_*` id
 *    versus the server id the publish wrote) and against a co-pending sibling;
 *  - a second publish of the same item re-arms the signal and restarts its
 *    window; an expired mark is cleared by the read that rejects it;
 *  - dismissing is final for that screen: re-renders and a late second mark do
 *    not bring the banner back on the mounted screen;
 *  - a mark left by a publish whose screen never mounted is claimable by a
 *    later visit inside the window and gone after it.
 *
 * FAILS-ON-REVERT (true line deletion in src/utils/justPublishedSignal.ts):
 *  - delete `pending.delete(id);` in consumeJustPublished
 *      -> "two screens for the same id", "a later visit", "expired mark is
 *         cleared" and "one publish, one banner" go RED.
 */
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

import { useJustPublishedArrival } from "../useJustPublishedArrival";
import {
  JUST_PUBLISHED_TTL_MS,
  consumeJustPublished,
  isJustPublishedPending,
  markJustPublished,
  resetJustPublishedForTests,
} from "../../utils/justPublishedSignal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: { findAllByType: (type: string) => HostNode[] };
  update: (element: React.ReactElement) => void;
  unmount: () => void;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

/** A manage screen in miniature: shows a marker node while "just published". */
const Screen: React.FC<{ id: string | null | undefined; tag?: string }> = ({
  id,
  tag = "screen",
}) => {
  const arrival = useJustPublishedArrival(id);
  return arrival.justPublished
    ? React.createElement("Banner", { tag, onDismiss: arrival.dismiss })
    : null;
};

const mount = async (element: React.ReactElement): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(element);
  });
  return tree as Tree;
};
const banners = (tree: Tree): HostNode[] => tree.root.findAllByType("Banner");
const rerender = async (tree: Tree, element: React.ReactElement): Promise<void> => {
  await TestRenderer.act(() => {
    tree.update(element);
  });
};
const dismiss = async (tree: Tree): Promise<void> => {
  const node = banners(tree)[0];
  expect(node).toBeDefined();
  await TestRenderer.act(() => {
    (node.props.onDismiss as () => void)();
  });
};

afterEach(() => resetJustPublishedForTests());

describe("#3237 tester — the arrival survives how React really mounts a screen", () => {
  test("StrictMode's double-invoked mount effect still shows the banner once", async () => {
    markJustPublished("evt-strict");
    const tree = await mount(
      <React.StrictMode>
        <Screen id="evt-strict" />
      </React.StrictMode>,
    );
    // The throwaway effect pass must not eat the mark and leave nothing.
    expect(banners(tree)).toHaveLength(1);
    // ...and the mark is spent, not left behind for a later visit to replay.
    expect(isJustPublishedPending("evt-strict")).toBe(false);
  });

  test("StrictMode: a screen that was not just published stays quiet", async () => {
    const tree = await mount(
      <React.StrictMode>
        <Screen id="evt-quiet" />
      </React.StrictMode>,
    );
    expect(banners(tree)).toHaveLength(0);
  });

  test("two screens for the same id mounted together: exactly one banner", async () => {
    markJustPublished("trip-twice");
    const tree = await mount(
      <>
        <Screen id="trip-twice" tag="first" />
        <Screen id="trip-twice" tag="second" />
      </>,
    );
    expect(banners(tree)).toHaveLength(1);
  });

  test("re-rendering the screen with the same id does not lose the banner", async () => {
    markJustPublished("exp-rerender");
    const tree = await mount(<Screen id="exp-rerender" />);
    await rerender(tree, <Screen id="exp-rerender" />);
    await rerender(tree, <Screen id="exp-rerender" tag="again" />);
    expect(banners(tree)).toHaveLength(1);
  });

  test("a later visit (unmount, mount again) finds nothing to replay", async () => {
    markJustPublished("rsvp-later");
    const first = await mount(<Screen id="rsvp-later" />);
    expect(banners(first)).toHaveLength(1);
    await TestRenderer.act(() => first.unmount());
    const second = await mount(
      <React.StrictMode>
        <Screen id="rsvp-later" />
      </React.StrictMode>,
    );
    expect(banners(second)).toHaveLength(0);
  });

  test("an undefined route id that never resolves claims nothing and breaks nothing", async () => {
    markJustPublished("evt-pending");
    const tree = await mount(<Screen id={undefined} />);
    expect(banners(tree)).toHaveLength(0);
    // The mark is untouched for the screen that does have the id.
    expect(isJustPublishedPending("evt-pending")).toBe(true);
  });
});

describe("#3237 tester — the banner belongs to the published item only", () => {
  test("look-alike ids never claim another item's mark", async () => {
    const published = "3f2b9c1e-0000-4000-8000-0000000000aa";
    markJustPublished(published);
    for (const other of [
      "3f2b9c1e-0000-4000-8000-0000000000a", // prefix
      `${published}0`, // suffix
      published.toUpperCase(), // case
      ` ${published}`, // whitespace
      `d_${published}`, // the draft id the wizard started with
      encodeURIComponent(`${published}/edit`),
    ]) {
      const tree = await mount(<Screen id={other} />);
      expect(banners(tree)).toHaveLength(0);
      await TestRenderer.act(() => tree.unmount());
    }
    // None of the misses spent the real mark.
    const real = await mount(<Screen id={published} />);
    expect(banners(real)).toHaveLength(1);
  });

  test("a draft `d_*` id is not the id a publish marks: only the server id shows the banner", async () => {
    // The event and RSVP wizards start on a local d_* id and the publish RPC
    // answers with the server id; the routes mark the id they navigate to.
    markJustPublished("srv-777");
    const draftScreen = await mount(<Screen id="d_local_777" />);
    expect(banners(draftScreen)).toHaveLength(0);
    const manageScreen = await mount(<Screen id="srv-777" />);
    expect(banners(manageScreen)).toHaveLength(1);
  });

  test("two publishes in quick succession: each screen gets its own banner, once", async () => {
    markJustPublished("evt-A");
    markJustPublished("trip-B");
    const b = await mount(<Screen id="trip-B" />);
    expect(banners(b)).toHaveLength(1);
    // Claiming B did not spend A.
    expect(isJustPublishedPending("evt-A")).toBe(true);
    const a = await mount(<Screen id="evt-A" />);
    expect(banners(a)).toHaveLength(1);
    // Both are now spent.
    const again = await mount(
      <>
        <Screen id="evt-A" />
        <Screen id="trip-B" />
      </>,
    );
    expect(banners(again)).toHaveLength(0);
  });

  test("opening item B after publishing item A shows nothing on B and keeps A's banner for A", async () => {
    markJustPublished("item-A");
    const b = await mount(<Screen id="item-B" />);
    expect(banners(b)).toHaveLength(0);
    const a = await mount(<Screen id="item-A" />);
    expect(banners(a)).toHaveLength(1);
  });
});

describe("#3237 tester — dismissal and re-publishing", () => {
  test("dismissing is final for the mounted screen, across re-renders", async () => {
    markJustPublished("exp-dismiss");
    const tree = await mount(<Screen id="exp-dismiss" />);
    await dismiss(tree);
    expect(banners(tree)).toHaveLength(0);
    await rerender(tree, <Screen id="exp-dismiss" />);
    await rerender(tree, <Screen id="exp-dismiss" tag="again" />);
    expect(banners(tree)).toHaveLength(0);
  });

  test("a second publish of the same item re-arms the signal for the next arrival", async () => {
    markJustPublished("exp-republish");
    const first = await mount(<Screen id="exp-republish" />);
    expect(banners(first)).toHaveLength(1);
    await TestRenderer.act(() => first.unmount());
    // Unpublish back to draft, publish again: a new publish, a new banner.
    markJustPublished("exp-republish");
    const second = await mount(<Screen id="exp-republish" />);
    expect(banners(second)).toHaveLength(1);
    await TestRenderer.act(() => second.unmount());
    const third = await mount(<Screen id="exp-republish" />);
    expect(banners(third)).toHaveLength(0);
  });
});

describe("#3237 tester — the window, attacked at its edges", () => {
  test("one publish, one banner: a claim inside the window cannot be repeated inside the window", () => {
    markJustPublished("evt-once", 10_000);
    expect(consumeJustPublished("evt-once", 10_001)).toBe(true);
    for (let offset = 2; offset < 50; offset += 1) {
      expect(consumeJustPublished("evt-once", 10_000 + offset)).toBe(false);
    }
  });

  test("an expired mark is cleared by the read that rejects it, and cannot be revived by a clock that goes back", () => {
    markJustPublished("evt-old", 0);
    expect(consumeJustPublished("evt-old", JUST_PUBLISHED_TTL_MS + 1)).toBe(false);
    // The rejected read removed it: an earlier timestamp finds nothing.
    expect(isJustPublishedPending("evt-old", 1)).toBe(false);
    expect(consumeJustPublished("evt-old", 1)).toBe(false);
  });

  test("peeking at an expired mark reports false at every later instant", () => {
    markJustPublished("evt-peek", 5_000);
    expect(isJustPublishedPending("evt-peek", 5_000 + JUST_PUBLISHED_TTL_MS)).toBe(true);
    expect(isJustPublishedPending("evt-peek", 5_000 + JUST_PUBLISHED_TTL_MS + 1)).toBe(false);
    expect(isJustPublishedPending("evt-peek", 5_000 + 10 * JUST_PUBLISHED_TTL_MS)).toBe(false);
  });

  test("publishing again restarts the window from the second publish", () => {
    markJustPublished("evt-again", 0);
    markJustPublished("evt-again", 50_000);
    // 70 s after the first publish, 20 s after the second: still claimable.
    expect(consumeJustPublished("evt-again", 70_000)).toBe(true);
    // And it was one mark, not two.
    expect(consumeJustPublished("evt-again", 70_001)).toBe(false);
  });

  test("a publish whose screen never mounted: a visit inside the window gets the banner, a visit after it does not", async () => {
    const realNow = Date.now;
    try {
      let now = 1_000_000;
      Date.now = (): number => now;
      markJustPublished("trip-late");
      markJustPublished("trip-too-late");
      now += JUST_PUBLISHED_TTL_MS - 1;
      const inside = await mount(<Screen id="trip-late" />);
      expect(banners(inside)).toHaveLength(1);
      now += 2;
      const after = await mount(<Screen id="trip-too-late" />);
      expect(banners(after)).toHaveLength(0);
    } finally {
      Date.now = realNow;
    }
  });

  test("ids that are not usable strings never mark and never claim", () => {
    for (const bad of [null, undefined, ""] as const) {
      markJustPublished(bad, 0);
      expect(isJustPublishedPending(bad, 1)).toBe(false);
      expect(consumeJustPublished(bad, 1)).toBe(false);
    }
    // A non-string that slipped past the types (a route param array) is inert.
    const arrayId = ["evt-1"] as unknown as string;
    markJustPublished(arrayId, 0);
    expect(consumeJustPublished(arrayId, 1)).toBe(false);
    expect(consumeJustPublished("evt-1", 1)).toBe(false);
  });
});
